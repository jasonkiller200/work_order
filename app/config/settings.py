# app/config/settings.py
# 應用程式設定

class Config:
    """Flask 應用程式設定"""
    
    # Flask 基本設定
    SECRET_KEY = 'your_super_secret_key'  # 在實際應用中，請使用更安全的金鑰並從環境變數中讀取
    DEBUG = False
    
    # 伺服器設定
    HOST = '0.0.0.0'
    PORT = 5002
    THREADS = 2
    
    # 快取更新設定
    CACHE_UPDATE_INTERVAL = 1800  # 30 分鐘（秒）
    ORDER_NOTE_CACHE_UPDATE_INTERVAL = 3600  # 60 分鐘（秒）
    
    # 日誌設定
    LOG_FILE = 'app_errors.log'
    LOG_LEVEL = 'INFO'
    
    # 瀏覽次數記錄檔案
    VIEWS_FILE = 'page_views.json'
    
    # 硬編碼用戶名和密碼 (僅用於示範)
    USERS = {
        "admin": "password123"
    }
    
    # 工單總表下載設定
    WORK_ORDER_BOOK_NAME = "工單總表2025.xls"
    WORK_ORDER_DOWNLOAD_URL = "http://eip.hartford.com.tw/DocLib1/"

