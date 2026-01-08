# app/__init__.py
# Flask 應用程式工廠

import logging
from flask import Flask
from app.config import Config
from app.controllers import page_bp, api_bp, auth_bp
from app.services.cache_service import cache_manager
from app.services.data_service import DataService
from app.services.spec_service import SpecService

def create_app():
    """
    建立並設定 Flask 應用程式
    
    Returns:
        Flask 應用程式實例
    """
    # 建立 Flask 應用程式
    app = Flask(__name__, 
                template_folder='views',
                static_folder='static')
    
    # 載入設定
    app.config.from_object(Config)
    app.secret_key = Config.SECRET_KEY
    
    # 設定資料庫
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///order_management.db'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    
    # 設定日誌
    logging.basicConfig(
        level=getattr(logging, Config.LOG_LEVEL),
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(Config.LOG_FILE),
            logging.StreamHandler()
        ]
    )
    
    app_logger = logging.getLogger(__name__)
    app_logger.info("正在初始化 Flask 應用程式...")
    
    # 初始化資料庫
    from app.models.database import db
    db.init_app(app)
    
    # 註冊 Blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(page_bp)
    app.register_blueprint(api_bp)
    
    app_logger.info("Blueprints 註冊完成")
    
    return app

def initialize_app_data(app):
    """初始化應用程式資料"""
    app_logger = logging.getLogger(__name__)
    
    # 在應用上下文中執行資料載入
    with app.app_context():
        # 執行首次工單規格檔案彙總
        app_logger.info("主程式：執行首次工單規格檔案彙總...")
        try:
            SpecService.consolidate_spec_files()
            app_logger.info("主程式：首次工單規格檔案彙總完成。")
        except Exception as e:
            app_logger.error(f"主程式：首次工單規格檔案彙總失敗: {e}", exc_info=True)
        
        # 設定快取更新間隔（用於計算下次更新時間）
        cache_manager.set_update_interval(Config.CACHE_UPDATE_INTERVAL)
        
        # 執行首次資料載入
        app_logger.info("主程式：執行首次資料載入...")
        initial_data = DataService.load_and_process_data()
        if initial_data:
            cache_manager.update_cache(initial_data)
            app_logger.info("主程式：首次資料載入成功。")
        else:
            app_logger.error("主程式：首次資料載入失敗！服務將在沒有資料的情況下啟動。")
        
        # 執行首次訂單備註與版本快取載入
        app_logger.info("主程式：執行首次訂單備註與版本快取載入...")
        cache_manager.load_order_notes_to_cache()

def start_background_threads(app):
    """啟動背景執行緒"""
    app_logger = logging.getLogger(__name__)
    
    # 定義快取更新函式
    def update_data_cache():
        with app.app_context():
            app_logger.info("背景執行緒：執行工單規格檔案彙總...")
            try:
                SpecService.consolidate_spec_files()
                app_logger.info("背景執行緒：工單規格檔案彙總完成。")
            except Exception as e:
                app_logger.error(f"背景執行緒：工單規格檔案彙總失敗: {e}", exc_info=True)
            
            new_data = DataService.load_and_process_data()
            if new_data:
                cache_manager.update_cache(new_data)
            else:
                app_logger.error("背景執行緒：資料載入失敗，本次不更新快取。")
            
            # 🆕 執行入庫同步（採購單 + 鑄件訂單）
            try:
                from app.models.database import db
                from app.services.receipt_sync_service import ReceiptSyncService
                
                app_logger.info("背景執行緒：執行入庫同步...")
                receipt_service = ReceiptSyncService(app, db)
                receipt_service.sync_receipts()
                
                # 🆕 清除孤兒交期（訂單已不存在的交期記錄）
                app_logger.info("背景執行緒：清除孤兒交期...")
                receipt_service.cleanup_orphan_delivery_schedules()
                
                app_logger.info("背景執行緒：入庫同步完成。")
            except Exception as e:
                app_logger.error(f"背景執行緒：入庫同步失敗: {e}", exc_info=True)
    
    # 啟動資料快取更新執行緒
    cache_manager.start_cache_update_thread(
        Config.CACHE_UPDATE_INTERVAL,
        update_data_cache
    )
    
    # 啟動訂單備註快取更新執行緒
    cache_manager.start_order_note_cache_update_thread(
        Config.ORDER_NOTE_CACHE_UPDATE_INTERVAL
    )
    
    app_logger.info("背景執行緒已全部啟動")
