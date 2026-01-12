"""
Excel 同步服務 - 將系統交期資料同步至外部 Excel 檔案
"""
import os
import logging
from datetime import datetime
from openpyxl import load_workbook
from sqlalchemy import func
from ..models.database import db, DeliverySchedule

app_logger = logging.getLogger(__name__)


# Excel 檔案設定
EXCEL_CONFIG = {
    'file_path': r'Q:\G003\生產排程\8週生產排程紀錄\裝配進度&缺料情報\第一廠\組件課\未來半品缺料.xlsm',
    'sheet_name': '半品',
    'material_col': 'A',  # 料號欄位
    'delivery_col': 'H',  # 交期欄位
    'header_row': 1       # 表頭列數
}


def sync_delivery_to_excel():
    """
    將採購儀表板的第一筆預計交貨日期同步到 Excel 檔案
    
    Returns:
        dict: 同步結果統計
            - success: bool
            - synced_count: int - 成功同步筆數
            - skipped_count: int - 跳過筆數（系統無交期）
            - error: str - 錯誤訊息（如果有）
    """
    result = {
        'success': False,
        'synced_count': 0,
        'skipped_count': 0,
        'not_found_count': 0,
        'error': None
    }
    
    try:
        file_path = EXCEL_CONFIG['file_path']
        
        # 1. 檢查檔案是否存在
        if not os.path.exists(file_path):
            result['error'] = f'Excel 檔案不存在: {file_path}'
            app_logger.error(result['error'])
            return result
        
        # 2. 載入 Excel 檔案 (保留巨集)
        app_logger.info(f'正在載入 Excel 檔案: {file_path}')
        wb = load_workbook(file_path, keep_vba=True)
        
        # 3. 取得指定頁籤
        sheet_name = EXCEL_CONFIG['sheet_name']
        if sheet_name not in wb.sheetnames:
            result['error'] = f'找不到頁籤: {sheet_name}'
            app_logger.error(result['error'])
            return result
        
        ws = wb[sheet_name]
        
        # 4. 查詢系統中所有有交期的物料 (取每個物料的第一筆有效交期)
        # 使用子查詢取得每個物料最近的交期
        delivery_map = _get_first_delivery_dates()
        app_logger.info(f'系統中共有 {len(delivery_map)} 個物料有交期資料')
        
        # 5. 遍歷 Excel 每一列
        header_row = EXCEL_CONFIG['header_row']
        material_col = EXCEL_CONFIG['material_col']
        delivery_col = EXCEL_CONFIG['delivery_col']
        
        for row_num in range(header_row + 1, ws.max_row + 1):
            # 取得料號
            material_id = ws[f'{material_col}{row_num}'].value
            
            if not material_id:
                continue
            
            # 轉為字串並去除空白
            material_id = str(material_id).strip()
            
            # 6. 在系統中查找對應的交期
            if material_id in delivery_map:
                expected_date = delivery_map[material_id]
                # 回填到交期欄位
                ws[f'{delivery_col}{row_num}'] = expected_date.strftime('%Y-%m-%d')
                result['synced_count'] += 1
            else:
                # 系統中沒有交期資料，跳過（不清空現有值）
                result['skipped_count'] += 1
        
        # 7. 儲存 Excel
        app_logger.info(f'正在儲存 Excel 檔案...')
        wb.save(file_path)
        wb.close()
        
        result['success'] = True
        app_logger.info(f'交期同步完成: 成功 {result["synced_count"]} 筆, 跳過 {result["skipped_count"]} 筆')
        
    except PermissionError:
        result['error'] = 'Excel 檔案正在被其他程式使用中，請先關閉檔案後再試'
        app_logger.error(result['error'])
    except Exception as e:
        result['error'] = str(e)
        app_logger.error(f'交期同步失敗: {e}', exc_info=True)
    
    return result


def _get_first_delivery_dates():
    """
    取得每個物料的第一筆有效交期
    
    Returns:
        dict: {material_id: expected_date}
    """
    # 使用 SQL 子查詢取得每個物料的最近交期
    subquery = db.session.query(
        DeliverySchedule.material_id,
        func.min(DeliverySchedule.expected_date).label('first_date')
    ).filter(
        DeliverySchedule.status.notin_(['cancelled', 'completed']),
        DeliverySchedule.expected_date.isnot(None)
    ).group_by(
        DeliverySchedule.material_id
    ).subquery()
    
    # 取得完整的交期記錄
    results = db.session.query(
        subquery.c.material_id,
        subquery.c.first_date
    ).all()
    
    return {row.material_id: row.first_date for row in results}
