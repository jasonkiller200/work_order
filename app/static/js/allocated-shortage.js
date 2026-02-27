/**
 * 已撥缺料頁面 JavaScript
 * 顯示領料系統已撥出但仍缺料的物料清單
 */

// 外部 API 來源
const SHORTAGE_API_URL = 'http://192.168.6.137:8000/requisitions/api/shortage_materials/';

// 設定當前儀表板類型，供 material-modal.js 使用
const currentDashboardType = 'main';

// 快取資料
let allShortageData = [];
let semiData = [];
let finishedData = [];

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    initTabEvents();
    initModalEvents();
    initSearchEvents();
    loadShortageData();
    
    // 初始化物料詳情模態視窗
    if (typeof setupModal === 'function') {
        setupModal();
    }
});

/**
 * 初始化搜尋事件
 */
function initSearchEvents() {
    // 半成品搜尋
    const semiSearch = document.getElementById('semi-search');
    if (semiSearch) {
        semiSearch.addEventListener('input', function() {
            const keyword = this.value.trim();
            filterAndRenderTable('semi', semiData, keyword);
        });
    }
    
    // 成品搜尋
    const finishedSearch = document.getElementById('finished-search');
    if (finishedSearch) {
        finishedSearch.addEventListener('input', function() {
            const keyword = this.value.trim();
            filterAndRenderTable('finished', finishedData, keyword);
        });
    }
}

/**
 * 過濾並渲染表格
 * @param {string} type - 'semi' 或 'finished'
 * @param {Array} data - 原始資料
 * @param {string} keyword - 搜尋關鍵字
 */
function filterAndRenderTable(type, data, keyword) {
    let filteredData = data;
    
    if (keyword) {
        filteredData = data.filter(item => {
            const orders = item.orders || [];
            // 檢查是否有任一訂單符合搜尋條件
            return orders.some(order => {
                // 完整比對（前綴或完整）
                if (order.startsWith(keyword)) return true;
                // 後4碼比對
                if (order.length >= 4 && order.slice(-4).includes(keyword)) return true;
                // 一般包含比對
                if (order.includes(keyword)) return true;
                return false;
            });
        });
    }
    
    const tbody = document.getElementById(`${type}-tbody`);
    
    // 更新統計（使用過濾後的資料）
    updateStats(type, filteredData);
    
    if (filteredData.length === 0) {
        const noDataMsg = keyword 
            ? `🔍 找不到符合「${keyword}」的工單`
            : (type === 'semi' ? '🎉 目前無半成品缺料' : '🎉 目前無成品缺料');
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--pico-muted-color);">${noDataMsg}</td></tr>`;
        return;
    }
    
    tbody.innerHTML = filteredData.map(item => renderRow(item)).join('');
}

/**
 * 初始化頁籤切換事件
 */
function initTabEvents() {
    document.querySelectorAll('.shortage-tabs .tab-link').forEach(tabLink => {
        tabLink.addEventListener('click', function(e) {
            e.preventDefault();
            const targetTab = this.dataset.tab;
            
            // 切換頁籤樣式
            document.querySelectorAll('.shortage-tabs .tab-link').forEach(link => link.classList.remove('active'));
            this.classList.add('active');
            
            // 切換內容顯示
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            document.getElementById(targetTab).classList.add('active');
        });
    });
}

/**
 * 初始化彈窗事件
 */
function initModalEvents() {
    // 缺料明細彈窗關閉事件
    document.getElementById('close-shortage-modal')?.addEventListener('click', closeShortageModal);
    document.getElementById('close-shortage-btn')?.addEventListener('click', closeShortageModal);
}

/**
 * 載入缺料資料
 */
async function loadShortageData() {
    try {
        // 透過本地代理 API 呼叫外部 API（避免 CORS）
        const response = await fetch('/api/allocated-shortage');
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || '載入失敗');
        }
        
        allShortageData = data.shortage_materials || [];
        
        // 分類資料
        classifyData();
        
        // 渲染表格
        renderSemiTable();
        renderFinishedTable();
        
    } catch (error) {
        console.error('載入已撥缺料資料失敗:', error);
        document.getElementById('semi-tbody').innerHTML = 
            `<tr><td colspan="6" style="text-align: center; color: #f44336;">載入失敗: ${error.message}</td></tr>`;
        document.getElementById('finished-tbody').innerHTML = 
            `<tr><td colspan="6" style="text-align: center; color: #f44336;">載入失敗: ${error.message}</td></tr>`;
    }
}

/**
 * 分類資料：半成品 vs 成品
 * 依照關聯訂單號碼分類：
 * - 成品缺料：關聯訂單為 1 開頭（成品工單）
 * - 半成品缺料：關聯訂單為 2 開頭、63 開頭（半成品工單）
 * 
 * 注意：同一物料可能同時關聯成品和半成品訂單，需要拆分處理
 */
function classifyData() {
    semiData = [];
    finishedData = [];
    
    allShortageData.forEach(item => {
        const orders = item.orders || [];
        
        // 分離成品訂單和半成品訂單
        const finishedOrders = orders.filter(order => order.startsWith('1'));
        const semiOrders = orders.filter(order => !order.startsWith('1'));
        
        // 如果有成品訂單關聯，加入成品頁籤
        if (finishedOrders.length > 0) {
            finishedData.push({
                ...item,
                orders: finishedOrders  // 只顯示成品訂單
            });
        }
        
        // 如果有半成品訂單關聯，加入半成品頁籤
        if (semiOrders.length > 0) {
            semiData.push({
                ...item,
                orders: semiOrders  // 只顯示半成品訂單
            });
        }
    });
}

/**
 * 渲染半成品缺料表格
 */
function renderSemiTable() {
    const searchInput = document.getElementById('semi-search');
    const keyword = searchInput ? searchInput.value.trim() : '';
    filterAndRenderTable('semi', semiData, keyword);
}

/**
 * 渲染成品缺料表格
 */
function renderFinishedTable() {
    const searchInput = document.getElementById('finished-search');
    const keyword = searchInput ? searchInput.value.trim() : '';
    filterAndRenderTable('finished', finishedData, keyword);
}

/**
 * 渲染單行資料
 */
function renderRow(item) {
    const materialNumber = item.material_number || '';
    const itemName = item.item_name || '';
    const totalShortage = item.total_shortage || 0;
    const orders = item.orders || [];
    const arrivalDate = item.estimated_arrival_date;
    const buyer = item.buyer || '';
    
    // 預計到貨日顯示
    const arrivalDateHtml = arrivalDate 
        ? `<span class="has-arrival-date">${arrivalDate}</span>`
        : `<span class="no-arrival-date">未設定</span>`;
    
    // 關聯訂單顯示（可點擊）
    const ordersHtml = orders.length > 0 
        ? `<div class="orders-list">${orders.map(order => 
            `<span class="order-badge clickable-order" onclick="showOrderShortageDetails('${order}')">${order}</span>`
          ).join('')}</div>`
        : '-';
    
    // 採購人員顯示
    const buyerHtml = buyer 
        ? `<span style="color: var(--pico-primary);">${buyer}</span>` 
        : `<span style="color: var(--pico-muted-color);">-</span>`;
    
    return `
        <tr>
            <td>
                <span class="clickable-material" onclick="openDetailsModal('${materialNumber}')">${materialNumber}</span>
            </td>
            <td title="${itemName}">${truncateText(itemName, 30)}</td>
            <td>${buyerHtml}</td>
            <td style="text-align: center; font-weight: bold; color: #f44336;">${totalShortage}</td>
            <td>${ordersHtml}</td>
            <td>${arrivalDateHtml}</td>
        </tr>
    `;
}

/**
 * 更新統計數據
 */
function updateStats(type, data) {
    const totalCount = data.length;
    const noDateCount = data.filter(item => !item.estimated_arrival_date).length;
    const hasDateCount = totalCount - noDateCount;
    
    document.getElementById(`${type}-total-count`).textContent = totalCount;
    document.getElementById(`${type}-no-date-count`).textContent = noDateCount;
    document.getElementById(`${type}-has-date-count`).textContent = hasDateCount;
}

/**
 * 截斷文字
 */
function truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

/**
 * 顯示工單缺料明細（從 work-order-stats.js 複製並調整）
 */
async function showOrderShortageDetails(orderId) {
    // 判斷工單類型：1開頭為成品，其他為半品
    const orderType = orderId.startsWith('1') ? 'finished' : 'semi';
    
    const modal = document.getElementById('shortage-modal');
    const title = document.getElementById('shortage-modal-title');
    const summary = document.getElementById('shortage-summary');
    const tbody = document.getElementById('shortage-details-tbody');

    title.textContent = `工單 ${orderId} 缺料明細`;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center;">載入中...</td></tr>';
    modal.showModal();

    try {
        // 同時載入缺料明細和採購人員清單
        const [shortageResult, buyersResult] = await Promise.all([
            fetch(`/api/work-order-statistics/${orderId}/shortage-details?order_type=${orderType}`).then(r => r.json()),
            fetch('/api/buyers_list').then(r => r.json())
        ]);

        if (shortageResult.error) {
            throw new Error(shortageResult.error);
        }

        const buyersList = buyersResult.buyers || [];

        summary.innerHTML = `
            <strong>缺料筆數:</strong> <span style="color: ${shortageResult.shortage_count > 0 ? '#f44336' : '#4caf50'};">${shortageResult.shortage_count}</span> / 
            <strong>物料總數:</strong> ${shortageResult.total_materials}
        `;

        if (!shortageResult.details || shortageResult.details.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align: center;">此工單無物料需求</td></tr>';
            return;
        }

        // 建立採購人員下拉選單的 HTML
        function buildBuyerSelect(materialId, currentBuyer) {
            let options = '<option value="">未指定</option>';
            buyersList.forEach(buyer => {
                const selected = buyer === currentBuyer ? 'selected' : '';
                options += `<option value="${buyer}" ${selected}>${buyer}</option>`;
            });
            return `<select class="shortage-buyer-select" 
                           data-material-id="${materialId}" 
                           data-dashboard-type="${orderType === 'finished' ? 'finished' : 'main'}"
                           style="font-size: 0.85em; padding: 0.2em 0.4em; min-width: 80px;">
                        ${options}
                    </select>`;
        }

        tbody.innerHTML = shortageResult.details.map(item => {
            const isShortage = item['是否缺料'];
            const rowClass = isShortage ? 'shortage-row' : '';
            const statusText = isShortage ? '⚠️ 缺料' : '✅ 充足';
            const statusColor = isShortage ? '#f44336' : '#4caf50';
            const currentBuyer = item['採購人員'] || '';

            return `
                <tr class="${rowClass}">
                    <td>
                        <span class="clickable-material" onclick="openDetailsModal('${item['物料']}')">${item['物料']}</span>
                    </td>
                    <td title="${item['物料說明'] || ''}">${truncateText(item['物料說明'] || '', 25)}</td>
                    <td>${item['需求數量'] || 0}</td>
                    <td>${item['未限制'] || 0}</td>
                    <td>${item['品檢中'] || 0}</td>
                    <td style="color: ${statusColor};">${statusText}</td>
                    <td>${item['需求日期'] || '-'}</td>
                    <td>${buildBuyerSelect(item['物料'], currentBuyer)}</td>
                    <td>${item['預計交貨日'] || '-'}</td>
                </tr>
            `;
        }).join('');

        // 綁定採購人員下拉選單變更事件
        bindShortageBuyerSelectEvents();

    } catch (error) {
        console.error('載入缺料明細失敗:', error);
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #f44336;">載入失敗: ${error.message}</td></tr>`;
    }
}

/**
 * 綁定缺料明細中採購人員下拉選單的變更事件
 */
function bindShortageBuyerSelectEvents() {
    document.querySelectorAll('.shortage-buyer-select').forEach(select => {
        select.addEventListener('change', async function() {
            const materialId = this.dataset.materialId;
            const dashboardType = this.dataset.dashboardType;
            const newBuyer = this.value;
            
            try {
                const response = await fetch(`/api/material/${materialId}/buyer`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        buyer: newBuyer,
                        dashboard_type: dashboardType
                    })
                });
                
                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.error || '更新失敗');
                }
                
                // 成功更新，顯示短暫提示
                this.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
                setTimeout(() => {
                    this.style.backgroundColor = '';
                }, 1000);
                
            } catch (error) {
                console.error('更新採購人員失敗:', error);
                alert('更新採購人員失敗: ' + error.message);
            }
        });
    });
}

/**
 * 關閉缺料明細彈窗
 */
function closeShortageModal() {
    const modal = document.getElementById('shortage-modal');
    if (modal) {
        modal.close();
    }
}

/**
 * 開啟物料詳情彈窗（使用 material-modal.js 的函數）
 */
function showMaterialDetails(materialId) {
    if (typeof openDetailsModal === 'function') {
        openDetailsModal(materialId);
    } else {
        console.error('openDetailsModal 函數不存在');
    }
}
