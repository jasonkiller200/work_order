// 統計圖卡和排序相關函數

// 增強物料資料（加入預計交貨日期資訊）
function enhanceMaterialsData(materialsData, demandDetailsData, deliveryData) {
    return materialsData.map(material => {
        const materialId = material['物料'];
        
        // 取得交期資料
        const delivery = deliveryData[materialId];
        
        return {
            ...material,
            delivery_date: delivery ? delivery.expected_date : null,
            delivery_status: delivery ? delivery.status : null,
            delivery_qty: delivery ? delivery.qty : null
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
        'delayed': '已延誤',
        'due-soon': '即將到期',
        'all-shortage': '總缺料項目',
        'my-items': '我的項目',
        'this-week': '本週需求',
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
        myItems: 0,
        thisWeek: 0,
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
        
        // 我的項目（暫時設為0，需要實作獲取當前使用者）
        stats.myItems = 0;
        
        // 本週需求
        if (earliestDemand && earliestDemand >= weekStart && earliestDemand <= weekEnd) {
            stats.thisWeek++;
        }
        
        // 庫存充足
        if (!hasShortage) {
            stats.sufficient++;
        }
        
        // 🆕 替代用料通知（檢查是否有已勾選的替代用料）
        const materialBase = m['物料'] ? m['物料'].substring(0, 10) : '';
        if (materialBase) {
            const notifiedSubstitutes = typeof getNotifiedSubstitutes === 'function' ? getNotifiedSubstitutes() : [];
            const hasNotifiedSubstitute = notifiedSubstitutes.some(notifiedId => 
                notifiedId.substring(0, 10) === materialBase && notifiedId !== m['物料']
            );
            if (hasNotifiedSubstitute) {
                stats.substituteNotify++;
            }
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
function updateStatsCards() {
    const materials = currentDashboardType === 'main' ? currentMaterialsData : currentFinishedMaterialsData;
    const stats = calculateStats(materials, allDeliveryData);
    
    const elements = {
        'stat-shortage-30': stats.shortage30Days,
        'stat-no-delivery': stats.noDelivery,
        'stat-delayed': stats.delayed,
        'stat-due-soon': stats.dueSoon,
        'stat-all-shortage': stats.allShortage,
        'stat-my-items': stats.myItems,
        'stat-this-week': stats.thisWeek,
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
function filterMaterialsByStats(materials) {
    if (currentStatFilter === 'all') {
        return materials;
    }
    
    const today = new Date();
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
            
            case 'my-items':
                // 需要實作當前使用者判斷
                return false;
            
            case 'this-week':
                return earliestDemand && earliestDemand >= weekStart && earliestDemand <= weekEnd;
            
            case 'sufficient':
                return !hasShortage;
            
            case 'substitute-notify':
                const materialBase = m['物料'] ? m['物料'].substring(0, 10) : '';
                if (!materialBase) return false;
                const notifiedSubstitutes = typeof getNotifiedSubstitutes === 'function' ? getNotifiedSubstitutes() : [];
                return notifiedSubstitutes.some(notifiedId => 
                    notifiedId.substring(0, 10) === materialBase && notifiedId !== m['物料']
                );
            
            case 'in-inspection':
                const inspectionStock = m.inspection_stock || m['品質檢驗中'] || 0;
                return inspectionStock > 0;
            
            default:
                return true;
        }
    });
}

// 排序物料資料（30日內缺料優先，然後按預計交貨日期）
function sortMaterialsByPriority(materials) {
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
