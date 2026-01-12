document.addEventListener('DOMContentLoaded', function () {
    if (window.location.pathname === '/admin_dashboard') {
        loadTrafficData();
        initSyncButtons();  // 🆕 初始化同步按鈕
    }
});

// 🆕 初始化資料同步按鈕
function initSyncButtons() {
    const syncBtn = document.getElementById('sync-delivery-excel-btn');
    const resultSpan = document.getElementById('sync-result');

    if (syncBtn) {
        syncBtn.addEventListener('click', async function () {
            // 禁用按鈕並顯示載入狀態
            syncBtn.disabled = true;
            syncBtn.innerHTML = '⏳ 同步中...';
            resultSpan.textContent = '';
            resultSpan.style.color = 'var(--pico-muted-color)';

            try {
                const response = await fetch('/api/sync/delivery-to-excel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                const data = await response.json();

                if (data.success) {
                    resultSpan.style.color = 'var(--color-success, #4caf50)';
                    resultSpan.textContent = `✅ ${data.message}`;
                } else {
                    resultSpan.style.color = 'var(--color-danger, #f44336)';
                    resultSpan.textContent = `❌ 同步失敗: ${data.error}`;
                }
            } catch (error) {
                console.error('同步失敗:', error);
                resultSpan.style.color = 'var(--color-danger, #f44336)';
                resultSpan.textContent = `❌ 網路錯誤: ${error.message}`;
            } finally {
                // 恢復按鈕
                syncBtn.disabled = false;
                syncBtn.innerHTML = '📅 同步交期到缺料 Excel';
            }
        });
    }
}

function loadTrafficData() {
    const container = document.getElementById('traffic-data-container');
    fetch('/api/admin/traffic')
        .then(response => response.json())
        .then(data => {
            if (!data || Object.keys(data).length === 0) {
                container.innerHTML = '<p>沒有可顯示的流量數據。</p>';
                return;
            }

            let htmlContent = '';
            for (const page in data) {
                const pageData = data[page];
                htmlContent += `
                    <h3>頁面: ${page} (總瀏覽次數: ${pageData.total_views})</h3>
                    <figure>
                        <table>
                            <thead>
                                <tr>
                                    <th>IP 地址</th>
                                    <th>訪問次數</th>
                                    <th>最後訪問時間</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                if (pageData.ip_stats && pageData.ip_stats.length > 0) {
                    pageData.ip_stats.forEach(ipStat => {
                        htmlContent += `
                            <tr>
                                <td>${ipStat.ip}</td>
                                <td>${ipStat.visits}</td>
                                <td>${ipStat.last_visit || 'N/A'}</td>
                            </tr>
                        `;
                    });
                } else {
                    htmlContent += `<tr><td colspan="3">沒有該頁面的 IP 訪問數據。</td></tr>`;
                }
                htmlContent += `
                            </tbody>
                        </table>
                    </figure>
                `;
            }
            container.innerHTML = htmlContent;
        })
        .catch(error => {
            console.error('Error fetching traffic data:', error);
            container.innerHTML = '<p style="color: red;">載入流量數據時發生錯誤。</p>';
        });
}
