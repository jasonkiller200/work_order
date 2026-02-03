/**
 * 台灣假日工具模組
 * 提供假日資料載入與日期選擇器整合功能
 */

const HolidayUtils = (function() {
    // 快取假日資料
    let holidayCache = {};
    let holidayDatesSet = new Set();
    let isInitialized = false;
    let initPromise = null;
    
    /**
     * 載入指定年份範圍的假日資料
     * @param {number} startYear - 起始年份
     * @param {number} endYear - 結束年份
     * @returns {Promise<Array>} 假日清單
     */
    async function loadHolidays(startYear, endYear) {
        const cacheKey = `${startYear}-${endYear}`;
        
        // 檢查快取
        if (holidayCache[cacheKey]) {
            return holidayCache[cacheKey];
        }
        
        try {
            const response = await fetch(`/api/holidays/${startYear}/${endYear}`);
            const data = await response.json();
            
            if (data.success) {
                // 儲存到快取
                holidayCache[cacheKey] = data.holidays;
                
                // 更新日期集合（用於快速查詢）
                data.holidays.forEach(h => holidayDatesSet.add(h.date));
                
                console.log(`[HolidayUtils] 已載入 ${data.holidays.length} 個假日 (${startYear}-${endYear})`);
                return data.holidays;
            } else {
                console.error('[HolidayUtils] 載入假日資料失敗:', data.error);
                return [];
            }
        } catch (error) {
            console.error('[HolidayUtils] 載入假日資料錯誤:', error);
            return [];
        }
    }
    
    /**
     * 檢查日期是否為假日
     * @param {Date|string} date - 日期
     * @returns {boolean} 是否為假日
     */
    function isHoliday(date) {
        if (!isInitialized) {
            // 如果還沒初始化，先嘗試同步初始化
            ensureInitialized();
        }
        
        const dateStr = date instanceof Date 
            ? formatDate(date)
            : date;
        return holidayDatesSet.has(dateStr);
    }
    
    /**
     * 格式化日期為 YYYY-MM-DD
     * @param {Date} date 
     * @returns {string}
     */
    function formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    /**
     * 檢查日期是否為週末
     * @param {Date} date - 日期
     * @returns {boolean} 是否為週末
     */
    function isWeekend(date) {
        const day = date.getDay();
        return day === 0 || day === 6;
    }
    
    /**
     * 檢查日期是否為非工作日（週末或假日）
     * @param {Date} date - 日期
     * @returns {boolean} 是否為非工作日
     */
    function isNonWorkingDay(date) {
        return isWeekend(date) || isHoliday(date);
    }
    
    /**
     * 取得假日名稱
     * @param {Date|string} date - 日期
     * @returns {string|null} 假日名稱，若非假日則回傳 null
     */
    function getHolidayName(date) {
        const dateStr = date instanceof Date 
            ? formatDate(date)
            : date;
        
        // 從快取中搜尋
        for (const key in holidayCache) {
            const holiday = holidayCache[key].find(h => h.date === dateStr);
            if (holiday) {
                return holiday.name;
            }
        }
        return null;
    }
    
    /**
     * 確保假日資料已初始化（同步版本，用於快速檢查）
     */
    function ensureInitialized() {
        if (!isInitialized && !initPromise) {
            // 啟動初始化
            initPromise = init();
        }
    }
    
    /**
     * 初始化並載入當年與明年的假日資料
     * @returns {Promise<void>}
     */
    async function init() {
        if (isInitialized) return;
        
        const currentYear = new Date().getFullYear();
        await loadHolidays(currentYear, currentYear + 1);
        isInitialized = true;
        console.log('[HolidayUtils] 初始化完成');
    }
    
    /**
     * 等待初始化完成
     * @returns {Promise<void>}
     */
    async function waitForInit() {
        if (isInitialized) return;
        if (initPromise) {
            await initPromise;
        } else {
            await init();
        }
    }
    
    /**
     * 檢查是否已初始化
     * @returns {boolean}
     */
    function isReady() {
        return isInitialized;
    }
    
    /**
     * 取得已載入的假日日期陣列
     * @returns {Array<string>} 假日日期字串陣列
     */
    function getHolidayDates() {
        return Array.from(holidayDatesSet);
    }
    
    // 公開 API
    return {
        init,
        waitForInit,
        isReady,
        loadHolidays,
        isHoliday,
        isWeekend,
        isNonWorkingDay,
        getHolidayName,
        getHolidayDates
    };
})();

// 頁面載入時立即初始化（不等待 DOMContentLoaded）
HolidayUtils.init();
