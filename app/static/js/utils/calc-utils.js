/**
 * 計算工具函數
 * 統一處理各種業務邏輯計算
 */

const CalcUtils = {
    /**
     * 計算缺料數量
     * @param {number} demand - 需求數量
     * @param {number} stock - 庫存數量
     * @param {number} onOrder - 在單數量
     * @returns {number} 缺料數量（負數表示缺料）
     */
    calculateShortage(demand, stock, onOrder = 0) {
        const totalAvailable = (stock || 0) + (onOrder || 0);
        return totalAvailable - (demand || 0);
    },

    /**
     * 計算總需求數量
     * @param {Array} items - 項目陣列
     * @param {string} key - 需求數量的鍵名
     * @returns {number} 總需求
     */
    calculateTotalDemand(items, key = '未結數量 (EINHEIT)') {
        if (!Array.isArray(items)) return 0;
        return items.reduce((sum, item) => sum + (parseFloat(item[key]) || 0), 0);
    },

    /**
     * 計算總庫存
     * @param {number} unrestricted - 非限制庫存
     * @param {number} inspection - 品檢中庫存
     * @returns {number} 總庫存
     */
    calculateTotalStock(unrestricted, inspection) {
        return (unrestricted || 0) + (inspection || 0);
    },

    /**
     * 計算缺料率
     * @param {number} shortageCount - 缺料項目數
     * @param {number} totalCount - 總項目數
     * @returns {number} 缺料率（0-100）
     */
    calculateShortageRate(shortageCount, totalCount) {
        if (!totalCount || totalCount === 0) return 0;
        return (shortageCount / totalCount) * 100;
    },

    /**
     * 判斷是否為缺料項目
     * @param {object} item - 物料項目
     * @returns {boolean} 是否缺料
     */
    isShortage(item) {
        if (!item) return false;
        const shortage = this.calculateShortage(
            item['total_demand'] || 0,
            item['unrestricted_stock'] || 0,
            item['on_order_stock'] || 0
        );
        return shortage < 0;
    },

    /**
     * 計算填補率（已採購 / 缺料）
     * @param {number} shortage - 缺料數量（負數）
     * @param {number} onOrder - 在單數量
     * @returns {number} 填補率（0-100）
     */
    calculateFillRate(shortage, onOrder) {
        if (!shortage || shortage >= 0) return 100;
        const shortageAbs = Math.abs(shortage);
        if (shortageAbs === 0) return 100;
        const fillRate = ((onOrder || 0) / shortageAbs) * 100;
        return Math.min(fillRate, 100);
    },

    /**
     * 計算採購優先級（基於缺料程度和交期）
     * @param {number} shortage - 缺料數量
     * @param {string} deliveryDate - 交期日期
     * @returns {number} 優先級分數（越高越優先）
     */
    calculatePriority(shortage, deliveryDate) {
        let score = 0;
        
        // 缺料程度評分
        if (shortage < 0) {
            const shortageAbs = Math.abs(shortage);
            if (shortageAbs > 1000) score += 50;
            else if (shortageAbs > 100) score += 30;
            else if (shortageAbs > 10) score += 15;
            else score += 5;
        }
        
        // 交期緊急度評分
        if (deliveryDate && DateUtils.isValidDate(deliveryDate)) {
            const daysUntil = DateUtils.daysDifference(new Date(deliveryDate), new Date());
            if (daysUntil < 0) score += 50; // 已過期
            else if (daysUntil <= 3) score += 40;
            else if (daysUntil <= 7) score += 30;
            else if (daysUntil <= 14) score += 20;
            else if (daysUntil <= 30) score += 10;
        }
        
        return score;
    },

    /**
     * 安全的數字相加
     * @param  {...any} numbers - 數字參數
     * @returns {number} 總和
     */
    safeAdd(...numbers) {
        return numbers.reduce((sum, num) => sum + (parseFloat(num) || 0), 0);
    },

    /**
     * 安全的數字相減
     * @param {number} a - 被減數
     * @param {number} b - 減數
     * @returns {number} 差
     */
    safeSubtract(a, b) {
        return (parseFloat(a) || 0) - (parseFloat(b) || 0);
    },

    /**
     * 安全的數字相乘
     * @param {number} a - 乘數
     * @param {number} b - 乘數
     * @returns {number} 積
     */
    safeMultiply(a, b) {
        return (parseFloat(a) || 0) * (parseFloat(b) || 0);
    },

    /**
     * 安全的數字相除
     * @param {number} a - 被除數
     * @param {number} b - 除數
     * @param {number} defaultValue - 除數為 0 時的預設值
     * @returns {number} 商
     */
    safeDivide(a, b, defaultValue = 0) {
        const divisor = parseFloat(b) || 0;
        if (divisor === 0) return defaultValue;
        return (parseFloat(a) || 0) / divisor;
    },

    /**
     * 計算百分比變化
     * @param {number} oldValue - 舊值
     * @param {number} newValue - 新值
     * @returns {number} 變化百分比
     */
    calculatePercentageChange(oldValue, newValue) {
        if (!oldValue || oldValue === 0) return 0;
        return ((newValue - oldValue) / oldValue) * 100;
    }
};

// 全域暴露
window.CalcUtils = CalcUtils;

// ES6 模組匯出（未來使用）
// export default CalcUtils;
