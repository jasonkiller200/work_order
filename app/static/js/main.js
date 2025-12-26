


document.addEventListener('DOMContentLoaded', function () {
    checkApiStatus();

    if (window.location.pathname === '/procurement') {

        setupProcurementFilter();
        setupDashboardTabs(); // 設定儀表板頁籤切換
        setupStatsCardEvents(); // 🆕 設定統計圖卡事件
        setupItemsPerPageHandler(); // 🆕 設定每頁顯示數量選擇器的全域事件處理
        setTimeout(() => {
            loadProcurementDashboard(); // 載入採購儀表板資料
        }, 0);

    } else if (window.location.pathname === '/order_query') {
        // All setup is now in order-query.js
    }
});

function checkApiStatus() {
    const badge = document.querySelector('.status-indicator');
    const badgeText = document.getElementById('status-badge-text');

    fetch('/api/status')
        .then(response => response.json())
        .then(data => {
            if (data.service_status === 'online' && data.data_loaded) {
                // 正常狀態 - 綠色
                badge.className = 'status-indicator';
                badgeText.textContent = `✅ 快取: ${data.live_cache}`;
            } else if (data.service_status === 'online' && !data.data_loaded) {
                // 服務正常但資料未載入 - 橙色
                badge.className = 'status-indicator loading';
                badgeText.textContent = '⚠️ 資料載入中';
            } else {
                // 服務異常 - 紅色
                badge.className = 'status-indicator error';
                badgeText.textContent = '❌ 服務異常';
            }
        })
        .catch(error => {
            console.error('Error fetching status:', error);
            badge.className = 'status-indicator error';
            badgeText.textContent = '❌ 連線失敗';
        });
}



// 全局變數來儲存當前儀表板的資料和狀態
let currentDashboardType = 'main'; // 'main' 或 'finished'
let currentMaterialsData = []; // 儲存主儀表板的物料資料
let currentFinishedMaterialsData = []; // 儲存成品儀表板的物料資料
let allDeliveryData = {}; // 儲存所有物料的交期資料
let currentStatFilter = 'all'; // 儲存當前統計圖卡的篩選狀態 ('all', 'shortage-30-days', ...)
let currentFilterKeyword = ''; // 儲存物料篩選關鍵字
let currentBuyerKeyword = ''; // 儲存採購人員篩選關鍵字

// 全局變數來儲存排序狀態
let currentSortColumn = null;
let currentSortOrder = 'asc'; // 'asc' 或 'desc'

// 全局變數來儲存分頁狀態
let mainDashboardPage = 1;
let mainDashboardItemsPerPage = 20;
let finishedDashboardPage = 1;
let finishedDashboardItemsPerPage = 20;





// 🆕 狀態文字轉換函式
function getStatusText(status) {
    const statusMap = {
        'pending': '待交貨',
        'partial': '部分交貨',
        'completed': '已完成',
        'cancelled': '已取消',
        'overdue': '已延誤',
        'planned': '計畫中',
        'updated': '已更新'
    };
    return statusMap[status] || status;
}




window.renderMaterialsTable = function () {
    // 根據當前頁籤選擇對應的容器和資料
    const containerId = currentDashboardType === 'main' ? 'tab-main-dashboard' : 'tab-finished-dashboard';
    const container = document.getElementById(containerId);
    const sourceData = currentDashboardType === 'main' ? currentMaterialsData : currentFinishedMaterialsData;

    console.log('=== renderMaterialsTable 被呼叫 ===');
    console.log('當前儀表板類型:', currentDashboardType);
    console.log('主儀表板分頁:', mainDashboardPage, '每頁:', mainDashboardItemsPerPage);
    console.log('成品儀表板分頁:', finishedDashboardPage, '每頁:', finishedDashboardItemsPerPage);

    // 🆕 根據當前儀表板類型選擇對應的分頁變數
    const activePage = currentDashboardType === 'main' ? mainDashboardPage : finishedDashboardPage;
    const activeItemsPerPage = currentDashboardType === 'main' ? mainDashboardItemsPerPage : finishedDashboardItemsPerPage;

    console.log('使用的 activePage:', activePage, 'activeItemsPerPage:', activeItemsPerPage);

    let processedData = [...sourceData]; // 複製一份資料進行操作

    // 應用物料篩選
    if (currentFilterKeyword) {
        const keyword = currentFilterKeyword.toLowerCase();
        processedData = processedData.filter(m =>
            (m['物料'] && m['物料'].toLowerCase().includes(keyword)) ||
            (m['物料說明'] && m['物料說明'].toLowerCase().includes(keyword))
        );
    }

    // 應用採購人員篩選 (完全匹配)
    if (currentBuyerKeyword) {
        const buyerKeyword = currentBuyerKeyword.toLowerCase();
        processedData = processedData.filter(m =>
            m['採購人員'] && m['採購人員'].toLowerCase() === buyerKeyword
        );
    }

    // 🆕 應用統計圖卡篩選
    processedData = filterMaterialsByStats(processedData);

    // 應用過濾 (只顯示有目前缺料或預計缺料的項目) - 僅在預設篩選時套用
    if (currentStatFilter === 'all') {
        processedData = processedData.filter(m => m.current_shortage > 0 || m.projected_shortage > 0);
    }

    // 🆕 智慧排序（30日內缺料優先，然後按最早需求日期）
    processedData = sortMaterialsByPriority(processedData);

    // 如果有手動排序，在智慧排序後再套用
    if (currentSortColumn) {
        processedData.sort((a, b) => {
            let valA = a[currentSortColumn];
            let valB = b[currentSortColumn];

            // 處理數字排序
            if (typeof valA === 'number' && typeof valB === 'number') {
                return currentSortOrder === 'asc' ? valA - valB : valB - valA;
            }
            // 處理字串排序
            if (typeof valA === 'string' && typeof valB === 'string') {
                return currentSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return 0;
        });
    }

    // 計算分頁
    const totalItems = processedData.length;
    const totalPages = Math.ceil(totalItems / activeItemsPerPage);

    // 確保當前頁在有效範圍內並更新對應的全域變數
    let adjustedPage = activePage;
    if (adjustedPage > totalPages && totalPages > 0) {
        adjustedPage = totalPages;
    }
    if (adjustedPage < 1) {
        adjustedPage = 1;
    }

    // 更新對應儀表板的當前頁碼
    if (currentDashboardType === 'main') {
        mainDashboardPage = adjustedPage;
    } else {
        finishedDashboardPage = adjustedPage;
    }

    const startIndex = (adjustedPage - 1) * activeItemsPerPage;
    const endIndex = Math.min(startIndex + activeItemsPerPage, totalItems);
    const paginatedData = processedData.slice(startIndex, endIndex);

    // 顯示項目數量和分頁控制
    let controlsHTML = `
        <div class="table-controls">
            <div class="items-info">
                顯示第 ${totalItems > 0 ? startIndex + 1 : 0} - ${endIndex} 項，共 ${totalItems} 項
            </div>
            <div class="pagination-controls">
                <label style="white-space: nowrap; display: inline-flex; align-items: center; gap: 0.3em;">每頁顯示：<select id="items-per-page-select">
                        <option value="20" ${activeItemsPerPage === 20 ? 'selected' : ''}>20</option>
                        <option value="50" ${activeItemsPerPage === 50 ? 'selected' : ''}>50</option>
                        <option value="100" ${activeItemsPerPage === 100 ? 'selected' : ''}>100</option>
                        <option value="200" ${activeItemsPerPage === 200 ? 'selected' : ''}>200</option>
                        <option value="${totalItems}" ${activeItemsPerPage >= totalItems ? 'selected' : ''}>全部</option>
                    </select></label>
            </div>
        </div>
    `;

    let tableHTML = `<figure><table><thead><tr>
        <th data-sort-key="物料" class="sortable">物料 <span class="sort-icon"></span></th>
        <th data-sort-key="物料說明" class="sortable">物料說明 <span class="sort-icon"></span></th>
        <th data-sort-key="採購人員" class="sortable">採購人員 <span class="sort-icon"></span></th>
        <th data-sort-key="delivery_date" class="sortable">預計交貨日 <span class="sort-icon"></span></th>
        <th data-sort-key="total_demand" class="sortable">總需求 <span class="sort-icon"></span></th>
        <th data-sort-key="unrestricted_stock" class="sortable">庫存 <span class="sort-icon"></span></th>
        <th data-sort-key="inspection_stock" class="sortable">品檢中 <span class="sort-icon"></span></th>
        <th data-sort-key="on_order_stock" class="sortable">已訂未入 <span class="sort-icon"></span></th>
        <th data-sort-key="current_shortage" class="sortable shortage">目前缺料 <span class="sort-icon"></span></th>
        <th data-sort-key="projected_shortage" class="sortable shortage">預計缺料 <span class="sort-icon"></span></th>
        </tr></thead><tbody>`;

    if (paginatedData.length === 0) {
        tableHTML += '<tr><td colspan="10" style="text-align: center;">🎉 太棒了！目前沒有任何符合條件的缺料項目。</td></tr>';
    } else {
        paginatedData.forEach(m => {
            const buyer = m['採購人員'] || '-';
            // 檢查是否在30日內有缺料需求
            const shortage30Days = m.shortage_within_30_days || false;
            const rowClass = shortage30Days ? ' class="shortage-30-days"' : '';

            // 🆕 格式化預計交貨日期 (支援分批顯示)
            let deliveryDateStr = '-';
            let dateClass = '';
            let deliveryTooltip = '';


            if (m.delivery_schedules && m.delivery_schedules.length > 0) {
                // 有分批交貨資料
                const firstSchedule = m.delivery_schedules[0];
                const date = new Date(firstSchedule.expected_date);
                const today = new Date();
                const diffDays = Math.ceil((date - today) / (1000 * 60 * 60 * 24));

                // 顯示第一批的日期和數量
                deliveryDateStr = `${firstSchedule.expected_date} (${Math.round(firstSchedule.quantity)}件)`;

                // 🆕 檢查是否延遲(晚於第一筆需求日期)
                let delayDays = 0;
                if (m.demand_details && m.demand_details.length > 0) {
                    const firstDemandDate = new Date(m.demand_details[0]['需求日期']);
                    if (date > firstDemandDate) {
                        delayDays = Math.ceil((date - firstDemandDate) / (1000 * 60 * 60 * 24));
                        // 加入延遲警告標記
                        deliveryDateStr += ` <span style="background: #f44336; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.85em; white-space: nowrap;">⚠️ 延遲${delayDays}天</span>`;
                    }
                }

                // 如果有多批次,顯示批次數量標記
                if (m.delivery_schedules.length > 1) {
                    deliveryDateStr += ` <span style="background: #3b82f6; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.85em; white-space: nowrap;">+${m.delivery_schedules.length - 1}批</span>`;
                }

                // 根據天數設定顏色 (如果有延遲,優先顯示紅色)
                if (delayDays > 0) {
                    dateClass = ' style="color: #d32f2f; font-weight: bold;"';
                } else if (diffDays < 0) {
                    dateClass = ' style="color: #d32f2f; font-weight: bold;"';
                } else if (diffDays <= 7) {
                    dateClass = ' style="color: #ff9800; font-weight: bold;"';
                } else if (diffDays <= 30) {
                    dateClass = ' style="color: #4caf50; font-weight: bold;"';
                }

                // 🆕 建立 tooltip 內容 (最多顯示5筆)
                const displaySchedules = m.delivery_schedules.slice(0, 5);
                deliveryTooltip = displaySchedules.map((s, idx) => {
                    const statusText = getStatusText(s.status);
                    return `第${idx + 1}批: ${s.expected_date} (${Math.round(s.quantity)}件) - ${statusText}`;
                }).join('\n'); // 使用換行符號

                if (m.delivery_schedules.length > 5) {
                    deliveryTooltip += `\n... 還有 ${m.delivery_schedules.length - 5} 批 (點擊物料查看完整清單)`;
                }

            } else if (m.delivery_date) {
                // 向下相容:舊資料格式
                const date = new Date(m.delivery_date);
                const today = new Date();
                const diffDays = Math.ceil((date - today) / (1000 * 60 * 60 * 24));

                deliveryDateStr = date.toISOString().split('T')[0];

                if (diffDays < 0) {
                    dateClass = ' style="color: #d32f2f; font-weight: bold;"';
                } else if (diffDays <= 7) {
                    dateClass = ' style="color: #ff9800; font-weight: bold;"';
                } else if (diffDays <= 30) {
                    dateClass = ' style="color: #4caf50; font-weight: bold;"';
                }
            }

            tableHTML += `
                <tr${rowClass}>
                    <td><span class="material-link" data-material-id="${m['物料']}">${m['物料']}</span></td>
                    <td>${m['物料說明']}</td>
                    <td class="buyer-cell" data-material-id="${m['物料']}">${buyer}</td>
                    <td${dateClass} class="delivery-date-cell${m.delivery_schedules && m.delivery_schedules.length > 0 ? ' clickable-delivery' : ''}" data-schedules='${m.delivery_schedules ? JSON.stringify(m.delivery_schedules) : '[]'}' data-first-demand="${m.demand_details && m.demand_details.length > 0 ? m.demand_details[0]['需求日期'] : ''}">${deliveryDateStr}</td>
                    <td>${m.total_demand.toFixed(0)}</td>
                    <td>${m.unrestricted_stock.toFixed(0)}</td>
                    <td>${m.inspection_stock.toFixed(0)}</td>
                    <td>${m.on_order_stock.toFixed(0)}</td>
                    <td class="shortage-cell">${m.current_shortage > 0 ? `<strong>${m.current_shortage.toFixed(0)}</strong>` : '0'}</td>
                    <td class="shortage-cell">${m.projected_shortage > 0 ? `<strong>${m.projected_shortage.toFixed(0)}</strong>` : '0'}</td>
                </tr>
            `;
        });
    }
    tableHTML += `</tbody></table></figure>`;

    // 分頁按鈕 - 放在右下角
    let paginationHTML = '';
    if (totalPages > 1) {
        paginationHTML = '<div class="pagination-wrapper"><div class="pagination">';

        // 上一頁按鈕
        paginationHTML += `<button ${adjustedPage === 1 ? 'disabled' : ''} onclick="changePage(${adjustedPage - 1})">上一頁</button>`;

        // 頁碼按鈕
        const maxVisiblePages = 5;
        let startPage = Math.max(1, adjustedPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

        if (endPage - startPage < maxVisiblePages - 1) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        if (startPage > 1) {
            paginationHTML += `<button onclick="changePage(1)">1</button>`;
            if (startPage > 2) paginationHTML += `<span>...</span>`;
        }

        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `<button class="${i === adjustedPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) paginationHTML += `<span>...</span>`;
            paginationHTML += `<button onclick="changePage(${totalPages})">${totalPages}</button>`;
        }

        // 下一頁按鈕
        paginationHTML += `<button ${adjustedPage === totalPages ? 'disabled' : ''} onclick="changePage(${adjustedPage + 1})">下一頁</button>`;

        paginationHTML += '</div></div>';
    }

    container.innerHTML = controlsHTML + tableHTML + paginationHTML;

    // 不再在這裡綁定事件,改為使用全域事件委派

    addSortEventListeners(); // 添加排序事件監聽
    addMaterialLinkListeners(); // 添加物料連結事件監聽
    addBuyerCellListeners(); // 添加採購人員點擊事件監聽
    addDeliveryDateClickListeners(); // 🆕 添加交貨日期點擊事件監聽
    updateSortIcons(); // 更新排序圖示
}

// 🆕 添加交貨日期點擊事件監聽器
function addDeliveryDateClickListeners() {
    const deliveryCells = document.querySelectorAll('.clickable-delivery');
    deliveryCells.forEach(cell => {
        cell.addEventListener('click', function () {
            const schedulesData = this.getAttribute('data-schedules');
            const firstDemandDate = this.getAttribute('data-first-demand');
            if (schedulesData) {
                try {
                    const schedules = JSON.parse(schedulesData);
                    showDeliverySchedulesModal(schedules, firstDemandDate);
                } catch (e) {
                    console.error('Failed to parse delivery schedules:', e);
                }
            }
        });
    });
}

// 🆕 顯示分批交貨詳情彈出框
function showDeliverySchedulesModal(schedules, firstDemandDate) {
    if (!schedules || schedules.length === 0) return;

    const today = new Date();
    const firstDemand = firstDemandDate ? new Date(firstDemandDate) : null;

    let modalHTML = '<div style="max-height: 400px; overflow-y: auto;"><table style="width: 100%; font-size: 0.9em;"><thead><tr><th>批次</th><th>預計交貨日</th><th>數量</th><th>狀態</th>';

    // 🆕 如果有第一筆需求日期,加入延遲欄位
    if (firstDemand) {
        modalHTML += '<th>延遲</th>';
    }

    modalHTML += '</tr></thead><tbody>';

    schedules.forEach((s, idx) => {
        const scheduleDate = new Date(s.expected_date);
        const diffDays = Math.ceil((scheduleDate - today) / (1000 * 60 * 60 * 24));

        let colorStyle = '';
        if (diffDays < 0) {
            colorStyle = 'color: #d32f2f; font-weight: bold;';
        } else if (diffDays <= 7) {
            colorStyle = 'color: #ff9800; font-weight: bold;';
        } else if (diffDays <= 30) {
            colorStyle = 'color: #4caf50; font-weight: bold;';
        }

        const statusText = getStatusText(s.status);

        // 🆕 計算延遲天數
        let delayCell = '';
        if (firstDemand) {
            if (scheduleDate > firstDemand) {
                const delayDays = Math.ceil((scheduleDate - firstDemand) / (1000 * 60 * 60 * 24));
                delayCell = `<td style="color: #f44336; font-weight: bold;">⚠️ ${delayDays}天</td>`;
            } else {
                delayCell = '<td style="color: #4caf50;">✓ 準時</td>';
            }
        }

        modalHTML += `<tr>
            <td>第 ${idx + 1} 批</td>
            <td style="${colorStyle}">${s.expected_date}</td>
            <td>${Math.round(s.quantity)} 件</td>
            <td>${statusText}</td>
            ${delayCell}
        </tr>`;
    });

    modalHTML += '</tbody></table></div>';

    // 使用 Pico.css 的 dialog 或自訂彈出框
    showSimpleAlert('分批交貨詳情', modalHTML);
}

// 🆕 簡單的彈出框函數
function showSimpleAlert(title, content) {
    // 🆕 偵測暗黑模式
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

    // 創建遮罩層
    const overlay = document.createElement('div');
    overlay.style.cssText = `position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,${isDarkMode ? '0.7' : '0.5'}); z-index: 9999; display: flex; align-items: center; justify-content: center;`;

    // 創建彈出框
    const modal = document.createElement('div');
    const bgColor = isDarkMode ? '#1e1e1e' : 'white';
    const textColor = isDarkMode ? '#e0e0e0' : '#333';
    const borderColor = isDarkMode ? '#404040' : '#e0e0e0';

    modal.style.cssText = `background: ${bgColor}; color: ${textColor}; padding: 2em; border-radius: 8px; max-width: 600px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.5); border: 1px solid ${borderColor};`;
    modal.innerHTML = `
        <h3 style="margin-top: 0; color: ${textColor};">${title}</h3>
        ${content}
        <div style="text-align: right; margin-top: 1.5em;">
            <button onclick="this.closest('[style*=fixed]').remove()" class="secondary">關閉</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 點擊遮罩層關閉
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
}

// 切換頁面函數
function changePage(page) {
    // 🆕 根據當前儀表板類型更新對應的分頁變數
    if (currentDashboardType === 'main') {
        mainDashboardPage = page;
    } else {
        finishedDashboardPage = page;
    }
    renderMaterialsTable();

    // 🆕 滾動到表格清單位置
    setTimeout(() => {
        const tabContent = document.getElementById('dashboard-tabs-content');
        if (tabContent) {
            tabContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 100);
}

function addSortEventListeners() {
    document.querySelectorAll('.sortable').forEach(header => {
        header.addEventListener('click', function () {
            const sortKey = this.dataset.sortKey;
            if (currentSortColumn === sortKey) {
                currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortColumn = sortKey;
                currentSortOrder = 'asc';
            }
            renderMaterialsTable();
        });
    });
}

function updateSortIcons() {
    document.querySelectorAll('.sortable').forEach(header => {
        const sortIcon = header.querySelector('.sort-icon');
        sortIcon.textContent = ''; // 清除所有圖示
        if (header.dataset.sortKey === currentSortColumn) {
            sortIcon.textContent = currentSortOrder === 'asc' ? ' ▲' : ' ▼';
        }
    });
}

function addMaterialLinkListeners() {
    document.querySelectorAll('.material-link').forEach(link => {
        link.addEventListener('click', function (e) {
            e.stopPropagation();
            const materialId = this.dataset.materialId;
            openDetailsModal(materialId);
        });
    });
}

function addBuyerCellListeners() {
    document.querySelectorAll('.buyer-cell').forEach(cell => {
        cell.addEventListener('click', function (e) {
            e.stopPropagation();
            const materialId = this.dataset.materialId;
            openBuyerReferenceModal(materialId);
        });
    });
}

window.populateBuyerFilter = function (materials) {
    const buyerFilterSelect = document.getElementById('buyer-filter-select');
    if (!buyerFilterSelect) return;

    const buyers = [...new Set(materials.map(m => m['採購人員']).filter(Boolean))];
    buyers.sort();

    // Clear existing options except the first one
    while (buyerFilterSelect.options.length > 1) {
        buyerFilterSelect.remove(1);
    }

    buyers.forEach(buyer => {
        const option = document.createElement('option');
        option.value = buyer;
        option.textContent = buyer;
        buyerFilterSelect.appendChild(option);
    });
}









function setupProcurementFilter() {
    const filterInput = document.getElementById('material-filter-input');
    const buyerFilterSelect = document.getElementById('buyer-filter-select');
    const applyFilterBtn = document.getElementById('apply-filter-btn');
    const clearFilterBtn = document.getElementById('clear-filter-btn');

    if (applyFilterBtn && filterInput) {
        // 應用物料篩選
        const applyMaterialFilter = function () {
            if (currentDashboardType === 'main') {
                mainDashboardPage = 1;
            } else {
                finishedDashboardPage = 1;
            }
            renderMaterialsTable();
        };

        applyFilterBtn.addEventListener('click', applyMaterialFilter);

        // 允許按 Enter 鍵觸發物料查詢
        filterInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                applyMaterialFilter();
            }
        });
    }

    // 採購人員下拉選單直接觸發篩選
    if (buyerFilterSelect) {
        buyerFilterSelect.addEventListener('change', function () {
            currentBuyerKeyword = this.value;
            if (currentDashboardType === 'main') {
                mainDashboardPage = 1;
            } else {
                finishedDashboardPage = 1;
            }
            renderMaterialsTable();
        });
    }

    // 清除搜尋
    if (clearFilterBtn) {
        clearFilterBtn.addEventListener('click', function () {
            if (filterInput) filterInput.value = '';
            if (buyerFilterSelect) buyerFilterSelect.value = '';
            currentFilterKeyword = '';
            currentBuyerKeyword = '';
            if (currentDashboardType === 'main') {
                mainDashboardPage = 1;
            } else {
                finishedDashboardPage = 1;
            }
            renderMaterialsTable();
        });
    }

    // 🆕 Excel 匯出按鈕
    const exportExcelBtn = document.getElementById('export-excel-btn');
    if (exportExcelBtn) {
        exportExcelBtn.addEventListener('click', function () {
            exportToExcel();
        });
    }
}

// 設定儀表板頁籤切換
function setupDashboardTabs() {
    document.querySelectorAll('.dashboard-tab-link').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const tabId = this.dataset.tab;

            // 更新當前儀表板類型
            currentDashboardType = tabId === 'tab-main-dashboard' ? 'main' : 'finished';

            // 切換頁籤樣式
            document.querySelectorAll('.dashboard-tab-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.dashboard-tab-content').forEach(c => c.classList.remove('active'));

            this.classList.add('active');
            document.getElementById(tabId).classList.add('active');

            // 🆕 更新統計圖卡（根據當前頁籤）
            if (typeof updateStatsCards === 'function') {
                updateStatsCards();
            }

            // 重新渲染表格
            renderMaterialsTable();
        });
    });
}

// 🆕 設定每頁顯示數量選擇器的全域事件處理(使用事件委派)
function setupItemsPerPageHandler() {
    console.log('=== setupItemsPerPageHandler 被呼叫 ===');

    // 使用事件委派,在 document 層級監聽
    document.addEventListener('change', function (e) {
        // 檢查是否是我們的選擇器
        if (e.target && e.target.id === 'items-per-page-select') {
            const newValue = parseInt(e.target.value);

            console.log('=== 選擇器 change 事件觸發 (事件委派) ===');
            console.log('新值:', newValue);
            console.log('當前儀表板類型:', currentDashboardType);
            console.log('修改前 - 主儀表板:', mainDashboardItemsPerPage, '成品儀表板:', finishedDashboardItemsPerPage);

            // 根據當前儀表板類型更新對應的全域變數
            if (currentDashboardType === 'main') {
                mainDashboardItemsPerPage = newValue;
                mainDashboardPage = 1; // 重置到第一頁
            } else {
                finishedDashboardItemsPerPage = newValue;
                finishedDashboardPage = 1; // 重置到第一頁
            }

            console.log('修改後 - 主儀表板:', mainDashboardItemsPerPage, '成品儀表板:', finishedDashboardItemsPerPage);
            console.log('準備重新渲染...');
            renderMaterialsTable();
        }
    });

    console.log('每頁顯示數量選擇器事件委派設定完成');
}





// ==================== Excel 匯出功能 ====================

/**
 * 匯出當前儀表板資料到 Excel (使用 ExcelJS)
 */
async function exportToExcel() {
    // 檢查 ExcelJS 是否已載入
    if (typeof ExcelJS === 'undefined') {
        alert('Excel 匯出功能載入失敗,請重新整理頁面後再試。');
        return;
    }

    // 根據當前儀表板類型選擇資料源
    const sourceData = currentDashboardType === 'main' ? currentMaterialsData : currentFinishedMaterialsData;
    const dashboardName = currentDashboardType === 'main' ? '主儀表板' : '成品儀表板';

    // 複製資料並應用篩選條件
    let processedData = [...sourceData];

    // 應用物料篩選
    if (currentFilterKeyword) {
        const keyword = currentFilterKeyword.toLowerCase();
        processedData = processedData.filter(m =>
            (m['物料'] && m['物料'].toLowerCase().includes(keyword)) ||
            (m['物料說明'] && m['物料說明'].toLowerCase().includes(keyword))
        );
    }

    // 應用採購人員篩選 (完全匹配)
    if (currentBuyerKeyword) {
        const buyerKeyword = currentBuyerKeyword.toLowerCase();
        processedData = processedData.filter(m =>
            m['採購人員'] && m['採購人員'].toLowerCase() === buyerKeyword
        );
    }

    // 應用過濾 (只顯示有目前缺料或預計缺料的項目)
    processedData = processedData.filter(m => m.current_shortage > 0 || m.projected_shortage > 0);

    // 應用統計圖卡篩選
    if (typeof filterMaterialsByStats === 'function') {
        processedData = filterMaterialsByStats(processedData);
    }

    // 智慧排序
    if (typeof sortMaterialsByPriority === 'function') {
        processedData = sortMaterialsByPriority(processedData);
    }

    // 檢查是否有資料
    if (processedData.length === 0) {
        alert('目前沒有符合條件的資料可以匯出。');
        return;
    }

    try {
        // 建立新的工作簿
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(dashboardName);

        // 定義欄位
        worksheet.columns = [
            { header: '物料', key: 'material', width: 15 },
            { header: '圖號', key: 'drawing_number', width: 12 },
            { header: '物料說明', key: 'description', width: 30 },
            { header: '採購人員', key: 'buyer', width: 12 },
            { header: '預計交貨日', key: 'delivery_date', width: 12 },
            { header: '總需求', key: 'total_demand', width: 10 },
            { header: '庫存', key: 'stock', width: 10 },
            { header: '品檢中', key: 'inspection', width: 10 },
            { header: '已訂未入', key: 'on_order', width: 10 },
            { header: '目前缺料', key: 'current_shortage', width: 10 },
            { header: '預計缺料', key: 'projected_shortage', width: 10 }
        ];

        // 設定標題列樣式
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // 添加資料列
        processedData.forEach((m) => {
            // 格式化預計交貨日期
            let deliveryDateStr = '';
            if (m.delivery_date) {
                const date = new Date(m.delivery_date);
                deliveryDateStr = date.toISOString().split('T')[0];
            }

            const row = worksheet.addRow({
                material: m['物料'] || '',
                drawing_number: m['drawing_number'] || '',
                description: m['物料說明'] || '',
                buyer: m['採購人員'] || '',
                delivery_date: deliveryDateStr,
                total_demand: m.total_demand ? parseFloat(m.total_demand.toFixed(0)) : 0,
                stock: m.unrestricted_stock ? parseFloat(m.unrestricted_stock.toFixed(0)) : 0,
                inspection: m.inspection_stock ? parseFloat(m.inspection_stock.toFixed(0)) : 0,
                on_order: m.on_order_stock ? parseFloat(m.on_order_stock.toFixed(0)) : 0,
                current_shortage: m.current_shortage ? parseFloat(m.current_shortage.toFixed(0)) : 0,
                projected_shortage: m.projected_shortage ? parseFloat(m.projected_shortage.toFixed(0)) : 0
            });

            // 🆕 如果是 30 日內缺料項目,設定綠色背景
            if (m.shortage_within_30_days) {
                row.eachCell((cell) => {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFC8E6C9' } // 淡綠色背景
                    };
                });
            }
        });

        // 自動調整欄位寬度(根據內容)
        worksheet.columns.forEach((column, index) => {
            let maxLength = column.header.length;
            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber > 1) { // 跳過標題列
                    const cell = row.getCell(index + 1);
                    const cellValue = cell.value ? cell.value.toString() : '';
                    // 計算字元寬度 (中文字元算2個單位)
                    let length = 0;
                    for (let i = 0; i < cellValue.length; i++) {
                        length += cellValue.charCodeAt(i) > 127 ? 2 : 1;
                    }
                    maxLength = Math.max(maxLength, length);
                }
            });
            column.width = Math.min(maxLength + 2, 50); // 設定最大寬度為 50
        });

        // 生成檔案名稱
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        const fileName = `採購儀表板_${dashboardName}_${dateStr}.xlsx`;

        // 生成 Excel 檔案並下載
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        // 使用 FileSaver.js 下載檔案
        if (typeof saveAs !== 'undefined') {
            saveAs(blob, fileName);
        } else {
            // 備用方案:使用原生下載
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            window.URL.revokeObjectURL(url);
        }

        console.log(`Excel 檔案已匯出: ${fileName}`);
    } catch (error) {
        console.error('匯出 Excel 時發生錯誤:', error);
        alert('匯出 Excel 時發生錯誤,請稍後再試。');
    }
}

/**
 * 計算每個欄位的最佳寬度
 * @param {Array} data - 二維陣列資料 (包含標題列)
 * @returns {Array} - 欄位寬度設定陣列
 */
function calculateColumnWidths(data) {
    const columnWidths = [];

    // 取得欄位數量
    const numCols = data[0].length;

    // 為每個欄位計算最大寬度
    for (let col = 0; col < numCols; col++) {
        let maxWidth = 10; // 最小寬度

        for (let row = 0; row < data.length; row++) {
            const cellValue = data[row][col];
            if (cellValue) {
                const cellStr = String(cellValue);
                // 計算字元寬度 (中文字元算2個單位,英文算1個單位)
                let width = 0;
                for (let i = 0; i < cellStr.length; i++) {
                    const char = cellStr.charCodeAt(i);
                    // 判斷是否為中文字元 (簡單判斷)
                    if (char > 127) {
                        width += 2;
                    } else {
                        width += 1;
                    }
                }
                maxWidth = Math.max(maxWidth, width);
            }
        }

        // 設定欄位寬度 (加一點緩衝空間)
        columnWidths.push({ wch: maxWidth + 2 });
    }

    return columnWidths;
}


