"""
台灣假日 API
提供前端日期選擇器排除假日使用

台灣補假規則：
- 國定假日若在週六，則週五補假
- 國定假日若在週日，則週一補假
"""
from flask import Blueprint, jsonify
import holidays
from datetime import date, timedelta

holidays_bp = Blueprint('holidays', __name__)


def get_taiwan_holidays_with_observed(year):
    """
    取得台灣假日（含補假）
    
    補假規則：
    - 國定假日若在週六，則週五補假
    - 國定假日若在週日，則週一補假
    
    Args:
        year: 年份
    
    Returns:
        dict: {date: name} 格式的假日字典
    """
    # 取得原始台灣假日
    tw_holidays = holidays.Taiwan(years=year)
    
    # 建立新的假日字典（包含補假）
    all_holidays = {}
    
    for holiday_date, holiday_name in tw_holidays.items():
        # 加入原始假日
        all_holidays[holiday_date] = holiday_name
        
        # 檢查是否需要補假
        weekday = holiday_date.weekday()  # 0=週一, 5=週六, 6=週日
        
        if weekday == 5:  # 週六 -> 週五補假
            observed_date = holiday_date - timedelta(days=1)
            # 確保補假日不會覆蓋其他假日
            if observed_date not in all_holidays:
                all_holidays[observed_date] = f"{holiday_name}（補假）"
        elif weekday == 6:  # 週日 -> 週一補假
            observed_date = holiday_date + timedelta(days=1)
            # 確保補假日不會覆蓋其他假日
            if observed_date not in all_holidays:
                all_holidays[observed_date] = f"{holiday_name}（補假）"
    
    return all_holidays


@holidays_bp.route('/api/holidays/<int:year>', methods=['GET'])
def get_holidays(year):
    """
    取得指定年份的台灣假日清單（含補假）
    
    Args:
        year: 年份 (例如 2026)
    
    Returns:
        JSON 格式的假日清單
    """
    try:
        # 取得台灣假日（含補假）
        tw_holidays = get_taiwan_holidays_with_observed(year)
        
        # 轉換為清單格式
        holiday_list = []
        for holiday_date, holiday_name in sorted(tw_holidays.items()):
            holiday_list.append({
                'date': holiday_date.strftime('%Y-%m-%d'),
                'name': holiday_name
            })
        
        return jsonify({
            'success': True,
            'year': year,
            'holidays': holiday_list
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@holidays_bp.route('/api/holidays/<int:start_year>/<int:end_year>', methods=['GET'])
def get_holidays_range(start_year, end_year):
    """
    取得指定年份範圍的台灣假日清單（含補假）
    
    Args:
        start_year: 起始年份
        end_year: 結束年份
    
    Returns:
        JSON 格式的假日清單
    """
    try:
        if end_year < start_year:
            return jsonify({
                'success': False,
                'error': '結束年份必須大於等於起始年份'
            }), 400
        
        if end_year - start_year > 5:
            return jsonify({
                'success': False,
                'error': '年份範圍不可超過 5 年'
            }), 400
        
        # 取得多年份台灣假日（含補假）
        all_holidays = {}
        for year in range(start_year, end_year + 1):
            year_holidays = get_taiwan_holidays_with_observed(year)
            all_holidays.update(year_holidays)
        
        # 轉換為清單格式
        holiday_list = []
        for holiday_date, holiday_name in sorted(all_holidays.items()):
            holiday_list.append({
                'date': holiday_date.strftime('%Y-%m-%d'),
                'name': holiday_name
            })
        
        return jsonify({
            'success': True,
            'start_year': start_year,
            'end_year': end_year,
            'holidays': holiday_list
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
