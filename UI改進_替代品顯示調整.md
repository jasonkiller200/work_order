# UI改進：替代品資訊顯示調整

## 更新時間：2025-11-30

## 改進內容

### 變更前
- 替代品資訊在獨立的「可替代版本」分頁中顯示
- 需要切換分頁才能查看
- 增加操作步驟

### 變更後
- 替代品資訊直接顯示在「庫存總覽」區塊下方
- 無需切換分頁，一眼就能看到所有相關資訊
- 簡化使用流程

---

## 視覺效果

### 新的佈局

```
┌─────────────────────────────────────────────┐
│ 物料詳情: 10100001                          │
├─────────────────────────────────────────────┤
│ 庫存總覽                                    │
│   未限制庫存: 100                           │
│   品質檢驗中: 0                             │
│   已訂未入: 50                              │
│                                             │
│ 可替代版本                                  │
│ ┌───────────────────────────────────────┐  │
│ │ 物料    │ 說明    │ 庫存 │ 品檢中    │  │
│ │ 1010001│ 版本A   │ 50   │ 0         │  │
│ │ 1010002│ 版本B   │ 30   │ 10        │  │
│ └───────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│ [需求訂單] (分頁)                           │
│                                             │
│ 訂單號碼 │ 未結數量 │ 需求日期 │ 預計剩餘 │
│ 202001  │ 40      │ 2025-12-15 │ 60     │
│ 202002  │ 50      │ 2025-12-25 │ 10     │
└─────────────────────────────────────────────┘
```

---

## 修改的檔案

### 1. `app/static/js/main.js`

#### 修改 `openDetailsModal` 函數

**主要變更：**

1. **新增替代品區域處理**
   ```javascript
   // 清空替代品區域
   const substituteSection = document.getElementById('substitute-section');
   if (substituteSection) {
       substituteSection.innerHTML = '<p>載入中...</p>';
   }
   ```

2. **隱藏替代版本分頁**
   ```javascript
   modal.querySelectorAll('.tab-link').forEach(l => {
       l.classList.remove('active');
       const tabName = l.getAttribute('data-tab');
       if (tabName === 'tab-substitute') {
           l.classList.add('hidden');  // 隱藏替代版本分頁
       } else {
           l.classList.remove('hidden');
       }
   });
   ```

3. **在庫存總覽下方顯示替代品**
   ```javascript
   // 顯示替代品資訊在庫存總覽下方
   let subHTML = '<h4 style="margin-top: 1em; margin-bottom: 0.5em; color: var(--pico-primary);">可替代版本</h4>';
   if (data.substitute_inventory && data.substitute_inventory.length > 0) {
       subHTML += '<table style="font-size: 0.9em;"><thead><tr><th>物料</th><th>說明</th><th>庫存</th><th>品檢中</th></tr></thead><tbody>';
       data.substitute_inventory.forEach(s => {
           subHTML += `<tr><td>${s['物料']}</td><td>${s['物料說明']}</td><td>${s.unrestricted_stock.toFixed(0)}</td><td>${s.inspection_stock.toFixed(0)}</td></tr>`;
       });
       subHTML += '</tbody></table>';
   } else {
       subHTML += '<p style="font-size: 0.9em; color: var(--pico-muted-color);">沒有找到可用的替代版本。</p>';
   }
   
   const substituteSection = document.getElementById('substitute-section');
   if (substituteSection) {
       substituteSection.innerHTML = subHTML;
   }
   ```

---

### 2. `app/views/procurement.html`

#### 修改模態視窗結構

**新增替代品顯示區域**

```html
<!-- 庫存總覽區塊 -->
<div id="stock-summary-section">
    <h4>庫存總覽</h4>
    <p>未限制庫存: <span id="unrestricted-stock"></span></p>
    <p>品質檢驗中: <span id="inspection-stock"></span></p>
    <p>已訂未入: <span id="on-order-stock"></span></p>
    
    <!-- 替代品資訊區域 -->
    <div id="substitute-section">
        <!-- 替代品表格將會被動態插入這裡 -->
    </div>
</div>
```

**隱藏替代版本分頁連結**

```html
<!-- 分頁導覽 -->
<nav>
    <ul>
        <li><a href="#" class="tab-link active" data-tab="tab-demand">需求訂單</a></li>
        <li><a href="#" class="tab-link hidden" data-tab="tab-substitute">可替代版本</a></li>
    </ul>
</nav>
```

---

## 優點

### 1. 使用者體驗改善
- ✅ 減少點擊次數
- ✅ 一次看到所有關鍵資訊
- ✅ 更直覺的資訊呈現

### 2. 視覺一致性
- ✅ 相關資訊集中顯示
- ✅ 減少分頁切換的困擾
- ✅ 符合使用者習慣（相關資訊在一起）

### 3. 效能
- ✅ 一次API呼叫取得所有資料
- ✅ 無需等待分頁切換
- ✅ 減少DOM操作

---

## 使用場景

### 場景一：快速檢查庫存和替代品
1. 點擊物料編號
2. 模態視窗開啟
3. 立即看到：
   - 當前庫存
   - 已訂未入
   - **可用的替代品（新位置）**
   - 需求訂單列表

### 場景二：評估採購策略
採購人員可以快速評估：
1. 當前物料庫存是否足夠
2. 如果不足，有哪些替代品可用
3. 替代品的庫存狀況如何
4. 需求的緊急程度

---

## 樣式說明

### 替代品標題
```javascript
'<h4 style="margin-top: 1em; margin-bottom: 0.5em; color: var(--pico-primary);">可替代版本</h4>'
```
- 上方留1em空間，與庫存總覽區隔
- 使用主題色（藍色）
- 與庫存總覽的 h4 樣式一致

### 替代品表格
```javascript
'<table style="font-size: 0.9em;">'
```
- 字體稍小（0.9em）
- 節省空間，更緊湊
- 保持清晰可讀

### 無替代品訊息
```javascript
'<p style="font-size: 0.9em; color: var(--pico-muted-color);">沒有找到可用的替代版本。</p>'
```
- 使用灰色文字
- 較小字體
- 不佔用太多視覺空間

---

## 測試檢查清單

### 視覺檢查
- ✅ 替代品顯示在庫存總覽下方
- ✅ 替代品標題清楚可見
- ✅ 表格格式正確
- ✅ 無替代品時顯示提示訊息

### 功能檢查
- ✅ 替代品資料正確載入
- ✅ 庫存數字正確顯示
- ✅ 分頁導覽中不顯示「可替代版本」
- ✅ 只保留「需求訂單」分頁

### 錯誤處理
- ✅ 載入失敗時顯示錯誤訊息
- ✅ 沒有替代品時顯示友善提示
- ✅ 不影響其他功能運作

---

## 注意事項

1. **分頁保留**
   - 「可替代版本」分頁標籤被隱藏但保留在DOM中
   - 如需恢復分頁顯示，只需移除 `hidden` 類別

2. **向下相容**
   - 保留原有的 `tab-substitute` 元素
   - API回應格式不變
   - 只是顯示位置改變

3. **響應式設計**
   - 替代品表格使用相對字體大小
   - 在小螢幕上仍可正常顯示
   - 建議測試手機版顯示

---

## 未來可能的改進

1. **可展開/收合**
   - 替代品區域預設收合
   - 點擊展開查看詳細資訊
   - 節省螢幕空間

2. **快速對比**
   - 高亮顯示庫存充足的替代品
   - 用顏色區分可用性

3. **直接操作**
   - 點擊替代品可查看其詳細資訊
   - 快速切換物料查詢

---

## 回滾方案

如需恢復原有的分頁顯示，修改以下部分：

### JavaScript (main.js)
將替代品資訊寫入 `tab-substitute` 而不是 `substitute-section`

### HTML (procurement.html)
移除 `hidden` 類別：
```html
<li><a href="#" class="tab-link" data-tab="tab-substitute">可替代版本</a></li>
```

---

## 相關檔案

- `app/static/js/main.js` - 前端邏輯
- `app/views/procurement.html` - HTML結構
- `app/static/css/style.css` - 樣式表

---

## 驗證

- ✅ JavaScript語法檢查通過
- ✅ HTML結構正確
- ⏳ 等待重新啟動測試
