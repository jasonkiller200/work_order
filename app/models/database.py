# app/models/database.py
# SQLAlchemy 資料庫模型定義

from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class User(db.Model):
    """使用者（採購人員）"""
    __tablename__ = 'users'
    
    id = db.Column(db.String(10), primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(255))
    full_name = db.Column(db.String(100))
    email = db.Column(db.String(100))
    department = db.Column(db.String(100))
    role = db.Column(db.String(20), default='buyer')  # admin, buyer, viewer
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 關聯
    materials = db.relationship('Material', back_populates='buyer')
    purchase_orders = db.relationship('PurchaseOrder', back_populates='buyer')
    
    def __repr__(self):
        return f'<User {self.username}>'

class Material(db.Model):
    """物料主檔"""
    __tablename__ = 'materials'
    
    id = db.Column(db.Integer, primary_key=True)
    material_id = db.Column(db.String(50), unique=True, nullable=False, index=True)
    description = db.Column(db.String(200))
    base_material_id = db.Column(db.String(50), index=True)
    storage_location = db.Column(db.String(50))
    base_unit = db.Column(db.String(20))
    
    # 採購資訊
    buyer_id = db.Column(db.String(10), db.ForeignKey('users.id'))
    lead_time_days = db.Column(db.Integer, default=0)
    
    # 系統欄位
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 關聯
    buyer = db.relationship('User', back_populates='materials')
    order_materials = db.relationship('OrderMaterial', back_populates='material')
    purchase_orders = db.relationship('PurchaseOrder', back_populates='material')
    
    def __repr__(self):
        return f'<Material {self.material_id}>'

class Order(db.Model):
    """訂單主檔"""
    __tablename__ = 'orders'
    
    id = db.Column(db.Integer, primary_key=True)
    order_number = db.Column(db.String(50), unique=True, nullable=False, index=True)
    order_type = db.Column(db.String(20))  # 1/2/6開頭
    
    # 訂單資訊
    customer_name = db.Column(db.String(200))
    product_description = db.Column(db.String(200))
    production_start_date = db.Column(db.Date)
    production_end_date = db.Column(db.Date)
    
    # 外包資訊
    mechanical_outsource = db.Column(db.String(100))
    electrical_outsource = db.Column(db.String(100))
    painting_outsource = db.Column(db.String(100))
    scraping_outsource = db.Column(db.String(100))
    packing_outsource = db.Column(db.String(100))
    
    # 訂單備註與版本
    note = db.Column(db.Text)
    spec_version = db.Column(db.String(50))
    
    # FIFO 優先序
    fifo_priority = db.Column(db.Integer, index=True)
    
    # 系統欄位
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 關聯
    order_materials = db.relationship('OrderMaterial', back_populates='order', cascade='all, delete-orphan')
    order_specs = db.relationship('OrderSpec', back_populates='order', cascade='all, delete-orphan')
    
    def __repr__(self):
        return f'<Order {self.order_number}>'

class OrderMaterial(db.Model):
    """訂單物料需求"""
    __tablename__ = 'order_materials'
    
    id = db.Column(db.Integer, primary_key=True)
    order_number = db.Column(db.String(50), db.ForeignKey('orders.order_number'), nullable=False, index=True)
    material_id = db.Column(db.String(50), db.ForeignKey('materials.material_id'), nullable=False, index=True)
    
    # 需求資訊
    required_quantity = db.Column(db.Numeric(15, 3), nullable=False)
    issued_quantity = db.Column(db.Numeric(15, 3), default=0)
    outstanding_quantity = db.Column(db.Numeric(15, 3), nullable=False)
    required_date = db.Column(db.Date)
    
    # 物料狀態（基於 FIFO）
    material_status = db.Column(db.String(20))  # sufficient, shortage, pending
    allocated_quantity = db.Column(db.Numeric(15, 3), default=0)
    
    # 系統欄位
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 關聯
    order = db.relationship('Order', back_populates='order_materials')
    material = db.relationship('Material', back_populates='order_materials')
    
    def __repr__(self):
        return f'<OrderMaterial {self.order_number}-{self.material_id}>'

class PurchaseOrder(db.Model):
    """採購訂單（已訂未交）"""
    __tablename__ = 'purchase_orders'
    
    id = db.Column(db.Integer, primary_key=True)
    po_number = db.Column(db.String(50), unique=True, nullable=False, index=True)
    material_id = db.Column(db.String(50), db.ForeignKey('materials.material_id'), nullable=False, index=True)
    
    # 🆕 採購單詳細資訊
    supplier = db.Column(db.String(200))  # 供應商/供應工廠
    item_number = db.Column(db.Integer)  # 項目編號
    description = db.Column(db.String(500))  # 短文(物料說明)
    document_date = db.Column(db.Date)  # 文件日期
    document_type = db.Column(db.String(20))  # 採購文件類型
    purchase_group = db.Column(db.String(10))  # 採購群組 (字串以保留前導零)
    plant = db.Column(db.String(10))  # 工廠
    storage_location = db.Column(db.String(10))  # 儲存地點
    
    # 採購資訊
    ordered_quantity = db.Column(db.Numeric(15, 3), nullable=False)
    received_quantity = db.Column(db.Numeric(15, 3), default=0)
    outstanding_quantity = db.Column(db.Numeric(15, 3), nullable=False)
    
    # 🆕 價格資訊
    unit_price = db.Column(db.Numeric(15, 2))  # 淨價
    currency = db.Column(db.String(10))  # 幣別
    total_value = db.Column(db.Numeric(15, 2))  # 仍待交貨值
    
    # 交期資訊
    original_delivery_date = db.Column(db.Date)
    updated_delivery_date = db.Column(db.Date)
    actual_delivery_date = db.Column(db.Date)
    
    # 採購人員
    buyer_id = db.Column(db.String(10), db.ForeignKey('users.id'))
    
    # 狀態
    status = db.Column(db.String(20), default='pending')  # pending, partial, completed, cancelled
    
    # 系統欄位
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 關聯
    material = db.relationship('Material', back_populates='purchase_orders')
    buyer = db.relationship('User', back_populates='purchase_orders')
    
    def __repr__(self):
        return f'<PurchaseOrder {self.po_number}>'

class OrderSpec(db.Model):
    """訂單規格"""
    __tablename__ = 'order_specs'
    
    id = db.Column(db.Integer, primary_key=True)
    order_number = db.Column(db.String(50), db.ForeignKey('orders.order_number'), nullable=False, index=True)
    
    # 規格資訊
    characteristic_number = db.Column(db.String(50))
    characteristic_description = db.Column(db.String(200))
    characteristic_value = db.Column(db.String(100))
    value_description = db.Column(db.String(200))
    
    # 系統欄位
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 關聯
    order = db.relationship('Order', back_populates='order_specs')
    
    def __repr__(self):
        return f'<OrderSpec {self.order_number}>'

class DeliveryUpdate(db.Model):
    """交期更新記錄"""
    __tablename__ = 'delivery_updates'
    
    id = db.Column(db.Integer, primary_key=True)
    po_number = db.Column(db.String(50), nullable=False, index=True)
    material_id = db.Column(db.String(50), nullable=False)
    
    # 交期資訊
    old_delivery_date = db.Column(db.Date)
    new_delivery_date = db.Column(db.Date)
    update_reason = db.Column(db.Text)
    
    # 更新人員
    updated_by = db.Column(db.String(10), db.ForeignKey('users.id'))
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def __repr__(self):
        return f'<DeliveryUpdate {self.po_number}>'

class ComponentRequirement(db.Model):
    """成品工單組件需求明細（比對用）"""
    __tablename__ = 'component_requirements'
    
    id = db.Column(db.Integer, primary_key=True)
    material_id = db.Column(db.String(50), nullable=False, index=True)
    base_material_id = db.Column(db.String(50), index=True)
    description = db.Column(db.String(200))
    note = db.Column(db.String(200))
    
    # 系統欄位
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<ComponentRequirement {self.material_id}>'

class PartDrawingMapping(db.Model):
    """品號-圖號對照表"""
    __tablename__ = 'part_drawing_mappings'
    
    id = db.Column(db.Integer, primary_key=True)
    part_number = db.Column(db.String(50), unique=True, nullable=False, index=True)
    drawing_number = db.Column(db.String(50), nullable=False, index=True)
    
    # 系統欄位
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<PartDrawingMapping {self.part_number}-{self.drawing_number}>'
