import sqlite3

conn = sqlite3.connect('instance/order_management.db')
cursor = conn.cursor()

# 查看所有表
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cursor.fetchall()
print("資料庫中的表:")
for t in tables:
    print(f"  - {t[0]}")

print("\n檢查 materials 表結構:")
cursor.execute("PRAGMA table_info(materials)")
columns = cursor.fetchall()
for col in columns:
    print(f"  - {col[1]} ({col[2]})")

# 檢查物料 1010002873B0
print("\n檢查物料 1010002873B0:")
cursor.execute("SELECT * FROM materials WHERE material_id LIKE '1010002873%'")
rows = cursor.fetchall()
print(f"找到 {len(rows)} 筆物料 (前10碼為 1010002873)")
for row in rows:
    print(f"  物料: {row[0]}")

conn.close()
