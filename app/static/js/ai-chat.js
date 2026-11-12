/* ==========================================================================
   Hartford AI 採購與規格助手前端控制器 (app/static/js/ai-chat.js)
   - 自動掛載右下角浮動按鈕與可拖曳/可縮放聊天窗
   - 支援 /ai 獨立頁面雙欄模式
   - 背景 Job 輪詢、localStorage 引擎記憶與視窗位置記憶
   ========================================================================== */
(function () {
  'use strict';

  var STORAGE_RECT_KEY = 'hartford_ai_window_rect_v1';
  var STORAGE_ENGINE_KEY = 'hartford_ai_engine_v1';
  var STORAGE_SESSION_KEY = 'hartford_ai_active_session_v1';

  var QUICK_PROMPTS = [
    { label: '📊 缺料與延遲總覽', text: '請給我目前的採購缺料與延遲總覽，並列出最緊急的前10項。' },
    { label: '📅 兩週內到貨與延期', text: '列出未來兩週內預計到貨清單，以及目前交貨延期的項目。' },
    { label: '🔍 查工單規格', text: '請幫我查詢工單 100003884 的規格與缺料狀況。' },
    { label: '🚫 哪些單沒有 CTS', text: '請問目前線上哪些工單沒有 CTS（中心出水）？' },
    { label: '⚡ 7.5KW 主軸工單', text: '列出所有規格包含 7.5KW 主軸的工單。' }
  ];

  var state = {
    config: null,
    sessions: [],
    currentSessionId: localStorage.getItem(STORAGE_SESSION_KEY) || null,
    messages: [],
    isPolling: false,
    pollTimer: null,
    avatars: []
  };

  // ---- 1. 自動載入必要 CSS 與 ai-avatar.js ----
  function ensureAssetsLoaded(callback) {
    function ensureCss(href) {
      if (!document.querySelector('link[href*="' + href + '"]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
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
    s.src = '/static/js/ai-avatar.js';
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

    // Code blocks ```...```
    var codeBlocks = [];
    text = text.replace(/```([\w-]*)\n([\s\S]*?)```/g, function (_, lang, code) {
      var idx = codeBlocks.length;
      codeBlocks.push('<pre><code>' + code.trim() + '</code></pre>');
      return '@@CODEBLOCK_' + idx + '@@';
    });

    // Markdown Tables
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
        // 跳過分隔列 |---|---|
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

    // Headings, bold, inline code, lists
    text = text
      .replace(/^### (.*)$/gm, '<strong style="font-size:1.05em;color:#90caf9;">$1</strong>')
      .replace(/^## (.*)$/gm, '<strong style="font-size:1.12em;color:#64b5f6;">$1</strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');

    // Restore code blocks
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
    fab.title = '開啟 Hartford AI 採購與規格助手';
    fab.innerHTML = '<div id="hf-ai-fab-avatar"></div><span class="hf-ai-fab-tooltip">Hartford AI 助手</span>';
    document.body.appendChild(fab);
    registerAvatar(document.getElementById('hf-ai-fab-avatar'), 50);

    // 浮動聊天窗
    var drawer = document.createElement('div');
    drawer.id = 'hf-ai-drawer';
    drawer.className = 'hf-ai-drawer';
    drawer.innerHTML =
      '<div class="hf-ai-drawer-header" id="hf-ai-drag-header">' +
      '<div class="hf-ai-header-left">' +
      '<div id="hf-ai-header-avatar"></div>' +
      '<div class="hf-ai-title-wrap">' +
      '<span class="hf-ai-title">Hartford AI 助手</span>' +
      '<span class="hf-ai-subtitle" id="hf-ai-engine-badge">載入引擎中…</span>' +
      '</div>' +
      '</div>' +
      '<div class="hf-ai-header-actions">' +
      '<button type="button" class="hf-ai-icon-btn hf-ai-reset-pos-btn" id="hf-ai-reset-pos" title="重置視窗位置與大小">⟲</button>' +
      '<button type="button" class="hf-ai-icon-btn" id="hf-ai-open-page" title="於獨立大頁面開啟 (/ai)">⛶</button>' +
      '<button type="button" class="hf-ai-icon-btn" id="hf-ai-toggle-settings" title="引擎設定">⚙️</button>' +
      '<button type="button" class="hf-ai-icon-btn" id="hf-ai-close-drawer" title="縮小視窗">✕</button>' +
      '</div>' +
      '</div>' +
      '<div class="hf-ai-settings-panel" id="hf-ai-settings-panel">' +
      '<div class="hf-ai-settings-row">' +
      '<label for="hf-ai-engine-select">本機瀏覽器引擎：</label>' +
      '<select id="hf-ai-engine-select">' +
      '<option value="vllm_local">本地 Qwen3.8-27B (vLLM 預設・極速併發)</option>' +
      '<option value="cli">Antigravity CLI (Gemini 3.8 Flash 免金鑰)</option>' +
      '<option value="sdk">Gemini SDK (API Key)</option>' +
      '</select>' +
      '</div>' +
      '<div class="hf-ai-settings-row" id="hf-ai-admin-row" style="display:none;">' +
      '<button type="button" class="hf-ai-sm-btn" id="hf-ai-save-global-btn" style="width:100%;justify-content:center;">💾 設為全廠預設引擎 (管理員)</button>' +
      '</div>' +
      '</div>' +
      '<div class="hf-ai-toolbar">' +
      '<select class="hf-ai-session-select" id="hf-ai-session-select" title="切換對話串"></select>' +
      '<button type="button" class="hf-ai-sm-btn" id="hf-ai-new-session" title="開新對話">＋ 新對話</button>' +
      '<button type="button" class="hf-ai-sm-btn" id="hf-ai-del-session" title="刪除此對話">🗑️</button>' +
      '</div>' +
      '<div class="hf-ai-messages" id="hf-ai-messages"></div>' +
      '<div class="hf-ai-chips" id="hf-ai-chips"></div>' +
      '<div class="hf-ai-input-area">' +
      '<textarea class="hf-ai-textarea" id="hf-ai-input" rows="1" placeholder="詢問缺料、兩週清單、工單規格 (如 100003884 或 哪些單沒有CTS)…"></textarea>' +
      '<button type="button" class="hf-ai-send-btn" id="hf-ai-send">發送</button>' +
      '</div>' +
      '<div class="hf-ai-resize-handle" id="hf-ai-resize-handle" title="拖曳調整大小"></div>';

    document.body.appendChild(drawer);
    registerAvatar(document.getElementById('hf-ai-header-avatar'), 36);

    setupQuickChips(document.getElementById('hf-ai-chips'));
    setupDrawerEvents(fab, drawer);
    restoreWindowRect(drawer);
  }

  function setupQuickChips(container) {
    if (!container) return;
    container.innerHTML = '';
    QUICK_PROMPTS.forEach(function (item) {
      var chip = document.createElement('span');
      chip.className = 'hf-ai-chip';
      chip.textContent = item.label;
      chip.addEventListener('click', function () {
        sendChatMessage(item.text);
      });
      container.appendChild(chip);
    });
  }

  // ---- 5. 浮動視窗拖曳、縮放與 localStorage 位置記憶 ----
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
        var w = Math.max(320, Math.min(window.innerWidth * 0.9, data.width));
        var h = Math.max(400, Math.min(window.innerHeight * 0.9, data.height));
        var l = Math.max(8, Math.min(window.innerWidth - w - 8, data.left));
        var t = Math.max(8, Math.min(window.innerHeight - h - 8, data.top));
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
    drawer.style.width = '430px';
    drawer.style.height = '600px';
    drawer.style.left = 'auto';
    drawer.style.top = 'auto';
    drawer.style.right = '24px';
    drawer.style.bottom = '96px';
  }

  function setupDrawerEvents(fab, drawer) {
    var header = document.getElementById('hf-ai-drag-header');
    var resizeHandle = document.getElementById('hf-ai-resize-handle');

    fab.addEventListener('click', function () {
      if (window.location.pathname === '/ai') {
        var pageInput = document.getElementById('hf-ai-page-input');
        if (pageInput) pageInput.focus();
        return;
      }
      var opening = !drawer.classList.contains('is-open');
      drawer.classList.toggle('is-open', opening);
      if (opening) {
        restoreWindowRect(drawer);
        var inp = document.getElementById('hf-ai-input');
        if (inp) inp.focus();
      }
    });

    document.getElementById('hf-ai-close-drawer').addEventListener('click', function () {
      drawer.classList.remove('is-open');
    });

    document.getElementById('hf-ai-reset-pos').addEventListener('click', function (e) {
      e.stopPropagation();
      resetWindowRect(drawer);
    });

    document.getElementById('hf-ai-open-page').addEventListener('click', function (e) {
      e.stopPropagation();
      window.location.href = '/ai';
    });

    document.getElementById('hf-ai-toggle-settings').addEventListener('click', function (e) {
      e.stopPropagation();
      document.getElementById('hf-ai-settings-panel').classList.toggle('is-open');
    });

    // 拖曳移動 (Drag)
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

    // 拖曳縮放 (Resize)
    var resizeState = null;
    resizeHandle.addEventListener('mousedown', function (e) {
      if (isMobileViewport()) return;
      var rect = drawer.getBoundingClientRect();
      resizeState = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: rect.left,
        origTop: rect.top,
        origW: rect.width,
        origH: rect.height
      };
      drawer.style.left = rect.left + 'px';
      drawer.style.top = rect.top + 'px';
      drawer.style.right = 'auto';
      drawer.style.bottom = 'auto';
      drawer.classList.add('is-resizing');
      e.preventDefault();
      e.stopPropagation();
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
        var dw = e.clientX - resizeState.startX;
        var dh = e.clientY - resizeState.startY;
        var maxW = Math.min(window.innerWidth * 0.9, window.innerWidth - resizeState.origLeft - 8);
        var maxH = Math.min(window.innerHeight * 0.9, window.innerHeight - resizeState.origTop - 8);
        var newW = Math.max(320, Math.min(maxW, resizeState.origW + dw));
        var newH = Math.max(400, Math.min(maxH, resizeState.origH + dh));
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
      syncEngineSelectors(engineSel.value);
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

  // ---- 6. 綁定 /ai 獨立頁面事件（若當前在 /ai 頁） ----
  function setupStandalonePageIfPresent() {
    var pageContainer = document.getElementById('hf-ai-page-container');
    if (!pageContainer) return;

    var pageAvatar = document.getElementById('hf-ai-page-avatar');
    if (pageAvatar) registerAvatar(pageAvatar, 64);

    setupQuickChips(document.getElementById('hf-ai-page-chips'));

    var pageEngineSel = document.getElementById('hf-ai-page-engine-select');
    if (pageEngineSel) {
      pageEngineSel.addEventListener('change', function () {
        localStorage.setItem(STORAGE_ENGINE_KEY, pageEngineSel.value);
        updateEngineBadges();
        syncEngineSelectors(pageEngineSel.value);
      });
    }

    var pageNewBtn = document.getElementById('hf-ai-page-new-session');
    if (pageNewBtn) {
      pageNewBtn.addEventListener('click', function () {
        createNewSession();
      });
    }

    var pageSendBtn = document.getElementById('hf-ai-page-send');
    var pageInput = document.getElementById('hf-ai-page-input');
    if (pageSendBtn && pageInput) {
      pageSendBtn.addEventListener('click', function () {
        var val = pageInput.value.trim();
        if (val) {
          pageInput.value = '';
          sendChatMessage(val);
        }
      });
      pageInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          pageSendBtn.click();
        }
      });
    }
  }

  // ---- 7. API 互動與畫面渲染 ----
  function getActiveEngine() {
    var local = localStorage.getItem(STORAGE_ENGINE_KEY);
    if (local) return local;
    if (state.config && state.config.engine_mode) return state.config.engine_mode;
    return 'vllm_local';
  }

  function syncEngineSelectors(val) {
    ['hf-ai-engine-select', 'hf-ai-page-engine-select'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.value !== val) el.value = val;
    });
  }

  function updateEngineBadges() {
    var eng = getActiveEngine();
    var labelMap = {
      vllm_local: '引擎：本地 Qwen3.8-27B (vLLM)',
      cli: '引擎：Antigravity CLI (Gemini 3.8 Flash)',
      sdk: '引擎：Gemini SDK'
    };
    var txt = labelMap[eng] || ('引擎：' + eng);
    ['hf-ai-engine-badge', 'hf-ai-page-engine-badge'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = txt;
    });
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
          alert('已將「' + engineMode + '」設為全廠預設引擎！');
        } else {
          alert('儲存失敗：' + (res.error || '需要管理員登入'));
        }
      })
      .catch(function (err) {
        alert('儲存設定發生錯誤：' + err);
      });
  }

  function fetchConfigAndSessions() {
    fetch('/api/ai/config')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.success && res.config) {
          state.config = res.config;
          var activeEng = getActiveEngine();
          syncEngineSelectors(activeEng);
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
    // 1. 浮動窗下拉選單
    var sel = document.getElementById('hf-ai-session-select');
    if (sel) {
      sel.innerHTML = '';
      if (state.sessions.length === 0) {
        var optEmpty = document.createElement('option');
        optEmpty.value = '';
        optEmpty.textContent = '（尚無對話，直接輸入即可開始）';
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

    // 2. /ai 獨立頁左側清單
    var listEl = document.getElementById('hf-ai-page-session-list');
    if (listEl) {
      listEl.innerHTML = '';
      if (state.sessions.length === 0) {
        listEl.innerHTML = '<div style="padding:12px;color:#90a4ae;font-size:12.5px;">尚無歷史對話，請直接在右側提問。</div>';
      } else {
        state.sessions.forEach(function (s) {
          var item = document.createElement('div');
          item.className = 'hf-ai-session-item' + (s.id === state.currentSessionId ? ' active' : '');
          item.innerHTML =
            '<span class="hf-ai-session-item-title">' + escapeHtml(s.title) + '</span>' +
            '<button type="button" class="hf-ai-session-del" title="刪除">✕</button>';
          item.addEventListener('click', function (e) {
            if (e.target.classList.contains('hf-ai-session-del')) {
              e.stopPropagation();
              deleteSession(s.id);
              return;
            }
            loadSessionMessages(s.id);
          });
          listEl.appendChild(item);
        });
      }
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
      body: JSON.stringify({ title: '新對話' })
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
    var containers = [
      document.getElementById('hf-ai-messages'),
      document.getElementById('hf-ai-page-messages')
    ].filter(Boolean);

    containers.forEach(function (box) {
      box.innerHTML = '';
      if (state.messages.length === 0) {
        var welcome = document.createElement('div');
        welcome.className = 'hf-ai-msg hf-ai-msg-assistant';
        welcome.innerHTML =
          '👋 您好！我是 <strong>Hartford AI 採購與工單規格助手</strong>。<br>' +
          '我可以即時查詢記憶體快取中的<strong>缺料總覽、兩週內到貨/延期清單、單一物料 PO/交期明細、以及工單規格正反向篩選</strong>。<br>' +
          '<span style="color:#90a4ae;font-size:12px;">請點選下方快速範例或直接輸入問題！</span>';
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
        thinkingDiv.innerHTML = '⏳ <em>Hartford AI 正在查詢即時採購/規格數據並思考中…</em>';
        box.appendChild(thinkingDiv);
      }

      box.scrollTop = box.scrollHeight;
    });
  }

  function setInputsDisabled(disabled) {
    ['hf-ai-send', 'hf-ai-page-send', 'hf-ai-input', 'hf-ai-page-input'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  }

  function sendChatMessage(text) {
    if (state.isPolling || !text) return;

    // 樂觀更新使用者訊息
    state.messages.push({ role: 'user', content: text });
    state.isPolling = true;
    setInputsDisabled(true);
    setAllAvatarsState('thinking');
    renderMessages();

    var payload = {
      message: text,
      session_id: state.currentSessionId,
      engine_mode: getActiveEngine()
    };

    fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.success || !res.job_id) {
          throw new Error(res.error || '啟動 AI 任務失敗');
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
          content: '⚠️ 發送失敗：' + err.message,
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
          throw new Error(res.error || '查詢任務狀態失敗');
        }
        if (res.status === 'running') {
          state.pollTimer = setTimeout(function () {
            pollJobStatus(jobId);
          }, 1100);
          return;
        }
        // 完成或失敗
        state.isPolling = false;
        setInputsDisabled(false);
        setAllAvatarsState('answering');
        state.messages.push({
          role: 'assistant',
          content: res.reply || '（無回應）',
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
          content: '⚠️ 輪詢結果時發生錯誤：' + err.message,
          engine_label: 'error'
        });
        renderMessages();
      });
  }

  // ---- 8. 啟動初始化 ----
  function initHartfordAIChat() {
    ensureAssetsLoaded(function () {
      buildFloatingUI();
      setupStandalonePageIfPresent();
      fetchConfigAndSessions();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHartfordAIChat);
  } else {
    initHartfordAIChat();
  }
})();

