# app/controllers/api_controller.py
# API 控制器

import logging
import pandas as pd
from datetime import datetime
from flask import Blueprint, jsonify, make_response, request
from urllib.parse import quote
from app.services.cache_service import cache_manager
from app.services.spec_service import SpecService
from app.services.traffic_service import TrafficService
from app.models.material import MaterialDAO
from app.models.order import OrderDAO
from app.models.traffic import TrafficDAO
from app.models.database import db, User, Material
from app.utils.decorators import cache_required
from app.utils.helpers import format_date

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
        
        # 從完整庫存資料中查找物料（而不是只從儀表板資料）
        inventory_data = current_data.get("inventory_data", [])
        material_info = None
        
        for item in inventory_data:
            if item.get('物料') == material_id:
                material_info = item
                break
        
        # 如果在庫存資料中找不到，嘗試從儀表板資料查找
        if not material_info:
            if dashboard_type == 'finished':
                materials_data = current_data.get("finished_dashboard", [])
            else:
                materials_data = current_data.get("materials_dashboard", [])
            
            for item in materials_data:
                if item.get('物料') == material_id:
                    material_info = item
                    break
        
        if not material_info:
            app_logger.warning(f"get_material_details: 找不到物料 {material_id} (type={dashboard_type})")
            return jsonify({"error": "找不到該物料"}), 404
        
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
                
                substitute_inventory.append({
                    '物料': item.get('物料', ''),
                    '物料說明': item.get('物料說明', ''),
                    'unrestricted_stock': sub_unrestricted,
                    'inspection_stock': sub_inspection
                })
        
        return jsonify({
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
                material_record.updated_at = datetime.utcnow()
                app_logger.info(f"更新物料 {material_id} 的採購人員為: {new_buyer_name}")
            else:
                # 自動新增物料到資料庫
                material_record = Material(
                    material_id=material_id,
                    description=material_description or '',
                    base_material_id=base_material_id,
                    buyer_id=buyer.id if buyer else None,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
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
    """取得所有交期資料 用於統計"""
    try:
        import os
        import json
        from datetime import datetime
        
        delivery_file = 'instance/delivery_schedules.json'
        
        if os.path.exists(delivery_file):
            with open(delivery_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # 🔧 選擇距離今天最近且未過期的交期
            schedules = {}
            today = datetime.now().date()
            
            for material_id, history in data.get('delivery_schedules', {}).items():
                if history:
                    # 過濾出未過期的交期
                    valid_schedules = []
                    for schedule in history:
                        try:
                            delivery_date = datetime.fromisoformat(schedule['expected_date']).date()
                            if delivery_date >= today:
                                valid_schedules.append({
                                    **schedule,
                                    'date_obj': delivery_date
                                })
                        except (ValueError, KeyError):
                            continue
                    
                    # 如果有未過期的交期，選擇最近的一筆
                    if valid_schedules:
                        nearest = min(valid_schedules, key=lambda x: x['date_obj'])
                        del nearest['date_obj']  # 移除臨時欄位
                        schedules[material_id] = nearest
                    # 如果都過期了，取最新建立的那一筆（最後一筆）
                    else:
                        schedules[material_id] = history[-1]
            
            return jsonify({
                "schedules": schedules,
                "total": len(schedules)
            })
        else:
            return jsonify({
                "schedules": {},
                "total": 0
            })
    except Exception as e:
        app_logger.error(f"取得所有交期失敗: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@api_bp.route('/delivery/<material_id>')
def get_delivery(material_id):
    """取得物料的交期資訊"""
    try:
        import os
        import json
        from datetime import datetime
        
        delivery_file = 'instance/delivery_schedules.json'
        
        if os.path.exists(delivery_file):
            with open(delivery_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            schedules = data.get('delivery_schedules', {}).get(material_id, [])
            
            # 🔧 選擇距離今天最近且未過期的交期
            current_delivery = None
            today = datetime.now().date()
            
            if schedules:
                # 過濾出未過期的交期
                valid_schedules = []
                for schedule in schedules:
                    try:
                        delivery_date = datetime.fromisoformat(schedule['expected_date']).date()
                        if delivery_date >= today:
                            valid_schedules.append({
                                **schedule,
                                'date_obj': delivery_date
                            })
                    except (ValueError, KeyError):
                        continue
                
                # 如果有未過期的交期，選擇最近的一筆
                if valid_schedules:
                    nearest = min(valid_schedules, key=lambda x: x['date_obj'])
                    del nearest['date_obj']
                    current_delivery = nearest
                # 如果都過期了，取最新建立的那一筆
                else:
                    current_delivery = schedules[-1]
            
            return jsonify({
                "delivery": current_delivery,
                "history": schedules
            })
        else:
            return jsonify({
                "delivery": None,
                "history": []
            })
    except Exception as e:
        app_logger.error(f"取得交期失敗: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@api_bp.route('/delivery', methods=['POST'])
def save_delivery():
    """儲存交期資訊"""
    try:
        import os
        import json
        import time
        from datetime import datetime
        
        form_data = request.get_json()
        material_id = form_data.get('material_id')
        
        if not material_id:
            return jsonify({"success": False, "error": "缺少物料編號"}), 400
        
        delivery_file = 'instance/delivery_schedules.json'
        
        # 載入現有資料
        if os.path.exists(delivery_file):
            with open(delivery_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
        else:
            data = {"delivery_schedules": {}}
        
        if material_id not in data['delivery_schedules']:
            data['delivery_schedules'][material_id] = []
        
        # 新增交期記錄
        new_delivery = {
            "id": f"DS-{int(time.time())}",
            "expected_date": form_data.get('expected_date'),
            "quantity": form_data.get('quantity'),
            "po_number": form_data.get('po_number', ''),
            "supplier": form_data.get('supplier', ''),
            "notes": form_data.get('notes', ''),
            "status": "pending",
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        data['delivery_schedules'][material_id].append(new_delivery)
        
        # 確保目錄存在
        os.makedirs(os.path.dirname(delivery_file), exist_ok=True)
        
        # 儲存
        with open(delivery_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        app_logger.info(f"已儲存物料 {material_id} 的交期: {new_delivery['expected_date']}")
        
        return jsonify({
            "success": True,
            "delivery": new_delivery
        })
        
    except Exception as e:
        app_logger.error(f"儲存交期失敗: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
