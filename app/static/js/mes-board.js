/**
 * MES 工單追蹤看板 JavaScript
 * 資料來源：machine_schedule (:5009) 的 /api/mes API（同機 192.168.6.119）
 * 功能：廠區/搜尋過濾、標題欄位排序、立即同步、每 10 分鐘自動刷新
 */
(() => {
    'use strict';

    const API_BASE = 'http://192.168.6.119:5009/api/mes';

    const state = {
        rows: [],
        intervalMs: 10 * 60 * 1000,
        sortKey: null,
        sortDir: 'asc',
    };

    const els = {
        syncBtn: document.getElementById('btn-sync'),
        lastSync: document.getElementById('last-sync'),
        filterPlant: document.getElementById('filter-plant'),
        filterSearch: document.getElementById('filter-search'),
        tbody: document.getElementById('mes-table-body'),
        summary: document.getElementById('row-summary'),
        theadRow: document.querySelector('#mes-table thead tr'),
    };

    // 需數值排序的欄位
    const NUMERIC_KEYS = new Set(['abnormal_count', 'shortage_count']);

    function esc(text) {
        return (text === null || text === undefined ? '' : String(text)).replace(/[&<>\"']/g, (m) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[m]));
    }

    async function api(url, options = {}) {
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
    }

    function getSortedRows() {
        if (!state.sortKey) return state.rows;
        const key = state.sortKey;
        const dir = state.sortDir === 'asc' ? 1 : -1;
        const isNum = NUMERIC_KEYS.has(key);
        return [...state.rows].sort((a, b) => {
            let av = a[key];
            let bv = b[key];
            if (isNum) {
                return (Number(av || 0) - Number(bv || 0)) * dir;
            }
            av = av === null || av === undefined ? '' : String(av);
            bv = bv === null || bv === undefined ? '' : String(bv);
            // 純數字字串（工單/訂單編號）按數值比較
            if (/^\d+$/.test(av) && /^\d+$/.test(bv)) {
                return (Number(av) - Number(bv)) * dir;
            }
            // 空值一律排最後
            if (av === '' && bv !== '') return 1;
            if (bv === '' && av !== '') return -1;
            return av.localeCompare(bv, 'zh-TW') * dir;
        });
    }

    function renderRows() {
        const rows = getSortedRows();
        if (!rows.length) {
            els.tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;opacity:.6">無符合資料</td></tr>';
            return;
        }

        const html = rows.map(r => {
            const abn = Number(r.abnormal_count || 0);
            const short = Number(r.shortage_count || 0);
            const abnHtml = abn > 0 ? `<span class="mes-count-warn">${abn}</span>` : esc(String(abn));
            const shortHtml = short > 0 ? `<span class="mes-count-warn">${short}</span>` : esc(String(short));

            return `
                <tr>
                    <td style="font-family:monospace">${esc(r.work_order_no_display)}</td>
                    <td>${esc(r.machine_model)}</td>
                    <td>${esc(r.customer_name)}</td>
                    <td>${esc(r.order_no)}</td>
                    <td>${esc(r.order_ship_date)}</td>
                    <td>${esc(r.standard_process)}</td>
                    <td>${esc(r.current_process)}</td>
                    <td>${esc(r.process_progress)}</td>
                    <td>${abnHtml}</td>
                    <td>${shortHtml}</td>
                    <td>${esc(r.machine_location)}</td>
                </tr>
            `;
        }).join('');

        els.tbody.innerHTML = html;
    }

    function updateSortIndicators() {
        els.theadRow.querySelectorAll('th[data-sort] .mes-sort-ind').forEach(ind => {
            ind.classList.remove('asc', 'desc');
        });
        if (!state.sortKey) return;
        const ind = els.theadRow.querySelector(`th[data-sort="${state.sortKey}"] .mes-sort-ind`);
        if (ind) ind.classList.add(state.sortDir);
    }

    function setSort(key) {
        if (state.sortKey === key) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            state.sortKey = key;
            state.sortDir = 'asc';
        }
        updateSortIndicators();
        renderRows();
    }

    async function loadRows() {
        const params = new URLSearchParams({
            auto_sync: '1',
            plant: els.filterPlant.value,
            search: els.filterSearch.value.trim(),
        });

        const data = await api(`${API_BASE}/orders?${params.toString()}`);
        state.rows = data.rows || [];
        renderRows();
        els.summary.textContent = `${data.count || 0} 筆`;

        if (data.sync && data.sync.last_synced_at) {
            const t = new Date(data.sync.last_synced_at + 'Z');
            const timeStr = t.toLocaleString('zh-TW');
            const src = data.sync.last_source || '';
            const isRemote = src.startsWith('http');
            const srcLabel = isRemote ? '遠端' : (src ? '本地備援' : '未知');
            const errMsg = data.sync.last_error;
            if (errMsg) {
                els.lastSync.innerHTML = `最後同步: ${timeStr} · <span class="err">同步失敗: ${esc(errMsg)}</span>`;
            } else {
                els.lastSync.innerHTML = `最後同步: ${timeStr} · <span style="color:${isRemote ? '#34d399' : '#fbbf24'}">${srcLabel}</span> · ${data.sync.last_source_rows || 0} 筆`;
            }
        }
    }

    async function forceSync() {
        els.syncBtn.disabled = true;
        const oldText = els.syncBtn.textContent;
        els.syncBtn.textContent = '同步中...';
        try {
            await api(`${API_BASE}/sync?force=1`, { method: 'POST' });
            await loadRows();
        } catch (e) {
            alert(`同步失敗: ${e.message}`);
        } finally {
            els.syncBtn.disabled = false;
            els.syncBtn.textContent = oldText;
        }
    }

    function bindEvents() {
        els.syncBtn.addEventListener('click', forceSync);
        els.filterPlant.addEventListener('change', loadRows);

        let searchTimer = null;
        els.filterSearch.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(loadRows, 300);
        });

        // 標題欄位排序
        els.theadRow.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => setSort(th.getAttribute('data-sort')));
        });
    }

    async function init() {
        bindEvents();
        try {
            await loadRows();
        } catch (e) {
            els.tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:#f87171">載入失敗: ${esc(e.message)}（請確認 192.168.6.119:5009 服務正常）</td></tr>`;
            return;
        }
        setInterval(loadRows, state.intervalMs);
    }

    init();
})();