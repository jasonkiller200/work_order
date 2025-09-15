document.addEventListener('DOMContentLoaded', function() {
    checkApiStatus();

    if (window.location.pathname === '/procurement') {
        loadProcurementDashboard();
        setupModal();
        setupProcurementFilter(); // 新增篩選功能設定
    } else if (window.location.pathname === '/order_query') {
        setupOrderSearch();
        setupModal(); // 在訂單查詢頁面也設定 Modal
        bindOrderQueryButtons(); // 新增：綁定訂單查詢頁面的按鈕事件
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
let currentSortColumn = null;
let currentSortOrder = 'asc'; // 'asc' 或 'desc'
let currentFilterKeyword = ''; // 新增篩選關鍵字

// 全局變數來儲存訂單物料的排序狀態
let orderMaterialsData = []; // 儲存原始訂單物料資料
let orderMaterialsSortColumn = null;
let orderMaterialsSortOrder = 'asc'; // 'asc' 或 'desc'

// 新增：全局變數來儲存當前查詢的訂單號碼
let currentOrderId = null;

function loadProcurementDashboard() {
    const container = document.getElementById('dashboard-container');
    fetch('/api/materials')
        .then(response => response.json())
        .then(data => {
            if (!data || data.length === 0) {
                container.innerHTML = '<p>沒有可顯示的物料資料。</p>';
                return;
            }
            currentMaterialsData = data; // 儲存原始資料
            renderMaterialsTable(); // 首次渲染
        })
        .catch(error => {
            console.error('Error fetching materials data:', error);
            container.innerHTML = '<p style="color: red;">載入儀表板資料時發生錯誤。</p>';
        });
}

function renderMaterialsTable() {
    const container = document.getElementById('dashboard-container');
    let processedData = [...currentMaterialsData]; // 複製一份資料進行操作

    // 應用篩選
    if (currentFilterKeyword) {
        const keyword = currentFilterKeyword.toLowerCase();
        processedData = processedData.filter(m => 
            (m['物料'] && m['物料'].toLowerCase().includes(keyword)) ||
            (m['物料說明'] && m['物料說明'].toLowerCase().includes(keyword))
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

    let tableHTML = `<figure><table><thead><tr>
        <th data-sort-key="物料" class="sortable">物料 <span class="sort-icon"></span></th>
        <th data-sort-key="物料說明" class="sortable">物料說明 <span class="sort-icon"></span></th>
        <th data-sort-key="total_demand" class="sortable">總需求 <span class="sort-icon"></span></th>
        <th data-sort-key="unrestricted_stock" class="sortable">庫存 <span class="sort-icon"></span></th>
        <th data-sort-key="inspection_stock" class="sortable">品檢中 <span class="sort-icon"></span></th>
        <th data-sort-key="on_order_stock" class="sortable">已訂未入 <span class="sort-icon"></span></th>
        <th data-sort-key="current_shortage" class="sortable shortage">目前缺料 <span class="sort-icon"></span></th>
        <th data-sort-key="projected_shortage" class="sortable shortage">預計缺料 <span class="sort-icon"></span></th>
        </tr></thead><tbody>`;

    if (processedData.length === 0) {
        tableHTML += '<tr><td colspan="8" style="text-align: center;">🎉 太棒了！目前沒有任何符合條件的缺料項目。</td></tr>';
    } else {
        processedData.forEach(m => {
            tableHTML += `
                <tr class="clickable-row" data-material-id="${m['物料']}">
                    <td>${m['物料']}</td>
                    <td>${m['物料說明']}</td>
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
    container.innerHTML = tableHTML;
    addSortEventListeners(); // 添加排序事件監聽
    addTableEventListeners(); // 添加行點擊事件監聽
    updateSortIcons(); // 更新排序圖示
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

function addTableEventListeners() {
    document.querySelectorAll('.clickable-row').forEach(row => {
        row.addEventListener('click', function() {
            const materialId = this.dataset.materialId;
            openDetailsModal(materialId);
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
    
    document.getElementById('unrestricted-stock').textContent = '載入中...';
    document.getElementById('inspection-stock').textContent = '載入中...';
    document.getElementById('on-order-stock').textContent = '載入中...';
    document.getElementById('tab-demand').innerHTML = '<p>載入中...</p>';
    document.getElementById('tab-substitute').innerHTML = '<p>載入中...</p>';

    modal.querySelectorAll('.tab-link').forEach(l => l.classList.remove('active'));
    modal.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.tab-link[data-tab="tab-demand"]').classList.add('active');
    document.getElementById('tab-demand').classList.add('active');

    modal.showModal();

    fetch(`/api/material/${materialId}/details`)
        .then(response => response.json())
        .then(data => {
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
            document.getElementById('tab-demand').innerHTML = '<p style="color:red;">載入需求時發生錯誤。</p>';
            document.getElementById('tab-substitute').innerHTML = '<p style="color:red;">載入替代版本時發生錯誤。</p>';
        });
}

function bindOrderQueryButtons() {
    const searchInput = document.getElementById('order-id-input');
    const downloadSpecsBtn = document.getElementById('download-specs-btn');
    const scrollToMaterialsBtn = document.getElementById('scroll-to-materials-btn');
    const scrollToSpecsBtn = document.getElementById('scroll-to-specs-btn');
    const orderSpecsSection = document.getElementById('order-specs-section');
    const orderMaterialsSection = document.getElementById('order-materials-section');

    if (downloadSpecsBtn) {
        downloadSpecsBtn.onclick = null; // 移除舊的事件監聽器
        downloadSpecsBtn.addEventListener('click', function() {
            if (currentOrderId) {
                window.location.href = `/api/download_specs/${currentOrderId}`;
            } else {
                alert('請先成功查詢一個訂單號碼，才能下載規格表。');
            }
        });
    }

    if (scrollToMaterialsBtn && orderMaterialsSection) {
        scrollToMaterialsBtn.onclick = null; // 移除舊的事件監聽器
        scrollToMaterialsBtn.addEventListener('click', function() {
            orderMaterialsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    const orderSearchSection = document.getElementById('order-search');

    if (scrollToSpecsBtn && orderSearchSection) { // 確保目標區塊存在
        scrollToSpecsBtn.addEventListener('click', function() {
            orderSearchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }
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
    const applyFilterBtn = document.getElementById('apply-filter-btn');
    const dashboardContainer = document.getElementById('dashboard-container');

    if (applyFilterBtn && filterInput) {
        applyFilterBtn.addEventListener('click', function() {
            const materialIdToSearch = filterInput.value.trim().toLowerCase();
            const tableRows = dashboardContainer.querySelectorAll('table tbody tr');
            let found = false;

            // 移除所有之前的高亮
            tableRows.forEach(row => {
                row.classList.remove('highlighted-row');
            });

            if (materialIdToSearch) {
                for (let i = 0; i < tableRows.length; i++) {
                    const row = tableRows[i];
                    const materialId = row.dataset.materialId;
                    if (materialId && materialId.toLowerCase().includes(materialIdToSearch)) {
                        row.classList.add('highlighted-row');
                        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        found = true;
                        break; // 找到第一個就停止
                    }
                }

                if (!found) {
                    alert('沒有找到匹配的料號。'); // 簡單的提示
                }
            } else {
                // 如果輸入框為空，重新渲染表格以清除篩選（如果之前有篩選）
                // 或者只是清除高亮
                // renderMaterialsTable(); // 如果需要重新載入所有資料
                // 這裡只清除高亮，因為是查詢功能
            }
        });

        // 允許按 Enter 鍵觸發查詢
        filterInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                applyFilterBtn.click();
            }
        });
    }
}

function fetchOrderDetails(orderId) {
    const orderSpecsContainer = document.getElementById('order-specs-container');
    const orderMaterialsContainer = document.getElementById('order-materials-container');
    const downloadSpecsBtn = document.getElementById('download-specs-btn');
    const scrollToMaterialsBtn = document.getElementById('scroll-to-materials-btn');
    const scrollToSpecsBtn = document.getElementById('scroll-to-specs-btn');

    // 搜尋開始前，顯示載入訊息並禁用按鈕
    orderSpecsContainer.innerHTML = '<p>正在查詢訂單詳情...</p>';
    orderMaterialsContainer.innerHTML = ''; // 清空舊的物料資料
    downloadSpecsBtn.disabled = true;
    scrollToMaterialsBtn.disabled = true;
    scrollToSpecsBtn.disabled = true;
    currentOrderId = null; // 重置當前訂單ID

    fetch(`/api/order/${orderId}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                orderSpecsContainer.innerHTML = `<p style="color: red;">${data.error}</p>`;
                orderMaterialsContainer.innerHTML = ''; // 清空物料區
                return;
            }

            // 啟用按鈕並儲存當前訂單ID
            currentOrderId = orderId;
            downloadSpecsBtn.disabled = false;
            scrollToMaterialsBtn.disabled = false;
            scrollToSpecsBtn.disabled = false;

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

            // 新增：渲染訂單備註
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
            // 將備註、摘要和規格資訊合併，一次性寫入容器
            orderSpecsContainer.innerHTML = noteHtmlContent + summaryHtmlContent + specsHtmlContent;

            // 渲染訂單物料需求
            if (data.order_materials && data.order_materials.length > 0) {
                orderMaterialsData = data.order_materials; // 儲存原始資料
                renderOrderMaterialsTable(); // 渲染表格到獨立區塊
            } else {
                orderMaterialsContainer.innerHTML = `<h3>訂單 ${orderId} 的物料需求</h3><p>沒有找到該訂單的物料需求。</p>`;
            }
            // 事件綁定現在是靜態的，但如果未來有動態增加的按鈕，可以保留
            // bindOrderQueryButtons(); 
        })
        .catch(error => {
            console.error('Error fetching order details:', error);
            orderSpecsContainer.innerHTML = '<p style="color: red;">載入訂單詳情時發生錯誤。</p>';
            orderMaterialsContainer.innerHTML = '';
        });
}

function renderOrderMaterialsTable() {
    const materials = orderMaterialsData; // 使用全局變數
    const container = document.getElementById('order-materials-container');
    let processedData = [...materials]; // 複製一份資料進行操作

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
        <h3>訂單的物料需求(點擊料號可以看詳細資訊，點擊欄位名稱可以排序)</h3>
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
    container.innerHTML = tableHTML; // 直接更新容器內容
    addOrderMaterialsSortEventListeners(); // 添加排序事件監聽
    updateOrderMaterialsSortIcons(); // 更新排序圖示
    addOrderMaterialsTableEventListeners(); // 添加物料點擊事件監聽
}

function addOrderMaterialsTableEventListeners() {
    document.querySelectorAll('#order-materials-section .clickable-material').forEach(cell => {
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
