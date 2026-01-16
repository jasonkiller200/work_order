import sqlite3
conn = sqlite3.connect('instance/order_management.db')
cursor = conn.cursor()
cursor.execute("SELECT id, material_id, po_number, expected_date, created_at, updated_at FROM delivery_schedules WHERE id = 114")
row = cursor.fetchone()
print(f'ID:{row[0]}')
print(f'物料:{row[1]}')
print(f'訂單:{row[2]}')
print(f'日期:{row[3]}')
print(f'建立時間:{row[4]}')
print(f'更新時間:{row[5]}')

# 查採購單完成時間
cursor.execute("SELECT po_number, status, updated_at FROM purchase_orders WHERE po_number = '1100096496-90'")
po = cursor.fetchone()
print(f'\n採購單狀態:{po[1]}, 更新時間:{po[2]}')
conn.close()
