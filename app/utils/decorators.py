# app/utils/decorators.py
# 自訂裝飾器

from functools import wraps
from flask import session, redirect, url_for, flash, jsonify

def login_required(f):
    """登入驗證裝飾器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            flash('請先登入才能訪問此頁面', 'warning')
            return redirect(url_for('auth.login'))
        return f(*args, **kwargs)
    return decorated_function

def cache_required(f):
    """快取檢查裝飾器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        from app.services.cache_service import cache_manager
        if not cache_manager.is_data_loaded():
            return jsonify({"error": "資料尚未載入"}), 500
        return f(*args, **kwargs)
    return decorated_function
