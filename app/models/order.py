# app/models/order.py
# 訂單資料模型

class Order:
    """訂單資料模型"""
    
    def __init__(self, order_id, materials=None, specs=None, summary=None, note=None, version=None):
        """
        初始化訂單物件
        
        Args:
            order_id: 訂單 ID
            materials: 訂單物料清單
            specs: 訂單規格清單
            summary: 訂單摘要資訊
            note: 訂單備註
            version: 訂單版本
        """
        self.order_id = order_id
        self.materials = materials or []
        self.specs = specs or []
        self.summary = summary or {}
        self.note = note
        self.version = version
    
    def to_dict(self):
        """轉換為字典格式"""
        return {
            'order_id': self.order_id,
            'order_materials': self.materials,
            'order_specs': self.specs,
            'order_summary': self.summary,
            'order_note': self.note,
            'spec_version': self.version
        }

class OrderDAO:
    """訂單資料存取物件"""
    
    def __init__(self, order_details_map, specs_map, order_summary_map, order_note_cache):
        """
        初始化 DAO
        
        Args:
            order_details_map: 訂單詳情對應表
            specs_map: 規格對應表
            order_summary_map: 訂單摘要對應表
            order_note_cache: 訂單備註快取
        """
        self.order_details_map = order_details_map or {}
        self.specs_map = specs_map or {}
        self.order_summary_map = order_summary_map or {}
        self.order_note_cache = order_note_cache or {}
    
    def get_by_id(self, order_id):
        """
        根據訂單 ID 取得訂單資訊
        
        Args:
            order_id: 訂單 ID
            
        Returns:
            Order 物件，如果找不到則返回 None
        """
        order_id_str = str(order_id).strip()
        
        # 取得訂單物料
        materials = self.order_details_map.get(order_id, [])
        
        # 取得訂單規格
        specs = self.specs_map.get(order_id, [])
        
        # 取得訂單摘要
        summary = self.order_summary_map.get(order_id, {})
        
        # 取得訂單備註和版本
        cached_info = self.order_note_cache.get(order_id_str, {})
        note = cached_info.get('note')
        version = cached_info.get('version')
        
        return Order(
            order_id=order_id,
            materials=materials,
            specs=specs,
            summary=summary,
            note=note,
            version=version
        )
