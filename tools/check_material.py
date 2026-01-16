#!/usr/bin/env python
# 查詢物料交期和採購單資料

import sqlite3

db_path = 'instance/order_management.db'
material_id = '8921000779A1'

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print(f"\n=== 查詢物料 {material_id} 的資料 ===\n")

# 1. 查詢交期記錄
print("【1. 交期記錄 (delivery_schedules)】")
cursor.execute("""
    SELECT id, material_id, po_number, expected_date, quantity, received_quantity, status
    FROM delivery_schedules 
    WHERE material_id LIKE ?
""", (f'%{material_id[:10]}%',))

rows = cursor.fetchall()
print(f"找到 {len(rows)} 筆")
for row in rows:
    print(f"  ID:{row[0]}, 物料:{row[1]}, 訂單:{row[2]}, 日期:{row[3]}, 數量:{row[4]}, 已收:{row[5]}, 狀態:{row[6]}")

# 2. 查詢採購單記錄
print("\n【2. 採購單記錄 (purchase_orders)】")
cursor.execute("""
    SELECT po_number, material_id, ordered_quantity, received_quantity, outstanding_quantity, status
    FROM purchase_orders 
    WHERE material_id LIKE ?
""", (f'%{material_id[:10]}%',))

rows = cursor.fetchall()
print(f"找到 {len(rows)} 筆")
for row in rows:
    print(f"  訂單:{row[0]}, 物料:{row[1]}, 訂購:{row[2]}, 已收:{row[3]}, 未交:{row[4]}, 狀態:{row[5]}")

# 3. 查詢鑄件訂單記錄
print("\n【3. 鑄件訂單記錄 (casting_orders)】")
cursor.execute("""
    SELECT order_number, material_id, ordered_quantity, received_quantity, outstanding_quantity, status
    FROM casting_orders 
    WHERE material_id LIKE ?
""", (f'%{material_id[:10]}%',))

rows = cursor.fetchall()
print(f"找到 {len(rows)} 筆")
for row in rows:
    print(f"  訂單:{row[0]}, 物料:{row[1]}, 訂購:{row[2]}, 已收:{row[3]}, 未交:{row[4]}, 狀態:{row[5]}")

conn.close()
