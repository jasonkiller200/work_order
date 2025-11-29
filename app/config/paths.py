# app/config/paths.py
# 檔案路徑設定

class FilePaths:
    """檔案路徑設定"""
    
    # Excel 資料檔案路徑
    INVENTORY_FILE = r'P:\\F004\\MPS維護\\零件庫存.XLSX'
    WIP_PARTS_FILE = r'P:\\F004\\MPS維護\\撥料.XLSX'
    FINISHED_PARTS_FILE = r'P:\\F004\\MPS維護\\成品撥料.XLSX'
    PREP_SEMI_FINISHED_FILE = r'P:\\F004\\MPS維護\\預備半品用料.xlsx'
    SPECS_FILE = r'P:\\F004\\MPS維護\\工單規格總表.xlsx'
    ON_ORDER_FILE = r'P:\\F004\\MPS維護\\已訂未交.XLSX'
    
    # 工單總表
    WORK_ORDER_SUMMARY_FILE = '工單總表2025.xls'
    WORK_ORDER_SUMMARY_SHEET = '工單總表'
    
    # 訂單備註與版本來源檔案
    ORDER_NOTE_SOURCE_FILE = r'Q:\\G003\\生產排程\\8週生產排程紀錄\\裝配進度&缺料情報\\第一廠\\組件課\\組件1-20新增缺料查詢功能.xls'
    ORDER_NOTE_SOURCE_SHEET = '整合資料'
    
    # 規格檔案彙總
    SPEC_SOURCE_FOLDER = r'P:\\F004\\SAP半品庫存管理\\成品工單訂單規格'
    SPEC_OUTPUT_FILE = r'P:\\F004\\MPS維護\\工單規格總表.xlsx'
