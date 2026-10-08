# app/services/receipt_sync_service.py
# 入庫記錄同步服務（支援採購單與鑄件訂單）
#
# 設計說明（2026-10-05 改版）：
# - 數量（已收/未交）以「已訂未交 / 鑄件未交」檔案為唯一來源 —
#   資料重載（每 15 分鐘）會從檔案覆蓋，入庫同步不再累加數量。
# - 「今日入庫.xlsx」作為事件觸發器：
#   1. 設定實際交貨日（若尚未設定）
#   2. 以 receipt_applied 表去重（每訂單每日已套用總量），檔案總量變化才算新事件
#   3. 真正有新入庫時執行一次交期排程對帳
# - 避免「同一筆入庫每 15 分鐘被重複處理」造成的數量抖動與排程重複刪除。

import pandas as pd
import logging
import os

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
        同步入庫記錄（事件式，不累加數量）
        
        只處理「過帳日期 = 今天」的記錄；檔案為當日入庫的累計匯出，
        以每訂單今日總量對照 receipt_applied 保證冪等（重開伺服器不會重觸發）。
        
        Returns:
            dict: 同步統計資訊
        """
        from app.models.database import PurchaseOrder, CastingOrder, ReceiptApplied
        from datetime import date
        
        try:
            # 讀取入庫記錄
            df_receipt = self._load_receipt_data()
            if df_receipt is None or df_receipt.empty:
                app_logger.info("入庫同步：無入庫記錄")
                return None
            
            # 只處理今日的入庫記錄
            today = date.today()
            df_receipt['過帳日期_parsed'] = pd.to_datetime(df_receipt['過帳日期']).dt.date
            df_today = df_receipt[df_receipt['過帳日期_parsed'] == today]
            
            if df_today.empty:
                app_logger.info(f"入庫同步：今日 ({today}) 無新入庫記錄，跳過處理")
                return None
            
            app_logger.info(f"入庫同步：讀取到 {len(df_receipt)} 筆入庫記錄，其中今日 ({today}) 有 {len(df_today)} 筆")
            
            # 依訂單分組，累計「今日總入庫量」（檔案若經 SAP 更正，以目前總量為準）
            po_totals = {}   # po_number -> {'material_id': str, 'total': float}
            co_totals = {}   # order_number -> {'material_id': str, 'total': float}
            
            for i, row in df_today.iterrows():
                try:
                    qty = float(row['以輸入單位表示的數量'])
                except (TypeError, ValueError):
                    continue
                
                material_value = row.get('物料')
                po_value = row.get('採購單')
                item_value = row.get('項目')
                order_value = row.get('訂單')
                
                has_material = pd.notna(material_value) and str(material_value).strip() != ''
                has_po = pd.notna(po_value) and pd.notna(item_value)
                
                if has_material and has_po:
                    key = f"{int(row['採購單'])}-{int(row['項目'])}"
                    entry = po_totals.setdefault(key, {'material_id': str(material_value).strip(), 'total': 0.0})
                    entry['total'] += qty
                elif (has_material and not has_po and pd.notna(order_value)
                        and str(order_value).strip().startswith('4')):
                    order_str = str(order_value).strip()
                    # Excel 會把數字訂單號讀成 float（400005625.0）→ 正規化成整數字串
                    try:
                        key = str(int(float(order_str)))
                    except ValueError:
                        key = order_str
                    entry = co_totals.setdefault(key, {'material_id': str(material_value).strip(), 'total': 0.0})
                    entry['total'] += qty
            
            stats = {'baseline': 0, 'new_receipt': 0, 'corrected': 0, 'unchanged': 0, 'not_found': 0}
            
            # ========== 採購單 ==========
            for key, info in po_totals.items():
                po = PurchaseOrder.query.filter_by(po_number=key).first()
                if not po:
                    stats['not_found'] += 1
                    continue
                action = self._process_receipt_event(
                    order_key=key, order=po,
                    material_id=po.material_id or info['material_id'],
                    file_total=info['total'], today=today, set_actual_date=True
                )
                stats[action] += 1
            
            # ========== 鑄件訂單 ==========
            for key, info in co_totals.items():
                co = CastingOrder.query.filter_by(order_number=key).first()
                if not co:
                    stats['not_found'] += 1
                    continue
                action = self._process_receipt_event(
                    order_key=key, order=co,
                    material_id=co.material_id or info['material_id'],
                    file_total=info['total'], today=today, set_actual_date=False
                )
                stats[action] += 1
            
            self.db.session.commit()
            
            app_logger.info("=" * 60)
            app_logger.info("入庫同步（事件式、不累加數量）：")
            app_logger.info(f"新入庫 {stats['new_receipt']} 筆, 基線 {stats['baseline']} 筆, "
                           f"SAP 更正 {stats['corrected']} 筆, 無變化 {stats['unchanged']} 筆, "
                           f"找不到 {stats['not_found']} 筆")
            app_logger.info("=" * 60)
            
            return stats
            
        except Exception as e:
            self.db.session.rollback()
            app_logger.error(f"入庫同步失敗: {e}", exc_info=True)
            return None
    
    def _process_receipt_event(self, order_key, order, material_id, file_total, today, set_actual_date):
        """
        處理單一訂單的入庫事件（以 receipt_applied 表去重、冪等）。
        
        - 今日首次看到（基線）：記錄總量；若訂單已含收貨量
          （此入庫已反映在已訂未交/鑄件未交檔案），觸發一次交期對帳
        - 檔案總量增加：真正新入庫 → 交期對帳
        - 檔案總量減少：SAP 更正 → 只更新，不對帳
        - 總量不變：不做任何事
        
        Returns:
            'baseline' | 'new_receipt' | 'corrected' | 'unchanged'
        """
        from app.models.database import ReceiptApplied
        
        # 設定實際交貨日（僅採購單；冪等）
        if set_actual_date and not order.actual_delivery_date:
            order.actual_delivery_date = today
        
        applied_row = ReceiptApplied.query.filter_by(
            order_key=order_key, receipt_date=today
        ).first()
        
        if applied_row is None:
            self.db.session.add(ReceiptApplied(
                order_key=order_key, receipt_date=today, applied_qty=file_total
            ))
            if (order.received_quantity or 0) > 0:
                self._reconcile_delivery_schedules(material_id)
            return 'baseline'
        
        EPS = 1e-9
        if file_total > applied_row.applied_qty + EPS:
            applied_row.applied_qty = file_total
            # 真正的新入庫：觸發交期排程對帳
            self._reconcile_delivery_schedules(material_id)
            return 'new_receipt'
        elif file_total < applied_row.applied_qty - EPS:
            applied_row.applied_qty = file_total
            return 'corrected'
        return 'unchanged'
    
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
    
    def _reconcile_delivery_schedules(self, material_id):
        """
        入庫時清除該物料最早日期的所有待交期
        
        邏輯：
        1. 找該物料尚未完成的交期中最早的日期
           （排程日期 ∪ 未結案 PO 殘留交期；排程若已被清掉，
            殘留欄位也能被清到）
        2. 刪除該物料在該日期的所有排程（同日期多筆一併清除）
        3. 同時清除該物料未結案 PO 上同一日期的殘留交期
           （避免儀表板 PO fallback 仍顯示舊日期）
        """
        from app.models.database import DeliverySchedule, PurchaseOrder
        
        try:
            # 1. 候選日期：未結排程日期 + 未結案 PO 殘留交期
            sched_dates = {
                r[0] for r in DeliverySchedule.query
                .filter(
                    DeliverySchedule.material_id == material_id,
                    DeliverySchedule.status.notin_(['completed', 'cancelled'])
                )
                .with_entities(DeliverySchedule.expected_date).distinct().all()
            }
            po_dates = {
                r[0] for r in PurchaseOrder.query
                .filter(
                    PurchaseOrder.material_id == material_id,
                    PurchaseOrder.status != 'completed',
                    PurchaseOrder.updated_delivery_date.isnot(None)
                )
                .with_entities(PurchaseOrder.updated_delivery_date).distinct().all()
            }
            all_dates = sched_dates | po_dates
            if not all_dates:
                return
            
            earliest_date = min(all_dates)
            
            # 2. 刪除該物料在該日期的所有排程
            schedules_to_delete = DeliverySchedule.query.filter(
                DeliverySchedule.material_id == material_id,
                DeliverySchedule.expected_date == earliest_date,
                DeliverySchedule.status.notin_(['completed', 'cancelled'])
            ).all()
            
            for schedule in schedules_to_delete:
                app_logger.info(f"🗑️ 刪除交期: 物料 {material_id}, 訂單 {schedule.po_number}, "
                               f"預計 {schedule.expected_date}, 數量 {schedule.quantity}")
                self.db.session.delete(schedule)
            
            if schedules_to_delete:
                app_logger.info(f"📋 物料 {material_id} 共刪除 {len(schedules_to_delete)} 筆排程 (日期: {earliest_date})")
            
            # 3. 清除該物料未結案 PO 上同一日期的殘留交期
            cleared = PurchaseOrder.query.filter(
                PurchaseOrder.material_id == material_id,
                PurchaseOrder.status != 'completed',
                PurchaseOrder.updated_delivery_date == earliest_date
            ).update({'updated_delivery_date': None}, synchronize_session=False)
            
            if cleared:
                app_logger.info(f"🧹 物料 {material_id} 清除 {cleared} 筆 PO 殘留交期 (日期: {earliest_date})")
            
        except Exception as e:
            app_logger.error(f"清除交期失敗: {e}")
    
    def cleanup_orphan_delivery_schedules(self):
        """
        清除孤兒交期：
        1. 採購單/鑄件訂單已不存在，但交期還在
        2. 採購單/鑄件訂單已完成，但交期還在 (新增)
        
        應在每日同步後執行
        """
        from app.models.database import PurchaseOrder, CastingOrder, DeliverySchedule
        
        try:
            deleted_count = 0
            
            # === 1. 清除訂單不存在的孤兒交期 ===
            schedules = DeliverySchedule.query.filter(
                DeliverySchedule.po_number.isnot(None),
                DeliverySchedule.po_number != '',
                DeliverySchedule.status.notin_(['completed', 'cancelled'])
            ).all()
            
            for s in schedules:
                po_number = s.po_number
                
                # 判斷是採購單還是鑄件訂單
                if po_number.startswith('4') and '-' not in po_number:
                    order = CastingOrder.query.filter_by(order_number=po_number).first()
                    order_status = order.status if order else None
                else:
                    order = PurchaseOrder.query.filter_by(po_number=po_number).first()
                    order_status = order.status if order else None
                
                should_delete = False
                delete_reason = ''
                
                if not order:
                    # 訂單不存在
                    should_delete = True
                    delete_reason = '訂單已不存在'
                elif order_status == 'completed':
                    # 訂單已完成，殘留交期也應清除
                    should_delete = True
                    delete_reason = '訂單已完成'
                
                if should_delete:
                    app_logger.info(f"🗑️ 刪除交期: 物料 {s.material_id}, 訂單 {po_number} ({delete_reason})")
                    self.db.session.delete(s)
                    deleted_count += 1
            
            if deleted_count > 0:
                self.db.session.commit()
                app_logger.info(f"共清除 {deleted_count} 筆孤兒/殘留交期")
            
            return deleted_count
            
        except Exception as e:
            self.db.session.rollback()
            app_logger.error(f"清除孤兒交期失敗: {e}", exc_info=True)
            return 0