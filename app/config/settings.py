# app/config/settings.py
# 應用程式設定

import os

# 專案根目錄（C:\app\order）：settings.py -> config -> app -> root
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class Config:
    """Flask 應用程式設定"""
    
    # Flask 基本設定
    SECRET_KEY = 'your_super_secret_key'  # 在實際應用中，請使用更安全的金鑰並從環境變數中讀取
    DEBUG = False
    
    # 伺服器設定
    HOST = '0.0.0.0'
    PORT = 5002
    THREADS = 12
    
    # 快取更新設定
    CACHE_UPDATE_INTERVAL = 900  # 15 分鐘（秒）
    ORDER_NOTE_CACHE_UPDATE_INTERVAL = 3600  # 60 分鐘（秒）
    EXCEL_SYNC_INTERVAL = 1800  # 30 分鐘（秒）- 交期同步到 Excel 的間隔
    
    # 日誌設定
    LOG_FILE = 'app_errors.log'
    LOG_LEVEL = 'INFO'
    LOG_MAX_BYTES = 50 * 1024 * 1024  # 單一日誌檔上限 50MB
    LOG_BACKUP_COUNT = 5              # 保留最近 5 個備份（總量上限約 250MB）
    
    # 瀏覽次數記錄檔案（舊制，已凍結：資料已遷移至 analytics.db，原檔保留供舊 API 唯讀）
    VIEWS_FILE = 'page_views.json'

    # 流量統計（新分析系統）
    ANALYTICS_DB = os.environ.get(
        'ANALYTICS_DB',
        os.path.join(_PROJECT_ROOT, 'instance', 'analytics.db')
    )
    # 排除 IP（服務主機 192.168.6.119＝使用者辦公室 PC、同機 localhost）：事件照存、excluded=1、新統計不計
    EXCLUDED_IPS = ('192.168.6.119', '127.0.0.1', '::1')
    PV_COOKIE_NAME = 'pv_vid'
    
    # 硬編碼用戶名和密碼 (僅用於示範)
    USERS = {
        "admin": "password123"
    }
    
    # 工單總表下載設定
    WORK_ORDER_BOOK_NAME = "工單總表2026.xls"
    WORK_ORDER_DOWNLOAD_URL = "http://192.168.1.34/DocLib1/"

