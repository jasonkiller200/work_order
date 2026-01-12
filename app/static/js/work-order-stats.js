/**
 * 工單詳情統計頁面 JavaScript
 * 支援半品工單和成品工單兩個頁籤
 */

// 狀態管理
const state = {
    search: '',
    sortBy: '生產開始',
    sortOrder: 'asc',
    totalCount: 0,
    orderType: 'semi'  // 'semi' = 半品工單, 'finished' = 成品工單
};

// 成品工單狀態（獨立維護）
const finishedState = {
    search: '',
    sortBy: '生產開始',
    sortOrder: 'asc',
    totalCount: 0
};

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


    // 匯出
    exportBtn.addEventListener('click', exportToExcel);

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

    if (finishedClearBtn) {
        finishedClearBtn.addEventListener('click', () => {
            finishedSearchInput.value = '';
            finishedState.search = '';
            loadFinishedData();
        });
    }

    if (finishedExportBtn) {
        finishedExportBtn.addEventListener('click', exportFinishedToExcel);
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
        statsTbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">沒有符合條件的資料</td></tr>';
        return;
    }

    statsTbody.innerHTML = data.map(row => {
        const shortageCount = row['缺料筆數'] || 0;
        const badgeClass = shortageCount > 0 ? 'has-shortage' : 'no-shortage';

        return `
            <tr>
                <td>
                    <span class="clickable-order" onclick="showShortageDetails('${row['工單號碼']}')">${row['工單號碼']}</span>
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



// 顯示缺料明細
async function showShortageDetails(orderId) {
    const modal = document.getElementById('shortage-modal');
    const title = document.getElementById('shortage-modal-title');
    const summary = document.getElementById('shortage-summary');
    const tbody = document.getElementById('shortage-details-tbody');

    title.textContent = `工單 ${orderId} 缺料明細`;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">載入中...</td></tr>';
    modal.showModal();

    try {
        const response = await fetch(`/api/work-order-statistics/${orderId}/shortage-details`);
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        summary.innerHTML = `
            <strong>缺料筆數:</strong> <span style="color: ${result.shortage_count > 0 ? '#f44336' : '#4caf50'};">${result.shortage_count}</span> / 
            <strong>物料總數:</strong> ${result.total_materials}
        `;

        if (!result.details || result.details.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">此工單無物料需求</td></tr>';
            return;
        }

        tbody.innerHTML = result.details.map(item => {
            const isShortage = item['是否缺料'];
            const rowClass = isShortage ? 'shortage-row' : '';
            const statusText = isShortage ? '⚠️ 缺料' : '✅ 充足';
            const statusColor = isShortage ? '#f44336' : '#4caf50';

            return `
                <tr class="${rowClass}">
                    <td>
                        <span class="clickable-material" onclick="showMaterialDetails('${item['物料']}')">${item['物料']}</span>
                    </td>
                    <td title="${item['物料說明'] || ''}">${truncateText(item['物料說明'] || '', 25)}</td>
                    <td>${item['需求數量'] || 0}</td>
                    <td>${item['可用庫存'] || 0}</td>
                    <td style="color: ${statusColor};">${statusText}</td>
                    <td>${item['需求日期'] || '-'}</td>
                    <td>${item['採購人員'] || '-'}</td>
                    <td>${item['預計交貨日'] || '-'}</td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('載入缺料明細失敗:', error);
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #f44336;">載入失敗: ${error.message}</td></tr>`;
    }
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
        const params = new URLSearchParams({ search: state.search });
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
    finishedStatsTbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">載入中...</td></tr>';

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

        finishedState.totalCount = result.total || 0;

        renderFinishedTable(result.data);
        finishedTotalCountEl.textContent = `共 ${finishedState.totalCount} 筆工單`;

    } catch (error) {
        console.error('載入成品工單資料失敗:', error);
        finishedStatsTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #f44336;">載入失敗: ${error.message}</td></tr>`;
    }
}

function renderFinishedTable(data) {
    if (!data || data.length === 0) {
        finishedStatsTbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">沒有符合條件的資料</td></tr>';
        return;
    }

    finishedStatsTbody.innerHTML = data.map(row => {
        const shortageCount = row['缺料筆數'] || 0;
        const badgeClass = shortageCount > 0 ? 'has-shortage' : 'no-shortage';

        return `
            <tr>
                <td>
                    <span class="clickable-order" onclick="showShortageDetails('${row['工單號碼']}', 'finished')">${row['工單號碼']}</span>
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

async function exportFinishedToExcel() {
    finishedExportBtn.disabled = true;
    finishedExportBtn.textContent = '匯出中...';

    try {
        const params = new URLSearchParams({
            search: finishedState.search,
            order_type: 'finished'
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
            { header: '品名', key: 'name', width: 35 },
            { header: '需求日期', key: 'demand_date', width: 12 },
            { header: '缺料筆數', key: 'shortage', width: 10 },
            { header: '對應成品', key: 'product', width: 15 },
            { header: '機型', key: 'model', width: 30 },
            { header: '成品出貨日', key: 'ship_date', width: 12 }
        ];

        result.data.forEach(row => {
            worksheet.addRow({
                order_id: row['工單號碼'],
                name: row['品名'] || '',
                demand_date: row['需求日期'] || '',
                shortage: row['缺料筆數'] || 0,
                product: row['對應成品'] || '',
                model: row['機型'] || '',
                ship_date: row['成品出貨日'] || ''
            });
        });

        // 樣式
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } };
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

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
