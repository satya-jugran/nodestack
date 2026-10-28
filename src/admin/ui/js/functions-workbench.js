// Serverless Functions Dedicated Workbench & Code Editor Module
// Companion module for NodeStack Admin UI Functions

// ==========================================
// 1. Context API (ctx) Documentation & Snippets
// ==========================================

const CTX_DOCS = [
  // HTTP Request (ctx.request)
  {
    name: 'ctx.request.body',
    type: 'any',
    cat: 'request',
    desc: 'Parsed JSON payload sent in HTTP POST/PATCH invocation',
    snippet: 'const body = ctx.request?.body || {};\n'
  },
  {
    name: 'ctx.request.query',
    type: 'Record<string, any>',
    cat: 'request',
    desc: 'URL query string parameters (e.g. ?limit=10&status=active)',
    snippet: 'const { limit, status } = ctx.request?.query || {};\n'
  },
  {
    name: 'ctx.request.auth',
    type: '{ id, role, email } | null',
    cat: 'request',
    desc: 'Authenticated caller identity, or null if public invocation',
    snippet: 'if (!ctx.request?.auth) return { status: 401, body: { error: "Unauthorized" } };\n'
  },
  {
    name: 'ctx.request.headers',
    type: 'Record<string, string>',
    cat: 'request',
    desc: 'HTTP request headers map (lowercase header keys)',
    snippet: 'const authHeader = ctx.request?.headers["authorization"];\n'
  },
  {
    name: 'ctx.request.method',
    type: "'GET' | 'POST' | 'PATCH' | 'DELETE'",
    cat: 'request',
    desc: 'HTTP method used to invoke this function',
    snippet: 'const method = ctx.request?.method;\n'
  },

  // DB Lifecycle Event (ctx.event)
  {
    name: 'ctx.event.record',
    type: 'Record<string, any>',
    cat: 'event',
    desc: 'Target database record being mutated during collection lifecycle hook',
    snippet: 'const record = ctx.event?.record;\n'
  },
  {
    name: 'ctx.event.collection',
    type: 'string',
    cat: 'event',
    desc: 'Target collection name triggering this lifecycle event',
    snippet: 'const collection = ctx.event?.collection;\n'
  },
  {
    name: 'ctx.event.action',
    type: "'create' | 'update' | 'delete'",
    cat: 'event',
    desc: 'Collection mutation action triggering this hook',
    snippet: 'const action = ctx.event?.action;\n'
  },
  {
    name: 'ctx.event.isBefore',
    type: 'boolean',
    cat: 'event',
    desc: 'true for before-write hooks (can validate or cancel write), false for after-write',
    snippet: 'if (ctx.event?.isBefore && !isValid) return { status: 400, body: { cancel: true, reason: "Validation failed" } };\n'
  },

  // Database CRUD (ctx.records)
  {
    name: 'ctx.records.get(col, id)',
    type: 'Promise<Record>',
    cat: 'records',
    desc: 'Fetch a single record by collection name and record ID',
    snippet: 'const item = await ctx.records.get("products", id);\n'
  },
  {
    name: 'ctx.records.list(col, opts)',
    type: 'Promise<{ items, totalItems }>',
    cat: 'records',
    desc: 'Query records with filter, sort, page, and perPage options',
    snippet: 'const { items, totalItems } = await ctx.records.list("orders", { filter: "status = \'paid\'", perPage: 20 });\n'
  },
  {
    name: 'ctx.records.create(col, data)',
    type: 'Promise<Record>',
    cat: 'records',
    desc: 'Create and insert a new record into target collection',
    snippet: 'const newRec = await ctx.records.create("audit_events", { event: "checkout", timestamp: new Date().toISOString() });\n'
  },
  {
    name: 'ctx.records.update(col, id, data)',
    type: 'Promise<Record>',
    cat: 'records',
    desc: 'Update fields on an existing database record',
    snippet: 'await ctx.records.update("products", productId, { inStock: false });\n'
  },
  {
    name: 'ctx.records.delete(col, id)',
    type: 'Promise<boolean>',
    cat: 'records',
    desc: 'Delete a record from database by collection name and ID',
    snippet: 'await ctx.records.delete("temp_tokens", tokenId);\n'
  },

  // Outbound Network, Secrets & Logging
  {
    name: 'ctx.fetch(url, options)',
    type: 'Promise<{ ok, status, json(), text() }>',
    cat: 'utils',
    desc: 'SSRF-guarded outbound HTTP request to third-party APIs',
    snippet: 'const res = await ctx.fetch("https://api.example.com/data", { method: "POST" });\nconst data = await res.json();\n'
  },
  {
    name: 'ctx.env',
    type: 'Record<string, string>',
    cat: 'utils',
    desc: 'Environment variables and secrets defined in the JSON configuration below',
    snippet: 'const secretKey = ctx.env.MY_API_KEY;\n'
  },
  {
    name: 'ctx.log(...args)',
    type: '(...args: any[]) => void',
    cat: 'utils',
    desc: 'Structured execution logging captured in the function Execution Logs tab',
    snippet: 'ctx.log("Processing execution step", { step: 1, time: Date.now() });\n'
  },
  {
    name: 'ctx.app',
    type: '{ id, slug, name }',
    cat: 'utils',
    desc: 'Current tenant application identification and slug',
    snippet: 'const { id, slug } = ctx.app;\n'
  }
];

function renderCtxItemsHtml(activeCategory = 'all') {
  return CTX_DOCS.map(item => {
    const isVisible = activeCategory === 'all' || item.cat === activeCategory;
    const jsSnippetArg = JSON.stringify(item.snippet).replace(/"/g, '&quot;');
    return `
      <div class="ctx-item" data-cat="${item.cat}" style="display: ${isVisible ? 'flex' : 'none'}; flex-direction: column; gap: 4px; padding: 7px 10px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border-subtle); font-size: 11.5px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
            <code style="color: var(--accent-primary); font-weight: 600; font-size: 12px; white-space: nowrap;">${escapeHtml(item.name)}</code>
            <span style="font-size: 10px; color: var(--text-muted); padding: 1px 5px; background: var(--bg-input); border-radius: 3px; border: 1px solid var(--border-subtle); white-space: nowrap;">${escapeHtml(item.type)}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="insertFunctionSnippet(${jsSnippetArg})" style="font-size: 10px; padding: 2px 7px; flex-shrink: 0;" title="Click to insert snippet into code editor">
            + Insert
          </button>
        </div>
        <div style="color: var(--text-muted); font-size: 11px; line-height: 1.35;">
          ${escapeHtml(item.desc)}
        </div>
      </div>
    `;
  }).join('');
}

function insertFunctionSnippet(snippet) {
  if (functionsState.cmEditor) {
    functionsState.cmEditor.replaceSelection(snippet);
    functionsState.cmEditor.save();
    functionsState.cmEditor.focus();
    return;
  }
  const textarea = document.getElementById('fn-editor-code');
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;

  if (start !== undefined && end !== undefined && start >= 0) {
    textarea.value = val.substring(0, start) + snippet + val.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
  } else {
    textarea.value += '\n' + snippet;
  }
  textarea.focus();
}

function filterCtxCategory(category) {
  const buttons = document.querySelectorAll('.ctx-cat-btn');
  buttons.forEach(btn => {
    const isTarget = btn.getAttribute('data-cat') === category;
    if (isTarget) {
      btn.classList.add('active');
      btn.style.background = 'var(--accent-primary)';
      btn.style.color = '#fff';
    } else {
      btn.classList.remove('active');
      btn.style.background = 'var(--bg-card)';
      btn.style.color = 'var(--text-muted)';
    }
  });

  const items = document.querySelectorAll('.ctx-item');
  items.forEach(item => {
    const cat = item.getAttribute('data-cat');
    item.style.display = (category === 'all' || cat === category) ? 'flex' : 'none';
  });
}

function filterCtxSearch(query) {
  const q = (query || '').toLowerCase().trim();
  const items = document.querySelectorAll('.ctx-item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = (!q || text.includes(q)) ? 'flex' : 'none';
  });
}

function applyStarterRecipe(key) {
  if (!key || !STARTER_RECIPES[key]) return;
  if (functionsState.cmEditor) {
    functionsState.cmEditor.setValue(STARTER_RECIPES[key]);
    functionsState.cmEditor.save();
    functionsState.cmEditor.focus();
    return;
  }
  const area = document.getElementById('fn-editor-code');
  if (area) {
    area.value = STARTER_RECIPES[key];
    area.focus();
  }
}

function toggleWorkbenchCtxRef(forceState) {
  if (typeof forceState === 'boolean') {
    functionsState.isCtxRefExpanded = forceState;
  } else {
    functionsState.isCtxRefExpanded = !functionsState.isCtxRefExpanded;
  }

  const header = document.getElementById('workbench-ctx-header');
  const content = document.getElementById('workbench-ctx-content');
  const btn = document.getElementById('btn-toggle-workbench-ctx');
  const toolbarBtn = document.getElementById('btn-toolbar-toggle-ctx');

  if (header) {
    header.style.borderBottom = functionsState.isCtxRefExpanded ? '1px solid var(--border-subtle)' : 'none';
  }
  if (content) {
    content.style.display = functionsState.isCtxRefExpanded ? 'flex' : 'none';
  }
  if (btn) {
    btn.textContent = functionsState.isCtxRefExpanded ? 'Hide Reference ▴' : 'Show Reference ▾';
  }
  if (toolbarBtn) {
    toolbarBtn.style.background = functionsState.isCtxRefExpanded ? 'var(--accent-primary)' : 'var(--bg-card-hover)';
    toolbarBtn.style.color = functionsState.isCtxRefExpanded ? '#fff' : 'var(--text-main)';
  }
}

// ==========================================
// 2. CodeMirror Integration & Themes
// ==========================================

function getCodeMirrorTheme() {
  if (typeof ThemeManager !== 'undefined' && typeof ThemeManager.getEffectiveTheme === 'function') {
    return ThemeManager.getEffectiveTheme() === 'light' ? 'eclipse' : 'dracula';
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    return document.documentElement.classList.contains('light') ? 'eclipse' : 'dracula';
  }
  return 'dracula';
}

function initFunctionCodeMirror() {
  if (typeof CodeMirror === 'undefined') return;
  const codeArea = document.getElementById('fn-editor-code');
  if (!codeArea) return;

  if (functionsState.cmEditor) {
    try {
      functionsState.cmEditor.toTextArea();
    } catch (_) {}
    functionsState.cmEditor = null;
  }

  try {
    functionsState.cmEditor = CodeMirror.fromTextArea(codeArea, {
      mode: { name: 'javascript', typescript: true },
      theme: getCodeMirrorTheme(),
      lineNumbers: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      tabSize: 2,
      indentWithTabs: false,
      lineWrapping: true,
      extraKeys: {
        'Tab': function(cm) {
          cm.replaceSelection('  ');
        },
        'Ctrl-S': function() {
          saveFunctionEditor();
        },
        'Cmd-S': function() {
          saveFunctionEditor();
        }
      }
    });

    functionsState.cmEditor.on('change', () => {
      functionsState.cmEditor.save();
    });

    setTimeout(() => {
      functionsState.cmEditor?.refresh();
    }, 50);
  } catch (err) {
    console.warn('CodeMirror initialization skipped or failed:', err);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('nodestack-theme-changed', (e) => {
    if (functionsState.cmEditor) {
      const isLight = (e.detail && e.detail.effective === 'light') || getCodeMirrorTheme() === 'eclipse';
      functionsState.cmEditor.setOption('theme', isLight ? 'eclipse' : 'dracula');
    }
  });
}

// ==========================================
// 3. Workbench Routing & Navigation
// ==========================================

function openCreateFunctionPage() {
  openFunctionEditor('new', true, 'code');
}

async function openFunctionEditor(idOrName = 'new', pushState = true, initialTab = 'code') {
  let fn;

  if (idOrName === 'new' || !idOrName) {
    fn = {
      isNew: true,
      id: '',
      name: '',
      description: '',
      code: STARTER_RECIPES.starter,
      enabled: true,
      authPolicy: 'public',
      methods: ['GET', 'POST'],
      eventTrigger: '',
      timeoutMs: 1000,
      memoryLimitMb: 32,
      allowedDomains: [],
      elevated: false,
      env: {},
    };
  } else {
    fn = (functionsState.functions || []).find(f => f.id === idOrName || f.name === idOrName);

    if (!fn) {
      try {
        const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
        const endpoint = slug && slug !== 'default'
          ? `/api/apps/${slug}/functions/${encodeURIComponent(idOrName)}`
          : `/api/functions/${encodeURIComponent(idOrName)}`;
        fn = await api(endpoint);
      } catch (_) {}
    }

    if (!fn) {
      toast(`Function '${idOrName}' not found`, 'error');
      if (typeof selectNav === 'function') selectNav('functions', false);
      return;
    }
  }

  functionsState.currentView = 'editor';
  functionsState.activeFunctionForEdit = fn;
  functionsState.editorTab = initialTab || 'code';

  if (pushState && typeof updateUrl === 'function') {
    updateUrl(fn.isNew ? '/_/functions/new' : '/_/functions/' + encodeURIComponent(fn.name || fn.id));
  }

  if (typeof updateBreadcrumbs === 'function') {
    updateBreadcrumbs();
  }

  renderFunctionEditorView(fn);
}

function closeFunctionEditor(pushState = true) {
  if (functionsState.cmEditor) {
    try {
      functionsState.cmEditor.toTextArea();
    } catch (_) {}
    functionsState.cmEditor = null;
  }
  functionsState.currentView = 'list';
  functionsState.activeFunctionForEdit = null;

  if (pushState && typeof updateUrl === 'function') {
    updateUrl('/_/functions');
  }

  if (typeof updateBreadcrumbs === 'function') {
    updateBreadcrumbs();
  }

  if (typeof renderFunctionsView === 'function') {
    renderFunctionsView();
  }
}

function switchFunctionEditorTab(tab) {
  functionsState.editorTab = tab;
  ['code', 'test', 'config', 'logs'].forEach(t => {
    const btn = document.getElementById('editor-tab-btn-' + t);
    const pane = document.getElementById('fn-editor-pane-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
    if (pane) {
      if (t === 'code') {
        pane.style.display = (t === tab) ? 'flex' : 'none';
        if (t === tab && functionsState.cmEditor) {
          setTimeout(() => { functionsState.cmEditor?.refresh(); }, 20);
        }
      } else if (t === 'test' || t === 'config') {
        pane.style.display = (t === tab) ? 'grid' : 'none';
      } else if (t === 'logs') {
        pane.style.display = (t === tab) ? 'flex' : 'none';
      }
    }
  });

  if (tab === 'logs' && typeof loadFunctionEditorLogs === 'function') {
    loadFunctionEditorLogs();
  }
}

function syncEditorFunctionName(val) {
  const clean = (val || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const headerInput = document.getElementById('fn-editor-name-header');
  const configInput = document.getElementById('fn-editor-name');
  if (headerInput && headerInput.value !== clean) headerInput.value = clean;
  if (configInput && configInput.value !== clean) configInput.value = clean;
  if (functionsState.activeFunctionForEdit) {
    functionsState.activeFunctionForEdit.name = clean;
  }
  const preview = document.getElementById('fn-editor-endpoint-preview');
  if (preview) {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const prefix = slug && slug !== 'default' ? `/api/apps/${slug}/functions` : '/api/functions';
    preview.textContent = `ANY ${prefix}/${clean || '{name}'}/invoke`;
  }
}

function copyFunctionEndpoint(path) {
  const fullUrl = window.location.origin + path;
  if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(fullUrl).then(() => {
      toast('Copied function endpoint URL to clipboard', 'info');
    }).catch(() => {
      prompt('Copy function endpoint URL:', fullUrl);
    });
  } else {
    prompt('Copy function endpoint URL:', fullUrl);
  }
}

function updateEditorHeaderBadges(fn) {
  const container = document.getElementById('editor-header-badges');
  if (!container) return;
  container.innerHTML = `
    <span class="badge" style="background: ${fn.enabled !== false ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-card-hover)'}; color: ${fn.enabled !== false ? '#10b981' : 'var(--text-muted)'};">
      ${fn.enabled !== false ? '● Active' : '○ Disabled'}
    </span>
    <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6;">
      ${escapeHtml((fn.authPolicy || 'public').toUpperCase())}
    </span>
    ${fn.elevated ? '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444;" title="Runs with elevated permissions bypassing rules">Elevated</span>' : ''}
  `;
}

// ==========================================
// 4. Workbench Sub-Renderers & Main Assembler
// ==========================================

function renderWorkbenchHeader(fn, isNew, invokePath) {
  return `
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 1rem;">
      <div style="display: flex; align-items: center; gap: 14px;">
        <button class="btn btn-secondary btn-sm" onclick="closeFunctionEditor()" title="Back to functions list" style="display: flex; align-items: center; gap: 6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          <span>Functions</span>
        </button>
        <div>
          ${isNew ? `
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <input type="text" id="fn-editor-name-header" class="input" placeholder="function-name" value="${escapeHtml(fn.name || '')}" oninput="syncEditorFunctionName(this.value)" style="font-family: monospace; font-size: 1.15rem; font-weight: 700; width: 250px; padding: 4px 10px;" title="Function Name (Slug)">
              <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #6366f1; font-weight: 600;">✨ New Function</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-muted); margin-top: 4px; flex-wrap: wrap;">
              <span>Endpoint: <code id="fn-editor-endpoint-preview" style="font-size: 11px; background: var(--bg-card-hover); padding: 2px 6px; border-radius: 4px; color: var(--text-main); font-family: monospace;">ANY ${escapeHtml(invokePath)}</code></span>
              <span>Default limits: 1000ms / 32MB</span>
            </div>
          ` : `
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <h2 style="font-size: 1.35rem; font-weight: 700; color: var(--text-main); margin: 0; font-family: monospace; display: flex; align-items: center; gap: 8px;">
                ${escapeHtml(fn.name)}
              </h2>
              <div id="editor-header-badges" style="display: inline-flex; align-items: center; gap: 6px;">
                <span class="badge" style="background: ${fn.enabled !== false ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-card-hover)'}; color: ${fn.enabled !== false ? '#10b981' : 'var(--text-muted)'};">
                  ${fn.enabled !== false ? '● Active' : '○ Disabled'}
                </span>
                <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6;">
                  ${escapeHtml((fn.authPolicy || 'public').toUpperCase())}
                </span>
                ${fn.elevated ? '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444;" title="Runs with elevated permissions bypassing rules">Elevated</span>' : ''}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-muted); margin-top: 4px; flex-wrap: wrap;">
              <span>Endpoint: <code style="font-size: 11px; background: var(--bg-card-hover); padding: 2px 6px; border-radius: 4px; color: var(--text-main); font-family: monospace;">ANY ${escapeHtml(invokePath)}</code></span>
              <button type="button" class="btn btn-secondary btn-sm" onclick="copyFunctionEndpoint('${invokePath}')" style="font-size: 10px; padding: 1px 6px;" title="Copy full invoke endpoint">
                📋 Copy URL
              </button>
              ${fn.eventTrigger ? `<span style="color: var(--accent-primary);">⚡ Hook: <code>${escapeHtml(fn.eventTrigger)}</code></span>` : ''}
              <span>Limits: ${fn.timeoutMs || 1000}ms / ${fn.memoryLimitMb || 32}MB</span>
            </div>
          `}
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 8px;">
        ${!isNew ? `
          <button class="btn btn-secondary btn-sm" onclick="switchFunctionEditorTab('test')" style="display: flex; align-items: center; gap: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <span>Run Test</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="deleteFunctionPrompt('${fn.id}', '${escapeHtml(fn.name)}')" style="color: var(--accent-danger);" title="Delete Function">
            Delete
          </button>
        ` : `
          <button class="btn btn-secondary btn-sm" onclick="closeFunctionEditor()" title="Cancel and return to list">
            Cancel
          </button>
        `}
        <button class="btn btn-primary btn-sm" id="btn-editor-save" onclick="saveFunctionEditor()" style="display: flex; align-items: center; gap: 6px; font-weight: 600;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          <span>${isNew ? 'Create Function' : 'Save Changes'}</span>
        </button>
      </div>
    </div>
  `;
}

function renderWorkbenchTabs(activeTab) {
  return `
    <div style="display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;">
      <button class="webhook-tab-btn ${activeTab === 'code' ? 'active' : ''}" id="editor-tab-btn-code" onclick="switchFunctionEditorTab('code')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        Code & Context Reference
      </button>
      <button class="webhook-tab-btn ${activeTab === 'test' ? 'active' : ''}" id="editor-tab-btn-test" onclick="switchFunctionEditorTab('test')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Live Test Runner
      </button>
      <button class="webhook-tab-btn ${activeTab === 'config' ? 'active' : ''}" id="editor-tab-btn-config" onclick="switchFunctionEditorTab('config')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Configuration & Triggers
      </button>
      <button class="webhook-tab-btn ${activeTab === 'logs' ? 'active' : ''}" id="editor-tab-btn-logs" onclick="switchFunctionEditorTab('logs')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Function Logs & History
      </button>
    </div>
  `;
}

function renderWorkbenchCodePane(fn) {
  return `
    <div id="fn-editor-pane-code" class="fn-editor-pane" style="display: ${functionsState.editorTab === 'code' ? 'flex' : 'none'}; flex-direction: column; gap: 1rem; width: 100%;">
      <div class="card" style="padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 600; font-size: 13px; color: var(--text-heading);">Function Handler Source</span>
            <span style="font-size: 11px; color: var(--text-muted); font-family: monospace;">export default async function(ctx) { ... }</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-toolbar-toggle-ctx" onclick="toggleWorkbenchCtxRef()" style="font-size: 11px; display: flex; align-items: center; gap: 6px; padding: 3px 9px; background: ${functionsState.isCtxRefExpanded ? 'var(--accent-primary)' : 'var(--bg-card-hover)'}; color: ${functionsState.isCtxRefExpanded ? '#fff' : 'var(--text-main)'};" title="Toggle Context Reference Panel">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              <span>Context API (ctx)</span>
            </button>
            <span style="font-size: 11px; color: var(--text-muted);">Templates:</span>
            <select class="input" style="font-size: 11px; padding: 2px 8px;" onchange="applyStarterRecipe(this.value)">
              <option value="">Apply Recipe...</option>
              <option value="starter">Basic Hello World</option>
              <option value="discount">Cart Discount Calculation</option>
              <option value="hook">Validation & Mutation Hook</option>
              <option value="fetch">External API Fetch</option>
            </select>
            <span style="font-size: 10px; color: var(--text-muted); background: var(--bg-card-hover); padding: 2px 6px; border-radius: 4px;">Ctrl+S to save</span>
          </div>
        </div>

        <textarea id="fn-editor-code" style="width: 100%; min-height: 520px; height: calc(100vh - 290px); font-family: 'JetBrains Mono', Consolas, Monaco, monospace; font-size: 13px; line-height: 1.5; padding: 14px; border-radius: 8px; border: 1px solid var(--border-subtle); background: #0f172a; color: #f8fafc; resize: vertical;" spellcheck="false">${escapeHtml(fn.code)}</textarea>

        <!-- Vertical Collapsible Context API Reference (Collapsed by default) -->
        <div class="ctx-reference-panel" style="border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--bg-input); overflow: hidden; margin-top: 4px;">
          <div id="workbench-ctx-header" onclick="toggleWorkbenchCtxRef()" style="display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; background: var(--bg-card); cursor: pointer; user-select: none; border-bottom: ${functionsState.isCtxRefExpanded ? '1px solid var(--border-subtle)' : 'none'}; font-size: 12px;">
            <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--text-heading);">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-primary);"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              <span>Context Reference (<code>ctx</code>)</span>
              <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">— 1-click snippet insert for request, events, CRUD & network</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="badge" style="background: var(--bg-card-hover); color: var(--text-muted); font-size: 10px;">18 items</span>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-workbench-ctx" onclick="event.stopPropagation(); toggleWorkbenchCtxRef();" style="font-size: 11px; padding: 2px 9px;">
                ${functionsState.isCtxRefExpanded ? 'Hide Reference ▴' : 'Show Reference ▾'}
              </button>
            </div>
          </div>

          <div id="workbench-ctx-content" style="display: ${functionsState.isCtxRefExpanded ? 'flex' : 'none'}; flex-direction: column; gap: 10px; padding: 12px 14px; background: var(--bg-card);">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                <button type="button" class="ctx-cat-btn active" data-cat="all" onclick="filterCtxCategory('all')" style="font-size: 11px; padding: 3px 9px; border-radius: 4px; border: 1px solid var(--border-subtle); background: var(--accent-primary); color: #fff; cursor: pointer; font-weight: 500;">All (18)</button>
                <button type="button" class="ctx-cat-btn" data-cat="request" onclick="filterCtxCategory('request')" style="font-size: 11px; padding: 3px 9px; border-radius: 4px; border: 1px solid var(--border-subtle); background: var(--bg-card); color: var(--text-muted); cursor: pointer; font-weight: 500;">HTTP (ctx.request)</button>
                <button type="button" class="ctx-cat-btn" data-cat="event" onclick="filterCtxCategory('event')" style="font-size: 11px; padding: 3px 9px; border-radius: 4px; border: 1px solid var(--border-subtle); background: var(--bg-card); color: var(--text-muted); cursor: pointer; font-weight: 500;">DB Events (ctx.event)</button>
                <button type="button" class="ctx-cat-btn" data-cat="records" onclick="filterCtxCategory('records')" style="font-size: 11px; padding: 3px 9px; border-radius: 4px; border: 1px solid var(--border-subtle); background: var(--bg-card); color: var(--text-muted); cursor: pointer; font-weight: 500;">Database CRUD (ctx.records)</button>
                <button type="button" class="ctx-cat-btn" data-cat="utils" onclick="filterCtxCategory('utils')" style="font-size: 11px; padding: 3px 9px; border-radius: 4px; border: 1px solid var(--border-subtle); background: var(--bg-card); color: var(--text-muted); cursor: pointer; font-weight: 500;">Fetch, Env & Logs</button>
              </div>
              <div style="flex: 1; max-width: 260px; min-width: 180px;">
                <input type="text" id="ctx-search-input" class="input" placeholder="Search ctx variables..." oninput="filterCtxSearch(this.value)" style="width: 100%; font-size: 11px; padding: 4px 8px;">
              </div>
            </div>

            <div id="ctx-items-container" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 8px; max-height: 240px; overflow-y: auto; padding-right: 4px;">
              ${renderCtxItemsHtml()}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderWorkbenchConfigPane(fn, isNew, allowedDomainsString, envString) {
  return `
    <div id="fn-editor-pane-config" class="fn-editor-pane" style="display: ${functionsState.editorTab === 'config' ? 'grid' : 'none'}; grid-template-columns: 1fr 1fr; gap: 1rem; align-items: start;">
      <!-- Column 1: General & Triggers -->
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="card" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
          <div style="font-weight: 600; font-size: 13px; color: var(--text-heading); border-bottom: 1px solid var(--border-subtle); padding-bottom: 6px;">
            General Settings
          </div>
          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Function Identifier (Name)</label>
            <input type="text" id="fn-editor-name" class="input" value="${escapeHtml(fn.name || '')}" ${isNew ? 'placeholder="e.g. calculate-discount" oninput="syncEditorFunctionName(this.value)"' : 'readonly'} style="width: 100%; font-family: monospace; ${!isNew ? 'background: var(--bg-input); opacity: 0.85;' : ''}">
            <span style="font-size: 11px; color: var(--text-muted); margin-top: 2px; display: block;">Immutable endpoint slug for API invocation routes. Alphanumeric characters, underscores, and dashes only.</span>
          </div>
          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Description</label>
            <input type="text" id="fn-editor-desc" class="input" value="${escapeHtml(fn.description || '')}" placeholder="What does this function do?" style="width: 100%;">
          </div>
          <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: var(--bg-card-hover); border-radius: 6px;">
            <input type="checkbox" id="fn-editor-enabled" ${fn.enabled !== false ? 'checked' : ''} style="cursor: pointer;">
            <div>
              <label for="fn-editor-enabled" style="font-size: 12px; font-weight: 600; cursor: pointer; color: var(--text-main);">Function Enabled</label>
              <div style="font-size: 11px; color: var(--text-muted);">When disabled, API calls return 503 Service Unavailable and lifecycle hooks skip execution.</div>
            </div>
          </div>
        </div>

        <div class="card" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
          <div style="font-weight: 600; font-size: 13px; color: var(--text-heading); border-bottom: 1px solid var(--border-subtle); padding-bottom: 6px;">
            Triggers & Invocation
          </div>
          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Database Lifecycle Hook Trigger</label>
            <input type="text" id="fn-editor-hook" class="input" value="${escapeHtml(fn.eventTrigger || '')}" placeholder="e.g. orders:beforeCreate or articles:afterUpdate" style="width: 100%; font-size: 12px; font-family: monospace;">
            <span style="font-size: 11px; color: var(--text-muted); margin-top: 3px; display: block;">
              Format: <code>&lt;collection&gt;:&lt;phase&gt;&lt;Action&gt;</code>. Available phases: <code>beforeCreate</code>, <code>afterCreate</code>, <code>beforeUpdate</code>, <code>afterUpdate</code>, <code>beforeDelete</code>, <code>afterDelete</code>.
            </span>
          </div>
        </div>
      </div>

      <!-- Column 2: Runtime Limits, Auth & Secrets -->
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="card" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
          <div style="font-weight: 600; font-size: 13px; color: var(--text-heading); border-bottom: 1px solid var(--border-subtle); padding-bottom: 6px;">
            Security & Guardrails
          </div>
          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Authorization Policy</label>
            <select id="fn-editor-auth" class="input" style="width: 100%;">
              <option value="public" ${fn.authPolicy === 'public' ? 'selected' : ''}>Public (No Token Required)</option>
              <option value="auth" ${fn.authPolicy === 'auth' ? 'selected' : ''}>User Token (Requires Bearer JWT)</option>
              <option value="admin" ${fn.authPolicy === 'admin' ? 'selected' : ''}>Admin Only (Requires Admin Token)</option>
              <option value="apiKey" ${fn.authPolicy === 'apiKey' ? 'selected' : ''}>API Key (Requires nsk_live_...)</option>
            </select>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px;">Timeout (ms)</label>
              <input type="number" id="fn-editor-timeout" class="input" value="${fn.timeoutMs || 1000}" min="100" max="15000" style="width: 100%; font-size: 12px;">
            </div>
            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px;">Memory Cap (MB)</label>
              <input type="number" id="fn-editor-memory" class="input" value="${fn.memoryLimitMb || 32}" min="4" max="128" style="width: 100%; font-size: 12px;">
            </div>
          </div>

          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Outbound Egress Whitelist (SSRF Protection)</label>
            <input type="text" id="fn-editor-domains" class="input" value="${escapeHtml(allowedDomainsString)}" placeholder="e.g. api.stripe.com, *.resend.com (Leave blank for all public domains)" style="width: 100%; font-size: 12px;">
          </div>

          <div style="display: flex; align-items: center; gap: 8px; padding: 10px; background: rgba(239, 68, 68, 0.08); border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.2);">
            <input type="checkbox" id="fn-editor-elevated" ${fn.elevated ? 'checked' : ''} style="cursor: pointer;">
            <div>
              <label for="fn-editor-elevated" style="font-size: 12px; font-weight: 600; cursor: pointer; color: var(--accent-danger);">
                Elevated Service Role
              </label>
              <div style="font-size: 11px; color: var(--text-muted);">Bypasses collection RuleEngine access rules. Allows reading and mutating records as superuser.</div>
            </div>
          </div>
        </div>

        <div class="card" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem;">
          <div style="font-weight: 600; font-size: 13px; color: var(--text-heading); border-bottom: 1px solid var(--border-subtle); padding-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
            <span>Environment Secrets (<code>ctx.env</code>)</span>
            <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">JSON Object</span>
          </div>
          <textarea id="fn-editor-env" style="width: 100%; height: 95px; font-family: monospace; font-size: 12px; padding: 8px; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg-card-hover); color: var(--text-main);" placeholder='{ "STRIPE_SECRET": "sk_test_..." }'>${escapeHtml(envString)}</textarea>
          <span style="font-size: 11px; color: var(--text-muted);">Encrypted in database and injected at runtime into <code>ctx.env</code>. Isolated from system <code>process.env</code>.</span>
        </div>
      </div>
    </div>
  `;
}

function renderFunctionEditorView(fn) {
  const container = document.getElementById('page-view-functions') || document.getElementById('main-body');
  if (!container) return;

  const isNew = !!fn.isNew;
  const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
  const invokePrefix = slug && slug !== 'default'
    ? `/api/apps/${slug}/functions`
    : `/api/functions`;
  const invokePath = `${invokePrefix}/${fn.name || '{name}'}/invoke`;

  const envString = fn.env && Object.keys(fn.env).length > 0
    ? JSON.stringify(fn.env, null, 2)
    : '{}';

  const allowedDomainsString = (fn.allowedDomains || []).join(', ');

  const testPaneHtml = typeof renderWorkbenchTestPane === 'function'
    ? renderWorkbenchTestPane(fn, isNew)
    : '';

  const logsPaneHtml = typeof renderWorkbenchLogsPane === 'function'
    ? renderWorkbenchLogsPane(fn, isNew)
    : '';

  container.innerHTML = `
    <div class="function-editor-page" style="max-width: 1440px; margin: 0 auto; padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
      ${renderWorkbenchHeader(fn, isNew, invokePath)}
      ${renderWorkbenchTabs(functionsState.editorTab)}
      ${renderWorkbenchCodePane(fn)}
      ${testPaneHtml}
      ${renderWorkbenchConfigPane(fn, isNew, allowedDomainsString, envString)}
      ${logsPaneHtml}
    </div>
  `;

  // Attach keyboard shortcut for saving and tab indentation
  const codeArea = document.getElementById('fn-editor-code');
  if (codeArea) {
    codeArea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = codeArea.selectionStart;
        const end = codeArea.selectionEnd;
        codeArea.value = codeArea.value.substring(0, start) + '  ' + codeArea.value.substring(end);
        codeArea.selectionStart = codeArea.selectionEnd = start + 2;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFunctionEditor();
      }
    });
  }

  // Global Ctrl+S handler while on workbench view
  window.onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && functionsState.currentView === 'editor') {
      e.preventDefault();
      saveFunctionEditor();
    }
  };

  // Initialize CodeMirror editor
  initFunctionCodeMirror();

  // If logs tab is active on existing function, load logs
  if (functionsState.editorTab === 'logs' && !isNew && typeof loadFunctionEditorLogs === 'function') {
    loadFunctionEditorLogs();
  }
}

// ==========================================
// 5. Persistence Handlers
// ==========================================

async function saveFunctionEditor() {
  const btn = document.getElementById('btn-editor-save');
  const fn = functionsState.activeFunctionForEdit;
  if (!fn) return;

  const isNew = !!fn.isNew;

  if (btn) {
    btn.disabled = true;
    btn.textContent = isNew ? 'Creating...' : 'Saving...';
  }

  try {
    if (functionsState.cmEditor) {
      functionsState.cmEditor.save();
    }
    const codeEl = document.getElementById('fn-editor-code');
    const descEl = document.getElementById('fn-editor-desc');
    const authEl = document.getElementById('fn-editor-auth');
    const hookEl = document.getElementById('fn-editor-hook');
    const timeoutEl = document.getElementById('fn-editor-timeout');
    const memoryEl = document.getElementById('fn-editor-memory');
    const domainsEl = document.getElementById('fn-editor-domains');
    const elevatedEl = document.getElementById('fn-editor-elevated');
    const enabledEl = document.getElementById('fn-editor-enabled');
    const envEl = document.getElementById('fn-editor-env');

    const nameHeaderEl = document.getElementById('fn-editor-name-header');
    const nameConfigEl = document.getElementById('fn-editor-name');
    let name = (nameHeaderEl ? nameHeaderEl.value.trim() : (nameConfigEl ? nameConfigEl.value.trim() : (fn.name || ''))).toLowerCase();

    if (isNew) {
      if (!name) {
        throw new Error('Please enter a function identifier (name)');
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new Error('Function name must contain only alphanumeric characters, underscores, and dashes');
      }
    }

    const code = codeEl ? codeEl.value : fn.code;
    const description = descEl ? descEl.value.trim() : (fn.description || '');
    const authPolicy = authEl ? authEl.value : (fn.authPolicy || 'public');
    const eventTrigger = hookEl ? hookEl.value.trim() : (fn.eventTrigger || '');
    const timeoutMs = timeoutEl ? (parseInt(timeoutEl.value, 10) || 1000) : fn.timeoutMs;
    const memoryLimitMb = memoryEl ? (parseInt(memoryEl.value, 10) || 32) : fn.memoryLimitMb;
    const domainsRaw = domainsEl ? domainsEl.value.trim() : '';
    const allowedDomains = domainsRaw ? domainsRaw.split(',').map(s => s.trim()).filter(Boolean) : (fn.allowedDomains || []);
    const elevated = elevatedEl ? elevatedEl.checked : !!fn.elevated;
    const enabled = enabledEl ? enabledEl.checked : (fn.enabled !== false);

    let env = fn.env || {};
    if (envEl && envEl.value.trim()) {
      try {
        env = JSON.parse(envEl.value.trim());
      } catch {
        throw new Error('Environment secrets must be valid JSON');
      }
    }

    const payload = {
      description,
      authPolicy,
      eventTrigger: eventTrigger || null,
      timeoutMs,
      memoryLimitMb,
      allowedDomains,
      elevated,
      enabled,
      code,
      env,
    };

    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const baseUrl = slug && slug !== 'default' ? `/api/apps/${slug}/functions` : '/api/functions';

    if (isNew) {
      const createPayload = {
        name,
        methods: fn.methods || ['GET', 'POST'],
        ...payload,
      };

      const created = await api(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload),
      });

      functionsState.activeFunctionForEdit = created;
      if (!Array.isArray(functionsState.functions)) {
        functionsState.functions = [];
      }
      const existingIdx = functionsState.functions.findIndex(f => f.id === created.id);
      if (existingIdx !== -1) {
        functionsState.functions[existingIdx] = created;
      } else {
        functionsState.functions.unshift(created);
      }

      toast(`Function '${created.name}' created successfully`, 'success');
      if (typeof updateUrl === 'function') {
        updateUrl('/_/functions/' + encodeURIComponent(created.name));
      }
      if (typeof updateBreadcrumbs === 'function') {
        updateBreadcrumbs();
      }
      renderFunctionEditorView(created);
      if (typeof loadFunctionStats === 'function') {
        await loadFunctionStats();
      }
    } else {
      const updated = await api(`${baseUrl}/${fn.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      functionsState.activeFunctionForEdit = updated;
      const idx = (functionsState.functions || []).findIndex(f => f.id === fn.id);
      if (idx !== -1) {
        functionsState.functions[idx] = updated;
      }

      updateEditorHeaderBadges(updated);
      toast(`Function '${updated.name}' saved successfully`, 'success');
      if (typeof loadFunctionStats === 'function') {
        await loadFunctionStats();
      }
    }
  } catch (err) {
    toast(err.message || 'Failed to save function', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      const active = functionsState.activeFunctionForEdit;
      const stillNew = active && active.isNew;
      btn.innerHTML = stillNew
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span>Create Function</span>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span>Save Changes</span>`;
    }
  }
}

// ==========================================
// 6. Backward Compatibility Shims
// ==========================================

function openCreateFunctionModal() {
  openCreateFunctionPage();
}

function openEditFunctionModal(id) {
  openFunctionEditor(id);
}

function openTestFunctionModal(id) {
  openFunctionEditor(id, true, 'test');
}

function renderFunctionModal(fnData) {
  openFunctionEditor(fnData?.isNew ? 'new' : (fnData?.id || fnData?.name || 'new'));
}

function closeFunctionModal() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) modalRoot.innerHTML = '';
}

async function saveFunctionModal() {
  return saveFunctionEditor();
}

async function executeFunctionLiveTest() {
  if (typeof executeFunctionEditorTest === 'function') {
    return executeFunctionEditorTest();
  }
}

function toggleCtxReference() {
  toggleWorkbenchCtxRef();
}

// Global Exports
if (typeof window !== 'undefined') {
  window.CTX_DOCS = CTX_DOCS;
  window.renderCtxItemsHtml = renderCtxItemsHtml;
  window.insertFunctionSnippet = insertFunctionSnippet;
  window.filterCtxCategory = filterCtxCategory;
  window.filterCtxSearch = filterCtxSearch;
  window.applyStarterRecipe = applyStarterRecipe;
  window.toggleWorkbenchCtxRef = toggleWorkbenchCtxRef;
  window.toggleCtxReference = toggleCtxReference;
  window.getCodeMirrorTheme = getCodeMirrorTheme;
  window.initFunctionCodeMirror = initFunctionCodeMirror;
  window.openCreateFunctionPage = openCreateFunctionPage;
  window.openFunctionEditor = openFunctionEditor;
  window.closeFunctionEditor = closeFunctionEditor;
  window.switchFunctionEditorTab = switchFunctionEditorTab;
  window.syncEditorFunctionName = syncEditorFunctionName;
  window.copyFunctionEndpoint = copyFunctionEndpoint;
  window.updateEditorHeaderBadges = updateEditorHeaderBadges;
  window.renderWorkbenchHeader = renderWorkbenchHeader;
  window.renderWorkbenchTabs = renderWorkbenchTabs;
  window.renderWorkbenchCodePane = renderWorkbenchCodePane;
  window.renderWorkbenchConfigPane = renderWorkbenchConfigPane;
  window.renderFunctionEditorView = renderFunctionEditorView;
  window.saveFunctionEditor = saveFunctionEditor;
  window.openCreateFunctionModal = openCreateFunctionModal;
  window.openEditFunctionModal = openEditFunctionModal;
  window.openTestFunctionModal = openTestFunctionModal;
  window.renderFunctionModal = renderFunctionModal;
  window.closeFunctionModal = closeFunctionModal;
  window.saveFunctionModal = saveFunctionModal;
  window.executeFunctionLiveTest = executeFunctionLiveTest;
}
