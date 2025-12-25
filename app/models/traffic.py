from datetime import datetime
from app.utils.helpers import get_taiwan_time

class PageView:
    """頁面瀏覽記錄"""
    
    def __init__(self, page_name, ip_address, timestamp=None):
        """
        初始化頁面瀏覽記錄
        
        Args:
            page_name: 頁面名稱
            ip_address: IP 位址
            timestamp: 時間戳記（可選，預設為當前時間）
        """
        self.page_name = page_name
        self.ip_address = ip_address
        self.timestamp = timestamp or get_taiwan_time().isoformat()
    
    def to_dict(self):
        """轉換為字典格式"""
        return {
            'page_name': self.page_name,
            'ip_address': self.ip_address,
            'timestamp': self.timestamp
        }

class TrafficDAO:
    """流量資料存取物件"""
    
    def __init__(self, views_data):
        """
        初始化 DAO
        
        Args:
            views_data: 流量資料字典
        """
        self.views_data = views_data or {}
    
    def get_page_stats(self, page_name):
        """
        取得特定頁面的統計資料
        
        Args:
            page_name: 頁面名稱
            
        Returns:
            頁面統計資料字典
        """
        return self.views_data.get(page_name, {
            "total_views": 0,
            "ip_access_times": {}
        })
    
    def get_all_stats(self):
        """取得所有頁面的統計資料"""
        traffic_summary = {}
        
        for page, data in self.views_data.items():
            total_views = data.get("total_views", 0)
            ip_access_times = data.get("ip_access_times", {})
            
            ip_stats = []
            for ip, timestamps in ip_access_times.items():
                visits = len(timestamps)
                last_visit = timestamps[-1] if timestamps else None
                ip_stats.append({
                    "ip": ip,
                    "visits": visits,
                    "last_visit": last_visit
                })
            
            traffic_summary[page] = {
                "total_views": total_views,
                "ip_stats": ip_stats
            }
        
        return traffic_summary
