document.addEventListener('DOMContentLoaded', function () {
    checkApiStatus();

    if (window.location.pathname === '/procurement') {
        loadProcurementDashboard();
        setupModal();
        setupProcurementFilter();
        setupDashboardTabs(); // 設定儀表板頁籤切換
        setupStatsCardEvents(); // 🆕 設定統計圖卡事件
        setupItemsPerPageHandler(); // 🆕 設定每頁顯示數量選擇器的全域事件處理
    } else if (window.location.pathname === '/order_query') {
        setupOrderSearch();
        setupModal();
        setupOrderTabs();
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

// 全局變數來儲存原始資料、排序狀態和篩選關鍵字
let currentMaterialsData = [];
let currentFinishedMaterialsData = []; // 成品儀表板資料
let currentSortColumn = null;
let currentSortOrder = 'asc'; // 'asc' 或 'desc'
let currentFilterKeyword = ''; // 物料篩選關鍵字
let currentBuyerKeyword = ''; // 採購人員篩選關鍵字

// 🆕 統計圖卡篩選
let currentStatFilter = 'all'; // 當前圖卡篩選狀態
let allDeliveryData = {}; // 所有交期資料

// 分頁相關變數 - 為兩個儀表板各自維護獨立的分頁狀態
let mainDashboardPage = 1;
let mainDashboardItemsPerPage = 50;
let finishedDashboardPage = 1;
let finishedDashboardItemsPerPage = 50;

// 當前顯示的儀表板類型
let currentDashboardType = 'main'; // 'main' 或 'finished'

// 全局變數來儲存訂單物料的排序狀態
let orderMaterialsData = []; // 儲存原始訂單物料資料
let orderMaterialsSortColumn = null;
let orderMaterialsSortOrder = 'asc'; // 'asc' 或 'desc'

// 新增：全局變數來儲存當前查詢的訂單號碼
let currentOrderId = null;

function loadProcurementDashboard() {
    // 同時載入主儀表板、成品儀表板、交期資料
    Promise.all([
        fetch('/api/materials').then(r => r.json()),
        fetch('/api/finished_materials').then(r => r.json()),
        fetch('/api/delivery/all').then(r => r.json()),
        fetch('/api/demand_details/all').then(r => r.json())
    ])
        .then(([materialsData, finishedData, deliveryData, demandDetailsData]) => {
            // 儲存資料
            allDeliveryData = deliveryData.schedules || {};

            // 🆕 為每個物料加入最早需求日期和交期資訊
            currentMaterialsData = enhanceMaterialsData(materialsData, demandDetailsData, allDeliveryData);
            currentFinishedMaterialsData = enhanceMaterialsData(finishedData, demandDetailsData, allDeliveryData);

            // 🆕 計算並更新統計
            updateStatsCards();

            // 填充採購人員下拉選單
            populateBuyerFilter(currentMaterialsData);

            // 渲染當前儀表板
            renderMaterialsTable();
        })
        .catch(error => {
            console.error('Error loading dashboard data:', error);
            document.getElementById('tab-main-dashboard').innerHTML = '<p style="color: red;">載入儀表板資料時發生錯誤。</p>';
            document.getElementById('tab-finished-dashboard').innerHTML = '<p style="color: red;">載入儀表板資料時發生錯誤。</p>';
        });
}

// 填充採購人員下拉選單
function populateBuyerFilter(data) {
    const buyerSelect = document.getElementById('buyer-filter-select');
    if (!buyerSelect) return;

    // 收集所有不重複的採購人員
    const buyers = new Set();
    data.forEach(item => {
        if (item['採購人員'] && item['採購人員'].trim() !== '') {
            buyers.add(item['採購人員']);
        }
    });

    // 排序並填充下拉選單
    const sortedBuyers = Array.from(buyers).sort();
    sortedBuyers.forEach(buyer => {
        const option = document.createElement('option');
        option.value = buyer;
        option.textContent = buyer;
        buyerSelect.appendChild(option);
    });
}

function renderMaterialsTable() {
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

    // 應用採購人員篩選
    if (currentBuyerKeyword) {
        const buyerKeyword = currentBuyerKeyword.toLowerCase();
        processedData = processedData.filter(m =>
            m['採購人員'] && m['採購人員'].toLowerCase().includes(buyerKeyword)
        );
    }

    // 應用過濾 (只顯示有目前缺料或預計缺料的項目)
    processedData = processedData.filter(m => m.current_shortage > 0 || m.projected_shortage > 0);

    // 🆕 應用統計圖卡篩選
    processedData = filterMaterialsByStats(processedData);

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

            // 🆕 格式化預計交貨日期
            let deliveryDateStr = '-';
            let dateClass = '';
            if (m.delivery_date) {
                const date = new Date(m.delivery_date);
                const today = new Date();
                const diffDays = Math.ceil((date - today) / (1000 * 60 * 60 * 24));

                deliveryDateStr = date.toISOString().split('T')[0];

                // 根據天數設定顏色
                if (diffDays < 0) {
                    dateClass = ' style="color: #d32f2f; font-weight: bold;" title="已延誤"';
                } else if (diffDays <= 7) {
                    dateClass = ' style="color: #ff9800; font-weight: bold;" title="7日內到貨"';
                } else if (diffDays <= 30) {
                    dateClass = ' style="color: #4caf50; font-weight: bold;" title="30日內到貨"';
                }
            }

            tableHTML += `
                <tr${rowClass}>
                    <td><span class="material-link" data-material-id="${m['物料']}">${m['物料']}</span></td>
                    <td>${m['物料說明']}</td>
                    <td class="buyer-cell" data-material-id="${m['物料']}">${buyer}</td>
                    <td${dateClass}>${deliveryDateStr}</td>
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
    updateSortIcons(); // 更新排序圖示
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
    // 滾動到頂部
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

function setupModal() {
    const modal = document.getElementById('details-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const closeLink = modal.querySelector('.close');

    const closeModal = () => modal.close();
    closeModalBtn.addEventListener('click', closeModal);
    closeLink.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });

    modal.querySelectorAll('.tab-link').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const tabId = this.dataset.tab;
            modal.querySelectorAll('.tab-link').forEach(l => l.classList.remove('active'));
            modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });
}

function openDetailsModal(materialId) {
    const modal = document.getElementById('details-modal');
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

    // 🆕 載入採購單資料
    if (typeof loadPurchaseOrders === 'function') {
        loadPurchaseOrders(materialId);
    }

    // 根據當前儀表板類型傳遞參數
    const dashboardType = currentDashboardType;
    fetch(`/api/material/${materialId}/details?type=${dashboardType}`)
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => Promise.reject(err));
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }

            // 更新庫存總覽
            document.getElementById('unrestricted-stock').textContent = data.stock_summary.unrestricted.toFixed(0);
            document.getElementById('inspection-stock').textContent = data.stock_summary.inspection.toFixed(0);
            document.getElementById('on-order-stock').textContent = data.stock_summary.on_order.toFixed(0);

            // 顯示替代品資訊在庫存總覽下方
            let subHTML = '<h4 style="margin-top: 1em; margin-bottom: 0.5em; color: var(--pico-primary);">可替代版本</h4>';
            if (data.substitute_inventory && data.substitute_inventory.length > 0) {
                subHTML += '<table style="font-size: 0.9em;"><thead><tr><th>物料</th><th>說明</th><th>庫存</th><th>品檢中</th></tr></thead><tbody>';
                data.substitute_inventory.forEach(s => {
                    subHTML += `<tr><td>${s['物料']}</td><td>${s['物料說明']}</td><td>${s.unrestricted_stock.toFixed(0)}</td><td>${s.inspection_stock.toFixed(0)}</td></tr>`;
                });
                subHTML += '</tbody></table>';
            } else {
                subHTML += '<p style="font-size: 0.9em; color: var(--pico-muted-color);">沒有找到可用的替代版本。</p>';
            }

            const substituteSection = document.getElementById('substitute-section');
            if (substituteSection) {
                substituteSection.innerHTML = subHTML;
            }

            // 🆕 計算並顯示缺料警示
            const shortageAlertEl = document.getElementById('shortage-alert');
            const totalAvailable = data.stock_summary.unrestricted + data.stock_summary.inspection + data.stock_summary.on_order;
            const totalDemand = data.demand_details.reduce((sum, d) => sum + d['未結數量 (EINHEIT)'], 0);
            const shortage = Math.max(0, totalDemand - totalAvailable);

            if (shortageAlertEl && shortage > 0) {
                shortageAlertEl.style.display = 'block';

                const shortageQtyEl = document.getElementById('current-shortage-qty');
                if (shortageQtyEl) {
                    shortageQtyEl.textContent = shortage.toFixed(0);
                }

                // 🔧 找開始缺料的需求日（而不是最早需求日）
                let shortageStartDate = '-';
                let runningStock = totalAvailable;

                for (const demand of data.demand_details) {
                    runningStock -= demand['未結數量 (EINHEIT)'];
                    if (runningStock < 0 && shortageStartDate === '-') {
                        // 這是第一筆造成缺料的需求
                        shortageStartDate = demand['需求日期'];
                        break;
                    }
                }

                // 如果都會缺料，就用第一筆需求日
                if (shortageStartDate === '-' && data.demand_details.length > 0) {
                    shortageStartDate = data.demand_details[0]['需求日期'];
                }

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

            // 🆕 載入現有交期資料（只在元素存在時執行）
            if (typeof loadExistingDelivery === 'function') {
                loadExistingDelivery(materialId);
            }

            // 🆕 綁定交期表單事件（只在元素存在時執行）
            if (typeof setupDeliveryFormEvents === 'function') {
                setupDeliveryFormEvents(materialId, data);
            }

            // 顯示需求訂單
            let demandHTML = '<table><thead><tr><th>訂單號碼</th><th>未結數量</th><th>需求日期</th><th>預計剩餘庫存</th></tr></thead><tbody>';
            if (data.demand_details && data.demand_details.length > 0) {
                data.demand_details.forEach(d => {
                    const shortageClass = d.is_shortage_point ? ' class="shortage-warning"' : '';
                    demandHTML += `<tr>
                        <td>${d['訂單']}</td>
                        <td${shortageClass}>${d['未結數量 (EINHEIT)'].toFixed(0)}</td>
                        <td>${d['需求日期']}</td>
                        <td>${d.remaining_stock.toFixed(0)}</td>
                    </tr>`;
                });
            } else {
                demandHTML += '<tr><td colspan="4">沒有找到相關的需求訂單。</td></tr>';
            }
            demandHTML += '</tbody></table>';
            document.getElementById('tab-demand').innerHTML = demandHTML;
        })
        .catch(error => {
            console.error('Error fetching details:', error);
            const errorMsg = error.error || error.message || '未知錯誤';
            document.getElementById('unrestricted-stock').textContent = '-';
            document.getElementById('inspection-stock').textContent = '-';
            document.getElementById('on-order-stock').textContent = '-';

            const substituteSection = document.getElementById('substitute-section');
            if (substituteSection) {
                substituteSection.innerHTML = '<p style="color:red;">載入替代版本時發生錯誤。</p>';
            }

            document.getElementById('tab-demand').innerHTML = `<p style="color:red;">載入需求時發生錯誤: ${errorMsg}</p>`;
        });
}

function openBuyerReferenceModal(materialId) {
    const modal = document.getElementById('details-modal');
    document.getElementById('modal-title').textContent = `採購人員參考清單: ${materialId}`;

    document.getElementById('stock-summary-section').style.display = 'none';
    document.getElementById('tab-demand').innerHTML = '<p>載入中...</p>';
    document.getElementById('tab-substitute').innerHTML = '';

    modal.querySelectorAll('.tab-link').forEach(l => l.classList.add('hidden'));
    document.querySelector('.tab-link[data-tab="tab-demand"]').classList.remove('hidden');
    modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-demand').classList.add('active');

    modal.showModal();

    // 取得當前儀表板類型
    const dashboardType = currentDashboardType;

    fetch(`/api/material/${materialId}/buyer_reference?type=${dashboardType}`)
        .then(response => response.json())
        .then(data => {
            // 先取得所有採購人員清單
            fetch('/api/buyers_list')
                .then(response => response.json())
                .then(buyersData => {
                    let buyerHTML = '<h4>該物料上下25筆採購人員參考（點擊下拉選單可修改採購人員）</h4>';
                    buyerHTML += '<table><thead><tr><th>物料</th><th>物料說明</th><th>採購人員</th></tr></thead><tbody>';

                    if (data.reference_list && data.reference_list.length > 0) {
                        data.reference_list.forEach(item => {
                            const isCurrentMaterial = item['物料'] === materialId;
                            const rowStyle = isCurrentMaterial ? ' style="background-color: #fff3cd; font-weight: bold;"' : '';
                            const currentBuyer = item['採購人員'] || '';

                            // 建立採購人員下拉選單
                            let buyerSelect = `<select class="buyer-select" data-material-id="${item['物料']}" data-dashboard-type="${dashboardType}">`;
                            buyerSelect += `<option value="">未指定</option>`;
                            buyersData.buyers.forEach(buyer => {
                                const selected = buyer === currentBuyer ? 'selected' : '';
                                buyerSelect += `<option value="${buyer}" ${selected}>${buyer}</option>`;
                            });
                            buyerSelect += `</select>`;

                            buyerHTML += `<tr${rowStyle}>
                                <td>${item['物料']}</td>
                                <td>${item['物料說明']}</td>
                                <td>${buyerSelect}</td>
                            </tr>`;
                        });
                    } else {
                        buyerHTML += '<tr><td colspan="3">沒有找到相關的採購人員資料。</td></tr>';
                    }

                    buyerHTML += '</tbody></table>';
                    document.getElementById('tab-demand').innerHTML = buyerHTML;

                    // 綁定下拉選單變更事件
                    bindBuyerSelectEvents();
                })
                .catch(error => {
                    console.error('Error fetching buyers list:', error);
                    let buyerHTML = '<h4>該物料上下25筆採購人員參考</h4>';
                    buyerHTML += '<table><thead><tr><th>物料</th><th>物料說明</th><th>採購人員</th></tr></thead><tbody>';

                    if (data.reference_list && data.reference_list.length > 0) {
                        data.reference_list.forEach(item => {
                            const isCurrentMaterial = item['物料'] === materialId;
                            const rowStyle = isCurrentMaterial ? ' style="background-color: #fff3cd; font-weight: bold;"' : '';
                            buyerHTML += `<tr${rowStyle}>
                                <td>${item['物料']}</td>
                                <td>${item['物料說明']}</td>
                                <td>${item['採購人員'] || '-'}</td>
                            </tr>`;
                        });
                    }

                    buyerHTML += '</tbody></table>';
                    buyerHTML += '<p style="color: orange;">無法載入採購人員清單，顯示為唯讀模式。</p>';
                    document.getElementById('tab-demand').innerHTML = buyerHTML;
                });
        })
        .catch(error => {
            console.error('Error fetching buyer reference:', error);
            document.getElementById('tab-demand').innerHTML = '<p style="color:red;">載入採購人員參考時發生錯誤。</p>';
        });
}

function bindBuyerSelectEvents() {
    document.querySelectorAll('.buyer-select').forEach(select => {
        select.addEventListener('change', function () {
            const materialId = this.dataset.materialId;
            const newBuyer = this.value;
            const dashboardType = this.dataset.dashboardType;
            const originalValue = this.getAttribute('data-original-value') || '';

            // 暫時禁用選單
            this.disabled = true;
            this.style.opacity = '0.6';

            // 儲存採購人員變更
            fetch('/api/update_buyer', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    material_id: materialId,
                    buyer: newBuyer,
                    dashboard_type: dashboardType
                })
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        // 顯示成功訊息
                        this.style.backgroundColor = '#d4edda';
                        this.style.borderColor = '#c3e6cb';
                        setTimeout(() => {
                            this.style.backgroundColor = '';
                            this.style.borderColor = '';
                        }, 1500);

                        // 更新快取資料
                        if (dashboardType === 'finished') {
                            const material = currentFinishedMaterialsData.find(m => m['物料'] === materialId);
                            if (material) {
                                material['採購人員'] = newBuyer;
                            }
                        } else {
                            const material = currentMaterialsData.find(m => m['物料'] === materialId);
                            if (material) {
                                material['採購人員'] = newBuyer;
                            }
                        }

                        // 重新渲染表格以反映變更
                        renderMaterialsTable();
                    } else {
                        // 顯示錯誤訊息
                        alert('儲存失敗: ' + (data.error || '未知錯誤'));
                        this.value = originalValue;
                    }
                })
                .catch(error => {
                    console.error('Error updating buyer:', error);
                    alert('儲存採購人員時發生錯誤');
                    this.value = originalValue;
                })
                .finally(() => {
                    // 重新啟用選單
                    this.disabled = false;
                    this.style.opacity = '1';
                });
        });

        // 儲存原始值
        select.setAttribute('data-original-value', select.value);
    });
}

// 設定訂單頁籤切換
function setupOrderTabs() {
    const downloadSpecsBtn = document.getElementById('download-specs-btn');

    // 綁定下載按鈕
    if (downloadSpecsBtn) {
        downloadSpecsBtn.addEventListener('click', function () {
            if (currentOrderId) {
                window.location.href = `/api/download_specs/${currentOrderId}`;
            } else {
                alert('請先成功查詢一個訂單號碼，才能下載規格表。');
            }
        });
    }

    // 綁定頁籤切換事件
    document.querySelectorAll('.order-tab-link').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const tabId = this.dataset.tab;

            // 切換頁籤樣式
            document.querySelectorAll('.order-tab-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.order-tab-content').forEach(c => c.classList.remove('active'));

            this.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });
}

function bindOrderQueryButtons() {
    // 這個函數已不需要，功能已移到 setupOrderTabs
}

function setupOrderSearch() {
    const searchInput = document.getElementById('order-id-input');
    const searchBtn = document.getElementById('search-order-btn');
    const orderDetailsContainer = document.getElementById('order-details-container');

    searchInput.value = '10000'; // 將輸入框預設值設為 '10000'

    searchBtn.addEventListener('click', function () {
        const orderId = searchInput.value.trim();
        if (orderId.length < 9) {
            orderDetailsContainer.innerHTML = '<p style="color: red;">料號至少需要輸入9碼。</p>';
            return; // 阻止進一步的搜尋操作
        }
        if (orderId) {
            fetchOrderDetails(orderId);
        } else {
            orderDetailsContainer.innerHTML = '<p style="color: red;">請輸入有效的訂單號碼。</p>';
        }
    });

    searchInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            searchBtn.click();
        }
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
            currentFilterKeyword = filterInput.value.trim();
            currentPage = 1; // 重置到第一頁
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
            currentPage = 1; // 重置到第一頁
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
            currentPage = 1;
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

function fetchOrderDetails(orderId) {
    const orderDetailsContainer = document.getElementById('order-details-container');
    const orderTabsNav = document.getElementById('order-tabs-nav');
    const orderTabsContent = document.getElementById('order-tabs-content');
    const tabOrderSpecs = document.getElementById('tab-order-specs');
    const tabOrderMaterials = document.getElementById('tab-order-materials');
    const downloadSpecsBtn = document.getElementById('download-specs-btn');

    // 搜尋開始前，顯示載入訊息
    orderDetailsContainer.innerHTML = '<p>正在查詢訂單詳情...</p>';
    orderTabsNav.style.display = 'none';
    orderTabsContent.style.display = 'none';
    downloadSpecsBtn.disabled = true;
    currentOrderId = null;

    fetch(`/api/order/${orderId}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                orderDetailsContainer.innerHTML = `<p style="color: red;">${data.error}</p>`;
                return;
            }

            // 啟用按鈕並儲存當前訂單ID
            currentOrderId = orderId;
            downloadSpecsBtn.disabled = false;

            // 隱藏提示訊息，顯示頁籤
            orderDetailsContainer.style.display = 'none';
            orderTabsNav.style.display = 'block';
            orderTabsContent.style.display = 'block';

            // 渲染訂單摘要資訊
            let summaryHtmlContent = `<h3>訂單 ${orderId} 摘要資訊</h3>`;
            if (data.order_summary && Object.keys(data.order_summary).length > 0) {
                const summary = data.order_summary;
                summaryHtmlContent += `
                    <div class="order-summary-card">
                        <p><strong>下單客戶:</strong> ${summary['下單客戶名稱'] || 'N/A'}</p>
                        <p><strong>物料說明:</strong> ${summary['物料說明'] || 'N/A'}</p>
                        <p><strong>生產開始:</strong> ${summary['生產開始'] || 'N/A'}</p>
                        <p><strong>生產結束:</strong> ${summary['生產結束'] || 'N/A'}</p>
                        <p><strong>機械外包:</strong> ${summary['機械外包'] || 'N/A'}</p>
                        <p><strong>電控外包:</strong> ${summary['電控外包'] || 'N/A'}</p>
                        <p><strong>噴漆外包:</strong> ${summary['噴漆外包'] || 'N/A'}</p>
                        <p><strong>鏟花外包:</strong> ${summary['鏟花外包'] || 'N/A'}</p>
                        <p><strong>捆包外包:</strong> ${summary['捆包外包'] || 'N/A'}</p>
                    </div>
                `;
            } else {
                summaryHtmlContent += '<p>沒有找到該訂單的摘要資訊。</p>';
            }

            // 渲染訂單備註
            let noteHtmlContent = '';
            if (data.order_note) {
                noteHtmlContent = `
                    <div class="order-note-section">
                        <h3>訂單備註</h3>
                        <article class="order-note-card">
                            <p>${data.order_note.replace(/\n/g, '<br>')}</p>
                        </article>
                    </div>
                `;
            }

            // 渲染訂單規格資訊
            let versionText = '';
            if (data.spec_version && data.spec_version.trim() !== 'nan' && data.spec_version.trim() !== '') {
                versionText = ` <span style="font-weight: normal; font-size: 0.9em;">(版本: ${data.spec_version})</span>`;
            }
            let specsHtmlContent = `<h3>訂單 ${orderId} 的規格資訊${versionText}</h3>`;
            if (data.order_specs && data.order_specs.length > 0) {
                specsHtmlContent += `
                    <figure>
                        <table>
                            <thead>
                                <tr>
                                    <th>內部特性號碼</th>
                                    <th>特性說明</th>
                                    <th>特性值</th>
                                    <th>值說明</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                data.order_specs.forEach(spec => {
                    specsHtmlContent += `
                        <tr>
                            <td>${spec['內部特性號碼']}</td>
                            <td>${spec['特性說明']}</td>
                            <td>${spec['特性值']}</td>
                            <td>${spec['值說明']}</td>
                        </tr>
                    `;
                });
                specsHtmlContent += `
                            </tbody>
                        </table>
                    </figure>
                `;
            } else {
                specsHtmlContent += '<p>沒有找到該訂單的規格資訊。</p>';
            }

            // 將內容寫入規格頁籤
            tabOrderSpecs.innerHTML = noteHtmlContent + summaryHtmlContent + specsHtmlContent;

            // 渲染訂單物料需求
            if (data.order_materials && data.order_materials.length > 0) {
                orderMaterialsData = data.order_materials;
                renderOrderMaterialsTable();
            } else {
                tabOrderMaterials.innerHTML = `<h3>訂單 ${orderId} 的物料需求</h3><p>沒有找到該訂單的物料需求。</p>`;
            }

            // 重置到規格頁籤
            document.querySelectorAll('.order-tab-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.order-tab-content').forEach(c => c.classList.remove('active'));
            document.querySelector('.order-tab-link[data-tab="tab-order-specs"]').classList.add('active');
            tabOrderSpecs.classList.add('active');
        })
        .catch(error => {
            console.error('Error fetching order details:', error);
            orderDetailsContainer.innerHTML = '<p style="color: red;">載入訂單詳情時發生錯誤。</p>';
            orderDetailsContainer.style.display = 'block';
            orderTabsNav.style.display = 'none';
            orderTabsContent.style.display = 'none';
        });
}

function renderOrderMaterialsTable() {
    const materials = orderMaterialsData;
    const container = document.getElementById('tab-order-materials');
    let processedData = [...materials];

    // 應用排序
    if (orderMaterialsSortColumn) {
        processedData.sort((a, b) => {
            let valA = a[orderMaterialsSortColumn];
            let valB = b[orderMaterialsSortColumn];

            // 處理數字排序
            if (typeof valA === 'number' && typeof valB === 'number') {
                return orderMaterialsSortOrder === 'asc' ? valA - valB : valB - valA;
            }
            // 處理字串排序
            if (typeof valA === 'string' && typeof valB === 'string') {
                return orderMaterialsSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return 0;
        });
    }

    let tableHTML = `
        <h3>物料需求清單 (點擊物料可查看詳細資訊，點擊欄位名稱可排序)</h3>
        <figure>
            <table>
                <thead>
                    <tr>
                        <th data-sort-key="物料" class="sortable-order-materials">物料 <span class="sort-icon"></span></th>
                        <th data-sort-key="物料說明" class="sortable-order-materials">物料說明 <span class="sort-icon"></span></th>
                        <th data-sort-key="需求數量 (EINHEIT)" class="sortable-order-materials">需求數量 <span class="sort-icon"></span></th>
                        <th data-sort-key="領料數量 (EINHEIT)" class="sortable-order-materials">領料數量 <span class="sort-icon"></span></th>
                        <th data-sort-key="未結數量 (EINHEIT)" class="sortable-order-materials">未結數量 <span class="sort-icon"></span></th>
                        <th data-sort-key="unrestricted_stock" class="sortable-order-materials">庫存 <span class="sort-icon"></span></th>
                        <th data-sort-key="inspection_stock" class="sortable-order-materials">品檢中 <span class="sort-icon"></span></th>
                        <th data-sort-key="order_shortage" class="sortable-order-materials">訂單缺料 <span class="sort-icon"></span></th>
                        <th data-sort-key="需求日期" class="sortable-order-materials">需求日期 <span class="sort-icon"></span></th>
                    </tr>
                </thead>
                <tbody>
    `;

    if (processedData.length === 0) {
        tableHTML += '<tr><td colspan="9">沒有找到該訂單的物料需求。</td></tr>';
    } else {
        processedData.forEach(m => {
            const shortageClass = m.order_shortage > 0 ? ' class="shortage-warning"' : '';
            tableHTML += `
                <tr>
                    <td class="clickable-material" data-material-id="${m['物料']}">${m['物料']}</td>
                    <td>${m['物料說明']}</td>
                    <td>${m['需求數量 (EINHEIT)'].toFixed(0)}</td>
                    <td>${m['領料數量 (EINHEIT)'].toFixed(0)}</td>
                    <td${shortageClass}>${m['未結數量 (EINHEIT)'].toFixed(0)}</td>
                    <td>${m.unrestricted_stock.toFixed(0)}</td>
                    <td>${m.inspection_stock.toFixed(0)}</td>
                    <td${shortageClass}>${m.order_shortage.toFixed(0)}</td>
                    <td>${m['需求日期']}</td>
                </tr>
            `;
        });
    }

    tableHTML += `
                </tbody>
            </table>
        </figure>
    `;

    container.innerHTML = tableHTML;
    addOrderMaterialsSortEventListeners();
    updateOrderMaterialsSortIcons();
    addOrderMaterialsTableEventListeners();
}

function addOrderMaterialsTableEventListeners() {
    document.querySelectorAll('.clickable-material').forEach(cell => {
        cell.addEventListener('click', function () {
            const materialId = this.dataset.materialId;
            openDetailsModal(materialId);
        });
    });
}

function addOrderMaterialsSortEventListeners() {
    document.querySelectorAll('.sortable-order-materials').forEach(header => {
        header.addEventListener('click', function () {
            const sortKey = this.dataset.sortKey;
            if (orderMaterialsSortColumn === sortKey) {
                orderMaterialsSortOrder = orderMaterialsSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                orderMaterialsSortColumn = sortKey;
                orderMaterialsSortOrder = 'asc';
            }
            // 只重新渲染表格，不重新載入訂單
            renderOrderMaterialsTable();
        });
    });
}

function updateOrderMaterialsSortIcons() {
    document.querySelectorAll('.sortable-order-materials').forEach(header => {
        const sortIcon = header.querySelector('.sort-icon');
        sortIcon.textContent = ''; // 清除所有圖示
        if (header.dataset.sortKey === orderMaterialsSortColumn) {
            sortIcon.textContent = orderMaterialsSortOrder === 'asc' ? ' ▲' : ' ▼';
        }
    });
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

    // 應用採購人員篩選
    if (currentBuyerKeyword) {
        const buyerKeyword = currentBuyerKeyword.toLowerCase();
        processedData = processedData.filter(m =>
            m['採購人員'] && m['採購人員'].toLowerCase().includes(buyerKeyword)
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

// 🆕 載入採購單資料
function loadPurchaseOrders(materialId) {
    const poSection = document.getElementById('purchase-orders-section');
    const poTbody = document.getElementById('purchase-orders-tbody');
    const poSelect = document.getElementById('po-select');

    if (!poSection || !poTbody) return;

    // 顯示載入中
    poSection.style.display = 'block';
    poTbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">載入中...</td></tr>';

    fetch(`/api/purchase_orders/${materialId}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                poTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: red;">${data.error}</td></tr>`;
                return;
            }

            if (data.length === 0) {
                poTbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">沒有相關的採購單。</td></tr>';
                // 清空並重置選擇器
                if (poSelect) {
                    poSelect.innerHTML = '<option value="">-- 新建交期記錄 (不關聯採購單) --</option>';
                }
                return;
            }

            // 渲染表格
            renderPurchaseOrdersTable(data);

            // 填充選擇器
            populatePOSelect(data);
        })
        .catch(error => {
            console.error('Error loading purchase orders:', error);
            poTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">載入失敗</td></tr>';
        });
}

// 🆕 渲染採購單表格
function renderPurchaseOrdersTable(purchaseOrders) {
    const poTbody = document.getElementById('purchase-orders-tbody');
    if (!poTbody) return;

    let html = '';
    purchaseOrders.forEach(po => {
        const deliveryDate = po.updated_delivery_date || po.original_delivery_date || '-';
        const statusMap = {
            'open': '<span style="color: green;">未結案</span>',
            'closed': '<span style="color: gray;">已結案</span>',
            'updated': '<span style="color: blue;">已更新</span>'
        };
        const status = statusMap[po.status] || po.status;

        html += `
            <tr>
                <td>${po.po_number}</td>
                <td>${po.supplier || '-'}</td>
                <td>
                    訂購: ${po.ordered_quantity}<br>
                    <small style="color: #666;">未交: ${po.outstanding_quantity}</small>
                </td>
                <td>${deliveryDate}</td>
                <td>${status}</td>
                <td>
                    <button class="small secondary" onclick="fillDeliveryFormFromPO('${po.po_number}')">
                        帶入
                    </button>
                </td>
            </tr>
        `;
    });

    poTbody.innerHTML = html;

    // 將採購單資料儲存到全域變數，供選擇器使用
    window.currentPurchaseOrders = purchaseOrders;
}

// 🆕 填充採購單選擇器
function populatePOSelect(purchaseOrders) {
    const poSelect = document.getElementById('po-select');
    if (!poSelect) return;

    let html = '<option value="">-- 新建交期記錄 (不關聯採購單) --</option>';

    // 只顯示未結案或有未交數量的採購單
    const activePOs = purchaseOrders.filter(po => po.outstanding_quantity > 0 || po.status !== 'closed');

    activePOs.forEach(po => {
        const deliveryDate = po.updated_delivery_date || po.original_delivery_date || '未定';
        html += `<option value="${po.po_number}">
            ${po.po_number} - ${po.supplier || '未知供應商'} (未交: ${po.outstanding_quantity}, 交期: ${deliveryDate})
        </option>`;
    });

    poSelect.innerHTML = html;
}

// 🆕 從採購單帶入資料到表單 (供表格按鈕使用)
window.fillDeliveryFormFromPO = function (poNumber) {
    const poSelect = document.getElementById('po-select');
    if (poSelect) {
        poSelect.value = poNumber;
        // 觸發 change 事件
        const event = new Event('change');
        poSelect.dispatchEvent(event);
    }
};
