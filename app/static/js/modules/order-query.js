/**
 * 訂單查詢模組（簡化版）
 * 處理訂單查詢相關功能
 */

/**
 * 設定訂單頁籤
 */
function setupOrderTabs() {
    const downloadSpecsBtn = document.getElementById('download-specs-btn');

    // 綁定下載按鈕
    if (downloadSpecsBtn) {
        downloadSpecsBtn.addEventListener('click', function () {
            if (window.currentOrderId) {
                window.location.href = `/api/download_specs/${window.currentOrderId}`;
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

/**
 * 設定訂單搜尋功能
 */
function setupOrderSearch() {
    const searchInput = document.getElementById('order-id-input');
    const searchBtn = document.getElementById('search-order-btn');
    const orderDetailsContainer = document.getElementById('order-details-container');

    if (!searchInput || !searchBtn) return;

    searchInput.value = '10000'; // 預設值

    searchBtn.addEventListener('click', function () {
        const orderId = searchInput.value.trim();
        if (orderId.length < 9) {
            orderDetailsContainer.innerHTML = '<p style="color: red;">料號至少需要輸入9碼。</p>';
            return;
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

/**
 * 渲染訂單摘要資訊
 * @param {string} orderId - 訂單編號
 * @param {object} summary - 訂單摘要資料
 * @returns {string} HTML 字串
 */
function renderOrderSummary(orderId, summary) {
    let html = `<h3>訂單 ${orderId} 摘要資訊</h3>`;
    
    if (summary && Object.keys(summary).length > 0) {
        html += `
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
        html += '<p>沒有找到該訂單的摘要資訊。</p>';
    }
    
    return html;
}

/**
 * 渲染訂單備註
 * @param {string} note - 訂單備註
 * @returns {string} HTML 字串
 */
function renderOrderNote(note) {
    if (!note) return '';
    
    return `
        <div class="order-note-section">
            <h3>訂單備註</h3>
            <article class="order-note-card">
                <p>${note.replace(/\n/g, '<br>')}</p>
            </article>
        </div>
    `;
}

/**
 * 渲染訂單規格資訊
 * @param {string} orderId - 訂單編號
 * @param {Array} specs - 規格清單
 * @param {string} version - 規格版本
 * @returns {string} HTML 字串
 */
function renderOrderSpecs(orderId, specs, version) {
    let versionText = '';
    if (version && version.trim() !== 'nan' && version.trim() !== '') {
        versionText = ` <span style="font-weight: normal; font-size: 0.9em;">(版本: ${version})</span>`;
    }
    
    let html = `<h3>訂單 ${orderId} 的規格資訊${versionText}</h3>`;
    
    if (specs && specs.length > 0) {
        html += `
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
        specs.forEach(spec => {
            html += `
                <tr>
                    <td>${spec['內部特性號碼']}</td>
                    <td>${spec['特性說明']}</td>
                    <td>${spec['特性值']}</td>
                    <td>${spec['值說明']}</td>
                </tr>
            `;
        });
        html += `
                    </tbody>
                </table>
            </figure>
        `;
    } else {
        html += '<p>沒有找到該訂單的規格資訊。</p>';
    }
    
    return html;
}
