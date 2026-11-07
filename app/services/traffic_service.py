# app/services/traffic_service.py
# 流量統計服務

import os
import json
import logging
from app.config import Config

app_logger = logging.getLogger(__name__)

class TrafficService:
    """流量統計服務"""
    
    @staticmethod
    def read_views():
        """
        讀取瀏覽次數資料
        
        Returns:
            瀏覽次數資料字典
        """
        if os.path.exists(Config.VIEWS_FILE):
            try:
                with open(Config.VIEWS_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except json.JSONDecodeError as e:
                app_logger.error(f"讀取 {Config.VIEWS_FILE} 時發生 JSON 解碼錯誤: {e}", exc_info=True)
                return {}
            except Exception as e:
                app_logger.error(f"讀取 {Config.VIEWS_FILE} 時發生錯誤: {e}", exc_info=True)
                return {}
        return {}
    
    @staticmethod
    def write_views(views_data):
        """
        寫入瀏覽次數資料
        
        Args:
            views_data: 瀏覽次數資料字典
        """
        try:
            with open(Config.VIEWS_FILE, 'w', encoding='utf-8') as f:
                json.dump(views_data, f, indent=4, ensure_ascii=False)
        except Exception as e:
            app_logger.error(f"寫入 {Config.VIEWS_FILE} 時發生錯誤: {e}", exc_info=True)
    
    @staticmethod
    def record_page_view(page_name, ip_address):
        """
        記錄頁面訪問（新分析系統：analytics.db 事件表）

        舊制 page_views.json 已凍結（資料遷移後保留供舊 API 唯讀），此處不再寫入。
        fail-open：任何例外只記 log，不影響頁面回應。

        Args:
            page_name: 頁面名稱
            ip_address: IP 位址
        """
        try:
            from flask import request, session, has_request_context
            from app.analytics import store

            path = user_agent = referrer = visitor_id = user_id = None
            if has_request_context():
                path = request.path
                user_agent = request.headers.get('User-Agent', '')
                referrer = request.headers.get('Referer', '')
                visitor_id = request.cookies.get(Config.PV_COOKIE_NAME)
                # cookie 無效時以 IP 兜底（與歷史遷移資料一致，UV≈IP 數）
                if not visitor_id:
                    visitor_id = 'ip:' + (ip_address or 'unknown')
                # 預留：目前登入體系無 username（Phase 3 接 users 表後啟用）
                user_id = session.get('username')

            excluded = bool(ip_address) and ip_address in Config.EXCLUDED_IPS
            store.record_event(
                page=page_name,
                path=path,
                ip=ip_address,
                user_id=user_id,
                visitor_id=visitor_id,
                user_agent=user_agent,
                referrer=referrer,
                excluded=excluded,
            )
        except Exception as e:
            app_logger.warning(f"record_page_view 失敗（不影響頁面回應）: {e}")
