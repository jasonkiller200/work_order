/**
 * 通知服務
 * 統一管理所有通知（Toast、確認對話框等）
 */

class NotificationService {
    constructor() {
        this.toastContainer = null;
        this.initStyles();
    }

    /**
     * 初始化 Toast 動畫樣式
     */
    initStyles() {
        if (document.getElementById('toast-animation-style')) return;

        const style = document.createElement('style');
        style.id = 'toast-animation-style';
        style.textContent = `
            @keyframes slideInRight {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOutRight {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(400px);
                    opacity: 0;
                }
            }
            .toast-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 1em 1.5em;
                border-radius: 4px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                z-index: 10000;
                font-weight: bold;
                max-width: 400px;
                animation: slideInRight 0.3s ease-out;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 顯示 Toast 通知
     * @param {string} message - 訊息內容
     * @param {string} type - 類型：success, error, warning, info
     * @param {number} duration - 顯示時長（毫秒），預設 3000
     */
    showToast(message, type = 'info', duration = 3000) {
        // 移除舊的 toast
        const existingToast = document.querySelector('.toast-notification');
        if (existingToast) {
            existingToast.remove();
        }

        // 建立新的 toast
        const toast = document.createElement('div');
        toast.className = 'toast-notification';

        // 設定顏色
        const colors = {
            'success': '#4caf50',
            'error': '#f44336',
            'info': '#2196f3',
            'warning': '#ff9800'
        };
        const bgColor = colors[type] || colors.info;

        toast.style.backgroundColor = bgColor;
        toast.style.color = 'white';
        toast.textContent = message;

        document.body.appendChild(toast);

        // 自動移除
        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease-in';
            setTimeout(() => {
                if (toast.parentNode) {
                    document.body.removeChild(toast);
                }
            }, 300);
        }, duration);
    }

    /**
     * 顯示成功訊息
     */
    success(message, duration = 3000) {
        this.showToast(message, 'success', duration);
    }

    /**
     * 顯示錯誤訊息
     */
    error(message, duration = 3000) {
        this.showToast(message, 'error', duration);
    }

    /**
     * 顯示警告訊息
     */
    warning(message, duration = 3000) {
        this.showToast(message, 'warning', duration);
    }

    /**
     * 顯示資訊訊息
     */
    info(message, duration = 3000) {
        this.showToast(message, 'info', duration);
    }

    /**
     * 顯示確認對話框
     * @param {string} message - 訊息內容
     * @returns {boolean} - 使用者是否確認
     */
    confirm(message) {
        return window.confirm(message);
    }

    /**
     * 顯示輸入對話框
     * @param {string} message - 訊息內容
     * @param {string} defaultValue - 預設值
     * @returns {string|null} - 使用者輸入的值或 null
     */
    prompt(message, defaultValue = '') {
        return window.prompt(message, defaultValue);
    }

    /**
     * 顯示載入中訊息
     * @param {string} message - 訊息內容
     * @returns {Function} - 關閉載入中訊息的函數
     */
    showLoading(message = '載入中...') {
        const loadingToast = document.createElement('div');
        loadingToast.className = 'toast-notification loading-toast';
        loadingToast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1em 1.5em;
            background: #2196f3;
            color: white;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            font-weight: bold;
            max-width: 400px;
        `;
        loadingToast.innerHTML = `
            <span style="display: inline-block; margin-right: 0.5em;">⏳</span>
            <span>${message}</span>
        `;

        document.body.appendChild(loadingToast);

        // 返回關閉函數
        return () => {
            if (loadingToast.parentNode) {
                document.body.removeChild(loadingToast);
            }
        };
    }
}

// 建立全域實例
window.notificationService = new NotificationService();

// 為了向後兼容，保留舊的 showToast 函數
window.showToast = (message, type, duration) => {
    window.notificationService.showToast(message, type, duration);
};

// 也可以這樣使用（ES6 export）
// export default new NotificationService();
