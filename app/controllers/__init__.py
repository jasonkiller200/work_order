# app/controllers/__init__.py
# 控制器模組初始化檔案

from .page_controller import page_bp
from .api_controller import api_bp
from .auth_controller import auth_bp
from .user_api_controller import user_api_bp

__all__ = ['page_bp', 'api_bp', 'auth_bp', 'user_api_bp']
