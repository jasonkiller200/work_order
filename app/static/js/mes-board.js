/**
 * MES 工單追蹤看板 JavaScript
 * 資料來源：machine_schedule (:5009) 的 /api/mes API（同機 192.168.6.119）
 * 功能：廠區/顯示模式/搜尋過濾、追蹤工單（新增/移除/切換）、立即同步、每 10 分鐘自動刷新
 */
(() => {
    'use strict';

    const API_BASE = 'http://192.168.6.119:5009/api/mes';

    const state = {
        tracked: new Set(),
        rows: [],
        intervalMs: 10 * 60 * 1000,
    };

    const els = {
        syncBtn: document.getElementById('btn-sync'),
        lastSync: document.getElementById('last-sync'),
        filterPlant: document.getElementById('filter-plant'),
        filterTrackingMode: document.getElementById('filter-tracking-mode'),
        filterSearch: document.getElementById('filter-search'),
        trackInput: document.getElementById('track-input'),
        trackAddBtn: document.getElementById('btn-track-add'),
        trackedList: document.getElementById('tracked-list'),
        tbody: document.getElementById('mes-table-body'),
        summary: document.getElementById('row-summary'),
    };

    function esc(text) {
        return (text === null || text === undefined ? '' : String(text)).replace(/[&<>"']/g, (m) => ({
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

    async function loadTracked() {
        const data = await api(`${API_BASE}/tracked-orders`);
        state.tracked = new Set(data.map(x => x.tracking_key));
        renderTrackedList();
    }

    function renderTrackedList() {
        if (state.tracked.size === 0) {
            els.trackedList.innerHTML = '<span class="mes-chip-empty">尚未設定追蹤工單</span>';
            return;
        }
        els.trackedList.innerHTML = [...state.tracked].sort().map((key) => `
            <button type="button" class="mes-chip" data-remove-track="${esc(key)}" title="點擊移除">
                <span>${esc(key)}</span>
                <span class="chip-x">✕</span>
            </button>
        `).join('');
    }

    function renderRows(rows) {
        if (!rows.length) {
            els.tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;opacity:.6">無符合資料</td></tr>';
            return;
        }

        const html = rows.map(r => {
            const trackedLabel = r.is_tracked ? '取消追蹤' : '追蹤';
            const trackedStyle = r.is_tracked
                ? 'background:#064e3b;border-color:#059669;color:#6ee7b7'
                : 'background:transparent;border-color:#334155;color:#cbd5e1';
            const abn = Number(r.abnormal_count || 0);
            const short = Number(r.shortage_count || 0);
            const abnHtml = abn > 0 ? `<span class="mes-count-warn">${abn}</span>` : esc(String(abn));
            const shortHtml = short > 0 ? `<span class="mes-count-warn">${short}</span>` : esc(String(short));

            return `
                <tr>
                    <td>
                        <button type="button" data-track="${esc(r.work_order_no_display)}"
                            style="padding:.15em .6em;font-size:.8em;border-radius:.4em;border:1px solid;cursor:pointer;${trackedStyle}">${trackedLabel}</button>
                    </td>
                    <td>${esc(r.customer_name)}</td>
                    <td>${esc(r.machine_model)}</td>
                    <td style="font-family:monospace">${esc(r.work_order_no_display)}</td>
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

    async function loadRows() {
        const params = new URLSearchParams({
            auto_sync: '1',
            plant: els.filterPlant.value,
            tracking_mode: els.filterTrackingMode.value,
            search: els.filterSearch.value.trim(),
        });

        const data = await api(`${API_BASE}/orders?${params.toString()}`);
        state.rows = data.rows || [];
        renderRows(state.rows);
        els.summary.textContent = `${data.count || 0} 筆（追蹤 ${data.tracked_count || 0} 筆）`;

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

    async function addTrack() {
        const value = els.trackInput.value.trim();
        if (!value) return;
        try {
            await api(`${API_BASE}/tracked-orders`, {
                method: 'POST',
                body: JSON.stringify({ work_order_no: value }),
            });
            els.trackInput.value = '';
            await loadTracked();
            await loadRows();
        } catch (e) {
            alert(`新增追蹤失敗: ${e.message}`);
        }
    }

    async function removeTrack(trackingKey) {
        try {
            await api(`${API_BASE}/tracked-orders/${encodeURIComponent(trackingKey)}`, { method: 'DELETE' });
            await loadTracked();
            await loadRows();
        } catch (e) {
            alert(`移除追蹤失敗: ${e.message}`);
        }
    }

    async function toggleRowTrack(trackingKey) {
        if (state.tracked.has(trackingKey)) {
            await removeTrack(trackingKey);
            return;
        }
        try {
            await api(`${API_BASE}/tracked-orders`, {
                method: 'POST',
                body: JSON.stringify({ work_order_no: trackingKey }),
            });
            await loadTracked();
            await loadRows();
        } catch (e) {
            alert(`設定追蹤失敗: ${e.message}`);
        }
    }

    function bindEvents() {
        els.syncBtn.addEventListener('click', forceSync);
        els.trackAddBtn.addEventListener('click', addTrack);
        els.trackInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addTrack();
        });

        [els.filterPlant, els.filterTrackingMode].forEach(el => {
            el.addEventListener('change', loadRows);
        });

        let searchTimer = null;
        els.filterSearch.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(loadRows, 300);
        });

        els.trackedList.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-remove-track]');
            if (!btn) return;
            removeTrack(btn.getAttribute('data-remove-track'));
        });

        els.tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-track]');
            if (!btn) return;
            toggleRowTrack(btn.getAttribute('data-track'));
        });
    }

    async function init() {
        bindEvents();
        try {
            await loadTracked();
            await loadRows();
        } catch (e) {
            els.tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:#f87171">載入失敗: ${esc(e.message)}（請確認 192.168.6.119:5009 服務正常）</td></tr>`;
            return;
        }
        setInterval(loadRows, state.intervalMs);
    }

    init();
})();