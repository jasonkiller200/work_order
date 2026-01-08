# app/services/receipt_sync_service.py
# 入庫記錄同步服務（支援採購單與鑄件訂單）

import pandas as pd
import logging
import os
from decimal import Decimal

app_logger = logging.getLogger(__name__)


class ReceiptSyncService:
    """入庫記錄同步服務"""
    
    def __init__(self, app, db, receipt_file=None):
        self.app = app
        self.db = db
        from app.config.paths import FilePaths
        self.receipt_file = receipt_file or FilePaths.RECEIPT_FILE
    
    def sync_receipts(self):
        """
        同步入庫記錄到資料庫（採購單 + 鑄件訂單）
        
        Returns:
            dict: 同步統計資訊
        """
        from app.models.database import PurchaseOrder, CastingOrder, DeliverySchedule
        
        try:
            # 讀取入庫記錄
            df_receipt = self._load_receipt_data()
            if df_receipt is None or df_receipt.empty:
                app_logger.info("入庫同步：無入庫記錄")
                return None
            
            app_logger.info(f"入庫同步：讀取到 {len(df_receipt)} 筆入庫記錄")
            
            # 統計變數
            po_stats = {
                'total': 0, 'success': 0, 'completed': 0, 
                'partial': 0, 'not_found': 0, 'error': 0
            }
            co_stats = {
                'total': 0, 'success': 0, 'completed': 0, 
                'partial': 0, 'not_found': 0, 'error': 0
            }
            
            for i, row in df_receipt.iterrows():
                try:
                    receipt_qty = Decimal(str(float(row['以輸入單位表示的數量'])))
                    receipt_date = pd.to_datetime(row['過帳日期']).date()
                    
                    # 判斷記錄類型
                    material_value = row.get('物料')
                    po_value = row.get('採購單')
                    item_value = row.get('項目')
                    order_value = row.get('訂單')
                    
                    has_material = pd.notna(material_value) and str(material_value).strip() != ''
                    has_po = pd.notna(po_value) and pd.notna(item_value)
                    is_casting_order = (
                        has_material and
                        not has_po and
                        pd.notna(order_value) and
                        str(order_value).startswith('4')
                    )
                    
                    if has_material and has_po:
                        # ========== 採購單邏輯 ==========
                        po_stats['total'] += 1
                        po_number = f"{int(row['採購單'])}-{int(row['項目'])}"
                        material_id = str(material_value).strip()
                        
                        po = PurchaseOrder.query.filter_by(po_number=po_number).first()
                        
                        if po:
                            result = self._update_purchase_order(po, receipt_qty, receipt_date)
                            po_stats['success'] += 1
                            if result == 'completed':
                                po_stats['completed'] += 1
                            elif result == 'partial':
                                po_stats['partial'] += 1
                        else:
                            po_stats['not_found'] += 1
                    
                    elif is_casting_order:
                        # ========== 鑄件訂單邏輯 ==========
                        co_stats['total'] += 1
                        order_number = str(order_value).strip()
                        
                        co = CastingOrder.query.filter_by(order_number=order_number).first()
                        
                        if co:
                            result = self._update_casting_order(co, receipt_qty)
                            co_stats['success'] += 1
                            if result == 'completed':
                                co_stats['completed'] += 1
                            elif result == 'partial':
                                co_stats['partial'] += 1
                        else:
                            co_stats['not_found'] += 1
                    
                    # 每 100 筆提交一次
                    if (po_stats['success'] + co_stats['success']) % 100 == 0:
                        self.db.session.commit()
                
                except Exception as e:
                    if has_material and has_po:
                        po_stats['error'] += 1
                    elif is_casting_order:
                        co_stats['error'] += 1
                    app_logger.error(f"處理入庫記錄失敗 (行 {i}): {e}")
                    continue
            
            # 最後提交
            self.db.session.commit()
            
            # 輸出統計
            app_logger.info("=" * 60)
            app_logger.info("入庫同步統計：")
            app_logger.info(f"[採購單] 處理: {po_stats['total']}, 成功: {po_stats['success']}, "
                           f"結案: {po_stats['completed']}, 部分: {po_stats['partial']}, "
                           f"找不到: {po_stats['not_found']}")
            app_logger.info(f"[鑄件訂單] 處理: {co_stats['total']}, 成功: {co_stats['success']}, "
                           f"結案: {co_stats['completed']}, 部分: {co_stats['partial']}, "
                           f"找不到: {co_stats['not_found']}")
            app_logger.info("=" * 60)
            
            return {'po_stats': po_stats, 'co_stats': co_stats}
            
        except Exception as e:
            self.db.session.rollback()
            app_logger.error(f"入庫同步失敗: {e}", exc_info=True)
            return None
    
    def _load_receipt_data(self):
        """載入入庫記錄"""
        if not os.path.exists(self.receipt_file):
            app_logger.warning(f"找不到入庫檔案: {self.receipt_file}")
            return None
        
        try:
            df = pd.read_excel(self.receipt_file)
            
            # 檢查必要欄位
            required_cols = ['物料', '以輸入單位表示的數量', '過帳日期']
            missing_cols = [col for col in required_cols if col not in df.columns]
            if missing_cols:
                app_logger.error(f"缺少必要欄位: {missing_cols}")
                return None
            
            return df
        except Exception as e:
            app_logger.error(f"讀取入庫檔案失敗: {e}")
            return None
    
    def _update_purchase_order(self, po, receipt_qty, receipt_date):
        """更新採購單的入庫資訊"""
        from app.models.database import DeliverySchedule
        
        # 累加收貨數量
        old_received = po.received_quantity or Decimal('0')
        po.received_quantity = old_received + receipt_qty
        
        # 更新未交數量
        po.outstanding_quantity = po.ordered_quantity - po.received_quantity
        
        # 更新實際交期
        if not po.actual_delivery_date:
            po.actual_delivery_date = receipt_date
        
        # 判斷狀態
        tolerance = Decimal('0.01')
        
        if po.outstanding_quantity <= tolerance:
            po.status = 'completed'
            po.outstanding_quantity = Decimal('0')
            po.received_quantity = po.ordered_quantity
            self._reconcile_delivery_schedules(po.material_id, po.po_number, receipt_qty)
            return 'completed'
        elif po.received_quantity > 0:
            old_status = po.status
            po.status = 'partial'
            if old_status != 'partial':
                self._reconcile_delivery_schedules(po.material_id, po.po_number, receipt_qty)
            return 'partial'
        
        return 'updated'
    
    def _update_casting_order(self, co, receipt_qty):
        """更新鑄件訂單的入庫資訊"""
        # 累加收貨數量
        old_received = co.received_quantity or Decimal('0')
        co.received_quantity = old_received + receipt_qty
        
        # 更新未交數量
        co.outstanding_quantity = co.ordered_quantity - co.received_quantity
        
        # 判斷狀態
        tolerance = Decimal('0.01')
        
        if co.outstanding_quantity <= tolerance:
            co.status = 'completed'
            co.outstanding_quantity = Decimal('0')
            co.received_quantity = co.ordered_quantity
            self._reconcile_delivery_schedules(co.material_id, co.order_number, receipt_qty)
            return 'completed'
        elif co.received_quantity > 0:
            old_status = co.status
            co.status = 'partial'
            if old_status != 'partial':
                self._reconcile_delivery_schedules(co.material_id, co.order_number, receipt_qty)
            return 'partial'
        
        return 'updated'
    
    def _reconcile_delivery_schedules(self, material_id, order_number, receipt_qty):
        """對消/更新交期分批"""
        from app.models.database import DeliverySchedule
        
        try:
            remaining_to_deduct = receipt_qty
            
            # 撈出該品號相關的、未結案的排程 (優先處理 order_number 相符的)
            schedules = DeliverySchedule.query.filter(
                DeliverySchedule.material_id == material_id,
                DeliverySchedule.status.notin_(['completed', 'cancelled'])
            ).order_by(
                self.db.case((DeliverySchedule.po_number == order_number, 0), else_=1),
                DeliverySchedule.expected_date
            ).all()
            
            if not schedules:
                return
                
            for s in schedules:
                if remaining_to_deduct <= 0:
                    break
                    
                # 該分批剩餘需要到貨的數量
                s_outstanding = Decimal(str(s.quantity)) - Decimal(str(s.received_quantity or 0))
                
                if s_outstanding <= 0:
                    continue
                    
                if remaining_to_deduct >= s_outstanding:
                    remaining_to_deduct -= s_outstanding
                    s.received_quantity = s.quantity
                    s.status = 'completed'
                else:
                    s.received_quantity = Decimal(str(s.received_quantity or 0)) + remaining_to_deduct
                    s.status = 'partial'
                    remaining_to_deduct = 0
            
        except Exception as e:
            app_logger.error(f"對消交期失敗: {e}")
