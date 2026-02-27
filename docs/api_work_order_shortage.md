# 工單缺料明細 API 文件

此文件說明與工單缺料詳細資訊相關的 API。

## 1. 取得工單統計列表
取得包含缺料筆數的工單清單，支援半品與成品工單。

- **URL:** `/api/work-order-statistics`
- **Method:** `GET`
- **查詢參數:**
    - `order_type` (string): `semi` 為半品工單（預設），`finished` 為成品工單。
    - `page` (int): 頁碼（預設 1）。
    - `per_page` (int): 每頁筆數（預設 50）。
    - `search` (string): 搜尋關鍵字。
    - `sort_by` (string): 排序欄位（例如：`需求日期`, `工單號碼`, `缺料筆數`）。
    - `sort_order` (string): 排序順序（`asc` 或 `desc`）。

- **回應範例 (order_type=semi):**
```json
{
    "data": [
        {
            "工單號碼": "2100123456",
            "品名": "馬達轉軸",
            "需求日期": "2024-02-15",
            "缺料筆數": 3,
            "對應成品": "1100654321",
            "機型": "VMC-1000",
            "成品出貨日": "2024-03-01"
        }
    ],
    "total": 125,
    "page": 1,
    "total_pages": 3
}
```

---

## 2. 取得特定工單缺料明細
取得特定工單的物料需求與缺料狀態（使用 FIFO 計算）。

- **URL:** `/api/work-order-statistics/<order_id>/shortage-details`
- **Method:** `GET`
- **路徑參數:**
    - `order_id` (string): 工單號碼。
- **查詢參數:**
    - `order_type` (string): `semi` 或 `finished`。

- **回應範例:**
```json
{
    "order_id": "2100123456",
    "shortage_count": 3,
    "total_materials": 15,
    "details": [
        {
            "物料": "M001-A22",
            "物料說明": "軸承",
            "需求數量": 10,
            "可用庫存": 5,
            "是否缺料": true,
            "需求日期": "2024-02-15",
            "採購人員": "張三",
            "預計交貨日": "2024-02-20"
        }
    ]
}
```

---

## 3. 匯出工單統計資料
匯出與列表一致的資料，供 Excel 下載。

- **URL:** `/api/work-order-statistics/export`
- **Method:** `GET`
- **查詢參數:** 與列表 API 相同。

---

## 4. 批量取得缺料明細
一次查多個工單的缺料清單。

- **URL:** `/api/work-order-statistics/batch-shortage-details`
- **Method:** `POST`
- **Body:**
```json
{
    "order_ids": ["2100123456", "6100123456"],
    "order_type": "semi"
}
```
