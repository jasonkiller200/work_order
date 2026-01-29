# app/services/work_order_stats_service.py
# 工單詳情統計服務

import logging
import os
import pandas as pd
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
        """載入半品總表（從 URL 下載或本地檔案），5分鐘快取"""
        # 檢查快取
        if cls._semi_finished_cache['last_loaded']:
            elapsed = (get_taiwan_time() - cls._semi_finished_cache['last_loaded']).total_seconds()
            if elapsed < 300 and cls._semi_finished_cache['data'] is not None:
                return cls._semi_finished_cache['data']
        
        # 嘗試導入 requests
        try:
            import requests
            has_requests = True
        except ImportError:
            has_requests = False
            app_logger.warning("工單統計：requests 模組未安裝，將使用本地檔案")
        
        df = None
        
        # 嘗試從 URL 下載
        if has_requests:
            try:
                bookname = Config.WORK_ORDER_BOOK_NAME
                base_url = Config.WORK_ORDER_DOWNLOAD_URL
                url = f"{base_url}{bookname}"
                
                app_logger.info(f"工單統計：正在從 URL 下載半品總表: {url}")
                
                response = requests.get(url, timeout=30)
                response.raise_for_status()
                
                excel_data = BytesIO(response.content)
                df = pd.read_excel(excel_data, sheet_name='半品總表')
                
            except Exception as e:
                app_logger.error(f"載入半品總表失敗: {e}")
                has_requests = False  # 觸發本地檔案讀取
        
        # 如果沒有 requests 或下載失敗，使用本地檔案
        if not has_requests or df is None:
            local_path = FilePaths.WORK_ORDER_SUMMARY_FILE
            if os.path.exists(local_path):
                app_logger.info(f"工單統計：使用本地檔案: {local_path}")
                try:
                    df = pd.read_excel(local_path, sheet_name='半品總表')
                except Exception as e:
                    app_logger.error(f"讀取本地半品總表失敗: {e}")
                    cls._semi_finished_cache['data'] = {}
                    cls._semi_finished_cache['last_loaded'] = get_taiwan_time()
                    return {}
            else:
                app_logger.error(f"本地檔案不存在: {local_path}")
                cls._semi_finished_cache['data'] = {}
                cls._semi_finished_cache['last_loaded'] = get_taiwan_time()
                return {}
        
        if df is None:
            cls._semi_finished_cache['data'] = {}
            cls._semi_finished_cache['last_loaded'] = get_taiwan_time()
            return {}
        
        try:
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
                
                # 檢查成品工單號碼是否為空
                finished_order = str(row.get('成品工單號碼', '')) if pd.notna(row.get('成品工單號碼')) else ''
                
                if finished_order:  # 成品工單號碼不為空
                    result[order_id] = {
                        '品名': str(row.get('品號說明', '')) if pd.notna(row.get('品號說明')) else '',
                        '對應成品': finished_order,
                        '機型': str(row.get('品號說明.1', '')) if pd.notna(row.get('品號說明.1')) else '',
                        '成品出貨日': row['生產結束.1'].strftime('%Y-%m-%d') if pd.notna(row.get('生產結束.1')) else '',
                        '在半品總表': True
                    }
                else:  # 成品工單號碼為空，使用訂單號碼和客戶名稱
                    result[order_id] = {
                        '品名': str(row.get('品號說明', '')) if pd.notna(row.get('品號說明')) else '',
                        '對應成品': str(row.get('訂單號碼', '')) if pd.notna(row.get('訂單號碼')) else '',
                        '機型': str(row.get('客戶名稱', '')) if pd.notna(row.get('客戶名稱')) else '',
                        '成品出貨日': row['生產結束.1'].strftime('%Y-%m-%d') if pd.notna(row.get('生產結束.1')) else '',
                        '在半品總表': True
                    }
            
            cls._semi_finished_cache['data'] = result
            cls._semi_finished_cache['last_loaded'] = get_taiwan_time()
            
            app_logger.info(f"半品總表載入成功，共 {len(result)} 筆工單")
            return result
            
        except Exception as e:
            app_logger.error(f"載入半品總表失敗: {e}", exc_info=True)
            return cls._semi_finished_cache['data'] or {}
    
    @classmethod
    def get_work_order_statistics(cls, page=1, per_page=50, search='', sort_by='需求日期', sort_order='asc', order_type='semi'):
        """
        取得工單統計資料
        
        參數：
        - order_type: 'semi' = 半品工單 (demand_details_map), 'finished' = 成品工單 (finished_demand_details_map)
        
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
            
            # 🆕 根據 order_type 選擇資料來源
            if order_type == 'finished':
                demand_details_map = current_data.get('finished_demand_details_map', {})
            else:
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
            
            # 🆕 取得工單總表資訊（用於成品工單）
            order_summary_map = current_data.get('order_summary_map', {})
            
            orders_list = []
            
            # 🆕 根據 order_type 處理不同邏輯
            if order_type == 'finished':
                # === 成品工單處理 (1 開頭) ===
                for order_id, stats in order_stats.items():
                    # 只處理 1 開頭的成品工單
                    if not order_id.startswith('1'):
                        continue
                    
                    # 從工單總表取得資訊
                    order_info = order_summary_map.get(order_id, {})
                    
                    orders_list.append({
                        '工單號碼': order_id,
                        '訂單號碼': order_info.get('訂單號碼', ''),
                        '下單客戶名稱': order_info.get('下單客戶名稱', ''),
                        '物料品號': order_info.get('物料品號', ''),  # 🔧 從工單總表取得
                        '品號說明': order_info.get('物料說明', ''),
                        '生產開始': order_info.get('生產開始', ''),
                        '生產結束': order_info.get('生產結束', ''),
                        '廠別': order_info.get('廠別', '一廠'),  # 🆕 新增廠別欄位
                        '缺料數': stats.get('total_material_count', 0),  # 總物料數
                        '缺料筆數': stats.get('shortage_count', 0),
                        '需求日期': stats.get('earliest_date', '')  # 兼容舊邏輯
                    })
            else:
                # === 半品工單處理 (2/6 開頭) ===
                for order_id, stats in order_stats.items():
                    # 篩選 2 開頭和 6 開頭
                    if not (order_id.startswith('2') or order_id.startswith('6')):
                        continue
                    
                    # 從半品總表取得對應資訊
                    semi_info = semi_finished_map.get(order_id, {})
                    
                    # 判斷是否在半品總表內
                    if semi_info.get('在半品總表'):
                        # 在半品總表內，使用半品總表的資訊
                        orders_list.append({
                            '工單號碼': order_id,
                            '品名': semi_info.get('品名', ''),
                            '需求日期': stats.get('earliest_date', ''),  # 使用元件需求日期
                            '缺料筆數': stats.get('shortage_count', 0),
                            '對應成品': semi_info.get('對應成品', ''),
                            '機型': semi_info.get('機型', ''),
                            '成品出貨日': semi_info.get('成品出貨日', '')
                        })
                    else:
                        # 不在半品總表內，機型顯示"預備用料"
                        orders_list.append({
                            '工單號碼': order_id,
                            '品名': '',
                            '需求日期': stats.get('earliest_date', ''),
                            '缺料筆數': stats.get('shortage_count', 0),
                            '對應成品': '',
                            '機型': '預備用料',
                            '成品出貨日': ''
                        })
            
            # 搜尋過濾
            if search:
                search_lower = search.lower()
                if order_type == 'finished':
                    # 成品工單搜尋欄位
                    orders_list = [
                        o for o in orders_list
                        if search_lower in o['工單號碼'].lower() or
                           search_lower in str(o.get('訂單號碼', '')).lower() or
                           search_lower in str(o.get('下單客戶名稱', '')).lower() or
                           search_lower in str(o.get('品號說明', '')).lower()
                    ]
                else:
                    # 半品工單搜尋欄位
                    orders_list = [
                        o for o in orders_list
                        if search_lower in o['工單號碼'].lower() or
                           search_lower in str(o.get('品名', '')).lower() or
                           search_lower in str(o.get('機型', '')).lower() or
                           search_lower in str(o.get('對應成品', '')).lower()
                    ]
            
            # 排序
            sort_key_map = {
                '需求日期': '需求日期',
                '半品工單號碼': '工單號碼',
                '工單號碼': '工單號碼',
                '缺料筆數': '缺料筆數',
                '成品出貨日': '成品出貨日',
                '生產開始': '生產開始',  # 成品工單排序
                '生產結束': '生產結束'
            }
            sort_key = sort_key_map.get(sort_by, '需求日期' if order_type != 'finished' else '生產開始')
            reverse = (sort_order == 'desc')
            
            def sort_func(x):
                val = x.get(sort_key, '')
                if sort_key in ['需求日期', '成品出貨日', '生產開始', '生產結束']:
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
                # 🆕 處理 1 開頭（成品）、2 開頭和 6 開頭（半品）工單
                if not (order_id.startswith('1') or order_id.startswith('2') or order_id.startswith('6')):
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
            
            # 只有需求數量>0且剩餘庫存<0才算缺料
            if qty > 0 and remaining_stock[material_id] < 0:
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
    def get_order_shortage_details(cls, order_id, order_type='semi'):
        """取得特定工單的缺料物料明細（使用跨工單 FIFO 計算）"""
        try:
            current_data = cache_manager.get_current_data()
            
            if not current_data:
                return []
            
            # 🆕 根據 order_type 選擇資料來源
            if order_type == 'finished':
                demand_details_map = current_data.get('finished_demand_details_map', {})
            else:
                demand_details_map = current_data.get('demand_details_map', {})
            
            # 🔧 修正: FIFO 計算時需納入所有 1、2、6 開頭工單，與 _calculate_order_statistics 保持一致
            order_prefix_check = lambda x: x.startswith('1') or x.startswith('2') or x.startswith('6')
            
            inventory_data = current_data.get('inventory_data', [])
            
            # 建立庫存對照表（使用未限制+品檢中）
            inventory_map = {}
            inventory_desc_map = {}
            for item in inventory_data:
                material_id = str(item.get('物料', ''))
                unrestricted = float(item.get('未限制', 0) or 0)
                inspection = float(item.get('品質檢驗中', 0) or 0)
                inventory_map[material_id] = unrestricted + inspection
                inventory_desc_map[material_id] = item.get('物料說明', '')
            
            # 收集所有需求（用於 FIFO 計算）
            all_demands = []
            # 收集該工單的物料資訊
            order_material_info = {}
            
            for material_id, demands in demand_details_map.items():
                if str(material_id).startswith('08'):
                    continue
                    
                for demand in demands:
                    demand_order_id = str(demand.get('訂單', ''))
                    # 🆕 使用動態的工單前綴檢查
                    if not order_prefix_check(demand_order_id):
                        continue
                    
                    mat_id = str(material_id)
                    demand_qty = float(demand.get('未結數量 (EINHEIT)', 0) or 0)
                    demand_date = demand.get('需求日期', '')
                    mat_desc = demand.get('物料說明', '') or inventory_desc_map.get(mat_id, '')
                    
                    all_demands.append({
                        'order_id': demand_order_id,
                        'material_id': mat_id,
                        'quantity': demand_qty,
                        'date': demand_date
                    })
                    
                    # 如果是目標工單，記錄物料資訊
                    if demand_order_id == order_id:
                        if mat_id not in order_material_info:
                            order_material_info[mat_id] = {
                                '物料': mat_id,
                                '物料說明': mat_desc,
                                '需求數量': demand_qty,
                                '需求日期': demand_date
                            }
                        else:
                            order_material_info[mat_id]['需求數量'] += demand_qty
                            if demand_date and (not order_material_info[mat_id]['需求日期'] or demand_date < order_material_info[mat_id]['需求日期']):
                                order_material_info[mat_id]['需求日期'] = demand_date
                            if not order_material_info[mat_id]['物料說明'] and mat_desc:
                                order_material_info[mat_id]['物料說明'] = mat_desc
            
            # FIFO 排序：依需求日期，再依工單號碼
            all_demands.sort(key=lambda x: (x['date'] or 'zzzz', x['order_id']))
            
            # 跨工單 FIFO 計算每個物料的庫存消耗
            remaining_stock = inventory_map.copy()
            shortage_materials = set()  # 該工單的缺料物料
            
            for demand in all_demands:
                mat_id = demand['material_id']
                qty = demand['quantity']
                
                current_stock = remaining_stock.get(mat_id, 0)
                remaining_stock[mat_id] = current_stock - qty
                
                # 如果是目標工單、需求數量>0、且剩餘庫存<0，則該物料缺料
                if demand['order_id'] == order_id and qty > 0 and remaining_stock[mat_id] < 0:
                    shortage_materials.add(mat_id)
            
            # 組建回傳資料
            result = []
            
            # 🆕 直接從資料庫查詢所有相關物料的交期排程（不依賴儀表板快取）
            from app.models.database import DeliverySchedule
            
            # 取得所有需要查詢的物料 ID
            material_ids_to_query = list(order_material_info.keys())
            
            # 從資料庫查詢這些物料的交期排程
            delivery_map = {}
            if material_ids_to_query:
                try:
                    schedules = DeliverySchedule.query.filter(
                        DeliverySchedule.material_id.in_(material_ids_to_query),
                        DeliverySchedule.status.notin_(['completed', 'cancelled'])
                    ).all()
                    
                    for s in schedules:
                        mat_id = s.material_id
                        if mat_id not in delivery_map:
                            delivery_map[mat_id] = []
                        delivery_map[mat_id].append({
                            'expected_date': s.expected_date.strftime('%Y-%m-%d') if s.expected_date else '',
                            'quantity': float(s.quantity - (s.received_quantity or 0)),
                            'po_number': s.po_number  # 可能為 None（無綁定採購單）
                        })
                    
                    app_logger.info(f"工單統計：從資料庫查詢到 {len(schedules)} 筆交期排程，涵蓋 {len(delivery_map)} 個物料")
                except Exception as e:
                    app_logger.error(f"工單統計：查詢交期排程失敗: {e}")
            
            # 🆕 從儀表板取得採購人員資料
            if order_type == 'finished':
                procurement_data = current_data.get('finished_dashboard', [])
            else:
                procurement_data = current_data.get('materials_dashboard', [])
            
            procurement_map = {}
            for item in procurement_data:
                material_id = str(item.get('物料', ''))
                if material_id:
                    procurement_map[material_id] = {
                        '採購人員': item.get('採購人員', '')
                    }
            
            app_logger.info(f"工單統計：建立採購對照表，共 {len(procurement_map)} 筆")
            
            for mat_id, mat_data in order_material_info.items():
                available = inventory_map.get(mat_id, 0)
                unrestricted = 0
                inspection = 0
                mat_desc = mat_data['物料說明']  # 先使用 demand 中的物料說明
                
                # 從庫存資料中查詢並補充資訊
                for item in inventory_data:
                    if str(item.get('物料', '')) == mat_id:
                        unrestricted = float(item.get('未限制', 0) or 0)
                        inspection = float(item.get('品質檢驗中', 0) or 0)
                        # 如果 demand 中沒有物料說明，從庫存資料補充
                        if not mat_desc:
                            mat_desc = item.get('物料說明', '')
                        break
                
                is_shortage = mat_id in shortage_materials
                
                # 從採購儀表板取得採購人員
                procurement_info = procurement_map.get(mat_id, {})
                buyer = procurement_info.get('採購人員', '') or '-'
                
                # 🆕 從資料庫查詢的 delivery_map 取得預計交貨日（最早的一筆）
                mat_deliveries = delivery_map.get(mat_id, [])
                expected_delivery = '-'
                if mat_deliveries:
                    # 按日期排序，取最早的
                    dates = [d['expected_date'] for d in mat_deliveries if d.get('expected_date')]
                    if dates:
                        expected_delivery = min(dates)
                
                # Debug: 記錄第一筆物料的查詢結果
                if len(result) == 0:
                    app_logger.info(f"工單統計：第一筆物料 {mat_id} 的採購資訊 - 採購人員: {buyer}, 預計交貨日: {expected_delivery}")
                    app_logger.info(f"工單統計：delivery_map 中是否有此物料: {mat_id in delivery_map}")
                
                result.append({
                    '物料': mat_id,
                    '物料說明': mat_desc,  # 使用補充後的物料說明
                    '需求數量': mat_data['需求數量'],
                    '可用庫存': available,
                    '未限制': unrestricted,
                    '品檢中': inspection,
                    '是否缺料': is_shortage,
                    '需求日期': mat_data['需求日期'],
                    '採購人員': buyer,
                    '預計交貨日': expected_delivery
                })
            
            # 排序：缺料的排前面
            result.sort(key=lambda x: (not x['是否缺料'], x['物料']))
            
            return result
            
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
    def get_all_data_for_export(cls, search='', order_type='semi', sort_by='需求日期', sort_order='asc'):
        """取得所有資料供 Excel 匯出"""
        result = cls.get_work_order_statistics(
            page=1, 
            per_page=10000, 
            search=search, 
            order_type=order_type,
            sort_by=sort_by,
            sort_order=sort_order
        )
        return result.get('data', [])
