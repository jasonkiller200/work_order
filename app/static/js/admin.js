document.addEventListener('DOMContentLoaded', function () {
    if (window.location.pathname === '/admin_dashboard') {
        initTrafficDashboard();
        loadTrafficData();
        initSyncButtons();
        loadSyncStatus();  // 🆕 載入上次同步狀態
    }
});

// 🆕 載入上次自動同步狀態
function loadSyncStatus() {
    const statusSpan = document.getElementById('last-sync-time');
    if (!statusSpan) return;

    fetch('/api/sync/delivery-to-excel/status')
        .then(response => response.json())
        .then(data => {
            if (data.last_sync_time) {
                const result = data.last_sync_result;
                const statusText = result && result.success
                    ? `上次同步：${data.last_sync_time} ✅ (${result.synced_count} 筆)`
                    : `上次同步：${data.last_sync_time} ❌ 失敗`;
                statusSpan.textContent = statusText;
            } else {
                statusSpan.textContent = '上次同步：尚未執行';
            }
        })
        .catch(() => {
            statusSpan.textContent = '上次同步：無法取得';
        });
}

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
                syncBtn.innerHTML = '📅 立即同步交期到缺料 Excel';
                // 🆕 同步後刷新狀態
                loadSyncStatus();
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

// ================= 流量統計（新分析系統 Phase 1） =================
let trendChart = null;
let pagesChart = null;

if (typeof Chart !== 'undefined') {
    // 深色主題相容
    Chart.defaults.color = '#c8c8c8';
    Chart.defaults.borderColor = 'rgba(128,128,128,0.25)';
}

function _localDateStr(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function _kpiCard(label, value) {
    return `<article style="margin:0;">
        <h3 style="font-size:0.85rem; margin:0 0 0.25em; color:var(--pico-muted-color);">${label}</h3>
        <p style="font-size:1.6rem; font-weight:600; margin:0;">${value}</p>
    </article>`;
}

async function loadTrafficDashboard() {
    const fromEl = document.getElementById('traffic-from');
    const toEl = document.getElementById('traffic-to');
    const kpiEl = document.getElementById('traffic-kpi');
    const labelEl = document.getElementById('traffic-range-label');
    const from = fromEl ? fromEl.value : '';
    const to = toEl ? toEl.value : '';
    const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    if (labelEl) labelEl.textContent = `${from} ~ ${to}`;
    try {
        const [kpiRes, trendRes, pagesRes] = await Promise.all([
            fetch(`/api/admin/analytics/dashboard?${qs}`),
            fetch(`/api/admin/analytics/trend?${qs}`),
            fetch(`/api/admin/analytics/pages?${qs}`)
        ]);
        if (!kpiRes.ok || !trendRes.ok || !pagesRes.ok) {
            throw new Error('HTTP ' + [kpiRes.status, trendRes.status, pagesRes.status].join('/'));
        }
        const kpi = await kpiRes.json();
        const trend = await trendRes.json();
        const pages = await pagesRes.json();

        if (kpiEl) {
            kpiEl.innerHTML = [
                _kpiCard('總瀏覽次數', kpi.total_views ?? 0),
                _kpiCard('獨立訪客 (UV)', kpi.unique_visitors ?? 0),
                _kpiCard('獨立 IP', kpi.unique_ips ?? 0),
                _kpiCard('瀏覽頁面數', kpi.page_count ?? 0),
                _kpiCard('活躍天數', kpi.active_days ?? 0)
            ].join('');
        }
        renderTrendChart(trend);
        renderPagesChart(pages);
        // Phase 2：熱圖 / 裝置排行 / 即時紀錄（獨立載入；失敗只缺該區段，不影響主儀表板）
        Promise.allSettled([
            fetch(`/api/admin/analytics/heatmap?${qs}`).then(r => r.ok ? r.json() : null),
            fetch(`/api/admin/analytics/users?${qs}`).then(r => r.ok ? r.json() : null),
            fetch('/api/admin/analytics/recent?limit=50').then(r => r.ok ? r.json() : null)
        ]).then(results => {
            const ok = x => (x && x.status === 'fulfilled') ? x.value : null;
            const hm = ok(results[0]);
            if (hm && Array.isArray(hm.matrix)) renderHeatmap(hm);
            const us = ok(results[1]);
            if (us) renderUsers(us);
            const rc = ok(results[2]);
            if (rc) renderRecent(rc);
        });
    } catch (error) {
        console.error('載入流量統計失敗:', error);
        if (kpiEl) {
            kpiEl.innerHTML = '<p style="grid-column:1/-1; color:var(--pico-color-danger, #d32f2f);">載入流量統計時發生錯誤。</p>';
        }
    }
}

function renderTrendChart(trend) {
    const canvas = document.getElementById('trend-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: trend.map(t => t.date.slice(5)),
            datasets: [
                            { label: '瀏覽次數', data: trend.map(t => t.views), tension: 0.25,
                              borderColor: 'rgba(26,155,196,1)', backgroundColor: 'rgba(26,155,196,0.15)' },
                            { label: '獨立訪客', data: trend.map(t => t.uv), tension: 0.25,
                              borderColor: 'rgba(255,193,7,1)', backgroundColor: 'rgba(255,193,7,0.15)' }
                        ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

function renderPagesChart(pages) {
    const canvas = document.getElementById('pages-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (pagesChart) pagesChart.destroy();
    pagesChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: pages.map(p => (p.page || '').replace('.html', '')),
                        datasets: [{ label: '瀏覽次數', data: pages.map(p => p.views),
                            backgroundColor: 'rgba(26,155,196,0.9)', hoverBackgroundColor: 'rgba(26,155,196,1)' }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

function _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHeatmap(data) {
    const el = document.getElementById('traffic-heatmap');
    if (!el || !data || !Array.isArray(data.matrix)) return;
    const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
    const max = Math.max(1, data.max || 0);
    let html = '<div></div>';
    for (let h = 0; h < 24; h++) {
        html += `<div style="font-size:0.7rem; color:var(--pico-muted-color); text-align:center;">${h}</div>`;
    }
    data.matrix.forEach((row, wd) => {
        html += `<div style="font-size:0.75rem; color:var(--pico-muted-color);">${weekdays[wd]}</div>`;
        row.forEach((c, h) => {
            const alpha = c === 0 ? 0 : 0.25 + 0.75 * (c / max);
            html += `<div title="${weekdays[wd]} ${String(h).padStart(2, '0')}:00 — ${c} 次浏览" style="height:18px; border-radius:3px; background:rgba(26,155,196,${alpha.toFixed(3)});"></div>`;
        });
    });
    el.innerHTML = html;
}

function renderUsers(data) {
    const el = document.getElementById('traffic-users-container');
    if (!el) return;
    if (!Array.isArray(data) || data.length === 0) {
        el.innerHTML = '<p>沒有紀錄。</p>';
        return;
    }
    let html = '<figure><table><thead><tr><th>裝置 (visitor_id)</th><th>帳號</th><th>瀏覽</th><th>頁面</th><th>最後活躍</th></tr></thead><tbody>';
    data.forEach(u => {
        html += `<tr>
            <td style="font-size:0.8em;">${_esc(u.visitor_id || '—')}</td>
            <td>${_esc(u.user_id || '—')}</td>
            <td>${u.views ?? 0}</td>
            <td>${u.pages ?? 0}</td>
            <td>${_esc(u.last_seen || '')}</td>
        </tr>`;
    });
    html += '</tbody></table></figure>';
    el.innerHTML = html;
}

function renderRecent(data) {
    const el = document.getElementById('traffic-recent-container');
    if (!el) return;
    if (!Array.isArray(data) || data.length === 0) {
        el.innerHTML = '<p>沒有紀錄。</p>';
        return;
    }
    let html = '<figure><table><thead><tr><th>時間（台北）</th><th>頁面</th><th>IP</th><th>帳號</th><th>裝置</th><th>瀏覽器</th></tr></thead><tbody>';
    data.forEach(r => {
        const bot = r.is_bot ? ' ⚠️' : '';
        const ua = (r.user_agent || '').slice(0, 40);
        html += `<tr>
            <td>${_esc(r.local_date || '')} ${String(r.local_hour ?? 0).padStart(2, '0')}:00</td>
            <td>${_esc(r.page || '')}</td>
            <td>${_esc(r.ip || '—')}</td>
            <td>${_esc(r.user_id || '—')}</td>
            <td style="font-size:0.8em;">${_esc(String(r.visitor_id || '—').slice(0, 14))}</td>
            <td style="font-size:0.8em;">${_esc(ua)}${bot}</td>
        </tr>`;
    });
    html += '</tbody></table></figure>';
    el.innerHTML = html;
}

function initTrafficDashboard() {
    const fromEl = document.getElementById('traffic-from');
    const toEl = document.getElementById('traffic-to');
    if (!fromEl || !toEl) return;
    const t = new Date();
    const d30 = new Date(t);
    d30.setDate(d30.getDate() - 29);
    toEl.value = _localDateStr(t);
    fromEl.value = _localDateStr(d30);
    const applyBtn = document.getElementById('traffic-apply-btn');
    if (applyBtn) applyBtn.addEventListener('click', loadTrafficDashboard);
    const btn30 = document.getElementById('traffic-30d-btn');
    if (btn30) {
        btn30.addEventListener('click', () => {
            const now = new Date();
            const d = new Date(now);
            d.setDate(d.getDate() - 29);
            toEl.value = _localDateStr(now);
            fromEl.value = _localDateStr(d);
            loadTrafficDashboard();
        });
    }
    loadTrafficDashboard();
}
