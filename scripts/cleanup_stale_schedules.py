# scripts/cleanup_stale_schedules.py
# 一次性清理殘留交期排程（2026-10-05）
#
# 清理對象：pending/partial 排程，且該料號
#   - 已無任何未結案 PO / 鑄件訂單（全數入貨），且
#   - DB 有已結案 PO（確有入庫紀錄）
#
# 使用: venv/Scripts/python.exe scripts/cleanup_stale_schedules.py
# 冪等：可重複執行。

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'instance', 'order_management.db')


def main():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    rows = cur.execute("""
        SELECT s.id, s.material_id, s.po_number, s.expected_date, s.quantity, s.created_at
        FROM delivery_schedules s
        WHERE s.status IN ('pending', 'partial')
          AND s.material_id NOT IN (
            SELECT DISTINCT material_id FROM purchase_orders WHERE status IN ('pending', 'partial', 'updated')
          )
          AND s.material_id NOT IN (
            SELECT DISTINCT material_id FROM casting_orders WHERE status IN ('pending', 'partial')
          )
          AND s.material_id IN (
            SELECT DISTINCT material_id FROM purchase_orders WHERE status = 'completed'
          )
        ORDER BY s.material_id, s.expected_date
    """).fetchall()

    print(f'找到 {len(rows)} 筆可清除的殘留排程:')
    for r in rows:
        print(f"  id={r['id']} 物料={r['material_id']} 訂單={r['po_number'] or '(手動)'} "
              f"日期={r['expected_date']} 數量={r['quantity']} 建立於={r['created_at']}")

    if not rows:
        print('無須清理。')
        con.close()
        return

    cur.executemany("DELETE FROM delivery_schedules WHERE id = ?", [(r['id'],) for r in rows])
    con.commit()
    print(f'\n清理完成：已刪除 {len(rows)} 筆排程。')
    con.close()


if __name__ == '__main__':
    main()