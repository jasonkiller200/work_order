# app/controllers/auth_controller.py
# 認證控制器

from flask import Blueprint, render_template, request, session, flash, redirect, url_for
from app.config import Config

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    """登入頁面"""
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        if username in Config.USERS and Config.USERS[username] == password:
            session['logged_in'] = True
            flash('登入成功！', 'success')
            return redirect(url_for('page.admin_dashboard'))
        else:
            flash('無效的用戶名或密碼', 'danger')
    return render_template('login.html')

@auth_bp.route('/logout')
def logout():
    """登出"""
    session.pop('logged_in', None)
    flash('您已登出', 'info')
    return redirect(url_for('auth.login'))
