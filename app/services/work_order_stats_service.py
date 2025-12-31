# app/services/work_order_stats_service.py
# 工單詳情統計服務

import logging
import pandas as pd
import requests
from io import BytesIO
from collections import defaultdict

from app.services.cache_service import cache_manager
from app.config.settings import Config
from app.config import FilePaths
from app.utils.helpers import get_taiwan_time

app_logger = logging.getLogger(__name__)


class WorkOrderStatsService:
    """工單詳情統計服務 - 使用採購儀表板資料 + 半品總表補充資訊"""
    
    # 半品總表快取
    _semi_finished_cache = {
        'data': None,
        'last_loaded': None
    }
    
    @classmethod
    def _load_semi_finished_table(cls):
        """載入半品總表（從 URL 下載），5分鐘快取"""
        # 檢查快取
        if cls._semi_finished_cache['last_loaded']:
            elapsed = (get_taiwan_time() - cls._semi_finished_cache['last_loaded']).total_seconds()
            if elapsed < 300 and cls._semi_finished_cache['data'] is not None:
                return cls._semi_finished_cache['data']
        
        try:
            bookname = Config.WORK_ORDER_BOOK_NAME
            base_url = Config.WORK_ORDER_DOWNLOAD_URL
            url = f"{base_url}{bookname}"
            
            app_logger.info(f"工單統計：正在從 URL 下載半品總表: {url}")
            
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            
            excel_data = BytesIO(response.content)
            df = pd.read_excel(excel_data, sheet_name='半品總表')
            
            # 處理欄位
            df['半品工單號碼'] = df['半品工單號碼'].astype(str)
            
            # 處理物料品號（確保是字串格式）
            if '物料品號' in df.columns:
                df['物料品號'] = df['物料品號'].apply(lambda x: str(int(x)) if pd.notna(x) and isinstance(x, float) else str(x) if pd.notna(x) else '')
            
            # 處理日期欄位
            for date_col in ['生產開始', '生產結束', '生產開始.1', '生產結束.1']:
                if date_col in df.columns:
                    df[date_col] = pd.to_datetime(df[date_col], errors='coerce')
            
            # 篩選 2 開頭和 6 開頭
            df = df[
                df['半品工單號碼'].str.startswith('2') | 
                df['半品工單號碼'].str.startswith('6')
            ]
            
            # 排除標題行
            df = df[~df['半品工單號碼'].str.contains('半品', na=False)]
            
            # 建立以工單號碼為 key 的對照表
            result = {}
            for _, row in df.iterrows():
                order_id = row['半品工單號碼']
                result[order_id] = {
                    '品名': str(row.get('品號說明', '')) if pd.notna(row.get('品號說明')) else '',
                    '需求日期': row['生產開始'].strftime('%Y-%m-%d') if pd.notna(row.get('生產開始')) else '',
                    '對應成品': str(row.get('成品工單號碼', '')) if pd.notna(row.get('成品工單號碼')) else '',
                    '機型': str(row.get('品號說明.1', '')) if pd.notna(row.get('品號說明.1')) else '',
                    '成品出貨日': row['生產結束.1'].strftime('%Y-%m-%d') if pd.notna(row.get('生產結束.1')) else ''
                }
            
            cls._semi_finished_cache['data'] = result
            cls._semi_finished_cache['last_loaded'] = get_taiwan_time()
            
            app_logger.info(f"半品總表載入成功，共 {len(result)} 筆工單")
            return result
            
        except Exception as e:
            app_logger.error(f"載入半品總表失敗: {e}", exc_info=True)
            return cls._semi_finished_cache['data'] or {}
    
    @classmethod
    def get_work_order_statistics(cls, page=1, per_page=50, search='', sort_by='需求日期', sort_order='asc'):
        """
        取得工單統計資料
        
        資料來源：
        - 工單清單和缺料筆數：採購儀表板主儀表板 (demand_details_map)
        - 品名、對應成品、機型、成品出貨日：半品總表
        """
        try:
            current_data = cache_manager.get_current_data()
            
            if not current_data:
                app_logger.warning("工單統計：快取資料尚未載入")
                return {'data': [], 'total': 0, 'page': page, 'per_page': per_page, 'total_pages': 0}
            
            # 載入半品總表
            semi_finished_map = cls._load_semi_finished_table()
            
            # 從主儀表板取得資料
            demand_details_map = current_data.get('demand_details_map', {})
            inventory_data = current_data.get('inventory_data', [])
            
            # 建立庫存對照表
            inventory_map = {}
            for item in inventory_data:
                material_id = str(item.get('物料', ''))
                unrestricted = float(item.get('未限制', 0) or 0)
                inspection = float(item.get('品質檢驗中', 0) or 0)
                inventory_map[material_id] = unrestricted + inspection
            
            # 計算每個工單的缺料筆數
            order_stats = cls._calculate_order_statistics(demand_details_map, inventory_map)
            
            # 合併半品總表資訊
            orders_list = []
            for order_id, stats in order_stats.items():
                # 篩選 2 開頭和 6 開頭
                if not (order_id.startswith('2') or order_id.startswith('6')):
                    continue
                
                # 從半品總表取得對應資訊
                semi_info = semi_finished_map.get(order_id, {})
                
                orders_list.append({
                    '工單號碼': order_id,
                    '品名': semi_info.get('品名', ''),
                    '需求日期': semi_info.get('需求日期', '') or stats.get('earliest_date', ''),
                    '缺料筆數': stats.get('shortage_count', 0),
                    '對應成品': semi_info.get('對應成品', ''),
                    '機型': semi_info.get('機型', ''),
                    '成品出貨日': semi_info.get('成品出貨日', '')
                })
            
            # 搜尋過濾
            if search:
                search_lower = search.lower()
                orders_list = [
                    o for o in orders_list
                    if search_lower in o['工單號碼'].lower() or
                       search_lower in str(o['品名']).lower() or
                       search_lower in str(o['機型']).lower() or
                       search_lower in str(o['對應成品']).lower()
                ]
            
            # 排序
            sort_key_map = {
                '需求日期': '需求日期',
                '半品工單號碼': '工單號碼',
                '工單號碼': '工單號碼',
                '缺料筆數': '缺料筆數',
                '成品出貨日': '成品出貨日'
            }
            sort_key = sort_key_map.get(sort_by, '需求日期')
            reverse = (sort_order == 'desc')
            
            def sort_func(x):
                val = x.get(sort_key, '')
                if sort_key in ['需求日期', '成品出貨日']:
                    return val if val else 'zzzz'
                elif sort_key == '缺料筆數':
                    return -x.get(sort_key, 0) if not reverse else x.get(sort_key, 0)
                return str(val).lower()
            
            orders_list.sort(key=sort_func, reverse=reverse)
            
            total = len(orders_list)
            total_pages = (total + per_page - 1) // per_page if total > 0 else 1
            
            # 分頁
            start_idx = (page - 1) * per_page
            end_idx = start_idx + per_page
            page_data = orders_list[start_idx:end_idx]
            
            return {
                'data': page_data,
                'total': total,
                'page': page,
                'per_page': per_page,
                'total_pages': total_pages
            }
            
        except Exception as e:
            app_logger.error(f"取得工單統計失敗: {e}", exc_info=True)
            return {'data': [], 'total': 0, 'page': page, 'per_page': per_page, 'total_pages': 0}
    
    @classmethod
    def _calculate_order_statistics(cls, demand_details_map, inventory_map):
        """計算每個工單的統計資訊（FIFO 缺料計算）"""
        all_demands = []
        
        for material_id, demands in demand_details_map.items():
            if str(material_id).startswith('08'):
                continue
                
            for demand in demands:
                order_id = str(demand.get('訂單', ''))
                if not (order_id.startswith('2') or order_id.startswith('6')):
                    continue
                    
                all_demands.append({
                    'order_id': order_id,
                    'material_id': str(material_id),
                    'quantity': float(demand.get('未結數量 (EINHEIT)', 0) or 0),
                    'date': demand.get('需求日期', '')
                })
        
        # FIFO 排序
        all_demands.sort(key=lambda x: (x['date'] or 'zzzz', x['order_id']))
        
        remaining_stock = inventory_map.copy()
        order_shortage_materials = defaultdict(set)
        order_earliest_dates = {}
        order_materials = defaultdict(set)
        
        for demand in all_demands:
            order_id = demand['order_id']
            material_id = demand['material_id']
            qty = demand['quantity']
            date = demand['date']
            
            if order_id not in order_earliest_dates or (date and date < order_earliest_dates[order_id]):
                order_earliest_dates[order_id] = date
            
            order_materials[order_id].add(material_id)
            
            current_stock = remaining_stock.get(material_id, 0)
            remaining_stock[material_id] = current_stock - qty
            
            if remaining_stock[material_id] < 0:
                order_shortage_materials[order_id].add(material_id)
        
        result = {}
        all_orders = set(order_earliest_dates.keys()) | set(order_materials.keys())
        
        for order_id in all_orders:
            result[order_id] = {
                'shortage_count': len(order_shortage_materials.get(order_id, set())),
                'earliest_date': order_earliest_dates.get(order_id, ''),
                'total_materials': len(order_materials.get(order_id, set()))
            }
        
        return result
    
    @classmethod
    def get_order_shortage_details(cls, order_id):
        """取得特定工單的缺料物料明細"""
        try:
            current_data = cache_manager.get_current_data()
            
            if not current_data:
                return []
            
            demand_details_map = current_data.get('demand_details_map', {})
            inventory_data = current_data.get('inventory_data', [])
            
            inventory_map = {}
            inventory_desc_map = {}
            for item in inventory_data:
                material_id = str(item.get('物料', ''))
                unrestricted = float(item.get('未限制', 0) or 0)
                inspection = float(item.get('品質檢驗中', 0) or 0)
                inventory_map[material_id] = {
                    'available': unrestricted + inspection,
                    'unrestricted': unrestricted,
                    'inspection': inspection
                }
                inventory_desc_map[material_id] = item.get('物料說明', '')
            
            shortage_materials = cls._calculate_shortage_for_order(order_id, demand_details_map, inventory_map)
            
            order_materials = []
            for material_id, demands in demand_details_map.items():
                if str(material_id).startswith('08'):
                    continue
                    
                for demand in demands:
                    if str(demand.get('訂單', '')) == order_id:
                        inv = inventory_map.get(str(material_id), {'available': 0, 'unrestricted': 0, 'inspection': 0})
                        is_shortage = str(material_id) in shortage_materials
                        
                        order_materials.append({
                            '物料': str(material_id),
                            '物料說明': inventory_desc_map.get(str(material_id), demand.get('物料說明', '')),
                            '需求數量': float(demand.get('未結數量 (EINHEIT)', 0) or 0),
                            '可用庫存': inv['available'],
                            '未限制': inv['unrestricted'],
                            '品檢中': inv['inspection'],
                            '是否缺料': is_shortage,
                            '需求日期': demand.get('需求日期', '')
                        })
            
            seen = set()
            unique_materials = []
            for m in order_materials:
                if m['物料'] not in seen:
                    seen.add(m['物料'])
                    unique_materials.append(m)
            
            unique_materials.sort(key=lambda x: (not x['是否缺料'], x['物料']))
            
            return unique_materials
            
        except Exception as e:
            app_logger.error(f"取得工單缺料明細失敗: {e}", exc_info=True)
            return []
    
    @classmethod
    def _calculate_shortage_for_order(cls, target_order_id, demand_details_map, inventory_map):
        """使用 FIFO 計算特定工單的缺料物料"""
        all_demands = []
        
        for material_id, demands in demand_details_map.items():
            if str(material_id).startswith('08'):
                continue
                
            for demand in demands:
                order_id = str(demand.get('訂單', ''))
                if not (order_id.startswith('2') or order_id.startswith('6')):
                    continue
                    
                all_demands.append({
                    'order_id': order_id,
                    'material_id': str(material_id),
                    'quantity': float(demand.get('未結數量 (EINHEIT)', 0) or 0),
                    'date': demand.get('需求日期', '')
                })
        
        all_demands.sort(key=lambda x: (x['date'] or 'zzzz', x['order_id']))
        
        remaining_stock = {k: v['available'] for k, v in inventory_map.items()}
        shortage_materials = set()
        
        for demand in all_demands:
            order_id = demand['order_id']
            material_id = demand['material_id']
            qty = demand['quantity']
            
            current_stock = remaining_stock.get(material_id, 0)
            remaining_stock[material_id] = current_stock - qty
            
            if order_id == target_order_id and remaining_stock[material_id] < 0:
                shortage_materials.add(material_id)
        
        return shortage_materials
    
    @classmethod
    def get_all_data_for_export(cls, search=''):
        """取得所有資料供 Excel 匯出"""
        result = cls.get_work_order_statistics(page=1, per_page=10000, search=search)
        return result.get('data', [])
