# app/services/data_service.py
# 資料載入與處理服務

import logging
import pandas as pd
import os
from app.models.database import db, ComponentRequirement, Material, User
from sqlalchemy.orm import joinedload

from app.config import FilePaths
from app.utils.helpers import replace_nan_in_dict

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

            # 2. 讀取物料與採購人員對應（使用前10碼）
            material_buyer_map = {}
            try:
                materials = Material.query.options(joinedload(Material.buyer)).filter(Material.buyer_id.isnot(None)).all()
                for m in materials:
                    if m.buyer and m.base_material_id:
                        # 使用前10碼作為 key
                        material_buyer_map[m.base_material_id] = m.buyer.full_name
                app_logger.info(f"已載入 {len(material_buyer_map)} 筆物料採購人員對應 (使用前10碼)")
            except Exception as e:
                app_logger.error(f"讀取物料採購人員對應失敗: {e}")
            
            # --- 新增邏輯：成品撥料分流 ---
            # 計算 base_material_id
            df_finished_parts['base_material_id'] = df_finished_parts['物料'].astype(str).str[:10]
            
            # 分流：符合組件需求的 vs 不符合的
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
                df_total_demand, df_inventory, df_total_on_order, df_demand, material_buyer_map
            )
            
            # 建立成品資料表
            df_finished_dashboard = DataService._build_main_dataframe(
                df_total_finished_demand, df_inventory, df_total_on_order, df_finished_demand, material_buyer_map
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
            demand_details_map_cleaned = replace_nan_in_dict(demand_details_map)
            finished_demand_details_map_cleaned = replace_nan_in_dict(finished_demand_details_map)
            order_details_map_cleaned = replace_nan_in_dict(order_details_map)
            
            return {
                "materials_dashboard": materials_dashboard_cleaned,
                "finished_dashboard": finished_dashboard_cleaned, # 新增成品儀表板
                "specs_data": specs_data_cleaned,
                "demand_details_map": demand_details_map_cleaned,
                "finished_demand_details_map": finished_demand_details_map_cleaned, # 新增成品需求詳情
                "order_details_map": order_details_map_cleaned,
                "specs_map": specs_map,
                "order_summary_map": order_summary_map
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
        """載入已訂未交資料"""
        on_order_path = FilePaths.ON_ORDER_FILE
        
        if os.path.exists(on_order_path):
            return pd.read_excel(on_order_path)
        else:
            app_logger.warning("警告：找不到 '已訂未交.XLSX' 檔案。在途數量將全部視為 0。")
            return pd.DataFrame(columns=['物料', '仍待交貨〈數量〉'])
    
    @staticmethod
    def _build_main_dataframe(df_total_demand, df_inventory, df_total_on_order, df_demand, material_buyer_map=None):
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
