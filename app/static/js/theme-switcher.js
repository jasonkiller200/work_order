/**
 * 主題切換器
 * 支援亮色、暗色、高對比等多種主題
 */

// 主題配置
const THEMES = {
    LIGHT: 'light',
    DARK: 'dark',
    // 未來可擴展更多主題
    // HIGH_CONTRAST: 'high-contrast',
    // EYE_CARE: 'eye-care'
};

// 本地儲存鍵名
const THEME_STORAGE_KEY = 'app-theme';

// 主題管理類
class ThemeManager {
    constructor() {
        this.currentTheme = this.loadTheme();
        this.applyTheme(this.currentTheme);
    }

    /**
     * 從 localStorage 載入主題設定
     */
    loadTheme() {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        
        // 如果沒有儲存的主題，使用系統偏好
        if (!savedTheme) {
            return this.getSystemPreference();
        }
        
        return savedTheme;
    }

    /**
     * 獲取系統主題偏好
     */
    getSystemPreference() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return THEMES.DARK;
        }
        return THEMES.LIGHT;
    }

    /**
     * 應用主題
     */
    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        this.currentTheme = theme;
        localStorage.setItem(THEME_STORAGE_KEY, theme);
        
        // 觸發自訂事件,讓其他模組知道主題已變更
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
    }

    /**
     * 切換主題
     */
    toggleTheme() {
        const newTheme = this.currentTheme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
        this.applyTheme(newTheme);
        return newTheme;
    }

    /**
     * 設定特定主題
     */
    setTheme(theme) {
        if (Object.values(THEMES).includes(theme)) {
            this.applyTheme(theme);
        } else {
            console.warn(`Unknown theme: ${theme}`);
        }
    }

    /**
     * 獲取當前主題
     */
    getCurrentTheme() {
        return this.currentTheme;
    }
}

// 初始化主題管理器
const themeManager = new ThemeManager();

// 監聽系統主題變更
if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        // 只有當用戶沒有手動設定主題時才自動切換
        if (!localStorage.getItem(THEME_STORAGE_KEY)) {
            const newTheme = e.matches ? THEMES.DARK : THEMES.LIGHT;
            themeManager.applyTheme(newTheme);
        }
    });
}

// 導出到全域
window.themeManager = themeManager;
window.THEMES = THEMES;

// 使用範例:
// themeManager.toggleTheme();  // 切換亮/暗模式
// themeManager.setTheme('dark');  // 設定為暗黑模式
// themeManager.getCurrentTheme();  // 獲取當前主題
