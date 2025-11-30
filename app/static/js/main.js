document.addEventListener('DOMContentLoaded', function() {
    checkApiStatus();

    if (window.location.pathname === '/procurement') {
        loadProcurementDashboard();
        setupModal();
        setupProcurementFilter();
        setupDashboardTabs(); // 設定儀表板頁籤切換
    } else if (window.location.pathname === '/order_query') {
        setupOrderSearch();
        setupModal();
        setupOrderTabs();
    }
});

function checkApiStatus() {
    fetch('/api/status')
        .then(response => response.json())
        .then(data => {
            const statusElement = document.getElementById('status-text');
            if (data.service_status === 'online') {
                statusElement.textContent = `✅ 後端服務正常。資料已${data.data_loaded ? '成功' : '失敗'}載入。目前使用快取: ${data.live_cache}`;
                statusElement.style.color = 'green';
            } else {
                statusElement.textContent = '❌ 無法連接到後端服務。';
                statusElement.style.color = 'red';
            }
        })
        .catch(error => {
            console.error('Error fetching status:', error);
            document.getElementById('status-text').textContent = '❌ 連接後端服務時發生錯誤。';
        });
}

// 全局變數來儲存原始資料、排序狀態和篩選關鍵字
let currentMaterialsData = [];
let currentFinishedMaterialsData = []; // 成品儀表板資料
let currentSortColumn = null;
let currentSortOrder = 'asc'; // 'asc' 或 'desc'
let currentFilterKeyword = ''; // 物料篩選關鍵字
let currentBuyerKeyword = ''; // 採購人員篩選關鍵字

// 分頁相關變數
let currentPage = 1;
let itemsPerPage = 50; // 預設每頁顯示50筆

// 當前顯示的儀表板類型
let currentDashboardType = 'main'; // 'main' 或 'finished'

// 全局變數來儲存訂單物料的排序狀態
let orderMaterialsData = []; // 儲存原始訂單物料資料
let orderMaterialsSortColumn = null;
let orderMaterialsSortOrder = 'asc'; // 'asc' 或 'desc'

// 新增：全局變數來儲存當前查詢的訂單號碼
let currentOrderId = null;

function loadProcurementDashboard() {
    // 載入主儀表板資料
    fetch('/api/materials')
        .then(response => response.json())
        .then(data => {
            if (!data || data.length === 0) {
                document.getElementById('tab-main-dashboard').innerHTML = '<p>沒有可顯示的物料資料。</p>';
            } else {
                currentMaterialsData = data;
                populateBuyerFilter(data); // 填充採購人員下拉選單
                if (currentDashboardType === 'main') {
                    renderMaterialsTable();
                }
            }
        })
        .catch(error => {
            console.error('Error fetching materials data:', error);
            document.getElementById('tab-main-dashboard').innerHTML = '<p style="color: red;">載入儀表板資料時發生錯誤。</p>';
        });
    
    // 載入成品儀表板資料
    fetch('/api/finished_materials')
        .then(response => response.json())
        .then(data => {
            if (!data || data.length === 0) {
                document.getElementById('tab-finished-dashboard').innerHTML = '<p>沒有可顯示的成品物料資料。</p>';
            } else {
                currentFinishedMaterialsData = data;
                if (currentDashboardType === 'finished') {
                    renderMaterialsTable();
                }
            }
        })
        .catch(error => {
            console.error('Error fetching finished materials data:', error);
            document.getElementById('tab-finished-dashboard').innerHTML = '<p style="color: red;">載入成品儀表板資料時發生錯誤。</p>';
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


    // 應用排序
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
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    
    // 確保當前頁在有效範圍內
    if (currentPage > totalPages && totalPages > 0) {
        currentPage = totalPages;
    }
    if (currentPage < 1) {
        currentPage = 1;
    }
    
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const paginatedData = processedData.slice(startIndex, endIndex);

    // 顯示項目數量和分頁控制
    let controlsHTML = `
        <div class="table-controls">
            <div class="items-info">
                顯示第 ${totalItems > 0 ? startIndex + 1 : 0} - ${endIndex} 項，共 ${totalItems} 項
            </div>
            <div class="pagination-controls">
                <label>每頁顯示：
                    <select id="items-per-page-select">
                        <option value="20" ${itemsPerPage === 20 ? 'selected' : ''}>20</option>
                        <option value="50" ${itemsPerPage === 50 ? 'selected' : ''}>50</option>
                        <option value="100" ${itemsPerPage === 100 ? 'selected' : ''}>100</option>
                        <option value="200" ${itemsPerPage === 200 ? 'selected' : ''}>200</option>
                        <option value="${totalItems}" ${itemsPerPage >= totalItems ? 'selected' : ''}>全部</option>
                    </select>
                </label>
            </div>
        </div>
    `;

    let tableHTML = `<figure><table><thead><tr>
        <th data-sort-key="物料" class="sortable">物料 <span class="sort-icon"></span></th>
        <th data-sort-key="物料說明" class="sortable">物料說明 <span class="sort-icon"></span></th>
        <th data-sort-key="採購人員" class="sortable">採購人員 <span class="sort-icon"></span></th>
        <th data-sort-key="total_demand" class="sortable">總需求 <span class="sort-icon"></span></th>
        <th data-sort-key="unrestricted_stock" class="sortable">庫存 <span class="sort-icon"></span></th>
        <th data-sort-key="inspection_stock" class="sortable">品檢中 <span class="sort-icon"></span></th>
        <th data-sort-key="on_order_stock" class="sortable">已訂未入 <span class="sort-icon"></span></th>
        <th data-sort-key="current_shortage" class="sortable shortage">目前缺料 <span class="sort-icon"></span></th>
        <th data-sort-key="projected_shortage" class="sortable shortage">預計缺料 <span class="sort-icon"></span></th>
        </tr></thead><tbody>`;

    if (paginatedData.length === 0) {
        tableHTML += '<tr><td colspan="9" style="text-align: center;">🎉 太棒了！目前沒有任何符合條件的缺料項目。</td></tr>';
    } else {
        paginatedData.forEach(m => {
            const buyer = m['採購人員'] || '-';
            tableHTML += `
                <tr>
                    <td><span class="material-link" data-material-id="${m['物料']}">${m['物料']}</span></td>
                    <td>${m['物料說明']}</td>
                    <td class="buyer-cell" data-material-id="${m['物料']}">${buyer}</td>
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
        paginationHTML += `<button ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">上一頁</button>`;
        
        // 頁碼按鈕
        const maxVisiblePages = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
        
        if (endPage - startPage < maxVisiblePages - 1) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }
        
        if (startPage > 1) {
            paginationHTML += `<button onclick="changePage(1)">1</button>`;
            if (startPage > 2) paginationHTML += `<span>...</span>`;
        }
        
        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `<button class="${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
        }
        
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) paginationHTML += `<span>...</span>`;
            paginationHTML += `<button onclick="changePage(${totalPages})">${totalPages}</button>`;
        }
        
        // 下一頁按鈕
        paginationHTML += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">下一頁</button>`;
        
        paginationHTML += '</div></div>';
    }

    container.innerHTML = controlsHTML + tableHTML + paginationHTML;
    
    // 綁定每頁顯示數量選擇器
    const itemsPerPageSelect = document.getElementById('items-per-page-select');
    if (itemsPerPageSelect) {
        itemsPerPageSelect.addEventListener('change', function() {
            itemsPerPage = parseInt(this.value);
            currentPage = 1; // 重置到第一頁
            renderMaterialsTable();
        });
    }
    
    addSortEventListeners(); // 添加排序事件監聽
    addMaterialLinkListeners(); // 添加物料連結事件監聽
    addBuyerCellListeners(); // 添加採購人員點擊事件監聽
    updateSortIcons(); // 更新排序圖示
}

// 切換頁面函數
function changePage(page) {
    currentPage = page;
    renderMaterialsTable();
    // 滾動到頂部
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function addSortEventListeners() {
    document.querySelectorAll('.sortable').forEach(header => {
        header.addEventListener('click', function() {
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
        link.addEventListener('click', function(e) {
            e.stopPropagation();
            const materialId = this.dataset.materialId;
            openDetailsModal(materialId);
        });
    });
}

function addBuyerCellListeners() {
    document.querySelectorAll('.buyer-cell').forEach(cell => {
        cell.addEventListener('click', function(e) {
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
        link.addEventListener('click', function(e) {
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
    document.getElementById('tab-demand').innerHTML = '<p>載入中...</p>';
    document.getElementById('tab-substitute').innerHTML = '<p>載入中...</p>';

    modal.querySelectorAll('.tab-link').forEach(l => {
        l.classList.remove('active');
        l.classList.remove('hidden');
    });
    modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.tab-link[data-tab="tab-demand"]').classList.add('active');
    document.getElementById('tab-demand').classList.add('active');

    modal.showModal();

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
            
            document.getElementById('unrestricted-stock').textContent = data.stock_summary.unrestricted.toFixed(0);
            document.getElementById('inspection-stock').textContent = data.stock_summary.inspection.toFixed(0);
            document.getElementById('on-order-stock').textContent = data.stock_summary.on_order.toFixed(0);

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

            let subHTML = '<table><thead><tr><th>物料</th><th>說明</th><th>庫存</th><th>品檢中</th></tr></thead><tbody>';
            if (data.substitute_inventory && data.substitute_inventory.length > 0) {
                data.substitute_inventory.forEach(s => {
                    subHTML += `<tr><td>${s['物料']}</td><td>${s['物料說明']}</td><td>${s.unrestricted_stock.toFixed(0)}</td><td>${s.inspection_stock.toFixed(0)}</td></tr>`;
                });
            } else {
                subHTML += '<tr><td colspan="4">沒有找到可用的替代版本。</td></tr>';
            }
            subHTML += '</tbody></table>';
            document.getElementById('tab-substitute').innerHTML = subHTML;
        })
        .catch(error => {
            console.error('Error fetching details:', error);
            const errorMsg = error.error || error.message || '未知錯誤';
            document.getElementById('unrestricted-stock').textContent = '-';
            document.getElementById('inspection-stock').textContent = '-';
            document.getElementById('on-order-stock').textContent = '-';
            document.getElementById('tab-demand').innerHTML = `<p style="color:red;">載入需求時發生錯誤: ${errorMsg}</p>`;
            document.getElementById('tab-substitute').innerHTML = '<p style="color:red;">載入替代版本時發生錯誤。</p>';
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
        select.addEventListener('change', function() {
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
        downloadSpecsBtn.addEventListener('click', function() {
            if (currentOrderId) {
                window.location.href = `/api/download_specs/${currentOrderId}`;
            } else {
                alert('請先成功查詢一個訂單號碼，才能下載規格表。');
            }
        });
    }
    
    // 綁定頁籤切換事件
    document.querySelectorAll('.order-tab-link').forEach(link => {
        link.addEventListener('click', function(e) {
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
    searchBtn.addEventListener('click', function() {
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

    searchInput.addEventListener('keypress', function(e) {
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
        const applyMaterialFilter = function() {
            currentFilterKeyword = filterInput.value.trim();
            currentPage = 1; // 重置到第一頁
            renderMaterialsTable();
        };
        
        applyFilterBtn.addEventListener('click', applyMaterialFilter);

        // 允許按 Enter 鍵觸發物料查詢
        filterInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                applyMaterialFilter();
            }
        });
    }
    
    // 採購人員下拉選單直接觸發篩選
    if (buyerFilterSelect) {
        buyerFilterSelect.addEventListener('change', function() {
            currentBuyerKeyword = this.value;
            currentPage = 1; // 重置到第一頁
            renderMaterialsTable();
        });
    }
    
    // 清除搜尋
    if (clearFilterBtn) {
        clearFilterBtn.addEventListener('click', function() {
            if (filterInput) filterInput.value = '';
            if (buyerFilterSelect) buyerFilterSelect.value = '';
            currentFilterKeyword = '';
            currentBuyerKeyword = '';
            currentPage = 1;
            renderMaterialsTable();
        });
    }
}

// 設定儀表板頁籤切換
function setupDashboardTabs() {
    document.querySelectorAll('.dashboard-tab-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const tabId = this.dataset.tab;
            
            // 更新當前儀表板類型
            currentDashboardType = tabId === 'tab-main-dashboard' ? 'main' : 'finished';
            
            // 重置分頁
            currentPage = 1;
            
            // 切換頁籤樣式
            document.querySelectorAll('.dashboard-tab-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.dashboard-tab-content').forEach(c => c.classList.remove('active'));
            
            this.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            
            // 重新渲染表格
            renderMaterialsTable();
        });
    });
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
        cell.addEventListener('click', function() {
            const materialId = this.dataset.materialId;
            openDetailsModal(materialId);
        });
    });
}

function addOrderMaterialsSortEventListeners() {
    document.querySelectorAll('.sortable-order-materials').forEach(header => {
        header.addEventListener('click', function() {
            const sortKey = this.dataset.sortKey;
            if (orderMaterialsSortColumn === sortKey) {
                orderMaterialsSortOrder = orderMaterialsSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                orderMaterialsSortColumn = sortKey;
                orderMaterialsSortOrder = 'asc';
            }
            const orderId = document.getElementById('order-id-input').value.trim();
            if (orderId) {
                fetchOrderDetails(orderId); // 重新載入並渲染以應用排序
            }
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
