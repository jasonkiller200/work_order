// component-requirements.js
// 成品組件需求維護功能

let allData = [];
let currentPage = 1;
const perPage = 50;
let searchKeyword = '';

document.addEventListener('DOMContentLoaded', function () {
    loadData();
    setupEventListeners();
});

// 設定事件監聽
function setupEventListeners() {
    // 搜尋
    document.getElementById('search-input').addEventListener('input', function (e) {
        searchKeyword = e.target.value.trim().toLowerCase();
        currentPage = 1;
        renderTable();
    });

    // 新增
    document.getElementById('add-single-btn').addEventListener('click', openAddModal);

    // 批量匯入
    document.getElementById('batch-import-btn').addEventListener('click', openImportModal);

    // Modal 關閉
    document.getElementById('close-modal-x').addEventListener('click', closeModal);
    document.getElementById('cancel-btn').addEventListener('click', closeModal);
    document.getElementById('save-btn').addEventListener('click', saveData);

    // Import Modal
    document.getElementById('close-import-x').addEventListener('click', closeImportModal);
    document.getElementById('cancel-import-btn').addEventListener('click', closeImportModal);
    document.getElementById('excel-file').addEventListener('change', handleFileSelect);
    document.getElementById('start-import-btn').addEventListener('click', startImport);

    // 分頁
    document.getElementById('prev-page').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
        }
    });
    document.getElementById('next-page').addEventListener('click', () => {
        const filteredData = getFilteredData();
        const totalPages = Math.ceil(filteredData.length / perPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderTable();
        }
    });

    // 自動填入 base_material_id
    document.getElementById('material-id').addEventListener('blur', function (e) {
        const baseIdInput = document.getElementById('base-material-id');
        if (!baseIdInput.value && e.target.value.length >= 10) {
            baseIdInput.value = e.target.value.substring(0, 10);
        }
    });
}

// 載入資料
async function loadData() {
    try {
        const response = await fetch('/api/component_requirements');
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        allData = data.items || [];
        renderTable();
    } catch (error) {
        console.error('載入資料失敗:', error);
        document.getElementById('component-tbody').innerHTML =
            `<tr><td colspan="6" style="text-align: center; color: red;">載入失敗: ${error.message}</td></tr>`;
    }
}

// 取得篩選後的資料
function getFilteredData() {
    if (!searchKeyword) return allData;

    return allData.filter(item =>
        (item.material_id || '').toLowerCase().includes(searchKeyword) ||
        (item.base_material_id || '').toLowerCase().includes(searchKeyword) ||
        (item.description || '').toLowerCase().includes(searchKeyword) ||
        (item.note || '').toLowerCase().includes(searchKeyword)
    );
}

// 渲染表格
function renderTable() {
    const tbody = document.getElementById('component-tbody');
    const filteredData = getFilteredData();
    const totalPages = Math.ceil(filteredData.length / perPage) || 1;

    // 更新分頁資訊
    document.getElementById('page-info').textContent =
        `第 ${currentPage} / ${totalPages} 頁 (共 ${filteredData.length} 筆)`;

    // 計算當前頁的資料
    const startIdx = (currentPage - 1) * perPage;
    const pageData = filteredData.slice(startIdx, startIdx + perPage);

    if (pageData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">沒有資料</td></tr>';
        return;
    }

    let html = '';
    pageData.forEach(item => {
        const updatedAt = item.updated_at ? new Date(item.updated_at).toLocaleString('zh-TW') : '-';
        html += `<tr>
            <td>${item.material_id || '-'}</td>
            <td>${item.base_material_id || '-'}</td>
            <td>${item.description || '-'}</td>
            <td>${item.note || '-'}</td>
            <td>${updatedAt}</td>
            <td>
                <div class="btn-group">
                    <button class="btn-sm outline" onclick="editItem(${item.id})">✏️</button>
                    <button class="btn-sm outline secondary" onclick="deleteItem(${item.id})">🗑️</button>
                </div>
            </td>
        </tr>`;
    });

    tbody.innerHTML = html;

    // 更新分頁按鈕狀態
    document.getElementById('prev-page').disabled = currentPage <= 1;
    document.getElementById('next-page').disabled = currentPage >= totalPages;
}

// 開啟新增 Modal
function openAddModal() {
    document.getElementById('modal-title').textContent = '新增組件需求';
    document.getElementById('component-form').reset();
    document.getElementById('edit-id').value = '';
    document.getElementById('edit-mode').value = 'false';
    document.getElementById('error-message').style.display = 'none';
    document.getElementById('component-modal').showModal();
}

// 關閉 Modal
function closeModal() {
    document.getElementById('component-modal').close();
}

// 編輯項目
window.editItem = function (id) {
    const item = allData.find(d => d.id === id);
    if (!item) return;

    document.getElementById('modal-title').textContent = '編輯組件需求';
    document.getElementById('material-id').value = item.material_id || '';
    document.getElementById('base-material-id').value = item.base_material_id || '';
    document.getElementById('description').value = item.description || '';
    document.getElementById('note').value = item.note || '';
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-mode').value = 'true';
    document.getElementById('error-message').style.display = 'none';
    document.getElementById('component-modal').showModal();
};

// 刪除項目
window.deleteItem = async function (id) {
    if (!confirm('確定要刪除此項目嗎？')) return;

    try {
        const response = await fetch(`/api/component_requirements/${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            allData = allData.filter(d => d.id !== id);
            renderTable();
        } else {
            alert('刪除失敗: ' + (data.error || '未知錯誤'));
        }
    } catch (error) {
        alert('刪除失敗: ' + error.message);
    }
};

// 儲存資料
async function saveData(e) {
    e.preventDefault();

    const materialId = document.getElementById('material-id').value.trim();
    const baseMaterialId = document.getElementById('base-material-id').value.trim();
    const description = document.getElementById('description').value.trim();
    const note = document.getElementById('note').value.trim();
    const editId = document.getElementById('edit-id').value;
    const isEdit = document.getElementById('edit-mode').value === 'true';

    if (!materialId) {
        document.getElementById('error-message').textContent = '物料編號為必填';
        document.getElementById('error-message').style.display = 'block';
        return;
    }

    const payload = {
        material_id: materialId,
        base_material_id: baseMaterialId || materialId.substring(0, 10),
        description: description,
        note: note
    };

    try {
        let response;
        if (isEdit && editId) {
            response = await fetch(`/api/component_requirements/${editId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            response = await fetch('/api/component_requirements', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        const data = await response.json();

        if (data.success || data.id) {
            closeModal();
            loadData(); // 重新載入資料
        } else {
            document.getElementById('error-message').textContent = data.error || '儲存失敗';
            document.getElementById('error-message').style.display = 'block';
        }
    } catch (error) {
        document.getElementById('error-message').textContent = '儲存失敗: ' + error.message;
        document.getElementById('error-message').style.display = 'block';
    }
}

// 開啟匯入 Modal
function openImportModal() {
    document.getElementById('excel-file').value = '';
    document.getElementById('import-progress').style.display = 'none';
    document.getElementById('start-import-btn').disabled = true;
    document.getElementById('import-modal').showModal();
}

// 關閉匯入 Modal
function closeImportModal() {
    document.getElementById('import-modal').close();
}

// 處理檔案選擇
function handleFileSelect(e) {
    document.getElementById('start-import-btn').disabled = !e.target.files.length;
}

// 開始匯入
async function startImport() {
    const fileInput = document.getElementById('excel-file');
    const file = fileInput.files[0];

    if (!file) return;

    document.getElementById('import-progress').style.display = 'block';
    document.getElementById('import-status').textContent = '正在讀取檔案...';
    document.getElementById('start-import-btn').disabled = true;

    try {
        const workbook = new ExcelJS.Workbook();
        const reader = new FileReader();

        reader.onload = async function (e) {
            try {
                await workbook.xlsx.load(e.target.result);
                const worksheet = workbook.getWorksheet(1);

                if (!worksheet) {
                    throw new Error('找不到工作表');
                }

                const rows = [];
                const headerRow = worksheet.getRow(1);
                const headers = {};

                headerRow.eachCell((cell, colNumber) => {
                    const value = String(cell.value || '').toLowerCase().trim();
                    if (value.includes('物料') || value === 'material_id') {
                        headers.material_id = colNumber;
                    } else if (value.includes('說明') || value === 'description') {
                        headers.description = colNumber;
                    } else if (value.includes('備註') || value === 'note') {
                        headers.note = colNumber;
                    }
                });

                if (!headers.material_id) {
                    throw new Error('找不到「物料」或「material_id」欄位');
                }

                worksheet.eachRow((row, rowNumber) => {
                    if (rowNumber === 1) return; // 跳過標題

                    const materialId = String(row.getCell(headers.material_id).value || '').trim();
                    if (!materialId) return;

                    rows.push({
                        material_id: materialId,
                        base_material_id: materialId.substring(0, 10),
                        description: headers.description ? String(row.getCell(headers.description).value || '').trim() : '',
                        note: headers.note ? String(row.getCell(headers.note).value || '').trim() : ''
                    });
                });

                if (rows.length === 0) {
                    throw new Error('沒有找到有效的資料');
                }

                document.getElementById('import-status').textContent = `正在匯入 ${rows.length} 筆資料...`;

                const response = await fetch('/api/component_requirements/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: rows })
                });

                const result = await response.json();

                if (result.success) {
                    document.getElementById('import-status').textContent =
                        `✅ 匯入完成！新增 ${result.inserted} 筆，更新 ${result.updated} 筆`;
                    setTimeout(() => {
                        closeImportModal();
                        loadData();
                    }, 1500);
                } else {
                    throw new Error(result.error || '匯入失敗');
                }

            } catch (error) {
                document.getElementById('import-status').textContent = '❌ ' + error.message;
                document.getElementById('start-import-btn').disabled = false;
            }
        };

        reader.onerror = function () {
            document.getElementById('import-status').textContent = '❌ 讀取檔案失敗';
            document.getElementById('start-import-btn').disabled = false;
        };

        reader.readAsArrayBuffer(file);

    } catch (error) {
        document.getElementById('import-status').textContent = '❌ ' + error.message;
        document.getElementById('start-import-btn').disabled = false;
    }
}
