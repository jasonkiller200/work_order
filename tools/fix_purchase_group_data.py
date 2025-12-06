"""
修正 purchase_orders 表中 purchase_group 欄位的資料格式
確保所有 purchase_group 都是字串格式，並保留前導零 (如 001, 002)
"""

import sqlite3
import os
import logging

# 配置
DB_PATH = os.path.join('instance', 'order_management.db')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def fix_purchase_group_data():
    """修正 purchase_group 欄位資料"""
    
    if not os.path.exists(DB_PATH):
        logging.error(f"資料庫檔案不存在: {DB_PATH}")
        return
    
    try:
        conn = sqlite3.connect(DB_PATH, timeout=10)
        cursor = conn.cursor()
        
        logging.info("=" * 70)
        logging.info("開始修正 purchase_group 欄位資料...")
        logging.info("=" * 70)
        
        # 1. 檢查表結構
        cursor.execute("PRAGMA table_info(purchase_orders)")
        columns = cursor.fetchall()
        
        logging.info("\n當前 purchase_orders 表結構:")
        for col in columns:
            if 'purchase_group' in col[1]:
                logging.info(f"  欄位: {col[1]}, 型態: {col[2]}")
        
        # 2. 查看當前資料狀態
        cursor.execute("""
            SELECT id, po_number, purchase_group, typeof(purchase_group) as type
            FROM purchase_orders 
            WHERE purchase_group IS NOT NULL
            LIMIT 10
        """)
        sample_data = cursor.fetchall()
        
        logging.info("\n當前資料樣本 (前10筆):")
        for row in sample_data:
            logging.info(f"  ID: {row[0]}, PO: {row[1]}, purchase_group: '{row[2]}' (型態: {row[3]})")
        
        # 3. 統計需要修正的資料
        cursor.execute("""
            SELECT COUNT(*) 
            FROM purchase_orders 
            WHERE purchase_group IS NOT NULL 
            AND (
                typeof(purchase_group) != 'text' 
                OR length(purchase_group) < 3
                OR purchase_group NOT LIKE '0%'
            )
        """)
        need_fix_count = cursor.fetchone()[0]
        
        logging.info(f"\n需要修正的記錄數: {need_fix_count}")
        
        if need_fix_count == 0:
            logging.info("✓ 所有資料格式正確，無需修正！")
            conn.close()
            return
        
        # 4. 開始修正
        logging.info("\n開始修正資料...")
        cursor.execute("BEGIN TRANSACTION")
        
        # 取得所有需要修正的記錄
        cursor.execute("""
            SELECT id, purchase_group 
            FROM purchase_orders 
            WHERE purchase_group IS NOT NULL
        """)
        all_records = cursor.fetchall()
        
        fixed_count = 0
        for record_id, purchase_group in all_records:
            try:
                # 轉換為字串並補零
                if purchase_group is not None:
                    # 如果是數字，轉換為字串並補零到3位
                    if isinstance(purchase_group, (int, float)):
                        new_value = str(int(purchase_group)).zfill(3)
                    else:
                        # 如果已經是字串，確保補零
                        pg_str = str(purchase_group).strip()
                        if pg_str.isdigit():
                            new_value = pg_str.zfill(3)
                        else:
                            new_value = pg_str
                    
                    # 更新資料
                    cursor.execute("""
                        UPDATE purchase_orders 
                        SET purchase_group = ? 
                        WHERE id = ?
                    """, (new_value, record_id))
                    
                    fixed_count += 1
                    
            except Exception as e:
                logging.error(f"修正記錄 ID {record_id} 時發生錯誤: {e}")
                continue
        
        # 5. 提交變更
        conn.commit()
        logging.info(f"\n✓ 成功修正 {fixed_count} 筆記錄")
        
        # 6. 驗證修正結果
        cursor.execute("""
            SELECT id, po_number, purchase_group, typeof(purchase_group) as type
            FROM purchase_orders 
            WHERE purchase_group IS NOT NULL
            LIMIT 10
        """)
        updated_data = cursor.fetchall()
        
        logging.info("\n修正後的資料樣本 (前10筆):")
        for row in updated_data:
            logging.info(f"  ID: {row[0]}, PO: {row[1]}, purchase_group: '{row[2]}' (型態: {row[3]})")
        
        # 7. 統計各採購群組的數量
        cursor.execute("""
            SELECT purchase_group, COUNT(*) as count
            FROM purchase_orders 
            WHERE purchase_group IS NOT NULL
            GROUP BY purchase_group
            ORDER BY purchase_group
        """)
        group_stats = cursor.fetchall()
        
        logging.info("\n各採購群組統計:")
        for group, count in group_stats:
            logging.info(f"  採購群組 {group}: {count} 筆")
        
        logging.info("\n" + "=" * 70)
        logging.info("修正完成！")
        logging.info("=" * 70)
        
        conn.close()
        
    except sqlite3.Error as e:
        logging.error(f"資料庫錯誤: {e}")
        import traceback
        traceback.print_exc()
    except Exception as e:
        logging.error(f"發生錯誤: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    print("=" * 70)
    print("Purchase Group 資料格式修正工具")
    print("=" * 70)
    print("此腳本將:")
    print("1. 檢查 purchase_orders 表中 purchase_group 欄位的資料格式")
    print("2. 將所有數字轉換為字串格式")
    print("3. 確保所有值都補零到3位數 (如 001, 002, 003)")
    print("=" * 70)
    
    input("\n按 Enter 鍵開始執行...")
    
    fix_purchase_group_data()
