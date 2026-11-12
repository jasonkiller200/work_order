/* ==========================================================================
   Hartford AI 採購與規格助手前端控制器 (app/static/js/ai-chat.js)
   - 自動掛載右下角浮動按鈕與可拖曳/8方向自由縮放聊天窗
   - 支援中/英語系 (zh / en) 介面與 AI 回覆雙語切換（供外籍同仁使用）
   - 背景 Job 輪詢、localStorage 引擎記憶與視窗位置記憶
   ========================================================================== */
(function () {
  'use strict';

  var ASSET_VER = '20261112d';
  var STORAGE_RECT_KEY = 'hartford_ai_window_rect_v2';
  var STORAGE_ENGINE_KEY = 'hartford_ai_engine_v1';
  var STORAGE_SESSION_KEY = 'hartford_ai_active_session_v1';
  var STORAGE_LANG_KEY = 'hartford_ai_lang_v1';

  var I18N = {
    zh: {
      fabTooltip: 'Hartford AI 助手',
      fabTitle: '開啟 Hartford AI 採購、規格與 MES 助手',
      title: 'Hartford AI 助手',
      langToggleBtn: '🌐 EN',
      langToggleTitle: 'Switch to English (切換為英文介面與英文回覆)',
      resetPosTitle: '重置視窗位置與預設大小',
      settingsTitle: '引擎設定',
      closeTitle: '縮小視窗',
      resizeTitle: '拖曳縮放視窗大小',
      engineLabel: '本機瀏覽器引擎：',
      engineOpts: {
        vllm_local: '本地 Qwen3.8-27B (vLLM 預設・極速併發)',
        cli: 'Antigravity CLI (Gemini 3.8 Flash 免金鑰)',
        sdk: 'Gemini SDK (API Key)'
      },
      engineBadges: {
        vllm_local: '引擎：本地 Qwen3.8-27B (vLLM)',
        cli: '引擎：Antigravity CLI (Gemini 3.8 Flash)',
        sdk: '引擎：Gemini SDK'
      },
      saveGlobalBtn: '💾 設為全廠預設引擎 (管理員)',
      saveGlobalOk: '已將「{eng}」設為全廠預設引擎！',
      saveGlobalErr: '儲存失敗：',
      sessionSelectTitle: '切換對話串',
      emptySessionOpt: '（尚無對話，直接輸入即可開始）',
      newSessionBtn: '＋ 新對話',
      newSessionTitle: '開新對話',
      newSessionDefaultName: '新對話',
      delSessionTitle: '刪除此對話',
      inputPlaceholder: '輸入問題（如：30日內缺料、100003884規格、MES延遲與異況、哪些單沒有CTS）…',
      sendBtn: '發送',
      welcomeHtml:
        '👋 您好！我是 <strong>Hartford AI 採購、工單規格與 MES 助手</strong>。<br>' +
        '我可以即時查詢記憶體快取中的<strong>缺料總覽、兩週內到貨/延期清單、單一物料 PO/交期明細、工單規格正反向篩選、以及 MES 生產製程/異況/機台位置</strong>。<br>' +
        '<span style="color:#90a4ae;font-size:12px;">請點選下方快速範例或直接輸入問題！（右上角可切換 🌐 EN 英文模式）</span>',
      thinkingHtml: '⏳ <em>Hartford AI 正在查詢即時採購/規格/MES 數據並思考中…</em>',
      sendErrorPrefix: '⚠️ 發送失敗：',
      pollErrorPrefix: '⚠️ 輪詢結果時發生錯誤：',
      noReply: '（無回應）',
      quickPrompts: [
        { label: '📊 缺料與延遲總覽', text: '請給我目前的採購缺料與延遲總覽，並列出最緊急的前10項。' },
        { label: '🏭 MES 製程與異況', text: '請查詢目前 MES 生產管理看板的整體統計，並列出製程 Delay 最嚴重或有異況的工單。' },
        { label: '📅 兩週內到貨與延期', text: '列出未來兩週內預計到貨清單，以及目前交貨延期的項目。' },
        { label: '🔍 查工單規格與製程', text: '請幫我查詢工單 100003884 的規格、MES 目前製程與缺料狀況。' },
        { label: '🚫 哪些單沒有 CTS', text: '請問目前線上哪些工單沒有 CTS（中心出水）？' },
        { label: '⚡ 7.5KW 主軸工單', text: '列出所有規格包含 7.5KW 主軸的工單。' }
      ]
    },
    en: {
      fabTooltip: 'Hartford AI Assistant',
      fabTitle: 'Open Hartford AI Procurement, Spec & MES Assistant',
      title: 'Hartford AI Assistant',
      langToggleBtn: '🌐 中文',
      langToggleTitle: '切換為繁體中文 (Switch to Traditional Chinese)',
      resetPosTitle: 'Reset window position & size',
      settingsTitle: 'Engine Settings',
      closeTitle: 'Minimize window',
      resizeTitle: 'Drag to resize window',
      engineLabel: 'Browser Engine:',
      engineOpts: {
        vllm_local: 'Local Qwen3.8-27B (vLLM Default · Fast)',
        cli: 'Antigravity CLI (Gemini 3.8 Flash Keyless)',
        sdk: 'Gemini SDK (API Key)'
      },
      engineBadges: {
        vllm_local: 'Engine: Local Qwen3.8-27B (vLLM)',
        cli: 'Engine: Antigravity CLI (Gemini 3.8 Flash)',
        sdk: 'Engine: Gemini SDK'
      },
      saveGlobalBtn: '💾 Set as Plant Default Engine (Admin)',
      saveGlobalOk: 'Set "{eng}" as the plant-wide default engine!',
      saveGlobalErr: 'Save failed: ',
      sessionSelectTitle: 'Switch conversation',
      emptySessionOpt: '(No chats yet — type below to start)',
      newSessionBtn: '＋ New Chat',
      newSessionTitle: 'Start a new conversation',
      newSessionDefaultName: 'New Chat',
      delSessionTitle: 'Delete this conversation',
      inputPlaceholder: 'Ask a question (e.g., 30-day shortages, MES delayed orders, order 100003884 specs, orders without CTS)…',
      sendBtn: 'Send',
      welcomeHtml:
        '👋 Hello! I am the <strong>Hartford AI Procurement, Spec & MES Assistant</strong>.<br>' +
        'I can query real-time <strong>shortage summaries, 2-week arrival/delayed lists, material PO/delivery details, work order specifications, and MES production status/locations</strong>.<br>' +
        '<span style="color:#90a4ae;font-size:12px;">Click a quick prompt below or type your question in English! (Click 🌐 中文 on top-right to switch language)</span>',
      thinkingHtml: '⏳ <em>Hartford AI is querying real-time procurement/spec/MES data and thinking…</em>',
      sendErrorPrefix: '⚠️ Failed to send: ',
      pollErrorPrefix: '⚠️ Error polling status: ',
      noReply: '(No response)',
      quickPrompts: [
        { label: '📊 Shortage & Delay Summary', text: 'Please give me the current procurement shortage and delivery delay summary, and list the top 10 most urgent shortage items in English.' },
        { label: '🏭 MES Process & Status', text: 'Please check the MES production board summary and list the work orders with the longest process delays or abnormal status in English.' },
        { label: '📅 2-Week Arrivals & Delays', text: 'Please list the expected arrivals within the next 2 weeks and currently delayed items in English.' },
        { label: '🔍 Order 100003884 Specs', text: 'Please check the specifications, MES process status, and shortage status for work order 100003884 in English.' },
        { label: '🚫 Orders without CTS', text: 'Which active work orders do NOT have CTS (Coolant Through Spindle)? Please reply in English.' },
        { label: '⚡ 7.5KW Spindle Orders', text: 'List all work orders equipped with a 7.5KW spindle in English.' }
      ]
    }
  };

  var state = {
    lang: localStorage.getItem(STORAGE_LANG_KEY) === 'en' ? 'en' : 'zh',
    config: null,
    sessions: [],
    currentSessionId: localStorage.getItem(STORAGE_SESSION_KEY) || null,
    messages: [],
    isPolling: false,
    pollTimer: null,
    avatars: []
  };

  function t(key) {
    var dict = I18N[state.lang] || I18N.zh;
    return dict[key] !== undefined ? dict[key] : I18N.zh[key];
  }

  // ---- 1. 自動載入必要 CSS 與 ai-avatar.js ----
  function ensureAssetsLoaded(callback) {
    function ensureCss(baseHref) {
      var existing = document.querySelector('link[href*="' + baseHref + '"]');
      if (!existing) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = baseHref + '?v=' + ASSET_VER;
        document.head.appendChild(link);
      } else if (existing.href.indexOf('v=' + ASSET_VER) === -1) {
        existing.href = baseHref + '?v=' + ASSET_VER;
      }
    }
    ensureCss('/static/css/ai-avatar.css');
    ensureCss('/static/css/ai-chat.css');

    if (window.HartfordAI) {
      callback();
      return;
    }
    var existingScript = document.querySelector('script[src*="ai-avatar.js"]');
    if (existingScript) {
      existingScript.addEventListener('load', callback);
      return;
    }
    var s = document.createElement('script');
    s.src = '/static/js/ai-avatar.js?v=' + ASSET_VER;
    s.onload = callback;
    document.head.appendChild(s);
  }

  // ---- 2. Avatar 狀態同步 ----
  function registerAvatar(el, size) {
    if (!el || !window.HartfordAI) return;
    window.HartfordAI.inject(el, size);
    state.avatars.push(el);
  }

  function setAllAvatarsState(mode) {
    if (!window.HartfordAI) return;
    state.avatars.forEach(function (el) {
      if (mode === 'answering') {
        window.HartfordAI.setState(el, 'idle');
        window.HartfordAI.flashAnswer(el);
      } else {
        window.HartfordAI.setState(el, mode);
      }
    });
  }

  // ---- 3. 輕量安全 Markdown 渲染器（支援表格、程式碼、粗體、清單） ----
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMarkdown(md) {
    if (!md) return '';
    var text = escapeHtml(md);

    var codeBlocks = [];
    text = text.replace(/```([\w-]*)\n([\s\S]*?)```/g, function (_, lang, code) {
      var idx = codeBlocks.length;
      codeBlocks.push('<pre><code>' + code.trim() + '</code></pre>');
      return '@@CODEBLOCK_' + idx + '@@';
    });

    var lines = text.split('\n');
    var outLines = [];
    var inTable = false;
    var tableRows = [];

    function flushTable() {
      if (!tableRows.length) return;
      var html = '<table><thead><tr>';
      var headers = tableRows[0];
      headers.forEach(function (h) { html += '<th>' + h.trim() + '</th>'; });
      html += '</tr></thead><tbody>';
      for (var i = 1; i < tableRows.length; i++) {
        if (tableRows[i].every(function (c) { return /^[:\-\s]+$/.test(c); })) continue;
        html += '<tr>';
        tableRows[i].forEach(function (c) { html += '<td>' + c.trim() + '</td>'; });
        html += '</tr>';
      }
      html += '</tbody></table>';
      outLines.push(html);
      tableRows = [];
      inTable = false;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf('|') === 0 && line.lastIndexOf('|') === line.length - 1 && line.length > 2) {
        inTable = true;
        var cells = line.slice(1, -1).split('|');
        tableRows.push(cells);
      } else {
        if (inTable) flushTable();
        outLines.push(lines[i]);
      }
    }
    if (inTable) flushTable();

    text = outLines.join('\n');

    text = text
      .replace(/^### (.*)$/gm, '<strong style="font-size:1.05em;color:#90caf9;">$1</strong>')
      .replace(/^## (.*)$/gm, '<strong style="font-size:1.12em;color:#64b5f6;">$1</strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');

    codeBlocks.forEach(function (block, idx) {
      text = text.replace('@@CODEBLOCK_' + idx + '@@', block);
    });
    return text;
  }

  // ---- 4. 建立浮動按鈕與浮動視窗 DOM ----
  function buildFloatingUI() {
    if (document.getElementById('hf-ai-fab')) return;

    // 浮動按鈕
    var fab = document.createElement('div');
    fab.id = 'hf-ai-fab';
    fab.className = 'hf-ai-fab';
    fab.innerHTML = '<div id="hf-ai-fab-avatar"></div><span class="hf-ai-fab-tooltip" id="hf-ai-fab-tooltip"></span>';
    document.body.appendChild(fab);
    registerAvatar(document.getElementById('hf-ai-fab-avatar'), 50);

    // 浮動聊天窗（含 8 個邊角縮放控制區 + 中英切換鈕）
    var drawer = document.createElement('div');
    drawer.id = 'hf-ai-drawer';
    drawer.className = 'hf-ai-drawer';
    drawer.innerHTML =
      '<div class="hf-ai-resizer hf-ai-resizer-n" data-dir="n"></div>' +
      '<div class="hf-ai-resizer hf-ai-resizer-s" data-dir="s"></div>' +
      '<div class="hf-ai-resizer hf-ai-resizer-e" data-dir="e"></div>' +
      '<div class="hf-ai-resizer hf-ai-resizer-w" data-dir="w"></div>' +
      '<div class="hf-ai-resizer hf-ai-resizer-nw" data-dir="nw"></div>' +
      '<div class="hf-ai-resizer hf-ai-resizer-ne" data-dir="ne"></div>' +
      '<div class="hf-ai-resizer hf-ai-resizer-sw" data-dir="sw"></div>' +
      '<div class="hf-ai-resizer hf-ai-resizer-se" id="hf-ai-resizer-se" data-dir="se"></div>' +
      '<div class="hf-ai-drawer-header" id="hf-ai-drag-header">' +
      '<div class="hf-ai-header-left">' +
      '<div id="hf-ai-header-avatar"></div>' +
      '<div class="hf-ai-title-wrap">' +
      '<span class="hf-ai-title" id="hf-ai-title-text">Hartford AI 助手</span>' +
      '<span class="hf-ai-subtitle" id="hf-ai-engine-badge"></span>' +
      '</div>' +
      '</div>' +
      '<div class="hf-ai-header-actions">' +
      '<button type="button" class="hf-ai-lang-btn" id="hf-ai-lang-toggle"></button>' +
      '<button type="button" class="hf-ai-icon-btn hf-ai-reset-pos-btn" id="hf-ai-reset-pos" style="width:30px;flex:0 0 30px;">⟲</button>' +
      '<button type="button" class="hf-ai-icon-btn" id="hf-ai-toggle-settings" style="width:30px;flex:0 0 30px;">⚙️</button>' +
      '<button type="button" class="hf-ai-icon-btn" id="hf-ai-close-drawer" style="width:30px;flex:0 0 30px;">✕</button>' +
      '</div>' +
      '</div>' +
      '<div class="hf-ai-settings-panel" id="hf-ai-settings-panel">' +
      '<div class="hf-ai-settings-row">' +
      '<label for="hf-ai-engine-select" id="hf-ai-engine-label"></label>' +
      '<select id="hf-ai-engine-select" style="flex:1 1 auto;width:auto;">' +
      '<option value="vllm_local"></option>' +
      '<option value="cli"></option>' +
      '<option value="sdk"></option>' +
      '</select>' +
      '</div>' +
      '<div class="hf-ai-settings-row" id="hf-ai-admin-row" style="display:none;">' +
      '<button type="button" class="hf-ai-sm-btn" id="hf-ai-save-global-btn" style="width:100% !important;justify-content:center;"></button>' +
      '</div>' +
      '</div>' +
      '<div class="hf-ai-toolbar">' +
      '<select class="hf-ai-session-select" id="hf-ai-session-select" style="flex:1 1 auto;width:auto;"></select>' +
      '<button type="button" class="hf-ai-sm-btn" id="hf-ai-new-session" style="flex:0 0 auto;width:auto;"></button>' +
      '<button type="button" class="hf-ai-sm-btn" id="hf-ai-del-session" style="flex:0 0 auto;width:auto;">🗑️</button>' +
      '</div>' +
      '<div class="hf-ai-messages" id="hf-ai-messages"></div>' +
      '<div class="hf-ai-chips" id="hf-ai-chips"></div>' +
      '<div class="hf-ai-input-area">' +
      '<textarea class="hf-ai-textarea" id="hf-ai-input" rows="1" style="flex:1 1 auto;width:auto;"></textarea>' +
      '<button type="button" class="hf-ai-send-btn" id="hf-ai-send" style="flex:0 0 auto;width:auto;"></button>' +
      '</div>';

    document.body.appendChild(drawer);
    registerAvatar(document.getElementById('hf-ai-header-avatar'), 36);

    setupDrawerEvents(fab, drawer);
    restoreWindowRect(drawer);
    applyLanguageToUI();
  }

  function applyLanguageToUI() {
    var fab = document.getElementById('hf-ai-fab');
    if (fab) fab.title = t('fabTitle');
    var fabTip = document.getElementById('hf-ai-fab-tooltip');
    if (fabTip) fabTip.textContent = t('fabTooltip');

    var titleEl = document.getElementById('hf-ai-title-text');
    if (titleEl) titleEl.textContent = t('title');

    var langBtn = document.getElementById('hf-ai-lang-toggle');
    if (langBtn) {
      langBtn.textContent = t('langToggleBtn');
      langBtn.title = t('langToggleTitle');
    }

    var resetBtn = document.getElementById('hf-ai-reset-pos');
    if (resetBtn) resetBtn.title = t('resetPosTitle');
    var settingsBtn = document.getElementById('hf-ai-toggle-settings');
    if (settingsBtn) settingsBtn.title = t('settingsTitle');
    var closeBtn = document.getElementById('hf-ai-close-drawer');
    if (closeBtn) closeBtn.title = t('closeTitle');
    var seResizer = document.getElementById('hf-ai-resizer-se');
    if (seResizer) seResizer.title = t('resizeTitle');

    var engLabel = document.getElementById('hf-ai-engine-label');
    if (engLabel) engLabel.textContent = t('engineLabel');

    var engSel = document.getElementById('hf-ai-engine-select');
    if (engSel) {
      var opts = t('engineOpts');
      Array.prototype.forEach.call(engSel.options, function (opt) {
        if (opts[opt.value]) opt.textContent = opts[opt.value];
      });
    }

    var saveGlobalBtn = document.getElementById('hf-ai-save-global-btn');
    if (saveGlobalBtn) saveGlobalBtn.textContent = t('saveGlobalBtn');

    var sessSel = document.getElementById('hf-ai-session-select');
    if (sessSel) sessSel.title = t('sessionSelectTitle');

    var newBtn = document.getElementById('hf-ai-new-session');
    if (newBtn) {
      newBtn.textContent = t('newSessionBtn');
      newBtn.title = t('newSessionTitle');
    }
    var delBtn = document.getElementById('hf-ai-del-session');
    if (delBtn) delBtn.title = t('delSessionTitle');

    var inp = document.getElementById('hf-ai-input');
    if (inp) inp.placeholder = t('inputPlaceholder');

    var sendBtn = document.getElementById('hf-ai-send');
    if (sendBtn) sendBtn.textContent = t('sendBtn');

    updateEngineBadges();
    setupQuickChips(document.getElementById('hf-ai-chips'));
    renderSessionSelectors();
    renderMessages();
  }

  function toggleLanguage() {
    state.lang = state.lang === 'en' ? 'zh' : 'en';
    localStorage.setItem(STORAGE_LANG_KEY, state.lang);
    applyLanguageToUI();
  }

  function setupQuickChips(container) {
    if (!container) return;
    container.innerHTML = '';
    var prompts = t('quickPrompts') || [];
    prompts.forEach(function (item) {
      var chip = document.createElement('span');
      chip.className = 'hf-ai-chip';
      chip.textContent = item.label;
      chip.addEventListener('click', function () {
        sendChatMessage(item.text);
      });
      container.appendChild(chip);
    });
  }

  // ---- 5. 浮動視窗拖曳、8方向自由縮放與 localStorage 位置記憶 ----
  function isMobileViewport() {
    return window.innerWidth <= 640;
  }

  function saveWindowRect(drawer) {
    if (isMobileViewport()) return;
    var rect = drawer.getBoundingClientRect();
    var data = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    try {
      localStorage.setItem(STORAGE_RECT_KEY, JSON.stringify(data));
    } catch (e) { }
  }

  function restoreWindowRect(drawer) {
    if (isMobileViewport()) return;
    try {
      var raw = localStorage.getItem(STORAGE_RECT_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (typeof data.width === 'number' && typeof data.height === 'number') {
        var w = Math.max(340, Math.min(window.innerWidth * 0.96, data.width));
        var h = Math.max(420, Math.min(window.innerHeight * 0.94, data.height));
        var l = Math.max(4, Math.min(window.innerWidth - w - 4, data.left));
        var t = Math.max(4, Math.min(window.innerHeight - h - 4, data.top));
        drawer.style.width = w + 'px';
        drawer.style.height = h + 'px';
        drawer.style.left = l + 'px';
        drawer.style.top = t + 'px';
        drawer.style.right = 'auto';
        drawer.style.bottom = 'auto';
      }
    } catch (e) { }
  }

  function resetWindowRect(drawer) {
    localStorage.removeItem(STORAGE_RECT_KEY);
    drawer.style.width = '460px';
    drawer.style.height = '620px';
    drawer.style.left = 'auto';
    drawer.style.top = 'auto';
    drawer.style.right = '24px';
    drawer.style.bottom = '96px';
  }

  function setupDrawerEvents(fab, drawer) {
    var header = document.getElementById('hf-ai-drag-header');

    fab.addEventListener('click', function () {
      var opening = !drawer.classList.contains('is-open');
      drawer.classList.toggle('is-open', opening);
      if (opening) {
        restoreWindowRect(drawer);
        var inp = document.getElementById('hf-ai-input');
        if (inp) inp.focus();
      }
    });

    document.getElementById('hf-ai-lang-toggle').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleLanguage();
    });

    document.getElementById('hf-ai-close-drawer').addEventListener('click', function () {
      drawer.classList.remove('is-open');
    });

    document.getElementById('hf-ai-reset-pos').addEventListener('click', function (e) {
      e.stopPropagation();
      resetWindowRect(drawer);
    });

    document.getElementById('hf-ai-toggle-settings').addEventListener('click', function (e) {
      e.stopPropagation();
      document.getElementById('hf-ai-settings-panel').classList.toggle('is-open');
    });

    // 標題欄拖曳移動 (Drag)
    var dragState = null;
    header.addEventListener('mousedown', function (e) {
      if (isMobileViewport()) return;
      if (e.target.closest('button')) return;
      var rect = drawer.getBoundingClientRect();
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: rect.left,
        origTop: rect.top,
        width: rect.width,
        height: rect.height
      };
      drawer.classList.add('is-dragging');
      e.preventDefault();
    });

    // 8 方向自由縮放 (Resize: n, s, e, w, nw, ne, sw, se)
    var resizeState = null;
    var resizers = drawer.querySelectorAll('.hf-ai-resizer');
    resizers.forEach(function (handle) {
      handle.addEventListener('mousedown', function (e) {
        if (isMobileViewport()) return;
        var dir = handle.getAttribute('data-dir') || 'se';
        var rect = drawer.getBoundingClientRect();
        resizeState = {
          dir: dir,
          startX: e.clientX,
          startY: e.clientY,
          origLeft: rect.left,
          origTop: rect.top,
          origRight: rect.right,
          origBottom: rect.bottom,
          origW: rect.width,
          origH: rect.height
        };
        drawer.style.left = rect.left + 'px';
        drawer.style.top = rect.top + 'px';
        drawer.style.width = rect.width + 'px';
        drawer.style.height = rect.height + 'px';
        drawer.style.right = 'auto';
        drawer.style.bottom = 'auto';
        drawer.classList.add('is-resizing');
        e.preventDefault();
        e.stopPropagation();
      });
    });

    window.addEventListener('mousemove', function (e) {
      if (dragState) {
        var dx = e.clientX - dragState.startX;
        var dy = e.clientY - dragState.startY;
        var newLeft = Math.max(4, Math.min(window.innerWidth - dragState.width - 4, dragState.origLeft + dx));
        var newTop = Math.max(4, Math.min(window.innerHeight - dragState.height - 4, dragState.origTop + dy));
        drawer.style.left = newLeft + 'px';
        drawer.style.top = newTop + 'px';
        drawer.style.right = 'auto';
        drawer.style.bottom = 'auto';
      } else if (resizeState) {
        var minW = 340;
        var minH = 420;
        var dxR = e.clientX - resizeState.startX;
        var dyR = e.clientY - resizeState.startY;
        var dir = resizeState.dir;

        var newL = resizeState.origLeft;
        var newT = resizeState.origTop;
        var newW = resizeState.origW;
        var newH = resizeState.origH;

        if (dir.indexOf('e') !== -1) {
          newW = Math.min(window.innerWidth - resizeState.origLeft - 4, Math.max(minW, resizeState.origW + dxR));
        }
        if (dir.indexOf('s') !== -1) {
          newH = Math.min(window.innerHeight - resizeState.origTop - 4, Math.max(minH, resizeState.origH + dyR));
        }
        if (dir.indexOf('w') !== -1) {
          var candW = resizeState.origW - dxR;
          var candL = resizeState.origLeft + dxR;
          if (candL < 4) {
            candL = 4;
            candW = resizeState.origRight - 4;
          }
          if (candW >= minW) {
            newW = candW;
            newL = candL;
          } else {
            newW = minW;
            newL = resizeState.origRight - minW;
          }
        }
        if (dir.indexOf('n') !== -1) {
          var candH = resizeState.origH - dyR;
          var candT = resizeState.origTop + dyR;
          if (candT < 4) {
            candT = 4;
            candH = resizeState.origBottom - 4;
          }
          if (candH >= minH) {
            newH = candH;
            newT = candT;
          } else {
            newH = minH;
            newT = resizeState.origBottom - minH;
          }
        }

        drawer.style.left = newL + 'px';
        drawer.style.top = newT + 'px';
        drawer.style.width = newW + 'px';
        drawer.style.height = newH + 'px';
      }
    });

    window.addEventListener('mouseup', function () {
      if (dragState) {
        drawer.classList.remove('is-dragging');
        dragState = null;
        saveWindowRect(drawer);
      }
      if (resizeState) {
        drawer.classList.remove('is-resizing');
        resizeState = null;
        saveWindowRect(drawer);
      }
    });

    // 引擎選擇器
    var engineSel = document.getElementById('hf-ai-engine-select');
    engineSel.addEventListener('change', function () {
      localStorage.setItem(STORAGE_ENGINE_KEY, engineSel.value);
      updateEngineBadges();
    });

    // 管理員存為全廠預設
    var saveGlobalBtn = document.getElementById('hf-ai-save-global-btn');
    if (saveGlobalBtn) {
      saveGlobalBtn.addEventListener('click', function () {
        saveGlobalConfig(engineSel.value);
      });
    }

    // 對話串下拉與按鈕
    document.getElementById('hf-ai-session-select').addEventListener('change', function (e) {
      loadSessionMessages(e.target.value);
    });
    document.getElementById('hf-ai-new-session').addEventListener('click', function () {
      createNewSession();
    });
    document.getElementById('hf-ai-del-session').addEventListener('click', function () {
      if (state.currentSessionId) deleteSession(state.currentSessionId);
    });

    // 發送訊息
    var inputEl = document.getElementById('hf-ai-input');
    var sendBtn = document.getElementById('hf-ai-send');
    sendBtn.addEventListener('click', function () {
      var val = inputEl.value.trim();
      if (val) {
        inputEl.value = '';
        sendChatMessage(val);
      }
    });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });
  }

  // ---- 6. API 互動與畫面渲染 ----
  function getActiveEngine() {
    var local = localStorage.getItem(STORAGE_ENGINE_KEY);
    if (local) return local;
    if (state.config && state.config.engine_mode) return state.config.engine_mode;
    return 'vllm_local';
  }

  function updateEngineBadges() {
    var eng = getActiveEngine();
    var badges = t('engineBadges') || {};
    var txt = badges[eng] || ('Engine: ' + eng);
    var el = document.getElementById('hf-ai-engine-badge');
    if (el) el.textContent = txt;
  }

  function saveGlobalConfig(engineMode) {
    fetch('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ai_engine_mode: engineMode })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.success) {
          state.config = res.config;
          alert(t('saveGlobalOk').replace('{eng}', engineMode));
        } else {
          alert(t('saveGlobalErr') + (res.error || 'Admin required'));
        }
      })
      .catch(function (err) {
        alert(t('saveGlobalErr') + err);
      });
  }

  function fetchConfigAndSessions() {
    fetch('/api/ai/config')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.success && res.config) {
          state.config = res.config;
          var activeEng = getActiveEngine();
          var engSel = document.getElementById('hf-ai-engine-select');
          if (engSel) engSel.value = activeEng;
          updateEngineBadges();
          if (res.config.is_admin) {
            var adminRow = document.getElementById('hf-ai-admin-row');
            if (adminRow) adminRow.style.display = 'flex';
          }
        }
      })
      .catch(function () { });

    refreshSessionsList(true);
  }

  function refreshSessionsList(loadCurrent) {
    fetch('/api/ai/sessions')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.success) return;
        state.sessions = res.sessions || [];
        renderSessionSelectors();
        if (loadCurrent) {
          var targetId = state.currentSessionId;
          var exists = state.sessions.some(function (s) { return s.id === targetId; });
          if (exists) {
            loadSessionMessages(targetId);
          } else if (state.sessions.length > 0) {
            loadSessionMessages(state.sessions[0].id);
          } else {
            state.currentSessionId = null;
            state.messages = [];
            renderMessages();
          }
        }
      })
      .catch(function () { });
  }

  function renderSessionSelectors() {
    var sel = document.getElementById('hf-ai-session-select');
    if (!sel) return;
    sel.innerHTML = '';
    if (state.sessions.length === 0) {
      var optEmpty = document.createElement('option');
      optEmpty.value = '';
      optEmpty.textContent = t('emptySessionOpt');
      sel.appendChild(optEmpty);
    } else {
      state.sessions.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.title + ' (' + (s.updated_at || '').slice(5) + ')';
        if (s.id === state.currentSessionId) opt.selected = true;
        sel.appendChild(opt);
      });
    }
  }

  function loadSessionMessages(sessionId) {
    if (!sessionId) return;
    state.currentSessionId = sessionId;
    localStorage.setItem(STORAGE_SESSION_KEY, sessionId);
    renderSessionSelectors();

    fetch('/api/ai/sessions/' + encodeURIComponent(sessionId))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.success && res.session) {
          state.messages = res.session.messages || [];
          renderMessages();
        }
      })
      .catch(function () { });
  }

  function createNewSession() {
    fetch('/api/ai/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: t('newSessionDefaultName') })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.success && res.session) {
          state.currentSessionId = res.session.id;
          localStorage.setItem(STORAGE_SESSION_KEY, res.session.id);
          state.messages = [];
          refreshSessionsList(false);
          renderMessages();
        }
      });
  }

  function deleteSession(sessionId) {
    fetch('/api/ai/sessions/' + encodeURIComponent(sessionId), { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.success) {
          if (state.currentSessionId === sessionId) {
            state.currentSessionId = null;
            localStorage.removeItem(STORAGE_SESSION_KEY);
          }
          refreshSessionsList(true);
        }
      });
  }

  function renderMessages() {
    var box = document.getElementById('hf-ai-messages');
    if (!box) return;

    box.innerHTML = '';
    if (state.messages.length === 0) {
      var welcome = document.createElement('div');
      welcome.className = 'hf-ai-msg hf-ai-msg-assistant';
      welcome.innerHTML = t('welcomeHtml');
      box.appendChild(welcome);
    } else {
      state.messages.forEach(function (m) {
        var div = document.createElement('div');
        div.className = 'hf-ai-msg ' + (m.role === 'user' ? 'hf-ai-msg-user' : 'hf-ai-msg-assistant');
        if (m.role === 'user') {
          div.textContent = m.content;
        } else {
          var html = renderMarkdown(m.content);
          var metaParts = [];
          if (m.tool_calls && m.tool_calls.length > 0) {
            m.tool_calls.forEach(function (tc) {
              metaParts.push('<span class="hf-ai-tool-badge">🔧 ' + escapeHtml(tc.name) + '</span>');
            });
          }
          if (m.engine_label) {
            metaParts.push('<span>⚡ ' + escapeHtml(m.engine_label) + '</span>');
          }
          if (metaParts.length > 0) {
            html += '<div class="hf-ai-msg-meta">' + metaParts.join('') + '</div>';
          }
          div.innerHTML = html;
        }
        box.appendChild(div);
      });
    }

    if (state.isPolling) {
      var thinkingDiv = document.createElement('div');
      thinkingDiv.className = 'hf-ai-msg hf-ai-msg-assistant';
      thinkingDiv.innerHTML = t('thinkingHtml');
      box.appendChild(thinkingDiv);
    }

    box.scrollTop = box.scrollHeight;
  }

  function setInputsDisabled(disabled) {
    ['hf-ai-send', 'hf-ai-input'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  }

  function sendChatMessage(text) {
    if (state.isPolling || !text) return;

    state.messages.push({ role: 'user', content: text });
    state.isPolling = true;
    setInputsDisabled(true);
    setAllAvatarsState('thinking');
    renderMessages();

    var payload = {
      message: text,
      session_id: state.currentSessionId,
      engine_mode: getActiveEngine(),
      lang: state.lang
    };

    fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.success || !res.job_id) {
          throw new Error(res.error || 'Failed to start AI job');
        }
        state.currentSessionId = res.session_id;
        localStorage.setItem(STORAGE_SESSION_KEY, res.session_id);
        refreshSessionsList(false);
        pollJobStatus(res.job_id);
      })
      .catch(function (err) {
        state.isPolling = false;
        setInputsDisabled(false);
        setAllAvatarsState('idle');
        state.messages.push({
          role: 'assistant',
          content: t('sendErrorPrefix') + err.message,
          engine_label: 'error'
        });
        renderMessages();
      });
  }

  function pollJobStatus(jobId) {
    if (state.pollTimer) clearTimeout(state.pollTimer);

    fetch('/api/ai/job/' + encodeURIComponent(jobId))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.success) {
          throw new Error(res.error || 'Failed to query job status');
        }
        if (res.status === 'running') {
          state.pollTimer = setTimeout(function () {
            pollJobStatus(jobId);
          }, 1100);
          return;
        }
        state.isPolling = false;
        setInputsDisabled(false);
        setAllAvatarsState('answering');
        state.messages.push({
          role: 'assistant',
          content: res.reply || t('noReply'),
          tool_calls: res.tool_calls || [],
          engine_label: res.engine_label || ''
        });
        renderMessages();
        refreshSessionsList(false);
      })
      .catch(function (err) {
        state.isPolling = false;
        setInputsDisabled(false);
        setAllAvatarsState('idle');
        state.messages.push({
          role: 'assistant',
          content: t('pollErrorPrefix') + err.message,
          engine_label: 'error'
        });
        renderMessages();
      });
  }

  // ---- 7. 啟動初始化 ----
  function initHartfordAIChat() {
    ensureAssetsLoaded(function () {
      buildFloatingUI();
      fetchConfigAndSessions();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHartfordAIChat);
  } else {
    initHartfordAIChat();
  }
})();
