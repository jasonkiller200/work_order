#!/usr/bin/env python
# 查詢物料交期資料

import sqlite3
import os

db_path = 'instance/order_management.db'

if not os.path.exists(db_path):
    print(f"資料庫不存在: {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# 查詢特定物料的交期
material_id = '8917009651'
print(f"\n=== 查詢物料 {material_id}* 的交期記錄 ===\n")

cursor.execute("""
    SELECT id, material_id, po_number, expected_date, quantity, received_quantity, status, notes
    FROM delivery_schedules 
    WHERE material_id LIKE ?
""", (f'%{material_id}%',))

rows = cursor.fetchall()
print(f"找到 {len(rows)} 筆記錄")

for row in rows:
    print(f"  ID: {row[0]}")
    print(f"  物料: {row[1]}")
    print(f"  訂單: {row[2]}")
    print(f"  預計日期: {row[3]}")
    print(f"  數量: {row[4]}")
    print(f"  已收: {row[5]}")
    print(f"  狀態: {row[6]}")
    print(f"  備註: {row[7]}")
    print("-" * 40)

# 查詢所有交期記錄數量
cursor.execute("SELECT COUNT(*) FROM delivery_schedules")
total = cursor.fetchone()[0]
print(f"\n資料庫中共有 {total} 筆交期記錄")

# 顯示前5筆記錄的 material_id 格式
cursor.execute("SELECT DISTINCT material_id FROM delivery_schedules LIMIT 5")
samples = cursor.fetchall()
print(f"\n物料 ID 範例: {[s[0] for s in samples]}")

conn.close()
