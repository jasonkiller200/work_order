/**
 * 採購儀表板模組
 * 負責採購儀表板的初始化、資料載入、篩選和頁籤切換
 */

class ProcurementDashboard {
    constructor() {
        this.allDeliveryData = {};
        this.currentMaterialsData = [];
        this.currentFinishedMaterialsData = [];
        this.currentDashboardType = 'main';
        this.currentFilterKeyword = '';
        this.currentBuyerKeyword = '';
        this.currentQuickFilter = null; // 新增：快速篩選狀態
        this.mainDashboardItemsPerPage = 50;
        this.finishedDashboardItemsPerPage = 50;
        this.mainDashboardPage = 1;
        this.finishedDashboardPage = 1;
    }

    /**
     * 初始化儀表板
     */
    async initialize() {
        // 初始化自動清理按鈕狀態
        if (typeof initAutoClearButton === 'function') {
            initAutoClearButton();
        }
        
        // 檢查並執行自動清理
        if (typeof checkAndAutoClearOverdue === 'function') {
            checkAndAutoClearOverdue();
        }
        
        try {
            // 同時載入主儀表板、成品儀表板、交期資料
            const [materialsData, finishedData, deliveryData, demandDetailsData] = await Promise.all([
                window.apiService.getMaterials(),
                window.apiService.getFinishedMaterials(),
                window.apiService.getAllDeliveries(),
                window.apiService.getAllDemandDetails()
            ]);

            // 儲存資料
            this.allDeliveryData = deliveryData.schedules || {};
            
            // 確保 demandDetailsData 是陣列
            const demandDetails = Array.isArray(demandDetailsData) ? demandDetailsData : (demandDetailsData.details || []);

            // 為每個物料加入最早需求日期和交期資訊
            this.currentMaterialsData = this.enhanceMaterialsData(materialsData, demandDetails, this.allDeliveryData);
            this.currentFinishedMaterialsData = this.enhanceMaterialsData(finishedData, demandDetails, this.allDeliveryData);
            
            // 同步到全域變數供其他模組使用
            window.materialsData = this.currentMaterialsData;
            window.finishedMaterialsData = this.currentFinishedMaterialsData;

            // 計算並更新統計
            this.updateStatsCards();

            // 填充採購人員下拉選單
            this.populateBuyerFilter(this.currentMaterialsData);

            // 設定快速篩選圖卡事件
            this.setupQuickFilterCards();

            // 渲染當前儀表板
            if (typeof window.renderMaterialsTable === 'function') {
                window.renderMaterialsTable();
            }
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            document.getElementById('tab-main-dashboard').innerHTML = '<p style="color: red;">載入儀表板資料時發生錯誤。</p>';
            document.getElementById('tab-finished-dashboard').innerHTML = '<p style="color: red;">載入儀表板資料時發生錯誤。</p>';
        }
    }

    /**
     * 增強物料資料：加入最早需求日期和交期資訊
     */
    enhanceMaterialsData(materialsData, demandDetailsData, deliveryData) {
        return materialsData.map(material => {
            const materialId = material['物料編號'];
            
            // 找到該物料的所有需求明細
            const demands = demandDetailsData.filter(d => d['物料編號'] === materialId);
            
            // 計算最早需求日期
            let earliestDemandDate = null;
            if (demands.length > 0) {
                const dates = demands
                    .map(d => d['預計日期'])
                    .filter(date => date && date.trim() !== '')
                    .map(dateStr => {
                        const [year, month, day] = dateStr.split('/').map(Number);
                        return new Date(year + 1911, month - 1, day);
                    })
                    .filter(date => !isNaN(date.getTime()));
                
                if (dates.length > 0) {
                    earliestDemandDate = new Date(Math.min(...dates));
                }
            }
            
            // 取得交期資訊
            const deliveryInfo = deliveryData[materialId] || [];
            
            return {
                ...material,
                '最早需求日期': earliestDemandDate,
                '交期資訊': deliveryInfo
            };
        });
    }

    /**
     * 更新統計圖卡
     */
    updateStatsCards() {
        const data = this.currentDashboardType === 'main' 
            ? this.currentMaterialsData 
            : this.currentFinishedMaterialsData;

        console.log('=== updateStatsCards 開始 ===');
        console.log('資料筆數:', data.length);
        if (data.length > 0) {
            console.log('第一筆資料樣本:', data[0]);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const sevenDaysLater = new Date(today);
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
        const thirtyDaysLater = new Date(today);
        thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

        // 計算各種統計
        const stats = {
            shortage30Days: 0,      // 30日內缺料
            noDelivery: 0,          // 無交期項目
            delayed: 0,             // 已延誤
            dueSoon: 0,             // 即將到期（7日內）
            allShortage: 0,         // 總缺料項目
            myItems: 0,             // 我的項目
            thisWeek: 0,            // 本週需求
            sufficient: 0,          // 庫存充足
            substituteNotify: 0,    // 替代用料通知
            inInspection: 0         // 品檢中
        };

        const notifiedSubstitutes = this.getNotifiedSubstitutes();
        const currentUser = window.currentUserName || '';

        data.forEach(item => {
            // 使用英文欄位名稱
            const earliestDemand = item.earliest_demand_date ? new Date(item.earliest_demand_date) : null;
            const shortage = parseFloat(item.current_shortage) || 0;
            const deliveryInfo = item.delivery_info || [];
            const hasDelivery = deliveryInfo.length > 0;

            // 總缺料項目
            if (shortage > 0) {
                stats.allShortage++;
            } else {
                stats.sufficient++;
            }

            // 30日內缺料 - 使用 shortage_within_30_days 欄位
            if (item.shortage_within_30_days === true) {
                stats.shortage30Days++;
            }

            // 無交期項目
            if (shortage > 0 && !hasDelivery) {
                stats.noDelivery++;
            }

            // 已延誤（有交期但最早交期已過）
            if (shortage > 0 && hasDelivery) {
                const earliestDelivery = new Date(Math.min(...deliveryInfo.map(d => new Date(d.delivery_date))));
                if (earliestDelivery < today) {
                    stats.delayed++;
                }
            }

            // 即將到期（7日內有交期）
            if (shortage > 0 && hasDelivery) {
                const hasDeliverySoon = deliveryInfo.some(d => {
                    const deliveryDate = new Date(d.delivery_date);
                    return deliveryDate >= today && deliveryDate <= sevenDaysLater;
                });
                if (hasDeliverySoon) {
                    stats.dueSoon++;
                }
            }

            // 我的項目（當前用戶負責的）
            if (item.procurement_staff === currentUser) {
                stats.myItems++;
            }

            // 本週需求
            if (earliestDemand && earliestDemand <= sevenDaysLater) {
                stats.thisWeek++;
            }

            // 替代用料通知
            if (item.substitute_material && item.substitute_material.trim() !== '' && 
                notifiedSubstitutes.includes(item.base_material_id)) {
                stats.substituteNotify++;
            }

            // 品檢中 - 檢查 inspection_stock 是否大於 0
            if (item.inspection_stock && parseFloat(item.inspection_stock) > 0) {
                stats.inInspection++;
            }
        });

        // 更新 DOM
        this.updateStatsCardDOM('stat-shortage-30', stats.shortage30Days);
        this.updateStatsCardDOM('stat-no-delivery', stats.noDelivery);
        this.updateStatsCardDOM('stat-delayed', stats.delayed);
        this.updateStatsCardDOM('stat-due-soon', stats.dueSoon);
        this.updateStatsCardDOM('stat-all-shortage', stats.allShortage);
        this.updateStatsCardDOM('stat-my-items', stats.myItems);
        this.updateStatsCardDOM('stat-this-week', stats.thisWeek);
        this.updateStatsCardDOM('stat-sufficient', stats.sufficient);
        this.updateStatsCardDOM('stat-substitute-notify', stats.substituteNotify);
        this.updateStatsCardDOM('stat-in-inspection', stats.inInspection);
    }

    /**
     * 更新統計圖卡 DOM
     */
    updateStatsCardDOM(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = value;
        }
    }

    /**
     * 填充採購人員下拉選單
     */
    populateBuyerFilter(data) {
        const buyerSelect = document.getElementById('buyer-filter-select');
        if (!buyerSelect) return;

        // 清空現有選項（保留第一個「全部」選項）
        while (buyerSelect.options.length > 1) {
            buyerSelect.remove(1);
        }

        // 收集所有不重複的採購人員
        const buyers = new Set();
        data.forEach(item => {
            if (item['採購人員'] && item['採購人員'].trim() !== '') {
                buyers.add(item['採購人員']);
            }
        });

        // 排序並填充下拉選單
        const sortedBuyers = Array.from(buyers).sort();
        sortedBuyers.forEach(buyer => {
            const option = document.createElement('option');
            option.value = buyer;
            option.textContent = buyer;
            buyerSelect.appendChild(option);
        });
    }

    /**
     * 設定採購篩選器
     */
    setupProcurementFilter() {
        const filterInput = document.getElementById('material-filter-input');
        const buyerFilterSelect = document.getElementById('buyer-filter-select');
        const applyFilterBtn = document.getElementById('apply-filter-btn');
        const clearFilterBtn = document.getElementById('clear-filter-btn');

        if (applyFilterBtn && filterInput) {
            // 應用物料篩選
            const applyMaterialFilter = () => {
                this.currentFilterKeyword = filterInput.value.trim();
                this.resetCurrentPage();
                if (typeof window.renderMaterialsTable === 'function') {
                    window.renderMaterialsTable();
                }
            };

            applyFilterBtn.addEventListener('click', applyMaterialFilter);

            // 允許按 Enter 鍵觸發物料查詢
            filterInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    applyMaterialFilter();
                }
            });
        }

        // 採購人員下拉選單直接觸發篩選
        if (buyerFilterSelect) {
            buyerFilterSelect.addEventListener('change', () => {
                this.currentBuyerKeyword = buyerFilterSelect.value;
                this.resetCurrentPage();
                if (typeof window.renderMaterialsTable === 'function') {
                    window.renderMaterialsTable();
                }
            });
        }

        // 清除搜尋
        if (clearFilterBtn) {
            clearFilterBtn.addEventListener('click', () => {
                if (filterInput) filterInput.value = '';
                if (buyerFilterSelect) buyerFilterSelect.value = '';
                this.currentFilterKeyword = '';
                this.currentBuyerKeyword = '';
                this.resetCurrentPage();
                if (typeof window.renderMaterialsTable === 'function') {
                    window.renderMaterialsTable();
                }
            });
        }

        // Excel 匯出按鈕
        const exportExcelBtn = document.getElementById('export-excel-btn');
        if (exportExcelBtn) {
            exportExcelBtn.addEventListener('click', () => {
                if (typeof window.exportToExcel === 'function') {
                    window.exportToExcel();
                }
            });
        }
    }

    /**
     * 設定儀表板頁籤切換
     */
    setupDashboardTabs() {
        document.querySelectorAll('.dashboard-tab-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const tabId = link.dataset.tab;

                // 更新當前儀表板類型
                this.currentDashboardType = tabId === 'tab-main-dashboard' ? 'main' : 'finished';

                // 切換頁籤樣式
                document.querySelectorAll('.dashboard-tab-link').forEach(l => l.classList.remove('active'));
                document.querySelectorAll('.dashboard-tab-content').forEach(c => c.classList.remove('active'));

                link.classList.add('active');
                document.getElementById(tabId).classList.add('active');

                // 更新統計圖卡（根據當前頁籤）
                this.updateStatsCards();

                // 重新渲染表格
                if (typeof window.renderMaterialsTable === 'function') {
                    window.renderMaterialsTable();
                }
            });
        });
    }

    /**
     * 設定快速篩選圖卡點擊事件
     */
    setupQuickFilterCards() {
        // 快速篩選圖卡與對應的 filter 值
        const filterMap = {
            'stat-shortage-30': 'shortage-30-days',
            'stat-no-delivery': 'no-delivery',
            'stat-delayed': 'delayed',
            'stat-due-soon': 'due-soon',
            'stat-all-shortage': 'all-shortage',
            'stat-my-items': 'my-items',
            'stat-this-week': 'this-week',
            'stat-sufficient': 'sufficient',
            'stat-substitute-notify': 'substitute-notify',
            'stat-in-inspection': 'in-inspection'
        };

        // 為每個圖卡設定點擊事件
        Object.entries(filterMap).forEach(([cardId, filterValue]) => {
            const card = document.getElementById(cardId);
            if (card) {
                const cardElement = card.closest('.stat-card');
                if (cardElement) {
                    cardElement.style.cursor = 'pointer';
                    cardElement.addEventListener('click', () => {
                        // 切換篩選狀態
                        if (this.currentQuickFilter === filterValue) {
                            // 如果已經是當前篩選，則取消篩選
                            this.currentQuickFilter = null;
                            window.currentStatFilter = 'all'; // 同步全域變數
                            document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
                        } else {
                            // 設定新的篩選
                            this.currentQuickFilter = filterValue;
                            window.currentStatFilter = filterValue; // 同步全域變數
                            document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
                            cardElement.classList.add('active');
                        }

                        // 重置分頁並重新渲染
                        this.resetCurrentPage();
                        if (typeof window.renderMaterialsTable === 'function') {
                            window.renderMaterialsTable();
                        }
                    });
                }
            }
        });
    }

    /**
     * 設定每頁顯示數量選擇器
     */
    setupItemsPerPageHandler() {
        console.log('=== setupItemsPerPageHandler 被呼叫 ===');

        // 使用事件委派,在 document 層級監聽
        document.addEventListener('change', (e) => {
            // 檢查是否是我們的選擇器
            if (e.target && e.target.id === 'items-per-page-select') {
                const newValue = parseInt(e.target.value);

                console.log('=== 選擇器 change 事件觸發 (事件委派) ===');
                console.log('新值:', newValue);
                console.log('當前儀表板類型:', this.currentDashboardType);
                console.log('修改前 - 主儀表板:', this.mainDashboardItemsPerPage, '成品儀表板:', this.finishedDashboardItemsPerPage);

                // 根據當前儀表板類型更新對應的變數
                if (this.currentDashboardType === 'main') {
                    this.mainDashboardItemsPerPage = newValue;
                    this.mainDashboardPage = 1;
                } else {
                    this.finishedDashboardItemsPerPage = newValue;
                    this.finishedDashboardPage = 1;
                }

                console.log('修改後 - 主儀表板:', this.mainDashboardItemsPerPage, '成品儀表板:', this.finishedDashboardItemsPerPage);
                console.log('準備重新渲染...');
                
                if (typeof window.renderMaterialsTable === 'function') {
                    window.renderMaterialsTable();
                }
            }
        });

        console.log('每頁顯示數量選擇器事件委派設定完成');
    }

    /**
     * 設定統計圖卡點擊事件
     */
    setupStatsCardEvents() {
        document.querySelectorAll('.stat-card[data-filter]').forEach(card => {
            card.addEventListener('click', () => {
                const filterType = card.dataset.filter;
                
                // 切換選中狀態
                if (this.currentQuickFilter === filterType) {
                    // 取消篩選
                    card.classList.remove('active');
                    this.currentQuickFilter = null;
                } else {
                    // 移除所有卡片的 active 狀態
                    document.querySelectorAll('.stat-card[data-filter]').forEach(c => c.classList.remove('active'));
                    // 應用新篩選
                    card.classList.add('active');
                    this.currentQuickFilter = filterType;
                }
                
                this.resetCurrentPage();
                if (typeof window.renderMaterialsTable === 'function') {
                    window.renderMaterialsTable();
                }
            });
        });
    }

    /**
     * 根據快速篩選取得過濾後的資料
     */
    getFilteredDataByQuickFilter(data) {
        if (!this.currentQuickFilter) {
            return data;
        }

        console.log('=== getFilteredDataByQuickFilter 開始 ===');
        console.log('篩選類型:', this.currentQuickFilter);
        console.log('輸入數據筆數:', data.length);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const sevenDaysLater = new Date(today);
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
        const thirtyDaysLater = new Date(today);
        thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
        const currentUser = window.currentUserName || '';

        let filtered = [];
        switch (this.currentQuickFilter) {
            case 'shortage-30-days':
                // 使用 shortage_within_30_days 布林欄位
                console.log('開始30日內缺料篩選，資料筆數:', data.length);
                console.log('第一筆資料的 shortage_within_30_days:', data[0]?.shortage_within_30_days, typeof data[0]?.shortage_within_30_days);
                filtered = data.filter(item => item.shortage_within_30_days === true);
                console.log('30日內缺料篩選結果:', filtered.length);
                if (filtered.length > 0) {
                    console.log('篩選後第一筆資料:', filtered[0]);
                }
                return filtered;

            case 'no-delivery':
                filtered = data.filter(item => {
                    const shortage = parseFloat(item.current_shortage || item['缺料數量']) || 0;
                    const deliveryInfo = item.delivery_info || item['交期資訊'] || [];
                    const hasDelivery = deliveryInfo.length > 0;
                    return shortage > 0 && !hasDelivery;
                });
                console.log('無交期篩選結果:', filtered.length);
                return filtered;

            case 'delayed':
                filtered = data.filter(item => {
                    const shortage = parseFloat(item.current_shortage || item['缺料數量']) || 0;
                    const deliveryInfo = item.delivery_info || item['交期資訊'] || [];
                    const hasDelivery = deliveryInfo.length > 0;
                    if (shortage > 0 && hasDelivery) {
                        const earliestDelivery = new Date(Math.min(...deliveryInfo.map(d => new Date(d.delivery_date || d.交期日期))));
                        return earliestDelivery < today;
                    }
                    return false;
                });
                console.log('已延誤篩選結果:', filtered.length);
                return filtered;

            case 'due-soon':
                return data.filter(item => {
                    const shortage = parseFloat(item.current_shortage || item['缺料數量']) || 0;
                    const deliveryInfo = item.delivery_info || item['交期資訊'] || [];
                    const hasDelivery = deliveryInfo.length > 0;
                    if (shortage > 0 && hasDelivery) {
                        return deliveryInfo.some(d => {
                            const deliveryDate = new Date(d.delivery_date || d.交期日期);
                            return deliveryDate >= today && deliveryDate <= sevenDaysLater;
                        });
                    }
                    return false;
                });

            case 'all-shortage':
                return data.filter(item => {
                    const shortage = parseFloat(item.current_shortage || item['缺料數量']) || 0;
                    return shortage > 0;
                });

            case 'my-items':
                return data.filter(item => (item.buyer || item['採購人員']) === currentUser);

            case 'this-week':
                return data.filter(item => {
                    const earliestDemandStr = item.earliest_demand_date || item['最早需求日期'];
                    if (earliestDemandStr) {
                        const earliestDemand = new Date(earliestDemandStr);
                        return earliestDemand <= sevenDaysLater;
                    }
                    return false;
                });

            case 'sufficient':
                return data.filter(item => {
                    const shortage = parseFloat(item.current_shortage || item['缺料數量']) || 0;
                    return shortage <= 0;
                });

            case 'substitute-notify':
                const notifiedSubstitutes = this.getNotifiedSubstitutes();
                return data.filter(item => {
                    const substitute = item.substitute_material || item['替代用料'];
                    const materialId = item.base_material_id || item['物料編號'];
                    return substitute && substitute.trim() !== '' && 
                           notifiedSubstitutes.includes(materialId);
                });

            case 'in-inspection':
                filtered = data.filter(item => {
                    const inspectionStock = parseFloat(item.inspection_stock || item['品檢中']) || 0;
                    return inspectionStock > 0;
                });
                console.log('品檢中篩選結果:', filtered.length);
                return filtered;

            default:
                console.log('未知的篩選類型:', this.currentQuickFilter);
                return data;
        }
    }

    /**
     * 重置當前頁碼
     */
    resetCurrentPage() {
        if (this.currentDashboardType === 'main') {
            this.mainDashboardPage = 1;
        } else {
            this.finishedDashboardPage = 1;
        }
    }

    /**
     * 切換替代用料通知
     */
    toggleSubstituteNotify(materialId, isChecked) {
        if (isChecked) {
            localStorage.setItem(`notify_${materialId}`, 'true');
        } else {
            localStorage.removeItem(`notify_${materialId}`);
        }
        // 重新計算統計
        this.updateStatsCards();
    }

    /**
     * 取得所有已通知的替代用料
     */
    getNotifiedSubstitutes() {
        const notified = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('notify_') && localStorage.getItem(key) === 'true') {
                notified.push(key.replace('notify_', ''));
            }
        }
        return notified;
    }

    /**
     * 取得當前儀表板資料
     */
    getCurrentData() {
        return this.currentDashboardType === 'main' 
            ? this.currentMaterialsData 
            : this.currentFinishedMaterialsData;
    }

    /**
     * 取得當前頁碼
     */
    getCurrentPage() {
        return this.currentDashboardType === 'main'
            ? this.mainDashboardPage
            : this.finishedDashboardPage;
    }

    /**
     * 設定當前頁碼
     */
    setCurrentPage(page) {
        if (this.currentDashboardType === 'main') {
            this.mainDashboardPage = page;
        } else {
            this.finishedDashboardPage = page;
        }
    }

    /**
     * 取得每頁顯示數量
     */
    getItemsPerPage() {
        return this.currentDashboardType === 'main'
            ? this.mainDashboardItemsPerPage
            : this.finishedDashboardItemsPerPage;
    }
}

// 建立全域實例
window.procurementDashboard = new ProcurementDashboard();

// 暴露必要的函數到全域
window.toggleSubstituteNotify = function(materialId) {
    const isChecked = event.target.checked;
    window.procurementDashboard.toggleSubstituteNotify(materialId, isChecked);
};

window.getNotifiedSubstitutes = function() {
    return window.procurementDashboard.getNotifiedSubstitutes();
};

// 暴露載入函數給 main.js 使用
window.loadProcurementDashboard = function() {
    window.procurementDashboard.initialize().then(() => {
        // 設定所有事件監聽器
        window.procurementDashboard.setupDashboardTabs();
        window.procurementDashboard.setupProcurementFilter();
        window.procurementDashboard.setupItemsPerPageHandler();
        window.procurementDashboard.setupStatsCardEvents();
    });
};
