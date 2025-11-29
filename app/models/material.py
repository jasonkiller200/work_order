# app/models/material.py
# 物料資料模型

import pandas as pd

class Material:
    """物料資料模型"""
    
    def __init__(self, data_dict):
        """
        初始化物料物件
        
        Args:
            data_dict: 包含物料資訊的字典
        """
        self.material_id = data_dict.get('物料', '')
        self.description = data_dict.get('物料說明', '')
        self.storage_location = data_dict.get('儲存地點', '')
        self.base_unit = data_dict.get('基礎計量單位', '')
        self.unrestricted_stock = data_dict.get('unrestricted_stock', 0)
        self.inspection_stock = data_dict.get('inspection_stock', 0)
        self.total_demand = data_dict.get('total_demand', 0)
        self.on_order_stock = data_dict.get('on_order_stock', 0)
        self.current_shortage = data_dict.get('current_shortage', 0)
        self.projected_shortage = data_dict.get('projected_shortage', 0)
        self.idle_days = data_dict.get('閒置天數', 0)
        self.base_material_id = data_dict.get('base_material_id', '')
    
    def to_dict(self):
        """轉換為字典格式"""
        return {
            '物料': self.material_id,
            '物料說明': self.description,
            '儲存地點': self.storage_location,
            '基礎計量單位': self.base_unit,
            'unrestricted_stock': self.unrestricted_stock,
            'inspection_stock': self.inspection_stock,
            'total_demand': self.total_demand,
            'on_order_stock': self.on_order_stock,
            'current_shortage': self.current_shortage,
            'projected_shortage': self.projected_shortage,
            '閒置天數': self.idle_days,
            'base_material_id': self.base_material_id
        }

class MaterialDAO:
    """物料資料存取物件"""
    
    def __init__(self, materials_data):
        """
        初始化 DAO
        
        Args:
            materials_data: 物料資料列表（字典格式）
        """
        self.df = pd.DataFrame(materials_data) if materials_data else pd.DataFrame()
    
    def get_by_id(self, material_id):
        """
        根據物料 ID 取得物料資訊
        
        Args:
            material_id: 物料 ID
            
        Returns:
            物料資訊字典，如果找不到則返回 None
        """
        if self.df.empty:
            return None
        
        result = self.df[self.df['物料'].astype(str) == str(material_id)]
        if result.empty:
            return None
        
        return result.iloc[0].to_dict()
    
    def get_substitutes(self, material_id):
        """
        取得替代品清單
        
        Args:
            material_id: 物料 ID
            
        Returns:
            替代品清單
        """
        if self.df.empty:
            return []
        
        base_id = str(material_id)[:10]
        substitutes = self.df[
            (self.df['base_material_id'] == base_id) & 
            (self.df['物料'].astype(str) != str(material_id))
        ]
        
        return substitutes[['物料', '物料說明', 'unrestricted_stock', 'inspection_stock']].to_dict('records')
    
    def get_all(self):
        """取得所有物料資料"""
        return self.df.to_dict('records')
