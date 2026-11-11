# AI 助手功能規劃（order 專案前端）

> 狀態：**規劃完成、未動工**（2026-11-05 memo；2026-11-11 補評估＋Hartford AI 動態圖像規劃＋架構優化定案，見 §3、§7–§9）。使用者指示「有空再來玩」——開工前請先讀完本檔。
> 模式定案：**`vllm_local`（本地 Qwen3.8-27B，預設）＋`agy CLI` 免金鑰備援／進階切換＋`sdk` 備用**；**不做 RAG**（資料每 15 分鐘動態變動，全面採用 `cache_manager` 記憶體快取＋結構化唯讀 Tools 即時查詢）。

## 1. 背景與結論（全部實測驗證過，2026-11-05）

- 目標：order 專案（Flask port 5002）前端加 AI 助手互動應用（採購數據問答）。
- **`google-antigravity` Python SDK（0.1.23，已裝進 order venv）不能用 CLI 免金鑰**：
  - 實測 `Agent(config=LocalAgentConfig(...))` 不傳 api_key → `AntigravityValidationError: A Gemini API key is required`（Python 驗證層在 localharness 啟動前就擋）
  - 官方 issue #20（Support Google Account OAuth and reuse of CLI auth file）仍開放
  - SDK 的 localharness.exe 與 agy 共用 `~/.gemini/antigravity` 資料目錄＋keyring 登入（target `gemini:antigravity`），架構上「未來可以」，目前卡 SDK 驗證層
- **agy CLI 免金鑰可行（採用）**：
  - `agy -p "..." --output-format json` → 乾淨 JSON：`{conversation_id, status, response, duration_seconds, num_turns, usage}`，簡單問題 ~8 秒
  - `--conversation <ID>` 可續指定對話（實測 num_turns 遞增、`cache_read_tokens` 快取有效）
  - token 自動管理：跑一次 `agy -p` 會把 keyring token 刷新（Windows Credential Manager target `gemini:antigravity`）
- agy 路徑（本機）：`C:\Users\ralf\AppData\Local\agy\bin\agy.exe`（on PATH as `agy`）

## 2. 參考藍本：garage 專案 `ai_controller.py`

使用者另一專案（頂級黑手智慧車庫管理系統）的 `AI 汽機車維修助手 Controller`，已驗證的 7 個模式直接照搬：

1. **雙引擎架構**：SDK 模式（有 key，Function Calling）＋ CLI 免金鑰 fallback（無 key 自動備援），DB 設定 `ai_engine_mode`＝sdk/cli 可切換
2. **背景 job＋輪詢**：`start_async_chat()` → job_id → `get_job_status()`；解決手機區網瀏覽器長連線逾時/螢幕休眠導致 fetch 中斷
3. **SQLite 持久化**：`ai_sessions`／`ai_messages`（tool_calls JSON、engine_label、sdk_conversation_id、第一句自動產生標題 `_derive_session_title`）
4. **唯讀 Python tools**（Function Calling，SDK 模式）：garage 版 4 支（車隊清單/保養履歷/零件庫/歷史搜尋）→ order 版改成採購 4 支
5. **每回合重新注入最新快照**（CLI 模式 stateless＋帶最近 10 則歷史）：數據 15 分就變（17:30 快照、15 分 refresh），每次回答都是現數據
6. **全域 `subprocess.Popen.__init__` monkeypatch 加 `CREATE_NO_WINDOW`**：背景服務不彈黑窗
7. **`--effort low`＋預設 model `gemini-3.8-flash`**：聊天 UX 偏快

garage 專案的 CLI fallback 指令（參考）：
```
agy -p <system_prompt+歷史+提問> --output-format text --disable-slash-commands --effort low
cwd = 空工作目錄、timeout=120s、CREATE_NO_WINDOW
```

## 3. order 版設計

### 3.1 檔案
- `app/ai_controller.py`（照 garage 藍本改）
  - `AiController`：sessions CRUD、`chat()`、`start_async_chat()`、`get_job_status()`、`get_config_status()`／`update_config()`
  - `_run_vllm_local_agent()`：本地 Qwen3.8-27B 主路徑（OpenAI-compatible 原生 Function Calling，直連 `cache_manager` 唯讀 tools）
  - `_run_cli_fallback()`：agy CLI 免金鑰路徑（stateless 重注入）
  - `_run_sdk_agent_async()`：SDK 路徑（有 key 才啟用；workspaces＝空目錄、禁用全部檔案/執行工具、enable_subagents=False）
- routes（blueprint）：
  - `GET /api/ai/sessions`、`POST /api/ai/sessions`、`GET /api/ai/sessions/<id>`、`DELETE /api/ai/sessions/<id>`（免登入，綁 `pv_vid` cookie）
  - `POST /api/ai/chat`（回 job_id＋session_id，免登入）
  - `GET /api/ai/job/<job_id>`（免登入）
  - `GET /api/ai/config`（免登入讀取）、`POST /api/ai/config`（**掛 `@login_required`**，僅管理員可改 DB 全域預設引擎與 API key；一般使用者走前端 `localStorage` 自選）
- `order_management.db` 加兩表：`ai_sessions(id, visitor_id, title, sdk_conversation_id, created_at, updated_at)`、`ai_messages(id, session_id, role, content, tool_calls, engine_label, created_at)`
- 前端：右下角浮動窗（主入口）＋ `/ai` 獨立頁（左側對話串清單＋右側聊天區＋⚙️ 引擎設定）

### 3.2 資料來源與上下文（不做 RAG，直連 `cache_manager` 記憶體快取）
採購與規格資料每 15 分鐘動態刷新，**原則上不做向量 RAG**（避免索引延遲與否定條件漏單），全部由 server 端從 `cache_manager.get_current_data()` 與 DB 唯讀餵食（agent 不碰 DB/檔案）：
- **零磁碟 I/O 複用現有雙緩衝快取**：`DataService` 每 15 分鐘已將半品/成品儀表板（`materials_dashboard`、`finished_dashboard`）、需求明細（`demand_details_map`）、工單總表摘要（`order_summary_map`）及工單規格總表（`specs_map`、`specs_data`）載入記憶體，Tools 直接 O(1) 或記憶體遍歷讀取，不重複讀 P 碟 Excel。
- 採購人員對照、延遲定義＝到貨日−缺料需求日。

### 3.3 唯讀 tools（`vllm_local` 與 `sdk` 原生 Function Calling；共 6 支）
1. `get_shortage_summary()`：缺料/延遲總覽（從 `materials_dashboard` / `finished_dashboard` 彙整）
2. `get_material_detail(material_id)`：單物料明細（庫存、缺料工單、PO、buyer、到貨排程、替代品）
3. `get_two_week_list(buyer=None)`：兩週內/延期交貨清單（可選填採購員過濾）
4. `search_procurement(keyword)`：跨物料品號/品名/工單/供應商關鍵字搜尋
5. `get_order_specs(order_id)`：**單筆訂單規格查詢**——直接讀取記憶體 `cache_manager.get_current_data()["specs_map"][order_id]` 並附帶 `order_summary_map`（客戶、機型、出貨日），零磁碟 I/O、隨系統 15 分鐘快取同步更新。實例問法：「100003884 規格」「這單主軸幾 KW」「有 CTS 嗎」
   - **agy CLI 模式**（無 function calling）：問題含 9 位工單號（regex）或品號 → 自動把該單規格/物料明細注入 prompt（同「每回合重注入」機制）
6. `search_orders_by_spec(spec_keyword, value_keyword=None, exclude=False)`：**反向/條件規格篩選**（取代原 Phase 2 RAG）——直接在記憶體對線上工單的 `specs_data` 進行結構化條件過濾（支援正向匹配與 `exclude=True` 否定條件），100% 精確且耗時 `< 10ms`。實例問法：「哪些單沒有 CTS」「列出所有 7.5KW 主軸單」

### 3.4 安全與權限隔離
- 工作目錄鎖死在空目錄（`order/scratch/ai_chat_ws` 之類）；不傳 `--add-dir`
- tools 全部唯讀（只讀 `cache_manager` 記憶體快取與 DB 查詢）
- CLI 模式不加 `--dangerously-skip-permissions`（照 garage 藍本：prompt 約束＋空工作目錄；非互動模式需要授權的 tool 會被拒，安全）
- 對話串 **per 瀏覽器隔離（複用現成 `pv_vid` Cookie）**：直接讀取 `app/__init__.py` 已發放的 365 天效期 `pv_vid`（`Config.PV_COOKIE_NAME`，缺時 fallback 至 Flask session），未登入的一般採購/生管人員重開瀏覽器也不會遺失對話紀錄
- 權限切分：問答與個人對話串 API 免登入開放廠內使用；修改系統全域設定 `POST /api/ai/config` 強制 `@login_required`
- CLI 用 stateless 重注入（不用 `--conversation`）→ 不跟 Hermes 的 agy bot 共享 agy 對話庫

### 3.5 設定
- 引擎三選一（2026-11-11 優化定案）：
  - **vllm_local**（**預設**）：**本地 Qwen3.8-27B**（`http://192.168.7.22:8001/v1`、model `/home/jason/models/Qwen3.8-27B-AWQ-INT4`、OpenAI-compatible、**原生 function calling 2026-11-11 實測正確**、66 tok ~1s）——支援 6 支唯讀 tools 按需拉取動態資料、資料不出區網、免金鑰、**不跟 agy 單實例搶**、可多人併發
  - **cli**：agy CLI 免金鑰、Gemini 3.8 Flash——深度推理/備援切換用（stateless 快照注入）
  - **sdk**：Gemini API key（有值才啟用）
- 切換層級：DB 全域預設（`vllm_local`）＋**前端 ⚙️ 每瀏覽器可自選引擎**（localStorage 覆寫）
- **vLLM 請求必帶 `chat_template_kwargs: {"enable_thinking": false}`**——Qwen3 會把英文思考文字漏進 content（2026-11-11 實測），關掉思考模式
- 預設 model：vllm_local＝`/home/jason/models/Qwen3.8-27B-AWQ-INT4`（224k context）；cli＝`gemini-3.8-flash`
- `google-antigravity` 0.1.23 已裝 order venv（Python 3.13.9）

## 4. 執行順序（開工時照做）
1. DB 兩表＋`app/ai_controller.py`（`vllm_local` Function Calling ＋ `cli` 雙軌實作，6 支唯讀 tools 接 `cache_manager`）
2. routes＋curl 測通（先不接前端）
3. 前端頁面（右下角 Hartford AI 浮動窗＋`/ai` 獨立頁）
4. **重啟 5002 → 挑沒人用的時段、使用者明確點頭才動**（上班時間可能有其他人在用）
- 開工時先刪掉 `C:\app\order\ai_assistant.py`（11/05 早先寫的初版 wrapper，被這版取代）

## 5. 待使用者拍板（開工前）
1. 助手範圍＝採購數據問答（缺料/交期/兩週清單/物料）？還要多加什麼（例如餵 SAP 匯出檔）？
2. 多使用者：per 瀏覽器各自對話串，對嗎？
3. 前端：獨立頁面 vs 儀表板側欄/浮動窗？

## 6. 其他備註
- 測試殘留在 scratch（自動清理）：`venv-gemini`（測試 venv）、`agy_oauth_test.py`、`antigravity_sdk_test.py`、probe*.json
- agy keyring 解碼怪癖（若要直接讀 token）：keyring 把 blob 誤解成 UTF-16LE → `raw.encode("utf-16-le").decode("utf-8")` 才是 JSON；token 值屬憑證，不可印進聊天/日誌
- agy 模型清單：`agy models`（Claude Opus/Sonnet 5.5、Gemini 3.8 Flash、GPT-OSS 120B…）；長任務慣用 `gemini-4-argon-high`
- 一次只跑一個 agy 程序（共享 CLI；Hermes agy bot 也在用）→ wrapper 加全域 lock

## 7. 評估（2026-11-11 複核，全部現狀已實測）

**結論：可行性高，可照 §4 順序動工。** 四塊要件全部現成：

| 層 | 現狀 | 風險 |
|---|---|---|
| 資料 | `cache_manager.get_current_data()` 每 15 分鐘已載入採購儀表板、需求明細、工單總表與 `specs_map`/`specs_data`；零磁碟 I/O、不做 RAG，agent 只讀不碰 DB/P 碟 | 低 |
| 模型 | 預設 **`vllm_local`（7.22:8001 Qwen3.8-27B，原生 Function Calling、可併發）**；備援 **`agy 1.5.4`**（免金鑰）＋`sdk` | 低 |
| 藍本 | garage `ai_controller.py` 7 模式已驗證 | 低 |
| 應用 | Flask＋Pico CSS＋`app/views/*.html` 分頁；問答免登入（綁 `pv_vid` cookie）、全域設定 `POST /api/ai/config` 掛 `@login_required` | 低 |

風險與對策：
1. **agy 單實例 contention**：已將 **`vllm_local`（本地 Qwen3.8-27B，7.22:8001）設為預設引擎**，獨立實例、可多人併發且支援 6 支唯讀 tools；Hermes agy bot 與 order app 共用的 `agy CLI` 作為第二引擎並加全域 lock＋排隊保護。
2. **延遲**：`vllm_local` 呼叫約 1–3s、`agy CLI` 約 8–40s → 統一走 async job＋輪詢（藍本模式 2，已含）。
3. **資料時效（不做 RAG）**：5002 背景 15 分 refresh `cache_manager` → `vllm_local` tools 直接讀最新記憶體快取、`agy CLI` 每回合重注入最新快照，回答永遠是當下最新數據，無向量索引過期或否定條件漏單問題。
4. **生產重啟**：5002 多人共用 → 加路由/前端後重啟一次，挑沒人用時段＋使用者點頭（§4 第 4 步）。
5. **安全與隔離**：個人對話綁 365 天 `pv_vid` cookie、修改系統預設設定需管理員 `@login_required`；CLI stateless、空工作目錄、tools 全唯讀、不加 `--dangerously-skip-permissions`（§3.4 維持）。

## 8. Hartford AI 動態圖像（入口識別）

目標：一個用戶一眼認得出「這是 AI 助手」的動態形象，作為進入問答的入口。

**形象設計**
- 角色「Hartford AI」小機器人：頭＝主軸夾頭/4 爪意象（貼公司主軸業務），Hartford 藍 `#1e88e5`＋銀灰金屬、圓潤友善
- 三態 CSS keyframes 動畫：
  - **idle**：輕微浮動＋偶爾眨眼（呼吸感，提示可點擊）
  - **thinking**：光環脈動/天線閃爍（agent 執行中）
  - **answering/完成**：短暫提亮一次
- 實作：SVG 角色＋`ai-avatar.css` 動畫（任意解析度銳利、跟隨淺/深色主題、~5KB）；AI 生成位圖則嵌進圓形視窗再包 CSS 動畫
- 放置：
  1. **全域右下角浮動按鈕**（56–64px 圓，主入口，所有頁可見）← 用戶識別入口
  2. 聊天 drawer 標題（帶三態動畫）
  3. `/ai` 獨立頁 header（放大版）
  4. 選配：favicon 靜止一帧（現 favicon 為藍底 P 字，保留或並列）
- **浮動聊天窗行為（2026-11-11 使用者要求）**：
  - **可自由移動**：拖曳標題欄整窗移動（drag，游標 move、防觸碰選取）
  - **可縮放**：拖右下角 handle 調寬/高（min 320x400、max 視口 90%）
  - **記住狀態**：位置＋尺寸存 localStorage（per 瀏覽器），下次開窗同位置
  - **重置鈕**：標題欄小鈕，一鍵回到右下角預設位置/預設尺寸
  - **手機適配**：浮動窗在手機（窄視口）自動變全螢幕 sheet，不啟用拖曳/縮放（無空間拖）
  - 移動/縮放用純 JS＋CSS（transform/width/height），不引第三方 drag 套件
- 檔案：`app/static/images/hartford-ai/`（角色素材）、`app/static/css/ai-avatar.css`、`app/static/js/ai-chat.js`

**角色製作兩條路（可並行、由使用者定案）**
- **A 手繪 SVG**：我直接畫，快（當天可出）、銳利、動畫最順；風格偏「icon 化」
- **B AI 生成**：本機 ComfyUI＋Z-Image-Turbo（5090）出 2–3 張候選（同_prompt：圓潤機器人、主軸夾頭頭、Hartford 藍）→ 使用者挑一 → 去背＋嵌 SVG 框；質感較「像圖」但為位圖
- 建議：A 先出原型接上功能、B 並行出圖讓使用者選，最終形象以使用者為準

## 9. 待拍板項目——**已定案（2026-11-11 使用者拍板＋架構優化）**
1. **範圍（不做 RAG）**：採購數據問答（缺料/延遲/兩週清單/到貨/物料明細）＋**訂單規格正反向查詢**（直接從 `cache_manager` 記憶體中的 `specs_map` 與 `specs_data` 查詢單筆工單規格或按條件篩選工單，不做向量 RAG，確保動態資料 100% 即時精確）。
2. **多使用者與權限**：per 瀏覽器各自對話串（直接綁現有 365 天效期的 `pv_vid` cookie，fallback Flask session）；問答 API 免登入開放廠內使用，`POST /api/ai/config` 全域設定掛 `@login_required`。
3. **前端形態**：浮動按鈕（主入口）＋ `/ai` 獨立頁，兩者都上。
4. **Hartford AI 形象**：**只手繪 SVG**（不用 AI 生成）——主軸夾頭頭小機器人、Hartford 藍 #1e88e5、三態動畫（idle/thinking/answering），已就位於 `app/static/js/ai-avatar.js` 與 `app/static/css/ai-avatar.css`。
5. **模型引擎**：**本地 Qwen3.8-27B（`vllm_local`，7.22:8001，預設）**＋agy CLI（Gemini，免金鑰切換/備援）＋Gemini SDK（備用）；每瀏覽器可在 ⚙️ 自選（`localStorage`）。