# run.py
# 應用程式啟動腳本

from waitress import serve
from app import create_app, initialize_app_data, start_background_threads
from app.config import Config

if __name__ == '__main__':
    # 建立應用程式
    app = create_app()
    
    # 初始化資料
    initialize_app_data(app)
    
    # 啟動背景執行緒
    start_background_threads(app)
    
    # 啟動 Waitress 伺服器
    print(f"正在啟動伺服器於 {Config.HOST}:{Config.PORT}...")
    serve(app, host=Config.HOST, port=Config.PORT, threads=Config.THREADS)
