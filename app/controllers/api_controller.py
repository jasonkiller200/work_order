# app/controllers/api_controller.py
# API 控制器

import logging
import pandas as pd
from datetime import datetime, timedelta
from flask import Blueprint, jsonify, make_response, request
from urllib.parse import quote
from app.services.cache_service import cache_manager
from app.services.spec_service import SpecService
from app.services.traffic_service import TrafficService
from app.models.material import MaterialDAO
from app.models.order import OrderDAO
from app.models.traffic import TrafficDAO
# 匯入資料庫模型
from app.models.database import db, User, Material, PurchaseOrder, PartDrawingMapping, DeliverySchedule
from app.utils.decorators import cache_required
from app.utils.helpers import format_date, get_taiwan_time

app_logger = logging.getLogger(__name__)

api_bp = Blueprint('api', __name__, url_prefix='/api')

@api_bp.route('/materials')
@cache_required
def get_materials():
    """取得主儀表板物料清單"""
    current_data = cache_manager.get_current_data()
    if current_data:
        return jsonify(current_data.get("materials_dashboard", []))
    return jsonify([])

@api_bp.route('/finished_materials')
@cache_required
def get_finished_materials():
    """取得成品儀表板物料清單"""
    current_data = cache_manager.get_current_data()
    if current_data:
        return jsonify(current_data.get("finished_dashboard", []))
    return jsonify([])

@api_bp.route('/material/<material_id>/details')
@cache_required
def get_material_details(material_id):
    """取得物料詳情"""
    try:
        current_data = cache_manager.get_current_data()
        dashboard_type = request.args.get('type', 'main')
        
        if not current_data:
            app_logger.error("get_material_details: 資料尚未載入")
            return jsonify({"error": "資料尚未載入"}), 500
        
        # 根據類型選擇需求資料來源
        if dashboard_type == 'finished':
            demand_map = current_data.get("finished_demand_details_map", {})
        else:
            demand_map = current_data.get("demand_details_map", {})
        
        # 🔧 如果在當前 map 中找不到，嘗試另一個 map
        if material_id not in demand_map:
            alternative_map = current_data.get("finished_demand_details_map", {}) if dashboard_type == 'main' else current_data.get("demand_details_map", {})
            if material_id in alternative_map:
                app_logger.info(f"物料 {material_id} 在另一個 map 中找到，自動切換來源")
                demand_map = alternative_map
                dashboard_type = 'finished' if dashboard_type == 'main' else 'main'
        
        # 從完整庫存資料中查找物料（而不是只從儀表板資料）
        inventory_data = current_data.get("inventory_data", [])
        material_info = None
        
        app_logger.info(f"查找物料 {material_id}, type={dashboard_type}, inventory_data 筆數: {len(inventory_data)}")
        
        for item in inventory_data:
            if item.get('物料') == material_id:
                material_info = item
                app_logger.info(f"在 inventory_data 中找到物料 {material_id}")
                break
        
        # 如果在庫存資料中找不到，嘗試從儀表板資料查找
        if not material_info:
            if dashboard_type == 'finished':
                materials_data = current_data.get("finished_dashboard", [])
            else:
                materials_data = current_data.get("materials_dashboard", [])
            
            app_logger.info(f"在儀表板資料中查找, 筆數: {len(materials_data)}")
            for item in materials_data:
                if item.get('物料') == material_id:
                    material_info = item
                    app_logger.info(f"在儀表板資料中找到物料 {material_id}")
                    break
        
        # 🔧 如果還是找不到，嘗試從原始 Excel 資料（所有物料）查找
        if not material_info:
            app_logger.warning(f"在快取中找不到物料 {material_id}，嘗試從原始資料查找...")
            
            # 建立一筆基本的物料資訊
            material_info = {
                '物料': material_id,
                '物料說明': '',
                'unrestricted_stock': 0,
                'inspection_stock': 0,
                'on_order_stock': 0,
                '採購人員': ''
            }
            app_logger.warning(f"使用預設資料結構回應物料 {material_id}")
        
        if not material_info:
            app_logger.error(f"get_material_details: 找不到物料 {material_id} (type={dashboard_type})")
            return jsonify({"error": f"找不到該物料 ({material_id})"}), 404
        
        # 🆕 取得物料說明（支援多種欄位名）
        material_description = (
            material_info.get('物料說明') or 
            material_info.get('description') or 
            material_info.get('短文') or 
            ''
        )
        
        # 處理庫存資料 - 支援中英文欄位名
        # inventory_data 使用中文欄位名，materials_dashboard 使用英文欄位名
        unrestricted_stock = material_info.get('unrestricted_stock') or material_info.get('未限制', 0)
        inspection_stock = material_info.get('inspection_stock') or material_info.get('品質檢驗中', 0)
        on_order_stock = material_info.get('on_order_stock', 0)
        
        # 確保是數字類型
        try:
            unrestricted_stock = float(unrestricted_stock) if unrestricted_stock else 0
            inspection_stock = float(inspection_stock) if inspection_stock else 0
            on_order_stock = float(on_order_stock) if on_order_stock else 0
        except (ValueError, TypeError):
            unrestricted_stock = 0
            inspection_stock = 0
            on_order_stock = 0
        
        total_available_stock = unrestricted_stock + inspection_stock
        
        # 2. 獲取、過濾、排序需求詳情
        demand_details = [d.copy() for d in demand_map.get(material_id, [])]
        
        # 只過濾掉未結數量明確為0或負數的，保留所有正數的需求
        demand_details = [d for d in demand_details if d.get('未結數量 (EINHEIT)', 0) > 0]
        
        # 如果過濾後沒有資料，保留原始資料（可能是資料格式問題）
        if not demand_details and demand_map.get(material_id):
            app_logger.warning(f"物料 {material_id} 過濾後沒有需求，使用原始資料")
            demand_details = [d.copy() for d in demand_map.get(material_id, [])]
        
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
        substitute_inventory = []
        material_base = material_id[:10] if len(material_id) >= 10 else material_id
        
        for item in inventory_data:
            item_base = str(item.get('物料', ''))[:10]
            if item_base == material_base and item.get('物料') != material_id:
                # 支援中英文欄位名
                sub_unrestricted = item.get('unrestricted_stock') or item.get('未限制', 0)
                sub_inspection = item.get('inspection_stock') or item.get('品質檢驗中', 0)
                
                try:
                    sub_unrestricted = float(sub_unrestricted) if sub_unrestricted else 0
                    sub_inspection = float(sub_inspection) if sub_inspection else 0
                except (ValueError, TypeError):
                    sub_unrestricted = 0
                    sub_inspection = 0
                
                # 🆕 計算替代品的總需求數
                sub_material_id = item.get('物料', '')
                sub_demand_details = demand_map.get(sub_material_id, [])
                total_demand = sum(d.get('未結數量 (EINHEIT)', 0) for d in sub_demand_details if d.get('未結數量 (EINHEIT)', 0) > 0)
                
                substitute_inventory.append({
                    '物料': sub_material_id,
                    '物料說明': item.get('物料說明', ''),
                    'unrestricted_stock': sub_unrestricted,
                    'inspection_stock': sub_inspection,
                    'total_demand': total_demand
                })
        
        # 🆕 取得圖號資訊
        drawing_mapping = PartDrawingMapping.query.filter_by(part_number=material_id).first()
        drawing_number = drawing_mapping.drawing_number if drawing_mapping else None
        
        return jsonify({
            "material_description": material_description,
            "drawing_number": drawing_number,
            "stock_summary": {
                "unrestricted": unrestricted_stock,
                "inspection": inspection_stock,
                "on_order": on_order_stock
            },
            "demand_details": demand_details,
            "substitute_inventory": substitute_inventory
        })
    
    except Exception as e:
        app_logger.error(f"在 get_material_details 函式中發生錯誤: {e}", exc_info=True)
        return jsonify({"error": "一個後端錯誤發生了"}), 500

@api_bp.route('/material/<material_id>/buyer_reference')
@cache_required
def get_buyer_reference(material_id):
    """取得物料採購人員參考清單（前後25筆）"""
    try:
        current_data = cache_manager.get_current_data()
        
        if not current_data:
            app_logger.error("get_buyer_reference: 資料尚未載入")
            return jsonify({"error": "資料尚未載入"}), 500
        
        # 取得當前儀表板類型
        dashboard_type = request.args.get('type', 'main')
        
        # 根據類型選擇資料來源
        if dashboard_type == 'finished':
            materials_data = current_data.get("finished_dashboard", [])
        else:
            materials_data = current_data.get("materials_dashboard", [])
        
        # 找到目標物料的索引位置
        target_index = None
        for idx, material in enumerate(materials_data):
            if material.get('物料') == material_id:
                target_index = idx
                break
        
        if target_index is None:
            app_logger.warning(f"get_buyer_reference: 找不到物料 {material_id}")
            return jsonify({"error": "找不到該物料"}), 404
        
        # 取得前後25筆（總共最多51筆）
        start_index = max(0, target_index - 25)
        end_index = min(len(materials_data), target_index + 26)
        
        reference_list = []
        for i in range(start_index, end_index):
            material = materials_data[i]
            reference_list.append({
                '物料': material.get('物料', ''),
                '物料說明': material.get('物料說明', ''),
                '採購人員': material.get('採購人員', '')
            })
        
        return jsonify({
            "reference_list": reference_list,
            "total_count": len(reference_list),
            "current_material": material_id
        })
    
    except Exception as e:
        app_logger.error(f"在 get_buyer_reference 函式中發生錯誤: {e}", exc_info=True)
        return jsonify({"error": "一個後端錯誤發生了"}), 500

@api_bp.route('/buyers_list')
@cache_required
def get_buyers_list():
    """取得所有採購人員清單"""
    try:
        current_data = cache_manager.get_current_data()
        
        if not current_data:
            app_logger.error("get_buyers_list: 資料尚未載入")
            return jsonify({"error": "資料尚未載入"}), 500
        
        # 收集所有不重複的採購人員
        buyers = set()
        
        # 從主儀表板收集
        materials_data = current_data.get("materials_dashboard", [])
        for material in materials_data:
            buyer = material.get('採購人員', '').strip()
            if buyer:
                buyers.add(buyer)
        
        # 從成品儀表板收集
        finished_data = current_data.get("finished_dashboard", [])
        for material in finished_data:
            buyer = material.get('採購人員', '').strip()
            if buyer:
                buyers.add(buyer)
        
        # 排序並返回
        sorted_buyers = sorted(list(buyers))
        
        return jsonify({
            "buyers": sorted_buyers,
            "count": len(sorted_buyers)
        })
    
    except Exception as e:
        app_logger.error(f"在 get_buyers_list 函式中發生錯誤: {e}", exc_info=True)
        return jsonify({"error": "一個後端錯誤發生了"}), 500

@api_bp.route('/update_buyer', methods=['POST'])
@cache_required
def update_buyer():
    """更新物料的採購人員"""
    try:
        data = request.get_json()
        material_id = data.get('material_id')
        new_buyer_name = data.get('buyer', '').strip()
        dashboard_type = data.get('dashboard_type', 'main')
        
        if not material_id:
            return jsonify({"success": False, "error": "缺少物料編號"}), 400
        
        # 1. 更新記憶體快取
        current_data = cache_manager.get_current_data()
        
        if not current_data:
            app_logger.error("update_buyer: 資料尚未載入")
            return jsonify({"success": False, "error": "資料尚未載入"}), 500
        
        # 根據類型選擇資料來源
        if dashboard_type == 'finished':
            materials_data = current_data.get("finished_dashboard", [])
        else:
            materials_data = current_data.get("materials_dashboard", [])
        
        # 找到對應的物料並更新快取
        material_found = False
        material_description = None
        base_material_id = material_id[:10] if len(material_id) >= 10 else material_id
        
        for material in materials_data:
            if material.get('物料') == material_id:
                material['採購人員'] = new_buyer_name
                material_description = material.get('物料說明', '')
                material_found = True
                break
        
        # 如果在快取中找不到，嘗試從完整庫存資料找
        if not material_found:
            inventory_data = current_data.get("inventory_data", [])
            for material in inventory_data:
                if material.get('物料') == material_id:
                    material['採購人員'] = new_buyer_name
                    material_description = material.get('物料說明', '')
                    material_found = True
                    break
        
        # 2. 寫入資料庫
        try:
            # 查找或建立採購人員
            buyer = None
            if new_buyer_name:
                buyer = User.query.filter_by(full_name=new_buyer_name, role='buyer').first()
                if not buyer:
                    app_logger.warning(f"採購人員 {new_buyer_name} 不存在於資料庫中")
            
            # 查找或建立物料
            material_record = Material.query.filter_by(material_id=material_id).first()
            
            if material_record:
                # 更新現有物料的採購人員
                material_record.buyer_id = buyer.id if buyer else None
                material_record.updated_at = get_taiwan_time()
                app_logger.info(f"更新物料 {material_id} 的採購人員為: {new_buyer_name}")
            else:
                # 自動新增物料到資料庫
                material_record = Material(
                    material_id=material_id,
                    description=material_description or '',
                    base_material_id=base_material_id,
                    buyer_id=buyer.id if buyer else None,
                    created_at=get_taiwan_time(),
                    updated_at=get_taiwan_time()
                )
                db.session.add(material_record)
                app_logger.info(f"自動新增物料 {material_id} 到資料庫，採購人員: {new_buyer_name}")
            
            db.session.commit()
            
            return jsonify({
                "success": True,
                "material_id": material_id,
                "buyer": new_buyer_name,
                "database_updated": True,
                "auto_created": material_record.id is None  # 是否為新建
            })
            
        except Exception as db_error:
            db.session.rollback()
            app_logger.error(f"資料庫操作失敗: {db_error}", exc_info=True)
            
            # 即使資料庫失敗，快取已更新，仍返回部分成功
            return jsonify({
                "success": True,
                "material_id": material_id,
                "buyer": new_buyer_name,
                "database_updated": False,
                "warning": "快取已更新，但資料庫寫入失敗"
            })
    
    except Exception as e:
        app_logger.error(f"在 update_buyer 函式中發生錯誤: {e}", exc_info=True)
        return jsonify({"success": False, "error": "一個後端錯誤發生了"}), 500

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

@api_bp.route('/demand_details/all')
@cache_required
def get_all_demand_details():
    """取得所有物料的需求詳情 用於計算最早需求日期"""
    try:
        current_data = cache_manager.get_current_data()
        
        if not current_data:
            app_logger.error("get_all_demand_details: 資料尚未載入")
            return jsonify({"error": "資料尚未載入"}), 500
        
        # 合併主儀表板和成品儀表板的需求詳情
        demand_details_map = current_data.get("demand_details_map", {})
        finished_demand_details_map = current_data.get("finished_demand_details_map", {})
        
        # 合併兩個 map
        combined_map = {**demand_details_map}
        for material_id, details in finished_demand_details_map.items():
            if material_id in combined_map:
                combined_map[material_id].extend(details)
            else:
                combined_map[material_id] = details
        
        return jsonify(combined_map)
    
    except Exception as e:
        app_logger.error(f"取得需求詳情失敗: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@api_bp.route('/delivery/all')
def get_all_deliveries():
    """取得所有交期資料 用於統計 (分批)"""
    try:
        from datetime import datetime, timedelta
        today = get_taiwan_time().date()
        yesterday = today - timedelta(days=1)
        
        # 查詢所有未完成且未取消的交期
        all_schedules = DeliverySchedule.query.filter(
            DeliverySchedule.status.notin_(['completed', 'cancelled'])
        ).order_by(DeliverySchedule.expected_date).all()
        
        # 整理為每個物料一筆最優先交期 (與原邏輯一致)
        schedules = {}
        for s in all_schedules:
            if s.material_id in schedules:
                continue # 已經有更早的分批了
                
            delivery_date = s.expected_date
            
            if delivery_date >= today:
                schedules[s.material_id] = {
                    "id": s.id,
                    "expected_date": delivery_date.strftime('%Y-%m-%d'),
                    "quantity": float(s.quantity),
                    "po_number": s.po_number or '',
                    "status": s.status
                }
            elif delivery_date == yesterday:
                schedules[s.material_id] = {
                    "id": s.id,
                    "expected_date": delivery_date.strftime('%Y-%m-%d'),
                    "quantity": float(s.quantity),
                    "po_number": s.po_number or '',
                    "status": "overdue"
                }
            
        return jsonify({
            "schedules": schedules,
            "total": len(schedules)
        })
    except Exception as e:
        app_logger.error(f"取得所有交期失敗: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@api_bp.route('/delivery/<material_id>')
def get_delivery(material_id):
    """取得物料的交期資訊 (分批)"""
    try:
        from datetime import datetime, timedelta
        today = get_taiwan_time().date()
        
        # 1. 查詢資料庫中的交期分批
        schedules = DeliverySchedule.query.filter_by(material_id=material_id).order_by(DeliverySchedule.expected_date).all()
        
        history = []
        for s in schedules:
            history.append({
                "id": s.id,
                "expected_date": s.expected_date.strftime('%Y-%m-%d'),
                "quantity": float(s.quantity),
                "received_quantity": float(s.received_quantity or 0),
                "po_number": s.po_number or '',
                "supplier": s.supplier or '',
                "notes": s.notes or '',
                "status": s.status,
                "created_at": s.created_at.isoformat() if s.created_at else None
            })
            
        # 2. 決定當前要顯示的「最優先」交期 (未過期且最近的一筆)
        po_delivery = None
        manual_delivery = None
        
        valid_schedules = [h for h in history if h['status'] != 'completed' and h['status'] != 'cancelled']
        
        if valid_schedules:
            # 找到最接近今天的一筆
            upcoming = [h for h in valid_schedules if h['expected_date'] >= today.strftime('%Y-%m-%d')]
            overdue = [h for h in valid_schedules if h['expected_date'] < today.strftime('%Y-%m-%d')]
            
            if upcoming:
                manual_delivery = min(upcoming, key=lambda x: x['expected_date'])
            elif overdue:
                manual_delivery = max(overdue, key=lambda x: x['expected_date'])
                manual_delivery['status'] = 'overdue'

        # 🎯 傳統邏輯向下相容：如果是採購單相關，標註為 po_delivery
        if manual_delivery and manual_delivery.get('po_number'):
            po_delivery = manual_delivery.copy()
            po_delivery['source'] = 'purchase_order'
            
        return jsonify({
            "delivery": manual_delivery,
            "po_delivery": po_delivery,
            "manual_delivery": manual_delivery,
            "history": history
        })
    except Exception as e:
        app_logger.error(f"取得交期失敗: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@api_bp.route('/delivery', methods=['POST'])
def save_delivery():
    """儲存交期資訊 (分批)"""
    try:
        form_data = request.get_json()
        material_id = form_data.get('material_id')
        po_number = form_data.get('po_number')
        expected_date_str = form_data.get('expected_date')
        quantity = form_data.get('quantity')
        
        if not material_id:
            return jsonify({"success": False, "error": "缺少物料編號"}), 400
        if not expected_date_str or quantity is None:
            return jsonify({"success": False, "error": "缺少交期或數量"}), 400
            
        expected_date = datetime.strptime(expected_date_str, '%Y-%m-%d').date()
        
        # 1. 儲存到 DeliverySchedule 資料表
        new_schedule = DeliverySchedule(
            material_id=material_id,
            po_number=po_number,
            expected_date=expected_date,
            quantity=float(quantity),
            supplier=form_data.get('supplier', ''),
            notes=form_data.get('notes', ''),
            status='pending'
        )
        db.session.add(new_schedule)
        
        # 2. 如果有採購單號，同步更新採購單的預計交期 (維持舊邏輯向下相容)
        if po_number:
            po = PurchaseOrder.query.filter_by(po_number=po_number).first()
            if po:
                po.updated_delivery_date = expected_date
                po.status = 'updated'
                
        db.session.commit()
        app_logger.info(f"已儲存物料 {material_id} 的分批交期: {expected_date}")
        
        return jsonify({
            "success": True,
            "delivery": {
                "id": new_schedule.id,
                "expected_date": expected_date_str,
                "quantity": float(quantity),
                "po_number": po_number,
                "status": "pending"
            }
        })
        
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"儲存交期失敗: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@api_bp.route('/delivery/<int:schedule_id>', methods=['PUT'])
def update_delivery(schedule_id):
    """更新特定交期分批"""
    try:
        form_data = request.get_json()
        schedule = DeliverySchedule.query.get(schedule_id)
        if not schedule:
            return jsonify({"success": False, "error": "找不到該交期記錄"}), 404
            
        if 'expected_date' in form_data:
            schedule.expected_date = datetime.strptime(form_data['expected_date'], '%Y-%m-%d').date()
        if 'quantity' in form_data:
            schedule.quantity = float(form_data['quantity'])
        if 'notes' in form_data:
            schedule.notes = form_data['notes']
        if 'supplier' in form_data:
            schedule.supplier = form_data['supplier']
        if 'po_number' in form_data:
            schedule.po_number = form_data['po_number']
            
        db.session.commit()
        app_logger.info(f"已更新交期分批 (ID: {schedule_id})")
        return jsonify({"success": True})
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"更新交期失敗: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@api_bp.route('/delivery/<int:schedule_id>', methods=['DELETE'])
def delete_delivery(schedule_id):
    """刪除特定交期分批"""
    try:
        schedule = DeliverySchedule.query.get(schedule_id)
        if not schedule:
            return jsonify({"success": False, "error": "找不到該交期記錄"}), 404
            
        material_id = schedule.material_id
        db.session.delete(schedule)
        db.session.commit()
        
        app_logger.info(f"已刪除物料 {material_id} 的交期分批 (ID: {schedule_id})")
        return jsonify({"success": True})
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"刪除交期失敗: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@api_bp.route('/delivery/<material_id>/clear_overdue', methods=['POST'])
def clear_overdue_delivery(material_id):
    """清除物料過期的交期記錄"""
    try:
        today = get_taiwan_time().date()
        # 清除過期且未完成的交期
        overdue_schedules = DeliverySchedule.query.filter(
            DeliverySchedule.material_id == material_id,
            DeliverySchedule.expected_date < today,
            DeliverySchedule.status.notin_(['completed', 'cancelled'])
        ).all()
        
        count = len(overdue_schedules)
        for s in overdue_schedules:
            db.session.delete(s)
            
        db.session.commit()
        app_logger.info(f"已清除物料 {material_id} 的 {count} 筆過期交期")
        
        return jsonify({"success": True, "cleared_count": count})
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"清除過期交期失敗: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@api_bp.route('/delivery/batch-clear-overdue', methods=['POST'])
def batch_clear_overdue_deliveries():
    """批量清除所有過期的交期"""
    try:
        today = get_taiwan_time().date()
        # 考慮寬限期，清理昨天之前的
        yesterday = today - timedelta(days=1)
        
        overdue_schedules = DeliverySchedule.query.filter(
            DeliverySchedule.expected_date <= yesterday,
            DeliverySchedule.status.notin_(['completed', 'cancelled'])
        ).all()
        
        count = len(overdue_schedules)
        for s in overdue_schedules:
            db.session.delete(s)
            
        db.session.commit()
        app_logger.info(f"批量清理完成，共清除 {count} 筆過期交期")
        
        return jsonify({
            "success": True, 
            "cleared_count": count
        })
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"批量清理過期交期失敗: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@api_bp.route('/purchase_orders/<material_id>')
@cache_required
def get_purchase_orders_by_material(material_id):
    """
    根據物料編號查詢相關的採購單
    ✅ 只顯示未結案的採購單 (status != 'completed' and status != 'cancelled')
    """
    try:
        # 🆕 查詢該物料的所有「未結案」採購單，並按交貨日期排序
        purchase_orders = PurchaseOrder.query.filter(
            PurchaseOrder.material_id == material_id,
            PurchaseOrder.status.notin_(['completed', 'cancelled'])
        ).order_by(PurchaseOrder.original_delivery_date).all()
        
        result = []
        for po in purchase_orders:
            result.append({
                'po_number': po.po_number,
                'supplier': po.supplier,
                'ordered_quantity': float(po.ordered_quantity),
                'received_quantity': float(po.received_quantity),
                'outstanding_quantity': float(po.outstanding_quantity),
                'original_delivery_date': po.original_delivery_date.strftime('%Y-%m-%d') if po.original_delivery_date else '',
                'updated_delivery_date': po.updated_delivery_date.strftime('%Y-%m-%d') if po.updated_delivery_date else '',
                'status': po.status,
                'purchase_group': po.purchase_group,
                'description': po.description
            })
            
        return jsonify(result)
        
    except Exception as e:
        app_logger.error(f"查詢物料 {material_id} 的採購單失敗: {e}", exc_info=True)
        return jsonify({"error": "查詢採購單失敗"}), 500

@api_bp.route('/purchase_order/<po_number>')
@cache_required
def get_purchase_order_detail(po_number):
    """
    根據採購單號查詢詳細資訊
    """
    try:
        po = PurchaseOrder.query.filter_by(po_number=po_number).first()
        
        if not po:
            return jsonify({"error": "找不到該採購單"}), 404
            
        return jsonify({
            'po_number': po.po_number,
            'material_id': po.material_id,
            'supplier': po.supplier,
            'ordered_quantity': float(po.ordered_quantity),
            'received_quantity': float(po.received_quantity),
            'outstanding_quantity': float(po.outstanding_quantity),
            'original_delivery_date': po.original_delivery_date.strftime('%Y-%m-%d') if po.original_delivery_date else '',
            'updated_delivery_date': po.updated_delivery_date.strftime('%Y-%m-%d') if po.updated_delivery_date else '',
            'status': po.status,
            'purchase_group': po.purchase_group,
            'description': po.description,
            'item_number': po.item_number,
            'plant': po.plant,
            'storage_location': po.storage_location
        })
        
        
    except Exception as e:
        app_logger.error(f"查詢採購單 {po_number} 失敗: {e}", exc_info=True)
        return jsonify({"error": "查詢採購單詳情失敗"}), 500


# ============================================================================
# 品號-圖號對照表 API
# ============================================================================

@api_bp.route('/part-drawing/<part_number>')
def get_part_drawing(part_number):
    """查詢單一品號的圖號"""
    try:
        mapping = PartDrawingMapping.query.filter_by(part_number=part_number).first()
        
        if not mapping:
            return jsonify({"error": "找不到該品號"}), 404
        
        return jsonify({
            "part_number": mapping.part_number,
            "drawing_number": mapping.drawing_number,
            "created_at": mapping.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            "updated_at": mapping.updated_at.strftime('%Y-%m-%d %H:%M:%S')
        })
    
    except Exception as e:
        app_logger.error(f"查詢品號 {part_number} 失敗: {e}", exc_info=True)
        return jsonify({"error": "查詢失敗"}), 500


@api_bp.route('/part-drawing/search', methods=['POST'])
def search_part_drawing():
    """批量查詢品號或圖號"""
    try:
        data = request.get_json()
        search_type = data.get('type', 'part_number')  # part_number 或 drawing_number
        search_values = data.get('values', [])  # 要查詢的值列表
        
        if not search_values:
            return jsonify({"results": []})
        
        results = []
        
        if search_type == 'part_number':
            mappings = PartDrawingMapping.query.filter(
                PartDrawingMapping.part_number.in_(search_values)
            ).all()
        else:  # drawing_number
            mappings = PartDrawingMapping.query.filter(
                PartDrawingMapping.drawing_number.in_(search_values)
            ).all()
        
        for mapping in mappings:
            results.append({
                "part_number": mapping.part_number,
                "drawing_number": mapping.drawing_number
            })
        
        return jsonify({"results": results, "count": len(results)})
    
    except Exception as e:
        app_logger.error(f"批量查詢失敗: {e}", exc_info=True)
        return jsonify({"error": "查詢失敗"}), 500


@api_bp.route('/part-drawing', methods=['POST'])
def add_part_drawing():
    """新增單筆品號-圖號對照"""
    try:
        data = request.get_json()
        part_number = data.get('part_number', '').strip()
        drawing_number = data.get('drawing_number', '').strip()
        
        if not part_number or not drawing_number:
            return jsonify({"success": False, "error": "品號和圖號不能為空"}), 400
        
        # 檢查是否已存在
        existing = PartDrawingMapping.query.filter_by(part_number=part_number).first()
        
        if existing:
            return jsonify({
                "success": False,
                "error": "品號已存在",
                "existing_drawing_number": existing.drawing_number
            }), 409
        
        # 新增記錄
        mapping = PartDrawingMapping(
            part_number=part_number,
            drawing_number=drawing_number
        )
        db.session.add(mapping)
        db.session.commit()
        
        app_logger.info(f"新增品號-圖號對照: {part_number} -> {drawing_number}")
        
        return jsonify({
            "success": True,
            "part_number": mapping.part_number,
            "drawing_number": mapping.drawing_number
        })
    
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"新增品號-圖號對照失敗: {e}", exc_info=True)
        return jsonify({"success": False, "error": "新增失敗"}), 500


@api_bp.route('/part-drawing/batch', methods=['POST'])
def batch_add_part_drawing():
    """批量新增品號-圖號對照"""
    try:
        data = request.get_json()
        mappings_data = data.get('mappings', [])  # [{part_number, drawing_number}, ...]
        
        if not mappings_data:
            return jsonify({"success": False, "error": "沒有資料"}), 400
        
        stats = {
            'total': len(mappings_data),
            'success': 0,
            'duplicate': 0,
            'error': 0
        }
        errors = []
        
        for item in mappings_data:
            try:
                part_number = str(item.get('part_number', '')).strip()
                drawing_number = str(item.get('drawing_number', '')).strip()
                
                if not part_number or not drawing_number:
                    stats['error'] += 1
                    continue
                
                # 檢查是否已存在
                existing = PartDrawingMapping.query.filter_by(part_number=part_number).first()
                
                if existing:
                    stats['duplicate'] += 1
                    continue
                
                # 新增記錄
                mapping = PartDrawingMapping(
                    part_number=part_number,
                    drawing_number=drawing_number
                )
                db.session.add(mapping)
                stats['success'] += 1
                
                # 每 100 筆提交一次
                if stats['success'] % 100 == 0:
                    db.session.commit()
            
            except Exception as e:
                stats['error'] += 1
                errors.append(str(e))
        
        # 最後提交
        db.session.commit()
        
        app_logger.info(f"批量新增品號-圖號對照: 成功 {stats['success']}, 重複 {stats['duplicate']}, 錯誤 {stats['error']}")
        
        return jsonify({
            "success": True,
            "stats": stats,
            "errors": errors[:10]  # 只返回前 10 個錯誤
        })
    
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"批量新增品號-圖號對照失敗: {e}", exc_info=True)
        return jsonify({"success": False, "error": "批量新增失敗"}), 500


@api_bp.route('/part-drawing/<part_number>', methods=['PUT'])
def update_part_drawing(part_number):
    """更新品號的圖號"""
    try:
        data = request.get_json()
        new_drawing_number = data.get('drawing_number', '').strip()
        
        if not new_drawing_number:
            return jsonify({"success": False, "error": "圖號不能為空"}), 400
        
        mapping = PartDrawingMapping.query.filter_by(part_number=part_number).first()
        
        if not mapping:
            return jsonify({"success": False, "error": "找不到該品號"}), 404
        
        old_drawing_number = mapping.drawing_number
        mapping.drawing_number = new_drawing_number
        mapping.updated_at = get_taiwan_time()
        db.session.commit()
        
        app_logger.info(f"更新品號 {part_number} 的圖號: {old_drawing_number} -> {new_drawing_number}")
        
        return jsonify({
            "success": True,
            "part_number": mapping.part_number,
            "old_drawing_number": old_drawing_number,
            "new_drawing_number": mapping.drawing_number
        })
    
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"更新品號 {part_number} 失敗: {e}", exc_info=True)
        return jsonify({"success": False, "error": "更新失敗"}), 500


@api_bp.route('/part-drawing/<part_number>', methods=['DELETE'])
def delete_part_drawing(part_number):
    """刪除品號-圖號對照"""
    try:
        mapping = PartDrawingMapping.query.filter_by(part_number=part_number).first()
        
        if not mapping:
            return jsonify({"success": False, "error": "找不到該品號"}), 404
        
        drawing_number = mapping.drawing_number
        db.session.delete(mapping)
        db.session.commit()
        
        app_logger.info(f"刪除品號-圖號對照: {part_number} -> {drawing_number}")
        
        return jsonify({
            "success": True,
            "message": f"已刪除品號 {part_number} 的對照"
        })
    
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"刪除品號 {part_number} 失敗: {e}", exc_info=True)
        return jsonify({"success": False, "error": "刪除失敗"}), 500


@api_bp.route('/part-drawing/list')
def list_part_drawing():
    """列出所有品號-圖號對照（支援分頁和搜尋）"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 50, type=int)
        search = request.args.get('search', '').strip()
        
        query = PartDrawingMapping.query
        
        # 搜尋功能
        if search:
            query = query.filter(
                db.or_(
                    PartDrawingMapping.part_number.like(f'%{search}%'),
                    PartDrawingMapping.drawing_number.like(f'%{search}%')
                )
            )
        
        # 分頁
        pagination = query.order_by(PartDrawingMapping.part_number).paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
        
        results = []
        for mapping in pagination.items:
            results.append({
                "part_number": mapping.part_number,
                "drawing_number": mapping.drawing_number,
                "updated_at": mapping.updated_at.strftime('%Y-%m-%d %H:%M:%S')
            })
        
        return jsonify({
            "results": results,
            "total": pagination.total,
            "page": page,
            "per_page": per_page,
            "total_pages": pagination.pages
        })
    
    except Exception as e:
        app_logger.error(f"列出品號-圖號對照失敗: {e}", exc_info=True)
        return jsonify({"error": "查詢失敗"}), 500

