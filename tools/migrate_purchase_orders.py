"""
資料庫遷移腳本 - 為 purchase_orders 表添加新欄位
"""

from app import create_app
from app.models.database import db

def migrate_purchase_orders_table():
    """為 purchase_orders 表添加新欄位"""
    
    app = create_app()
    
    with app.app_context():
        print("開始資料庫遷移...")
        
        try:
            # 使用 SQLAlchemy 的 DDL 操作
            with db.engine.connect() as conn:
                # 檢查表是否存在
                result = conn.execute(db.text(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='purchase_orders'"
                ))
                
                if not result.fetchone():
                    print("purchase_orders 表不存在,建立新表...")
                    db.create_all()
                    print("表格建立完成!")
                else:
                    print("purchase_orders 表已存在,添加新欄位...")
                    
                    # 添加新欄位 (如果不存在)
                    new_columns = [
                        ("supplier", "VARCHAR(200)"),
                        ("item_number", "INTEGER"),
                        ("description", "VARCHAR(500)"),
                        ("document_date", "DATE"),
                        ("document_type", "VARCHAR(20)"),
                        ("purchase_group", "VARCHAR(10)"),  # 字串格式以保留前導零
                        ("plant", "VARCHAR(10)"),
                        ("storage_location", "VARCHAR(10)"),
                        ("unit_price", "NUMERIC(15, 2)"),
                        ("currency", "VARCHAR(10)"),
                        ("total_value", "NUMERIC(15, 2)")
                    ]
                    
                    for col_name, col_type in new_columns:
                        try:
                            conn.execute(db.text(
                                f"ALTER TABLE purchase_orders ADD COLUMN {col_name} {col_type}"
                            ))
                            conn.commit()
                            print(f"  ✓ 已添加欄位: {col_name}")
                        except Exception as e:
                            if "duplicate column name" in str(e).lower():
                                print(f"  - 欄位已存在: {col_name}")
                            else:
                                print(f"  ✗ 添加欄位失敗 {col_name}: {e}")
                    
                    print("欄位添加完成!")
            
            print("\n資料庫遷移完成!")
            
        except Exception as e:
            print(f"遷移過程發生錯誤: {e}")
            import traceback
            traceback.print_exc()

if __name__ == '__main__':
    migrate_purchase_orders_table()
