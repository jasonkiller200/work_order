# app/controllers/page_controller.py
# 頁面控制器

from flask import Blueprint, render_template, redirect, url_for, request
from app.services.traffic_service import TrafficService
from app.utils.decorators import login_required

page_bp = Blueprint('page', __name__)

@page_bp.route('/')
def root():
    """首頁重定向到訂單查詢"""
    return redirect(url_for('page.order_query'))

@page_bp.route('/procurement')
def procurement():
    """採購頁面"""
    TrafficService.record_page_view('procurement.html', request.remote_addr)
    return render_template('procurement.html')

@page_bp.route('/order_query')
def order_query():
    """訂單查詢頁面"""
    TrafficService.record_page_view('order_query.html', request.remote_addr)
    return render_template('order_query.html')

@page_bp.route('/admin_dashboard')
@login_required
def admin_dashboard():
    """管理後台頁面"""
    TrafficService.record_page_view('admin_dashboard.html', request.remote_addr)
    return render_template('admin_dashboard.html')

@page_bp.route('/part-drawing-management')
@login_required
def part_drawing_management():
    """品號-圖號維護頁面"""
    TrafficService.record_page_view('part_drawing_management.html', request.remote_addr)
    return render_template('part_drawing_management.html')

@page_bp.route('/open-purchase-orders')
def open_purchase_orders():
    """未結案採購單查詢頁面"""
    TrafficService.record_page_view('open_purchase_orders.html', request.remote_addr)
    return render_template('open_purchase_orders.html')

@page_bp.route('/component-requirements')
@login_required
def component_requirements():
    """成品組件需求維護頁面"""
    TrafficService.record_page_view('component_requirements.html', request.remote_addr)
    return render_template('component_requirements.html')
