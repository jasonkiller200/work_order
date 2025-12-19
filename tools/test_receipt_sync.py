# 測試入庫同步功能
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
        
        # 檢查必要欄位
        required = ['採購單', '項目', '物料', '以輸入單位表示的數量', '過帳日期']
        missing = [c for c in required if c not in df_receipt.columns]
        if missing:
            print(f"✗ 缺少欄位: {missing}")
            return False
        print(f"✓ 所有必要欄位都存在")
        
        # 顯示前3筆
        print("\n前3筆入庫記錄：")
        for i, row in df_receipt.head(3).iterrows():
            po = f"{int(row['採購單'])}-{int(row['項目'])}"
            print(f"  {i+1}. 採購單: {po}, 數量: {row['以輸入單位表示的數量']}")
        
    except Exception as e:
        print(f"✗ 讀取今日入庫失敗: {e}")
        return False
    
    # 測試已訂未交
    try:
        df_on_order = pd.read_excel(FilePaths.ON_ORDER_FILE)
        print(f"\n✓ 已訂未交: 成功讀取 {len(df_on_order)} 筆")
        
        # 建立採購單號集合
        po_numbers = set()
        for _, row in df_on_order.head(3).iterrows():
            po = f"{int(row['採購文件'])}-{int(row['項目'])}"
            po_numbers.add(po)
            print(f"  範例: {po}")
        
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
        from app.models.database import db, PurchaseOrder
        from app import create_app
        
        app = create_app()
        with app.app_context():
            # 查詢採購單數量
            total_pos = PurchaseOrder.query.count()
            pending_pos = PurchaseOrder.query.filter(
                PurchaseOrder.status.in_(['pending', 'partial'])
            ).count()
            
            print(f"✓ 資料庫連線成功")
            print(f"✓ 總採購單數: {total_pos}")
            print(f"✓ 未完成採購單: {pending_pos}")
            
            # 顯示幾筆未完成的採購單
            pos = PurchaseOrder.query.filter(
                PurchaseOrder.status.in_(['pending', 'partial'])
            ).limit(3).all()
            
            print("\n未完成採購單範例：")
            for po in pos:
                print(f"  - {po.po_number}: 已收 {po.received_quantity}/{po.ordered_quantity}, 狀態: {po.status}")
            
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
        from app.models.database import db, PurchaseOrder
        from app import create_app
        from decimal import Decimal
        from collections import defaultdict
        
        app = create_app()
        with app.app_context():
            df_receipt = pd.read_excel(FilePaths.RECEIPT_FILE)
            
            found_count = 0
            not_found_count = 0
            would_complete = 0
            would_partial = 0
            already_completed = 0
            
            # 統計資訊
            material_stats = defaultdict(lambda: {'count': 0, 'qty': Decimal('0')})
            po_status_distribution = defaultdict(int)
            not_found_pos = []
            complete_pos = []
            partial_pos = []
            
            print(f"處理全部 {len(df_receipt)} 筆入庫記錄...\n")
            
            for i, row in df_receipt.iterrows():
                try:
                    # 檢查必要欄位是否為空
                    if pd.isna(row['採購單']) or pd.isna(row['項目']):
                        continue
                    
                    po_number = f"{int(row['採購單'])}-{int(row['項目'])}"
                    receipt_qty = Decimal(str(float(row['以輸入單位表示的數量'])))
                    material_id = str(row['物料']).strip() if pd.notna(row['物料']) else 'N/A'
                except (ValueError, TypeError):
                    # 跳過無效記錄
                    continue
                
                po = PurchaseOrder.query.filter_by(po_number=po_number).first()
                
                if po:
                    found_count += 1
                    po_status_distribution[po.status] += 1
                    
                    # 統計物料
                    material_stats[material_id]['count'] += 1
                    material_stats[material_id]['qty'] += receipt_qty
                    
                    new_received = (po.received_quantity or Decimal('0')) + receipt_qty
                    new_outstanding = po.ordered_quantity - new_received
                    
                    if po.status == 'completed':
                        already_completed += 1
                    elif new_outstanding <= Decimal('0.01'):
                        would_complete += 1
                        complete_pos.append({
                            'po': po_number,
                            'material': material_id,
                            'qty': receipt_qty,
                            'old_status': po.status
                        })
                    else:
                        would_partial += 1
                        partial_pos.append({
                            'po': po_number,
                            'material': material_id,
                            'qty': receipt_qty,
                            'remaining': new_outstanding
                        })
                else:
                    not_found_count += 1
                    not_found_pos.append({
                        'po': po_number,
                        'material': material_id,
                        'qty': receipt_qty
                    })
                
                # 每 100 筆顯示進度
                if (i + 1) % 100 == 0:
                    print(f"  處理進度: {i + 1}/{len(df_receipt)} ({(i+1)/len(df_receipt)*100:.1f}%)")
            
            # 顯示統計結果
            print("\n" + "=" * 60)
            print("📊 統計摘要")
            print("=" * 60)
            print(f"總入庫記錄數: {len(df_receipt)}")
            print(f"找到採購單: {found_count} ({found_count/len(df_receipt)*100:.1f}%)")
            print(f"找不到採購單: {not_found_count} ({not_found_count/len(df_receipt)*100:.1f}%)")
            print(f"\n預期結果：")
            print(f"  ✅ 完全結案: {would_complete}")
            print(f"  📦 部分交貨: {would_partial}")
            print(f"  ⏭️  已完成(無需處理): {already_completed}")
            
            # 採購單狀態分布
            print(f"\n📈 匹配到的採購單狀態分布：")
            for status, count in sorted(po_status_distribution.items()):
                print(f"  {status}: {count}")
            
            # 前 10 筆將完全結案的採購單
            if complete_pos:
                print(f"\n✅ 前 10 筆將完全結案的採購單：")
                for item in complete_pos[:10]:
                    print(f"  {item['po']}: 收貨 {item['qty']}, 原狀態: {item['old_status']}")
            
            # 前 10 筆部分交貨的採購單
            if partial_pos:
                print(f"\n📦 前 10 筆部分交貨的採購單：")
                for item in partial_pos[:10]:
                    print(f"  {item['po']}: 收貨 {item['qty']}, 剩餘 {item['remaining']}")
            
            # 前 20 筆找不到的採購單
            if not_found_pos:
                print(f"\n⚠️  前 20 筆找不到的採購單：")
                for item in not_found_pos[:20]:
                    print(f"  {item['po']}: 物料 {item['material']}, 數量 {item['qty']}")
            
            # 物料統計 (前 10 名)
            print(f"\n📦 入庫物料統計 (前 10 名，依數量排序)：")
            sorted_materials = sorted(
                material_stats.items(), 
                key=lambda x: x[1]['qty'], 
                reverse=True
            )[:10]
            for material_id, stats in sorted_materials:
                print(f"  {material_id}: {stats['count']} 筆, 總量 {stats['qty']}")
            
            # 匯出詳細清單
            export_choice = input("\n是否匯出詳細清單到 CSV？(y/n): ").strip().lower()
            if export_choice == 'y':
                # 匯出找不到的採購單
                if not_found_pos:
                    df_not_found = pd.DataFrame(not_found_pos)
                    df_not_found.to_csv('入庫記錄_找不到採購單.csv', index=False, encoding='utf-8-sig')
                    print(f"  ✓ 已匯出: 入庫記錄_找不到採購單.csv ({len(not_found_pos)} 筆)")
                
                # 匯出將完全結案的
                if complete_pos:
                    df_complete = pd.DataFrame(complete_pos)
                    df_complete.to_csv('入庫記錄_將完全結案.csv', index=False, encoding='utf-8-sig')
                    print(f"  ✓ 已匯出: 入庫記錄_將完全結案.csv ({len(complete_pos)} 筆)")
                
                # 匯出部分交貨的
                if partial_pos:
                    df_partial = pd.DataFrame(partial_pos)
                    df_partial.to_csv('入庫記錄_部分交貨.csv', index=False, encoding='utf-8-sig')
                    print(f"  ✓ 已匯出: 入庫記錄_部分交貨.csv ({len(partial_pos)} 筆)")
            
            return True
    except Exception as e:
        print(f"✗ 模擬執行失敗: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    print("\n🧪 入庫同步功能測試\n")
    
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
