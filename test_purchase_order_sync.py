"""
測試採購單匯入與物料同步功能
"""

from app import create_app
from app.services.data_service import DataService
from app.models.database import db, Material, PurchaseOrder
from datetime import datetime, timedelta

def test_purchase_order_import():
    """測試採購單匯入功能"""
    app = create_app()
    
    with app.app_context():
        print("=" * 70)
        print("測試採購單匯入與物料同步功能")
        print("=" * 70)
        
        # 1. 檢查初始狀態
        print("\n1. 檢查初始狀態...")
        po_count_before = PurchaseOrder.query.count()
        material_count_before = Material.query.count()
        print(f"   採購單數量: {po_count_before}")
        print(f"   物料數量: {material_count_before}")
        
        # 2. 執行資料載入（會觸發採購單匯入）
        print("\n2. 執行資料載入...")
        try:
            data = DataService.load_and_process_data()
            print("   ✓ 資料載入成功")
        except Exception as e:
            print(f"   ✗ 資料載入失敗: {e}")
            import traceback
            traceback.print_exc()
            return
        
        # 3. 檢查結果
        print("\n3. 檢查結果...")
        po_count_after = PurchaseOrder.query.count()
        material_count_after = Material.query.count()
        print(f"   採購單數量: {po_count_after} (新增 {po_count_after - po_count_before})")
        print(f"   物料數量: {material_count_after} (新增 {material_count_after - material_count_before})")
        
        # 4. 檢查 purchase_group 格式
        print("\n4. 檢查 purchase_group 格式...")
        sample_pos = PurchaseOrder.query.limit(10).all()
        for po in sample_pos:
            print(f"   PO: {po.po_number}, purchase_group: '{po.purchase_group}'")
        
        # 5. 檢查前10碼匹配
        print("\n5. 檢查前10碼匹配（buyer_id 同步）...")
        # 找一個有多個版本的物料
        materials_with_same_base = db.session.query(Material.base_material_id, db.func.count(Material.id))\
            .group_by(Material.base_material_id)\
            .having(db.func.count(Material.id) > 1)\
            .first()
        
        if materials_with_same_base:
            base_id = materials_with_same_base[0]
            related_materials = Material.query.filter_by(base_material_id=base_id).all()
            print(f"   找到 base_material_id: {base_id}，共 {len(related_materials)} 個版本")
            buyer_ids = set([m.buyer_id for m in related_materials if m.buyer_id])
            print(f"   buyer_id: {buyer_ids}")
            if len(buyer_ids) == 1:
                print("   ✓ 所有版本的 buyer_id 一致")
            else:
                print(f"   ⚠ buyer_id 不一致: {buyer_ids}")
        
        # 6. 檢查已刪除採購單的狀態
        print("\n6. 檢查已刪除採購單的狀態...")
        completed_pos = PurchaseOrder.query.filter_by(status='completed').count()
        cancelled_pos = PurchaseOrder.query.filter_by(status='cancelled').count()
        pending_pos = PurchaseOrder.query.filter_by(status='pending').count()
        partial_pos = PurchaseOrder.query.filter_by(status='partial').count()
        print(f"   已完成: {completed_pos}")
        print(f"   已取消: {cancelled_pos}")
        print(f"   待交貨: {pending_pos}")
        print(f"   部分交貨: {partial_pos}")
        
        print("\n" + "=" * 70)
        print("測試完成")
        print("=" * 70)

if __name__ == '__main__':
    test_purchase_order_import()
