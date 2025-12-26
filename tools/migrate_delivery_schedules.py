"""
資料庫遷移腳本 - 多批交貨排程
功能：
1. 建立 delivery_schedules 資料表
2. 從原有的 instance/delivery_schedules.json 匯入資料
3. 支援無損轉移手動維護的交期記錄
"""

import json
import logging
import os
import sys
from datetime import datetime

# 加入專案路徑
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import create_app
from app.models.database import db, DeliverySchedule, Material, PurchaseOrder

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class DeliveryMigration:
    """交期分批排程遷移服務"""
    
    def __init__(self, json_file='instance/delivery_schedules.json'):
        self.json_file = json_file
        self.app = create_app()
        self.stats = {
            'total': 0,
            'success': 0,
            'skipped': 0,
            'error': 0
        }
    
    def run(self):
        """執行遷移"""
        with self.app.app_context():
            try:
                logger.info("=" * 60)
                logger.info("交期分批排程遷移開始")
                logger.info("=" * 60)
                
                # 1. 檢查並建立資料表
                self._create_table()
                
                # 2. 讀取 JSON 資料
                if not os.path.exists(self.json_file):
                    logger.warning(f"找不到 JSON 檔案: {self.json_file}，僅建立資料表結構")
                    return True
                
                with open(self.json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                schedules_data = data.get('delivery_schedules', {})
                if not schedules_data:
                    logger.info("JSON 中無現有交期資料")
                    return True
                
                # 3. 匯入資料
                self._import_data(schedules_data)
                
                # 4. 輸出統計
                self._print_stats()
                
                return True
                
            except Exception as e:
                logger.error(f"遷移失敗: {e}", exc_info=True)
                return False
    
    def _create_table(self):
        """建立資料表"""
        try:
            with db.engine.connect() as conn:
                # 檢查表是否存在
                result = conn.execute(db.text(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='delivery_schedules'"
                ))
                
                if not result.fetchone():
                    logger.info("建立 delivery_schedules 資料表...")
                    db.create_all()
                    logger.info("✓ 資料表建立完成")
                else:
                    logger.info("delivery_schedules 資料表已存在")
                    
                    # 詢問是否清空
                    response = input("是否清空現有資料重新匯入？(y/n): ").strip().lower()
                    if response == 'y':
                        DeliverySchedule.query.delete()
                        db.session.commit()
                        logger.info("✓ 資料表已清空")
                    else:
                        # 檢查是否已有資料
                        count = DeliverySchedule.query.count()
                        if count > 0:
                            logger.info(f"資料表已有 {count} 筆資料，將嘗試合併不重複項")
        
        except Exception as e:
            logger.error(f"建立資料表失敗: {e}")
            raise
    
    def _import_data(self, schedules_dict):
        """匯入資料"""
        logger.info("開始從 JSON 匯入資料...")
        
        for material_id, items in schedules_dict.items():
            # 檢查物料是否存在
            material = Material.query.filter_by(material_id=material_id).first()
            if not material:
                logger.warning(f"⚠️ 物料 {material_id} 在資料庫中不存在，略過此物料的所有交期")
                self.stats['skipped'] += len(items)
                continue
            
            for item in items:
                self.stats['total'] += 1
                try:
                    # 檢查重複（品號、採購單、日期、數量皆同視為重複）
                    expected_date_str = item.get('expected_date')
                    if not expected_date_str:
                        self.stats['error'] += 1
                        continue
                        
                    try:
                        expected_date = datetime.fromisoformat(expected_date_str).date()
                    except ValueError:
                        expected_date = datetime.strptime(expected_date_str, '%Y-%m-%d').date()
                        
                    po_number = item.get('po_number')
                    quantity = float(item.get('quantity', 0))
                    
                    # 檢查是否已存在
                    existing = DeliverySchedule.query.filter_by(
                        material_id=material_id,
                        po_number=po_number,
                        expected_date=expected_date,
                        quantity=quantity
                    ).first()
                    
                    if existing:
                        self.stats['skipped'] += 1
                        continue
                    
                    # 新增記錄
                    ds = DeliverySchedule(
                        material_id=material_id,
                        po_number=po_number,
                        expected_date=expected_date,
                        quantity=quantity,
                        supplier=item.get('supplier', ''),
                        notes=item.get('notes', ''),
                        status=item.get('status', 'pending')
                    )
                    
                    # 處理 created_at
                    if item.get('created_at'):
                        try:
                            ds.created_at = datetime.fromisoformat(item['created_at'])
                        except:
                            pass
                            
                    db.session.add(ds)
                    self.stats['success'] += 1
                    
                    if self.stats['success'] % 50 == 0:
                        db.session.commit()
                        
                except Exception as e:
                    self.stats['error'] += 1
                    logger.error(f"匯入項目失敗 ({material_id}): {e}")
        
        db.session.commit()
        logger.info("✓ JSON 資料匯入完成")
    
    def _print_stats(self):
        """輸出統計資訊"""
        logger.info("=" * 60)
        logger.info("交期分批排程遷移統計：")
        logger.info(f"  總筆數：{self.stats['total']}")
        logger.info(f"  成功匯入：{self.stats['success']}")
        logger.info(f"  略過重複：{self.stats['skipped']}")
        logger.info(f"  錯誤數：{self.stats['error']}")
        logger.info("=" * 60)

def main():
    migration = DeliveryMigration()
    success = migration.run()
    
    if success:
        logger.info("\n✅ 遷移任務完成！")
    else:
        logger.error("\n❌ 遷移任務失敗")
        sys.exit(1)

if __name__ == '__main__':
    main()
