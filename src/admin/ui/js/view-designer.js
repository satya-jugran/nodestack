// Dedicated SQL View Designer Page (3 Dialect Tabs, Syntax Highlighting, Schema Explorer, Validator, Diff & Preview)

(function () {
  const RESTRICTED_TABLES = new Set([
    '_admins',
    '_api_keys',
    '_db_configs',
    '_plugin_settings',
    '_external_auths',
    '_cron_schedules',
    '_cron_runs',
  ]);

  const DIALECTS = [
    { id: 'sqlite', label: 'SQLite' },
    { id: 'postgres', label: 'PostgreSQL' },
    { id: 'mssql', label: 'SQL Server' },
  ];

  const viewDesignerState = {
    mode: 'create', // 'create' | 'edit'
    originalName: null,
    name: '',
    activeDialect: 'sqlite',
    selectedTab: 'sqlite',
    viewQueries: { sqlite: '', postgres: '', mssql: '' },
    initialSnapshot: '',
    tableFilter: '',
    expandedTables: {},
    cmEditor: null,
    isValidating: false,
    isSaving: false,
    validations: { sqlite: null, postgres: null, mssql: null },
  };

  function computeSnapshot() {
    syncCurrentTabFromEditor();
    return JSON.stringify({
      name: (viewDesignerState.name || '').trim(),
      viewQueries: {
        sqlite: (viewDesignerState.viewQueries.sqlite || '').trim(),
        postgres: (viewDesignerState.viewQueries.postgres || '').trim(),
        mssql: (viewDesignerState.viewQueries.mssql || '').trim(),
      },
    });
  }

  function isViewDesignerDirty() {
    const el = document.getElementById('page-view-view-designer');
    const isVisible = el && el.style.display !== 'none';
    if (!isVisible && state.activeNav !== 'view-designer') return false;
    return computeSnapshot() !== viewDesignerState.initialSnapshot;
  }

  function confirmLeaveViewDesigner(onProceed) {
    const modal = document.getElementById('modal-root');
    if (!modal) {
      if (typeof window.confirm === 'function' && !window.confirm('You have unsaved changes. Proceed without saving?')) {
        return;
      }
      viewDesignerState.initialSnapshot = computeSnapshot();
      onProceed();
      return;
    }
    window.__pendingViewDesignerProceed = () => {
      viewDesignerState.initialSnapshot = computeSnapshot();
      if (typeof closeModal === 'function') closeModal();
      onProceed();
    };
    modal.innerHTML = `
      <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="max-width:440px;">
          <div class="modal-header">
            <h2 class="modal-title">Unsaved Changes</h2>
            <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <p style="font-size:13.5px; color:var(--text-main); margin:0; line-height:1.5;">
              You have unsaved changes in the SQL View Designer. Do you want to proceed without saving?
            </p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button type="button" class="btn btn-danger" onclick="window.__pendingViewDesignerProceed && window.__pendingViewDesignerProceed()">Proceed Without Saving</button>
          </div>
        </div>
      </div>
    `;
  }

  function detectActiveDialect() {
    const p = (typeof databaseState !== 'undefined' && databaseState?.status?.provider)
      ? String(databaseState.status.provider).toLowerCase()
      : 'sqlite';
    return ['sqlite', 'postgres', 'mssql'].includes(p) ? p : 'sqlite';
  }

  function registerSqlCodeMirrorMode() {
    if (typeof CodeMirror === 'undefined' || (CodeMirror.modes && CodeMirror.modes.sql)) {
      return;
    }
    const keywords = new Set([
      'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS',
      'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE', 'LIKE', 'ILIKE',
      'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'DISTINCT', 'ALL',
      'UNION', 'INTERSECT', 'EXCEPT', 'WITH', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS',
      'BETWEEN', 'CAST', 'OVER', 'PARTITION', 'TOP', 'FETCH', 'NEXT', 'ROWS', 'ONLY',
    ]);
    const builtins = new Set([
      'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'TOTAL', 'COALESCE', 'IFNULL', 'NULLIF',
      'LOWER', 'UPPER', 'TRIM', 'LENGTH', 'SUBSTR', 'SUBSTRING', 'ROUND', 'ABS',
      'DATE', 'DATETIME', 'STRFTIME', 'NOW', 'TO_CHAR', 'CONVERT', 'TRY_CAST', 'JSON_EXTRACT',
      'JSON_VALUE', 'JSON_OBJECT', 'JSON_ARRAY', 'ROW_NUMBER', 'RANK', 'DENSE_RANK',
    ]);

    CodeMirror.defineMode('sql', function () {
      return {
        startState: function () {
          return { inComment: false };
        },
        token: function (stream, state) {
          if (state.inComment) {
            if (stream.skipTo('*/')) {
              stream.match('*/');
              state.inComment = false;
            } else {
              stream.skipToEnd();
            }
            return 'comment';
          }
          if (stream.eatSpace()) return null;
          if (stream.match('--')) {
            stream.skipToEnd();
            return 'comment';
          }
          if (stream.match('/*')) {
            state.inComment = true;
            return 'comment';
          }
          const ch = stream.peek();
          if (ch === "'" || ch === '"') {
            const quote = stream.next();
            while (!stream.eol()) {
              if (stream.next() === quote) {
                if (stream.peek() === quote) stream.next();
                else break;
              }
            }
            return quote === "'" ? 'string' : 'variable-2';
          }
          if (/[0-9]/.test(ch)) {
            stream.match(/^[0-9]+(\.[0-9]+)?/);
            return 'number';
          }
          if (/[a-zA-Z_]/.test(ch)) {
            stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
            const word = stream.current().toUpperCase();
            if (keywords.has(word)) return 'keyword';
            if (builtins.has(word)) return 'builtin';
            return 'variable';
          }
          stream.next();
          return null;
        },
      };
    });
  }

  function getEditorTheme() {
    if (typeof getCodeMirrorTheme === 'function') return getCodeMirrorTheme();
    if (typeof document !== 'undefined' && document.documentElement?.classList.contains('light')) {
      return 'eclipse';
    }
    return 'dracula';
  }

  function getTableColumnsForReference(col) {
    const cols = [{ name: 'id', type: 'text' }];
    if (col.type === 'auth') {
      cols.push(
        { name: 'email', type: 'email' },
        { name: 'emailVisibility', type: 'bool' },
        { name: 'verified', type: 'bool' }
      );
    }
    for (const f of col.schema || []) {
      if (!cols.some((c) => c.name === f.name)) {
        cols.push({ name: f.name, type: f.type });
      }
    }
    cols.push({ name: 'created', type: 'date' }, { name: 'updated', type: 'date' });
    return cols;
  }

  function getReferenceCollections() {
    const allCols = Array.isArray(state.collections) ? state.collections : [];
    const term = (viewDesignerState.tableFilter || '').trim().toLowerCase();
    return allCols
      .filter((c) => {
        if (!c || RESTRICTED_TABLES.has((c.name || '').toLowerCase())) return false;
        if (viewDesignerState.mode === 'edit' && c.name === viewDesignerState.originalName) return false;
        if (!term) return true;
        if (c.name.toLowerCase().includes(term)) return true;
        return getTableColumnsForReference(c).some((col) => col.name.toLowerCase().includes(term));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function getCurrentEditorSql() {
    if (viewDesignerState.cmEditor) {
      return viewDesignerState.cmEditor.getValue();
    }
    return viewDesignerState.viewQueries[viewDesignerState.selectedTab] || '';
  }

  function syncCurrentTabFromEditor() {
    viewDesignerState.viewQueries[viewDesignerState.selectedTab] = getCurrentEditorSql();
  }

  function runClientQuickValidation(sql, dialect) {
    const trimmed = (sql || '').trim();
    if (!trimmed) {
      return {
        valid: false,
        message: dialect === viewDesignerState.activeDialect
          ? `Enter a ${dialect.toUpperCase()} SELECT query to validate and preview.`
          : `Optional: add a ${dialect.toUpperCase()} query for migrations.`,
      };
    }
    const clean = trimmed.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    if (!/^(SELECT|WITH)\b/i.test(clean)) {
      return { valid: false, message: 'View query must start with SELECT or WITH.' };
    }
    if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|PRAGMA|ATTACH)\b/i.test(clean)) {
      return { valid: false, message: 'Mutating or DDL keywords are not allowed in view queries.' };
    }
    return {
      valid: true,
      message: dialect === viewDesignerState.activeDialect
        ? 'Click Validate & Preview to execute against the active database and infer types.'
        : `Click Validate & Preview to run static validation for ${dialect.toUpperCase()}.`,
    };
  }

  function openViewDesigner(opts = {}) {
    const active = detectActiveDialect();
    viewDesignerState.activeDialect = active;
    viewDesignerState.selectedTab = active;
    viewDesignerState.mode = opts.existingCol ? 'edit' : 'create';
    viewDesignerState.originalName = opts.existingCol ? opts.existingCol.name : null;
    viewDesignerState.name = opts.existingCol ? opts.existingCol.name : (opts.name || '');

    const existingQueries = opts.existingCol?.options?.viewQueries || {};
    viewDesignerState.viewQueries = {
      sqlite: existingQueries.sqlite || (active === 'sqlite' && !opts.existingCol ? 'SELECT\n  \nFROM ' : ''),
      postgres: existingQueries.postgres || (active === 'postgres' && !opts.existingCol ? 'SELECT\n  \nFROM ' : ''),
      mssql: existingQueries.mssql || (active === 'mssql' && !opts.existingCol ? 'SELECT\n  \nFROM ' : ''),
    };
    viewDesignerState.validations = { sqlite: null, postgres: null, mssql: null };
    viewDesignerState.tableFilter = '';

    if (typeof showPageView === 'function') {
      showPageView('view-designer');
    }
    state.activeNav = 'view-designer';
    if (typeof clearSidebarNavActive === 'function') {
      clearSidebarNavActive();
      document.getElementById('nav-collections')?.classList.add('active');
    }

    const tabsEl = document.getElementById('collection-tabs');
    if (tabsEl) tabsEl.style.display = 'none';
    const titleEl = document.getElementById('view-title');
    if (titleEl) {
      titleEl.textContent = viewDesignerState.mode === 'edit' ? `Edit SQL View: ${viewDesignerState.originalName}` : 'SQL View Designer';
      titleEl.style.display = 'inline-block';
    }
    const badgeEl = document.getElementById('view-badge');
    if (badgeEl) {
      badgeEl.style.display = 'inline-flex';
      badgeEl.textContent = 'VIEW';
      badgeEl.className = 'badge badge-warning';
    }

    renderViewDesigner();
    viewDesignerState.initialSnapshot = JSON.stringify({
      name: (viewDesignerState.name || '').trim(),
      viewQueries: {
        sqlite: (viewDesignerState.viewQueries.sqlite || '').trim(),
        postgres: (viewDesignerState.viewQueries.postgres || '').trim(),
        mssql: (viewDesignerState.viewQueries.mssql || '').trim(),
      },
    });
    if (viewDesignerState.mode === 'edit' && (viewDesignerState.viewQueries[active] || '').trim()) {
      previewViewDesignerQuery();
    }
  }

  function onViewDesignerAppSwitched() {
    if (state.activeNav !== 'view-designer') return;
    if (viewDesignerState.mode === 'edit') {
      viewDesignerState.initialSnapshot = computeSnapshot();
      if (typeof selectNav === 'function') selectNav('collections');
      return;
    }
    const newActive = detectActiveDialect();
    viewDesignerState.activeDialect = newActive;
    viewDesignerState.selectedTab = newActive;
    viewDesignerState.expandedTables = {};
    viewDesignerState.validations = { sqlite: null, postgres: null, mssql: null };
    if (!(viewDesignerState.viewQueries[newActive] || '').trim()) {
      viewDesignerState.viewQueries[newActive] = 'SELECT\n  \nFROM ';
    }
    renderViewDesigner();
    viewDesignerState.initialSnapshot = computeSnapshot();
  }

  function renderDialectTabsHtml() {
    return DIALECTS.map((d) => {
      const isSelected = viewDesignerState.selectedTab === d.id;
      const isActive = viewDesignerState.activeDialect === d.id;
      const hasSql = Boolean((viewDesignerState.viewQueries[d.id] || '').trim());
      return `
        <button type="button"
          class="btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}"
          onclick="switchViewDesignerDialect('${d.id}')"
          style="display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:4px 10px;">
          <span>${d.label}</span>
          ${isActive ? `<span class="badge badge-get" style="font-size:9px; padding:1px 5px;">Active</span>` : ''}
          ${hasSql ? `<span style="width:6px; height:6px; border-radius:50%; background:${isSelected ? '#ffffff' : '#10b981'}; display:inline-block;" title="Has SQL"></span>` : ''}
        </button>
      `;
    }).join('');
  }

  function renderViewDesigner() {
    const root = document.getElementById('page-view-view-designer');
    if (!root) return;

    const currentSql = viewDesignerState.viewQueries[viewDesignerState.selectedTab] || '';

    root.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:1rem; height:100%;">
        <!-- Top Bar -->
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem; padding-bottom:0.75rem; border-bottom:1px solid var(--border-subtle);">
          <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="closeViewDesigner()">← Back to Collections</button>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <label for="vd-view-name" style="font-size:12px; font-weight:700; color:var(--text-muted);">View Name *</label>
              <input type="text" id="vd-view-name" class="form-input" style="width:220px; font-size:13px;" placeholder="e.g. order_summary" value="${escapeHtml(viewDesignerState.name)}" oninput="updateViewDesignerName(this.value)">
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <button type="button" class="btn btn-secondary btn-sm" id="vd-btn-preview" onclick="previewViewDesignerQuery()">
              ▶ Validate & Preview
            </button>
            <button type="button" class="btn btn-primary btn-sm" id="vd-btn-save" onclick="saveViewDesigner()">
              ${viewDesignerState.mode === 'edit' ? 'Save View' : 'Create View'}
            </button>
          </div>
        </div>

        <!-- Split Workspace: Tables/Columns Reference + SQL Editor & Preview -->
        <div style="display:grid; grid-template-columns: 280px 1fr; gap:1rem; min-height:540px; align-items:start;">
          <!-- Left Rail: Tables & Expandable Columns -->
          <div style="border:1px solid var(--border-subtle); border-radius:8px; background:var(--bg-card); display:flex; flex-direction:column; height:calc(100vh - 200px); min-height:460px; max-height:720px; overflow:hidden;">
            <div style="padding:0.75rem; border-bottom:1px solid var(--border-subtle); flex-shrink:0;">
              <div style="font-size:12px; font-weight:700; color:var(--text-heading); margin-bottom:0.5rem;">Tables & Columns</div>
              <input type="text" id="vd-table-filter" class="form-input" style="font-size:12px; width:100%;" placeholder="Filter tables or columns..." value="${escapeHtml(viewDesignerState.tableFilter)}" oninput="filterViewDesignerTables(this.value)">
            </div>
            <div id="vd-tables-list" style="flex:1 1 0; min-height:0; overflow-y:auto; padding:0.5rem; display:flex; flex-direction:column; gap:6px;">
              <!-- Populated by renderViewDesignerTables() -->
            </div>
          </div>

          <!-- Right Area: 3 Dialect Tabs + SQL Editor + On-Screen Validator + Live Results Preview -->
          <div style="display:flex; flex-direction:column; gap:0.85rem; min-width:0;">
            <div style="border:1px solid var(--border-subtle); border-radius:8px; background:var(--bg-card); overflow:hidden;">
              <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem; padding:0.5rem 0.85rem; border-bottom:1px solid var(--border-subtle); background:var(--bg-input);">
                <div id="vd-dialect-tabs" style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                  ${renderDialectTabsHtml()}
                </div>
                <span style="font-size:11px; color:var(--text-muted);">Ctrl/Cmd + Enter to Validate & Preview</span>
              </div>
              <div style="padding:0;">
                <textarea id="vd-sql-editor" style="width:100%; min-height:200px; font-family:var(--font-mono); font-size:13px; padding:0.75rem; border:none; background:var(--bg-main); color:var(--text-main);">${escapeHtml(currentSql)}</textarea>
              </div>
            </div>

            <!-- On-Screen Validator, Schema Diff & Rule Warnings -->
            <div id="vd-validator-panel" style="border:1px solid var(--border-subtle); border-radius:8px; padding:0.75rem 1rem; background:var(--bg-card);">
              <!-- Populated by renderViewDesignerValidation() -->
            </div>

            <!-- Results Preview Table -->
            <div id="vd-preview-panel" style="border:1px solid var(--border-subtle); border-radius:8px; background:var(--bg-card); overflow:hidden;">
              <!-- Populated by renderViewDesignerPreview() -->
            </div>
          </div>
        </div>
      </div>
    `;

    renderViewDesignerTables();
    initViewDesignerCodeMirror();
    renderViewDesignerValidation();
    renderViewDesignerPreview();
  }

  function switchViewDesignerDialect(nextDialect) {
    if (!['sqlite', 'postgres', 'mssql'].includes(nextDialect)) return;
    syncCurrentTabFromEditor();
    viewDesignerState.selectedTab = nextDialect;

    const tabsContainer = document.getElementById('vd-dialect-tabs');
    if (tabsContainer) {
      tabsContainer.innerHTML = renderDialectTabsHtml();
    }

    const nextSql = viewDesignerState.viewQueries[nextDialect] || '';
    if (viewDesignerState.cmEditor) {
      viewDesignerState.cmEditor.setValue(nextSql);
      viewDesignerState.cmEditor.save();
    } else {
      const textarea = document.getElementById('vd-sql-editor');
      if (textarea) textarea.value = nextSql;
    }

    renderViewDesignerValidation();
    renderViewDesignerPreview();
  }

  function renderViewDesignerTables() {
    const container = document.getElementById('vd-tables-list');
    if (!container) return;

    const cols = getReferenceCollections();
    if (cols.length === 0) {
      container.innerHTML = `<div style="padding:1rem; text-align:center; font-size:12px; color:var(--text-muted);">No matching tables</div>`;
      return;
    }

    const plusIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
    const minusIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>`;

    container.innerHTML = cols.map((col) => {
      const isExpanded = Boolean(viewDesignerState.expandedTables[col.name]);
      const fields = getTableColumnsForReference(col);
      const safeTable = escapeHtml(col.name);

      return `
        <div style="border:1px solid var(--border-subtle); border-radius:6px; overflow:hidden; background:var(--bg-input); flex-shrink:0;">
          <div onclick="insertSqlToken('${safeTable}')" title="Click to insert '${safeTable}' into query" style="display:flex; align-items:center; justify-content:space-between; padding:0.45rem 0.55rem; cursor:pointer; gap:6px;">
            <div style="display:flex; align-items:center; gap:6px; min-width:0;">
              <span style="font-size:12px; font-weight:600; color:var(--text-heading); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${safeTable}</span>
              <span class="badge ${col.type === 'auth' ? 'badge-post' : 'badge-get'}" style="font-size:9px; padding:1px 4px;">${escapeHtml(col.type)}</span>
            </div>
            <button type="button" class="btn btn-secondary btn-sm vd-expand-table-btn" data-table="${safeTable}" onclick="event.stopPropagation(); toggleViewDesignerTable('${safeTable}')" title="${isExpanded ? 'Collapse columns' : 'Expand columns'}" aria-expanded="${isExpanded}" style="padding:2px 5px; font-size:11px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;">
              ${isExpanded ? minusIconSvg : plusIconSvg}
            </button>
          </div>
          ${isExpanded ? `
            <div style="border-top:1px solid var(--border-subtle); background:var(--bg-card); padding:0.25rem 0.35rem; display:flex; flex-direction:column; gap:2px;">
              ${fields.map((f) => {
                const safeCol = escapeHtml(f.name);
                const qualified = `${safeTable}.${safeCol}`;
                return `
                  <div class="vd-col-item" data-token="${qualified}" onclick="insertSqlToken('${qualified}')" title="Click to insert '${qualified}' into query" style="display:flex; align-items:center; justify-content:space-between; padding:0.28rem 0.45rem; border-radius:4px; font-size:11.5px; gap:6px; cursor:pointer;">
                    <span style="font-family:var(--font-mono); color:var(--text-main); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${safeCol}</span>
                    <span style="font-size:10px; color:var(--text-muted); flex-shrink:0;">${escapeHtml(f.type)}</span>
                  </div>
                `;
              }).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function initViewDesignerCodeMirror() {
    const textarea = document.getElementById('vd-sql-editor');
    if (!textarea) return;

    if (viewDesignerState.cmEditor) {
      try { viewDesignerState.cmEditor.toTextArea(); } catch (_) {}
      viewDesignerState.cmEditor = null;
    }

    if (typeof CodeMirror === 'undefined') {
      textarea.addEventListener('input', () => {
        viewDesignerState.viewQueries[viewDesignerState.selectedTab] = textarea.value;
        viewDesignerState.validations[viewDesignerState.selectedTab] = null;
        renderViewDesignerValidation();
      });
      return;
    }

    registerSqlCodeMirrorMode();
    try {
      const cm = CodeMirror.fromTextArea(textarea, {
        mode: 'sql',
        theme: getEditorTheme(),
        lineNumbers: true,
        matchBrackets: true,
        tabSize: 2,
        indentWithTabs: false,
        lineWrapping: true,
        extraKeys: {
          'Ctrl-Enter': function () { previewViewDesignerQuery(); },
          'Cmd-Enter': function () { previewViewDesignerQuery(); },
        },
      });
      cm.setSize('100%', '220px');
      cm.on('change', () => {
        cm.save();
        viewDesignerState.viewQueries[viewDesignerState.selectedTab] = cm.getValue();
        viewDesignerState.validations[viewDesignerState.selectedTab] = null;
        renderViewDesignerValidation();
      });
      viewDesignerState.cmEditor = cm;
      setTimeout(() => cm.refresh(), 40);
    } catch (err) {
      console.warn('View Designer CodeMirror init failed:', err);
    }
  }

  function insertSqlToken(token) {
    if (viewDesignerState.cmEditor) {
      const cm = viewDesignerState.cmEditor;
      cm.focus();
      cm.replaceSelection(token);
      cm.save();
      viewDesignerState.viewQueries[viewDesignerState.selectedTab] = cm.getValue();
      renderViewDesignerValidation();
      return;
    }
    const textarea = document.getElementById('vd-sql-editor');
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const val = textarea.value;
    textarea.value = val.slice(0, start) + token + val.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + token.length;
    textarea.focus();
    viewDesignerState.viewQueries[viewDesignerState.selectedTab] = textarea.value;
    renderViewDesignerValidation();
  }

  function toggleViewDesignerTable(tableName) {
    viewDesignerState.expandedTables[tableName] = !viewDesignerState.expandedTables[tableName];
    renderViewDesignerTables();
  }

  function filterViewDesignerTables(val) {
    viewDesignerState.tableFilter = val || '';
    renderViewDesignerTables();
  }

  function updateViewDesignerName(val) {
    viewDesignerState.name = val || '';
  }

  function renderSchemaDiffHtml(diff, ruleWarnings) {
    if (!diff && (!ruleWarnings || ruleWarnings.length === 0)) return '';
    const badges = [];
    for (const c of diff?.added || []) {
      badges.push(`<span class="badge badge-get" style="font-size:11px; font-family:var(--font-mono);">+ ${escapeHtml(c.name)} (${escapeHtml(c.type)})</span>`);
    }
    for (const c of diff?.typeChanged || []) {
      badges.push(`<span class="badge badge-warning" style="font-size:11px; font-family:var(--font-mono);">~ ${escapeHtml(c.name)}: ${escapeHtml(c.from)} → ${escapeHtml(c.to)}</span>`);
    }
    for (const c of diff?.removed || []) {
      badges.push(`<span class="badge badge-delete" style="font-size:11px; font-family:var(--font-mono);">- ${escapeHtml(c.name)} (${escapeHtml(c.type)})</span>`);
    }

    const warningsHtml = (ruleWarnings && ruleWarnings.length > 0)
      ? `<div style="color:#ef4444; font-size:12px; font-weight:600; margin-top:4px;">⚠ Rule Safeguard: ${ruleWarnings.map(w => escapeHtml(w)).join('; ')}</div>`
      : '';

    if (badges.length === 0 && !warningsHtml) return '';

    return `
      <div style="border-top:1px solid var(--border-subtle); padding-top:0.5rem; margin-top:0.35rem; display:flex; flex-direction:column; gap:4px;">
        ${badges.length > 0 ? `<div style="font-size:11.5px; font-weight:600; color:var(--text-heading);">Schema Diff vs Saved View:</div><div style="display:flex; flex-wrap:wrap; gap:6px;">${badges.join('')}</div>` : ''}
        ${warningsHtml}
      </div>
    `;
  }

  function renderViewDesignerValidation() {
    const panel = document.getElementById('vd-validator-panel');
    if (!panel) return;

    const tab = viewDesignerState.selectedTab;
    if (viewDesignerState.isValidating) {
      panel.innerHTML = `<div style="font-size:12px; color:var(--text-muted);">Validating ${tab.toUpperCase()} SQL query...</div>`;
      return;
    }

    const serverRes = viewDesignerState.validations[tab];
    if (serverRes) {
      if (!serverRes.valid) {
        panel.innerHTML = `
          <div style="display:flex; align-items:flex-start; gap:8px; color:#ef4444; font-size:12.5px;">
            <span style="font-weight:700;">✗ Validation Error (${tab.toUpperCase()}):</span>
            <span>${escapeHtml(serverRes.error || 'Invalid SQL query')}</span>
          </div>
        `;
        return;
      }

      if (serverRes.staticOnly) {
        panel.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px; color:#10b981; font-size:12.5px; font-weight:600;">
            <span>✓ Static SQL validation passed for ${tab.toUpperCase()}</span>
            <span class="badge badge-warning" style="font-size:10px;">Static Validation Only (${escapeHtml(serverRes.activeDialect.toUpperCase())} is active)</span>
          </div>
        `;
        return;
      }

      const schemaChips = (serverRes.schema || []).map((f) =>
        `<span class="badge badge-get" style="font-size:11px; font-family:var(--font-mono);">${escapeHtml(f.name)}: ${escapeHtml(f.type)}</span>`
      ).join('');

      panel.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:0.5rem;">
          <div style="display:flex; align-items:center; gap:8px; color:#10b981; font-size:12.5px; font-weight:600;">
            <span>✓ Query valid (${tab.toUpperCase()})</span>
            <span style="color:var(--text-muted); font-weight:400;">(${(serverRes.schema || []).length} inferred columns, ${(serverRes.rows || []).length} preview rows)</span>
          </div>
          ${schemaChips ? `<div style="display:flex; flex-wrap:wrap; gap:6px;">${schemaChips}</div>` : ''}
          ${renderSchemaDiffHtml(serverRes.schemaDiff, serverRes.ruleWarnings)}
        </div>
      `;
      return;
    }

    const quick = runClientQuickValidation(viewDesignerState.viewQueries[tab], tab);
    panel.innerHTML = `
      <div style="font-size:12px; color:${quick.valid ? 'var(--text-muted)' : '#f59e0b'};">
        ${quick.valid ? 'ℹ ' : '⚠ '}${escapeHtml(quick.message)}
      </div>
    `;
  }

  function renderViewDesignerPreview() {
    const panel = document.getElementById('vd-preview-panel');
    if (!panel) return;

    const tab = viewDesignerState.selectedTab;
    const res = viewDesignerState.validations[tab];
    if (!res || !res.valid || res.staticOnly) {
      panel.innerHTML = `
        <div style="padding:1.5rem; text-align:center; font-size:12.5px; color:var(--text-muted);">
          ${tab !== viewDesignerState.activeDialect
            ? `Live row preview is only available on the active <strong>${escapeHtml(viewDesignerState.activeDialect.toUpperCase())}</strong> tab.`
            : 'Click <strong>Validate & Preview</strong> to inspect live query results and inferred column types.'}
        </div>
      `;
      return;
    }

    const cols = res.schema || [];
    const rows = res.rows || [];

    if (cols.length === 0) {
      panel.innerHTML = `<div style="padding:1.25rem; text-align:center; font-size:12.5px; color:var(--text-muted);">No columns returned by query.</div>`;
      return;
    }

    panel.innerHTML = `
      <div style="padding:0.5rem 0.85rem; border-bottom:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center; background:var(--bg-input);">
        <span style="font-size:12px; font-weight:700; color:var(--text-heading);">Results Preview (max 25 rows)</span>
        <span style="font-size:11px; color:var(--text-muted);">${rows.length} row(s)</span>
      </div>
      <div style="overflow-x:auto; max-height:300px;">
        <table class="data-table" style="width:100%; border-collapse:collapse; font-size:12px;">
          <thead>
            <tr>
              ${cols.map((c) => `
                <th style="text-align:left; padding:0.5rem 0.75rem; border-bottom:1px solid var(--border-subtle); white-space:nowrap;">
                  <span>${escapeHtml(c.name)}</span>
                  <span style="font-size:10px; color:var(--text-muted); font-weight:400; margin-left:4px;">(${escapeHtml(c.type)})</span>
                </th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0 ? `
              <tr><td colspan="${cols.length}" style="padding:1.25rem; text-align:center; color:var(--text-muted);">Query succeeded with 0 matching rows.</td></tr>
            ` : rows.map((r) => `
              <tr>
                ${cols.map((c) => {
                  const val = r[c.name];
                  if (val === null || val === undefined) {
                    return `<td style="padding:0.45rem 0.75rem; border-bottom:1px solid var(--border-subtle); color:#6b7280; font-style:italic;">NULL</td>`;
                  }
                  if (typeof val === 'object') {
                    return `<td style="padding:0.45rem 0.75rem; border-bottom:1px solid var(--border-subtle);"><code>${escapeHtml(JSON.stringify(val))}</code></td>`;
                  }
                  return `<td style="padding:0.45rem 0.75rem; border-bottom:1px solid var(--border-subtle);">${escapeHtml(String(val))}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function previewViewDesignerQuery() {
    syncCurrentTabFromEditor();
    const tab = viewDesignerState.selectedTab;
    viewDesignerState.isValidating = true;
    renderViewDesignerValidation();

    try {
      const res = await api('/api/collections/preview-view', {
        method: 'POST',
        body: JSON.stringify({
          name: (viewDesignerState.mode === 'edit' ? viewDesignerState.originalName : viewDesignerState.name).trim() || undefined,
          viewQueries: viewDesignerState.viewQueries,
          dialect: tab,
          limit: 25,
        }),
      });
      viewDesignerState.validations[tab] = res;
    } catch (err) {
      viewDesignerState.validations[tab] = {
        valid: false,
        error: err.message || 'Failed to validate view query',
        schema: [],
        rows: [],
      };
    } finally {
      viewDesignerState.isValidating = false;
      renderViewDesignerValidation();
      renderViewDesignerPreview();
    }
  }

  async function saveViewDesigner() {
    syncCurrentTabFromEditor();
    const nameEl = document.getElementById('vd-view-name');
    const name = (nameEl ? nameEl.value : viewDesignerState.name).trim();

    if (!name) {
      toast('Please enter a view collection name', 'error');
      nameEl?.focus();
      return;
    }

    const activeSql = (viewDesignerState.viewQueries[viewDesignerState.activeDialect] || '').trim();
    if (!activeSql) {
      toast(`Please enter a SQL SELECT query for the active ${viewDesignerState.activeDialect.toUpperCase()} engine`, 'error');
      return;
    }

    const activeVal = viewDesignerState.validations[viewDesignerState.activeDialect];
    if (viewDesignerState.mode === 'edit' && activeVal?.schemaDiff?.hasBreakingChanges) {
      const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('This edit removes or changes the type of existing view columns, which may affect generated types or rules. Save anyway?')
        : true;
      if (!ok) return;
    }

    const cleanedQueries = {};
    for (const d of DIALECTS) {
      const q = (viewDesignerState.viewQueries[d.id] || '').trim();
      if (q) cleanedQueries[d.id] = q;
    }

    viewDesignerState.isSaving = true;
    try {
      let saved;
      if (viewDesignerState.mode === 'edit' && viewDesignerState.originalName) {
        saved = await api(`/api/collections/${encodeURIComponent(viewDesignerState.originalName)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            options: { viewQueries: cleanedQueries },
          }),
        });
        toast(`SQL View '${saved.name}' updated!`, 'success');
      } else {
        saved = await api('/api/collections', {
          method: 'POST',
          body: JSON.stringify({
            name,
            type: 'view',
            options: { viewQueries: cleanedQueries },
          }),
        });
        toast(`SQL View '${saved.name}' created!`, 'success');
      }
      viewDesignerState.initialSnapshot = computeSnapshot();
      await loadCollections();
      selectCollection(saved.name);
    } catch (err) {
      toast(err.message || 'Failed to save SQL view', 'error');
    } finally {
      viewDesignerState.isSaving = false;
    }
  }

  function closeViewDesigner() {
    if (typeof selectNav === 'function') {
      selectNav('collections');
    }
  }

  if (typeof window !== 'undefined') {
    window.openViewDesigner = openViewDesigner;
    window.closeViewDesigner = closeViewDesigner;
    window.isViewDesignerDirty = isViewDesignerDirty;
    window.confirmLeaveViewDesigner = confirmLeaveViewDesigner;
    window.onViewDesignerAppSwitched = onViewDesignerAppSwitched;
    window.switchViewDesignerDialect = switchViewDesignerDialect;
    window.toggleViewDesignerTable = toggleViewDesignerTable;
    window.filterViewDesignerTables = filterViewDesignerTables;
    window.updateViewDesignerName = updateViewDesignerName;
    window.insertSqlToken = insertSqlToken;
    window.previewViewDesignerQuery = previewViewDesignerQuery;
    window.saveViewDesigner = saveViewDesigner;
    window.viewDesignerState = viewDesignerState;
  }
})();
