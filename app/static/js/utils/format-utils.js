/**
 * 格式化工具函數
 * 統一處理數字、文字等格式化需求
 */

const FormatUtils = {
    /**
     * 格式化數字（加上千分位）
     * @param {number} num - 要格式化的數字
     * @param {number} decimals - 小數位數，預設 0
     * @returns {string} 格式化後的字串
     */
    formatNumber(num, decimals = 0) {
        if (num === null || num === undefined || isNaN(num)) {
            return '0';
        }
        return Number(num).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },

    /**
     * 格式化百分比
     * @param {number} value - 數值
     * @param {number} total - 總數
     * @param {number} decimals - 小數位數
     * @returns {string} 百分比字串
     */
    formatPercentage(value, total, decimals = 1) {
        if (!total || total === 0) return '0%';
        const percent = (value / total) * 100;
        return `${percent.toFixed(decimals)}%`;
    },

    /**
     * 格式化缺料數量（帶正負號和顏色類別）
     * @param {number} shortage - 缺料數量
     * @returns {object} { text: string, class: string }
     */
    formatShortage(shortage) {
        if (shortage > 0) {
            return {
                text: `+${this.formatNumber(shortage)}`,
                class: 'surplus'
            };
        } else if (shortage < 0) {
            return {
                text: this.formatNumber(shortage),
                class: 'shortage'
            };
        } else {
            return {
                text: '0',
                class: 'balanced'
            };
        }
    },

    /**
     * 截斷文字（超過長度顯示...）
     * @param {string} text - 文字
     * @param {number} maxLength - 最大長度
     * @returns {string} 截斷後的文字
     */
    truncateText(text, maxLength = 50) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    },

    /**
     * 清理並標準化字串（去除多餘空白）
     * @param {string} str - 輸入字串
     * @returns {string} 清理後的字串
     */
    cleanString(str) {
        if (!str) return '';
        return str.toString().trim().replace(/\s+/g, ' ');
    },

    /**
     * 安全地取得物件屬性值
     * @param {object} obj - 物件
     * @param {string} path - 屬性路徑，如 'a.b.c'
     * @param {*} defaultValue - 預設值
     * @returns {*} 屬性值或預設值
     */
    safeGet(obj, path, defaultValue = null) {
        try {
            return path.split('.').reduce((current, prop) => current?.[prop], obj) ?? defaultValue;
        } catch {
            return defaultValue;
        }
    },

    /**
     * 格式化物料編號（統一格式）
     * @param {string} materialId - 物料編號
     * @returns {string} 格式化後的物料編號
     */
    formatMaterialId(materialId) {
        if (!materialId) return '';
        return materialId.toString().trim().toUpperCase();
    }
};

// 全域暴露
window.FormatUtils = FormatUtils;

// ES6 模組匯出（未來使用）
// export default FormatUtils;
