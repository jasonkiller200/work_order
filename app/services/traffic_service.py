# app/services/traffic_service.py
# 流量統計服務

import os
import json
import logging
import pytz
from datetime import datetime
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
        記錄頁面訪問次數和 IP
        
        Args:
            page_name: 頁面名稱
            ip_address: IP 位址
        """
        views_data = TrafficService.read_views()
        
        if page_name not in views_data:
            views_data[page_name] = {
                "total_views": 0,
                "ip_access_times": {}
            }
        
        views_data[page_name]["total_views"] += 1
        
        if ip_address not in views_data[page_name]["ip_access_times"]:
            views_data[page_name]["ip_access_times"][ip_address] = []
        
        # 獲取台灣時間
        taiwan_tz = pytz.timezone('Asia/Taipei')
        current_time = datetime.now(taiwan_tz).isoformat()
        
        views_data[page_name]["ip_access_times"][ip_address].append(current_time)
        
        TrafficService.write_views(views_data)
