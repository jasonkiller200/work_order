# 測試入庫同步功能（含鑄件訂單）
import pandas as pd
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.config.paths import FilePaths

def test_files():
    """測試檔案讀取"""
    print("=" * 60)
    print("階段 1: 測試檔案讀取")
    print("=" * 60)
    
    # 測試今日入庫
    try:
        df_receipt = pd.read_excel(FilePaths.RECEIPT_FILE)
        print(f"✓ 今日入庫: 成功讀取 {len(df_receipt)} 筆")
        
        # 顯示所有欄位
        print(f"  欄位: {list(df_receipt.columns)}")
        
        # 檢查必要欄位（採購單邏輯）
        required_po = ['採購單', '項目', '物料', '以輸入單位表示的數量', '過帳日期']
        missing_po = [c for c in required_po if c not in df_receipt.columns]
        if missing_po:
            print(f"⚠️ 缺少採購單欄位: {missing_po}")
        else:
            print(f"✓ 採購單必要欄位都存在")
        
        # 🆕 檢查鑄件訂單欄位
        if '訂單' in df_receipt.columns:
            print(f"✓ 鑄件訂單欄位 '訂單' 存在")
        else:
            print(f"⚠️ 缺少鑄件訂單欄位 '訂單'")
        
        # 🔧 修正分析記錄類型邏輯
        # 採購單：物料有值 + 採購單有值
        po_records = df_receipt[
            (df_receipt['物料'].notna()) & 
            (df_receipt['採購單'].notna())
        ].shape[0]
        
        # 鑄件訂單：物料有值 + 採購單沒值 + 訂單是4開頭
        casting_records = df_receipt[
            (df_receipt['物料'].notna()) & 
            (df_receipt['採購單'].isna()) & 
            (df_receipt['訂單'].notna()) & 
            (df_receipt['訂單'].astype(str).str.startswith('4'))
        ].shape[0] if '訂單' in df_receipt.columns else 0
        
        print(f"\n📊 記錄類型分析：")
        print(f"  採購單入庫: {po_records} 筆 (物料有值 + 採購單有值)")
        print(f"  鑄件訂單入庫: {casting_records} 筆 (物料有值 + 採購單沒值 + 訂單4開頭)")
        
    except Exception as e:
        print(f"✗ 讀取今日入庫失敗: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # 測試已訂未交
    try:
        df_on_order = pd.read_excel(FilePaths.ON_ORDER_FILE)
        print(f"\n✓ 已訂未交: 成功讀取 {len(df_on_order)} 筆")
        
    except Exception as e:
        print(f"✗ 讀取已訂未交失敗: {e}")
        return False
    
    return True

def test_database():
    """測試資料庫連線"""
    print("\n" + "=" * 60)
    print("階段 2: 測試資料庫連線")
    print("=" * 60)
    
    try:
        from app.models.database import db, PurchaseOrder, CastingOrder
        from app import create_app
        
        app = create_app()
        with app.app_context():
            # 查詢採購單數量
            total_pos = PurchaseOrder.query.count()
            pending_pos = PurchaseOrder.query.filter(
                PurchaseOrder.status.in_(['pending', 'partial'])
            ).count()
            
            print(f"✓ 資料庫連線成功")
            print(f"\n[採購單統計]")
            print(f"  總採購單數: {total_pos}")
            print(f"  未完成採購單: {pending_pos}")
            
            # 🆕 查詢鑄件訂單數量
            total_cos = CastingOrder.query.count()
            pending_cos = CastingOrder.query.filter(
                CastingOrder.status.in_(['pending', 'partial'])
            ).count()
            
            print(f"\n[鑄件訂單統計]")
            print(f"  總鑄件訂單數: {total_cos}")
            print(f"  未完成鑄件訂單: {pending_cos}")
            
            # 顯示幾筆未完成的鑄件訂單
            cos = CastingOrder.query.filter(
                CastingOrder.status.in_(['pending', 'partial'])
            ).limit(3).all()
            
            if cos:
                print("\n未完成鑄件訂單範例：")
                for co in cos:
                    print(f"  - {co.order_number}: 物料 {co.material_id}, 已收 {co.received_quantity}/{co.ordered_quantity}")
            
            return True
    except Exception as e:
        print(f"✗ 資料庫連線失敗: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_dry_run():
    """模擬執行（不實際寫入）"""
    print("\n" + "=" * 60)
    print("階段 3: 模擬執行測試 - 全量分析")
    print("=" * 60)
    
    try:
        from app.models.database import db, PurchaseOrder, CastingOrder
        from app import create_app
        from decimal import Decimal
        from collections import defaultdict
        
        app = create_app()
        with app.app_context():
            df_receipt = pd.read_excel(FilePaths.RECEIPT_FILE)
            
            # ========== 採購單統計 ==========
            po_stats = {
                'total': 0,
                'found': 0,
                'not_found': 0,
                'would_complete': 0,
                'would_partial': 0,
                'already_completed': 0
            }
            not_found_pos = []
            complete_pos = []
            partial_pos = []
            
            # ========== 鑄件訂單統計 ==========
            co_stats = {
                'total': 0,
                'found': 0,
                'not_found': 0,
                'would_complete': 0,
                'would_partial': 0,
                'already_completed': 0
            }
            not_found_cos = []
            complete_cos = []
            partial_cos = []
            
            print(f"處理全部 {len(df_receipt)} 筆入庫記錄...\n")
            
            for i, row in df_receipt.iterrows():
                try:
                    receipt_qty = Decimal(str(float(row['以輸入單位表示的數量'])))
                    
                    # 🔧 修正判斷邏輯
                    material_value = row.get('物料')
                    po_value = row.get('採購單')
                    item_value = row.get('項目')
                    order_value = row.get('訂單')
                    
                    has_material = pd.notna(material_value) and str(material_value).strip() != ''
                    has_po = pd.notna(po_value) and pd.notna(item_value)
                    is_casting_order = (
                        has_material and  # 物料欄位必須有值
                        not has_po and    # 採購單欄位沒值
                        pd.notna(order_value) and 
                        str(order_value).startswith('4')
                    )
                    
                    if has_material and has_po:
                        # ========== 採購單邏輯：物料有值 + 採購單有值 ==========
                        po_stats['total'] += 1
                        po_number = f"{int(row['採購單'])}-{int(row['項目'])}"
                        material_id = str(material_value).strip()
                        
                        po = PurchaseOrder.query.filter_by(po_number=po_number).first()
                        
                        if po:
                            po_stats['found'] += 1
                            new_received = (po.received_quantity or Decimal('0')) + receipt_qty
                            new_outstanding = po.ordered_quantity - new_received
                            
                            if po.status == 'completed':
                                po_stats['already_completed'] += 1
                            elif new_outstanding <= Decimal('0.01'):
                                po_stats['would_complete'] += 1
                                complete_pos.append({
                                    'type': '採購單',
                                    'order_number': po_number,
                                    'material': material_id,
                                    'qty': float(receipt_qty),
                                    'old_status': po.status
                                })
                            else:
                                po_stats['would_partial'] += 1
                                partial_pos.append({
                                    'type': '採購單',
                                    'order_number': po_number,
                                    'material': material_id,
                                    'qty': float(receipt_qty),
                                    'remaining': float(new_outstanding)
                                })
                        else:
                            po_stats['not_found'] += 1
                            not_found_pos.append({
                                'type': '採購單',
                                'order_number': po_number,
                                'material': material_id,
                                'qty': float(receipt_qty)
                            })
                    
                    elif is_casting_order:
                        # ========== 🆕 鑄件訂單邏輯 ==========
                        co_stats['total'] += 1
                        order_number = str(order_value).strip()
                        
                        co = CastingOrder.query.filter_by(order_number=order_number).first()
                        
                        if co:
                            co_stats['found'] += 1
                            material_id = co.material_id  # 從鑄件訂單取得 material_id
                            new_received = (co.received_quantity or Decimal('0')) + receipt_qty
                            new_outstanding = co.ordered_quantity - new_received
                            
                            if co.status == 'completed':
                                co_stats['already_completed'] += 1
                            elif new_outstanding <= Decimal('0.01'):
                                co_stats['would_complete'] += 1
                                complete_cos.append({
                                    'type': '鑄件訂單',
                                    'order_number': order_number,
                                    'material': material_id,
                                    'qty': float(receipt_qty),
                                    'old_received': float(co.received_quantity or 0),
                                    'ordered': float(co.ordered_quantity),
                                    'old_status': co.status
                                })
                            else:
                                co_stats['would_partial'] += 1
                                partial_cos.append({
                                    'type': '鑄件訂單',
                                    'order_number': order_number,
                                    'material': material_id,
                                    'qty': float(receipt_qty),
                                    'old_received': float(co.received_quantity or 0),
                                    'ordered': float(co.ordered_quantity),
                                    'remaining': float(new_outstanding)
                                })
                        else:
                            co_stats['not_found'] += 1
                            not_found_cos.append({
                                'type': '鑄件訂單',
                                'order_number': order_number,
                                'qty': float(receipt_qty)
                            })
                
                except (ValueError, TypeError) as e:
                    continue
                
                # 每 100 筆顯示進度
                if (i + 1) % 100 == 0:
                    print(f"  處理進度: {i + 1}/{len(df_receipt)} ({(i+1)/len(df_receipt)*100:.1f}%)")
            
            # ========== 顯示統計結果 ==========
            print("\n" + "=" * 60)
            print("📊 統計摘要")
            print("=" * 60)
            
            # 採購單統計
            print(f"\n[📦 採購單]")
            print(f"  處理記錄數：{po_stats['total']}")
            print(f"  找到採購單：{po_stats['found']}")
            print(f"  找不到採購單：{po_stats['not_found']}")
            print(f"  預期結果：")
            print(f"    ✅ 完全結案：{po_stats['would_complete']}")
            print(f"    📦 部分交貨：{po_stats['would_partial']}")
            print(f"    ⏭️  已完成(無需處理)：{po_stats['already_completed']}")
            
            # 🆕 鑄件訂單統計
            print(f"\n[🔧 鑄件訂單]")
            print(f"  處理記錄數：{co_stats['total']}")
            print(f"  找到鑄件訂單：{co_stats['found']}")
            print(f"  找不到鑄件訂單：{co_stats['not_found']}")
            print(f"  預期結果：")
            print(f"    ✅ 完全結案：{co_stats['would_complete']}")
            print(f"    📦 部分交貨：{co_stats['would_partial']}")
            print(f"    ⏭️  已完成(無需處理)：{co_stats['already_completed']}")
            
            # 顯示範例
            if complete_cos:
                print(f"\n✅ 將完全結案的鑄件訂單 (前 10 筆)：")
                for item in complete_cos[:10]:
                    print(f"  {item['order_number']}: 物料 {item['material']}, 入庫 {item['qty']}, 原狀態 {item['old_status']}")
            
            if partial_cos:
                print(f"\n📦 部分交貨的鑄件訂單 (前 10 筆)：")
                for item in partial_cos[:10]:
                    print(f"  {item['order_number']}: 物料 {item['material']}, 入庫 {item['qty']}, 剩餘 {item['remaining']}")
            
            if not_found_cos:
                print(f"\n⚠️ 找不到的鑄件訂單 (前 10 筆)：")
                for item in not_found_cos[:10]:
                    print(f"  {item['order_number']}: 數量 {item['qty']}")
            
            # ========== 匯出 CSV ==========
            export_choice = input("\n是否匯出詳細清單到 CSV？(y/n): ").strip().lower()
            if export_choice == 'y':
                # 採購單 CSV
                if not_found_pos:
                    df = pd.DataFrame(not_found_pos)
                    df.to_csv('入庫記錄_找不到採購單.csv', index=False, encoding='utf-8-sig')
                    print(f"  ✓ 已匯出: 入庫記錄_找不到採購單.csv ({len(not_found_pos)} 筆)")
                
                if complete_pos:
                    df = pd.DataFrame(complete_pos)
                    df.to_csv('入庫記錄_將完全結案.csv', index=False, encoding='utf-8-sig')
                    print(f"  ✓ 已匯出: 入庫記錄_將完全結案.csv ({len(complete_pos)} 筆)")
                
                if partial_pos:
                    df = pd.DataFrame(partial_pos)
                    df.to_csv('入庫記錄_部分交貨.csv', index=False, encoding='utf-8-sig')
                    print(f"  ✓ 已匯出: 入庫記錄_部分交貨.csv ({len(partial_pos)} 筆)")
                
                # 🆕 鑄件訂單 CSV
                if not_found_cos:
                    df = pd.DataFrame(not_found_cos)
                    df.to_csv('入庫記錄_找不到鑄件訂單.csv', index=False, encoding='utf-8-sig')
                    print(f"  ✓ 已匯出: 入庫記錄_找不到鑄件訂單.csv ({len(not_found_cos)} 筆)")
                
                if complete_cos:
                    df = pd.DataFrame(complete_cos)
                    df.to_csv('入庫記錄_鑄件訂單_將完全結案.csv', index=False, encoding='utf-8-sig')
                    print(f"  ✓ 已匯出: 入庫記錄_鑄件訂單_將完全結案.csv ({len(complete_cos)} 筆)")
                
                if partial_cos:
                    df = pd.DataFrame(partial_cos)
                    df.to_csv('入庫記錄_鑄件訂單_部分交貨.csv', index=False, encoding='utf-8-sig')
                    print(f"  ✓ 已匯出: 入庫記錄_鑄件訂單_部分交貨.csv ({len(partial_cos)} 筆)")
            
            return True
    except Exception as e:
        print(f"✗ 模擬執行失敗: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    print("\n🧪 入庫同步功能測試（含鑄件訂單）\n")
    
    # 階段 1: 檔案讀取
    if not test_files():
        print("\n❌ 檔案讀取測試失敗")
        sys.exit(1)
    
    # 階段 2: 資料庫連線
    if not test_database():
        print("\n❌ 資料庫連線測試失敗")
        sys.exit(1)
    
    # 階段 3: 模擬執行
    if not test_dry_run():
        print("\n❌ 模擬執行測試失敗")
        sys.exit(1)
    
    print("\n" + "=" * 60)
    print("✅ 所有測試通過！")
    print("=" * 60)
    print("\n可以執行正式同步：")
    print("  python tools\\sync_receipt_records.py")
    print("  python tools\\sync_receipt_records.py --cross-validate")
    print()
