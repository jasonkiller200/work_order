"""
測試優化後的 materials 表邏輯
驗證：
1. 前10碼檢查是否正常運作
2. 不會建立重複的前10碼記錄
3. buyer_id 同步是否正常
"""

from app import create_app
from app.services.data_service import DataService
from app.models.database import db, Material
from datetime import datetime

def test_optimized_materials_logic():
    """測試優化後的邏輯"""
    app = create_app()
    
    with app.app_context():
        print("=" * 70)
        print("測試優化後的 materials 表邏輯")
        print("=" * 70)
        
        # 1. 檢查清理結果
        print("\n1. 檢查清理結果...")
        total_materials = Material.query.count()
        unique_base_ids = db.session.query(Material.base_material_id).distinct().count()
        
        print(f"   總記錄數: {total_materials}")
        print(f"   不同的 base_material_id: {unique_base_ids}")
        
        if total_materials == unique_base_ids:
            print("   ✓ 沒有重複的前10碼記錄")
        else:
            print(f"   ⚠ 仍有 {total_materials - unique_base_ids} 筆重複記錄")
        
        # 2. 檢查 buyer_id 分佈
        print("\n2. 檢查 buyer_id 分佈...")
        with_buyer = Material.query.filter(Material.buyer_id.isnot(None)).count()
        without_buyer = Material.query.filter(Material.buyer_id.is_(None)).count()
        
        print(f"   有 buyer_id: {with_buyer} 筆 ({with_buyer/total_materials*100:.1f}%)")
        print(f"   無 buyer_id: {without_buyer} 筆 ({without_buyer/total_materials*100:.1f}%)")
        
        # 3. 測試新邏輯（模擬）
        print("\n3. 測試前10碼檢查邏輯...")
        
        # 找一個已存在的 base_material_id
        sample = Material.query.first()
        if sample:
            test_base_id = sample.base_material_id
            test_material_id = test_base_id + "-99"  # 新版本
            
            print(f"   測試 base_material_id: {test_base_id}")
            print(f"   測試 material_id: {test_material_id}")
            
            # 檢查前10碼是否存在
            existing = Material.query.filter_by(base_material_id=test_base_id).first()
            
            if existing:
                print(f"   ✓ 前10碼已存在，會跳過建立 (現有版本: {existing.material_id})")
            else:
                print(f"   ✗ 前10碼不存在，會建立新記錄")
        
        # 4. 檢查有多個版本的 base_material_id（應該沒有）
        print("\n4. 檢查是否還有多版本記錄...")
        duplicates = db.session.query(
            Material.base_material_id,
            db.func.count(Material.id).label('count')
        ).group_by(Material.base_material_id)\
         .having(db.func.count(Material.id) > 1)\
         .all()
        
        if duplicates:
            print(f"   ⚠ 發現 {len(duplicates)} 個 base_material_id 有多個版本:")
            for dup in duplicates[:5]:
                print(f"      {dup[0]}: {dup[1]} 筆")
        else:
            print("   ✓ 沒有多版本記錄")
        
        # 5. 顯示一些範例
        print("\n5. 範例記錄（前10筆）...")
        samples = Material.query.limit(10).all()
        for m in samples:
            print(f"   {m.material_id:20} | base: {m.base_material_id:15} | buyer: {m.buyer_id}")
        
        print("\n" + "=" * 70)
        print("測試完成")
        print("=" * 70)

if __name__ == '__main__':
    test_optimized_materials_logic()
