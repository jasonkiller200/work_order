import sqlite3

conn = sqlite3.connect('instance/order_management.db')
cursor = conn.cursor()

# 檢查特定物料
material_id = '1010002873B0'
base_id = material_id[:10]

print(f"檢查物料: {material_id}")
print(f"前10碼: {base_id}\n")

# 1. 查詢完整物料編號
cursor.execute('SELECT material_id, buyer_id FROM materials WHERE material_id = ?', (material_id,))
row = cursor.fetchone()
print(f"完整編號查詢 ({material_id}):")
if row:
    print(f"  找到! buyer_id = {row[1]}")
    if row[1]:
        cursor.execute('SELECT full_name FROM buyers WHERE id = ?', (row[1],))
        buyer = cursor.fetchone()
        if buyer:
            print(f"  採購人員: {buyer[0]}")
else:
    print(f"  資料庫中未找到此物料")

print()

# 2. 查詢前10碼
cursor.execute('SELECT material_id, buyer_id FROM materials WHERE material_id LIKE ?', (f'{base_id}%',))
rows = cursor.fetchall()
print(f"前10碼查詢 ({base_id}%):")
if rows:
    print(f"  找到 {len(rows)} 筆相關物料:")
    for row in rows[:5]:
        buyer_name = '無'
        if row[1]:
            cursor.execute('SELECT full_name FROM buyers WHERE id = ?', (row[1],))
            buyer = cursor.fetchone()
            if buyer:
                buyer_name = buyer[0]
        print(f"    - {row[0]}: 採購人員={buyer_name}")
    if len(rows) > 5:
        print(f"    ... 還有 {len(rows) - 5} 筆")
else:
    print(f"  未找到")

print("\n" + "="*60)
print("統計資訊:")

# 統計
cursor.execute('SELECT COUNT(*) FROM materials')
total = cursor.fetchone()[0]

cursor.execute('SELECT COUNT(*) FROM materials WHERE buyer_id IS NOT NULL')
with_buyer = cursor.fetchone()[0]

print(f"總物料數: {total}")
print(f"有採購人員的物料: {with_buyer}")
print(f"無採購人員的物料: {total - with_buyer}")

conn.close()
