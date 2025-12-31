/**
 * 工單詳情統計頁面 JavaScript
 */

// 狀態管理
const state = {
    currentPage: 1,
    perPage: 50,
    search: '',
    sortBy: '生產開始',
    sortOrder: 'asc',
    totalPages: 1,
    totalCount: 0
};

// DOM 元素
let searchInput, searchBtn, clearBtn, exportBtn;
let statsTable, statsTbody, totalCountEl;
let perPageSelect, prevPageBtn, nextPageBtn, pageIndicator;
let shortageModal, materialModal;

// 初始化
document.addEventListener('DOMContentLoaded', function () {
    initElements();
    initEventListeners();
    loadData();
});

function initElements() {
    searchInput = document.getElementById('search-input');
    searchBtn = document.getElementById('search-btn');
    clearBtn = document.getElementById('clear-btn');
    exportBtn = document.getElementById('export-btn');
    statsTable = document.getElementById('stats-table');
    statsTbody = document.getElementById('stats-tbody');
    totalCountEl = document.getElementById('total-count');
    perPageSelect = document.getElementById('per-page-select');
    prevPageBtn = document.getElementById('prev-page-btn');
    nextPageBtn = document.getElementById('next-page-btn');
    pageIndicator = document.getElementById('page-indicator');
    shortageModal = document.getElementById('shortage-modal');
    materialModal = document.getElementById('material-modal');
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

    // 每頁筆數
    perPageSelect.addEventListener('change', () => {
        state.perPage = parseInt(perPageSelect.value);
        state.currentPage = 1;
        loadData();
    });

    // 分頁
    prevPageBtn.addEventListener('click', () => {
        if (state.currentPage > 1) {
            state.currentPage--;
            loadData();
        }
    });

    nextPageBtn.addEventListener('click', () => {
        if (state.currentPage < state.totalPages) {
            state.currentPage++;
            loadData();
        }
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
            page: state.currentPage,
            per_page: state.perPage,
            search: state.search,
            sort_by: state.sortBy,
            sort_order: state.sortOrder
        });

        const response = await fetch(`/api/work-order-statistics?${params}`);
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        state.totalPages = result.total_pages || 1;
        state.totalCount = result.total || 0;

        renderTable(result.data);
        updatePagination();
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

function updatePagination() {
    pageIndicator.textContent = `第 ${state.currentPage} 頁 / 共 ${state.totalPages} 頁`;
    prevPageBtn.disabled = state.currentPage <= 1;
    nextPageBtn.disabled = state.currentPage >= state.totalPages;
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
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('載入缺料明細失敗:', error);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #f44336;">載入失敗: ${error.message}</td></tr>`;
    }
}

function closeShortageModal() {
    shortageModal.close();
}

// 顯示物料詳情
async function showMaterialDetails(materialId) {
    const modal = document.getElementById('material-modal');
    const title = document.getElementById('material-modal-title');
    const content = document.getElementById('material-modal-content');

    title.textContent = `物料: ${materialId}`;
    content.innerHTML = '<p>載入中...</p>';
    modal.showModal();

    try {
        const response = await fetch(`/api/material/${materialId}/details`);
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        const stock = result.stock_summary || {};
        const demands = result.demand_details || [];

        content.innerHTML = `
            <div style="margin-bottom: 1em;">
                <h4>📦 庫存資訊</h4>
                <p><strong>物料說明:</strong> ${result.material_description || '-'}</p>
                <p><strong>圖號:</strong> ${result.drawing_number || '-'}</p>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1em; margin-top: 0.5em;">
                    <div style="background: rgba(76, 175, 80, 0.1); padding: 0.5em; border-radius: 4px;">
                        <div style="font-size: 0.9em; color: var(--pico-muted-color);">未限制</div>
                        <div style="font-size: 1.2em; font-weight: bold; color: #4caf50;">${stock.unrestricted || 0}</div>
                    </div>
                    <div style="background: rgba(255, 152, 0, 0.1); padding: 0.5em; border-radius: 4px;">
                        <div style="font-size: 0.9em; color: var(--pico-muted-color);">品檢中</div>
                        <div style="font-size: 1.2em; font-weight: bold; color: #ff9800;">${stock.inspection || 0}</div>
                    </div>
                    <div style="background: rgba(33, 150, 243, 0.1); padding: 0.5em; border-radius: 4px;">
                        <div style="font-size: 0.9em; color: var(--pico-muted-color);">在途</div>
                        <div style="font-size: 1.2em; font-weight: bold; color: #2196f3;">${stock.on_order || 0}</div>
                    </div>
                </div>
            </div>
            ${demands.length > 0 ? `
                <details>
                    <summary>📋 需求明細 (${demands.length} 筆)</summary>
                    <div style="max-height: 200px; overflow-y: auto; margin-top: 0.5em;">
                        <table style="font-size: 0.9em;">
                            <thead>
                                <tr>
                                    <th>訂單</th>
                                    <th>數量</th>
                                    <th>日期</th>
                                    <th>剩餘庫存</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${demands.map(d => `
                                    <tr style="${d.remaining_stock < 0 ? 'color: #f44336;' : ''}">
                                        <td>${d['訂單'] || '-'}</td>
                                        <td>${d['未結數量 (EINHEIT)'] || 0}</td>
                                        <td>${d['需求日期'] || '-'}</td>
                                        <td>${d.remaining_stock || 0}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </details>
            ` : ''}
        `;

    } catch (error) {
        console.error('載入物料詳情失敗:', error);
        content.innerHTML = `<p style="color: #f44336;">載入失敗: ${error.message}</p>`;
    }
}

function closeMaterialModal() {
    materialModal.close();
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

// 全域函式 (供 HTML onclick 使用)
window.showShortageDetails = showShortageDetails;
window.showMaterialDetails = showMaterialDetails;
