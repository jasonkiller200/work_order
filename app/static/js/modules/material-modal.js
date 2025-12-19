/**
 * 物料彈窗模組
 * 處理物料詳情彈窗的顯示和互動
 */

/**
 * 開啟物料詳情彈窗
 * @param {string} materialId - 物料編號
 */
function openDetailsModal(materialId) {
    const modal = document.getElementById('details-modal');
    
    // 先設定基本標題
    document.getElementById('modal-title').textContent = `物料詳情: ${materialId}`;

    document.getElementById('stock-summary-section').style.display = 'block';
    document.getElementById('unrestricted-stock').textContent = '載入中...';
    document.getElementById('inspection-stock').textContent = '載入中...';
    document.getElementById('on-order-stock').textContent = '載入中...';

    // 清空替代品區域
    const substituteSection = document.getElementById('substitute-section');
    if (substituteSection) {
        substituteSection.innerHTML = '<p>載入中...</p>';
    }

    document.getElementById('tab-demand').innerHTML = '<p>載入中...</p>';

    // 隱藏替代版本分頁，只保留需求訂單分頁
    modal.querySelectorAll('.tab-link').forEach(l => {
        l.classList.remove('active');
        const tabName = l.getAttribute('data-tab');
        if (tabName === 'tab-substitute') {
            l.classList.add('hidden');
        } else {
            l.classList.remove('hidden');
        }
    });
    modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.tab-link[data-tab="tab-demand"]').classList.add('active');
    document.getElementById('tab-demand').classList.add('active');

    modal.showModal();

    // 載入採購單資料
    if (typeof loadPurchaseOrders === 'function') {
        loadPurchaseOrders(materialId);
    }

    // 根據當前儀表板類型傳遞參數
    const dashboardType = window.currentDashboardType || 'main';
    apiService.getMaterialDetails(materialId, dashboardType)
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }

            // 更新標題，顯示物料說明
            const description = data.material_description || '無說明';
            const modalTitle = document.getElementById('modal-title');
            modalTitle.innerHTML = `
                <div>物料詳情: ${materialId}</div>
                <div style="font-size: 0.85em; font-weight: normal; color: var(--pico-muted-color); margin-top: 0.3em;">${description}</div>
            `;

            // 更新庫存總覽
            document.getElementById('unrestricted-stock').textContent = FormatUtils.formatNumber(data.stock_summary.unrestricted);
            document.getElementById('inspection-stock').textContent = FormatUtils.formatNumber(data.stock_summary.inspection);
            document.getElementById('on-order-stock').textContent = FormatUtils.formatNumber(data.stock_summary.on_order);

            // 顯示替代品資訊
            renderSubstituteSection(data.substitute_inventory);

            // 計算並顯示缺料警示
            handleShortageAlert(data, materialId);

            // 顯示需求訂單
            renderDemandDetails(data.demand_details);
        })
        .catch(error => {
            console.error('Error fetching details:', error);
            handleModalError(error);
        });
}

/**
 * 渲染替代品區域
 * @param {Array} substitutes - 替代品清單
 */
function renderSubstituteSection(substitutes) {
    let subHTML = '<h4 style="margin-top: 1em; margin-bottom: 0.5em; color: var(--pico-primary);">可替代版本</h4>';
    
    if (substitutes && substitutes.length > 0) {
        subHTML += '<table style="font-size: 0.9em;"><thead><tr><th>通知</th><th>物料</th><th>說明</th><th>庫存</th><th>品檢中</th><th>總需求數</th></tr></thead><tbody>';
        substitutes.forEach(s => {
            const totalDemand = s.total_demand || 0;
            const isNotified = localStorage.getItem(`notify_${s['物料']}`) === 'true';
            const checkedAttr = isNotified ? 'checked' : '';
            subHTML += `<tr>
                <td><input type="checkbox" ${checkedAttr} onchange="toggleSubstituteNotify('${s['物料']}')"></td>
                <td>${s['物料']}</td>
                <td>${s['物料說明']}</td>
                <td>${FormatUtils.formatNumber(s.unrestricted_stock)}</td>
                <td>${FormatUtils.formatNumber(s.inspection_stock)}</td>
                <td>${FormatUtils.formatNumber(totalDemand)}</td>
            </tr>`;
        });
        subHTML += '</tbody></table>';
    } else {
        subHTML += '<p style="font-size: 0.9em; color: var(--pico-muted-color);">沒有找到可用的替代版本。</p>';
    }

    const substituteSection = document.getElementById('substitute-section');
    if (substituteSection) {
        substituteSection.innerHTML = subHTML;
    }
}

/**
 * 處理缺料警示
 * @param {object} data - 物料詳情資料
 * @param {string} materialId - 物料編號
 */
function handleShortageAlert(data, materialId) {
    const shortageAlertEl = document.getElementById('shortage-alert');
    const totalStock = CalcUtils.calculateTotalStock(
        data.stock_summary.unrestricted, 
        data.stock_summary.inspection
    );
    const totalAvailable = totalStock + data.stock_summary.on_order;
    const totalDemand = CalcUtils.calculateTotalDemand(data.demand_details);
    const shortage = Math.max(0, totalDemand - totalAvailable);

    if (shortageAlertEl && shortage > 0) {
        shortageAlertEl.style.display = 'block';

        const shortageQtyEl = document.getElementById('current-shortage-qty');
        if (shortageQtyEl) {
            shortageQtyEl.textContent = FormatUtils.formatNumber(shortage);
        }

        // 找開始缺料的需求日
        const shortageStartDate = findShortageStartDate(data.demand_details, totalAvailable);
        
        const demandDateEl = document.getElementById('earliest-demand-date');
        if (demandDateEl) {
            demandDateEl.textContent = shortageStartDate;
        }

        // 建議採購數量
        const suggestedQty = Math.ceil(shortage * 1.1);
        const deliveryQtyEl = document.getElementById('delivery-qty');
        if (deliveryQtyEl) {
            deliveryQtyEl.value = suggestedQty;
            deliveryQtyEl.placeholder = `建議: ${suggestedQty}`;
        }

        // 建議到貨日期（開始缺料需求日 - 3天）
        if (shortageStartDate !== '-') {
            try {
                const demandDate = new Date(shortageStartDate);
                demandDate.setDate(demandDate.getDate() - 3);
                const deliveryDateEl = document.getElementById('delivery-date');
                if (deliveryDateEl) {
                    deliveryDateEl.value = demandDate.toISOString().split('T')[0];
                }
            } catch (e) {
                // 忽略日期轉換錯誤
            }
        }
    } else if (shortageAlertEl) {
        shortageAlertEl.style.display = 'none';
    }

    // 載入現有交期資料
    if (typeof loadExistingDelivery === 'function') {
        loadExistingDelivery(materialId);
    }

    // 綁定交期表單事件
    if (typeof setupDeliveryFormEvents === 'function') {
        setupDeliveryFormEvents(materialId, data);
    }
}

/**
 * 找出開始缺料的需求日期
 * @param {Array} demands - 需求清單
 * @param {number} totalAvailable - 總可用數量
 * @returns {string} 開始缺料日期
 */
function findShortageStartDate(demands, totalAvailable) {
    let shortageStartDate = '-';
    let runningStock = totalAvailable;

    for (const demand of demands) {
        runningStock -= demand['未結數量 (EINHEIT)'];
        if (runningStock < 0 && shortageStartDate === '-') {
            shortageStartDate = demand['需求日期'];
            break;
        }
    }

    // 如果都會缺料，就用第一筆需求日
    if (shortageStartDate === '-' && demands.length > 0) {
        shortageStartDate = demands[0]['需求日期'];
    }

    return shortageStartDate;
}

/**
 * 渲染需求訂單詳情
 * @param {Array} demands - 需求清單
 */
function renderDemandDetails(demands) {
    let demandHTML = '<table><thead><tr><th>訂單號碼</th><th>未結數量</th><th>需求日期</th><th>預計剩餘庫存</th></tr></thead><tbody>';
    
    if (demands && demands.length > 0) {
        demands.forEach(d => {
            const shortageClass = d.is_shortage_point ? ' class="shortage-warning"' : '';
            demandHTML += `<tr>
                <td>${d['訂單']}</td>
                <td${shortageClass}>${FormatUtils.formatNumber(d['未結數量 (EINHEIT)'])}</td>
                <td>${d['需求日期']}</td>
                <td>${FormatUtils.formatNumber(d.remaining_stock)}</td>
            </tr>`;
        });
    } else {
        demandHTML += '<tr><td colspan="4">沒有找到相關的需求訂單。</td></tr>';
    }
    
    demandHTML += '</tbody></table>';
    document.getElementById('tab-demand').innerHTML = demandHTML;
}

/**
 * 處理彈窗載入錯誤
 * @param {Error} error - 錯誤物件
 */
function handleModalError(error) {
    const errorMsg = error.error || error.message || '未知錯誤';
    document.getElementById('unrestricted-stock').textContent = '-';
    document.getElementById('inspection-stock').textContent = '-';
    document.getElementById('on-order-stock').textContent = '-';

    const substituteSection = document.getElementById('substitute-section');
    if (substituteSection) {
        substituteSection.innerHTML = '<p style="color:red;">載入替代版本時發生錯誤。</p>';
    }

    document.getElementById('tab-demand').innerHTML = `<p style="color:red;">載入需求時發生錯誤: ${errorMsg}</p>`;
}
