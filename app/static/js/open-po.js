/**
 * 未結案採購單查詢頁面 JavaScript
 */

// 全域變數
let currentPage = 1;
let perPage = 200;
let totalPages = 1;
let allData = []; // 儲存當前頁面資料

// 🆕 排序相關變數
let currentSortField = null;
let currentSortDirection = 'asc'; // 'asc' 或 'desc'

// 初始化
document.addEventListener('DOMContentLoaded', function () {
    initFlatpickr();
    loadBuyerFilter();
    loadData();
    bindEvents();
    bindSortEvents(); // 🆕 綁定排序事件
});

// 初始化日期選擇器
function initFlatpickr() {
    const fpConfig = {
        locale: 'zh_tw',
        dateFormat: 'Y-m-d',
        allowInput: true
    };

    flatpickr('#date-start', fpConfig);
    flatpickr('#date-end', fpConfig);
}

// 載入採購人員篩選選項
function loadBuyerFilter() {
    fetch('/api/purchase_orders/buyers')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('buyer-filter');
            if (data.buyers && data.buyers.length > 0) {
                data.buyers.forEach(buyer => {
                    const option = document.createElement('option');
                    option.value = buyer.id;
                    option.textContent = buyer.name;
                    select.appendChild(option);
                });
            }
        })
        .catch(error => {
            console.error('載入採購人員清單失敗:', error);
        });
}

// 載入資料
function loadData() {
    const search = document.getElementById('search-input').value.trim();
    const buyerId = document.getElementById('buyer-filter').value;
    const dateStart = document.getElementById('date-start').value;
    const dateEnd = document.getElementById('date-end').value;

    // 組裝查詢參數
    const params = new URLSearchParams({
        page: currentPage,
        per_page: perPage
    });

    if (search) params.append('search', search);
    if (buyerId) params.append('buyer_id', buyerId);
    if (dateStart) params.append('date_start', dateStart);
    if (dateEnd) params.append('date_end', dateEnd);

    // 顯示載入中
    document.getElementById('po-tbody').innerHTML = '<tr><td colspan="12" style="text-align: center;">載入中...</td></tr>';

    fetch(`/api/purchase_orders/open?${params.toString()}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }

            allData = data.results;
            totalPages = data.total_pages;

            renderTable(data.results);
            updatePagination(data);
            updateStats(data);
        })
        .catch(error => {
            console.error('載入資料失敗:', error);
            document.getElementById('po-tbody').innerHTML = `<tr><td colspan="12" style="text-align: center; color: red;">載入失敗: ${error.message}</td></tr>`;
        });
}

// 渲染表格
function renderTable(results) {
    const tbody = document.getElementById('po-tbody');

    if (!results || results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" style="text-align: center;">沒有找到符合條件的資料</td></tr>';
        return;
    }

    let html = '';
    results.forEach(po => {
        // 判斷是否有分批交期需要展開
        const hasSchedules = po.delivery_schedules && po.delivery_schedules.length > 0;

        if (hasSchedules) {
            // 有分批交期：每批展開為獨立行
            po.delivery_schedules.forEach((schedule, idx) => {
                const isFirstRow = (idx === 0);
                const rowStyle = isFirstRow ? '' : 'style="background-color: rgba(255,255,255,0.03);"';

                html += `<tr ${rowStyle}>
                    <td>${po.po_number}</td>
                    <td>${po.material_id}</td>
                    <td>${po.drawing_number || '-'}</td>
                    <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${po.description || ''}">${po.description || '-'}</td>
                    <td>${po.buyer_name || '-'}</td>
                    <td>${po.supplier || '-'}</td>
                    <td style="text-align: right;">${Math.round(po.ordered_quantity)}</td>
                    <td style="text-align: right;">${Math.round(po.outstanding_quantity)}</td>
                    <td>${po.updated_delivery_date || '-'}</td>
                    <td>${schedule.expected_date || '-'}</td>
                    <td style="text-align: right;">${Math.round(schedule.quantity)}</td>
                    <td>${schedule.updated_at || '-'}</td>
                </tr>`;
            });
        } else {
            // 沒有分批交期：顯示單行
            html += `<tr>
                <td>${po.po_number}</td>
                <td>${po.material_id}</td>
                <td>${po.drawing_number || '-'}</td>
                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${po.description || ''}">${po.description || '-'}</td>
                <td>${po.buyer_name || '-'}</td>
                <td>${po.supplier || '-'}</td>
                <td style="text-align: right;">${Math.round(po.ordered_quantity)}</td>
                <td style="text-align: right;">${Math.round(po.outstanding_quantity)}</td>
                <td>${po.updated_delivery_date || '-'}</td>
                <td>-</td>
                <td>-</td>
            </tr>`;
        }
    });

    tbody.innerHTML = html;
}

// 更新分頁控制
function updatePagination(data) {
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    const pageIndicator = document.getElementById('page-indicator');

    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= data.total_pages;

    pageIndicator.textContent = `第 ${data.page} 頁 / 共 ${data.total_pages} 頁`;
}

// 更新統計資訊
function updateStats(data) {
    document.getElementById('total-count').textContent = `共 ${data.total} 筆未結案採購單`;
}

// 綁定事件
function bindEvents() {
    // 查詢按鈕
    document.getElementById('apply-filter-btn').addEventListener('click', function () {
        currentPage = 1;
        loadData();
    });

    // 清除篩選
    document.getElementById('clear-filter-btn').addEventListener('click', function () {
        document.getElementById('search-input').value = '';
        document.getElementById('buyer-filter').value = '';
        document.getElementById('date-start').value = '';
        document.getElementById('date-end').value = '';
        currentPage = 1;
        loadData();
    });

    // Enter 鍵搜尋
    document.getElementById('search-input').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            currentPage = 1;
            loadData();
        }
    });

    // 每頁筆數變更
    document.getElementById('per-page-select').addEventListener('change', function () {
        perPage = parseInt(this.value);
        currentPage = 1;
        loadData();
    });

    // 上一頁
    document.getElementById('prev-page-btn').addEventListener('click', function () {
        if (currentPage > 1) {
            currentPage--;
            loadData();
        }
    });

    // 下一頁
    document.getElementById('next-page-btn').addEventListener('click', function () {
        if (currentPage < totalPages) {
            currentPage++;
            loadData();
        }
    });

    // 匯出 Excel (下拉選單)
    const exportBtn = document.getElementById('export-excel-btn');
    const exportMenu = document.getElementById('export-menu');
    const exportOptions = document.querySelectorAll('#export-menu .export-option');

    exportBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        exportMenu.style.display = exportMenu.style.display === 'block' ? 'none' : 'block';
    });

    exportOptions.forEach(option => {
        option.addEventListener('click', function (event) {
            event.stopPropagation();
            exportMenu.style.display = 'none';

            const type = this.dataset.type;
            if (type === 'supplier') {
                exportToExcelBySupplier();
            } else {
                exportToExcel();
            }
        });
    });

    document.addEventListener('click', function () {
        exportMenu.style.display = 'none';
    });
}

function buildExportParams() {
    const search = document.getElementById('search-input').value.trim();
    const buyerId = document.getElementById('buyer-filter').value;
    const dateStart = document.getElementById('date-start').value;
    const dateEnd = document.getElementById('date-end').value;

    const params = new URLSearchParams({
        page: 1,
        per_page: 99999
    });

    if (search) params.append('search', search);
    if (buyerId) params.append('buyer_id', buyerId);
    if (dateStart) params.append('date_start', dateStart);
    if (dateEnd) params.append('date_end', dateEnd);

    return params;
}

async function fetchExportData(params) {
    const response = await fetch(`/api/purchase_orders/open?${params.toString()}`);
    const data = await response.json();
    if (data.error) {
        throw new Error(data.error);
    }
    return data.results || [];
}

function configureWorksheetColumns(worksheet) {
    worksheet.columns = [
        { header: '採購單號', key: 'po_number', width: 15 },
        { header: '物料', key: 'material_id', width: 18 },
        { header: '圖號', key: 'drawing_number', width: 15 },
        { header: '物料說明', key: 'description', width: 30 },
        { header: '採購人員', key: 'buyer_name', width: 12 },
        { header: '供應商', key: 'supplier', width: 20 },
        { header: '訂購數量', key: 'ordered_quantity', width: 12 },
        { header: '未結數量', key: 'outstanding_quantity', width: 12 },
        { header: '更新交期', key: 'updated_delivery_date', width: 12 },
        { header: '分批日期', key: 'schedule_date', width: 12 },
        { header: '分批數量', key: 'schedule_quantity', width: 12 },
        { header: '維護時間', key: 'maintained_at', width: 18 }
    ];
}

function appendExportRows(worksheet, exportData) {
    exportData.forEach(po => {
        const hasSchedules = po.delivery_schedules && po.delivery_schedules.length > 0;

        if (hasSchedules) {
            po.delivery_schedules.forEach(schedule => {
                worksheet.addRow({
                    po_number: po.po_number,
                    material_id: po.material_id,
                    drawing_number: po.drawing_number || '',
                    description: po.description || '',
                    buyer_name: po.buyer_name || '',
                    supplier: po.supplier || '',
                    ordered_quantity: Math.round(po.ordered_quantity),
                    outstanding_quantity: Math.round(po.outstanding_quantity),
                    updated_delivery_date: po.updated_delivery_date || '',
                    schedule_date: schedule.expected_date || '',
                    schedule_quantity: Math.round(schedule.quantity),
                    maintained_at: schedule.updated_at || ''
                });
            });
        } else {
            worksheet.addRow({
                po_number: po.po_number,
                material_id: po.material_id,
                drawing_number: po.drawing_number || '',
                description: po.description || '',
                buyer_name: po.buyer_name || '',
                supplier: po.supplier || '',
                ordered_quantity: Math.round(po.ordered_quantity),
                outstanding_quantity: Math.round(po.outstanding_quantity),
                updated_delivery_date: po.updated_delivery_date || '',
                schedule_date: '',
                schedule_quantity: '',
                maintained_at: ''
            });
        }
    });
}

function styleHeaderRow(worksheet) {
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
    };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
}

function sanitizeFileName(name) {
    const cleaned = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_');
    return cleaned || '未填供應商';
}

function sanitizeSheetName(name) {
    const cleaned = String(name || '').trim().replace(/[\\/*?:\[\]]/g, '_');
    return (cleaned || '未填供應商').slice(0, 31);
}

// 匯出 Excel
async function exportToExcel() {
    try {
        const params = buildExportParams();

        // 顯示載入中提示
        const exportBtn = document.getElementById('export-excel-btn');
        const originalText = exportBtn.innerHTML;
        exportBtn.innerHTML = '匯出中...';
        exportBtn.disabled = true;

        const exportData = await fetchExportData(params);

        if (exportData.length === 0) {
            alert('沒有資料可匯出');
            exportBtn.innerHTML = originalText;
            exportBtn.disabled = false;
            return;
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('未結案採購單');

        configureWorksheetColumns(worksheet);
        appendExportRows(worksheet, exportData);
        styleHeaderRow(worksheet);

        // 產生檔案
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const today = new Date().toISOString().split('T')[0];
        saveAs(blob, `未結案採購單_${today}.xlsx`);

        // 還原按鈕
        exportBtn.innerHTML = originalText;
        exportBtn.disabled = false;

    } catch (error) {
        console.error('匯出 Excel 失敗:', error);
        alert('匯出失敗: ' + error.message);

        // 還原按鈕
        const exportBtn = document.getElementById('export-excel-btn');
        exportBtn.innerHTML = '📊 匯出 Excel';
        exportBtn.disabled = false;
    }
}

// 依供應商分檔匯出 Excel
async function exportToExcelBySupplier() {
    const exportBtn = document.getElementById('export-excel-btn');
    const originalText = exportBtn.innerHTML;

    try {
        const params = buildExportParams();

        exportBtn.innerHTML = '分檔匯出中...';
        exportBtn.disabled = true;

        const exportData = await fetchExportData(params);

        if (exportData.length === 0) {
            alert('沒有資料可匯出');
            exportBtn.innerHTML = originalText;
            exportBtn.disabled = false;
            return;
        }

        const grouped = new Map();
        exportData.forEach(po => {
            const supplierKey = (po.supplier || '').trim() || '未填供應商';
            if (!grouped.has(supplierKey)) {
                grouped.set(supplierKey, []);
            }
            grouped.get(supplierKey).push(po);
        });

        const supplierCount = grouped.size;
        const confirmMessage = `即將依供應商分檔匯出。\n預計匯出 ${supplierCount} 份檔案。\n\n是否繼續？`;
        if (!confirm(confirmMessage)) {
            exportBtn.innerHTML = originalText;
            exportBtn.disabled = false;
            return;
        }

        const today = new Date().toISOString().split('T')[0];

        for (const [supplier, items] of grouped.entries()) {
            const workbook = new ExcelJS.Workbook();
            const sheetName = sanitizeSheetName(supplier);
            const worksheet = workbook.addWorksheet(sheetName);

            configureWorksheetColumns(worksheet);
            appendExportRows(worksheet, items);
            styleHeaderRow(worksheet);

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

            const safeSupplier = sanitizeFileName(supplier);
            saveAs(blob, `${safeSupplier}_${today}.xlsx`);
        }

        exportBtn.innerHTML = originalText;
        exportBtn.disabled = false;
    } catch (error) {
        console.error('分檔匯出失敗:', error);
        alert('匯出失敗: ' + error.message);
        exportBtn.innerHTML = originalText;
        exportBtn.disabled = false;
    }
}

// 🆕 綁定排序事件
function bindSortEvents() {
    const sortableHeaders = document.querySelectorAll('th.sortable');
    sortableHeaders.forEach(header => {
        header.addEventListener('click', function () {
            const sortField = this.dataset.sort;
            handleSort(sortField);
        });
    });
}

// 🆕 處理排序
function handleSort(field) {
    // 切換排序方向
    if (currentSortField === field) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortField = field;
        currentSortDirection = 'asc';
    }

    // 更新表頭圖標
    updateSortIcons();

    // 對資料進行排序
    sortData();

    // 重新渲染表格
    renderTable(allData);
}

// 🆕 更新排序圖標
function updateSortIcons() {
    const sortableHeaders = document.querySelectorAll('th.sortable');
    sortableHeaders.forEach(header => {
        const icon = header.querySelector('.sort-icon');
        if (header.dataset.sort === currentSortField) {
            icon.textContent = currentSortDirection === 'asc' ? '↑' : '↓';
            header.style.backgroundColor = 'rgba(66, 139, 202, 0.2)';
        } else {
            icon.textContent = '⇅';
            header.style.backgroundColor = '';
        }
    });
}

// 🆕 排序資料
function sortData() {
    if (!currentSortField || !allData || allData.length === 0) return;

    allData.sort((a, b) => {
        let valueA, valueB;

        // 根據欄位取得對應值
        switch (currentSortField) {
            case 'material_id':
                valueA = a.material_id || '';
                valueB = b.material_id || '';
                break;
            case 'supplier':
                valueA = a.supplier || '';
                valueB = b.supplier || '';
                break;
            case 'updated_delivery_date':
                valueA = a.updated_delivery_date || '';
                valueB = b.updated_delivery_date || '';
                break;
            case 'schedule_date':
                // 取第一筆分批日期
                valueA = (a.delivery_schedules && a.delivery_schedules.length > 0)
                    ? a.delivery_schedules[0].expected_date || '' : '';
                valueB = (b.delivery_schedules && b.delivery_schedules.length > 0)
                    ? b.delivery_schedules[0].expected_date || '' : '';
                break;
            case 'maintained_at':
                // 取第一筆維護時間
                valueA = (a.delivery_schedules && a.delivery_schedules.length > 0)
                    ? a.delivery_schedules[0].updated_at || '' : '';
                valueB = (b.delivery_schedules && b.delivery_schedules.length > 0)
                    ? b.delivery_schedules[0].updated_at || '' : '';
                break;
            default:
                valueA = '';
                valueB = '';
        }

        // 字串比較
        let comparison = 0;
        if (valueA < valueB) {
            comparison = -1;
        } else if (valueA > valueB) {
            comparison = 1;
        }

        // 根據方向調整
        return currentSortDirection === 'asc' ? comparison : -comparison;
    });
}
