import os
import sys
import json
import unittest
from datetime import datetime

# 將專案根目錄加入路徑
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import create_app
from app.models.database import db, PartDrawingMapping
from app.services.data_service import DataService

class TestPartDrawingFeatures(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        self.ctx = self.app.app_context()
        self.ctx.push()

    def tearDown(self):
        self.ctx.pop()

    def test_01_db_model(self):
        """測試資料庫模型"""
        # 建立測試資料
        test_part = "TEST_PART_001"
        test_drawing = "TEST_DRAWING_001"
        
        # 確保不存在
        PartDrawingMapping.query.filter_by(part_number=test_part).delete()
        db.session.commit()
        
        mapping = PartDrawingMapping(part_number=test_part, drawing_number=test_drawing)
        db.session.add(mapping)
        db.session.commit()
        
        # 查詢驗證
        saved = PartDrawingMapping.query.filter_by(part_number=test_part).first()
        self.assertIsNotNone(saved)
        self.assertEqual(saved.drawing_number, test_drawing)
        
        # 清理
        db.session.delete(saved)
        db.session.commit()

    def test_02_api_list(self):
        """測試列表 API"""
        response = self.client.get('/api/part-drawing/list?per_page=5')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('results', data)
        self.assertIn('total', data)
        print(f"API List Total: {data['total']}")

    def test_03_api_search(self):
        """測試單筆查詢 API"""
        # 先確保有資料（使用之前遷移的資料，假設 1010002868 存在）
        part = "1010002868"
        response = self.client.get(f'/api/part-drawing/{part}')
        if response.status_code == 200:
            data = json.loads(response.data)
            self.assertEqual(data['part_number'], part)
            self.assertEqual(data['drawing_number'], "405272")
            print(f"API Search {part} Success: {data['drawing_number']}")

    def test_04_data_service_integration(self):
        """測試 DataService 整合"""
        # 載入資料（這會執行一段時間，因為要讀取 Excel）
        print("正在測試 DataService 資料整合 (讀取 Excel)...")
        data = DataService.load_and_process_data()
        self.assertIsNotNone(data)
        self.assertIn('materials_dashboard', data)
        
        # 檢查是否有任意一筆資料帶有 drawing_number
        materials = data['materials_dashboard']
        samples_with_drawing = [m for m in materials if m.get('drawing_number')]
        print(f"DataService Dashboard 樣本數: {len(materials)}, 帶有圖號數: {len(samples_with_drawing)}")
        
        # 驗證特定品號的圖號（如果存在於儀表板中）
        test_part = "1010002868"
        matching = [m for m in materials if m['物料'] == test_part]
        if matching:
            self.assertEqual(matching[0]['drawing_number'], "405272")
            print(f"DataService 驗證通過: {test_part} -> {matching[0]['drawing_number']}")

if __name__ == '__main__':
    unittest.main()
