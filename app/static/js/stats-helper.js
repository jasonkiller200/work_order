// 統計圖卡和排序相關函數

// 🆕 全域變數：儲存從 API 載入的替代品通知資料
// 格式：{ material_id: [substitute_material_ids...], ... }
window.notifiedSubstitutesMap = {};

// 🆕 從 API 載入替代品通知資料
window.loadNotifiedSubstitutes = async function () {
    try {
        const response = await fetch('/api/substitute_notification/all');
        const data = await response.json();
        window.notifiedSubstitutesMap = data.notified_substitutes_map || {};
        console.log('替代品通知資料載入完成:', Object.keys(window.notifiedSubstitutesMap).length, '筆');
    } catch (error) {
        console.error('載入替代品通知資料失敗:', error);
        window.notifiedSubstitutesMap = {};
    }
};

// 🆕 檢查某物料是否有已通知的替代品
window.hasNotifiedSubstitute = function (materialId) {
    if (!materialId) return false;
// 增強物料資料(加入預計交貨日期資訊) - 🆕 支援分批顯示
window.enhanceMaterialsData = function (materialsData, demandDetailsData, deliveryData) {
    return materialsData.map(material => {
        return {
            ...material,
            demand_details: material.demand_details || [],
            delivery_schedules: material.delivery_schedules || []
        };
    });
}

// 設定統計圖卡事件
function setupStatsCardEvents() {
    const cards = document.querySelectorAll('.stat-card');

    cards.forEach(card => {
        card.addEventListener('click', () => {
            const filter = card.dataset.filter;

            // 如果點擊已啟動的卡片，取消篩選
            if (currentStatFilter === filter) {
                clearStatFilter();
            } else {
                applyStatFilter(filter);
            }
        });
    });

    // 清除篩選按鈕
    const clearBtn = document.getElementById('clear-stat-filter-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearStatFilter);
    }
}

// 套用統計篩選
function applyStatFilter(filterType) {
    currentStatFilter = filterType;

    // 更新圖卡狀態
    document.querySelectorAll('.stat-card').forEach(card => {
        if (card.dataset.filter === filterType) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });

    // 顯示篩選徽章
    const filterBadge = document.getElementById('current-filter-badge');
    const filterText = document.getElementById('current-filter-text');
    const filterNames = {
        'shortage-30-days': '30日內缺料',
        'no-delivery': '無交期項目',
        'delayed': '今日到貨',
        'due-soon': '即將到期',
        'all-shortage': '總缺料項目',
        'delivery-delayed': '交貨延期',
        'overdue-demand': '需求逾期欠料',
        'sufficient': '庫存充足',
        'substitute-notify': '替代用料通知',
        'in-inspection': '品檢中'
    };

    if (filterText && filterBadge) {
        filterText.textContent = filterNames[filterType] || '全部';
        filterBadge.style.display = 'block';
    }

    // 🆕 顯示/隱藏批量操作欄
    toggleBatchActionsBar(filterType);

    // 重新渲染表格
    renderMaterialsTable();
}

// 清除統計篩選
// 清除統計篩選
function clearStatFilter() {
    currentStatFilter = 'all';

    // 清除圖卡狀態
    document.querySelectorAll('.stat-card').forEach(card => {
        card.classList.remove('active');
    });

    // 隱藏篩選徽章
    const filterBadge = document.getElementById('current-filter-badge');
    if (filterBadge) {
        filterBadge.style.display = 'none';
    }

    // 🆕 隱藏批量操作欄
    const batchBar = document.getElementById('batch-actions-bar');
    if (batchBar) {
        batchBar.style.display = 'none';
    }

    // 重新渲染表格
    renderMaterialsTable();
}

// 計算統計數據
function calculateStats(materials) {
    const stats = {
        shortage30Days: 0,
        noDelivery: 0,
        delayed: 0,
        dueSoon: 0,
        allShortage: 0,
        deliveryDelayed: 0,
        overdueDemand: 0,
        sufficient: 0,
        substituteNotify: 0,
        inInspection: 0
    };

    materials.forEach(m => {
        if (m.shortage_within_30_days) stats.shortage30Days++;
        if (m.no_delivery) stats.noDelivery++;
        if (m.is_today_arrival) stats.delayed++;
        if (m.is_due_soon) stats.dueSoon++;
        if (m.is_all_shortage) stats.allShortage++;
        if (m.is_delivery_delayed) stats.deliveryDelayed++;
        if (m.is_overdue_demand) stats.overdueDemand++;
        if (m.is_sufficient) stats.sufficient++;
        if (m.is_substitute_notified || window.hasNotifiedSubstitute(m['物料'])) stats.substituteNotify++;
        if (m.is_in_inspection) stats.inInspection++;
    });

    return stats;
}

// 更新統計圖卡數字
window.updateStatsCards = function () {
    const materials = currentDashboardType === 'main' ? currentMaterialsData : currentFinishedMaterialsData;
    const stats = calculateStats(materials);

    const elements = {
        'stat-shortage-30': stats.shortage30Days,
        'stat-no-delivery': stats.noDelivery,
        'stat-delayed': stats.delayed,
        'stat-due-soon': stats.dueSoon,
        'stat-all-shortage': stats.allShortage,
        'stat-delivery-delayed': stats.deliveryDelayed,
        'stat-overdue-demand': stats.overdueDemand,
        'stat-sufficient': stats.sufficient,
        'stat-substitute-notify': stats.substituteNotify,
        'stat-in-inspection': stats.inInspection
    };

    Object.keys(elements).forEach(id => {
        const elem = document.getElementById(id);
        if (elem) {
            elem.textContent = elements[id];
        }
    });
}

// 篩選物料資料
window.filterMaterialsByStats = function (materials) {
    if (currentStatFilter === 'all') {
        return materials;
    }

    return materials.filter(m => {
        switch (currentStatFilter) {
            case 'shortage-30-days':
                return m.shortage_within_30_days || false;

            case 'no-delivery':
                return m.no_delivery || false;

            case 'delayed':
                return m.is_today_arrival || false;

            case 'due-soon':
                return m.is_due_soon || false;

            case 'all-shortage':
                return m.is_all_shortage || false;

            case 'delivery-delayed':
                return m.is_delivery_delayed || false;

            case 'overdue-demand':
                return m.is_overdue_demand || false;

            case 'sufficient':
                return m.is_sufficient || false;

            case 'substitute-notify':
                return m.is_substitute_notified || window.hasNotifiedSubstitute(m['物料']);

            case 'in-inspection':
                return m.is_in_inspection || false;

            default:
                return true;
        }
    });
}

// 排序物料資料（30日內缺料優先，然後按預計交貨日期）
window.sortMaterialsByPriority = function (materials) {
    // 🆕 如果是「交貨延期」篩選，預設按延遲天數由多到少排序
    if (currentStatFilter === 'delivery-delayed') {
        return materials.sort((a, b) => {
            const aDelay = a._computed_delay_days || 0;
            const bDelay = b._computed_delay_days || 0;
            if (aDelay !== bDelay) return bDelay - aDelay; // 延遲天數多的排最前
            // 延遲天數相同時，按缺料數量排序
            return (b.current_shortage || 0) - (a.current_shortage || 0);
        });
    }

    return materials.sort((a, b) => {
        // 第一優先：30日內缺料排最前
        const a30Days = a.shortage_within_30_days || false;
        const b30Days = b.shortage_within_30_days || false;

        if (a30Days && !b30Days) return -1;
        if (!a30Days && b30Days) return 1;

        // 第二優先：預計交貨日期（越早越前面）
        const aDate = a.delivery_date ? new Date(a.delivery_date) : null;
        const bDate = b.delivery_date ? new Date(b.delivery_date) : null;

        if (aDate && bDate) {
            const dateCompare = aDate.getTime() - bDate.getTime();
            if (dateCompare !== 0) return dateCompare;
        }

        // 如果其中一個沒有交貨日期，有日期的排前面
        if (aDate && !bDate) return -1;
        if (!aDate && bDate) return 1;

        // 第三優先：缺料數量大的排前面
        if (a.current_shortage !== b.current_shortage) {
            return b.current_shortage - a.current_shortage;
        }

        // 第四優先：預計缺料數量大的排前面
        return b.projected_shortage - a.projected_shortage;
    });
}

// 🆕 顯示/隱藏批量操作欄
function toggleBatchActionsBar(filterType) {
    const bar = document.getElementById('batch-actions-bar');
    const countElem = document.getElementById('delayed-count');

    if (!bar || !countElem) return;

    if (filterType === 'delayed') {
        // 計算過期交期數量
        const materials = currentDashboardType === 'main' ? currentMaterialsData : currentFinishedMaterialsData;
        const stats = calculateStats(materials);

        bar.style.display = 'block';
        countElem.textContent = `共 ${stats.delayed} 個物料有過期交期`;
    } else {
        bar.style.display = 'none';
    }
}
