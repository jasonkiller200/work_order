/**
 * 未結案採購單查詢頁面 JavaScript
 */

// 全域變數
let currentPage = 1;
let perPage = 100;
let totalPages = 1;
let allData = []; // 儲存當前頁面資料

// 初始化
document.addEventListener('DOMContentLoaded', function () {
    initFlatpickr();
    loadBuyerFilter();
    loadData();
    bindEvents();
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
        tbody.innerHTML = '<tr><td colspan="13" style="text-align: center;">沒有找到符合條件的資料</td></tr>';
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
                    <td>${po.original_delivery_date || '-'}</td>
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
                <td>${po.original_delivery_date || '-'}</td>
                <td>${po.updated_delivery_date || '-'}</td>
                <td>-</td>
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

    // 匯出 Excel
    document.getElementById('export-excel-btn').addEventListener('click', exportToExcel);
}

// 匯出 Excel
async function exportToExcel() {
    if (!allData || allData.length === 0) {
        alert('沒有資料可匯出');
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('未結案採購單');

        // 定義欄位 (包含分批日期和分批數量)
        worksheet.columns = [
            { header: '採購單號', key: 'po_number', width: 15 },
            { header: '物料', key: 'material_id', width: 18 },
            { header: '圖號', key: 'drawing_number', width: 15 },
            { header: '物料說明', key: 'description', width: 30 },
            { header: '採購人員', key: 'buyer_name', width: 12 },
            { header: '供應商', key: 'supplier', width: 20 },
            { header: '訂購數量', key: 'ordered_quantity', width: 12 },
            { header: '未結數量', key: 'outstanding_quantity', width: 12 },
            { header: '原始交期', key: 'original_delivery_date', width: 12 },
            { header: '更新交期', key: 'updated_delivery_date', width: 12 },
            { header: '分批日期', key: 'schedule_date', width: 12 },
            { header: '分批數量', key: 'schedule_quantity', width: 12 },
            { header: '維護時間', key: 'maintained_at', width: 18 }
        ];

        // 加入資料 (展開分批交期為獨立行)
        allData.forEach(po => {
            const hasSchedules = po.delivery_schedules && po.delivery_schedules.length > 0;

            if (hasSchedules) {
                // 每批交期展開為獨立行
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
                        original_delivery_date: po.original_delivery_date || '',
                        updated_delivery_date: po.updated_delivery_date || '',
                        schedule_date: schedule.expected_date || '',
                        schedule_quantity: Math.round(schedule.quantity),
                        maintained_at: schedule.updated_at || ''
                    });
                });
            } else {
                // 沒有分批資料時輸出單行
                worksheet.addRow({
                    po_number: po.po_number,
                    material_id: po.material_id,
                    drawing_number: po.drawing_number || '',
                    description: po.description || '',
                    buyer_name: po.buyer_name || '',
                    supplier: po.supplier || '',
                    ordered_quantity: Math.round(po.ordered_quantity),
                    outstanding_quantity: Math.round(po.outstanding_quantity),
                    original_delivery_date: po.original_delivery_date || '',
                    updated_delivery_date: po.updated_delivery_date || '',
                    schedule_date: '',
                    schedule_quantity: '',
                    maintained_at: ''
                });
            }
        });

        // 設定標題列樣式
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

        // 產生檔案
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const today = new Date().toISOString().split('T')[0];
        saveAs(blob, `未結案採購單_${today}.xlsx`);

    } catch (error) {
        console.error('匯出 Excel 失敗:', error);
        alert('匯出失敗: ' + error.message);
    }
}
