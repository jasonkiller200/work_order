#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""檢查物料採購人員對應"""

from app import create_app
from app.models.material import Material

if __name__ == '__main__':
    app = create_app()
    
    with app.app_context():
        # 檢查特定物料
        material_id = '1010002873B0'
        base_id = material_id[:10]
        
        print(f"檢查物料: {material_id}")
        print(f"前10碼: {base_id}\n")
        
        # 1. 完整物料編號查詢
        m1 = Material.query.filter_by(material_id=material_id).first()
        print(f"完整編號查詢 ({material_id}):")
        if m1:
            print(f"  找到! 採購人員ID: {m1.buyer_id}")
            if m1.buyer:
                print(f"  採購人員: {m1.buyer.full_name}")
        else:
            print(f"  未找到")
        
        print()
        
        # 2. 前10碼查詢
        materials = Material.query.filter(Material.material_id.like(f'{base_id}%')).all()
        print(f"前10碼查詢 ({base_id}%):")
        if materials:
            print(f"  找到 {len(materials)} 筆相關物料:")
            for m in materials[:5]:  # 只顯示前5筆
                buyer_name = m.buyer.full_name if m.buyer else '無'
                print(f"    - {m.material_id}: 採購人員={buyer_name}")
            if len(materials) > 5:
                print(f"    ... 還有 {len(materials) - 5} 筆")
        else:
            print(f"  未找到")
        
        print("\n" + "="*60)
        print("統計資訊:")
        
        # 統計有採購人員的物料數量
        total = Material.query.count()
        with_buyer = Material.query.filter(Material.buyer_id.isnot(None)).count()
        
        print(f"總物料數: {total}")
        print(f"有採購人員的物料: {with_buyer}")
        print(f"無採購人員的物料: {total - with_buyer}")
