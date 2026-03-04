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
    // 檢查這個物料是否有已啟用通知的替代品
    return window.notifiedSubstitutesMap.hasOwnProperty(materialId) &&
        window.notifiedSubstitutesMap[materialId].length > 0;
};
// 增強物料資料(加入預計交貨日期資訊) - 🆕 支援分批顯示
window.enhanceMaterialsData = function (materialsData, demandDetailsData, deliveryData) {
    return materialsData.map(material => {
        const materialId = material['物料'];

        // 🆕 從需求明細中計算最早需求日期
        const materialDemands = (demandDetailsData && demandDetailsData[materialId]) || material.demand_details || [];
        let earliestDemandDate = null;
        if (materialDemands.length > 0) {
            const dates = materialDemands
                .map(d => d['需求日期'])
                .filter(d => d)
                .sort();
            if (dates.length > 0) {
                earliestDemandDate = dates[0]; // 已排序，取最早的
            }
        }

        // 取得該物料的所有分批交期資料(陣列格式)
        const deliverySchedules = deliveryData[materialId] || [];

        // 向下相容:如果有分批資料,取第一批作為主要交期
        const firstDelivery = deliverySchedules.length > 0 ? deliverySchedules[0] : null;

        return {
            ...material,
            demand_details: materialDemands,
            earliest_demand_date: earliestDemandDate, // 🆕 最早需求日期
            delivery_schedules: deliverySchedules,
            delivery_date: firstDelivery ? firstDelivery.expected_date : null,
            delivery_status: firstDelivery ? firstDelivery.status : null,
            delivery_qty: firstDelivery ? firstDelivery.quantity : null
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
function calculateStats(materials, deliveryData) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in7Days = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay()); // 本週日
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6); // 本週六

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
        const hasShortage = m.current_shortage > 0 || m.projected_shortage > 0;
        const shortage30 = m.shortage_within_30_days || false;
        const delivery = m.delivery_date ? new Date(m.delivery_date) : null;
        const earliestDemand = m.earliest_demand_date ? new Date(m.earliest_demand_date) : null;

        // 30日內缺料
        if (shortage30) {
            stats.shortage30Days++;
        }

        // 無交期項目（有缺料但無交期）
        if (hasShortage && !delivery) {
            stats.noDelivery++;
        }

        // 已延誤（有交期但已過期且未標記完成）
        if (delivery && delivery < today && m.delivery_status !== 'completed') {
            stats.delayed++;
        }

        // 即將到期（7日內）
        if (delivery && delivery >= today && delivery <= in7Days) {
            stats.dueSoon++;
        }

        // 總缺料
        if (hasShortage) {
            stats.allShortage++;
        }

        // 交貨延期：使用和渲染相同的邏輯計算
        // 判斷第一批交貨日是否超過對應缺料點的需求日期
        if (m.delivery_schedules && m.delivery_schedules.length > 0 && m.demand_details && m.demand_details.length > 0) {
            // 1. 初始化模擬庫存
            let currentStock = (m.unrestricted_stock || 0) + (m.inspection_stock || 0);

            // 2. 複製需求列表並排序
            let demands = m.demand_details.map(d => ({
                ...d,
                qty: d['未結數量 (EINHEIT)'] || 0,
                date: new Date(d['需求日期'])
            })).sort((a, b) => a.date - b.date);

            // 3. 找出第一個缺料點對應的需求
            let targetDemand = null;
            let tempRunningStock = currentStock;

            for (const demand of demands) {
                tempRunningStock -= demand.qty;
                if (tempRunningStock < 0) {
                    targetDemand = demand;
                    break;
                }
            }

            // 4. 如果有缺料點，比較第一批交貨日期和缺料需求日期
            if (targetDemand) {
                const firstSchedule = m.delivery_schedules[0];
                const scheduleDate = new Date(firstSchedule.expected_date);
                const demandDate = targetDemand.date;

                if (scheduleDate > demandDate) {
                    stats.deliveryDelayed++;
                }
            }
        }

        // 需求逾期欠料（模擬庫存配賦後，第一筆無法滿足的需求日已過）
        if (hasShortage && m.demand_details && m.demand_details.length > 0) {
            let simStock = (m.unrestricted_stock || 0) + (m.inspection_stock || 0);
            const sortedDemands = m.demand_details
                .map(d => ({ qty: d['未結數量 (EINHEIT)'] || 0, date: new Date(d['需求日期']) }))
                .sort((a, b) => a.date - b.date);

            for (const demand of sortedDemands) {
                simStock -= demand.qty;
                if (simStock < 0) {
                    // 找到第一筆無法滿足的需求
                    if (demand.date < today) {
                        stats.overdueDemand++;
                    }
                    break;
                }
            }
        }

        // 庫存充足
        if (!hasShortage) {
            stats.sufficient++;
        }

        // 🆕 替代用料通知（檢查該物料是否有已啟用通知的替代品）
        if (window.hasNotifiedSubstitute(m['物料'])) {
            stats.substituteNotify++;
        }

        // 🆕 品檢中（品檢中數量 > 0）
        const inspectionStock = m.inspection_stock || m['品質檢驗中'] || 0;
        if (inspectionStock > 0) {
            stats.inInspection++;
        }
    });

    return stats;
}

// 更新統計圖卡數字
window.updateStatsCards = function () {
    const materials = currentDashboardType === 'main' ? currentMaterialsData : currentFinishedMaterialsData;
    const stats = calculateStats(materials, allDeliveryData);

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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in7Days = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    return materials.filter(m => {
        // 確保數值正確處理，避免 undefined 或 null
        const currentShortage = m.current_shortage || 0;
        const projectedShortage = m.projected_shortage || 0;
        const hasShortage = currentShortage > 0 || projectedShortage > 0;
        const shortage30 = m.shortage_within_30_days || false;
        const delivery = m.delivery_date ? new Date(m.delivery_date) : null;
        const earliestDemand = m.earliest_demand_date ? new Date(m.earliest_demand_date) : null;

        switch (currentStatFilter) {
            case 'shortage-30-days':
                return shortage30;

            case 'no-delivery':
                return hasShortage && !delivery;

            case 'delayed':
                return delivery && delivery < today && m.delivery_status !== 'completed';

            case 'due-soon':
                return delivery && delivery >= today && delivery <= in7Days;

            case 'all-shortage':
                return hasShortage;

            case 'delivery-delayed':
                // 交貨延期：使用和渲染相同的邏輯計算
                if (!(m.delivery_schedules && m.delivery_schedules.length > 0 && m.demand_details && m.demand_details.length > 0)) {
                    return false;
                }

                // 1. 初始化模擬庫存
                let currentStock = (m.unrestricted_stock || 0) + (m.inspection_stock || 0);

                // 2. 複製需求列表並排序
                let demands = m.demand_details.map(d => ({
                    ...d,
                    qty: d['未結數量 (EINHEIT)'] || 0,
                    date: new Date(d['需求日期'])
                })).sort((a, b) => a.date - b.date);

                // 3. 找出第一個缺料點對應的需求
                let targetDemand = null;
                let tempRunningStock = currentStock;

                for (const demand of demands) {
                    tempRunningStock -= demand.qty;
                    if (tempRunningStock < 0) {
                        targetDemand = demand;
                        break;
                    }
                }

                // 4. 如果有缺料點，比較第一批交貨日期和缺料需求日期
                if (targetDemand) {
                    const firstSchedule = m.delivery_schedules[0];
                    const scheduleDate = new Date(firstSchedule.expected_date);
                    const demandDate = targetDemand.date;

                    if (scheduleDate > demandDate) {
                        // 計算延遲天數並儲存供排序使用
                        m._computed_delay_days = Math.ceil((scheduleDate - demandDate) / (1000 * 60 * 60 * 24));
                        return true;
                    }
                }
                return false;

            case 'overdue-demand':
                if (!(hasShortage && m.demand_details && m.demand_details.length > 0)) return false;
                let odStock = (m.unrestricted_stock || 0) + (m.inspection_stock || 0);
                const odDemands = m.demand_details
                    .map(d => ({ qty: d['未結數量 (EINHEIT)'] || 0, date: new Date(d['需求日期']) }))
                    .sort((a, b) => a.date - b.date);
                for (const demand of odDemands) {
                    odStock -= demand.qty;
                    if (odStock < 0) {
                        return demand.date < today;
                    }
                }
                return false;

            case 'sufficient':
                return !hasShortage;

            case 'substitute-notify':
                return window.hasNotifiedSubstitute(m['物料']);

            case 'in-inspection':
                const inspectionStock = m.inspection_stock || m['品質檢驗中'] || 0;
                return inspectionStock > 0;

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
        const stats = calculateStats(materials, allDeliveryData);

        bar.style.display = 'block';
        countElem.textContent = `共 ${stats.delayed} 個物料有過期交期`;
    } else {
        bar.style.display = 'none';
    }
}
