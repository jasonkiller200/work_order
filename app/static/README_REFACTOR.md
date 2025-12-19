# 前端重構 - 第一階段

## 📁 新的檔案結構

### CSS 架構
```
app/static/css/
├── base/
│   └── variables.css        # CSS 變數定義（亮色/暗色主題）
├── components/              # 元件樣式（待建立）
├── layout/                  # 布局樣式（待建立）
├── pico.min.css            # 第三方框架
└── style.css               # 舊的整合檔案（逐步淘汰）
```

### JavaScript 架構
```
app/static/js/
├── core/                    # 核心模組（待建立）
├── services/
│   ├── api-service.js       # ✅ API 服務層
│   └── notification-service.js # ✅ 通知服務
├── utils/                   # 工具函數（待建立）
├── admin.js                 # 管理後台
├── delivery-helper.js       # 交期輔助
├── main.js                  # 主程式（待重構）
├── main_part.js            # 採購單功能
├── stats-helper.js         # 統計輔助
└── theme-switcher.js       # 主題切換
```

## ✅ 第一階段完成項目

### 1. CSS 變數抽離
- ✅ 建立 `base/variables.css`
- ✅ 包含完整的顏色系統
- ✅ 支援亮色/暗色主題切換
- ✅ 語義化命名（--color-*, --bg-*, --text-*, etc.）

### 2. API 服務層建立
- ✅ 建立 `services/api-service.js`
- ✅ 統一管理所有 API 呼叫
- ✅ 提供類型化的方法（getMaterials, getOrder, etc.）
- ✅ 錯誤處理機制
- ✅ 全域實例 `window.apiService`

### 3. 通知服務建立
- ✅ 建立 `services/notification-service.js`
- ✅ 封裝 Toast 通知
- ✅ 提供快捷方法（success, error, warning, info）
- ✅ 支援載入中訊息
- ✅ 向後兼容舊的 `showToast` 函數

## 🎯 使用範例

### API 服務使用
```javascript
// 舊方式（分散在各處）
fetch('/api/materials')
    .then(response => response.json())
    .then(data => { ... });

// 新方式（統一管理）
const materials = await apiService.getMaterials();
```

### 通知服務使用
```javascript
// 舊方式
showToast('✅ 儲存成功', 'success');

// 新方式（更語義化）
notificationService.success('✅ 儲存成功');

// 或簡寫
apiService.updateBuyer(id, buyer)
    .then(() => notificationService.success('更新成功'))
    .catch(() => notificationService.error('更新失敗'));
```

## 📋 下一階段計劃

### 第二階段：CSS 元件化
- [ ] components/buttons.css
- [ ] components/tables.css
- [ ] components/modals.css
- [ ] components/cards.css
- [ ] components/forms.css

### 第三階段：JS 模組化
- [ ] modules/procurement/dashboard.js
- [ ] modules/order-query/search.js
- [ ] modules/delivery/form.js
- [ ] utils/date.js
- [ ] utils/format.js

## 🔄 遷移指南

### 如何使用新的服務層
1. 在 HTML 中引入新的服務檔案（在 main.js 之前）
2. 逐步替換舊的 fetch 呼叫為 apiService
3. 替換 showToast 為 notificationService

### 相容性
- ✅ 完全向後兼容
- ✅ 舊的 showToast 函數仍可使用
- ✅ 可逐步遷移，不需一次性改完

## 📊 效益

### 程式碼可維護性
- 🔍 API 呼叫集中管理，易於追蹤
- 🎨 樣式變數統一，主題切換更容易
- 📦 功能模組化，降低耦合度

### 開發效率
- ⚡ 減少重複程式碼
- 🐛 錯誤處理統一
- 📝 程式碼更語義化

### 效能
- 🚀 無額外效能開銷
- 💾 瀏覽器可快取服務模組
- 🔄 為未來打包優化做準備

---

**建立日期**：2025-12-19  
**負責人**：開發團隊  
**狀態**：進行中 ⏳
