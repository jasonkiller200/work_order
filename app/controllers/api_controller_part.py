
@api_bp.route('/purchase_orders/<material_id>')
@cache_required
def get_purchase_orders_by_material(material_id):
    """
    根據物料編號查詢相關的採購單
    """
    try:
        # 查詢該物料的所有採購單，並按交貨日期排序
        purchase_orders = PurchaseOrder.query.filter_by(material_id=material_id).order_by(PurchaseOrder.original_delivery_date).all()
        
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
