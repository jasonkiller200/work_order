# migrate_page_views.py
# 一次性冪等遷移：page_views.json -> instance/analytics.db
#
# 用法（在專案根目錄 C:\app\order，用專案 venv）：
#   venv\Scripts\python.exe migrate_page_views.py
#
# 冪等：重跑會先刪掉 source='json' 的舊遷移列再重新匯入（來源為凍結檔，結果確定）。
# 成功後把 page_views.json 複製一份封存為 page_views.json.bak（原檔保留供舊 API 唯讀）。

import json
import os
import shutil
import sys
from datetime import datetime

import pytz

from app.analytics import store
from app.config import Config

TAIWAN_TZ = pytz.timezone('Asia/Taipei')


def main():
    src = Config.VIEWS_FILE
    try:
        with open(src, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"[ERROR] 找不到檔案: {src}")
        return 1
    except json.JSONDecodeError as e:
        print(f"[ERROR] JSON 解析失敗: {e}")
        return 1

    store.init_db()
    conn = store.connect()
    total = 0
    excluded_count = 0
    bad_ts = 0
    try:
        conn.execute("BEGIN IMMEDIATE")
        cur = conn.execute("DELETE FROM page_view_events WHERE source = 'json'")
        print(f"清除舊遷移列: {cur.rowcount} 筆（冪等重跑）")
        for page, pdata in data.items():
            for ip, times in (pdata.get('ip_access_times') or {}).items():
                is_excluded = 1 if ip in Config.EXCLUDED_IPS else 0
                for ts_str in times or []:
                    try:
                        ts_tw = datetime.fromisoformat(ts_str).astimezone(TAIWAN_TZ)
                    except ValueError:
                        bad_ts += 1
                        print(f"[WARN] 跳過無效時間戳: {page} / {ip} / {ts_str}")
                        continue
                    conn.execute(
                        """INSERT INTO page_view_events
                           (ts, local_date, local_hour, local_weekday, page, path, ip,
                            user_id, visitor_id, user_agent, referrer, is_bot, excluded, source)
                           VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, NULL, 0, ?, 'json')""",
                        (
                            ts_tw.astimezone(pytz.utc).isoformat(),
                            ts_tw.strftime('%Y-%m-%d'),
                            ts_tw.hour,
                            ts_tw.weekday(),
                            page,
                            ip,
                            'ip:' + ip,  # 歷史資料無 cookie，UV 以 IP 兜底（與 live 兜底一致）
                            is_excluded,
                        ),
                    )
                    total += 1
                    excluded_count += is_excluded
        conn.execute(
            "INSERT OR REPLACE INTO migration_meta (key, value) VALUES ('page_views_json_migrated_at', ?)",
            (datetime.now(pytz.utc).isoformat(),),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] 遷移失敗，已回滾: {e}")
        return 1
    finally:
        conn.close()

    bak = src + '.bak'
    if not os.path.exists(bak):
        shutil.copy2(src, bak)
        print(f"已封存副本: {bak}")

    print(f"[OK] 遷移完成：共 {total} 筆，其中 excluded {excluded_count} 筆"
          f"（排除 IP: {', '.join(Config.EXCLUDED_IPS)}），無效時間戳 {bad_ts} 筆")
    return 0


if __name__ == '__main__':
    sys.exit(main())