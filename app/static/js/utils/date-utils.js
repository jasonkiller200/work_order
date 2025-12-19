/**
 * 日期工具函數
 * 統一處理日期格式化、計算等需求
 */

const DateUtils = {
    /**
     * 格式化日期為 YYYY-MM-DD
     * @param {Date|string} date - 日期物件或字串
     * @returns {string} 格式化後的日期字串
     */
    formatDate(date) {
        if (!date) return '';
        const d = new Date(date);
        if (isNaN(d.getTime())) return '';
        
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    /**
     * 格式化日期為 YYYY/MM/DD
     * @param {Date|string} date - 日期物件或字串
     * @returns {string} 格式化後的日期字串
     */
    formatDateSlash(date) {
        return this.formatDate(date).replace(/-/g, '/');
    },

    /**
     * 格式化日期時間為 YYYY-MM-DD HH:mm:ss
     * @param {Date|string} date - 日期物件或字串
     * @returns {string} 格式化後的日期時間字串
     */
    formatDateTime(date) {
        if (!date) return '';
        const d = new Date(date);
        if (isNaN(d.getTime())) return '';
        
        const dateStr = this.formatDate(d);
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        return `${dateStr} ${hours}:${minutes}:${seconds}`;
    },

    /**
     * 計算兩個日期之間的天數差
     * @param {Date|string} date1 - 第一個日期
     * @param {Date|string} date2 - 第二個日期
     * @returns {number} 天數差（date1 - date2）
     */
    daysDifference(date1, date2) {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
        
        const diffTime = d1.getTime() - d2.getTime();
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    },

    /**
     * 判斷日期是否已過期
     * @param {Date|string} date - 要檢查的日期
     * @param {number} graceDays - 寬限天數（預設 0）
     * @returns {boolean} 是否過期
     */
    isOverdue(date, graceDays = 0) {
        if (!date) return false;
        const targetDate = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        targetDate.setHours(0, 0, 0, 0);
        
        const diffDays = this.daysDifference(today, targetDate);
        return diffDays > graceDays;
    },

    /**
     * 判斷日期是否在指定天數內
     * @param {Date|string} date - 要檢查的日期
     * @param {number} days - 天數
     * @returns {boolean} 是否在範圍內
     */
    isWithinDays(date, days) {
        if (!date) return false;
        const diff = this.daysDifference(new Date(date), new Date());
        return diff >= 0 && diff <= days;
    },

    /**
     * 取得今天的日期字串
     * @returns {string} YYYY-MM-DD 格式
     */
    getToday() {
        return this.formatDate(new Date());
    },

    /**
     * 加減天數
     * @param {Date|string} date - 基準日期
     * @param {number} days - 要加減的天數（負數為減）
     * @returns {string} 新的日期字串 YYYY-MM-DD
     */
    addDays(date, days) {
        const d = new Date(date);
        if (isNaN(d.getTime())) return '';
        d.setDate(d.getDate() + days);
        return this.formatDate(d);
    },

    /**
     * 解析日期字串為 Date 物件
     * @param {string} dateStr - 日期字串（支援多種格式）
     * @returns {Date|null} Date 物件或 null
     */
    parseDate(dateStr) {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d;
    },

    /**
     * 格式化相對時間（如：3 天前）
     * @param {Date|string} date - 日期
     * @returns {string} 相對時間描述
     */
    formatRelativeTime(date) {
        const d = new Date(date);
        if (isNaN(d.getTime())) return '';
        
        const diffDays = this.daysDifference(new Date(), d);
        
        if (diffDays === 0) return '今天';
        if (diffDays === 1) return '昨天';
        if (diffDays === -1) return '明天';
        if (diffDays > 0) return `${diffDays} 天前`;
        return `${Math.abs(diffDays)} 天後`;
    },

    /**
     * 判斷是否為有效日期
     * @param {*} date - 要檢查的值
     * @returns {boolean} 是否為有效日期
     */
    isValidDate(date) {
        if (!date) return false;
        const d = new Date(date);
        return !isNaN(d.getTime());
    }
};

// 全域暴露
window.DateUtils = DateUtils;

// ES6 模組匯出（未來使用）
// export default DateUtils;
