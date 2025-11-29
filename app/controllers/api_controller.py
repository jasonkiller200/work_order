# app/controllers/api_controller.py
# API 控制器

import logging
import pandas as pd
from flask import Blueprint, jsonify, make_response, request
from urllib.parse import quote
from app.services.cache_service import cache_manager
from app.services.spec_service import SpecService
from app.services.traffic_service import TrafficService
from app.models.material import MaterialDAO
from app.models.order import OrderDAO
from app.models.traffic import TrafficDAO
from app.utils.decorators import cache_required
from app.utils.helpers import format_date

app_logger = logging.getLogger(__name__)

api_bp = Blueprint('api', __name__, url_prefix='/api')

@api_bp.route('/materials')
@cache_required
def get_materials():
    """取得物料清單"""
    current_data = cache_manager.get_current_data()
    if current_data and "materials_dashboard" in current_data:
        return jsonify(current_data["materials_dashboard"])
    return jsonify([])

@api_bp.route('/material/<material_id>/details')
@cache_required
def get_material_details(material_id):
    """取得物料詳情"""
    try:
        current_data = cache_manager.get_current_data()
        
        if not current_data:
            app_logger.error("get_material_details: 資料尚未載入")
            return jsonify({"error": "資料尚未載入"}), 500
        
        # 建立 MaterialDAO
        material_dao = MaterialDAO(current_data.get("materials_dashboard", []))
        
        # 1. 獲取庫存總覽
        material_info = material_dao.get_by_id(material_id)
        if not material_info:
            app_logger.warning(f"get_material_details: 找不到物料 {material_id}")
            return jsonify({"error": "找不到該物料"}), 404
        
        total_available_stock = material_info.get('unrestricted_stock', 0) + material_info.get('inspection_stock', 0)
        
        # 2. 獲取、過濾、排序需求詳情
        demand_map = current_data.get("demand_details_map", {})
        demand_details = [d.copy() for d in demand_map.get(material_id, [])]
        demand_details = [d for d in demand_details if d.get('未結數量 (EINHEIT)', 0) > 0]
        
        demand_details.sort(key=lambda x: x.get('需求日期') or pd.Timestamp.max, reverse=False)
        
        # 3. 執行庫存消耗計算
        running_stock = total_available_stock
        shortage_triggered = False
        for item in demand_details:
            demand_qty = item.get('未結數量 (EINHEIT)', 0)
            running_stock -= demand_qty
            item['remaining_stock'] = running_stock
            if running_stock < 0 and not shortage_triggered:
                shortage_triggered = True
            item['is_shortage_point'] = shortage_triggered
            if pd.notna(item['需求日期']):
                item['需求日期'] = item['需求日期'].strftime('%Y-%m-%d')
        
        # 4. 獲取替代品庫存
        substitute_inventory = material_dao.get_substitutes(material_id)
        
        return jsonify({
            "stock_summary": {
                "unrestricted": material_info.get('unrestricted_stock', 0),
                "inspection": material_info.get('inspection_stock', 0),
                "on_order": material_info.get('on_order_stock', 0)
            },
            "demand_details": demand_details,
            "substitute_inventory": substitute_inventory
        })
    
    except Exception as e:
        app_logger.error(f"在 get_material_details 函式中發生錯誤: {e}", exc_info=True)
        return jsonify({"error": "一個後端錯誤發生了"}), 500

@api_bp.route('/order/<order_id>')
@cache_required
def get_order_details(order_id):
    """取得訂單詳情"""
    try:
        current_data = cache_manager.get_current_data()
        
        if not current_data:
            app_logger.error("get_order_details: 資料尚未載入")
            return jsonify({"error": "資料尚未載入"}), 500
        
        # 建立 OrderDAO
        order_dao = OrderDAO(
            current_data.get("order_details_map", {}),
            current_data.get("specs_map", {}),
            current_data.get("order_summary_map", {}),
            cache_manager.get_order_note_cache()
        )
        
        # 取得訂單資訊
        order = order_dao.get_by_id(order_id)
        
        # 篩選規格
        filtered_order_specs = SpecService.filter_order_specs(order.specs)
        
        # 格式化日期
        for item in order.materials:
            item['需求日期'] = format_date(item.get('需求日期'))
        
        return jsonify({
            "order_summary": order.summary,
            "order_note": order.note,
            "spec_version": order.version,
            "order_specs": filtered_order_specs,
            "order_materials": order.materials
        })
    
    except Exception as e:
        app_logger.error(f"在 get_order_details 函式中發生錯誤: {e}", exc_info=True)
        return jsonify({"error": "一個後端錯誤發生了"}), 500

@api_bp.route('/download_specs/<order_id>')
@cache_required
def download_specs(order_id):
    """下載訂單規格"""
    try:
        current_data = cache_manager.get_current_data()
        
        if not current_data:
            app_logger.error("download_specs: 資料尚未載入")
            return jsonify({"error": "資料尚未載入"}), 500
        
        specs_map = current_data.get("specs_map", {})
        raw_order_specs = specs_map.get(order_id, [])
        
        if not raw_order_specs:
            app_logger.warning(f"download_specs: 找不到訂單 {order_id} 的規格資料")
            return jsonify({"error": f"找不到訂單 {order_id} 的規格資料"}), 404
        
        # 產生 Excel 檔案
        excel_content = SpecService.generate_spec_excel(order_id, raw_order_specs)
        
        # 建立檔名
        filename = f'訂單_{order_id}_規格.xlsx'
        
        # 建立回應
        response = make_response(excel_content)
        
        # 設定標頭
        response.headers['Content-Type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        response.headers['Content-Disposition'] = (
            f"attachment; filename={quote(filename.encode('utf-8'))}; "
            f"filename*=UTF-8''{quote(filename.encode('utf-8'))}"
        )
        
        return response
    
    except Exception as e:
        app_logger.error(f"下載訂單 {order_id} 規格時發生錯誤: {e}", exc_info=True)
        return jsonify({"error": "無法下載檔案"}), 500

@api_bp.route('/admin/traffic')
def get_traffic_data():
    """取得流量統計資料"""
    views_data = TrafficService.read_views()
    traffic_dao = TrafficDAO(views_data)
    return jsonify(traffic_dao.get_all_stats())

@api_bp.route('/status')
def api_status():
    """系統狀態"""
    current_data = cache_manager.get_current_data()
    status = {
        "service_status": "online",
        "live_cache": cache_manager.get_live_cache_pointer(),
        "data_loaded": current_data is not None
    }
    return jsonify(status)
