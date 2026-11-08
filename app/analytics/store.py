# app/analytics/store.py
# 流量統計 — 獨立 SQLite 事件庫（instance/analytics.db）
#
# 設計重點（方案見 scratch/traffic_plan_final.md）：
# - 獨立 DB，與業務 DB order_management.db 隔離（purge/VACUUM/備份互不影響）
# - 同步短交易寫入＋try/except fail-open：統計壞掉絕不影響頁面回應
# - local_date/local_hour/local_weekday 於寫入時以 Asia/Taipei (UTC+8) 算好，查詢免轉時區
# - 新統計一律 WHERE excluded=0 AND is_bot=0
# - visitor_id：cookie pv_vid（UUID4）；cookie 無效或歷史遷移資料以 'ip:<ip>' 兜底（UV≈IP 數）

import logging
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta

import pytz

from app.config import Config

app_logger = logging.getLogger(__name__)

TAIWAN_TZ = pytz.timezone('Asia/Taipei')
UTC_TZ = pytz.utc

SCHEMA = """
CREATE TABLE IF NOT EXISTS page_view_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,                -- ISO8601 UTC
    local_date TEXT NOT NULL,        -- YYYY-MM-DD (Asia/Taipei)
    local_hour INTEGER NOT NULL,     -- 0-23
    local_weekday INTEGER NOT NULL,  -- 0=一 ~ 6=日
    page TEXT NOT NULL,
    path TEXT,
    ip TEXT,
    user_id TEXT,
    visitor_id TEXT,
    user_agent TEXT,
    referrer TEXT,
    is_bot INTEGER NOT NULL DEFAULT 0,
    excluded INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'live'   -- live | json（歷史遷移）
);
CREATE INDEX IF NOT EXISTS idx_pve_date ON page_view_events(local_date);
CREATE INDEX IF NOT EXISTS idx_pve_page_date ON page_view_events(page, local_date);
CREATE INDEX IF NOT EXISTS idx_pve_vid_date ON page_view_events(visitor_id, local_date);
CREATE INDEX IF NOT EXISTS idx_pve_hour_weekday ON page_view_events(local_hour, local_weekday);
CREATE TABLE IF NOT EXISTS migration_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
-- Phase 2：日彙總表（昨日以前讀此表＋今日即時；永久保留、不受 raw purge 影響）
CREATE TABLE IF NOT EXISTS daily_uv_rollups (
    local_date TEXT PRIMARY KEY,
    views INTEGER NOT NULL DEFAULT 0,
    uv INTEGER NOT NULL DEFAULT 0,
    ip_count INTEGER NOT NULL DEFAULT 0,
    active_users INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_page_rollups (
    local_date TEXT NOT NULL,
    page TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    uv INTEGER NOT NULL DEFAULT 0,
    ip_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (local_date, page)
);
"""

BOT_MARKERS = (
    'curl', 'wget', 'python-requests', 'python-urllib', 'go-http-client',
    'headless', 'bot', 'spider', 'crawler', 'httpie', 'okhttp',
)


def _db_path():
    return Config.ANALYTICS_DB


def connect():
    """開啟獨立連線（WAL + busy_timeout），呼叫方負責 close。"""
    path = _db_path()
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path, timeout=3)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=3000")
    return conn


def init_db():
    """冪等建立表格與索引。"""
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def is_bot_user_agent(user_agent):
    if not user_agent:
        return False
    ua = user_agent.lower()
    return any(marker in ua for marker in BOT_MARKERS)


def record_event(page, path=None, ip=None, user_id=None,
                 visitor_id=None, user_agent=None, referrer=None,
                 excluded=False, source='live'):
    """
    同步寫入一筆瀏覽事件（短交易、fail-open）。
    任何例外只記 log、不拋出——統計失敗不得影響頁面回應。
    """
    try:
        now_tw = datetime.now(TAIWAN_TZ)
        conn = connect()
        try:
            conn.execute(
                """INSERT INTO page_view_events
                   (ts, local_date, local_hour, local_weekday, page, path, ip,
                    user_id, visitor_id, user_agent, referrer, is_bot, excluded, source)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    now_tw.astimezone(UTC_TZ).isoformat(),
                    now_tw.strftime('%Y-%m-%d'),
                    now_tw.hour,
                    now_tw.weekday(),
                    page,
                    path,
                    ip,
                    user_id,
                    visitor_id,
                    (user_agent or '')[:500] or None,
                    (referrer or '')[:500] or None,
                    1 if is_bot_user_agent(user_agent) else 0,
                    1 if excluded else 0,
                    source,
                ),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app_logger.warning(f"流量事件寫入失敗（頁面 {page}，不影響回應）: {e}")


def _normalize_date(value, fallback):
    if not value:
        return fallback
    try:
        datetime.strptime(value, '%Y-%m-%d')
        return value
    except ValueError:
        return fallback


def _resolve_range(from_date, to_date):
    """回傳 (from, to) YYYY-MM-DD；參數缺漏/無效時預設最近 30 天（含今日，台北時間）。"""
    today = datetime.now(TAIWAN_TZ)
    to = _normalize_date(to_date, today.strftime('%Y-%m-%d'))
    from_ = _normalize_date(from_date, (today - timedelta(days=29)).strftime('%Y-%m-%d'))
    if from_ > to:
        from_, to = to, from_
    return from_, to


def _today_yesterday():
    now = datetime.now(TAIWAN_TZ)
    return now.strftime('%Y-%m-%d'), (now - timedelta(days=1)).strftime('%Y-%m-%d')


# ---------------------------------------------------------------------------
# Phase 2：讀取快取
# ---------------------------------------------------------------------------

_READ_CACHE_TTL = 15.0
_read_cache = {}
_read_cache_lock = threading.Lock()


def _cached_read(key, fn):
    """15 秒記憶體快取（單 process）。命中回快取值，否則執行 fn() 並存快取。"""
    now = time.monotonic()
    with _read_cache_lock:
        hit = _read_cache.get(key)
        if hit is not None and now - hit[0] < _READ_CACHE_TTL:
            return hit[1]
    value = fn()
    with _read_cache_lock:
        _read_cache[key] = (now, value)
        for k in [k for k, (t, _) in _read_cache.items() if now - t >= _READ_CACHE_TTL]:
            _read_cache.pop(k, None)
    return value


# ---------------------------------------------------------------------------
# Phase 2：日彙總（rollups）
# ---------------------------------------------------------------------------

def ensure_rollups_through(up_to_date=None):
    """
    補齊至 up_to_date（預設昨日）止、所有「已完成日」的日彙總（冪等：重算缺口區間）。
    今日永不 rollup（還在累積），讀取路徑即時計算今日。
    """
    today, yesterday = _today_yesterday()
    up_to = _normalize_date(up_to_date, yesterday)
    if up_to >= today:
        return
    conn = connect()
    try:
        row = conn.execute("SELECT MAX(local_date) AS m FROM daily_uv_rollups").fetchone()
        last = row['m'] if row and row['m'] else None
        if last is not None and last >= up_to:
            return
        start = (datetime.strptime(last, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d') if last else '0000-00-00'
        conn.execute("DELETE FROM daily_uv_rollups WHERE local_date >= ? AND local_date <= ?", (start, up_to))
        conn.execute("DELETE FROM daily_page_rollups WHERE local_date >= ? AND local_date <= ?", (start, up_to))
        conn.execute(
            """INSERT INTO daily_uv_rollups (local_date, views, uv, ip_count, active_users)
               SELECT local_date, COUNT(*), COUNT(DISTINCT visitor_id), COUNT(DISTINCT ip),
                      COUNT(DISTINCT user_id)
               FROM page_view_events
               WHERE local_date >= ? AND local_date <= ? AND excluded = 0 AND is_bot = 0
               GROUP BY local_date""",
            (start, up_to),
        )
        conn.execute(
            """INSERT INTO daily_page_rollups (local_date, page, views, uv, ip_count)
               SELECT local_date, page, COUNT(*), COUNT(DISTINCT visitor_id), COUNT(DISTINCT ip)
               FROM page_view_events
               WHERE local_date >= ? AND local_date <= ? AND excluded = 0 AND is_bot = 0
               GROUP BY local_date, page""",
            (start, up_to),
        )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 讀取查詢（Phase 1 三項改 rollup 混合＋回退；Phase 2 新增 heatmap/users/recent）
# ---------------------------------------------------------------------------

def _kpis_raw(from_, to):
    """KPI 總覽（raw 全掃版）。"""
    conn = connect()
    try:
        row = conn.execute(
            """SELECT COUNT(*) AS views,
                      COUNT(DISTINCT visitor_id) AS unique_visitors,
                      COUNT(DISTINCT ip) AS unique_ips,
                      COUNT(DISTINCT page) AS pages,
                      COUNT(DISTINCT local_date) AS active_days
               FROM page_view_events
               WHERE local_date BETWEEN ? AND ? AND excluded = 0 AND is_bot = 0""",
            (from_, to),
        ).fetchone()
    finally:
        conn.close()
    return {
        'from': from_,
        'to': to,
        'total_views': row['views'],
        'unique_visitors': row['unique_visitors'],
        'unique_ips': row['unique_ips'],
        'page_count': row['pages'],
        'active_days': row['active_days'],
    }


def _kpis_hybrid(from_, to):
    """views＝rollups 昨日以前＋今日即時；去重指標（訪客/IP/頁面/天）仍需 raw 跨日去重。"""
    try:
        today, yesterday = _today_yesterday()
        past_end = to if to < today else yesterday
        ensure_rollups_through()
        past_views = 0
        if from_ <= past_end:
            conn = connect()
            try:
                r = conn.execute(
                    "SELECT COALESCE(SUM(views), 0) AS s FROM daily_uv_rollups WHERE local_date BETWEEN ? AND ?",
                    (from_, past_end),
                ).fetchone()
                past_views = r['s']
            finally:
                conn.close()
        today_views = 0
        if from_ <= today <= to:
            conn = connect()
            try:
                t = conn.execute(
                    "SELECT COUNT(*) AS v FROM page_view_events WHERE local_date = ? AND excluded = 0 AND is_bot = 0",
                    (today,),
                ).fetchone()
                today_views = t['v']
            finally:
                conn.close()
        base = _kpis_raw(from_, to)
        base['total_views'] = past_views + today_views
        return base
    except Exception as e:
        app_logger.warning(f"KPI rollup 查詢失敗，回退 raw: {e}")
        return _kpis_raw(from_, to)


def get_kpis(from_date=None, to_date=None):
    """KPI 總覽：總瀏覽 / 獨立訪客 / 獨立 IP / 頁面數 / 活躍天數（排除 excluded 與 bot）。"""
    from_, to = _resolve_range(from_date, to_date)
    return _cached_read(f'kpis:{from_}:{to}', lambda: _kpis_hybrid(from_, to))


def _daily_trend_raw(from_, to):
    """每日瀏覽次數 / UV 趨勢（缺日補 0）— raw 全掃版。"""
    conn = connect()
    try:
        rows = conn.execute(
            """SELECT local_date AS date,
                      COUNT(*) AS views,
                      COUNT(DISTINCT visitor_id) AS uv
               FROM page_view_events
               WHERE local_date BETWEEN ? AND ? AND excluded = 0 AND is_bot = 0
               GROUP BY local_date
               ORDER BY local_date""",
            (from_, to),
        ).fetchall()
    finally:
        conn.close()

    by_date = {r['date']: r for r in rows}
    out = []
    cur = datetime.strptime(from_, '%Y-%m-%d')
    end = datetime.strptime(to, '%Y-%m-%d')
    while cur <= end:
        d = cur.strftime('%Y-%m-%d')
        r = by_date.get(d)
        out.append({'date': d, 'views': r['views'] if r else 0, 'uv': r['uv'] if r else 0})
        cur += timedelta(days=1)
    return out


def _daily_trend_hybrid(from_, to):
    """昨日以前讀 rollups、今日即時算；缺日補 0。"""
    try:
        today, yesterday = _today_yesterday()
        past_end = to if to < today else yesterday
        ensure_rollups_through()
        by_date = {}
        if from_ <= past_end:
            conn = connect()
            try:
                rows = conn.execute(
                    "SELECT local_date AS date, views, uv FROM daily_uv_rollups WHERE local_date BETWEEN ? AND ?",
                    (from_, past_end),
                ).fetchall()
            finally:
                conn.close()
            by_date = {r['date']: {'views': r['views'], 'uv': r['uv']} for r in rows}
        if from_ <= today <= to:
            conn = connect()
            try:
                t = conn.execute(
                    """SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS uv
                       FROM page_view_events
                       WHERE local_date = ? AND excluded = 0 AND is_bot = 0""",
                    (today,),
                ).fetchone()
            finally:
                conn.close()
            by_date[today] = {'views': t['views'], 'uv': t['uv']}
        out = []
        cur = datetime.strptime(from_, '%Y-%m-%d')
        end = datetime.strptime(to, '%Y-%m-%d')
        while cur <= end:
            d = cur.strftime('%Y-%m-%d')
            r = by_date.get(d)
            out.append({'date': d, 'views': r['views'] if r else 0, 'uv': r['uv'] if r else 0})
            cur += timedelta(days=1)
        return out
    except Exception as e:
        app_logger.warning(f"trend rollup 查詢失敗，回退 raw: {e}")
        return _daily_trend_raw(from_, to)


def get_daily_trend(from_date=None, to_date=None):
    """每日瀏覽次數 / UV 趨勢（缺日補 0）；昨日以前讀 rollups、今日即時。"""
    from_, to = _resolve_range(from_date, to_date)
    return _cached_read(f'trend:{from_}:{to}', lambda: _daily_trend_hybrid(from_, to))


def _top_pages_raw(from_, to, limit):
    """熱門頁面排行 — raw 全掃版。"""
    conn = connect()
    try:
        rows = conn.execute(
            """SELECT page,
                      COUNT(*) AS views,
                      COUNT(DISTINCT visitor_id) AS uv
               FROM page_view_events
               WHERE local_date BETWEEN ? AND ? AND excluded = 0 AND is_bot = 0
               GROUP BY page
               ORDER BY views DESC
               LIMIT ?""",
            (from_, to, limit),
        ).fetchall()
    finally:
        conn.close()
    return [{'page': r['page'], 'views': r['views'], 'uv': r['uv']} for r in rows]


def _top_pages_hybrid(from_, to, limit):
    """views＝rollups 昨日以前＋今日即時；UV 對全期間精確去重（raw 量小直接掃）。"""
    try:
        today, yesterday = _today_yesterday()
        past_end = to if to < today else yesterday
        ensure_rollups_through()
        views_by_page = {}
        if from_ <= past_end:
            conn = connect()
            try:
                rows = conn.execute(
                    """SELECT page, SUM(views) AS views FROM daily_page_rollups
                       WHERE local_date BETWEEN ? AND ? GROUP BY page""",
                    (from_, past_end),
                ).fetchall()
            finally:
                conn.close()
            views_by_page = {r['page']: r['views'] for r in rows}
        if from_ <= today <= to:
            conn = connect()
            try:
                rows = conn.execute(
                    """SELECT page, COUNT(*) AS views FROM page_view_events
                       WHERE local_date = ? AND excluded = 0 AND is_bot = 0 GROUP BY page""",
                    (today,),
                ).fetchall()
            finally:
                conn.close()
            for r in rows:
                views_by_page[r['page']] = views_by_page.get(r['page'], 0) + r['views']
        conn = connect()
        try:
            uv_rows = conn.execute(
                """SELECT page, COUNT(DISTINCT visitor_id) AS uv FROM page_view_events
                   WHERE local_date BETWEEN ? AND ? AND excluded = 0 AND is_bot = 0 GROUP BY page""",
                (from_, to),
            ).fetchall()
        finally:
            conn.close()
        uv_by_page = {r['page']: r['uv'] for r in uv_rows}
        out = [{'page': p, 'views': v, 'uv': uv_by_page.get(p, 0)} for p, v in views_by_page.items()]
        out.sort(key=lambda x: x['views'], reverse=True)
        return out[:limit]
    except Exception as e:
        app_logger.warning(f"top pages rollup 查詢失敗，回退 raw: {e}")
        return _top_pages_raw(from_, to, limit)


def get_top_pages(from_date=None, to_date=None, limit=10):
    """熱門頁面排行。"""
    from_, to = _resolve_range(from_date, to_date)
    limit = max(1, min(int(limit), 50))
    return _cached_read(f'pages:{from_}:{to}:{limit}', lambda: _top_pages_hybrid(from_, to, limit))


# ---------------------------------------------------------------------------
# Phase 2 新增查詢
# ---------------------------------------------------------------------------

def get_heatmap(from_date=None, to_date=None):
    """7×24 使用熱圖：matrix[weekday 0=一..6=日][hour 0-23]＝瀏覽次數（排除 excluded 與 bot）。"""
    from_, to = _resolve_range(from_date, to_date)

    def _query():
        conn = connect()
        try:
            rows = conn.execute(
                """SELECT local_weekday AS wd, local_hour AS hr, COUNT(*) AS c
                   FROM page_view_events
                   WHERE local_date BETWEEN ? AND ? AND excluded = 0 AND is_bot = 0
                   GROUP BY local_weekday, local_hour""",
                (from_, to),
            ).fetchall()
        finally:
            conn.close()
        matrix = [[0] * 24 for _ in range(7)]
        total = 0
        for r in rows:
            matrix[r['wd']][r['hr']] = r['c']
            total += r['c']
        return {
            'from': from_,
            'to': to,
            'matrix': matrix,
            'total': total,
            'max': max((c for row in matrix for c in row), default=0),
        }

    return _cached_read(f'heatmap:{from_}:{to}', _query)


def get_top_visitors(from_date=None, to_date=None, limit=20):
    """活躍裝置排行（visitor_id 粒度；附帶該裝置最近登入過的帳號名，Phase 3 前為輔助資訊）。"""
    from_, to = _resolve_range(from_date, to_date)
    limit = max(1, min(int(limit), 100))

    def _query():
        conn = connect()
        try:
            rows = conn.execute(
                """SELECT v.visitor_id, v.views, v.pages, v.last_date,
                          (SELECT e2.user_id FROM page_view_events e2
                            WHERE e2.visitor_id = v.visitor_id AND e2.user_id IS NOT NULL
                            ORDER BY e2.id DESC LIMIT 1) AS user_id
                   FROM (
                       SELECT visitor_id, COUNT(*) AS views, COUNT(DISTINCT page) AS pages,
                              MAX(local_date) AS last_date
                       FROM page_view_events
                       WHERE local_date BETWEEN ? AND ? AND excluded = 0 AND is_bot = 0
                       GROUP BY visitor_id
                       ORDER BY views DESC
                       LIMIT ?
                   ) v""",
                (from_, to, limit),
            ).fetchall()
        finally:
            conn.close()
        return [
            {'visitor_id': r['visitor_id'], 'user_id': r['user_id'], 'views': r['views'],
             'pages': r['pages'], 'last_seen': r['last_date']}
            for r in rows
        ]

    return _cached_read(f'users:{from_}:{to}:{limit}', _query)


def get_recent(limit=50):
    """即時紀錄：最近 N 筆（excluded=0；含 bot 旗標供監控；不設日期參數、不進快取）。"""
    limit = max(1, min(int(limit), 200))
    conn = connect()
    try:
        rows = conn.execute(
            """SELECT local_date, local_hour, page, path, ip, visitor_id, user_id, user_agent, is_bot
               FROM page_view_events
               WHERE excluded = 0
               ORDER BY id DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Phase 2：保留策略（raw 365 天、rollups 永久）
# ---------------------------------------------------------------------------

def purge_old_events(retention_days=None):
    """
    清除超過 retention_days（預設 Config.PV_RETENTION_DAYS＝365）天的 raw 事件，
    分批 500 列/筆（不長鎖）。rollups 永久保留。fail-open：例外只記 log、回 0。
    """
    if retention_days is None:
        retention_days = getattr(Config, 'PV_RETENTION_DAYS', 365)
    cutoff = (datetime.now(TAIWAN_TZ) - timedelta(days=retention_days)).strftime('%Y-%m-%d')
    total = 0
    try:
        conn = connect()
        try:
            while True:
                cur = conn.execute(
                    "DELETE FROM page_view_events WHERE rowid IN "
                    "(SELECT rowid FROM page_view_events WHERE local_date < ? LIMIT 500)",
                    (cutoff,),
                )
                n = cur.rowcount
                if n == 0:
                    break
                total += n
                conn.commit()
        finally:
            conn.close()
    except Exception as e:
        app_logger.warning(f"raw 事件清理失敗（不影響服務）: {e}")
        return 0
    if total:
        app_logger.info(f"已清除超過 {retention_days} 天的 raw 事件：{total} 筆")
    return total