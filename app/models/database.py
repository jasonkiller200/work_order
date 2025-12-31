# app/models/database.py
# SQLAlchemy 資料庫模型定義

from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from app.utils.helpers import get_taiwan_time

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
    created_at = db.Column(db.DateTime, default=get_taiwan_time)
    updated_at = db.Column(db.DateTime, default=get_taiwan_time, onupdate=get_taiwan_time)
    
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
    created_at = db.Column(db.DateTime, default=get_taiwan_time)
    updated_at = db.Column(db.DateTime, default=get_taiwan_time, onupdate=get_taiwan_time)
    
    # 關聯
    buyer = db.relationship('User', back_populates='materials')
    order_materials = db.relationship('OrderMaterial', back_populates='material')
    purchase_orders = db.relationship('PurchaseOrder', back_populates='material')
    delivery_schedules = db.relationship('DeliverySchedule', back_populates='material')
    
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
    created_at = db.Column(db.DateTime, default=get_taiwan_time)
    updated_at = db.Column(db.DateTime, default=get_taiwan_time, onupdate=get_taiwan_time)
    
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
    created_at = db.Column(db.DateTime, default=get_taiwan_time)
    updated_at = db.Column(db.DateTime, default=get_taiwan_time, onupdate=get_taiwan_time)
    
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
    created_at = db.Column(db.DateTime, default=get_taiwan_time)
    updated_at = db.Column(db.DateTime, default=get_taiwan_time, onupdate=get_taiwan_time)
    
    # 關聯
    material = db.relationship('Material', back_populates='purchase_orders')
    buyer = db.relationship('User', back_populates='purchase_orders')
    delivery_schedules = db.relationship('DeliverySchedule', back_populates='purchase_order')
    
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
    created_at = db.Column(db.DateTime, default=get_taiwan_time)
    
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
    updated_at = db.Column(db.DateTime, default=get_taiwan_time)
    
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
    created_at = db.Column(db.DateTime, default=get_taiwan_time)
    updated_at = db.Column(db.DateTime, default=get_taiwan_time, onupdate=get_taiwan_time)
    
    def __repr__(self):
        return f'<ComponentRequirement {self.material_id}>'

class PartDrawingMapping(db.Model):
    """品號-圖號對照表"""
    __tablename__ = 'part_drawing_mappings'
    
    id = db.Column(db.Integer, primary_key=True)
    part_number = db.Column(db.String(50), unique=True, nullable=False, index=True)
    drawing_number = db.Column(db.String(50), nullable=False, index=True)
    
    # 系統欄位
    created_at = db.Column(db.DateTime, default=get_taiwan_time)
    updated_at = db.Column(db.DateTime, default=get_taiwan_time, onupdate=get_taiwan_time)
    
    def __repr__(self):
        return f'<PartDrawingMapping {self.part_number}-{self.drawing_number}>'

class DeliverySchedule(db.Model):
    """交期分批排程"""
    __tablename__ = 'delivery_schedules'
    
    id = db.Column(db.Integer, primary_key=True)
    material_id = db.Column(db.String(50), db.ForeignKey('materials.material_id'), nullable=False, index=True)
    po_number = db.Column(db.String(50), db.ForeignKey('purchase_orders.po_number'), nullable=True, index=True)
    
    expected_date = db.Column(db.Date, nullable=False, index=True)
    quantity = db.Column(db.Numeric(15, 3), nullable=False)
    received_quantity = db.Column(db.Numeric(15, 3), default=0)
    
    supplier = db.Column(db.String(100))
    notes = db.Column(db.Text)
    status = db.Column(db.String(20), default='pending')  # pending, partial, completed, cancelled
    
    # 系統欄位
    created_at = db.Column(db.DateTime, default=get_taiwan_time)
    updated_at = db.Column(db.DateTime, default=get_taiwan_time, onupdate=get_taiwan_time)
    
    # 關聯
    material = db.relationship('Material', back_populates='delivery_schedules')
    purchase_order = db.relationship('PurchaseOrder', back_populates='delivery_schedules')
    
    def __repr__(self):
        return f'<DeliverySchedule {self.material_id} - {self.expected_date}>'


class SubstituteNotification(db.Model):
    """替代品通知選擇記錄"""
    __tablename__ = 'substitute_notifications'
    
    id = db.Column(db.Integer, primary_key=True)
    # 主物料 ID (被查詢的物料)
    material_id = db.Column(db.String(50), db.ForeignKey('materials.material_id'), nullable=False, index=True)
    # 被選中的替代物料 ID
    substitute_material_id = db.Column(db.String(50), nullable=False, index=True)
    # 是否啟用通知
    is_notified = db.Column(db.Boolean, default=True)
    # 系統欄位
    created_at = db.Column(db.DateTime, default=get_taiwan_time)
    updated_at = db.Column(db.DateTime, default=get_taiwan_time, onupdate=get_taiwan_time)
    
    # 複合唯一索引：確保每個主物料的每個替代品只有一筆記錄
    __table_args__ = (
        db.UniqueConstraint('material_id', 'substitute_material_id', name='uq_material_substitute'),
    )
    
    def __repr__(self):
        return f'<SubstituteNotification {self.material_id} -> {self.substitute_material_id}>'


class CastingOrder(db.Model):
    """鑄件訂單（鑄件未交）"""
    __tablename__ = 'casting_orders'
    
    id = db.Column(db.Integer, primary_key=True)
    order_number = db.Column(db.String(50), unique=True, nullable=False, index=True)  # 4開頭訂單號
    material_id = db.Column(db.String(50), nullable=False, index=True)  # 物料編號
    
    # 訂單資訊
    description = db.Column(db.String(500))  # 物料說明
    order_type = db.Column(db.String(20))  # 訂單類型 (ZP04)
    ordered_quantity = db.Column(db.Numeric(15, 3), nullable=False)  # 訂單數量
    received_quantity = db.Column(db.Numeric(15, 3), default=0)  # 已交貨數量
    outstanding_quantity = db.Column(db.Numeric(15, 3), nullable=False)  # 未交數量
    
    # 日期資訊
    issue_date = db.Column(db.Date)  # 核發日期（實際）
    start_date = db.Column(db.Date)  # 基本開始日期
    expected_date = db.Column(db.Date)  # 基本完成日期
    create_date = db.Column(db.Date)  # 建立日期
    
    # 其他資訊
    system_status = db.Column(db.String(100))  # 系統狀態
    creator = db.Column(db.String(50))  # 輸入者
    mrp_area = db.Column(db.String(20))  # MRP 範圍
    storage_location = db.Column(db.String(10))  # 儲存地點
    
    # 狀態
    status = db.Column(db.String(20), default='pending')  # pending, partial, completed
    
    # 系統欄位
    created_at = db.Column(db.DateTime, default=get_taiwan_time)
    updated_at = db.Column(db.DateTime, default=get_taiwan_time, onupdate=get_taiwan_time)
    
    def __repr__(self):
        return f'<CastingOrder {self.order_number}>'

