#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""檢查採購人員欄位"""

from app import create_app
from app.services.data_service import DataService

if __name__ == '__main__':
    app = create_app()
    
    with app.app_context():
        data = DataService.load_and_process_data()
        
        if data and data['materials_dashboard']:
            first_item = data['materials_dashboard'][0]
            print('資料載入成功')
            print(f'總共 {len(data["materials_dashboard"])} 筆資料')
            print(f'\n第一筆資料的欄位:')
            for key in list(first_item.keys())[:15]:
                value = str(first_item[key])[:50] if first_item[key] else ''
                print(f'  - {key}: {value}')
            
            # 檢查採購人員欄位
            has_buyer = '採購人員' in first_item
            print(f'\n採購人員欄位存在: {has_buyer}')
            
            if has_buyer:
                # 統計有採購人員的資料
                with_buyer = sum(1 for item in data['materials_dashboard'] if item.get('採購人員'))
                print(f'有採購人員的資料: {with_buyer} 筆')
                
                # 顯示前5筆有採購人員的資料
                print('\n前5筆有採購人員的資料:')
                count = 0
                for item in data['materials_dashboard']:
                    if item.get('採購人員'):
                        print(f"  物料: {item['物料']}, 採購人員: {item['採購人員']}")
                        count += 1
                        if count >= 5:
                            break
