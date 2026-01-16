#!/usr/bin/env python
import sqlite3
conn = sqlite3.connect('instance/order_management.db')
cursor = conn.cursor()

print("\n=== 採購單查詢 ===")
cursor.execute("""
    SELECT po_number, material_id, outstanding_quantity, status 
    FROM purchase_orders 
    WHERE material_id LIKE '%8917009651%'
""")
rows = cursor.fetchall()
print(f'找到 {len(rows)} 筆採購單記錄')
for r in rows:
    print(f'  訂單:{r[0]}, 物料:{r[1]}, 待交:{r[2]}, 狀態:{r[3]}')

conn.close()
