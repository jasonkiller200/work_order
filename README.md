# 工單管理系統 - MVC 架構

## 專案簡介

這是一個基於 Flask 的工單管理系統，採用 MVC (Model-View-Controller) 架構設計，提供物料查詢、訂單管理、規格下載等功能。

## 架構說明

### 目錄結構

```
c:\app\order/
├── app/                        # 主應用程式目錄
│   ├── __init__.py            # Flask 應用程式工廠
│   ├── models/                # Model 層：資料模型
│   │   ├── material.py        # 物料資料模型
│   │   ├── order.py           # 訂單資料模型
│   │   └── traffic.py         # 流量統計資料模型
│   ├── services/              # Service 層：業務邏輯
│   │   ├── cache_service.py   # 快取管理服務
│   │   ├── data_service.py    # 資料載入與處理服務
│   │   ├── spec_service.py    # 規格檔案服務
│   │   └── traffic_service.py # 流量統計服務
│   ├── controllers/           # Controller 層：路由控制
│   │   ├── auth_controller.py # 認證控制器
│   │   ├── page_controller.py # 頁面路由控制器
│   │   └── api_controller.py  # API 路由控制器
│   ├── views/                 # View 層：HTML 模板
│   │   ├── login.html
│   │   ├── order_query.html
│   │   ├── procurement.html
│   │   └── admin_dashboard.html
│   ├── static/                # 靜態資源
│   │   ├── css/
│   │   └── js/
│   ├── utils/                 # 工具函式
│   │   ├── decorators.py      # 裝飾器
│   │   └── helpers.py         # 輔助函式
│   └── config/                # 設定檔
│       ├── settings.py        # 應用程式設定
│       └── paths.py           # 檔案路徑設定
├── run.py                     # 應用程式啟動腳本
├── app_backup.py              # 原 app.py 備份
├── requirements.txt           # Python 套件依賴
└── README.md                  # 本文件
```

### MVC 架構說明

#### Model 層
- **職責**：定義資料結構和資料存取方法
- **檔案**：`models/material.py`、`models/order.py`、`models/traffic.py`
- **主要類別**：
  - `Material` / `MaterialDAO`：物料資料模型和資料存取
  - `Order` / `OrderDAO`：訂單資料模型和資料存取
  - `PageView` / `TrafficDAO`：流量統計資料模型和資料存取

#### Service 層
- **職責**：實作業務邏輯，處理資料轉換和業務規則
- **檔案**：`services/cache_service.py`、`services/data_service.py`、`services/spec_service.py`、`services/traffic_service.py`
- **主要功能**：
  - 雙緩衝快取管理
  - Excel 資料載入與處理
  - 規格檔案彙總與產生
  - 流量統計記錄

#### Controller 層
- **職責**：處理 HTTP 請求，協調 Model 和 View
- **檔案**：`controllers/auth_controller.py`、`controllers/page_controller.py`、`controllers/api_controller.py`
- **主要路由**：
  - 認證：`/login`、`/logout`
  - 頁面：`/`、`/order_query`、`/procurement`、`/admin_dashboard`
  - API：`/api/materials`、`/api/material/<id>/details`、`/api/order/<id>`、`/api/download_specs/<id>`

#### View 層
- **職責**：呈現使用者介面
- **檔案**：`views/*.html`
- **技術**：Jinja2 模板引擎

## 安裝與執行

### 環境需求

- Python 3.7+
- 必要的 Python 套件（見 `requirements.txt`）

### 安裝步驟

1. 安裝依賴套件：
```bash
pip install -r requirements.txt
```

2. 確認設定檔：
   - 檢查 `app/config/paths.py` 中的檔案路徑是否正確
   - 檢查 `app/config/settings.py` 中的應用程式設定

### 啟動應用程式

使用新的 MVC 架構啟動：
```bash
python run.py
```

或使用 PowerShell 腳本：
```powershell
.\start_order_server.ps1
```

應用程式將在 `http://0.0.0.0:5002` 啟動。

### 使用舊版本（備份）

如果需要使用原始版本：
```bash
python app_backup.py
```

## 主要功能

### 1. 物料查詢
- 查看物料庫存狀態
- 查看物料需求詳情
- 查看替代品庫存
- 計算缺料情況

### 2. 訂單管理
- 查詢訂單詳情
- 查看訂單物料清單
- 查看訂單規格
- 下載訂單規格 Excel

### 3. 管理後台
- 查看流量統計
- 查看 IP 訪問記錄
- 系統狀態監控

### 4. 快取機制
- 雙緩衝快取設計
- 定期自動更新（30 分鐘）
- 訂單備註快取（60 分鐘）

## 設定說明

### 應用程式設定 (`app/config/settings.py`)

```python
# Flask 基本設定
SECRET_KEY = 'your_super_secret_key'  # 請修改為安全的金鑰
DEBUG = False

# 伺服器設定
HOST = '0.0.0.0'
PORT = 5002
THREADS = 4

# 快取更新設定
CACHE_UPDATE_INTERVAL = 1800  # 30 分鐘
ORDER_NOTE_CACHE_UPDATE_INTERVAL = 3600  # 60 分鐘
```

### 檔案路徑設定 (`app/config/paths.py`)

請根據實際環境修改以下路徑：
- `INVENTORY_FILE`：零件庫存檔案路徑
- `WIP_PARTS_FILE`：撥料檔案路徑
- `FINISHED_PARTS_FILE`：成品撥料檔案路徑
- 其他相關檔案路徑

## API 文件

### 物料相關 API

#### 取得物料清單
```
GET /api/materials
```

#### 取得物料詳情
```
GET /api/material/<material_id>/details
```

### 訂單相關 API

#### 取得訂單詳情
```
GET /api/order/<order_id>
```

#### 下載訂單規格
```
GET /api/download_specs/<order_id>
```

### 系統相關 API

#### 系統狀態
```
GET /api/status
```

#### 流量統計（需登入）
```
GET /api/admin/traffic
```

## 開發指南

### 新增功能

1. **新增 Model**：在 `app/models/` 中建立新的資料模型
2. **新增 Service**：在 `app/services/` 中建立新的業務邏輯服務
3. **新增 Controller**：在 `app/controllers/` 中建立新的路由控制器
4. **新增 View**：在 `app/views/` 中建立新的 HTML 模板

### 程式碼風格

- 遵循 PEP 8 規範
- 使用有意義的變數和函式名稱
- 為複雜的函式添加文件字串（docstring）
- 適當使用日誌記錄（logging）

## 疑難排解

### 常見問題

1. **資料載入失敗**
   - 檢查 `app/config/paths.py` 中的檔案路徑是否正確
   - 確認檔案是否存在且有讀取權限

2. **快取未更新**
   - 檢查背景執行緒是否正常啟動
   - 查看日誌檔案 `app_errors.log`

3. **模板找不到**
   - 確認模板檔案在 `app/views/` 目錄中
   - 檢查 Flask 應用程式的 `template_folder` 設定

## 版本歷史

### v2.0.0 (MVC 架構重構)
- 採用 MVC 架構設計
- 程式碼模組化，提升可維護性
- 新增完整的 Service 層
- 改善快取管理機制

### v1.0.0 (原始版本)
- 單一檔案架構
- 基本功能實作

## 授權

內部使用專案

## 聯絡資訊

如有問題請聯絡系統管理員。
