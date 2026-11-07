# 使用統計 → 專業流量統計：整合方案（定案）

日期：2026-11-07
討論：agy（gemini-4-argon-high）＋ opencode，各出完整方案（本目錄 traffic_plan_agy.md / traffic_plan_opencode.md），彙整＋交叉檢查後定案。
背景：Flask LAN 內網採購儀表板，正式入口 `run.py`（Waitress 12 threads、0.0.0.0:5002），真實 DB `instance/order_management.db`（25.5MB、journal_mode=delete）。目前統計 = `page_views.json`（505KB、2026-03-04~11-06、11 頁 9,028 筆 180 IP，約 37 PV/日）。

## 已定案決策

1. **DB 位置：獨立 `instance/analytics.db`**（與業務 DB 隔離；purge/VACUUM 不搶鎖；回滾＝刪檔；備份獨立）。
2. **寫入策略：同步短交易 INSERT＋try/except 非致命**（37 PV/日，不需佇列；統計壞絕不讓 5002 回 500）。
3. **UV 定義：cookie `pv_vid`（UUID4、HttpOnly、SameSite=Lax、1 年）為主 UV**；IP UV 與登入「活躍使用者」為獨立並列指標（不混算）。
4. **員工歸因：無 IP↔人員對照清單（使用者確認）＋DHCP IP 會飄 → IP 別名表移出方案**。登入前「到人」＝「到裝置」（cookie visitor_id 粒度）；真正的到人統計靠 Phase 3 登入接 users 表。
5. **舊入口 app.py：保留但改呼叫同一個 TrafficService**（防有人直接 `python app.py` 繞過新系統；不改 API 契約）。
6. **舊 JSON：一次性冪等匯入 analytics.db**（逐頁逐 IP 對帳 9,028 筆）→ 原檔更名封存（page_views.json.bak），停止寫入。
7. **API 契約：`/api/admin/traffic` 回傳 shape 100% 不變**（含 `+08:00` ISO）；新統計端點全走新前綴 `/api/admin/analytics/*`。
8. **⚠️ Phase 1 第一項：`/api/admin/traffic` 加 `@login_required`**（頁面有擋、API 本身裸奔——內網直接打 URL 可拿全廠 IP 瀏覽紀錄；一行之修）。
9. **排除 IP：`192.168.6.119`（使用者辦公室 PC＝服務主機）不計入統計**（使用者 11/07 指定）。可設定清單 `EXCLUDED_IPS`，同機 localhost（127.0.0.1/::1）一併排除；寫入時打 `excluded=1` 旗標（原始紀錄保留、新統計全數過濾），遷移時該 IP 的歷史筆一併標 excluded；舊 API 行為不變（照舊包含）。

## 資料模型（analytics.db）

```
page_view_events(id PK, ts_utc, local_date, local_hour, local_weekday,
  page, path, ip, user_id NULL, visitor_id, user_agent, referrer,
  is_bot, excluded INT DEFAULT 0, source json)
  索引：(local_date)、(page, local_date)、(visitor_id, local_date)、(local_hour, local_weekday)
daily_page_rollups(local_date, page, views, uv, ip_count, PRIMARY KEY(local_date, page))  -- Phase 2
daily_uv_rollups(local_date, uv, ip_count, active_users, PRIMARY KEY(local_date))          -- Phase 2
```
- local_* 欄位於**寫入時**用 Asia/Taipei（UTC+8）算好，查詢免轉時區。
- is_bot：UA 比對（curl/python-requests/headless 等），新統計預設排除 bot；舊 API 不過滤。
- 新統計一律 `WHERE excluded=0`（192.168.6.119 等 EXCLUDED_IPS 不計入任何新指標）；kiosk/共用機日后可加進 EXCLUDED_IPS。

## API（新前綴，全部 @login_required）

- `GET /api/admin/analytics/dashboard?from&to` → 合成：KPI 卡（總瀏覽/UV/IP 數/活躍使用者/回訪率）、日趨勢、top pages
- `GET /api/admin/analytics/trend?from&to` → 每日 views/uv 折線
- `GET /api/admin/analytics/heatmap?from&to` → 7×24 hour×weekday 矩陣
- `GET /api/admin/analytics/users?from&to` → 排行（登入前＝各裝置 visitor_id 粒度；Phase 3 接 users 後＝各帳號）
- `GET /api/admin/analytics/recent?limit` → 即時紀錄
- 驗證失敗回 **401 JSON**（不是 login_required 預設 302 HTML）；讀取 15 秒記憶體快取。

## 前端（admin dashboard 重構）

- **Chart.js 4.x 本機靜態檔**（app/static/js/vendor/chart.umd.min.js，禁 CDN）＋現有 flatpickr 選日期；7×24 熱圖用原生 CSS Grid（免 matrix 外掛）。
- 版面：篩選列 → 5 張 KPI 卡 → 日趨勢＋Top pages 雙欄 → 7×24 熱圖 → 折疊頁籤（活躍裝置排行／經典各頁明細／即時紀錄）。
- 深淺色主題跟現行；輸出跳脫防 DOM XSS。

## 併發／性能／保留

- 寫入：WAL＋busy_timeout(3000)＋短交易；record_page_view 耗時 <1ms；fail-open（DB 例外只記 log）。
- 讀取：Phase 1 直接查 raw（萬筆級，p95 <500ms 夠）；Phase 2 加 daily rollups（昨日以前讀 rollup＋今日即時）。
- 保留：raw 事件 **365 天**（約 2~4 萬列/年，幾 MB）、rollups 永久；跨日自動分批 DELETE（限 500 列/筆），月底 VACUUM 排程。
- 備份：WAL 模式下用 SQLite `.backup` API 或連 `-wal` 檔一起備份。

## 階段

- **Phase 1（MVP，2~3 人日）**：① `/api/admin/traffic` 補 `@login_required`；② analytics.db 建表＋WAL；③ record_page_view 改寫事件表（page/path/ip/UA/referrer/visitor cookie/ts）＋pv_vid cookie 補發（after_request）；④ JSON 一次性遷移＋封存；⑤ /api/admin/analytics/dashboard+trend+pages；⑥ admin 頁 KPI 卡＋日趨勢＋Top pages 圖表。
- **Phase 2**：7×24 熱圖、daily rollups＋365 天自動清理、app.py 改接同一 service。
- **Phase 3**：登入接 users 表（真正的到人使用統計）、關鍵業務動作埋點（查詢工單/缺料/下載規格）、頁面 P50/P95 耗時、月報 Excel 匯出。

## 驗收（Phase 1）

1. 未登入打 `/api/admin/traffic` → 401；登入後 shape 與舊版逐欄位一致。
2. 遷移後逐頁逐 IP 計數 == 舊 JSON（9,028 筆全對）。
3. 手動瀏覽各頁 → 事件表出現正確 local_date/hour/weekday/UA/visitor_id。
4. 殺 DB（改路徑）→ 頁面照常回應、log 有告警（fail-open）。
5. admin 頁 KPI/趨勢/Top pages 與 DB 實際數字一致；Chart.js 離線可用。
6. 5002 重啟前後功能無回歸（**重啟需先經使用者同意**）。
7. 192.168.6.119 的瀏覽記為 excluded=1、不計入任何新統計；舊 API 數字與以前一致。

## 風險

- 勿連錯根目錄 0-byte `order_management.db`（正式是 instance/ 下）。
- 攔截只掛頁面路由，勿攔 `/api/status`（右上角心跳輪詢會灌水）。
- 遷移腳本必冪等（跑兩次結果相同）；原 JSON 封存不刪。
- 測試用 5003 端口或 DB 副本，勿直接動 5002 生產。