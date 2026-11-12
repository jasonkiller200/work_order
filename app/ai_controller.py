# -*- coding: utf-8 -*-
"""
AI 採購與訂單規格助手控制器 (app/ai_controller.py)

支援三引擎架構：
1. vllm_local（預設）：區網 Qwen3.8-27B (http://192.168.7.22:8001/v1)，原生 Function Calling、支援併發
2. cli：本機 Antigravity CLI (agy.exe) 免金鑰 OAuth 模式，stateless 快照重注入 + 全域鎖
3. sdk：Gemini API Key 模式（設定金鑰後啟用）

資料原則：
- 不做向量 RAG（資料每 15 分鐘動態變動）
- 6 支唯讀 Python Tools 直接查詢 cache_manager 雙緩衝記憶體快取與唯讀 DB，零 P 碟磁碟 I/O
"""

import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import requests
from flask import Blueprint, current_app, jsonify, render_template, request, session

from app.config import Config
from app.models.database import (
    AiConfig,
    AiMessage,
    AiSession,
    DeliverySchedule,
    PartDrawingMapping,
    PurchaseOrder,
    db,
)
from app.services.cache_service import cache_manager
from app.services.traffic_service import TrafficService
from app.utils.decorators import login_required
from app.utils.helpers import get_taiwan_time

app_logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Windows 背景程序防彈黑窗 Monkeypatch (藍本模式 6)
# ---------------------------------------------------------------------------
if os.name == 'nt' and not getattr(subprocess.Popen, '_create_no_window_patched', False):
    _orig_popen_init = subprocess.Popen.__init__
    _CREATE_NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)

    def _patched_popen_init(self, *args, **kwargs):
        if 'creationflags' not in kwargs or kwargs['creationflags'] is None:
            kwargs['creationflags'] = _CREATE_NO_WINDOW
        else:
            kwargs['creationflags'] |= _CREATE_NO_WINDOW
        _orig_popen_init(self, *args, **kwargs)

    subprocess.Popen.__init__ = _patched_popen_init
    subprocess.Popen._create_no_window_patched = True


# ---------------------------------------------------------------------------
# 常數與設定預設值
# ---------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
AI_EMPTY_WORKDIR = _PROJECT_ROOT / 'scratch' / 'ai_chat_ws'
AI_EMPTY_WORKDIR.mkdir(parents=True, exist_ok=True)

DEFAULT_AGY_PATH = r'C:\Users\ralf\AppData\Local\agy\bin\agy.exe'
DEFAULT_VLLM_BASE_URL = 'http://192.168.7.22:8001/v1'
DEFAULT_VLLM_MODEL = '/home/jason/models/Qwen3.8-27B-AWQ-INT4'
DEFAULT_CLI_MODEL = 'gemini-3.8-flash'
DEFAULT_SDK_MODEL = 'gemini-2.5-flash'
DEFAULT_ENGINE_MODE = 'vllm_local'

# agy 為單實例共享 CLI（與 Hermes bot 共用），加全域鎖避免同時呼叫衝突
_agy_lock = threading.Lock()


def _resolve_agy_bin() -> str:
    if os.path.isfile(DEFAULT_AGY_PATH):
        return DEFAULT_AGY_PATH
    found = shutil.which('agy')
    return found or DEFAULT_AGY_PATH


def get_visitor_id() -> str:
    """取得每台瀏覽器專屬的識別碼（優先複用 365 天 pv_vid cookie，並同步至 session 確保首個請求前後一致）"""
    if 'ai_visitor_id' in session and session['ai_visitor_id']:
        return session['ai_visitor_id']
    vid = request.cookies.get(Config.PV_COOKIE_NAME)
    if vid and len(vid) <= 64:
        session['ai_visitor_id'] = vid
        return vid
    new_vid = str(uuid.uuid4())
    session['ai_visitor_id'] = new_vid
    return new_vid


# ---------------------------------------------------------------------------
# 6 支唯讀採購與訂單規格 Tools（直連 cache_manager 記憶體快取與唯讀 DB）
# ---------------------------------------------------------------------------

def _get_cache_or_snapshot() -> dict:
    """優先取線上雙緩衝記憶體快取；若剛啟動尚未載入完，嘗試讀最新 snapshot 檔作為唯讀備援"""
    data = cache_manager.get_current_data()
    if data:
        return data
    snap_dir = _PROJECT_ROOT / 'snapshots'
    if snap_dir.is_dir():
        snaps = sorted(snap_dir.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
        for snap in snaps[:1]:
            try:
                with open(snap, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
    return {}


def tool_get_shortage_summary(dashboard_type: str = 'main', buyer: str = None) -> dict:
    """
    1. 缺料/延遲總覽
    Args:
        dashboard_type: 'main' (半品/主採購儀表板，預設) 或 'finished' (成品儀表板) 或 'both'
        buyer: 選填，指定採購人員姓名篩選（如 '陳○○'）
    """
    data = _get_cache_or_snapshot()
    if not data:
        return {'error': '目前系統快取資料尚未載入完成，請稍後再試。'}

    targets = []
    if dashboard_type in ('main', 'both', None, ''):
        targets.extend(data.get('materials_dashboard', []))
    if dashboard_type in ('finished', 'both'):
        targets.extend(data.get('finished_dashboard', []))

    buyer_kw = (buyer or '').strip()
    if buyer_kw:
        targets = [m for m in targets if buyer_kw in str(m.get('採購人員', ''))]

    total_items = len(targets)
    shortage_30_days = [m for m in targets if m.get('shortage_within_30_days')]
    all_shortage = [m for m in targets if m.get('is_all_shortage') or float(m.get('current_shortage', 0) or 0) > 0]
    no_delivery = [m for m in targets if m.get('no_delivery')]
    delivery_delayed = [m for m in targets if m.get('is_delivery_delayed')]
    overdue_demand = [m for m in targets if m.get('is_overdue_demand')]
    today_arrival = [m for m in targets if m.get('is_today_arrival')]
    due_soon = [m for m in targets if m.get('is_due_soon')]

    # 依採購人員統計缺料與無交期筆數
    buyer_stats = {}
    for m in all_shortage:
        b_name = str(m.get('採購人員') or '未指派').strip() or '未指派'
        st = buyer_stats.setdefault(b_name, {'shortage_count': 0, 'no_delivery_count': 0, 'delayed_count': 0, 'overdue_count': 0})
        st['shortage_count'] += 1
        if m.get('no_delivery'):
            st['no_delivery_count'] += 1
        if m.get('is_delivery_delayed'):
            st['delayed_count'] += 1
        if m.get('is_overdue_demand'):
            st['overdue_count'] += 1

    # 取出前 15 筆最緊急的缺料項目（優先：逾期欠料 > 30日內缺料且無交期 > 交貨延期）
    urgent_candidates = sorted(
        all_shortage,
        key=lambda m: (
            0 if m.get('is_overdue_demand') else 1,
            0 if m.get('no_delivery') else 1,
            0 if m.get('is_delivery_delayed') else 1,
            str(m.get('earliest_demand_date') or '9999-12-31'),
        ),
    )[:15]

    urgent_list = [
        {
            '物料': m.get('物料'),
            '物料說明': m.get('物料說明'),
            '採購人員': m.get('採購人員') or '未指派',
            '現有庫存': float(m.get('unrestricted_stock', 0) or 0) + float(m.get('inspection_stock', 0) or 0),
            '總需求': float(m.get('total_demand', 0) or 0),
            '目前缺料數': float(m.get('current_shortage', 0) or 0),
            '最早需求日': m.get('earliest_demand_date') or '-',
            '預計交期': m.get('delivery_date') or '無交期',
            '交期數量': m.get('delivery_qty'),
            '延遲天數': m.get('_computed_delay_days', 0),
            '首筆缺料工單': m.get('first_shortage_order') or '-',
            '對應成品出貨日': m.get('finished_shipment_date') or '-',
        }
        for m in urgent_candidates
    ]

    return {
        '快取更新時間': cache_manager.get_last_update_time() or '未知',
        '查詢範圍': dashboard_type or 'main',
        '篩選採購員': buyer_kw or '全部',
        '統計摘要': {
            '需求物料總筆數': total_items,
            '總缺料項目數': len(all_shortage),
            '30日內缺料數': len(shortage_30_days),
            '無交期項目數': len(no_delivery),
            '交貨延期項目數': len(delivery_delayed),
            '需求逾期欠料數': len(overdue_demand),
            '今日預計到貨數': len(today_arrival),
            '7日內即將到貨數': len(due_soon),
        },
        '各採購人員統計': buyer_stats,
        '前15筆緊急缺料明細': urgent_list,
    }


def tool_get_material_detail(material_id: str) -> dict:
    """
    2. 單一物料完整明細（庫存、缺料工單需求、採購單 PO、分批交期、替代品）
    Args:
        material_id: 物料品號（支援完整品號或前 10 碼模糊匹配）
    """
    mat_kw = (material_id or '').strip()
    if not mat_kw:
        return {'error': '請提供 material_id（物料品號）'}

    data = _get_cache_or_snapshot()
    if not data:
        return {'error': '系統快取尚未載入'}

    all_dash = (data.get('materials_dashboard') or []) + (data.get('finished_dashboard') or [])
    inv_dict = data.get('inventory_dict') or {}

    # 精確匹配優先，否則前綴/包含匹配
    matched_mat = None
    for m in all_dash:
        if str(m.get('物料', '')).strip() == mat_kw:
            matched_mat = m
            break
    if not matched_mat:
        for m in all_dash:
            if mat_kw.upper() in str(m.get('物料', '')).upper():
                matched_mat = m
                break

    exact_id = str(matched_mat.get('物料')).strip() if matched_mat else mat_kw
    inv_info = inv_dict.get(exact_id) or matched_mat or {}

    # 需求明細（合併半品與成品）
    demands_main = (data.get('demand_details_map') or {}).get(exact_id, [])
    demands_fin = (data.get('finished_demand_details_map') or {}).get(exact_id, [])
    demands = [
        {
            '訂單': d.get('訂單'),
            '需求日期': d.get('需求日期'),
            '未結數量': d.get('未結數量 (EINHEIT)'),
            '配賦後剩餘庫存': d.get('remaining_stock'),
        }
        for d in (demands_main + demands_fin)
        if float(d.get('未結數量 (EINHEIT)', 0) or 0) > 0
    ]
    demands.sort(key=lambda x: x.get('需求日期') or '9999-12-31')

    # DB 分批交期與未結採購單
    schedules_out = []
    pos_out = []
    drawing_number = matched_mat.get('drawing_number') if matched_mat else None
    try:
        schedules = (
            DeliverySchedule.query.filter(
                DeliverySchedule.material_id == exact_id,
                DeliverySchedule.status.notin_(['completed', 'cancelled']),
            )
            .order_by(DeliverySchedule.expected_date)
            .all()
        )
        schedules_out = [
            {
                '預計交期': s.expected_date.strftime('%Y-%m-%d') if hasattr(s.expected_date, 'strftime') else str(s.expected_date),
                '交貨數量': float(s.quantity or 0),
                '已收數量': float(s.received_quantity or 0),
                '採購單號': s.po_number or '',
                '供應商': s.supplier or '',
                '備註': s.notes or '',
                '狀態': s.status,
            }
            for s in schedules
        ]

        pos = (
            PurchaseOrder.query.filter(
                PurchaseOrder.material_id == exact_id,
                PurchaseOrder.status.notin_(['completed', 'cancelled']),
                PurchaseOrder.outstanding_quantity > 0,
            )
            .order_by(PurchaseOrder.updated_delivery_date)
            .limit(20)
            .all()
        )
        pos_out = [
            {
                '採購單號': p.po_number,
                '供應商': p.supplier or '',
                '訂購數量': float(p.ordered_quantity or 0),
                '未交數量': float(p.outstanding_quantity or 0),
                '原定交期': p.original_delivery_date.strftime('%Y-%m-%d') if p.original_delivery_date else '',
                '更新交期': p.updated_delivery_date.strftime('%Y-%m-%d') if p.updated_delivery_date else '',
            }
            for p in pos
        ]

        if not drawing_number:
            prefix = exact_id[:10] if len(exact_id) >= 10 else exact_id
            dm = PartDrawingMapping.query.filter(PartDrawingMapping.part_number.like(f'{prefix}%')).first()
            if dm:
                drawing_number = dm.drawing_number
    except Exception as e:
        app_logger.warning(f'查詢物料 {exact_id} DB 交期/PO 失敗: {e}')

    # 替代品（同前 10 碼）
    base_prefix = exact_id[:10] if len(exact_id) >= 10 else exact_id
    substitutes = []
    for item in data.get('inventory_data') or []:
        cand_id = str(item.get('物料', '')).strip()
        if cand_id and cand_id != exact_id and cand_id[:10] == base_prefix:
            substitutes.append({
                '替代物料': cand_id,
                '物料說明': item.get('物料說明', ''),
                '未限制庫存': float(item.get('未限制', 0) or 0),
                '品檢中庫存': float(item.get('品質檢驗中', 0) or 0),
            })

    if not matched_mat and not inv_info and not demands and not pos_out:
        return {'error': f'找不到物料 {mat_kw} 的相關庫存或需求資料'}

    return {
        '物料': exact_id,
        '物料說明': (matched_mat or {}).get('物料說明') or inv_info.get('物料說明') or '',
        '圖號': drawing_number or '',
        '採購人員': (matched_mat or {}).get('採購人員') or '',
        '庫存摘要': {
            '未限制庫存': float((matched_mat or {}).get('unrestricted_stock', inv_info.get('未限制', 0)) or 0),
            '品質檢驗中': float((matched_mat or {}).get('inspection_stock', inv_info.get('品質檢驗中', 0)) or 0),
            '在途採購量': float((matched_mat or {}).get('on_order_stock', 0) or 0),
            '目前缺料數': float((matched_mat or {}).get('current_shortage', 0) or 0),
            '預計缺料數(扣在途)': float((matched_mat or {}).get('projected_shortage', 0) or 0),
        },
        '狀態標籤': {
            '是否缺料': bool((matched_mat or {}).get('is_all_shortage')),
            '無交期': bool((matched_mat or {}).get('no_delivery')),
            '交貨延期': bool((matched_mat or {}).get('is_delivery_delayed')),
            '延遲天數': int((matched_mat or {}).get('_computed_delay_days', 0) or 0),
            '需求逾期欠料': bool((matched_mat or {}).get('is_overdue_demand')),
            '首筆缺料工單': (matched_mat or {}).get('first_shortage_order') or '',
            '對應成品工單': (matched_mat or {}).get('finished_order_id') or '',
            '對應成品出貨日': (matched_mat or {}).get('finished_shipment_date') or '',
        },
        '分批交期排程': schedules_out,
        '未結採購單_PO': pos_out,
        '工單需求明細_前25筆': demands[:25],
        '需求總筆數': len(demands),
        '同前10碼替代品': substitutes[:10],
    }


def tool_get_two_week_list(buyer: str = None) -> dict:
    """
    3. 兩週內到期/交貨延期/逾期未交清單
    Args:
        buyer: 選填，採購人員姓名篩選
    """
    data = _get_cache_or_snapshot()
    if not data:
        return {'error': '系統快取尚未載入'}

    today = get_taiwan_time().date()
    two_weeks_later = today + timedelta(days=14)
    buyer_kw = (buyer or '').strip()

    materials = (data.get('materials_dashboard') or []) + (data.get('finished_dashboard') or [])
    seen = set()
    delayed_items = []
    two_week_arrivals = []
    urgent_no_delivery = []

    for m in materials:
        mat_id = m.get('物料')
        if not mat_id or mat_id in seen:
            continue
        if buyer_kw and buyer_kw not in str(m.get('採購人員', '')):
            continue
        seen.add(mat_id)

        del_date_str = m.get('delivery_date')
        del_date = None
        if del_date_str:
            try:
                del_date = datetime.strptime(str(del_date_str)[:10], '%Y-%m-%d').date()
            except ValueError:
                pass

        row_info = {
            '物料': mat_id,
            '物料說明': m.get('物料說明', ''),
            '採購人員': m.get('採購人員') or '未指派',
            '目前缺料數': float(m.get('current_shortage', 0) or 0),
            '最早需求日': m.get('earliest_demand_date') or '-',
            '預計交期': del_date_str or '無交期',
            '交期數量': m.get('delivery_qty'),
            '延遲天數': int(m.get('_computed_delay_days', 0) or 0),
            '首筆缺料工單': m.get('first_shortage_order') or '-',
            '成品出貨日': m.get('finished_shipment_date') or '-',
        }

        if m.get('is_delivery_delayed') or m.get('is_overdue_demand'):
            delayed_items.append(row_info)
        if del_date and today <= del_date <= two_weeks_later:
            two_week_arrivals.append(row_info)
        if m.get('no_delivery') and m.get('shortage_within_30_days'):
            urgent_no_delivery.append(row_info)

    delayed_items.sort(key=lambda x: (-x['延遲天數'], x['最早需求日']))
    two_week_arrivals.sort(key=lambda x: x['預計交期'])
    urgent_no_delivery.sort(key=lambda x: x['最早需求日'])

    return {
        '基準日期': today.strftime('%Y-%m-%d'),
        '兩週截止日': two_weeks_later.strftime('%Y-%m-%d'),
        '篩選採購員': buyer_kw or '全部',
        '交貨延期與逾期欠料筆數': len(delayed_items),
        '交貨延期與逾期明細_前30筆': delayed_items[:30],
        '未來兩週內預計到貨筆數': len(two_week_arrivals),
        '未來兩週內預計到貨明細_前30筆': two_week_arrivals[:30],
        '30日內缺料但無交期筆數': len(urgent_no_delivery),
        '30日內缺料無交期明細_前20筆': urgent_no_delivery[:20],
    }


def tool_search_procurement(keyword: str) -> dict:
    """
    4. 跨物料/品名/圖號/工單/客戶/採購員關鍵字搜尋
    Args:
        keyword: 搜尋關鍵字（如品號、品名如 '軸承'、工單號、客戶名、採購員姓名）
    """
    kw = (keyword or '').strip()
    if not kw:
        return {'error': '請輸入搜尋關鍵字'}

    data = _get_cache_or_snapshot()
    if not data:
        return {'error': '系統快取尚未載入'}

    kw_upper = kw.upper()
    matched_materials = []
    seen_mat = set()

    for m in (data.get('materials_dashboard') or []) + (data.get('finished_dashboard') or []):
        mat_id = str(m.get('物料', '')).strip()
        if not mat_id or mat_id in seen_mat:
            continue
        haystack = ' '.join([
            mat_id,
            str(m.get('物料說明', '')),
            str(m.get('採購人員', '')),
            str(m.get('drawing_number', '')),
            str(m.get('first_shortage_order', '')),
            str(m.get('finished_order_id', '')),
        ]).upper()
        if kw_upper in haystack:
            seen_mat.add(mat_id)
            matched_materials.append({
                '物料': mat_id,
                '物料說明': m.get('物料說明', ''),
                '圖號': m.get('drawing_number', ''),
                '採購人員': m.get('採購人員', ''),
                '現有庫存': float(m.get('unrestricted_stock', 0) or 0) + float(m.get('inspection_stock', 0) or 0),
                '目前缺料數': float(m.get('current_shortage', 0) or 0),
                '最早需求日': m.get('earliest_demand_date') or '-',
                '預計交期': m.get('delivery_date') or '無交期',
                '首筆缺料工單': m.get('first_shortage_order') or '-',
            })

    # 搜尋工單總表摘要 (order_summary_map) 與工單缺料 (order_details_map)
    order_summary_map = data.get('order_summary_map') or {}
    order_details_map = data.get('order_details_map') or {}
    matched_orders = []
    for order_no, info in order_summary_map.items():
        haystack = ' '.join([
            str(order_no),
            str(info.get('訂單號碼', '')),
            str(info.get('下單客戶名稱', '')),
            str(info.get('物料品號', '')),
            str(info.get('物料說明', '')),
            str(info.get('廠別', '')),
        ]).upper()
        if kw_upper in haystack:
            order_mats = order_details_map.get(str(order_no), [])
            shortage_mats = [
                {
                    '物料': om.get('物料'),
                    '物料說明': om.get('物料說明'),
                    '未結數量': om.get('未結數量 (EINHEIT)'),
                    '缺料數': om.get('order_shortage'),
                }
                for om in order_mats
                if float(om.get('order_shortage', 0) or 0) > 0
            ]
            matched_orders.append({
                '工單號碼': order_no,
                '客戶名稱': info.get('下單客戶名稱', ''),
                '機型品號': info.get('物料品號', ''),
                '機型說明': info.get('物料說明', ''),
                '生產開始': info.get('生產開始', ''),
                '生產結束_出貨日': info.get('生產結束', ''),
                '廠別': info.get('廠別', ''),
                '該工單缺料項數': len(shortage_mats),
                '缺料前10項': shortage_mats[:10],
            })

    # 若 keyword 本身是工單號但不在 order_summary_map，也檢查 order_details_map
    if kw in order_details_map and not any(o['工單號碼'] == kw for o in matched_orders):
        order_mats = order_details_map.get(kw, [])
        shortage_mats = [
            {
                '物料': om.get('物料'),
                '物料說明': om.get('物料說明'),
                '未結數量': om.get('未結數量 (EINHEIT)'),
                '缺料數': om.get('order_shortage'),
            }
            for om in order_mats
            if float(om.get('order_shortage', 0) or 0) > 0
        ]
        matched_orders.append({
            '工單號碼': kw,
            '該工單總用料項數': len(order_mats),
            '該工單缺料項數': len(shortage_mats),
            '缺料前15項': shortage_mats[:15],
        })

    return {
        '搜尋關鍵字': kw,
        '符合條件物料筆數': len(matched_materials),
        '物料結果_前25筆': matched_materials[:25],
        '符合條件工單筆數': len(matched_orders),
        '工單結果_前20筆': matched_orders[:20],
    }


def tool_get_order_specs(order_id: str) -> dict:
    """
    5. 單筆訂單規格查詢（直接讀取記憶體 specs_map 與 order_summary_map，零磁碟 I/O）
    Args:
        order_id: 9 碼工單號碼（如 '100003884'）
    """
    oid = re.sub(r'\D', '', str(order_id or '').strip())
    if not oid:
        return {'error': '請提供有效的工單號碼（例如 100003884）'}

    data = _get_cache_or_snapshot()
    if not data:
        return {'error': '系統快取尚未載入'}

    specs_map = data.get('specs_map') or {}
    order_summary_map = data.get('order_summary_map') or {}
    order_details_map = data.get('order_details_map') or {}

    raw_specs = specs_map.get(oid, [])
    summary_info = order_summary_map.get(oid, {})
    order_mats = order_details_map.get(oid, [])

    if not raw_specs and not summary_info and not order_mats:
        return {'error': f'在目前快取中找不到工單 {oid} 的規格或工單資料'}

    formatted_specs = [
        {
            '特性說明': s.get('特性說明', ''),
            '特性值': s.get('特性值', ''),
            '值說明': s.get('值說明', ''),
            '內部特性號碼': s.get('內部特性號碼', ''),
        }
        for s in raw_specs
    ]

    shortage_mats = [
        {
            '物料': om.get('物料'),
            '物料說明': om.get('物料說明'),
            '需求日期': str(om.get('需求日期', ''))[:10],
            '未結數量': om.get('未結數量 (EINHEIT)'),
            '缺料數': om.get('order_shortage'),
        }
        for om in order_mats
        if float(om.get('order_shortage', 0) or 0) > 0
    ]

    return {
        '工單號碼': oid,
        '工單基本資訊': {
            '客戶名稱': summary_info.get('下單客戶名稱', ''),
            '訂單號碼': summary_info.get('訂單號碼', ''),
            '機型品號': summary_info.get('物料品號', ''),
            '機型說明': summary_info.get('物料說明', ''),
            '生產開始': summary_info.get('生產開始', ''),
            '生產結束_出貨日': summary_info.get('生產結束', ''),
            '廠別': summary_info.get('廠別', ''),
            '機械外包': summary_info.get('機械外包', ''),
            '電控外包': summary_info.get('電控外包', ''),
        },
        '規格特性總數': len(formatted_specs),
        '規格明細': formatted_specs,
        '工單缺料項數': len(shortage_mats),
        '工單缺料前10項': shortage_mats[:10],
    }


def tool_search_orders_by_spec(spec_keyword: str, value_keyword: str = None, exclude: bool = False) -> dict:
    """
    6. 反向/條件規格篩選（取代向量 RAG，直接於記憶體對 specs_map 結構化過濾）
    Args:
        spec_keyword: 特性說明/名稱關鍵字（如 'CTS'、'主軸'、'控制器'、'刀庫'）
        value_keyword: 選填，特性值或值說明關鍵字（如 '7.5KW'、'FANUC'、'24T'）
        exclude: 若為 True，則找出「沒有該特性」或「該特性為無/不帶/不符合 value_keyword」的工單
    """
    s_kw = (spec_keyword or '').strip().upper()
    v_kw = (value_keyword or '').strip().upper()
    if not s_kw and not v_kw:
        return {'error': '請至少提供 spec_keyword（特性關鍵字）或 value_keyword（規格值關鍵字）'}

    data = _get_cache_or_snapshot()
    if not data:
        return {'error': '系統快取尚未載入'}

    specs_map = data.get('specs_map') or {}
    order_summary_map = data.get('order_summary_map') or {}

    negative_markers = {'無', '否', '不附', '不帶', 'NONE', 'NO', 'N/A', 'WITHOUT', '0', '標準(無)'}
    matched_orders = []

    for oid, specs in specs_map.items():
        # 找出該工單中符合 spec_keyword 的特性列
        candidate_rows = []
        for row in specs:
            desc_text = f"{row.get('特性說明', '')} {row.get('內部特性號碼', '')}".upper()
            val_text = f"{row.get('特性值', '')} {row.get('值說明', '')}".upper()
            if not s_kw or s_kw in desc_text or s_kw in val_text:
                candidate_rows.append((row, val_text))

        has_positive_match = False
        matched_row_summary = []

        for row, val_text in candidate_rows:
            v_desc = str(row.get('值說明', '')).strip()
            v_code = str(row.get('特性值', '')).strip()
            is_neg_value = (
                v_desc.upper() in negative_markers
                or v_code.upper() in negative_markers
                or v_desc.startswith('無')
                or v_desc.startswith('不附')
                or v_desc.startswith('不帶')
            )
            if v_kw:
                if v_kw in val_text:
                    has_positive_match = True
                    matched_row_summary.append(f"{row.get('特性說明', '')}: {v_code} ({v_desc})")
            else:
                if not is_neg_value:
                    has_positive_match = True
                    matched_row_summary.append(f"{row.get('特性說明', '')}: {v_code} ({v_desc})")
                elif exclude:
                    matched_row_summary.append(f"{row.get('特性說明', '')}: {v_code} ({v_desc})")

        should_include = (not has_positive_match) if exclude else has_positive_match
        if should_include:
            s_info = order_summary_map.get(str(oid), {})
            matched_orders.append({
                '工單號碼': oid,
                '客戶名稱': s_info.get('下單客戶名稱', ''),
                '機型說明': s_info.get('物料說明', ''),
                '生產結束_出貨日': s_info.get('生產結束', ''),
                '匹配規格說明': matched_row_summary[:5] if matched_row_summary else (['無此特性項目'] if exclude else []),
            })

    matched_orders.sort(key=lambda x: (x.get('生產結束_出貨日') or '9999-12-31', x['工單號碼']))

    return {
        '特性關鍵字': spec_keyword,
        '規格值關鍵字': value_keyword or '',
        '反向排除模式_exclude': bool(exclude),
        '搜尋工單母體數': len(specs_map),
        '符合條件工單總數': len(matched_orders),
        '符合工單列表_前50筆': matched_orders[:50],
    }


# ---------------------------------------------------------------------------
# OpenAI / vLLM Function Calling Schema 定義
# ---------------------------------------------------------------------------
OPENAI_TOOLS_SCHEMA = [
    {
        'type': 'function',
        'function': {
            'name': 'get_shortage_summary',
            'description': '取得採購缺料與延遲總覽（總缺料、30日內缺料、無交期、交貨延期、需求逾期欠料、各採購人員統計與前15筆最緊急缺料明細）。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'dashboard_type': {
                        'type': 'string',
                        'enum': ['main', 'finished', 'both'],
                        'description': "儀表板類型：'main'=半品/主採購儀表板(預設)、'finished'=成品儀表板、'both'=兩者合併",
                    },
                    'buyer': {
                        'type': 'string',
                        'description': '選填，採購人員姓名關鍵字（例如：陳、林）',
                    },
                },
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'get_material_detail',
            'description': '查詢單一物料品號的完整明細（庫存、目前缺料、分批預計交期、未結採購單 PO、缺料工單需求明細、同前10碼替代品）。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'material_id': {
                        'type': 'string',
                        'description': '物料品號（完整品號或前10碼）',
                    },
                },
                'required': ['material_id'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'get_two_week_list',
            'description': '查詢未來兩週內預計到貨清單、交貨延期清單、以及30日內缺料但尚未填寫交期的清單。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'buyer': {
                        'type': 'string',
                        'description': '選填，依採購人員姓名篩選',
                    },
                },
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'search_procurement',
            'description': '依關鍵字跨物料（品號、品名、圖號、採購員）與工單（工單號、客戶名稱、機型）進行搜尋。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'keyword': {
                        'type': 'string',
                        'description': '搜尋關鍵字（品號、品名、工單號碼、客戶名稱或採購人員）',
                    },
                },
                'required': ['keyword'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'get_order_specs',
            'description': '依9碼工單號碼查詢該工單的完整訂單規格（特性說明、特性值、值說明）、客戶、機型、出貨日與該工單缺料項目。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'order_id': {
                        'type': 'string',
                        'description': '9碼工單號碼，例如 100003884',
                    },
                },
                'required': ['order_id'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'search_orders_by_spec',
            'description': '依訂單規格特性正反向篩選工單（例如：「哪些工單沒有 CTS」、「列出所有 7.5KW 主軸的工單」）。',
            'parameters': {
                'type': 'object',
                'properties': {
                    'spec_keyword': {
                        'type': 'string',
                        'description': '規格特性關鍵字，如 CTS、主軸、控制器、刀庫、冷卻',
                    },
                    'value_keyword': {
                        'type': 'string',
                        'description': '選填，規格特性值關鍵字，如 7.5KW、FANUC、24T',
                    },
                    'exclude': {
                        'type': 'boolean',
                        'description': '若為 true，代表反向查詢「沒有該特性 / 不含該規格值」的工單；預設為 false',
                    },
                },
                'required': ['spec_keyword'],
            },
        },
    },
]

TOOL_DISPATCH = {
    'get_shortage_summary': lambda args: tool_get_shortage_summary(
        dashboard_type=args.get('dashboard_type', 'main'),
        buyer=args.get('buyer'),
    ),
    'get_material_detail': lambda args: tool_get_material_detail(
        material_id=args.get('material_id', ''),
    ),
    'get_two_week_list': lambda args: tool_get_two_week_list(
        buyer=args.get('buyer'),
    ),
    'search_procurement': lambda args: tool_search_procurement(
        keyword=args.get('keyword', ''),
    ),
    'get_order_specs': lambda args: tool_get_order_specs(
        order_id=args.get('order_id', ''),
    ),
    'search_orders_by_spec': lambda args: tool_search_orders_by_spec(
        spec_keyword=args.get('spec_keyword', ''),
        value_keyword=args.get('value_keyword'),
        exclude=bool(args.get('exclude', False)),
    ),
}


# ---------------------------------------------------------------------------
# System Prompt 與 CLI Stateless 快照建構器
# ---------------------------------------------------------------------------
BASE_SYSTEM_PROMPT = """你是哈特佛（Hartford / 協鴻工業）「生產資訊中心 - 採購與工單規格儀表板」內建的 AI 助手（Hartford AI）。
請遵守以下原則：
1. 一律使用**繁體中文**回答，語氣專業、清晰、精準，善用 Markdown 表格或條列呈現數據。
2. 回答採購缺料、交期、兩週清單、物料明細或訂單規格問題時，**必須優先呼叫工具查詢最新即時數據**，嚴禁自行編造品號、工單號、交期或數量。
3. 延遲定義：`預計到貨日 (expected_date) − 第一筆開始缺料的需求日 (demand_date)`；若無交期且有缺料則標示為「無交期」。
4. 若使用者詢問某張 9 碼工單（如 100003884）的規格、主軸、控制器、CTS 等，請呼叫 `get_order_specs`。
5. 若使用者詢問「哪些工單有/沒有某規格」（如「哪些單沒有 CTS」、「列出 7.5KW 主軸工單」），請呼叫 `search_orders_by_spec`（若問「沒有」請設 `exclude=true`）。
"""


def _build_cli_stateless_prompt(user_message: str, history_messages: list) -> tuple[str, list]:
    """
    為無原生 Function Calling 的 agy CLI 模式組裝最新快照與自動觸發的工單/物料明細。
    回傳 (full_prompt, auto_tool_calls_list)
    """
    auto_tools = []
    injected_blocks = []

    # 1. 基本總覽快照
    summary_data = tool_get_shortage_summary('main')
    auto_tools.append({'name': 'get_shortage_summary', 'args': {'dashboard_type': 'main'}})
    injected_blocks.append(f"【即時採購儀表板總覽】\n```json\n{json.dumps(summary_data, ensure_ascii=False)}\n```")

    # 2. 自動偵測 9 碼工單號碼 (1/2/6 開頭共 9 碼)
    order_ids = list(dict.fromkeys(re.findall(r'\b[126]\d{8}\b', user_message)))
    for oid in order_ids[:3]:
        spec_res = tool_get_order_specs(oid)
        auto_tools.append({'name': 'get_order_specs', 'args': {'order_id': oid}})
        injected_blocks.append(f"【工單 {oid} 規格與缺料明細】\n```json\n{json.dumps(spec_res, ensure_ascii=False)}\n```")

    # 3. 自動偵測可能的物料品號（英數混合 8~16 碼，排除已匹配工單）
    mat_candidates = [
        tok for tok in re.findall(r'\b[A-Za-z0-9\-]{8,18}\b', user_message)
        if tok not in order_ids and any(c.isdigit() for c in tok)
    ]
    for mat_tok in mat_candidates[:2]:
        mat_res = tool_get_material_detail(mat_tok)
        if 'error' not in mat_res:
            auto_tools.append({'name': 'get_material_detail', 'args': {'material_id': mat_tok}})
            injected_blocks.append(f"【物料 {mat_tok} 明細】\n```json\n{json.dumps(mat_res, ensure_ascii=False)}\n```")

    # 4. 若訊息詢問兩週/延期/到期
    if any(k in user_message for k in ('兩週', '兩周', '延期', '逾期', '到期', '到貨')):
        tw_res = tool_get_two_week_list()
        auto_tools.append({'name': 'get_two_week_list', 'args': {}})
        injected_blocks.append(f"【兩週內到貨與延期清單】\n```json\n{json.dumps(tw_res, ensure_ascii=False)}\n```")

    # 5. 組裝最近 10 則對話歷史
    history_lines = []
    for msg in history_messages[-10:]:
        role_label = '使用者' if msg['role'] == 'user' else 'Hartford AI'
        history_lines.append(f"{role_label}：{msg['content']}")
    history_text = '\n\n'.join(history_lines)

    full_prompt = (
        f"{BASE_SYSTEM_PROMPT}\n"
        f"注意：目前運行於 CLI 唯讀快照模式，請勿執行任何系統指令或讀寫檔案，直接根據下方伺服器注入的即時數據回答問題。\n\n"
        + '\n\n'.join(injected_blocks)
        + (f"\n\n【近期對話歷史】\n{history_text}" if history_text else '')
        + f"\n\n【使用者最新提問】\n{user_message}"
    )
    return full_prompt, auto_tools


# ---------------------------------------------------------------------------
# AiController 核心類別（藍本 7 模式）
# ---------------------------------------------------------------------------
class AiController:
    def __init__(self):
        self._jobs = {}
        self._jobs_lock = threading.Lock()

    # ---- 設定管理 ----
    def _get_db_config_map(self) -> dict:
        defaults = {
            'ai_engine_mode': DEFAULT_ENGINE_MODE,
            'vllm_base_url': DEFAULT_VLLM_BASE_URL,
            'vllm_model': DEFAULT_VLLM_MODEL,
            'cli_model': DEFAULT_CLI_MODEL,
            'sdk_model': DEFAULT_SDK_MODEL,
            'gemini_api_key': os.environ.get('GEMINI_API_KEY', ''),
        }
        try:
            rows = AiConfig.query.all()
            for r in rows:
                if r.value is not None:
                    defaults[r.key] = r.value
        except Exception as e:
            app_logger.warning(f'讀取 AiConfig 失敗，使用預設值: {e}')
        return defaults

    def get_config_status(self) -> dict:
        cfg = self._get_db_config_map()
        raw_key = cfg.get('gemini_api_key', '') or ''
        masked_key = (raw_key[:4] + '...' + raw_key[-4:]) if len(raw_key) > 8 else ('***' if raw_key else '')
        return {
            'engine_mode': cfg.get('ai_engine_mode', DEFAULT_ENGINE_MODE),
            'vllm_base_url': cfg.get('vllm_base_url', DEFAULT_VLLM_BASE_URL),
            'vllm_model': cfg.get('vllm_model', DEFAULT_VLLM_MODEL),
            'cli_model': cfg.get('cli_model', DEFAULT_CLI_MODEL),
            'sdk_model': cfg.get('sdk_model', DEFAULT_SDK_MODEL),
            'has_api_key': bool(raw_key.strip()),
            'api_key_masked': masked_key,
            'agy_available': os.path.isfile(_resolve_agy_bin()),
            'available_engines': [
                {
                    'id': 'vllm_local',
                    'name': '本地 Qwen3.8-27B (vLLM 區網併發・預設)',
                    'model': cfg.get('vllm_model', DEFAULT_VLLM_MODEL),
                },
                {
                    'id': 'cli',
                    'name': 'Antigravity CLI (Gemini 3.8 Flash 免金鑰)',
                    'model': cfg.get('cli_model', DEFAULT_CLI_MODEL),
                },
                {
                    'id': 'sdk',
                    'name': 'Gemini SDK (需設定 API Key)',
                    'model': cfg.get('sdk_model', DEFAULT_SDK_MODEL),
                },
            ],
        }

    def update_config(self, payload: dict) -> dict:
        allowed_keys = {'ai_engine_mode', 'vllm_base_url', 'vllm_model', 'cli_model', 'sdk_model', 'gemini_api_key'}
        for k, v in (payload or {}).items():
            if k in allowed_keys and v is not None:
                val_str = str(v).strip()
                if k == 'gemini_api_key' and val_str == '__KEEP__':
                    continue
                row = AiConfig.query.filter_by(key=k).first()
                if row:
                    row.value = val_str
                    row.updated_at = get_taiwan_time()
                else:
                    db.session.add(AiConfig(key=k, value=val_str))
        db.session.commit()
        return self.get_config_status()

    # ---- 對話串 CRUD ----
    @staticmethod
    def _derive_session_title(first_message: str) -> str:
        cleaned = re.sub(r'\s+', ' ', (first_message or '').strip())
        if not cleaned:
            return '新對話'
        return cleaned[:28] + ('…' if len(cleaned) > 28 else '')

    def list_sessions(self, visitor_id: str) -> list:
        sessions = (
            AiSession.query.filter_by(visitor_id=visitor_id)
            .order_by(AiSession.updated_at.desc())
            .limit(50)
            .all()
        )
        return [
            {
                'id': s.id,
                'title': s.title,
                'created_at': s.created_at.strftime('%Y-%m-%d %H:%M') if s.created_at else '',
                'updated_at': s.updated_at.strftime('%Y-%m-%d %H:%M') if s.updated_at else '',
            }
            for s in sessions
        ]

    def create_session(self, visitor_id: str, title: str = '新對話') -> dict:
        s = AiSession(
            id=str(uuid.uuid4()),
            visitor_id=visitor_id,
            title=title or '新對話',
            created_at=get_taiwan_time(),
            updated_at=get_taiwan_time(),
        )
        db.session.add(s)
        db.session.commit()
        return {
            'id': s.id,
            'title': s.title,
            'created_at': s.created_at.strftime('%Y-%m-%d %H:%M'),
            'updated_at': s.updated_at.strftime('%Y-%m-%d %H:%M'),
            'messages': [],
        }

    def get_session(self, visitor_id: str, session_id: str) -> dict | None:
        s = AiSession.query.filter_by(id=session_id, visitor_id=visitor_id).first()
        if not s:
            return None
        msgs = []
        for m in s.messages:
            tc = []
            if m.tool_calls:
                try:
                    tc = json.loads(m.tool_calls)
                except Exception:
                    tc = []
            msgs.append({
                'id': m.id,
                'role': m.role,
                'content': m.content,
                'tool_calls': tc,
                'engine_label': m.engine_label or '',
                'created_at': m.created_at.strftime('%H:%M:%S') if m.created_at else '',
            })
        return {
            'id': s.id,
            'title': s.title,
            'created_at': s.created_at.strftime('%Y-%m-%d %H:%M') if s.created_at else '',
            'updated_at': s.updated_at.strftime('%Y-%m-%d %H:%M') if s.updated_at else '',
            'messages': msgs,
        }

    def delete_session(self, visitor_id: str, session_id: str) -> bool:
        s = AiSession.query.filter_by(id=session_id, visitor_id=visitor_id).first()
        if not s:
            return False
        db.session.delete(s)
        db.session.commit()
        return True

    # ---- 三引擎執行實作 ----
    def _run_vllm_local_agent(self, user_message: str, history_messages: list, cfg: dict, model_override: str = None) -> tuple[str, list, str]:
        """
        執行本地 Qwen3.8-27B (OpenAI-compatible API + 原生 Function Calling)
        必帶 chat_template_kwargs: {"enable_thinking": False} 避免思考文字漏入回答
        """
        base_url = (cfg.get('vllm_base_url') or DEFAULT_VLLM_BASE_URL).rstrip('/')
        model_name = model_override or cfg.get('vllm_model') or DEFAULT_VLLM_MODEL
        url = f'{base_url}/chat/completions'

        messages = [{'role': 'system', 'content': BASE_SYSTEM_PROMPT}]
        for hm in history_messages[-10:]:
            messages.append({'role': hm['role'], 'content': hm['content']})
        messages.append({'role': 'user', 'content': user_message})

        recorded_tool_calls = []

        for _round in range(5):
            payload = {
                'model': model_name,
                'messages': messages,
                'tools': OPENAI_TOOLS_SCHEMA,
                'tool_choice': 'auto',
                'temperature': 0.2,
                'max_tokens': 2048,
                'chat_template_kwargs': {'enable_thinking': False},
            }
            resp = requests.post(url, json=payload, timeout=60)
            resp.raise_for_status()
            resp_data = resp.json()

            choice = (resp_data.get('choices') or [{}])[0]
            msg = choice.get('message') or {}
            tool_calls = msg.get('tool_calls') or []

            if not tool_calls:
                content = (msg.get('content') or '').strip()
                # 防呆：萬一模型仍帶有 <think>...</think> 標籤則剝除
                content = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL).strip()
                short_model = model_name.split('/')[-1]
                return content or '（無回應內容）', recorded_tool_calls, f'vLLM ({short_model})'

            messages.append(msg)
            for tc in tool_calls:
                fn_obj = tc.get('function') or {}
                fn_name = fn_obj.get('name', '')
                raw_args = fn_obj.get('arguments') or '{}'
                try:
                    parsed_args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
                except Exception:
                    parsed_args = {}

                recorded_tool_calls.append({'name': fn_name, 'args': parsed_args})

                handler = TOOL_DISPATCH.get(fn_name)
                if handler:
                    try:
                        tool_result = handler(parsed_args)
                    except Exception as e:
                        app_logger.error(f'執行唯讀工具 {fn_name} 異常: {e}', exc_info=True)
                        tool_result = {'error': str(e)}
                else:
                    tool_result = {'error': f'未知的工具: {fn_name}'}

                messages.append({
                    'role': 'tool',
                    'tool_call_id': tc.get('id', f'call_{len(recorded_tool_calls)}'),
                    'name': fn_name,
                    'content': json.dumps(tool_result, ensure_ascii=False),
                })

        # 若達到 5 輪上限，做最後一次不帶 tools 的總結呼叫
        payload = {
            'model': model_name,
            'messages': messages,
            'temperature': 0.2,
            'max_tokens': 2048,
            'chat_template_kwargs': {'enable_thinking': False},
        }
        resp = requests.post(url, json=payload, timeout=60)
        resp.raise_for_status()
        content = ((resp.json().get('choices') or [{}])[0].get('message') or {}).get('content', '').strip()
        content = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL).strip()
        short_model = model_name.split('/')[-1]
        return content or '（無回應內容）', recorded_tool_calls, f'vLLM ({short_model})'

    def _run_cli_fallback(self, user_message: str, history_messages: list, cfg: dict, model_override: str = None) -> tuple[str, list, str]:
        """
        執行本機 agy CLI 免金鑰模式（stateless 重注入 + 全域單實例鎖 + 空工作目錄）
        不加 --dangerously-skip-permissions，確保安全
        """
        agy_bin = _resolve_agy_bin()
        cli_model = model_override or cfg.get('cli_model') or DEFAULT_CLI_MODEL
        full_prompt, auto_tools = _build_cli_stateless_prompt(user_message, history_messages)

        args = [
            agy_bin,
            '-p', full_prompt,
            '--output-format', 'json',
            '--disable-slash-commands',
            '--effort', 'low',
            '--model', cli_model,
        ]

        acquired = _agy_lock.acquire(timeout=120)
        if not acquired:
            raise TimeoutError('目前 AI CLI 正在處理其他請求中，請稍候再試（或於 ⚙️ 切換至本地 Qwen 引擎）。')
        try:
            proc = subprocess.run(
                args,
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='replace',
                cwd=str(AI_EMPTY_WORKDIR),
                timeout=120,
            )
        finally:
            _agy_lock.release()

        out = (proc.stdout or '').strip()
        if not out:
            raise RuntimeError(f'agy CLI 無輸出 (exit={proc.returncode}, stderr={(proc.stderr or "")[:200]})')

        json_start = out.find('{')
        if json_start >= 0:
            try:
                data = json.loads(out[json_start:])
                if data.get('status') and data.get('status') != 'SUCCESS':
                    raise RuntimeError(f"agy CLI 回傳狀態 {data.get('status')}: {str(data.get('response', ''))[:200]}")
                reply_text = (data.get('response') or '').strip()
                if reply_text:
                    return reply_text, auto_tools, f'agy CLI ({cli_model})'
            except json.JSONDecodeError:
                pass

        return out, auto_tools, f'agy CLI ({cli_model})'

    def _run_sdk_agent(self, user_message: str, history_messages: list, cfg: dict, model_override: str = None) -> tuple[str, list, str]:
        """
        使用 Google GenAI SDK（需設定 gemini_api_key），若無金鑰自動退回 vllm_local / cli
        """
        api_key = (cfg.get('gemini_api_key') or '').strip()
        if not api_key:
            raise ValueError('尚未設定 Gemini API Key，請改用 vllm_local 或 cli 引擎。')

        from google import genai
        from google.genai import types

        sdk_model = model_override or cfg.get('sdk_model') or DEFAULT_SDK_MODEL
        client = genai.Client(api_key=api_key)

        recorded_tool_calls = []

        def get_shortage_summary(dashboard_type: str = 'main', buyer: str = '') -> dict:
            """取得採購缺料與延遲總覽"""
            recorded_tool_calls.append({'name': 'get_shortage_summary', 'args': {'dashboard_type': dashboard_type, 'buyer': buyer}})
            return tool_get_shortage_summary(dashboard_type=dashboard_type, buyer=buyer or None)

        def get_material_detail(material_id: str) -> dict:
            """查詢單一物料品號完整明細"""
            recorded_tool_calls.append({'name': 'get_material_detail', 'args': {'material_id': material_id}})
            return tool_get_material_detail(material_id=material_id)

        def get_two_week_list(buyer: str = '') -> dict:
            """查詢未來兩週內預計到貨與交貨延期清單"""
            recorded_tool_calls.append({'name': 'get_two_week_list', 'args': {'buyer': buyer}})
            return tool_get_two_week_list(buyer=buyer or None)

        def search_procurement(keyword: str) -> dict:
            """依關鍵字搜尋物料或工單"""
            recorded_tool_calls.append({'name': 'search_procurement', 'args': {'keyword': keyword}})
            return tool_search_procurement(keyword=keyword)

        def get_order_specs(order_id: str) -> dict:
            """依9碼工單號查詢工單規格與缺料"""
            recorded_tool_calls.append({'name': 'get_order_specs', 'args': {'order_id': order_id}})
            return tool_get_order_specs(order_id=order_id)

        def search_orders_by_spec(spec_keyword: str, value_keyword: str = '', exclude: bool = False) -> dict:
            """依規格特性正反向篩選工單"""
            recorded_tool_calls.append({
                'name': 'search_orders_by_spec',
                'args': {'spec_keyword': spec_keyword, 'value_keyword': value_keyword, 'exclude': exclude},
            })
            return tool_search_orders_by_spec(spec_keyword=spec_keyword, value_keyword=value_keyword or None, exclude=exclude)

        contents = []
        for hm in history_messages[-10:]:
            role = 'user' if hm['role'] == 'user' else 'model'
            contents.append(types.Content(role=role, parts=[types.Part.from_text(text=hm['content'])]))
        contents.append(types.Content(role='user', parts=[types.Part.from_text(text=user_message)]))

        response = client.models.generate_content(
            model=sdk_model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=BASE_SYSTEM_PROMPT,
                temperature=0.2,
                tools=[
                    get_shortage_summary,
                    get_material_detail,
                    get_two_week_list,
                    search_procurement,
                    get_order_specs,
                    search_orders_by_spec,
                ],
            ),
        )
        return (response.text or '').strip(), recorded_tool_calls, f'Gemini SDK ({sdk_model})'

    # ---- 非同步背景 Job 與輪詢 (藍本模式 2) ----
    def _cleanup_old_jobs(self):
        cutoff = time.time() - 3600
        with self._jobs_lock:
            expired = [jid for jid, j in self._jobs.items() if j.get('created_ts', 0) < cutoff]
            for jid in expired:
                self._jobs.pop(jid, None)

    def start_async_chat(
        self,
        app,
        visitor_id: str,
        user_message: str,
        session_id: str = None,
        engine_override: str = None,
        model_override: str = None,
    ) -> dict:
        self._cleanup_old_jobs()

        # 確保或建立對話串
        s = None
        if session_id:
            s = AiSession.query.filter_by(id=session_id, visitor_id=visitor_id).first()
        if not s:
            s = AiSession(
                id=str(uuid.uuid4()),
                visitor_id=visitor_id,
                title=self._derive_session_title(user_message),
                created_at=get_taiwan_time(),
                updated_at=get_taiwan_time(),
            )
            db.session.add(s)
            db.session.commit()
        elif s.title in ('新對話', '', None) and len(s.messages) == 0:
            s.title = self._derive_session_title(user_message)
            db.session.commit()

        # 讀取歷史訊息（不含本輪）
        history_messages = [{'role': m.role, 'content': m.content} for m in s.messages[-12:]]

        # 寫入使用者訊息
        user_msg_row = AiMessage(
            session_id=s.id,
            role='user',
            content=user_message,
            created_at=get_taiwan_time(),
        )
        s.updated_at = get_taiwan_time()
        db.session.add(user_msg_row)
        db.session.commit()

        job_id = str(uuid.uuid4())
        target_session_id = s.id
        session_title = s.title

        with self._jobs_lock:
            self._jobs[job_id] = {
                'job_id': job_id,
                'session_id': target_session_id,
                'visitor_id': visitor_id,
                'status': 'running',
                'created_ts': time.time(),
                'reply': None,
                'tool_calls': [],
                'engine_label': '',
                'session_title': session_title,
                'error': None,
            }

        def _worker():
            with app.app_context():
                try:
                    cfg = self._get_db_config_map()
                    chosen_engine = (engine_override or cfg.get('ai_engine_mode') or DEFAULT_ENGINE_MODE).strip()

                    reply_text = ''
                    tool_calls = []
                    engine_label = ''

                    if chosen_engine == 'vllm_local':
                        try:
                            reply_text, tool_calls, engine_label = self._run_vllm_local_agent(
                                user_message, history_messages, cfg, model_override=model_override
                            )
                        except Exception as vllm_err:
                            app_logger.warning(f'vllm_local 呼叫失敗 ({vllm_err})，自動備援切換至 agy CLI')
                            reply_text, tool_calls, engine_label = self._run_cli_fallback(
                                user_message, history_messages, cfg
                            )
                            engine_label += ' [vLLM備援]'
                    elif chosen_engine == 'sdk':
                        try:
                            reply_text, tool_calls, engine_label = self._run_sdk_agent(
                                user_message, history_messages, cfg, model_override=model_override
                            )
                        except Exception as sdk_err:
                            app_logger.warning(f'SDK 呼叫失敗 ({sdk_err})，自動備援切換至 vllm_local')
                            reply_text, tool_calls, engine_label = self._run_vllm_local_agent(
                                user_message, history_messages, cfg
                            )
                            engine_label += ' [SDK備援]'
                    else:
                        reply_text, tool_calls, engine_label = self._run_cli_fallback(
                            user_message, history_messages, cfg, model_override=model_override
                        )

                    # 儲存 AI 回覆至資料庫
                    sess_obj = AiSession.query.filter_by(id=target_session_id).first()
                    if sess_obj:
                        sess_obj.updated_at = get_taiwan_time()
                    ai_msg_row = AiMessage(
                        session_id=target_session_id,
                        role='assistant',
                        content=reply_text,
                        tool_calls=json.dumps(tool_calls, ensure_ascii=False) if tool_calls else None,
                        engine_label=engine_label,
                        created_at=get_taiwan_time(),
                    )
                    db.session.add(ai_msg_row)
                    db.session.commit()

                    with self._jobs_lock:
                        if job_id in self._jobs:
                            self._jobs[job_id].update({
                                'status': 'completed',
                                'reply': reply_text,
                                'tool_calls': tool_calls,
                                'engine_label': engine_label,
                            })
                except Exception as e:
                    app_logger.error(f'AI 背景任務 {job_id} 失敗: {e}', exc_info=True)
                    db.session.rollback()
                    err_msg = f'抱歉，處理您的問題時發生異常：{e}'
                    try:
                        ai_err_row = AiMessage(
                            session_id=target_session_id,
                            role='assistant',
                            content=err_msg,
                            engine_label='error',
                            created_at=get_taiwan_time(),
                        )
                        db.session.add(ai_err_row)
                        db.session.commit()
                    except Exception:
                        db.session.rollback()

                    with self._jobs_lock:
                        if job_id in self._jobs:
                            self._jobs[job_id].update({
                                'status': 'failed',
                                'error': str(e),
                                'reply': err_msg,
                            })

        t = threading.Thread(target=_worker, daemon=True)
        t.start()

        return {
            'job_id': job_id,
            'session_id': target_session_id,
            'session_title': session_title,
            'status': 'running',
        }

    def get_job_status(self, visitor_id: str, job_id: str) -> dict | None:
        with self._jobs_lock:
            job = self._jobs.get(job_id)
            if not job or job.get('visitor_id') != visitor_id:
                return None
            return dict(job)


ai_controller = AiController()

# ---------------------------------------------------------------------------
# Blueprint 路由定義
# ---------------------------------------------------------------------------
ai_bp = Blueprint('ai', __name__)


@ai_bp.route('/ai')
def ai_page():
    """Hartford AI 獨立頁面（免登入開放廠內使用）"""
    TrafficService.record_page_view('ai_assistant.html', request.remote_addr)
    is_admin = session.get('logged_in', False)
    return render_template('ai_assistant.html', is_admin=is_admin)


@ai_bp.route('/api/ai/sessions', methods=['GET'])
def api_list_sessions():
    vid = get_visitor_id()
    return jsonify({'success': True, 'sessions': ai_controller.list_sessions(vid)})


@ai_bp.route('/api/ai/sessions', methods=['POST'])
def api_create_session():
    vid = get_visitor_id()
    body = request.get_json(silent=True) or {}
    created = ai_controller.create_session(vid, title=body.get('title') or '新對話')
    return jsonify({'success': True, 'session': created})


@ai_bp.route('/api/ai/sessions/<session_id>', methods=['GET'])
def api_get_session(session_id):
    vid = get_visitor_id()
    data = ai_controller.get_session(vid, session_id)
    if not data:
        return jsonify({'success': False, 'error': '找不到該對話串'}), 404
    return jsonify({'success': True, 'session': data})


@ai_bp.route('/api/ai/sessions/<session_id>', methods=['DELETE'])
def api_delete_session(session_id):
    vid = get_visitor_id()
    ok = ai_controller.delete_session(vid, session_id)
    if not ok:
        return jsonify({'success': False, 'error': '找不到該對話串'}), 404
    return jsonify({'success': True})


@ai_bp.route('/api/ai/chat', methods=['POST'])
def api_start_chat():
    vid = get_visitor_id()
    body = request.get_json(silent=True) or {}
    message = (body.get('message') or '').strip()
    if not message:
        return jsonify({'success': False, 'error': '提問內容不能為空'}), 400

    app_obj = current_app._get_current_object()
    result = ai_controller.start_async_chat(
        app=app_obj,
        visitor_id=vid,
        user_message=message,
        session_id=body.get('session_id'),
        engine_override=body.get('engine_mode'),
        model_override=body.get('model'),
    )
    return jsonify({'success': True, **result})


@ai_bp.route('/api/ai/job/<job_id>', methods=['GET'])
def api_job_status(job_id):
    vid = get_visitor_id()
    job = ai_controller.get_job_status(vid, job_id)
    if not job:
        return jsonify({'success': False, 'error': '找不到該工作或已過期'}), 404
    return jsonify({'success': True, **job})


@ai_bp.route('/api/ai/config', methods=['GET'])
def api_get_config():
    status = ai_controller.get_config_status()
    status['is_admin'] = bool(session.get('logged_in', False))
    return jsonify({'success': True, 'config': status})


@ai_bp.route('/api/ai/config', methods=['POST'])
@login_required
def api_update_config():
    """僅管理員可修改 DB 全域預設引擎與 API Key"""
    body = request.get_json(silent=True) or {}
    updated = ai_controller.update_config(body)
    return jsonify({'success': True, 'config': updated})
