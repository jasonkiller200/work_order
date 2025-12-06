"""
檢查 purchase_orders 表的外鍵約束
"""

import sqlite3
import os

DB_PATH = os.path.join('instance', 'order_management.db')

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

print("=" * 70)
print("檢查 purchase_orders 表的外鍵約束")
print("=" * 70)

# 檢查外鍵
cursor.execute("PRAGMA foreign_key_list(purchase_orders)")
fk_list = cursor.fetchall()

if fk_list:
    print("\n外鍵約束:")
    for fk in fk_list:
        print(f"  序號: {fk[0]}")
        print(f"  參考表: {fk[2]}")
        print(f"  本表欄位: {fk[3]}")
        print(f"  參考欄位: {fk[4]}")
        print(f"  更新動作: {fk[5]}")
        print(f"  刪除動作: {fk[6]}")
        print("-" * 50)
else:
    print("\n✓ 沒有外鍵約束")

# 檢查表結構
print("\n" + "=" * 70)
print("purchase_orders 表結構")
print("=" * 70)

cursor.execute("PRAGMA table_info(purchase_orders)")
columns = cursor.fetchall()

for col in columns:
    print(f"  {col[1]:30} {col[2]:15} {'NOT NULL' if col[3] else ''} {'PRIMARY KEY' if col[5] else ''}")

conn.close()
