"""
資料庫遷移腳本 - 品號-圖號對照表
功能：
1. 建立 part_drawing_mappings 資料表
2. 從 Excel 匯入資料
3. 檢查重複品號（品號相同但圖號不同）
4. 匯出衝突資料到 Excel 供人工確認
"""

import pandas as pd
import logging
import os
import sys
from datetime import datetime

# 加入專案路徑
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import create_app
from app.models.database import db, PartDrawingMapping

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class PartDrawingMigration:
    """品號-圖號對照表遷移服務"""
    
    def __init__(self, excel_file='品號-圖號對照表.xls'):
        self.excel_file = excel_file
        self.app = create_app()
        self.stats = {
            'total': 0,
            'success': 0,
            'duplicate_same': 0,  # 品號和圖號都相同
            'duplicate_diff': 0,   # 品號相同但圖號不同
            'error': 0
        }
        self.conflicts = []  # 儲存衝突資料
    
    def run(self):
        """執行遷移"""
        with self.app.app_context():
            try:
                logger.info("=" * 60)
                logger.info("品號-圖號對照表遷移開始")
                logger.info("=" * 60)
                
                # 1. 檢查並建立資料表
                self._create_table()
                
                # 2. 讀取 Excel 資料
                df = self._load_excel()
                if df is None or df.empty:
                    logger.error("無法讀取 Excel 資料")
                    return False
                
                # 3. 匯入資料
                self._import_data(df)
                
                # 4. 輸出統計
                self._print_stats()
                
                # 5. 匯出衝突資料
                if self.conflicts:
                    self._export_conflicts()
                
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
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='part_drawing_mappings'"
                ))
                
                if not result.fetchone():
                    logger.info("建立 part_drawing_mappings 資料表...")
                    db.create_all()
                    logger.info("✓ 資料表建立完成")
                else:
                    logger.info("part_drawing_mappings 資料表已存在")
                    
                    # 詢問是否清空
                    response = input("是否清空現有資料？(y/n): ").strip().lower()
                    if response == 'y':
                        PartDrawingMapping.query.delete()
                        db.session.commit()
                        logger.info("✓ 資料表已清空")
                    else:
                        logger.info("保留現有資料，將進行增量匯入")
        
        except Exception as e:
            logger.error(f"建立資料表失敗: {e}")
            raise
    
    def _load_excel(self):
        """讀取 Excel 檔案"""
        if not os.path.exists(self.excel_file):
            logger.error(f"找不到檔案: {self.excel_file}")
            return None
        
        try:
            df = pd.read_excel(self.excel_file)
            
            # 檢查必要欄位
            required_cols = ['品號', '圖號']
            missing_cols = [col for col in required_cols if col not in df.columns]
            if missing_cols:
                logger.error(f"缺少必要欄位: {missing_cols}")
                return None
            
            logger.info(f"✓ 成功讀取 {len(df)} 筆資料")
            return df
        
        except Exception as e:
            logger.error(f"讀取 Excel 失敗: {e}")
            return None
    
    def _import_data(self, df):
        """匯入資料"""
        logger.info("開始匯入資料...")
        
        for index, row in df.iterrows():
            self.stats['total'] += 1
            
            try:
                # 檢查必要欄位
                if pd.isna(row['品號']) or pd.isna(row['圖號']):
                    logger.warning(f"第 {index + 2} 行資料不完整，跳過")
                    self.stats['error'] += 1
                    continue
                
                # 轉換資料型態
                part_number = str(int(row['品號'])) if isinstance(row['品號'], (int, float)) else str(row['品號']).strip()
                drawing_number = str(row['圖號']).strip()
                
                # 檢查是否已存在
                existing = PartDrawingMapping.query.filter_by(part_number=part_number).first()
                
                if existing:
                    if existing.drawing_number == drawing_number:
                        # 品號和圖號都相同，跳過
                        self.stats['duplicate_same'] += 1
                        logger.debug(f"品號 {part_number} 已存在且圖號相同，跳過")
                    else:
                        # 品號相同但圖號不同，記錄衝突
                        self.stats['duplicate_diff'] += 1
                        self.conflicts.append({
                            '品號': part_number,
                            '資料庫中的圖號': existing.drawing_number,
                            'Excel中的圖號': drawing_number,
                            '建立時間': existing.created_at.strftime('%Y-%m-%d %H:%M:%S')
                        })
                        logger.warning(f"⚠️ 品號 {part_number} 衝突：資料庫={existing.drawing_number}, Excel={drawing_number}")
                else:
                    # 新增記錄
                    mapping = PartDrawingMapping(
                        part_number=part_number,
                        drawing_number=drawing_number
                    )
                    db.session.add(mapping)
                    self.stats['success'] += 1
                    
                    # 每 100 筆提交一次
                    if self.stats['success'] % 100 == 0:
                        db.session.commit()
                        logger.info(f"已匯入 {self.stats['success']} 筆...")
            
            except Exception as e:
                self.stats['error'] += 1
                logger.error(f"處理第 {index + 2} 行失敗: {e}")
                continue
        
        # 最後提交
        db.session.commit()
        logger.info("資料匯入完成")
    
    def _print_stats(self):
        """輸出統計資訊"""
        logger.info("=" * 60)
        logger.info("品號-圖號對照表遷移統計：")
        logger.info(f"  總筆數：{self.stats['total']}")
        logger.info(f"  成功匯入：{self.stats['success']}")
        logger.info(f"  重複記錄（相同）：{self.stats['duplicate_same']}")
        logger.info(f"  衝突記錄（不同）：{self.stats['duplicate_diff']}")
        logger.info(f"  錯誤數：{self.stats['error']}")
        logger.info("=" * 60)
    
    def _export_conflicts(self):
        """匯出衝突資料到 Excel"""
        try:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            output_file = f'品號圖號衝突_{timestamp}.xlsx'
            
            df_conflicts = pd.DataFrame(self.conflicts)
            df_conflicts.to_excel(output_file, index=False, engine='openpyxl')
            
            logger.info("=" * 60)
            logger.info(f"⚠️ 發現 {len(self.conflicts)} 筆衝突資料")
            logger.info(f"已匯出到: {output_file}")
            logger.info("請人工確認後決定如何處理")
            logger.info("=" * 60)
        
        except Exception as e:
            logger.error(f"匯出衝突資料失敗: {e}")


def main():
    """主執行程式"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='品號-圖號對照表遷移',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用範例：
  # 使用預設檔案
  python tools/migrate_part_drawing_mapping.py
  
  # 指定檔案
  python tools/migrate_part_drawing_mapping.py --file "路徑/品號-圖號對照表.xls"
        """
    )
    parser.add_argument('--file', default='品號-圖號對照表.xls', help='Excel 檔案路徑')
    
    args = parser.parse_args()
    
    migration = PartDrawingMigration(excel_file=args.file)
    success = migration.run()
    
    if success:
        logger.info("\n✅ 遷移完成！")
    else:
        logger.error("\n❌ 遷移失敗")
        sys.exit(1)


if __name__ == '__main__':
    main()
