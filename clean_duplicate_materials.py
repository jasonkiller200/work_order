"""
清理 materials 表中的重複資料
保留規則：
1. 優先保留 buyer_id 不為 null 的記錄
2. 如果都是 null，保留 id 最大的記錄（最後一筆）
3. 更新外鍵引用到保留的記錄
"""

import sqlite3
import os
import logging

DB_PATH = os.path.join('instance', 'order_management.db')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def clean_duplicate_materials():
    """清理重複的物料記錄"""
    
    if not os.path.exists(DB_PATH):
        logging.error(f"資料庫檔案不存在: {DB_PATH}")
        return
    
    try:
        conn = sqlite3.connect(DB_PATH, timeout=30)
        cursor = conn.cursor()
        
        logging.info("=" * 70)
        logging.info("開始清理 materials 表中的重複資料")
        logging.info("=" * 70)
        
        # 1. 統計初始狀態
        cursor.execute("SELECT COUNT(*) FROM materials")
        total_before = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(DISTINCT base_material_id) FROM materials")
        unique_base_ids = cursor.fetchone()[0]
        
        logging.info(f"\n初始狀態:")
        logging.info(f"  總記錄數: {total_before}")
        logging.info(f"  不同的 base_material_id: {unique_base_ids}")
        logging.info(f"  預計可清理: {total_before - unique_base_ids} 筆")
        
        # 2. 找出每個 base_material_id 要保留的記錄
        logging.info(f"\n開始分析每個 base_material_id...")
        
        cursor.execute("""
            SELECT DISTINCT base_material_id 
            FROM materials 
            WHERE base_material_id IS NOT NULL
        """)
        all_base_ids = [row[0] for row in cursor.fetchall()]
        
        records_to_keep = []
        records_to_delete = []
        
        for base_id in all_base_ids:
            # 查找該 base_material_id 的所有記錄
            cursor.execute("""
                SELECT id, material_id, buyer_id
                FROM materials
                WHERE base_material_id = ?
                ORDER BY 
                    CASE WHEN buyer_id IS NOT NULL THEN 0 ELSE 1 END,
                    id DESC
            """, (base_id,))
            
            records = cursor.fetchall()
            
            if len(records) > 1:
                # 保留第一筆（buyer_id 不為 null 的，或 id 最大的）
                keep_record = records[0]
                records_to_keep.append(keep_record)
                
                # 其他的標記為刪除
                for record in records[1:]:
                    records_to_delete.append(record)
                
                logging.info(f"  {base_id}: {len(records)} 筆 → 保留 id={keep_record[0]} (material_id={keep_record[1]}, buyer_id={keep_record[2]})")
        
        logging.info(f"\n分析完成:")
        logging.info(f"  需要刪除的記錄: {len(records_to_delete)} 筆")
        
        if len(records_to_delete) == 0:
            logging.info("✓ 沒有重複資料需要清理")
            conn.close()
            return
        
        # 3. 開始清理
        logging.info(f"\n開始清理重複資料...")
        cursor.execute("BEGIN TRANSACTION")
        
        # 3.1 更新 order_materials 的外鍵引用
        logging.info(f"\n更新 order_materials 表的外鍵引用...")
        updated_order_materials = 0
        
        for delete_record in records_to_delete:
            delete_id = delete_record[0]
            delete_material_id = delete_record[1]
            
            # 找到要保留的記錄
            cursor.execute("""
                SELECT material_id FROM materials
                WHERE base_material_id = (
                    SELECT base_material_id FROM materials WHERE id = ?
                )
                AND id NOT IN (?)
                ORDER BY 
                    CASE WHEN buyer_id IS NOT NULL THEN 0 ELSE 1 END,
                    id DESC
                LIMIT 1
            """, (delete_id, delete_id))
            
            keep_result = cursor.fetchone()
            if keep_result:
                keep_material_id = keep_result[0]
                
                # 更新 order_materials
                cursor.execute("""
                    UPDATE order_materials
                    SET material_id = ?
                    WHERE material_id = ?
                """, (keep_material_id, delete_material_id))
                
                if cursor.rowcount > 0:
                    updated_order_materials += cursor.rowcount
        
        logging.info(f"  更新了 {updated_order_materials} 筆 order_materials 記錄")
        
        # 3.2 更新 purchase_orders 的外鍵引用
        logging.info(f"\n更新 purchase_orders 表的外鍵引用...")
        updated_purchase_orders = 0
        
        for delete_record in records_to_delete:
            delete_id = delete_record[0]
            delete_material_id = delete_record[1]
            
            # 找到要保留的記錄
            cursor.execute("""
                SELECT material_id FROM materials
                WHERE base_material_id = (
                    SELECT base_material_id FROM materials WHERE id = ?
                )
                AND id NOT IN (?)
                ORDER BY 
                    CASE WHEN buyer_id IS NOT NULL THEN 0 ELSE 1 END,
                    id DESC
                LIMIT 1
            """, (delete_id, delete_id))
            
            keep_result = cursor.fetchone()
            if keep_result:
                keep_material_id = keep_result[0]
                
                # 更新 purchase_orders
                cursor.execute("""
                    UPDATE purchase_orders
                    SET material_id = ?
                    WHERE material_id = ?
                """, (keep_material_id, delete_material_id))
                
                if cursor.rowcount > 0:
                    updated_purchase_orders += cursor.rowcount
        
        logging.info(f"  更新了 {updated_purchase_orders} 筆 purchase_orders 記錄")
        
        # 3.3 刪除重複的記錄
        logging.info(f"\n刪除重複的記錄...")
        delete_ids = [record[0] for record in records_to_delete]
        
        # 分批刪除（SQLite 的 IN 子句有限制）
        batch_size = 500
        deleted_count = 0
        
        for i in range(0, len(delete_ids), batch_size):
            batch = delete_ids[i:i+batch_size]
            placeholders = ','.join('?' * len(batch))
            cursor.execute(f"DELETE FROM materials WHERE id IN ({placeholders})", batch)
            deleted_count += cursor.rowcount
        
        logging.info(f"  刪除了 {deleted_count} 筆重複記錄")
        
        # 4. 提交交易
        conn.commit()
        
        # 5. 驗證結果
        cursor.execute("SELECT COUNT(*) FROM materials")
        total_after = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(DISTINCT base_material_id) FROM materials")
        unique_after = cursor.fetchone()[0]
        
        logging.info(f"\n" + "=" * 70)
        logging.info(f"清理完成！")
        logging.info(f"=" * 70)
        logging.info(f"清理前: {total_before} 筆")
        logging.info(f"清理後: {total_after} 筆")
        logging.info(f"刪除: {total_before - total_after} 筆")
        logging.info(f"不同的 base_material_id: {unique_after}")
        logging.info(f"=" * 70)
        
        conn.close()
        
    except sqlite3.Error as e:
        logging.error(f"資料庫錯誤: {e}")
        if conn:
            conn.rollback()
        import traceback
        traceback.print_exc()
    except Exception as e:
        logging.error(f"發生錯誤: {e}")
        if conn:
            conn.rollback()
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    print("=" * 70)
    print("Materials 表重複資料清理工具")
    print("=" * 70)
    print("此腳本將:")
    print("1. 找出每個 base_material_id 的所有版本")
    print("2. 優先保留 buyer_id 不為 null 的記錄")
    print("3. 如果都是 null，保留 id 最大的記錄")
    print("4. 更新外鍵引用（order_materials, purchase_orders）")
    print("5. 刪除重複的記錄")
    print("=" * 70)
    
    input("\n按 Enter 鍵開始執行...")
    
    clean_duplicate_materials()
