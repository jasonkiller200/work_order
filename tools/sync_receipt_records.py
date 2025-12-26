# tools/sync_receipt_records.py
# 同步入庫記錄，與採購單交叉比對

import pandas as pd
import logging
import os
import sys
from datetime import datetime, timedelta

# 加入專案路徑
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.models.database import db, PurchaseOrder, Material, DeliverySchedule
from app.config.paths import FilePaths
from app import create_app

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class ReceiptSyncService:
    """入庫記錄同步服務"""
    
    def __init__(self, receipt_file=None):
        self.receipt_file = receipt_file or FilePaths.RECEIPT_FILE
        self.app = create_app()
    
    def sync_receipts(self):
        """
        同步入庫記錄到資料庫
        
        功能：
        1. 讀取今日入庫 Excel
        2. 更新採購單的 actual_delivery_date
        3. 交叉比對：已訂未交消失 + 有入庫記錄 = 確認完成
        4. 分批交期：自動結案或扣減對應的分批交期 (DeliverySchedule)
        """
        with self.app.app_context():
            try:
                # 讀取入庫記錄
                df_receipt = self._load_receipt_data()
                if df_receipt is None or df_receipt.empty:
                    logger.warning("無入庫記錄")
                    return
                
                logger.info(f"讀取到 {len(df_receipt)} 筆入庫記錄")
                
                # 處理入庫記錄
                stats = self._process_receipts(df_receipt)
                
                # 輸出統計
                logger.info("=" * 60)
                logger.info("入庫同步統計：")
                logger.info(f"  處理記錄數：{stats['total']}")
                logger.info(f"  成功更新：{stats['success']}")
                logger.info(f"  完全結案：{stats['completed']}")
                logger.info(f"  部分交貨：{stats['partial']}")
                logger.info(f"  找不到採購單：{stats['not_found']}")
                logger.info(f"  錯誤數：{stats['error']}")
                logger.info("=" * 60)
                
                return stats
                
            except Exception as e:
                logger.error(f"入庫同步失敗: {e}", exc_info=True)
                return None
    
    def _load_receipt_data(self):
        """載入入庫記錄"""
        if not os.path.exists(self.receipt_file):
            logger.error(f"找不到檔案: {self.receipt_file}")
            return None
        
        try:
            df = pd.read_excel(self.receipt_file)
            
            # 檢查必要欄位
            required_cols = ['採購單', '項目', '物料', '以輸入單位表示的數量', '過帳日期']
            missing_cols = [col for col in required_cols if col not in df.columns]
            if missing_cols:
                logger.error(f"缺少必要欄位: {missing_cols}")
                return None
            
            return df
        except Exception as e:
            logger.error(f"讀取入庫檔案失敗: {e}")
            return None
    
    def _process_receipts(self, df_receipt):
        """處理入庫記錄"""
        stats = {
            'total': 0,
            'success': 0,
            'completed': 0,
            'partial': 0,
            'not_found': 0,
            'error': 0
        }
        
        for index, row in df_receipt.iterrows():
            stats['total'] += 1
            
            try:
                # 檢查必要欄位
                if pd.isna(row['採購單']) or pd.isna(row['項目']):
                    stats['error'] += 1
                    continue
                
                # 建立採購單號（與已訂未交格式一致）
                po_number = f"{int(row['採購單'])}-{int(row['項目'])}"
                material_id = str(row['物料']).strip() if pd.notna(row['物料']) else None
                receipt_qty = float(row['以輸入單位表示的數量'])
                receipt_date = pd.to_datetime(row['過帳日期']).date()
                
                # 查詢採購單
                po = PurchaseOrder.query.filter_by(po_number=po_number).first()
                
                if not po:
                    # 找不到採購單，可能是：
                    # 1. 尚未匯入已訂未交
                    # 2. 採購單已被刪除
                    # 3. 格式不一致
                    logger.debug(f"找不到採購單: {po_number}, 物料: {material_id}")
                    stats['not_found'] += 1
                    continue
                
                # 更新入庫資訊
                result = self._update_purchase_order_receipt(po, receipt_qty, receipt_date)
                
                stats['success'] += 1
                if result == 'completed':
                    stats['completed'] += 1
                elif result == 'partial':
                    stats['partial'] += 1
                
                # 每 100 筆提交一次
                if stats['success'] % 100 == 0:
                    db.session.commit()
                    logger.info(f"已處理 {stats['success']} 筆...")
            
            except Exception as e:
                stats['error'] += 1
                logger.error(f"處理入庫記錄失敗 (行 {index}): {e}")
                continue
        
        # 最後提交
        db.session.commit()
        
        return stats
    
    def _update_purchase_order_receipt(self, po, receipt_qty, receipt_date):
        """
        更新採購單的入庫資訊
        
        Returns:
            'completed': 完全結案
            'partial': 部分交貨
            'updated': 已更新但狀態未變
        """
        from decimal import Decimal
        
        # 累加收貨數量
        old_received = po.received_quantity or Decimal('0')
        po.received_quantity = old_received + Decimal(str(receipt_qty))
        
        # 更新未交數量
        po.outstanding_quantity = po.ordered_quantity - po.received_quantity
        
        # 更新實際交期（如果還沒設定）
        if not po.actual_delivery_date:
            po.actual_delivery_date = receipt_date
        
        # 判斷狀態
        tolerance = Decimal('0.01')  # 允許誤差
        
        if po.outstanding_quantity <= tolerance:
            # 完全結案
            po.status = 'completed'
            po.outstanding_quantity = Decimal('0')
            po.received_quantity = po.ordered_quantity
            
            # 🆕 自動結案或扣減交期分批
            self._reconcile_delivery_schedules(po.material_id, po.po_number, receipt_qty)
            
            logger.info(f"✅ 採購單 {po.po_number} 完全結案 (收貨: {po.received_quantity}/{po.ordered_quantity})")
            return 'completed'
        
        elif po.received_quantity > 0:
            # 部分交貨
            old_status = po.status
            po.status = 'partial'
            
            if old_status != 'partial':
                # 🆕 標記交期部分到貨/扣減數量
                self._reconcile_delivery_schedules(po.material_id, po.po_number, receipt_qty)
                logger.info(f"📦 採購單 {po.po_number} 部分交貨 (收貨: {po.received_quantity}/{po.ordered_quantity})")
            
            return 'partial'
        
        return 'updated'
    
    def _reconcile_delivery_schedules(self, material_id, po_number, receipt_qty):
        """
        對消/更新交期分批
        
        邏輯：
        1. 優先找與該 po_number 相符的、尚未完成的 DeliverySchedule
        2. 按日期先後順序進行扣減
        3. 如果入庫數量 > 某個分批，則該分批 status = 'completed', 剩餘數量去沖下一個分批
        4. 如果入庫數量 < 某個分批，則該分批 received_quantity 增加，status = 'partial'
        """
        try:
            from decimal import Decimal
            remaining_to_deduct = Decimal(str(receipt_qty))
            
            # 撈出該品號相關的、未結案的排程 (優先處理 po_number 相符的)
            schedules = DeliverySchedule.query.filter(
                DeliverySchedule.material_id == material_id,
                DeliverySchedule.status.notin_(['completed', 'cancelled'])
            ).order_by(
                # po_number 相符的优先，然后按日期
                db.case((DeliverySchedule.po_number == po_number, 0), else_=1),
                DeliverySchedule.expected_date
            ).all()
            
            if not schedules:
                return
                
            for s in schedules:
                if remaining_to_deduct <= 0:
                    break
                    
                # 該分批剩餘需要到貨的數量
                s_outstanding = s.quantity - (s.received_quantity or 0)
                
                if s_outstanding <= 0:
                    continue
                    
                if remaining_to_deduct >= s_outstanding:
                    # 完全沖銷此分批
                    remaining_to_deduct -= s_outstanding
                    s.received_quantity = s.quantity
                    s.status = 'completed'
                    logger.info(f"✅ 交期對消: 分批 ID {s.id} ({s.expected_date}) 已完成")
                else:
                    # 部分沖銷此分批
                    s.received_quantity = (s.received_quantity or 0) + remaining_to_deduct
                    s.status = 'partial'
                    logger.info(f"📦 交期對消: 分批 ID {s.id} ({s.expected_date}) 沖銷 {remaining_to_deduct} 件")
                    remaining_to_deduct = 0
            
            # db.session.commit() # 由呼叫者提交
            
        except Exception as e:
            logger.error(f"對消交期失敗: {e}")
    
    
    def cross_validate_with_on_order(self, on_order_file=None):
        """
        交叉比對：已訂未交 vs 入庫記錄
        
        目的：確認採購單消失是否真的已入庫
        
        邏輯：
        1. 從資料庫找出所有 pending/partial 的採購單
        2. 檢查是否在「已訂未交」清單中
        3. 如果不在，但有入庫記錄 → 確認完成
        4. 如果不在，且無入庫記錄 → 標記為異常（需人工確認）
        """
        with self.app.app_context():
            try:
                # 使用預設路徑
                if on_order_file is None:
                    on_order_file = FilePaths.ON_ORDER_FILE
                
                # 讀取已訂未交
                if not os.path.exists(on_order_file):
                    logger.warning(f"找不到已訂未交檔案: {on_order_file}")
                    return
                
                df_on_order = pd.read_excel(on_order_file)
                on_order_po_set = set()
                
                for _, row in df_on_order.iterrows():
                    po_number = f"{int(row['採購文件'])}-{int(row['項目'])}"
                    on_order_po_set.add(po_number)
                
                logger.info(f"已訂未交清單: {len(on_order_po_set)} 筆")
                
                # 查詢所有未完成的採購單
                pending_pos = PurchaseOrder.query.filter(
                    PurchaseOrder.status.in_(['pending', 'partial'])
                ).all()
                
                logger.info(f"資料庫未完成採購單: {len(pending_pos)} 筆")
                
                # 比對
                completed_count = 0
                anomaly_count = 0
                
                for po in pending_pos:
                    if po.po_number not in on_order_po_set:
                        # 不在已訂未交清單中
                        if po.actual_delivery_date:
                            # 有入庫記錄 → 確認完成
                            po.status = 'completed'
                            po.outstanding_quantity = 0
                            po.received_quantity = po.ordered_quantity
                            self._reconcile_delivery_schedules(po.material_id, po.po_number, po.ordered_quantity - (po.received_quantity or 0)) # 補足沖銷
                            completed_count += 1
                            logger.info(f"✅ 交叉驗證完成: {po.po_number}")
                        else:
                            # 無入庫記錄 → 異常
                            logger.warning(f"⚠️ 異常: {po.po_number} 不在已訂未交清單，但無入庫記錄")
                            anomaly_count += 1
                
                db.session.commit()
                
                logger.info("=" * 60)
                logger.info("交叉比對結果：")
                logger.info(f"  確認完成：{completed_count} 筆")
                logger.info(f"  異常記錄：{anomaly_count} 筆")
                logger.info("=" * 60)
                
                return {
                    'completed': completed_count,
                    'anomaly': anomaly_count
                }
            
            except Exception as e:
                logger.error(f"交叉比對失敗: {e}", exc_info=True)
                return None


def main():
    """主執行程式"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='同步入庫記錄',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
預設路徑：
  入庫記錄: {FilePaths.RECEIPT_FILE}
  已訂未交: {FilePaths.ON_ORDER_FILE}

使用範例：
  # 僅同步入庫記錄
  python tools/sync_receipt_records.py
  
  # 同步 + 交叉比對
  python tools/sync_receipt_records.py --cross-validate
        """
    )
    parser.add_argument('--receipt-file', help='自訂入庫記錄檔案路徑')
    parser.add_argument('--cross-validate', action='store_true', help='執行交叉比對')
    parser.add_argument('--on-order-file', help='自訂已訂未交檔案路徑')
    
    args = parser.parse_args()
    
    service = ReceiptSyncService(receipt_file=args.receipt_file)
    
    # 同步入庫記錄
    logger.info("開始同步入庫記錄...")
    stats = service.sync_receipts()
    
    # 交叉比對（可選）
    if args.cross_validate:
        logger.info("\n開始交叉比對...")
        service.cross_validate_with_on_order(on_order_file=args.on_order_file)
    
    logger.info("\n完成！")


if __name__ == '__main__':
    main()
