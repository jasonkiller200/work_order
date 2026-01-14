/**
 * 快取狀態檢查與自動刷新模組
 * 可在任何頁面引入，提供快取狀態顯示和自動刷新功能
 */

// 快取版本追蹤
let lastKnownCacheUpdateTime = null;
let cacheRefreshInterval = null;
let pendingCacheUpdate = false;

/**
 * 檢查 API 狀態並更新狀態列
 */
function checkApiStatus() {
    const badge = document.querySelector('.status-indicator');
    const badgeText = document.getElementById('status-badge-text');

    // 如果頁面沒有這些元素，直接返回
    if (!badge || !badgeText) return;

    fetch('/api/status')
        .then(response => response.json())
        .then(data => {
            if (data.service_status === 'online' && data.data_loaded) {
                // 正常狀態 - 綠色
                badge.className = 'status-indicator';
                // 顯示快取和下次更新時間
                let statusText = `✅ 快取: ${data.live_cache}`;
                if (data.next_update_time) {
                    statusText += ` | 下次更新: ${data.next_update_time}`;
                }
                badgeText.textContent = statusText;
            } else if (data.service_status === 'online' && !data.data_loaded) {
                // 服務正常但資料未載入 - 橙色
                badge.className = 'status-indicator loading';
                badgeText.textContent = '⚠️ 資料載入中';
            } else {
                // 服務異常 - 紅色
                badge.className = 'status-indicator error';
                badgeText.textContent = '❌ 服務異常';
            }
        })
        .catch(error => {
            console.error('Error fetching status:', error);
            if (badge) badge.className = 'status-indicator error';
            if (badgeText) badgeText.textContent = '❌ 連線失敗';
        });
}

/**
 * 啟動快取自動刷新機制
 * - 每 60 秒檢查一次快取是否更新
 * - 若有更新且無 Modal 開啟，顯示刷新通知
 */
function startCacheAutoRefresh() {
    console.log('🔄 啟動快取自動刷新機制');

    // 初始化：記錄當前的快取更新時間
    fetch('/api/status')
        .then(res => res.json())
        .then(data => {
            lastKnownCacheUpdateTime = data.last_update_time;
            console.log('📌 初始快取版本:', lastKnownCacheUpdateTime);
        })
        .catch(err => console.error('❌ 初始化快取版本失敗:', err));

    // 每 60 秒檢查一次
    cacheRefreshInterval = setInterval(checkCacheUpdate, 60000);
}

/**
 * 檢查快取是否已更新
 */
function checkCacheUpdate() {
    fetch('/api/status')
        .then(res => res.json())
        .then(data => {
            const newUpdateTime = data.last_update_time;

            // 如果快取時間有變化
            if (lastKnownCacheUpdateTime && newUpdateTime !== lastKnownCacheUpdateTime) {
                console.log('🔔 偵測到快取更新:', lastKnownCacheUpdateTime, '→', newUpdateTime);

                // 更新狀態列
                checkApiStatus();

                // 檢查是否有 Modal 開啟中
                if (isAnyModalOpen()) {
                    console.log('⏸️ Modal 開啟中，顯示刷新提示');
                    pendingCacheUpdate = true;
                    showCacheUpdateNotification();
                } else {
                    // 無 Modal，顯示刷新提示
                    console.log('📢 顯示資料更新通知');
                    showCacheUpdateNotification();
                }

                lastKnownCacheUpdateTime = newUpdateTime;
            }
        })
        .catch(err => console.error('❌ 檢查快取更新失敗:', err));
}

/**
 * 檢查是否有任何 Modal/Dialog 開啟中
 */
function isAnyModalOpen() {
    const dialogs = document.querySelectorAll('dialog[open]');
    if (dialogs.length > 0) return true;

    const overlays = document.querySelectorAll('[style*="position: fixed"][style*="z-index: 9999"]');
    if (overlays.length > 0) return true;

    return false;
}

/**
 * 顯示快取更新通知
 */
function showCacheUpdateNotification() {
    if (document.getElementById('cache-update-notification')) return;

    const notification = document.createElement('div');
    notification.id = 'cache-update-notification';
    notification.style.cssText = `
        position: fixed; top: 70px; right: 20px;
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        color: white; padding: 12px 20px; border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10000;
        font-size: 0.9em; display: flex; align-items: center; gap: 12px;
    `;
    notification.innerHTML = `
        <span>🔄 資料已更新</span>
        <button onclick="location.reload()" style="background: white; color: #2563eb; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-weight: bold;">刷新頁面</button>
        <button onclick="this.parentElement.remove()" style="background: transparent; color: white; border: none; cursor: pointer; font-size: 1.2em;">✕</button>
    `;
    document.body.appendChild(notification);
    setTimeout(() => { if (notification.parentElement) notification.remove(); }, 30000);
}

// 頁面載入後自動初始化
document.addEventListener('DOMContentLoaded', function () {
    checkApiStatus();
    startCacheAutoRefresh();
});
