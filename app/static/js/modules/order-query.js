/**
 * 訂單查詢頁面模組
 * 負責處理 /order_query 頁面的所有功能，包括搜尋、資料獲取、渲染和互動。
 */

// 全局變數來儲存訂單物料的排序狀態
let orderMaterialsData = []; // 儲存原始訂單物料資料
let orderMaterialsSortColumn = null;
let orderMaterialsSortOrder = 'asc'; // 'asc' 或 'desc'

// 新增：全局變數來儲存當前查詢的訂單號碼
let currentOrderId = null;

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

document.addEventListener('DOMContentLoaded', function () {
    if (window.location.pathname === '/order_query') {
        setupOrderSearch();
        setupOrderTabs();
    }
});