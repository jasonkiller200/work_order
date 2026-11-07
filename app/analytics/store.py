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


def get_kpis(from_date=None, to_date=None):
    """KPI 總覽：總瀏覽 / 獨立訪客 / 獨立 IP / 頁面數 / 活躍天數（排除 excluded 與 bot）。"""
    from_, to = _resolve_range(from_date, to_date)
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
        return {
            'from': from_,
            'to': to,
            'total_views': row['views'],
            'unique_visitors': row['unique_visitors'],
            'unique_ips': row['unique_ips'],
            'page_count': row['pages'],
            'active_days': row['active_days'],
        }
    finally:
        conn.close()


def get_daily_trend(from_date=None, to_date=None):
    """每日瀏覽次數 / UV 趨勢（缺日補 0）。"""
    from_, to = _resolve_range(from_date, to_date)
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


def get_top_pages(from_date=None, to_date=None, limit=10):
    """熱門頁面排行。"""
    from_, to = _resolve_range(from_date, to_date)
    limit = max(1, min(int(limit), 50))
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