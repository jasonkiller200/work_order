# app/controllers/user_api_controller.py
# 使用者管理 API 控制器

import logging
from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash, check_password_hash
from app.models.database import db, User
from app.utils.decorators import login_required
from app.utils.helpers import get_taiwan_time

app_logger = logging.getLogger(__name__)

user_api_bp = Blueprint('user_api', __name__, url_prefix='/api')


@user_api_bp.route('/users', methods=['GET'])
@login_required
def get_users():
    """取得使用者列表"""
    try:
        search = request.args.get('search', '').strip()
        role = request.args.get('role', '')
        status = request.args.get('status', '')  # active, inactive, all
        
        query = User.query
        
        # 搜尋過濾
        if search:
            search_pattern = f'%{search}%'
            query = query.filter(
                db.or_(
                    User.id.ilike(search_pattern),
                    User.username.ilike(search_pattern),
                    User.full_name.ilike(search_pattern),
                    User.email.ilike(search_pattern),
                    User.department.ilike(search_pattern)
                )
            )
        
        # 角色過濾
        if role:
            query = query.filter(User.role == role)
        
        # 狀態過濾
        if status == 'active':
            query = query.filter(User.is_active == True)
        elif status == 'inactive':
            query = query.filter(User.is_active == False)
        
        users = query.order_by(User.created_at.desc()).all()
        
        result = []
        for user in users:
            result.append({
                'id': user.id,
                'username': user.username,
                'full_name': user.full_name,
                'email': user.email,
                'department': user.department,
                'role': user.role,
                'is_active': user.is_active,
                'created_at': user.created_at.strftime('%Y-%m-%d %H:%M') if user.created_at else None,
                'updated_at': user.updated_at.strftime('%Y-%m-%d %H:%M') if user.updated_at else None
            })
        
        return jsonify({'success': True, 'users': result})
    except Exception as e:
        app_logger.error(f"取得使用者列表失敗: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@user_api_bp.route('/users/<user_id>', methods=['GET'])
@login_required
def get_user(user_id):
    """取得單一使用者"""
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'success': False, 'error': '使用者不存在'}), 404
        
        return jsonify({
            'success': True,
            'user': {
                'id': user.id,
                'username': user.username,
                'full_name': user.full_name,
                'email': user.email,
                'department': user.department,
                'role': user.role,
                'is_active': user.is_active
            }
        })
    except Exception as e:
        app_logger.error(f"取得使用者失敗: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@user_api_bp.route('/users', methods=['POST'])
@login_required
def create_user():
    """新增使用者"""
    try:
        data = request.get_json()
        
        # 驗證必填欄位
        required_fields = ['id', 'username', 'password']
        for field in required_fields:
            if not data.get(field):
                return jsonify({'success': False, 'error': f'缺少必填欄位: {field}'}), 400
        
        # 檢查 ID 是否已存在
        if User.query.get(data['id']):
            return jsonify({'success': False, 'error': '員工編號已存在'}), 400
        
        # 檢查 username 是否已存在
        if User.query.filter_by(username=data['username']).first():
            return jsonify({'success': False, 'error': '帳號已存在'}), 400
        
        # 建立新使用者
        new_user = User(
            id=data['id'],
            username=data['username'],
            password_hash=generate_password_hash(data['password']),
            full_name=data.get('full_name', ''),
            email=data.get('email', ''),
            department=data.get('department', ''),
            role=data.get('role', 'buyer'),
            is_active=True
        )
        
        db.session.add(new_user)
        db.session.commit()
        
        app_logger.info(f"新增使用者成功: {data['username']}")
        return jsonify({'success': True, 'message': '使用者建立成功'})
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"新增使用者失敗: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@user_api_bp.route('/users/<user_id>', methods=['PUT'])
@login_required
def update_user(user_id):
    """更新使用者"""
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'success': False, 'error': '使用者不存在'}), 404
        
        data = request.get_json()
        
        # 檢查 username 是否與其他使用者重複
        if data.get('username') and data['username'] != user.username:
            existing = User.query.filter_by(username=data['username']).first()
            if existing:
                return jsonify({'success': False, 'error': '帳號已被其他使用者使用'}), 400
            user.username = data['username']
        
        # 更新其他欄位
        if 'full_name' in data:
            user.full_name = data['full_name']
        if 'email' in data:
            user.email = data['email']
        if 'department' in data:
            user.department = data['department']
        if 'role' in data:
            user.role = data['role']
        
        user.updated_at = get_taiwan_time()
        db.session.commit()
        
        app_logger.info(f"更新使用者成功: {user_id}")
        return jsonify({'success': True, 'message': '使用者更新成功'})
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"更新使用者失敗: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@user_api_bp.route('/users/<user_id>/toggle-active', methods=['POST'])
@login_required
def toggle_user_active(user_id):
    """切換使用者啟用狀態"""
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'success': False, 'error': '使用者不存在'}), 404
        
        user.is_active = not user.is_active
        user.updated_at = get_taiwan_time()
        db.session.commit()
        
        status = '啟用' if user.is_active else '停用'
        app_logger.info(f"使用者 {user_id} 已{status}")
        return jsonify({
            'success': True,
            'message': f'使用者已{status}',
            'is_active': user.is_active
        })
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"切換使用者狀態失敗: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@user_api_bp.route('/users/<user_id>/reset-password', methods=['POST'])
@login_required
def reset_user_password(user_id):
    """重設使用者密碼"""
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'success': False, 'error': '使用者不存在'}), 404
        
        data = request.get_json()
        new_password = data.get('new_password')
        
        if not new_password or len(new_password) < 6:
            return jsonify({'success': False, 'error': '密碼長度至少需要6個字元'}), 400
        
        user.password_hash = generate_password_hash(new_password)
        user.updated_at = get_taiwan_time()
        db.session.commit()
        
        app_logger.info(f"使用者 {user_id} 密碼已重設")
        return jsonify({'success': True, 'message': '密碼重設成功'})
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"重設密碼失敗: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@user_api_bp.route('/users/<user_id>', methods=['DELETE'])
@login_required
def delete_user(user_id):
    """刪除使用者"""
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'success': False, 'error': '使用者不存在'}), 404
        
        # 檢查是否有關聯資料
        if user.materials or user.purchase_orders:
            return jsonify({
                'success': False,
                'error': '此使用者有關聯的物料或採購單，無法刪除。請改用停用功能。'
            }), 400
        
        db.session.delete(user)
        db.session.commit()
        
        app_logger.info(f"刪除使用者成功: {user_id}")
        return jsonify({'success': True, 'message': '使用者已刪除'})
    except Exception as e:
        db.session.rollback()
        app_logger.error(f"刪除使用者失敗: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
