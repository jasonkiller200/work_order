# app/services/data_service.py
# 資料載入與處理服務

import logging
import pandas as pd
import os
from datetime import datetime
from app.models.database import db, ComponentRequirement, Material, User, PurchaseOrder, PartDrawingMapping, DeliverySchedule
from sqlalchemy.orm import joinedload

from app.config import FilePaths
from app.utils.helpers import replace_nan_in_dict, get_taiwan_time

app_logger = logging.getLogger(__name__)

class DataService:
    """資料載入與處理服務"""
    
    @staticmethod
    def load_and_process_data():
        """
        載入並處理所有資料
        
        Returns:
            包含所有處理後資料的字典，失敗則返回 None
        """
        app_logger.info("開始載入與處理資料...")
        try:
            # 載入各個 Excel 檔案
            df_inventory = pd.read_excel(FilePaths.INVENTORY_FILE)
            df_wip_parts = pd.read_excel(FilePaths.WIP_PARTS_FILE)
            df_finished_parts = pd.read_excel(FilePaths.FINISHED_PARTS_FILE)
            df_prep_semi_finished = pd.read_excel(FilePaths.PREP_SEMI_FINISHED_FILE)
            
            # 根據訂單號碼首位數字篩選
            df_wip_parts['訂單'] = df_wip_parts['訂單'].astype(str)
            df_wip_parts = df_wip_parts[df_wip_parts['訂單'].str.startswith(('2', '6'))]
            
            df_finished_parts['訂單'] = df_finished_parts['訂單'].astype(str)
            df_finished_parts = df_finished_parts[df_finished_parts['訂單'].str.startswith(('1', '6'))]
            
            df_prep_semi_finished['訂單'] = df_prep_semi_finished['訂單'].astype(str)
            df_prep_semi_finished = df_prep_semi_finished[df_prep_semi_finished['訂單'].str.startswith(('1', '2', '6'))]
            
            # --- 新增邏輯：讀取資料庫資訊 ---
            # 1. 讀取組件需求明細的 base_material_id 清單
            valid_base_ids = set()
            try:
                valid_base_ids = {r.base_material_id for r in ComponentRequirement.query.all() if r.base_material_id}
                app_logger.info(f"已載入 {len(valid_base_ids)} 筆組件需求明細 (base_material_id)")
            except Exception as e:
                app_logger.error(f"讀取組件需求明細失敗: {e}")

            # 2. 讀取採購人員名稱對應
            buyer_id_to_name_map = {}
            try:
                buyers = User.query.filter_by(role='buyer').all()
                buyer_id_to_name_map = {buyer.id: buyer.full_name for buyer in buyers}
                app_logger.info(f"已載入 {len(buyer_id_to_name_map)} 筆採購人員資料")
            except Exception as e:
                app_logger.error(f"讀取採購人員資料失敗: {e}")

            # 3. 讀取物料與採購人員對應（使用前10碼）
            material_buyer_map = {}
            try:
                materials = Material.query.filter(Material.buyer_id.isnot(None)).all()
                for m in materials:
                    if m.buyer_id and m.base_material_id:
                        # 使用前10碼作為 key，值為採購人員姓名
                        buyer_name = buyer_id_to_name_map.get(m.buyer_id)
                        if buyer_name:
                            material_buyer_map[m.base_material_id] = buyer_name
                        else:
                             # 如果在 User 表中找不到對應的採購人員，直接使用資料庫中的 ID
                             material_buyer_map[m.base_material_id] = m.buyer_id
                app_logger.info(f"已載入 {len(material_buyer_map)} 筆物料採購人員對應 (使用前10碼)")
            except Exception as e:
                app_logger.error(f"讀取物料採購人員對應失敗: {e}")
            
            # 4. 讀取品號-圖號對照表
            part_drawing_map = {}
            try:
                mappings = PartDrawingMapping.query.all()
                part_drawing_map = {m.part_number: m.drawing_number for m in mappings}
                app_logger.info(f"已載入 {len(part_drawing_map)} 筆品號-圖號對照資料")
            except Exception as e:
                app_logger.error(f"讀取品號-圖號對照失敗: {e}")

            # 5. 讀取分批交期排程
            delivery_schedules_map = {}
            try:
                # 只讀取未完成且未取消的交期
                schedules = DeliverySchedule.query.filter(
                    DeliverySchedule.status.notin_(['completed', 'cancelled'])
                ).all()
                for s in schedules:
                    if s.material_id not in delivery_schedules_map:
                        delivery_schedules_map[s.material_id] = []
                    delivery_schedules_map[s.material_id].append({
                        'expected_date': s.expected_date,
                        'quantity': float(s.quantity - (s.received_quantity or 0)),
                        'status': s.status
                    })
                app_logger.info(f"已載入 {len(schedules)} 筆分批交期排程資料")
            except Exception as e:
                app_logger.error(f"讀取分批交期失敗: {e}")
            
            # --- 新增邏輯：成品撥料分流 ---
            # 1. 取得撥料.XLSX 的所有物料前10碼
            wip_base_ids = set(df_wip_parts['物料'].astype(str).str[:10])
            app_logger.info(f"撥料.XLSX 包含 {len(wip_base_ids)} 個不同的前10碼")
            
            # 2. 合併撥料前10碼和組件需求前10碼
            valid_base_ids = valid_base_ids | wip_base_ids
            app_logger.info(f"合併後的有效前10碼: {len(valid_base_ids)} 個")
            
            # 3. 計算成品撥料的 base_material_id
            df_finished_parts['base_material_id'] = df_finished_parts['物料'].astype(str).str[:10]
            
            # 4. 分流：符合條件的 vs 不符合的
            mask_valid = df_finished_parts['base_material_id'].isin(valid_base_ids)
            df_finished_parts_valid = df_finished_parts[mask_valid].copy()
            df_finished_parts_invalid = df_finished_parts[~mask_valid].copy()
            
            app_logger.info(f"成品撥料分流結果: 符合={len(df_finished_parts_valid)}, 不符合={len(df_finished_parts_invalid)}")
            
            # --- 處理主儀表板資料 (撥料 + 符合的成品撥料 + 備料半成品) ---
            df_demand = pd.concat([df_wip_parts, df_finished_parts_valid, df_prep_semi_finished], ignore_index=True)
            
            # 計算總需求
            df_total_demand = df_demand.groupby('物料')['未結數量 (EINHEIT)'].sum().reset_index()
            df_total_demand.rename(columns={'未結數量 (EINHEIT)': 'total_demand'}, inplace=True)
            
            # 建立需求詳情對應表
            df_demand['需求日期'] = pd.to_datetime(df_demand['需求日期'], errors='coerce')
            demand_details_map = df_demand.groupby('物料').apply(
                lambda x: x[['訂單', '未結數量 (EINHEIT)', '需求日期']].to_dict('records'), include_groups=False
            ).to_dict()
            
            # --- 處理成品儀表板資料 (不符合的成品撥料) ---
            df_finished_demand = df_finished_parts_invalid.copy()
            df_total_finished_demand = df_finished_demand.groupby('物料')['未結數量 (EINHEIT)'].sum().reset_index()
            df_total_finished_demand.rename(columns={'未結數量 (EINHEIT)': 'total_demand'}, inplace=True)
            
            # 成品需求詳情
            df_finished_demand['需求日期'] = pd.to_datetime(df_finished_demand['需求日期'], errors='coerce')
            finished_demand_details_map = df_finished_demand.groupby('物料').apply(
                lambda x: x[['訂單', '未結數量 (EINHEIT)', '需求日期']].to_dict('records'), include_groups=False
            ).to_dict()

            # --- 共通處理 ---
            df_specs = pd.read_excel(FilePaths.SPECS_FILE)
            df_work_order_summary = DataService._load_work_order_summary()
            df_on_order = DataService._load_on_order_data()
            
            # 處理在途數量
            df_total_on_order = df_on_order.groupby('物料')['仍待交貨〈數量〉'].sum().reset_index()
            df_total_on_order.rename(columns={'仍待交貨〈數量〉': 'on_order_stock'}, inplace=True)
            
            # 建立主資料表
            df_main = DataService._build_main_dataframe(
                df_total_demand, df_inventory, df_total_on_order, df_demand, material_buyer_map, demand_details_map, part_drawing_map, delivery_schedules_map
            )
            
            # 建立成品資料表
            df_finished_dashboard = DataService._build_main_dataframe(
                df_total_finished_demand, df_inventory, df_total_on_order, df_finished_demand, material_buyer_map, finished_demand_details_map, part_drawing_map, delivery_schedules_map
            )
            
            # 建立訂單詳情對應表 (包含所有成品撥料，以便查詢)
            order_details_map = DataService._build_order_details_map(
                df_wip_parts, df_finished_parts, df_inventory
            )
            
            # 處理規格資料
            specs_map = DataService._build_specs_map(df_specs)
            
            # 提取工單總表摘要資訊
            order_summary_map = DataService._build_order_summary_map(df_work_order_summary)
            
            app_logger.info("資料載入與處理完畢。")
            
            # 清理 NaN 值
            materials_dashboard_cleaned = df_main.fillna('').to_dict(orient='records')
            finished_dashboard_cleaned = df_finished_dashboard.fillna('').to_dict(orient='records')
            specs_data_cleaned = df_specs.fillna('').to_dict(orient='records')
            inventory_data_cleaned = df_inventory.fillna('').to_dict(orient='records')
            demand_details_map_cleaned = replace_nan_in_dict(demand_details_map)
            finished_demand_details_map_cleaned = replace_nan_in_dict(finished_demand_details_map)
            order_details_map_cleaned = replace_nan_in_dict(order_details_map)
            
            # --- 自動同步物料到資料庫 ---
            DataService._sync_materials_to_database(df_demand, df_finished_demand, material_buyer_map)
            
            return {
                "materials_dashboard": materials_dashboard_cleaned,
                "finished_dashboard": finished_dashboard_cleaned, # 新增成品儀表板
                "specs_data": specs_data_cleaned,
                "demand_details_map": demand_details_map_cleaned,
                "finished_demand_details_map": finished_demand_details_map_cleaned, # 新增成品需求詳情
                "order_details_map": order_details_map_cleaned,
                "specs_map": specs_map,
                "order_summary_map": order_summary_map,
                "inventory_data": inventory_data_cleaned  # 新增完整庫存資料
            }
        
        except FileNotFoundError as e:
            app_logger.error(f"錯誤：找不到必要的資料檔案。請確認檔案是否存在且路徑正確：{e.filename}", exc_info=True)
            return None
        except Exception as e:
            app_logger.error(f"處理資料時發生未預期的錯誤: {e}", exc_info=True)
            return None
    
    @staticmethod
    def _load_work_order_summary():
        """載入工單總表"""
        work_order_summary_path = FilePaths.WORK_ORDER_SUMMARY_FILE
        df_work_order_summary = pd.DataFrame()
        
        if os.path.exists(work_order_summary_path):
            try:
                df_work_order_summary = pd.read_excel(
                    work_order_summary_path, 
                    sheet_name=FilePaths.WORK_ORDER_SUMMARY_SHEET
                )
                # 重新命名欄位以匹配預期
                if '品號說明' in df_work_order_summary.columns and '物料說明' not in df_work_order_summary.columns:
                    df_work_order_summary.rename(columns={'品號說明': '物料說明'}, inplace=True)
                app_logger.info(f"DEBUG: df_work_order_summary 欄位: {df_work_order_summary.columns.tolist()}")
            except Exception as e:
                app_logger.error(f"載入 '{work_order_summary_path}' 的 '{FilePaths.WORK_ORDER_SUMMARY_SHEET}' 頁籤時發生錯誤: {e}")
        else:
            app_logger.warning(f"警告：找不到 '{work_order_summary_path}' 檔案。工單摘要資訊將無法載入。")
        
        return df_work_order_summary
    
    @staticmethod
    def _load_on_order_data():
        """載入已訂未交資料並同步到資料庫"""
        on_order_path = FilePaths.ON_ORDER_FILE
        
        if not os.path.exists(on_order_path):
            app_logger.warning("警告：找不到 '已訂未交.XLSX' 檔案。")
            return pd.DataFrame(columns=['物料', '仍待交貨〈數量〉'])
        
        # 讀取 Excel 檔案
        df_on_order = pd.read_excel(on_order_path)
        app_logger.info(f"已讀取 {len(df_on_order)} 筆採購單資料")
        
        # 同步到資料庫
        try:
            DataService._sync_purchase_orders_to_db(df_on_order)
            app_logger.info("採購單同步完成")
        except Exception as e:
            app_logger.error(f"採購單同步失敗: {e}", exc_info=True)
        
        return df_on_order
    
    @staticmethod
    def _build_main_dataframe(df_total_demand, df_inventory, df_total_on_order, df_demand, material_buyer_map=None, demand_details_map=None, part_drawing_map=None, delivery_schedules_map=None):
        """建立主資料表"""
        # 以總需求為基礎，確保所有有需求的物料都被包含
        df_main = df_total_demand.copy()
        
        # 合併庫存資訊
        df_main = pd.merge(
            df_main, 
            df_inventory[['物料', '物料說明', '儲存地點', '基礎計量單位', '未限制', '在途和移轉', '品質檢驗中', '限制使用庫存', '閒置天數']], 
            on='物料', 
            how='left'
        )
        
        # 合併在途數量
        df_main = pd.merge(df_main, df_total_on_order, on='物料', how='left')
        df_main['total_demand'] = df_main['total_demand'].fillna(0)
        df_main['on_order_stock'] = df_main['on_order_stock'].fillna(0)
        
        df_main.rename(columns={'未限制': 'unrestricted_stock', '品質檢驗中': 'inspection_stock'}, inplace=True)
        
        numeric_cols = ['unrestricted_stock', 'inspection_stock', 'total_demand', 'on_order_stock']
        for col in numeric_cols:
            df_main[col] = pd.to_numeric(df_main[col], errors='coerce').fillna(0)
        
        # 計算缺料情況
        df_main['current_shortage'] = df_main['total_demand'] - (df_main['unrestricted_stock'] + df_main['inspection_stock'])
        df_main['projected_shortage'] = df_main['total_demand'] - (df_main['unrestricted_stock'] + df_main['inspection_stock'] + df_main['on_order_stock'])
        df_main['current_shortage'] = df_main['current_shortage'].clip(lower=0)
        df_main['projected_shortage'] = df_main['projected_shortage'].clip(lower=0)
        
        # 計算未來30日內是否有需求缺料
        df_main['shortage_within_30_days'] = DataService._check_shortage_within_days(
            df_main, demand_details_map, delivery_schedules_map, days=30
        )
        
        # 確保物料說明欄位不為空
        df_material_descriptions = df_demand[['物料', '物料說明']].drop_duplicates(subset=['物料'])
        df_main = pd.merge(df_main, df_material_descriptions, on='物料', how='left', suffixes=('', '_demand'))
        df_main['物料說明'] = df_main['物料說明'].fillna(df_main['物料說明_demand'])
        df_main.drop(columns=['物料說明_demand'], inplace=True)
        
        # 排除物料號碼以 '08' 開頭的物料
        df_main = df_main[~df_main['物料'].astype(str).str.startswith('08')]
        df_main['base_material_id'] = df_main['物料'].astype(str).str[:10]
        
        # 加入採購人員資訊（使用前10碼對應）
        if material_buyer_map:
            df_main['採購人員'] = df_main['base_material_id'].map(material_buyer_map).fillna('')
        else:
            df_main['採購人員'] = ''
        
        # 加入圖號資訊
        if part_drawing_map:
            # 嘗試使用完整物料號碼匹配，也嘗試前10碼匹配
            df_main['drawing_number'] = df_main['物料'].map(part_drawing_map)
            
            # 如果還有空的，再嘗試用 base_material_id 匹配
            mask_empty = df_main['drawing_number'].isna()
            df_main.loc[mask_empty, 'drawing_number'] = df_main.loc[mask_empty, 'base_material_id'].map(part_drawing_map)
            
            df_main['drawing_number'] = df_main['drawing_number'].fillna('')
        else:
            df_main['drawing_number'] = ''
        
        return df_main
    
    @staticmethod
    def _build_order_details_map(df_wip_parts, df_finished_parts, df_inventory):
        """建立訂單詳情對應表"""
        df_order_materials = pd.concat([df_wip_parts, df_finished_parts], ignore_index=True)
        df_order_materials = df_order_materials[~df_order_materials['物料'].astype(str).str.startswith('08')]
        df_order_materials = pd.merge(df_order_materials, df_inventory, on='物料', how='left')
        
        df_order_materials.rename(columns={
            '未限制': 'unrestricted_stock',
            '品質檢驗中': 'inspection_stock'
        }, inplace=True)
        
        numeric_cols_order = ['未結數量 (EINHEIT)', 'unrestricted_stock', 'inspection_stock']
        for col in numeric_cols_order:
            df_order_materials[col] = pd.to_numeric(df_order_materials[col], errors='coerce').fillna(0)
        
        app_logger.info(f"DEBUG: df_order_materials (after numeric conversion) 的欄位為: {df_order_materials.columns.tolist()}")
        
        df_order_materials['order_shortage'] = (
            df_order_materials['未結數量 (EINHEIT)'] - 
            (df_order_materials['unrestricted_stock'] + df_order_materials['inspection_stock'])
        ).clip(lower=0)
        
        order_details_map = df_order_materials.groupby('訂單').apply(
            lambda x: x[[ 
                '物料', '物料說明_x', '需求數量 (EINHEIT)', '領料數量 (EINHEIT)',
                '未結數量 (EINHEIT)', '需求日期', 'unrestricted_stock',
                'inspection_stock', 'order_shortage'
            ]].rename(columns={'物料說明_x': '物料說明'}).to_dict('records'), include_groups=False
        ).to_dict()
        
        return order_details_map
    
    @staticmethod
    def _build_specs_map(df_specs):
        """建立規格對應表"""
        # 確保規格表中的「訂單」欄位是字串，並只提取數字部分作為訂單號碼
        df_specs['訂單'] = df_specs['訂單'].astype(str).str.extract(r'(\d+)')[0]
        
        # 修正：在轉換為字典前，將所有 NaN 值替換為空字串
        specs_map = df_specs.fillna('').groupby('訂單').apply(
            lambda x: x.to_dict('records'), include_groups=False
        ).to_dict()
        
        return specs_map
    
    @staticmethod
    def _build_order_summary_map(df_work_order_summary):
        """建立工單摘要對應表"""
        order_summary_map = {}
        
        if not df_work_order_summary.empty:
            required_cols = [
                '工單號碼', '下單客戶名稱', '物料說明', '生產開始', '生產結束',
                '機械外包', '電控外包', '噴漆外包', '鏟花外包', '捆包外包'
            ]
            
            # 確保所有需要的欄位都存在
            existing_cols = [col for col in required_cols if col in df_work_order_summary.columns]
            if len(existing_cols) != len(required_cols):
                app_logger.warning(f"警告：'工單總表2025.xls' 中缺少部分預期欄位。預期: {required_cols}, 實際: {df_work_order_summary.columns.tolist()}")
            
            # 篩選出包含所有必要欄位的 DataFrame
            df_filtered_summary = df_work_order_summary[existing_cols].copy()
            
            # 處理日期欄位
            for date_col in ['生產開始', '生產結束']:
                if date_col in df_filtered_summary.columns:
                    df_filtered_summary[date_col] = pd.to_datetime(df_filtered_summary[date_col], errors='coerce').dt.strftime('%Y-%m-%d').fillna('')
            
            # 處理 NaN 值
            df_filtered_summary = df_filtered_summary.fillna('')
            
            # 處理重複的 '工單號碼'
            if '工單號碼' in df_filtered_summary.columns:
                df_filtered_summary['工單號碼'] = df_filtered_summary['工單號碼'].astype(str)
                df_filtered_summary.drop_duplicates(subset=['工單號碼'], keep='first', inplace=True)
            
            # 根據 '工單號碼' 建立映射
            order_summary_map = df_filtered_summary.set_index('工單號碼').to_dict(orient='index')
            app_logger.info(f"DEBUG: order_summary_map 中包含的工單: {list(order_summary_map.keys())[:5]}... (前5個)")
        
        return order_summary_map
    
    @staticmethod
    def _sync_materials_to_database(df_demand, df_finished_demand, material_buyer_map):
        '''
        自動同步物料到資料庫
        將訂單需求中的物料自動加入到 materials 資料表
        
        Args:
            df_demand: 主儀表板需求資料
            df_finished_demand: 成品儀表板需求資料
            material_buyer_map: 物料採購人員對應表
        '''
        try:
            # 合併所有需求物料
            all_materials_df = pd.concat([df_demand, df_finished_demand], ignore_index=True)
            
            # 去重並取得唯一的物料清單
            unique_materials = all_materials_df[['物料', '物料說明']].drop_duplicates(subset=['物料'])
            
            # 過濾掉以 '08' 開頭的物料
            unique_materials = unique_materials[~unique_materials['物料'].astype(str).str.startswith('08')]
            
            app_logger.info(f'開始同步物料到資料庫，共 {len(unique_materials)} 筆物料')
            
            sync_count = 0
            skip_count = 0
            error_count = 0
            
            for _, row in unique_materials.iterrows():
                try:
                    material_id = str(row['物料'])
                    description = str(row['物料說明']) if pd.notna(row['物料說明']) else ''
                    base_material_id = material_id[:10] if len(material_id) >= 10 else material_id
                    
                    # 檢查前10碼是否已存在（任何版本）
                    existing_material = Material.query.filter_by(base_material_id=base_material_id).first()
                    
                    if existing_material:
                        skip_count += 1
                        continue  # 前10碼已存在，跳過
                    
                    # 查找採購人員
                    buyer = None
                    buyer_value = material_buyer_map.get(base_material_id)
                    if buyer_value:
                        # 先嘗試用 full_name 查找
                        buyer = User.query.filter_by(full_name=buyer_value, role='buyer').first()
                        # 如果找不到，再嘗試用 id 查找
                        if not buyer:
                            buyer = User.query.filter_by(id=buyer_value, role='buyer').first()
                    
                    # 建立新物料記錄
                    new_material = Material(
                        material_id=material_id,
                        description=description,
                        base_material_id=base_material_id,
                        buyer_id=buyer.id if buyer else None,
                        created_at=get_taiwan_time(),
                        updated_at=get_taiwan_time()
                    )
                    
                    db.session.add(new_material)
                    sync_count += 1
                    
                    # 每 100 筆提交一次，避免記憶體問題
                    if sync_count % 100 == 0:
                        db.session.commit()
                        app_logger.info(f'已同步 {sync_count} 筆物料到資料庫')
                
                except Exception as e:
                    error_count += 1
                    app_logger.warning(f'同步物料 {material_id} 失敗: {e}')
                    continue
            
            # 最後提交剩餘的資料
            if sync_count % 100 != 0:
                db.session.commit()
            
            app_logger.info(f'物料同步完成: 新增 {sync_count} 筆, 跳過 {skip_count} 筆已存在物料, 錯誤 {error_count} 筆')
            
        except Exception as e:
            db.session.rollback()
            app_logger.error(f'同步物料到資料庫時發生錯誤: {e}', exc_info=True)
    
    @staticmethod
    def _check_shortage_within_days(df_materials, demand_details_map, delivery_schedules_map=None, days=30):
        '''
        檢查物料是否在未來指定天數內有需求缺料
        
        Args:
            df_materials: 物料DataFrame
            demand_details_map: 需求詳情對應表
            delivery_schedules_map: 交期分批對應表 (🆕)
            days: 檢查天數（預設30天）
            
        Returns:
            Series: 布林值序列，True表示在指定天數內會缺料
        '''
        from datetime import datetime, timedelta
        if delivery_schedules_map is None:
            delivery_schedules_map = {}
            
        now = get_taiwan_time()
        cutoff_date = pd.Timestamp(now + timedelta(days=days))
        shortage_flags = []
        
        for _, material in df_materials.iterrows():
            material_id = material['物料']
            available_stock = float(material.get('unrestricted_stock', 0) + material.get('inspection_stock', 0))
            
            # 1. 取得需求與到貨的時間軸事件
            timeline_events = []
            
            # 加入需求事件
            demand_details = demand_details_map.get(material_id, [])
            for demand in demand_details:
                demand_date = demand.get('需求日期')
                if pd.notna(demand_date) and demand_date <= cutoff_date:
                    timeline_events.append({
                        'date': demand_date,
                        'type': 'demand',
                        'quantity': float(demand.get('未結數量 (EINHEIT)', 0))
                    })
            
            # 加入到貨事件 (🆕 分批交期)
            schedules = delivery_schedules_map.get(material_id, [])
            for s in schedules:
                delivery_date = pd.Timestamp(s['expected_date'])
                if delivery_date <= cutoff_date:
                    timeline_events.append({
                        'date': delivery_date,
                        'type': 'delivery',
                        'quantity': s['quantity']
                    })
            
            # 2. 按日期排序 (到貨排在需求之前，如果同一天)
            timeline_events.sort(key=lambda x: (x['date'], 0 if x['type'] == 'delivery' else 1))
            
            # 3. 模擬庫存水位
            running_stock = available_stock
            has_shortage = False
            
            for event in timeline_events:
                if event['type'] == 'demand':
                    running_stock -= event['quantity']
                    if running_stock < 0:
                        has_shortage = True
                        break
                else: # delivery
                    running_stock += event['quantity']
            
            shortage_flags.append(has_shortage)
        
        return pd.Series(shortage_flags, index=df_materials.index)
    
    @staticmethod
    def _sync_purchase_orders_to_db(df_on_order):
        """
        同步採購單到資料庫
        
        功能：
        1. 更新/建立 purchase_orders 表
        2. 同步物料的 buyer_id（前10碼匹配）
        3. 智慧判斷已刪除採購單的狀態
        """
        from datetime import timedelta
        
        # 建立 Excel 中的採購單號集合
        excel_po_numbers = set()
        
        # 建立物料 -> 採購群組的對應表（用於同步 buyer_id）
        material_buyer_map = {}
        
        success_count = 0
        error_count = 0
        
        for index, row in df_on_order.iterrows():
            try:
                # 建立唯一的採購單號
                po_number = f"{row['採購文件']}-{row['項目']}"
                excel_po_numbers.add(po_number)
                
                material_id = str(row['物料']).strip()
                base_material_id = material_id[:10] if len(material_id) >= 10 else material_id
                
                # 處理採購群組（補零到3位數）
                purchase_group = DataService._process_purchase_group(row.get('採購群組'))
                
                # 記錄物料的採購群組（用於後續同步）
                if purchase_group:
                    material_buyer_map[material_id] = {
                        'base_material_id': base_material_id,
                        'purchase_group': purchase_group
                    }
                
                # 確保物料存在
                DataService._ensure_material_exists(
                    material_id, 
                    base_material_id, 
                    purchase_group,
                    str(row.get('短文', ''))
                )
                
                # 更新/建立採購單
                DataService._update_or_create_purchase_order(row, po_number, material_id, purchase_group)
                
                success_count += 1
                
                # 每 100 筆提交一次
                if success_count % 100 == 0:
                    db.session.commit()
                    app_logger.info(f"已處理 {success_count} 筆採購單...")
            
            except Exception as e:
                error_count += 1
                app_logger.error(f"處理採購單失敗: {e}")
                continue
        
        # 最後提交
        db.session.commit()
        
        # 智慧判斷已刪除的採購單
        DataService._handle_deleted_purchase_orders(excel_po_numbers)
        
        # 同步物料的 buyer_id（前10碼匹配）
        DataService._sync_materials_buyer_id(material_buyer_map)
        
        app_logger.info(f"採購單同步完成: 成功 {success_count} 筆, 失敗 {error_count} 筆")
    
    @staticmethod
    def _process_purchase_group(pg_value):
        """處理採購群組，補零到3位數"""
        if pd.isna(pg_value):
            return None
        
        if isinstance(pg_value, (int, float)):
            return str(int(pg_value)).zfill(3)
        else:
            pg_str = str(pg_value).strip()
            if pg_str.isdigit():
                return pg_str.zfill(3)
            else:
                return pg_str
    
    @staticmethod
    def _ensure_material_exists(material_id, base_material_id, buyer_id, description):
        """確保物料存在，不存在則建立（以前10碼為基準）"""
        # 檢查前10碼是否已存在（任何版本）
        existing = Material.query.filter_by(base_material_id=base_material_id).first()
        
        if not existing:
            # 只在前10碼不存在時才建立新物料
            material = Material(
                material_id=material_id,
                base_material_id=base_material_id,
                buyer_id=buyer_id,
                description=description if pd.notna(description) else None,
                created_at=get_taiwan_time(),
                updated_at=get_taiwan_time()
            )
            db.session.add(material)
            app_logger.info(f"建立新物料（前10碼）: {base_material_id} (使用版本: {material_id})")
    
    @staticmethod
    def _update_or_create_purchase_order(row, po_number, material_id, purchase_group):
        """更新或建立採購單記錄"""
        po = PurchaseOrder.query.filter_by(po_number=po_number).first()
        
        # 🆕 記錄之前的狀態，用於檢測狀態變化
        old_status = po.status if po else None
        old_received_qty = po.received_quantity if po else 0
        
        if not po:
            po = PurchaseOrder()
            po.po_number = po_number
        
        # 更新所有欄位
        po.material_id = material_id
        po.supplier = str(row['供應商/供應工廠']) if pd.notna(row.get('供應商/供應工廠')) else None
        po.item_number = int(row['項目']) if pd.notna(row.get('項目')) else None
        po.description = str(row['短文']) if pd.notna(row.get('短文')) else None
        
        if pd.notna(row.get('文件日期')):
            po.document_date = pd.to_datetime(row['文件日期']).date()
        
        po.document_type = str(row['採購文件類型']) if pd.notna(row.get('採購文件類型')) else None
        po.purchase_group = purchase_group
        po.plant = str(row['工廠']) if pd.notna(row.get('工廠')) else None
        
        if pd.notna(row.get('儲存地點')):
            po.storage_location = str(int(row['儲存地點']))
        
        # 數量
        po.ordered_quantity = float(row['採購單數量']) if pd.notna(row.get('採購單數量')) else 0
        po.outstanding_quantity = float(row['仍待交貨〈數量〉']) if pd.notna(row.get('仍待交貨〈數量〉')) else 0
        po.received_quantity = po.ordered_quantity - po.outstanding_quantity
        
        # 狀態計算
        new_status = None
        if po.outstanding_quantity == 0:
            new_status = 'completed'
        elif po.received_quantity > 0:
            new_status = 'partial'
        else:
            new_status = 'pending'
        
        po.status = new_status
        
        # 🆕 檢測部分交貨：狀態變成 partial 且有新的收貨數量
        if new_status == 'partial' and (old_status != 'partial' or po.received_quantity > old_received_qty):
            # 標記該物料的手動交期需要更新
            DataService._mark_delivery_for_partial_receipt(material_id, po_number, po.received_quantity, po.outstanding_quantity)
        
        if not PurchaseOrder.query.filter_by(po_number=po_number).first():
            db.session.add(po)
    
    @staticmethod
    def _handle_deleted_purchase_orders(excel_po_numbers):
        """
        處理已刪除的採購單狀態
        
        簡化邏輯：從 Excel 消失 = 已完成交貨
        """
        # 查詢資料庫中所有未完成的採購單
        all_db_pos = PurchaseOrder.query.filter(
            PurchaseOrder.status.in_(['pending', 'partial'])
        ).all()
        
        updated_count = 0
        today = get_taiwan_time().date()
        
        for po in all_db_pos:
            # 如果採購單在 Excel 中，跳過（不是已刪除）
            if po.po_number in excel_po_numbers:
                continue
            
            # 從 Excel 消失 = 已完成交貨
            po.status = 'completed'
            po.actual_delivery_date = today
            po.received_quantity = po.ordered_quantity
            po.outstanding_quantity = 0
            updated_count += 1
            app_logger.info(f"採購單 {po.po_number} 已從已訂未交清單中移除，標記為已完成")
        
        if updated_count > 0:
            db.session.commit()
            app_logger.info(f"已更新 {updated_count} 個採購單狀態為已完成")
    
    @staticmethod
    def _mark_delivery_for_partial_receipt(material_id, po_number, received_qty, outstanding_qty):
        """
        標記部分交貨的交期需要更新
        
        當採購單部分交貨時：
        1. 檢查是否有手動維護的交期
        2. 如果交期未到或剛好到，標記為需要確認
        3. 加上註記說明已部分到貨
        """
        try:
            import os
            import json
            from datetime import datetime, timedelta
            
            delivery_file = 'instance/delivery_schedules.json'
            
            if not os.path.exists(delivery_file):
                return
            
            with open(delivery_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            schedules = data.get('delivery_schedules', {}).get(material_id, [])
            
            if not schedules:
                return
            
            # 檢查是否有關聯到這個採購單的交期
            today = get_taiwan_time().date()
            updated = False
            
            for schedule in schedules:
                # 如果交期關聯到這個採購單
                if schedule.get('po_number') == po_number:
                    try:
                        delivery_date = datetime.fromisoformat(schedule['expected_date']).date()
                        
                        # 如果交期未到或剛好到（今天或未來）
                        if delivery_date >= today:
                            # 🆕 標記為部分到貨
                            schedule['status'] = 'partial_received'
                            schedule['partial_note'] = f"已部分到貨 {received_qty} 件，剩餘 {outstanding_qty} 件待交"
                            schedule['partial_date'] = get_taiwan_time().isoformat()
                            schedule['needs_update'] = True
                            updated = True
                            app_logger.info(f"物料 {material_id} 的採購單 {po_number} 已部分到貨，交期標記為需更新")
                    except (ValueError, KeyError):
                        continue
            
            # 儲存更新
            if updated:
                with open(delivery_file, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                    
        except Exception as e:
            app_logger.error(f"標記部分交貨交期失敗: {e}", exc_info=True)
    
    @staticmethod
    def _sync_materials_buyer_id(material_buyer_map):
        """
        同步物料的 buyer_id（前10碼匹配）
        
        策略：
        以 Excel 為準，更新所有相同前10碼的物料的 buyer_id（無論原本是否有值）
        """
        updated_count = 0
        
        for material_id, info in material_buyer_map.items():
            base_material_id = info['base_material_id']
            purchase_group = info['purchase_group']
            
            # 更新所有相同前10碼的物料（以 Excel 為準）
            related_materials = Material.query.filter(
                Material.base_material_id == base_material_id
            ).all()
            
            for material in related_materials:
                material.buyer_id = purchase_group
                material.updated_at = get_taiwan_time()
                updated_count += 1
        
        if updated_count > 0:
            db.session.commit()
            app_logger.info(f"已更新 {updated_count} 個物料的採購人員資訊（前10碼匹配）")
