/**
 * 採購儀表板頁面模組
 * 負責處理 /procurement 頁面的所有功能，包括資料載入、渲染、篩選和排序。
 */

// 全局變數來儲存原始資料、排序狀態和篩選關鍵字
let currentMaterialsData = [];
let currentFinishedMaterialsData = []; // 成品儀表板資料
let currentSortColumn = null;
let currentSortOrder = 'asc'; // 'asc' 或 'desc'
let currentFilterKeyword = ''; // 物料篩選關鍵字
let currentBuyerKeyword = ''; // 採購人員篩選關鍵字

// 🆕 統計圖卡篩選
let currentStatFilter = 'all'; // 當前圖卡篩選狀態
let allDeliveryData = {}; // 所有交期資料

// 分頁相關變數 - 為兩個儀表板各自維護獨立的分頁狀態
let mainDashboardPage = 1;
let mainDashboardItemsPerPage = 50;
let finishedDashboardPage = 1;
let finishedDashboardItemsPerPage = 50;

// 當前顯示的儀表板類型
let currentDashboardType = 'main'; // 'main' 或 'finished'


function loadProcurementDashboard() {
    // 🆕 初始化自動清理按鈕狀態
    if (typeof initAutoClearButton === 'function') {
        initAutoClearButton();
    }
    
    // 🆕 檢查並執行自動清理
    if (typeof checkAndAutoClearOverdue === 'function') {
        checkAndAutoClearOverdue();
    }
    
    // 同時載入主儀表板、成品儀表板、交期資料
    Promise.all([
        fetch('/api/materials').then(r => r.json()),
        fetch('/api/finished_materials').then(r => r.json()),
        fetch('/api/delivery/all').then(r => r.json()),
        fetch('/api/demand_details/all').then(r => r.json())
    ])
        .then(([materialsData, finishedData, deliveryData, demandDetailsData]) => {
            // 儲存資料
            allDeliveryData = deliveryData.schedules || {};

            // 🆕 為每個物料加入最早需求日期和交期資訊
            currentMaterialsData = enhanceMaterialsData(materialsData, demandDetailsData, allDeliveryData);
            currentFinishedMaterialsData = enhanceMaterialsData(finishedData, demandDetailsData, allDeliveryData);

            // 🆕 計算並更新統計
            updateStatsCards();

            // 填充採購人員下拉選單
            populateBuyerFilter(currentMaterialsData);

            // 渲染當前儀表板
            renderMaterialsTable();
        })
        .catch(error => {
            console.error('Error loading dashboard data:', error);
            document.getElementById('tab-main-dashboard').innerHTML = '<p style="color: red;">載入儀表板資料時發生錯誤。</p>';
            document.getElementById('tab-finished-dashboard').innerHTML = '<p style="color: red;">載入儀表板資料時發生錯誤。</p>';
        });
}