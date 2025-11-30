#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""檢查特定物料的採購人員對應"""

from app import create_app
from app.services.data_service import DataService

if __name__ == '__main__':
    app = create_app()
    
    with app.app_context():
        print("載入資料...")
        data = DataService.load_and_process_data()
        
        if not data:
            print("資料載入失敗")
            exit(1)
        
        # 檢查特定物料
        test_materials = ['1010002873B0', '1010002873A0', '1010002824B1']
        
        print("\n=== 檢查特定物料的採購人員 ===\n")
        
        for material_id in test_materials:
            base_id = material_id[:10]
            print(f"物料: {material_id}")
            print(f"前10碼: {base_id}")
            
            # 在主儀表板中尋找
            found = False
            for item in data['materials_dashboard']:
                if item['物料'] == material_id:
                    buyer = item.get('採購人員', '')
                    print(f"[OK] 在主儀表板找到")
                    print(f"  採購人員: '{buyer}' {' (空白)' if not buyer else ''}")
                    found = True
                    break
            
            if not found:
                # 在成品儀表板中尋找
                for item in data['finished_dashboard']:
                    if item['物料'] == material_id:
                        buyer = item.get('採購人員', '')
                        print(f"[OK] 在成品儀表板找到")
                        print(f"  採購人員: '{buyer}' {' (空白)' if not buyer else ''}")
                        found = True
                        break
            
            if not found:
                print(f"[!!] 在儀表板中未找到此物料")
            
            print()
        
        # 統計採購人員分布
        print("\n=== 採購人員統計 ===\n")
        
        buyer_count = {}
        no_buyer_count = 0
        
        for item in data['materials_dashboard']:
            buyer = item.get('採購人員', '')
            if buyer:
                buyer_count[buyer] = buyer_count.get(buyer, 0) + 1
            else:
                no_buyer_count += 1
        
        print(f"主儀表板總計: {len(data['materials_dashboard'])} 筆")
        print(f"  有採購人員: {len(data['materials_dashboard']) - no_buyer_count} 筆")
        print(f"  無採購人員: {no_buyer_count} 筆")
        
        if buyer_count:
            print(f"\n採購人員分布 (前10名):")
            sorted_buyers = sorted(buyer_count.items(), key=lambda x: x[1], reverse=True)
            for buyer, count in sorted_buyers[:10]:
                print(f"  {buyer}: {count} 筆")
