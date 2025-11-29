#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
導入成品工單組件需求明細到資料庫
從 Excel 檔案讀取物料編號，取前10碼作為 base_material_id 存入資料庫
"""

import pandas as pd
import logging
from app import create_app
from app.models.database import db, ComponentRequirement

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def import_component_requirements():
    """導入組件需求明細"""
    
    # 建立應用程式
    app = create_app()
    
    with app.app_context():
        # 檔案路徑
        file_path = '成品工單組件需求明細.xlsx'
        
        logger.info(f"開始讀取檔案: {file_path}")
        
        try:
            # 讀取 Excel 檔案
            df = pd.read_excel(file_path)
            logger.info(f"讀取到 {len(df)} 筆資料")
            logger.info(f"欄位: {df.columns.tolist()}")
            
            # 檢查必要欄位
            if '品號' not in df.columns:
                logger.error("錯誤：Excel 檔案中找不到 '品號' 欄位")
                return
            
            # 清空現有資料
            logger.info("清空現有組件需求明細資料...")
            ComponentRequirement.query.delete()
            db.session.commit()
            
            # 導入新資料
            imported_count = 0
            skipped_count = 0
            
            for index, row in df.iterrows():
                material_id = str(row['品號']).strip()
                
                # 跳過空值
                if not material_id or material_id == 'nan':
                    skipped_count += 1
                    continue
                
                # 取前10碼作為 base_material_id
                base_material_id = material_id[:10]
                
                # 取得說明和備註（如果有的話）
                description = str(row.get('物料說明', '')).strip() if '物料說明' in df.columns else ''
                note = str(row.get('備註', '')).strip() if '備註' in df.columns else ''
                
                # 處理 nan 值
                if description == 'nan':
                    description = ''
                if note == 'nan':
                    note = ''
                
                # 建立新記錄
                component = ComponentRequirement(
                    material_id=material_id,
                    base_material_id=base_material_id,
                    description=description,
                    note=note
                )
                
                db.session.add(component)
                imported_count += 1
                
                # 每100筆提交一次
                if imported_count % 100 == 0:
                    db.session.commit()
                    logger.info(f"已導入 {imported_count} 筆資料...")
            
            # 最後提交
            db.session.commit()
            
            logger.info(f"導入完成！")
            logger.info(f"  - 成功導入: {imported_count} 筆")
            logger.info(f"  - 跳過: {skipped_count} 筆")
            
            # 顯示一些統計資訊
            unique_base_ids = ComponentRequirement.query.with_entities(
                ComponentRequirement.base_material_id
            ).distinct().count()
            logger.info(f"  - 唯一的 base_material_id: {unique_base_ids} 個")
            
            # 顯示前幾筆資料作為確認
            logger.info("\n前5筆資料:")
            sample_records = ComponentRequirement.query.limit(5).all()
            for record in sample_records:
                logger.info(f"  品號: {record.material_id}, Base ID: {record.base_material_id}, 說明: {record.description}")
            
        except FileNotFoundError:
            logger.error(f"錯誤：找不到檔案 '{file_path}'")
        except Exception as e:
            logger.error(f"導入失敗: {e}", exc_info=True)
            db.session.rollback()

if __name__ == '__main__':
    import_component_requirements()
