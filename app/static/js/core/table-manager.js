/**
 * 表格管理器
 * 統一處理表格的排序、分頁和渲染邏輯
 */

const TableManager = {
    /**
     * 排序資料
     * @param {Array} data - 要排序的資料陣列
     * @param {string} column - 排序欄位
     * @param {string} order - 排序方向 ('asc' | 'desc')
     * @returns {Array} 排序後的資料
     */
    sortData(data, column, order = 'asc') {
        if (!Array.isArray(data) || !column) return data;

        return [...data].sort((a, b) => {
            let aVal = a[column];
            let bVal = b[column];

            // 處理空值
            if (aVal === null || aVal === undefined) aVal = '';
            if (bVal === null || bVal === undefined) bVal = '';

            // 數字比較
            const aNum = parseFloat(aVal);
            const bNum = parseFloat(bVal);
            if (!isNaN(aNum) && !isNaN(bNum)) {
                return order === 'asc' ? aNum - bNum : bNum - aNum;
            }

            // 字串比較
            const aStr = String(aVal).toLowerCase();
            const bStr = String(bVal).toLowerCase();

            if (order === 'asc') {
                return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
            } else {
                return bStr < aStr ? -1 : bStr > aStr ? 1 : 0;
            }
        });
    },

    /**
     * 分頁資料
     * @param {Array} data - 完整資料
     * @param {number} page - 頁碼（從 1 開始）
     * @param {number} itemsPerPage - 每頁項目數
     * @returns {object} { data: Array, totalPages: number, currentPage: number }
     */
    paginateData(data, page = 1, itemsPerPage = 50) {
        if (!Array.isArray(data)) return { data: [], totalPages: 0, currentPage: 1 };

        const totalPages = Math.ceil(data.length / itemsPerPage);
        const validPage = Math.max(1, Math.min(page, totalPages || 1));
        const startIdx = (validPage - 1) * itemsPerPage;
        const endIdx = startIdx + itemsPerPage;

        return {
            data: data.slice(startIdx, endIdx),
            totalPages,
            currentPage: validPage,
            totalItems: data.length,
            itemsPerPage
        };
    },

    /**
     * 建立分頁按鈕 HTML
     * @param {number} currentPage - 當前頁碼
     * @param {number} totalPages - 總頁數
     * @param {string} onClickHandler - 點擊處理函數名稱
     * @returns {string} HTML 字串
     */
    createPaginationHTML(currentPage, totalPages, onClickHandler = 'changePage') {
        if (totalPages <= 1) return '';

        let html = '<div class="pagination-wrapper"><div class="pagination">';

        // 上一頁
        html += `<button ${currentPage === 1 ? 'disabled' : ''} onclick="${onClickHandler}(${currentPage - 1})">上一頁</button>`;

        // 頁碼按鈕（智能顯示）
        const maxButtons = 7;
        let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
        let endPage = Math.min(totalPages, startPage + maxButtons - 1);

        if (endPage - startPage < maxButtons - 1) {
            startPage = Math.max(1, endPage - maxButtons + 1);
        }

        // 第一頁
        if (startPage > 1) {
            html += `<button onclick="${onClickHandler}(1)">1</button>`;
            if (startPage > 2) html += '<span>...</span>';
        }

        // 中間頁碼
        for (let i = startPage; i <= endPage; i++) {
            const activeClass = i === currentPage ? ' class="active"' : '';
            html += `<button${activeClass} onclick="${onClickHandler}(${i})">${i}</button>`;
        }

        // 最後一頁
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += '<span>...</span>';
            html += `<button onclick="${onClickHandler}(${totalPages})">${totalPages}</button>`;
        }

        // 下一頁
        html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="${onClickHandler}(${currentPage + 1})">下一頁</button>`;

        html += '</div></div>';
        return html;
    },

    /**
     * 更新排序圖示
     * @param {string} columnKey - 當前排序欄位
     * @param {string} order - 排序方向
     * @param {string} containerSelector - 容器選擇器
     */
    updateSortIcons(columnKey, order, containerSelector = 'table') {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        // 清除所有排序圖示
        container.querySelectorAll('.sort-icon').forEach(icon => {
            icon.textContent = '↕️';
        });

        // 設定當前欄位的圖示
        const currentHeader = container.querySelector(`[data-sort-key="${columnKey}"]`);
        if (currentHeader) {
            const icon = currentHeader.querySelector('.sort-icon');
            if (icon) {
                icon.textContent = order === 'asc' ? '↑' : '↓';
            }
        }
    },

    /**
     * 為表格標題加入排序事件
     * @param {string} tableSelector - 表格選擇器
     * @param {Function} onSort - 排序回調函數 (column, order) => void
     */
    addSortListeners(tableSelector, onSort) {
        const table = document.querySelector(tableSelector);
        if (!table) return;

        table.querySelectorAll('[data-sort-key]').forEach(header => {
            header.style.cursor = 'pointer';
            
            // 加入排序圖示（如果沒有）
            if (!header.querySelector('.sort-icon')) {
                const icon = document.createElement('span');
                icon.className = 'sort-icon';
                icon.textContent = '↕️';
                header.appendChild(icon);
            }

            header.addEventListener('click', function() {
                const column = this.getAttribute('data-sort-key');
                const currentOrder = this.getAttribute('data-sort-order') || 'asc';
                const newOrder = currentOrder === 'asc' ? 'desc' : 'asc';
                
                // 更新排序順序屬性
                table.querySelectorAll('[data-sort-key]').forEach(h => {
                    h.removeAttribute('data-sort-order');
                });
                this.setAttribute('data-sort-order', newOrder);

                // 執行回調
                if (typeof onSort === 'function') {
                    onSort(column, newOrder);
                }
            });
        });
    },

    /**
     * 篩選資料
     * @param {Array} data - 原始資料
     * @param {Function|object} filter - 篩選函數或條件物件
     * @returns {Array} 篩選後的資料
     */
    filterData(data, filter) {
        if (!Array.isArray(data)) return [];
        if (!filter) return data;

        // 如果是函數，直接使用
        if (typeof filter === 'function') {
            return data.filter(filter);
        }

        // 如果是物件，根據屬性篩選
        if (typeof filter === 'object') {
            return data.filter(item => {
                return Object.keys(filter).every(key => {
                    const filterValue = filter[key];
                    const itemValue = item[key];

                    // 如果篩選值為空，跳過此條件
                    if (filterValue === '' || filterValue === null || filterValue === undefined) {
                        return true;
                    }

                    // 字串包含檢查
                    if (typeof filterValue === 'string') {
                        return String(itemValue).toLowerCase().includes(filterValue.toLowerCase());
                    }

                    // 精確匹配
                    return itemValue === filterValue;
                });
            });
        }

        return data;
    },

    /**
     * 建立資訊文字（顯示當前範圍）
     * @param {number} currentPage - 當前頁
     * @param {number} itemsPerPage - 每頁項目數
     * @param {number} totalItems - 總項目數
     * @returns {string} 資訊文字
     */
    createInfoText(currentPage, itemsPerPage, totalItems) {
        if (totalItems === 0) return '沒有資料';
        
        const start = (currentPage - 1) * itemsPerPage + 1;
        const end = Math.min(currentPage * itemsPerPage, totalItems);
        
        return `顯示 ${start}-${end} 項，共 ${totalItems} 項`;
    }
};

// 全域暴露
window.TableManager = TableManager;

// ES6 模組匯出（未來使用）
// export default TableManager;
