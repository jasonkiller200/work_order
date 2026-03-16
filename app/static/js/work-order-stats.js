/**
 * 工單詳情統計頁面 JavaScript
 * 支援半品工單和成品工單兩個頁籤
 */

// 狀態管理
const state = {
    search: '',
    sortBy: '需求日期',
    sortOrder: 'asc',
    totalCount: 0,
    orderType: 'semi'  // 'semi' = 半品工單, 'finished' = 成品工單
};

// 成品工單狀態（獨立維護）
const finishedState = {
    search: '',
    sortBy: '生產開始',
    sortOrder: 'asc',
    totalCount: 0,
    factoryFilter: ''  // 🆕 廠別篩選
};

// 🆕 勾選狀態管理
const selectedOrders = {
    semi: new Set(),      // 半品工單已選工單號碼
    finished: new Set()   // 成品工單已選工單號碼
};

// 🆕 匯出模式 (summary/shortage/both)
let currentExportMode = 'summary';
let showCheckboxes = false;

// DOM 元素 - 半品工單
let searchInput, searchBtn, clearBtn, exportBtn;
let statsTable, statsTbody, totalCountEl;

// DOM 元素 - 成品工單
let finishedSearchInput, finishedSearchBtn, finishedClearBtn, finishedExportBtn;
let finishedStatsTable, finishedStatsTbody, finishedTotalCountEl;

// Modal 元素
let shortageModal, materialModal;

// 初始化
document.addEventListener('DOMContentLoaded', function () {
    initElements();
    initTabEvents();
    initEventListeners();
    loadData();  // 載入半品工單資料（預設頁籤）
});

function initElements() {
    // 半品工單元素
    searchInput = document.getElementById('search-input');
    searchBtn = document.getElementById('search-btn');
    clearBtn = document.getElementById('clear-btn');
    exportBtn = document.getElementById('export-btn');
    statsTable = document.getElementById('stats-table');
    statsTbody = document.getElementById('stats-tbody');
    totalCountEl = document.getElementById('total-count');

    // 成品工單元素
    finishedSearchInput = document.getElementById('finished-search-input');
    finishedSearchBtn = document.getElementById('finished-search-btn');
    finishedClearBtn = document.getElementById('finished-clear-btn');
    finishedExportBtn = document.getElementById('finished-export-btn');
    finishedStatsTable = document.getElementById('finished-stats-table');
    finishedStatsTbody = document.getElementById('finished-stats-tbody');
    finishedTotalCountEl = document.getElementById('finished-total-count');

    // Modal
    shortageModal = document.getElementById('shortage-modal');
    materialModal = document.getElementById('material-modal');
}

// 🆕 頁籤切換事件
function initTabEvents() {
    document.querySelectorAll('.wo-tab-link').forEach(tabLink => {
        tabLink.addEventListener('click', function (e) {
            e.preventDefault();
            const targetTab = this.dataset.tab;

            // 切換頁籤樣式
            document.querySelectorAll('.wo-tab-link').forEach(link => link.classList.remove('active'));
            this.classList.add('active');

            // 切換內容顯示
            document.querySelectorAll('.wo-tab-content').forEach(content => content.classList.remove('active'));
            document.getElementById(targetTab).classList.add('active');

            // 更新狀態並載入資料
            if (targetTab === 'finished-orders') {
                state.orderType = 'finished';
                loadFinishedData();
            } else {
                state.orderType = 'semi';
                loadData();
            }
        });
    });
}

function initEventListeners() {
    // 搜尋
    searchBtn.addEventListener('click', () => {
        state.search = searchInput.value.trim();
        state.currentPage = 1;
        loadData();
    });

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            state.search = searchInput.value.trim();
            state.currentPage = 1;
            loadData();
        }
    });

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        state.search = '';
        state.currentPage = 1;
        loadData();
    });


    // 🆕 匯出下拉選單 - 半品工單
    exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = document.getElementById('export-menu');
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });

    // 匯出選項點擊事件 - 半品工單
    document.querySelectorAll('#export-menu .export-option').forEach(option => {
        option.addEventListener('click', () => {
            const type = option.dataset.type;
            handleExport(type, 'semi');
            document.getElementById('export-menu').style.display = 'none';
        });
    });

    // 點擊其他地方關閉選單
    document.addEventListener('click', () => {
        document.querySelectorAll('.export-menu').forEach(menu => {
            menu.style.display = 'none';
        });
    });

    // 🆕 全選 checkbox - 半品工單
    document.getElementById('select-all-semi')?.addEventListener('change', (e) => {
        toggleSelectAll('semi', e.target.checked);
    });

    // 排序
    document.querySelectorAll('.sortable').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const sortKey = th.dataset.sort;
            if (state.sortBy === sortKey) {
                state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortBy = sortKey;
                state.sortOrder = 'asc';
            }
            updateSortIcons();
            loadData();
        });
    });

    // Modal 關閉
    document.getElementById('close-shortage-modal')?.addEventListener('click', closeShortageModal);
    document.getElementById('close-shortage-btn')?.addEventListener('click', closeShortageModal);
    document.getElementById('close-material-modal')?.addEventListener('click', closeMaterialModal);
    document.getElementById('close-material-btn')?.addEventListener('click', closeMaterialModal);

    // 🆕 成品工單事件監聽
    if (finishedSearchBtn) {
        finishedSearchBtn.addEventListener('click', () => {
            finishedState.search = finishedSearchInput.value.trim();
            loadFinishedData();
        });
    }

    if (finishedSearchInput) {
        finishedSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                finishedState.search = finishedSearchInput.value.trim();
                loadFinishedData();
            }
        });
    }

    // 🆕 廠別篩選事件
    const factoryFilter = document.getElementById('factory-filter');
    if (factoryFilter) {
        factoryFilter.addEventListener('change', () => {
            finishedState.factoryFilter = factoryFilter.value;
            loadFinishedData();
        });
    }

    if (finishedClearBtn) {
        finishedClearBtn.addEventListener('click', () => {
            finishedSearchInput.value = '';
            finishedState.search = '';
            // 🆕 重置廠別篩選
            const factoryFilter = document.getElementById('factory-filter');
            if (factoryFilter) {
                factoryFilter.value = '';
                finishedState.factoryFilter = '';
            }
            loadFinishedData();
        });
    }

    // 🆕 匯出下拉選單 - 成品工單
    if (finishedExportBtn) {
        finishedExportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = document.getElementById('finished-export-menu');
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });

        // 匯出選項點擊事件 - 成品工單
        document.querySelectorAll('#finished-export-menu .export-option').forEach(option => {
            option.addEventListener('click', () => {
                const type = option.dataset.type;
                handleExport(type, 'finished');
                document.getElementById('finished-export-menu').style.display = 'none';
            });
        });

        // 🆕 全選 checkbox - 成品工單
        document.getElementById('select-all-finished')?.addEventListener('change', (e) => {
            toggleSelectAll('finished', e.target.checked);
        });
    }

    // 🆕 成品工單排序
    document.querySelectorAll('#finished-stats-table .sortable').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const sortKey = th.dataset.sort;
            if (finishedState.sortBy === sortKey) {
                finishedState.sortOrder = finishedState.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                finishedState.sortBy = sortKey;
                finishedState.sortOrder = 'asc';
            }
            updateFinishedSortIcons();
            loadFinishedData();
        });
    });
}

function updateSortIcons() {
    document.querySelectorAll('.sortable .sort-icon').forEach(icon => {
        icon.textContent = '';
    });
    const activeHeader = document.querySelector(`.sortable[data-sort="${state.sortBy}"] .sort-icon`);
    if (activeHeader) {
        activeHeader.textContent = state.sortOrder === 'asc' ? '▲' : '▼';
    }
}

async function loadData() {
    statsTbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">載入中...</td></tr>';

    try {
        const params = new URLSearchParams({
            page: 1,
            per_page: 1000,  // 載入所有資料
            search: state.search,
            sort_by: state.sortBy,
            sort_order: state.sortOrder
        });

        const response = await fetch(`/api/work-order-statistics?${params}`);
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        state.totalCount = result.total || 0;

        renderTable(result.data);
        totalCountEl.textContent = `共 ${state.totalCount} 筆工單`;

    } catch (error) {
        console.error('載入資料失敗:', error);
        statsTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #f44336;">載入失敗: ${error.message}</td></tr>`;
    }
}

function renderTable(data) {
    if (!data || data.length === 0) {
        const colspan = showCheckboxes ? 8 : 7;
        statsTbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center;">沒有符合條件的資料</td></tr>`;
        return;
    }

    statsTbody.innerHTML = data.map(row => {
        const shortageCount = row['缺料筆數'] || 0;
        const badgeClass = shortageCount > 0 ? 'has-shortage' : 'no-shortage';
        const orderId = row['工單號碼'];
        const isChecked = selectedOrders.semi.has(orderId);

        // 🆕 勾選框欄位 (根據 showCheckboxes 決定是否顯示)
        const checkboxTd = showCheckboxes ? `
            <td class="checkbox-col">
                <input type="checkbox" class="order-checkbox" data-order-id="${orderId}" 
                       ${isChecked ? 'checked' : ''}
                       onchange="handleCheckboxChange('semi', '${orderId}', this.checked)">
            </td>
        ` : '';

        return `
            <tr>
                ${checkboxTd}
                <td>
                    <span class="clickable-order" onclick="showShortageDetails('${orderId}')">${orderId}</span>
                </td>
                <td title="${row['品名'] || ''}">${truncateText(row['品名'] || '', 30)}</td>
                <td>${row['需求日期'] || '-'}</td>
                <td>
                    <span class="shortage-badge ${badgeClass}">${shortageCount}</span>
                </td>
                <td>${row['對應成品'] || '-'}</td>
                <td title="${row['機型'] || ''}">${truncateText(row['機型'] || '', 25)}</td>
                <td>${row['成品出貨日'] || '-'}</td>
            </tr>
        `;
    }).join('');
}

function truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}



// 🆕 全域變數追蹤當前開啟的缺料明細視窗資訊
window.currentShortageModalInfo = null;

// 顯示缺料明細
async function showShortageDetails(orderId, orderType = 'semi') {
    // 🆕 保存當前開啟的工單資訊，供其他模組使用（例如交期儲存後刷新）
    window.currentShortageModalInfo = { orderId, orderType };
    const modal = document.getElementById('shortage-modal');
    const title = document.getElementById('shortage-modal-title');
    const summary = document.getElementById('shortage-summary');
    const tbody = document.getElementById('shortage-details-tbody');

    title.textContent = `工單 ${orderId} 缺料明細`;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">載入中...</td></tr>';
    modal.showModal();

    try {
        // 🆕 同時載入缺料明細和採購人員清單
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
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">此工單無物料需求</td></tr>';
            return;
        }

        // 🆕 建立採購人員下拉選單的 HTML
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
                        <span class="clickable-material" onclick="showMaterialDetails('${item['物料']}')">${item['物料']}</span>
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

        // 🆕 綁定採購人員下拉選單變更事件
        bindShortageBuyerSelectEvents();

    } catch (error) {
        console.error('載入缺料明細失敗:', error);
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #f44336;">載入失敗: ${error.message}</td></tr>`;
    }
}

// 🆕 綁定缺料明細中採購人員下拉選單的變更事件
function bindShortageBuyerSelectEvents() {
    document.querySelectorAll('.shortage-buyer-select').forEach(select => {
        select.addEventListener('change', async function () {
            const materialId = this.dataset.materialId;
            const newBuyer = this.value;
            const dashboardType = this.dataset.dashboardType;
            const originalValue = this.getAttribute('data-original-value') || '';

            // 暫時禁用選單
            this.disabled = true;
            this.style.opacity = '0.6';

            try {
                const response = await fetch('/api/update_buyer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        material_id: materialId,
                        buyer: newBuyer,
                        dashboard_type: dashboardType
                    })
                });
                const data = await response.json();

                if (data.success) {
                    // 顯示成功訊息
                    this.style.backgroundColor = '#d4edda';
                    this.style.borderColor = '#c3e6cb';
                    setTimeout(() => {
                        this.style.backgroundColor = '';
                        this.style.borderColor = '';
                    }, 1500);
                    console.log(`物料 ${materialId} 採購人員已更新為: ${newBuyer || '未指定'}`);
                } else {
                    alert('儲存失敗: ' + (data.error || '未知錯誤'));
                    this.value = originalValue;
                }
            } catch (error) {
                console.error('更新採購人員失敗:', error);
                alert('儲存採購人員時發生錯誤');
                this.value = originalValue;
            } finally {
                this.disabled = false;
                this.style.opacity = '1';
            }
        });

        // 儲存原始值
        select.setAttribute('data-original-value', select.value);
    });
}

function closeShortageModal() {
    shortageModal.close();
}

// 顯示物料詳情 (整合共用模組)
function showMaterialDetails(materialId) {
    if (window.openDetailsModal) {
        window.openDetailsModal(materialId);
    } else {
        console.error('Material modal module not loaded');
        alert('物料詳情模組尚未載入，請稍後再試');
    }
}

// Excel 匯出
async function exportToExcel() {
    exportBtn.disabled = true;
    exportBtn.textContent = '匯出中...';

    try {
        // 🆕 傳遞排序參數以匯出與畫面一致的排序結果
        const params = new URLSearchParams({
            search: state.search,
            sort_by: state.sortBy,
            sort_order: state.sortOrder
        });
        const response = await fetch(`/api/work-order-statistics/export?${params}`);
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        const data = result.data || [];
        if (data.length === 0) {
            alert('沒有資料可匯出');
            return;
        }

        // 使用 ExcelJS 建立 Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('工單詳情統計');

        // 設定欄位
        worksheet.columns = [
            { header: '工單號碼', key: '工單號碼', width: 15 },
            { header: '品名', key: '品名', width: 35 },
            { header: '需求日期', key: '需求日期', width: 12 },
            { header: '缺料筆數', key: '缺料筆數', width: 10 },
            { header: '對應成品', key: '對應成品', width: 15 },
            { header: '機型', key: '機型', width: 30 },
            { header: '成品出貨日', key: '成品出貨日', width: 12 }
        ];

        // 加入資料
        data.forEach(row => {
            worksheet.addRow(row);
        });

        // 設定標題樣式
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        autoAdjustColumnWidth(worksheet);

        // 產生檔案
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        saveAs(blob, `工單詳情統計_${dateStr}.xlsx`);

    } catch (error) {
        console.error('匯出失敗:', error);
        alert('匯出失敗: ' + error.message);
    } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = '📊 匯出 Excel';
    }
}

// ========================================
// 🆕 成品工單相關函式
// ========================================

function updateFinishedSortIcons() {
    document.querySelectorAll('#finished-stats-table .sortable .sort-icon').forEach(icon => {
        icon.textContent = '';
    });
    const activeHeader = document.querySelector(`#finished-stats-table .sortable[data-sort="${finishedState.sortBy}"] .sort-icon`);
    if (activeHeader) {
        activeHeader.textContent = finishedState.sortOrder === 'asc' ? '▲' : '▼';
    }
}

async function loadFinishedData() {
    finishedStatsTbody.innerHTML = '<tr><td colspan="9" style="text-align: center;">載入中...</td></tr>';

    try {
        const params = new URLSearchParams({
            page: 1,
            per_page: 1000,
            search: finishedState.search,
            sort_by: finishedState.sortBy,
            sort_order: finishedState.sortOrder,
            order_type: 'finished'  // 🆕 指定成品工單
        });

        const response = await fetch(`/api/work-order-statistics?${params}`);
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        // 🆕 前端廠別篩選
        let filteredData = result.data || [];
        if (finishedState.factoryFilter) {
            filteredData = filteredData.filter(row => row['廠別'] === finishedState.factoryFilter);
        }

        finishedState.totalCount = filteredData.length;

        renderFinishedTable(filteredData);
        finishedTotalCountEl.textContent = `共 ${finishedState.totalCount} 筆工單`;

    } catch (error) {
        console.error('載入成品工單資料失敗:', error);
        finishedStatsTbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #f44336;">載入失敗: ${error.message}</td></tr>`;
    }
}

function renderFinishedTable(data) {
    if (!data || data.length === 0) {
        const colspan = showCheckboxes ? 10 : 9;
        finishedStatsTbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center;">沒有符合條件的資料</td></tr>`;
        return;
    }

    finishedStatsTbody.innerHTML = data.map(row => {
        const shortageCount = row['缺料筆數'] || 0;
        const badgeClass = shortageCount > 0 ? 'has-shortage' : 'no-shortage';
        const orderId = row['工單號碼'];
        const isChecked = selectedOrders.finished.has(orderId);

        // 🆕 勾選框欄位 (根據 showCheckboxes 決定是否顯示)
        const checkboxTd = showCheckboxes ? `
            <td class="checkbox-col">
                <input type="checkbox" class="order-checkbox" data-order-id="${orderId}" 
                       ${isChecked ? 'checked' : ''}
                       onchange="handleCheckboxChange('finished', '${orderId}', this.checked)">
            </td>
        ` : '';

        return `
            <tr>
                ${checkboxTd}
                <td>
                    <span class="clickable-order" onclick="showShortageDetails('${orderId}', 'finished')">${orderId}</span>
                </td>
                <td>${row['訂單號碼'] || '-'}</td>
                <td title="${row['下單客戶名稱'] || ''}">${truncateText(row['下單客戶名稱'] || '', 20)}</td>
                <td>${row['物料品號'] || '-'}</td>
                <td title="${row['品號說明'] || ''}">${truncateText(row['品號說明'] || '', 25)}</td>
                <td>${row['廠別'] || '一廠'}</td>
                <td>${row['生產開始'] || '-'}</td>
                <td>${row['生產結束'] || '-'}</td>
                <td>
                    <span class="shortage-badge ${badgeClass}">${shortageCount}</span>
                </td>
            </tr>
        `;
    }).join('');
}

async function exportFinishedToExcel() {
    finishedExportBtn.disabled = true;
    finishedExportBtn.textContent = '匯出中...';

    try {
        // 🆕 傳遞排序參數以匯出與畫面一致的排序結果
        const params = new URLSearchParams({
            search: finishedState.search,
            order_type: 'finished',
            sort_by: finishedState.sortBy,
            sort_order: finishedState.sortOrder
        });

        const response = await fetch(`/api/work-order-statistics/export?${params}`);
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('成品工單統計');

        worksheet.columns = [
            { header: '工單號碼', key: 'order_id', width: 15 },
            { header: '訂單號碼', key: 'sales_order', width: 15 },
            { header: '下單客戶名稱', key: 'customer', width: 25 },
            { header: '物料品號', key: 'material_id', width: 15 },
            { header: '品號說明', key: 'description', width: 30 },
            { header: '廠別', key: 'factory', width: 8 },
            { header: '生產開始', key: 'start_date', width: 12 },
            { header: '生產結束', key: 'end_date', width: 12 },
            { header: '缺料數', key: 'shortage', width: 10 }
        ];

        result.data.forEach(row => {
            const excelRow = worksheet.addRow({
                order_id: row['工單號碼'],
                sales_order: row['訂單號碼'] || '',
                customer: row['下單客戶名稱'] || '',
                material_id: String(row['物料品號'] || ''),  // 🆕 確保為字串
                description: row['品號說明'] || '',
                factory: row['廠別'] || '一廠',
                start_date: row['生產開始'] || '',
                end_date: row['生產結束'] || '',
                shortage: row['缺料筆數'] || 0
            });
            // 🆕 設定物料品號欄位為文字格式（第4欄）
            excelRow.getCell(4).numFmt = '@';
        });

        // 樣式
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } };
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

        autoAdjustColumnWidth(worksheet);

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        saveAs(blob, `成品工單統計_${dateStr}.xlsx`);

    } catch (error) {
        console.error('匯出失敗:', error);
        alert('匯出失敗: ' + error.message);
    } finally {
        finishedExportBtn.disabled = false;
        finishedExportBtn.textContent = '📊 匯出 Excel';
    }
}

// 全域函式 (供 HTML onclick 使用)
window.showShortageDetails = showShortageDetails;
window.showMaterialDetails = showMaterialDetails;

// ========================================
// 🆕 勾選管理函式
// ========================================

// 切換勾選框顯示/隱藏
function toggleCheckboxDisplay(orderType, show) {
    showCheckboxes = show;
    const headerSelector = orderType === 'semi' ? '#checkbox-header' : '#finished-checkbox-header';
    const checkboxHeader = document.querySelector(headerSelector);

    if (checkboxHeader) {
        checkboxHeader.style.display = show ? 'table-cell' : 'none';
    }

    // 重新渲染表格以包含/排除 checkbox
    if (orderType === 'semi') {
        loadData();
    } else {
        loadFinishedData();
    }

    updateSelectedCount(orderType);
}

// 全選/取消全選
function toggleSelectAll(orderType, checked) {
    const tbody = orderType === 'semi' ? statsTbody : finishedStatsTbody;
    const checkboxes = tbody.querySelectorAll('.order-checkbox');

    checkboxes.forEach(cb => {
        cb.checked = checked;
        const orderId = cb.dataset.orderId;
        if (checked) {
            selectedOrders[orderType].add(orderId);
        } else {
            selectedOrders[orderType].delete(orderId);
        }
    });

    updateSelectedCount(orderType);
}

// 單個勾選框變更
function handleCheckboxChange(orderType, orderId, checked) {
    if (checked) {
        selectedOrders[orderType].add(orderId);
    } else {
        selectedOrders[orderType].delete(orderId);
    }

    // 更新全選狀態
    const selectAllId = orderType === 'semi' ? 'select-all-semi' : 'select-all-finished';
    const selectAllCheckbox = document.getElementById(selectAllId);
    const tbody = orderType === 'semi' ? statsTbody : finishedStatsTbody;
    const allCheckboxes = tbody.querySelectorAll('.order-checkbox');

    if (selectAllCheckbox) {
        selectAllCheckbox.checked = selectedOrders[orderType].size === allCheckboxes.length && allCheckboxes.length > 0;
    }

    updateSelectedCount(orderType);
}

// 更新已選計數顯示
function updateSelectedCount(orderType) {
    const countSpan = orderType === 'semi'
        ? document.getElementById('selected-count')
        : document.getElementById('finished-selected-count');
    const numSpan = orderType === 'semi'
        ? document.getElementById('selected-num')
        : document.getElementById('finished-selected-num');

    const count = selectedOrders[orderType].size;

    if (countSpan && numSpan) {
        if (showCheckboxes && count > 0) {
            countSpan.style.display = 'inline';
            numSpan.textContent = count;
        } else {
            countSpan.style.display = showCheckboxes ? 'inline' : 'none';
            numSpan.textContent = count;
        }
    }
}

// ========================================
// 🆕 匯出處理函式
// ========================================

async function handleExport(type, orderType) {
    currentExportMode = type;

    if (type === 'summary') {
        // 總表匯出 - 直接匯出，不改變介面狀態
        if (orderType === 'semi') {
            await exportToExcel();
        } else {
            await exportFinishedToExcel();
        }
    } else {
        // 缺料明細或總表+缺料 - 顯示勾選框
        toggleCheckboxDisplay(orderType, true);

        // 如果尚未勾選任何工單，提示用戶
        if (selectedOrders[orderType].size === 0) {
            alert('請先勾選要匯出缺料明細的工單，然後再次點擊匯出');
            return;
        }

        // 執行匯出
        if (type === 'shortage') {
            await exportShortageDetails(orderType);
        } else if (type === 'both') {
            await exportBothSheetsData(orderType);
        }
    }
}

// 匯出缺料明細（單獨）
async function exportShortageDetails(orderType) {
    const selectedIds = Array.from(selectedOrders[orderType]);

    if (selectedIds.length === 0) {
        alert('請先勾選工單');
        return;
    }

    try {
        // 批量取得缺料明細
        const response = await fetch('/api/work-order-statistics/batch-shortage-details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_ids: selectedIds, order_type: orderType })
        });

        const result = await response.json();
        if (result.error) throw new Error(result.error);

        const data = result.data || [];

        if (data.length === 0) {
            alert('選取的工單沒有物料資料');
            return;
        }

        // 產生 Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('缺料明細');

        worksheet.columns = [
            { header: '工單號碼', key: 'order_id', width: 15 },
            { header: '物料編號', key: 'material_id', width: 15 },
            { header: '物料說明', key: 'description', width: 35 },
            { header: '需求數量', key: 'demand_qty', width: 12 },
            { header: '未限制', key: 'unrestricted', width: 12 },
            { header: '品檢中', key: 'inspection', width: 12 },
            { header: '狀態', key: 'status', width: 10 },
            { header: '需求日期', key: 'demand_date', width: 12 },
            { header: '採購人員', key: 'buyer', width: 12 },
            { header: '預計交貨日', key: 'expected_date', width: 12 }
        ];

        data.forEach(row => {
            const excelRow = worksheet.addRow({
                order_id: row['工單號碼'],
                material_id: row['物料'],
                description: row['物料說明'],
                demand_qty: row['需求數量'],
                unrestricted: row['未限制'] || 0,
                inspection: row['品檢中'] || 0,
                status: row['是否缺料'] ? '缺料' : '充足',
                demand_date: row['需求日期'],
                buyer: row['採購人員'],
                expected_date: row['預計交貨日']
            });

            // 缺料列紅色標註
            if (row['是否缺料']) {
                excelRow.eachCell(cell => {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFCCCB' }  // 淡紅色
                    };
                });
            }
        });

        // 標題樣式
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

        autoAdjustColumnWidth(worksheet);

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const prefix = orderType === 'semi' ? '半品' : '成品';
        saveAs(blob, `${prefix}工單缺料明細_${dateStr}.xlsx`);

    } catch (error) {
        console.error('匯出缺料明細失敗:', error);
        alert('匯出失敗: ' + error.message);
    }
}

// 匯出總表 + 缺料明細（兩個工作表）
async function exportBothSheetsData(orderType) {
    const selectedIds = Array.from(selectedOrders[orderType]);

    if (selectedIds.length === 0) {
        alert('請先勾選工單');
        return;
    }

    try {
        // 同時取得總表和缺料明細資料
        const stateObj = orderType === 'semi' ? state : finishedState;
        const [summaryResponse, shortageResponse] = await Promise.all([
            fetch(`/api/work-order-statistics/export?search=${stateObj.search}&order_type=${orderType}&sort_by=${stateObj.sortBy}&sort_order=${stateObj.sortOrder}`),
            fetch('/api/work-order-statistics/batch-shortage-details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_ids: selectedIds, order_type: orderType })
            })
        ]);

        const [summaryResult, shortageResult] = await Promise.all([
            summaryResponse.json(),
            shortageResponse.json()
        ]);

        if (summaryResult.error) throw new Error(summaryResult.error);
        if (shortageResult.error) throw new Error(shortageResult.error);

        const summaryData = summaryResult.data || [];
        const shortageData = shortageResult.data || [];

        // 產生 Excel（兩個工作表）
        const workbook = new ExcelJS.Workbook();

        // Sheet 1: 總表
        const sheet1 = workbook.addWorksheet('工單總表');
        if (orderType === 'semi') {
            sheet1.columns = [
                { header: '工單號碼', key: '工單號碼', width: 15 },
                { header: '品名', key: '品名', width: 35 },
                { header: '需求日期', key: '需求日期', width: 12 },
                { header: '缺料筆數', key: '缺料筆數', width: 10 },
                { header: '對應成品', key: '對應成品', width: 15 },
                { header: '機型', key: '機型', width: 30 },
                { header: '成品出貨日', key: '成品出貨日', width: 12 }
            ];
        } else {
            sheet1.columns = [
                { header: '工單號碼', key: '工單號碼', width: 15 },
                { header: '訂單號碼', key: '訂單號碼', width: 15 },
                { header: '下單客戶名稱', key: '下單客戶名稱', width: 25 },
                { header: '物料品號', key: '物料品號', width: 15 },
                { header: '品號說明', key: '品號說明', width: 30 },
                { header: '生產開始', key: '生產開始', width: 12 },
                { header: '生產結束', key: '生產結束', width: 12 },
                { header: '缺料數', key: '缺料筆數', width: 10 }
            ];
        }
        summaryData.forEach(row => {
            const excelRow = sheet1.addRow(row);
            // 🆕 成品工單：設定物料品號欄位為文字格式（第4欄）
            if (orderType === 'finished') {
                excelRow.getCell(4).numFmt = '@';
                excelRow.getCell(4).value = String(row['物料品號'] || '');
            }
        });

        const headerRow1 = sheet1.getRow(1);
        headerRow1.font = { bold: true };
        headerRow1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        headerRow1.font = { bold: true, color: { argb: 'FFFFFFFF' } };

        // Sheet 2: 缺料明細
        const sheet2 = workbook.addWorksheet('缺料明細');
        sheet2.columns = [
            { header: '工單號碼', key: 'order_id', width: 15 },
            { header: '物料編號', key: 'material_id', width: 15 },
            { header: '物料說明', key: 'description', width: 35 },
            { header: '需求數量', key: 'demand_qty', width: 12 },
            { header: '未限制', key: 'unrestricted', width: 12 },
            { header: '品檢中', key: 'inspection', width: 12 },
            { header: '狀態', key: 'status', width: 10 },
            { header: '需求日期', key: 'demand_date', width: 12 },
            { header: '採購人員', key: 'buyer', width: 12 },
            { header: '預計交貨日', key: 'expected_date', width: 12 }
        ];

        shortageData.forEach(row => {
            const excelRow = sheet2.addRow({
                order_id: row['工單號碼'],
                material_id: row['物料'],
                description: row['物料說明'],
                demand_qty: row['需求數量'],
                unrestricted: row['未限制'] || 0,
                inspection: row['品檢中'] || 0,
                status: row['是否缺料'] ? '缺料' : '充足',
                demand_date: row['需求日期'],
                buyer: row['採購人員'],
                expected_date: row['預計交貨日']
            });

            // 缺料列紅色標註
            if (row['是否缺料']) {
                excelRow.eachCell(cell => {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFCCCB' }
                    };
                });
            }
        });

        const headerRow2 = sheet2.getRow(1);
        headerRow2.font = { bold: true };
        headerRow2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } };
        headerRow2.font = { bold: true, color: { argb: 'FFFFFFFF' } };

        autoAdjustColumnWidth(sheet1);
        autoAdjustColumnWidth(sheet2);

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const prefix = orderType === 'semi' ? '半品' : '成品';
        saveAs(blob, `${prefix}工單總表含缺料明細_${dateStr}.xlsx`);

    } catch (error) {
        console.error('匯出失敗:', error);
        alert('匯出失敗: ' + error.message);
    }
}

// 供表格渲染使用
window.handleCheckboxChange = handleCheckboxChange;

// 🆕 自動適應欄寬輔助函式
function autoAdjustColumnWidth(worksheet) {
    worksheet.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, cell => {
            let adjustedLength = 0;
            if (cell.value !== null && cell.value !== undefined) {
                const str = cell.value.toString();
                for (let i = 0; i < str.length; i++) {
                    // 全形/中文字元給予更寬的比例
                    if (str.charCodeAt(i) > 255) {
                        adjustedLength += 2.1;
                    } else {
                        adjustedLength += 1.1;
                    }
                }
            }
            if (adjustedLength > maxLength) {
                maxLength = adjustedLength;
            }
        });
        column.width = Math.min(Math.max(maxLength + 2, 10), 100);
    });
}
