#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""測試資料載入與成品撥料分流"""

import logging
from app import create_app
from app.services.data_service import DataService

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

if __name__ == '__main__':
    app = create_app()
    
    with app.app_context():
        print("開始測試資料載入...")
        data = DataService.load_and_process_data()
        
        if data:
            print("\n✓ 資料載入成功！")
            print(f"  - materials_dashboard (主儀表板): {len(data.get('materials_dashboard', []))} 筆")
            print(f"  - finished_dashboard (成品儀表板): {len(data.get('finished_dashboard', []))} 筆")
            print(f"  - demand_details_map: {len(data.get('demand_details_map', {}))} 個物料")
            print(f"  - finished_demand_details_map: {len(data.get('finished_demand_details_map', {}))} 個物料")
            print(f"  - order_details_map: {len(data.get('order_details_map', {}))} 個訂單")
            print(f"  - specs_map: {len(data.get('specs_map', {}))} 個訂單規格")
            print(f"  - order_summary_map: {len(data.get('order_summary_map', {}))} 個工單摘要")
            
            # 檢查成品需求詳情
            if data.get('finished_demand_details_map'):
                print("\n成品需求詳情前5個物料:")
                for i, (material_id, details) in enumerate(list(data['finished_demand_details_map'].items())[:5]):
                    print(f"  {material_id}: {len(details)} 筆訂單需求")
        else:
            print("\n✗ 資料載入失敗！")
