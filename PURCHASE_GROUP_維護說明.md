# Purchase Group 欄位維護說明

## 📋 資料來源

**檔案位置**：`P:\F004\MPS維護\已訂未交.XLSX`

**資料表**：`purchase_orders`

**欄位**：`purchase_group` (VARCHAR(10))

---

## ✅ 已修正的問題

### 1. 資料庫欄位型態
- ✅ 已定義為 `VARCHAR(10)` 字串型態
- ✅ 可正確儲存前導零（如 001, 002, 007）

### 2. 現有資料修正
- ✅ 已執行 `fix_purchase_group_data.py`
- ✅ 1,702 筆記錄已全部補零到 3 位數
- ✅ 修正前：'7' → 修正後：'007'

---

## 🔄 資料更新流程

### 主要匯入腳本

#### 1. `import_purchase_orders.py`
**用途**：從 Excel 匯入採購單資料到資料庫

**處理邏輯**（第 54-61 行）：
```python
purchase_group = None
if pd.notna(row['採購群組']):
    pg_value = row['採購群組']
    if isinstance(pg_value, (int, float)):
        purchase_group = str(int(pg_value)).zfill(3)  # ✅ 補零到3位數
    else:
        purchase_group = str(pg_value).strip()  # ⚠️ 字串不會補零
```

**狀態**：✅ 數字型態已正確處理，⚠️ 字串型態需注意

---

#### 2. `sync_buyer_from_purchase_orders.py`
**用途**：同步採購群組到物料表的採購人員欄位

**處理邏輯**（第 46-52 行）：
```python
purchase_group = None
if pd.notna(row['採購群組']):
    pg_value = row['採購群組']
    if isinstance(pg_value, (int, float)):
        purchase_group = str(int(pg_value)).zfill(3)  # ✅ 補零到3位數
    else:
        purchase_group = str(pg_value).strip()  # ⚠️ 字串不會補零
```

**狀態**：✅ 數字型態已正確處理，⚠️ 字串型態需注意

---

#### 3. `data_service.py`
**用途**：載入已訂未交資料計算在途數量

**處理邏輯**（第 207 行）：
```python
return pd.read_excel(on_order_path)
```

**狀態**：✅ 不會更新 purchase_group 欄位，無影響

---

## ⚠️ 潛在風險

### 風險 1：Excel 中的採購群組已經是字串格式
如果 Excel 檔案中的「採購群組」欄位已經儲存為字串（如 "1", "2", "7"），則不會被補零。

**解決方案**：修改腳本，確保所有情況都補零

### 風險 2：未來新增的採購群組
如果未來新增的採購群組號碼超過 3 位數（如 1001），`zfill(3)` 不會截斷，會保留完整數字。

**狀態**：✅ 這是正確的行為

---

## 🔧 建議修正

### 修正 `import_purchase_orders.py` 和 `sync_buyer_from_purchase_orders.py`

**修正前**：
```python
if isinstance(pg_value, (int, float)):
    purchase_group = str(int(pg_value)).zfill(3)
else:
    purchase_group = str(pg_value).strip()  # ⚠️ 不會補零
```

**修正後**：
```python
if isinstance(pg_value, (int, float)):
    purchase_group = str(int(pg_value)).zfill(3)
else:
    # 字串也要補零
    pg_str = str(pg_value).strip()
    if pg_str.isdigit():
        purchase_group = pg_str.zfill(3)  # ✅ 補零
    else:
        purchase_group = pg_str  # 非數字字串保持原樣
```

---

## 📝 維護檢查清單

### 每次執行匯入後檢查

1. ✅ 執行 `import_purchase_orders.py` 匯入採購單
2. ✅ 檢查 purchase_group 格式：
   ```sql
   SELECT DISTINCT purchase_group, length(purchase_group) as len
   FROM purchase_orders
   WHERE purchase_group IS NOT NULL
   ORDER BY purchase_group;
   ```
3. ⚠️ 如發現格式不正確，執行 `fix_purchase_group_data.py` 修正

### 定期檢查

- 每月檢查一次 purchase_group 欄位格式
- 確保所有值都是 3 位數（或更多位數）
- 確保前導零沒有遺失

---

## 🛠️ 相關檔案

| 檔案 | 用途 | 是否會更新 purchase_group |
|------|------|--------------------------|
| `import_purchase_orders.py` | 匯入採購單 | ✅ 是 |
| `sync_buyer_from_purchase_orders.py` | 同步採購人員 | ✅ 是（更新 Material.buyer_id） |
| `fix_purchase_group_data.py` | 修正資料格式 | ✅ 是 |
| `data_service.py` | 載入在途數量 | ❌ 否 |
| `app/models/database.py` | 資料庫模型 | - |

---

## 📞 問題排查

### 如果發現 purchase_group 又變成沒有前導零

1. **檢查 Excel 來源檔案**
   - 確認「採購群組」欄位的格式
   - 如果是文字格式，可能需要修正腳本

2. **執行修正腳本**
   ```bash
   python fix_purchase_group_data.py
   ```

3. **檢查匯入腳本**
   - 確認 `import_purchase_orders.py` 的處理邏輯
   - 確認 `sync_buyer_from_purchase_orders.py` 的處理邏輯

4. **查看修正建議**
   - 參考本文件的「建議修正」章節
   - 更新腳本以確保字串也會補零

---

## 📅 最後更新

- **日期**：2025-12-05
- **修正記錄數**：1,702 筆
- **當前採購群組**：007 (1,702 筆)
