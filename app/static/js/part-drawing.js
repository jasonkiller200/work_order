/**
 * 品號-圖號維護頁面專屬 JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
    // 狀態管理
    let currentPage = 1;
    let totalPages = 1;
    let currentSearch = '';
    const perPage = 20;

    // DOM 元素
    const mappingTbody = document.getElementById('mapping-tbody');
    const searchInput = document.getElementById('search-input');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const pageInfo = document.getElementById('page-info');

    const mappingModal = document.getElementById('mapping-modal');
    const mappingForm = document.getElementById('mapping-form');
    const modalTitle = document.getElementById('modal-title');
    const partNumberInput = document.getElementById('part-number');
    const drawingNumberInput = document.getElementById('drawing-number');
    const editModeHidden = document.getElementById('edit-mode');
    const errorMsg = document.getElementById('error-message');

    // 初始化載入
    loadMappings();

    // 搜尋功能（防抖處理）
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = e.target.value.trim();
            currentPage = 1;
            loadMappings();
        }, 500);
    });

    // 載入資料函式
    async function loadMappings() {
        try {
            mappingTbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">載入中...</td></tr>';

            const url = `/api/part-drawing/list?page=${currentPage}&per_page=${perPage}&search=${encodeURIComponent(currentSearch)}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.results && data.results.length > 0) {
                renderTable(data.results);
                totalPages = data.total_pages;
                updatePaginationInfo(data.total);
            } else {
                mappingTbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">查無資料</td></tr>';
                totalPages = 1;
                updatePaginationInfo(0);
            }
        } catch (error) {
            console.error('Error loading mappings:', error);
            mappingTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: red;">載入失敗</td></tr>';
        }
    }

    // 渲染表格
    function renderTable(mappings) {
        mappingTbody.innerHTML = '';
        mappings.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.part_number}</td>
                <td>${item.drawing_number}</td>
                <td><small>${item.updated_at}</small></td>
                <td>
                    <div class="btn-group">
                        <button class="outline btn-sm edit-btn" data-part="${item.part_number}" data-drawing="${item.drawing_number}">編輯</button>
                        <button class="outline btn-sm secondary delete-btn" data-part="${item.part_number}">刪除</button>
                    </div>
                </td>
            `;
            mappingTbody.appendChild(tr);
        });

        // 綁定按鈕事件
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', () => openEditModal(btn.dataset.part, btn.dataset.drawing));
        });
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => handleDelete(btn.dataset.part));
        });
    }

    // 更新分頁資訊
    function updatePaginationInfo(total) {
        pageInfo.textContent = `第 ${currentPage} / ${totalPages} 頁 (共 ${total} 筆)`;
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
    }

    // 分頁控制
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadMappings();
        }
    });

    nextPageBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            loadMappings();
        }
    });

    // 模框控制
    document.getElementById('add-single-btn').addEventListener('click', () => {
        modalTitle.textContent = '新增對照資料';
        editModeHidden.value = 'false';
        partNumberInput.value = '';
        partNumberInput.disabled = false;
        drawingNumberInput.value = '';
        errorMsg.style.display = 'none';
        mappingModal.showModal();
    });

    function openEditModal(part, drawing) {
        modalTitle.textContent = '編輯對照資料';
        editModeHidden.value = 'true';
        partNumberInput.value = part;
        partNumberInput.disabled = true;
        drawingNumberInput.value = drawing;
        errorMsg.style.display = 'none';
        mappingModal.showModal();
    }

    const closeModal = () => {
        mappingModal.close();
    };

    document.getElementById('close-modal-x').addEventListener('click', closeModal);
    document.getElementById('cancel-btn').addEventListener('click', closeModal);

    // 儲存功能
    document.getElementById('save-btn').addEventListener('click', async () => {
        const part = partNumberInput.value.trim();
        const drawing = drawingNumberInput.value.trim();
        const isEdit = editModeHidden.value === 'true';

        if (!part || !drawing) {
            showError('品號與圖號皆為必填');
            return;
        }

        try {
            const url = isEdit ? `/api/part-drawing/${part}` : '/api/part-drawing';
            const method = isEdit ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ part_number: part, drawing_number: drawing })
            });

            const result = await response.json();
            if (result.success) {
                closeModal();
                loadMappings();
                alert(isEdit ? '更新成功' : '新增成功');
            } else {
                showError(result.error || '儲存失敗');
            }
        } catch (error) {
            showError('網路或後端錯誤');
        }
    });

    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.style.display = 'block';
    }

    // 刪除功能
    async function handleDelete(part) {
        if (!confirm(`確定要刪除品號 ${part} 的對照資料嗎？`)) return;

        try {
            const response = await fetch(`/api/part-drawing/${part}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            if (result.success) {
                loadMappings();
                alert('刪除成功');
            } else {
                alert(result.error || '刪除失敗');
            }
        } catch (error) {
            alert('刪除過程中發生錯誤');
        }
    }

    // 批量匯入相關
    const importModal = document.getElementById('import-modal');
    const excelFileInput = document.getElementById('excel-file');
    const startImportBtn = document.getElementById('start-import-btn');
    const importProgress = document.getElementById('import-progress');
    const importProgressBar = document.getElementById('import-progress-bar');
    const importStatus = document.getElementById('import-status');

    document.getElementById('batch-import-btn').addEventListener('click', () => {
        excelFileInput.value = '';
        startImportBtn.disabled = true;
        importProgress.style.display = 'none';
        importModal.showModal();
    });

    excelFileInput.addEventListener('change', () => {
        startImportBtn.disabled = !excelFileInput.files.length;
    });

    const closeImport = () => {
        importModal.close();
    };

    document.getElementById('close-import-x').addEventListener('click', closeImport);
    document.getElementById('cancel-import-btn').addEventListener('click', closeImport);

    startImportBtn.addEventListener('click', async () => {
        const file = excelFileInput.files[0];
        if (!file) return;

        startImportBtn.disabled = true;
        importProgress.style.display = 'block';
        importProgressBar.value = 0;
        importStatus.textContent = '讀取檔案中...';

        try {
            const mappings = await parseExcel(file);
            if (mappings.length === 0) {
                importStatus.textContent = '錯誤：找不到有效資料或格式不符（需含 品號, 圖號）';
                startImportBtn.disabled = false;
                return;
            }

            importStatus.textContent = `匯入中 (共 ${mappings.length} 筆)...`;

            // 由於後端已有批量 API，我們分批次發送請求以避免逾時或過大，或直接一次發送
            const response = await fetch('/api/part-drawing/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mappings: mappings })
            });

            const result = await response.json();
            if (result.success) {
                importStatus.textContent = `匯入完成！成功: ${result.stats.success}, 重複: ${result.stats.duplicate}, 錯誤: ${result.stats.error}`;
                loadMappings();
                setTimeout(closeImport, 3000);
            } else {
                importStatus.textContent = '匯入失敗：' + (result.error || '未知錯誤');
                startImportBtn.disabled = false;
            }
        } catch (error) {
            console.error('Import error:', error);
            importStatus.textContent = '匯入失敗：' + error.message;
            startImportBtn.disabled = false;
        }
    });

    // 解析 Excel
    async function parseExcel(file) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(file);
        const worksheet = workbook.worksheets[0];
        const mappings = [];

        let headerRow = null;
        let colPart = -1;
        let colDrawing = -1;

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) {
                row.eachCell((cell, colNumber) => {
                    const val = String(cell.value || '').trim();
                    if (val === '品號') colPart = colNumber;
                    if (val === '圖號') colDrawing = colNumber;
                });
                if (colPart !== -1 && colDrawing !== -1) headerRow = rowNumber;
            } else if (headerRow !== null) {
                const part = String(worksheet.getRow(rowNumber).getCell(colPart).value || '').trim();
                const drawing = String(worksheet.getRow(rowNumber).getCell(colDrawing).value || '').trim();
                if (part && drawing) {
                    mappings.push({ part_number: part, drawing_number: drawing });
                }
            }
        });

        return mappings;
    }
});
