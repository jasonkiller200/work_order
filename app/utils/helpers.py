# app/utils/helpers.py
# 輔助函式

import math
import pandas as pd

def replace_nan_in_dict(obj):
    """
    遞迴地將字典或列表中的 NaN 替換為空字串
    
    Args:
        obj: 要處理的物件（字典、列表或其他）
        
    Returns:
        處理後的物件
    """
    if isinstance(obj, dict):
        return {k: replace_nan_in_dict(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [replace_nan_in_dict(elem) for elem in obj]
    elif isinstance(obj, float) and math.isnan(obj):
        return ''
    return obj

def format_date(date_value):
    """
    格式化日期為字串
    
    Args:
        date_value: 日期值（可能是 Timestamp 或其他格式）
        
    Returns:
        格式化後的日期字串，如果無效則返回空字串
    """
    if isinstance(date_value, pd.Timestamp):
        return date_value.strftime('%Y-%m-%d')
    elif pd.isna(date_value):
        return ''
    return str(date_value)
