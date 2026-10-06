// Application Navigation & Lifecycle

    function clearSidebarNavActive() {
      const navIds = ['nav-home', 'nav-analytics', 'nav-snapshots', 'nav-logs', 'nav-settings'];
      for (const id of navIds) {
        document.getElementById(id)?.classList.remove('active');
      }
    }

    async function selectNav(nav) {
      state.activeNav = nav;
      state.activeCollection = null;
      renderCollectionsList();

      document.getElementById('collection-tabs').style.display = 'none';
      document.getElementById('view-badge').style.display = 'none';

      if (typeof stopAnalyticsAutoRefresh === 'function') {
        stopAnalyticsAutoRefresh();
      }

      clearSidebarNavActive();
      document.getElementById('nav-' + nav)?.classList.add('active');

      if (nav === 'home') {
        document.getElementById('view-title').textContent = 'Dashboard Overview';
        document.getElementById('view-actions').innerHTML = `
          <button class="btn btn-secondary btn-sm" onclick="selectNav('analytics')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Metrics
          </button>
          <button class="btn btn-secondary btn-sm" onclick="selectNav('snapshots')">📸 Snapshots</button>
          <button class="btn btn-secondary btn-sm" onclick="window.open('/_/docs', '_blank')">API Docs (OpenAPI)</button>
          <button class="btn btn-primary btn-sm" onclick="openNewCollectionModal()">+ New Collection</button>
        `;
        renderHomeView();
      } else if (nav === 'analytics') {
        document.getElementById('view-title').textContent = 'Analytics & Metrics';
        document.getElementById('view-actions').innerHTML = `
          <button class="btn btn-secondary btn-sm" onclick="loadAnalytics()">Refresh</button>
          <button class="btn btn-primary btn-sm" onclick="selectNav('home')">Overview</button>
        `;
        renderAnalyticsView();
        loadAnalytics();
        if (typeof analyticsState !== 'undefined' && analyticsState.autoRefreshEnabled) {
          startAnalyticsAutoRefresh();
        }
      } else if (nav === 'snapshots') {
        document.getElementById('view-title').textContent = 'Demo Snapshots';
        document.getElementById('view-actions').innerHTML = `
          <button class="btn btn-secondary btn-sm" onclick="openSnapshotDemoModal()">
            📸 Snapshot Demo State
          </button>
          <button class="btn btn-warning btn-sm" onclick="openResetDemoModal()" style="font-weight:700;">
            ↺ Reset Demo Data
          </button>
        `;
        renderSnapshotsView();
      } else if (nav === 'logs') {
        document.getElementById('view-title').textContent = 'Traffic & Logs';
        document.getElementById('view-actions').innerHTML = `
          <button class="btn btn-secondary btn-sm" onclick="loadLogs()">Refresh</button>
          <button class="btn btn-danger btn-sm" onclick="clearLogs()">Clear Logs</button>
        `;
        renderLogsView();
        loadLogs();
      } else if (nav === 'settings') {
        document.getElementById('view-title').textContent = 'System & Settings';
        document.getElementById('view-actions').innerHTML = '';
        renderSettingsView();
      }

      updateBreadcrumbs();
    }

    async function loadCollections() {
      try {
        const res = await api('/api/collections');
        state.collections = res.items || [];
        renderCollectionsList();
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    function isSystemCollection(col) {
      return Boolean(col.system || (col.name && col.name.startsWith('_')));
    }

    function toggleCollectionSection(section) {
      if (!state.collapsedSections) {
        state.collapsedSections = { user: false, system: false };
      }
      state.collapsedSections[section] = !state.collapsedSections[section];
      renderCollectionsList();
    }

    function handleCollectionFilterInput(val) {
      state.collectionFilterTerm = (val || '').trim();
      const clearBtn = document.getElementById('collection-filter-clear-btn');
      if (clearBtn) {
        clearBtn.style.display = state.collectionFilterTerm ? 'inline-flex' : 'none';
      }
      renderCollectionsList();
    }

    function clearCollectionFilter() {
      state.collectionFilterTerm = '';
      const input = document.getElementById('collection-filter-input');
      if (input) {
        input.value = '';
        input.focus();
      }
      const clearBtn = document.getElementById('collection-filter-clear-btn');
      if (clearBtn) {
        clearBtn.style.display = 'none';
      }
      renderCollectionsList();
    }

    function renderCollectionItemHtml(col) {
      const isActive = state.activeCollection?.name === col.name;
      return `
        <div class="collection-item ${isActive ? 'active' : ''}" onclick="selectCollection('${escapeHtml(col.name)}')" style="display:flex; align-items:center; justify-content:space-between; gap:4px;">
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${escapeHtml(col.name)}</span>
          <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
            <span class="collection-badge">${escapeHtml(col.type)}</span>
            ${!col.system ? `
              <span class="col-del-btn" title="Delete collection" onclick="event.stopPropagation(); openDeleteCollectionModal('${escapeHtml(col.name)}')" style="cursor:pointer; opacity:0.4; font-size:11px; padding:2px 4px; border-radius:3px; transition:all 0.15s;" onmouseover="this.style.opacity='1'; this.style.color='#ef4444'; this.style.background='rgba(239,68,68,0.15)'" onmouseout="this.style.opacity='0.4'; this.style.color='inherit'; this.style.background='transparent'">
                ✕
              </span>
            ` : ''}
          </div>
        </div>
      `;
    }

    function renderCollectionsList() {
      const container = document.getElementById('collections-list');
      if (!container) return;

      const filterTerm = (state.collectionFilterTerm || '').toLowerCase();
      const userCols = (state.collections || []).filter(c => !isSystemCollection(c));
      const systemCols = (state.collections || []).filter(c => isSystemCollection(c));

      const filteredUserCols = filterTerm
        ? userCols.filter(c => c.name.toLowerCase().includes(filterTerm))
        : userCols;

      const filteredSystemCols = filterTerm
        ? systemCols.filter(c => c.name.toLowerCase().includes(filterTerm))
        : systemCols;

      // When searching, automatically expand sections
      const isUserCollapsed = Boolean(filterTerm ? false : state.collapsedSections?.user);
      const isSystemCollapsed = Boolean(filterTerm ? false : state.collapsedSections?.system);

      let html = '';

      // 1. User Collections Group
      html += `
        <div class="collection-group" id="group-user-collections">
          <div class="collection-group-header" onclick="toggleCollectionSection('user')" role="button" tabindex="0" aria-expanded="${!isUserCollapsed}" aria-controls="group-items-user" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleCollectionSection('user');}" title="Toggle User Collections">
            <div class="collection-group-title">
              <svg class="collection-group-chevron ${isUserCollapsed ? 'collapsed' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <span>User Collections</span>
            </div>
            <span class="collection-group-count">${filteredUserCols.length}</span>
          </div>
          <div class="collection-group-items ${isUserCollapsed ? 'collapsed' : ''}" id="group-items-user">
            ${filteredUserCols.length > 0
              ? filteredUserCols.map(col => renderCollectionItemHtml(col)).join('')
              : `<div class="collection-group-empty">${filterTerm ? 'No matching collections' : 'No user collections yet'}</div>`
            }
          </div>
        </div>
      `;

      // 2. System Tables Group
      html += `
        <div class="collection-group" id="group-system-tables">
          <div class="collection-group-header" onclick="toggleCollectionSection('system')" role="button" tabindex="0" aria-expanded="${!isSystemCollapsed}" aria-controls="group-items-system" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleCollectionSection('system');}" title="Toggle System Tables">
            <div class="collection-group-title">
              <svg class="collection-group-chevron ${isSystemCollapsed ? 'collapsed' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <span>System Tables</span>
            </div>
            <span class="collection-group-count">${filteredSystemCols.length}</span>
          </div>
          <div class="collection-group-items ${isSystemCollapsed ? 'collapsed' : ''}" id="group-items-system">
            ${filteredSystemCols.length > 0
              ? filteredSystemCols.map(col => renderCollectionItemHtml(col)).join('')
              : `<div class="collection-group-empty">${filterTerm ? 'No matching system tables' : 'No system tables'}</div>`
            }
          </div>
        </div>
      `;

      container.innerHTML = html;

      if (state.admin) {
        const emailEl = document.getElementById('admin-user-email');
        if (emailEl) {
          emailEl.textContent = `Logout (${state.admin.email})`;
        }
      }
    }

    // Select Collection
    async function selectCollection(name) {
      state.activeNav = 'collection';
      state.activeCollection = state.collections.find(c => c.name === name);
      // Reset collection-specific records state
      state.recordsPage = 1;
      state.recordsFilter = '';
      state.recordsSearchTerm = '';
      state.recordsSearchField = '_all';
      state.recordsSort = '';
      state.selectedRecordId = null;
      if (typeof closeRecordDrawer === 'function') {
        closeRecordDrawer();
      }
      renderCollectionsList();

      clearSidebarNavActive();
      document.getElementById('collection-tabs').style.display = 'flex';

      document.getElementById('view-title').textContent = state.activeCollection.name;
      const badge = document.getElementById('view-badge');
      badge.style.display = 'inline-flex';
      badge.textContent = state.activeCollection.type.toUpperCase();
      badge.className = 'badge badge-post';

      updateBreadcrumbs();

      if (state.collectionTab === 'records') {
        renderRecordsView();
        await loadRecords();
      } else {
        renderSchemaView();
      }
    }

    // Collection Tabs
    function switchCollectionTab(tab) {
      state.collectionTab = tab;
      document.getElementById('tab-records').className = tab === 'records' ? 'tab-btn active' : 'tab-btn';
      document.getElementById('tab-schema').className = tab === 'schema' ? 'tab-btn active' : 'tab-btn';

      updateBreadcrumbs();

      if (tab === 'records') {
        renderRecordsView();
        loadRecords();
      } else {
        renderSchemaView();
      }
    }

    // ==========================================
    // Breadcrumb Top Bar
    // ==========================================

    function updateBreadcrumbs() {
      const trail = document.getElementById('breadcrumb-trail');
      if (!trail) return;

      const crumbs = [];

      // 1. Dashboard Root
      crumbs.push({
        label: 'Dashboard',
        clickable: true,
        action: () => selectNav('home')
      });

      if (state.activeNav === 'collection' && state.activeCollection) {
        crumbs.push({
          label: 'Collections',
          clickable: false
        });
        crumbs.push({
          label: state.activeCollection.name,
          clickable: state.collectionTab !== 'records',
          action: () => switchCollectionTab('records')
        });
        if (state.collectionTab === 'schema') {
          crumbs.push({
            label: 'Schema & Rules',
            active: true
          });
        } else {
          crumbs.push({
            label: 'Records',
            active: true
          });
        }
      } else if (state.activeNav === 'home') {
        crumbs.push({ label: 'Overview', active: true });
      } else if (state.activeNav === 'analytics') {
        crumbs.push({ label: 'Analytics & Metrics', active: true });
      } else if (state.activeNav === 'snapshots') {
        crumbs.push({ label: 'Snapshots', active: true });
      } else if (state.activeNav === 'logs') {
        crumbs.push({ label: 'Traffic & Logs', active: true });
      } else if (state.activeNav === 'settings') {
        crumbs.push({ label: 'System & Settings', active: true });
      }

      trail.innerHTML = crumbs.map((crumb, idx) => {
        const isLast = idx === crumbs.length - 1;
        let content = '';
        if (isLast || crumb.active) {
          content = `<span class="breadcrumb-item active" aria-current="page">${escapeHtml(crumb.label)}</span>`;
        } else if (crumb.clickable) {
          content = `<a href="javascript:void(0)" class="breadcrumb-item breadcrumb-link" onclick="handleBreadcrumbClick(${idx})">${escapeHtml(crumb.label)}</a>`;
        } else {
          content = `<span class="breadcrumb-item">${escapeHtml(crumb.label)}</span>`;
        }

        if (idx < crumbs.length - 1) {
          return `<li class="breadcrumb-crumb">${content}<span class="breadcrumb-separator" aria-hidden="true">/</span></li>`;
        }
        return `<li class="breadcrumb-crumb">${content}</li>`;
      }).join('');

      window._currentBreadcrumbs = crumbs;
    }

    function handleBreadcrumbClick(idx) {
      if (window._currentBreadcrumbs && window._currentBreadcrumbs[idx]?.action) {
        window._currentBreadcrumbs[idx].action();
      }
    }

    // ==========================================
    // Collections Create Dropdown Menu (+ New ▾)
    // ==========================================

    function toggleCollectionCreateMenu(e) {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      const menu = document.getElementById('collection-create-menu');
      if (!menu) return;
      const isHidden = menu.style.display === 'none' || !menu.style.display;
      menu.style.display = isHidden ? 'flex' : 'none';
    }

    function closeCollectionCreateMenu() {
      const menu = document.getElementById('collection-create-menu');
      if (menu) menu.style.display = 'none';
    }

    function handleCollectionMenuAction(action) {
      closeCollectionCreateMenu();
      if (action === 'new') {
        openNewCollectionModal();
      } else if (action === 'templates') {
        openTemplatesModal();
      } else if (action === 'import') {
        openImportJsonModal();
      }
    }

    // ==========================================
    // Global Command Palette (Ctrl + K / Cmd + K)
    // ==========================================

    let commandPaletteActiveIndex = 0;
    let commandPaletteFilteredItems = [];

    function getAllCommandPaletteItems() {
      const items = [];

      // 1. Collections (User & System)
      for (const col of state.collections || []) {
        const isSys = isSystemCollection(col);
        items.push({
          id: `col-${col.name}`,
          title: col.name,
          description: `Jump to ${col.name} (${col.type}) collection`,
          category: isSys ? 'System Tables' : 'Collections',
          badge: col.type.toUpperCase(),
          icon: isSys ? '⚙️' : '📁',
          keywords: [col.name, col.name.toLowerCase(), 'collection', 'jump', col.type, isSys ? 'system' : 'user'],
          action: () => selectCollection(col.name)
        });
      }

      // 2. Navigation items
      items.push({
        id: 'nav-home',
        title: 'Dashboard Overview',
        description: 'Server status, collections list, quick stats',
        category: 'Navigation',
        badge: 'PAGE',
        icon: '🏠',
        keywords: ['home', 'dashboard', 'overview'],
        action: () => selectNav('home')
      });

      items.push({
        id: 'nav-analytics',
        title: 'Analytics & Metrics',
        description: 'Realtime telemetry, latency and request throughput',
        category: 'Navigation',
        badge: 'PAGE',
        icon: '📊',
        keywords: ['metrics', 'analytics', 'telemetry', 'stats', 'traffic', 'latency'],
        action: () => selectNav('analytics')
      });

      items.push({
        id: 'nav-snapshots',
        title: 'Demo Snapshots',
        description: 'Capture or restore database demo state snapshots',
        category: 'Navigation',
        badge: 'PAGE',
        icon: '📸',
        keywords: ['snapshots', 'snapshot', 'backup', 'restore', 'demo'],
        action: () => selectNav('snapshots')
      });

      items.push({
        id: 'nav-logs',
        title: 'Traffic & Logs',
        description: 'Live HTTP request activity, errors and slow queries',
        category: 'Navigation',
        badge: 'PAGE',
        icon: '📝',
        keywords: ['logs', 'traffic', 'requests', 'errors', 'debug'],
        action: () => selectNav('logs')
      });

      items.push({
        id: 'nav-settings',
        title: 'System & Settings',
        description: 'Database maintenance, token secrets and security',
        category: 'Navigation',
        badge: 'PAGE',
        icon: '⚙️',
        keywords: ['settings', 'system', 'config', 'configuration'],
        action: () => selectNav('settings')
      });

      // 3. Actions: Export
      if (state.activeCollection) {
        items.push({
          id: 'action-export-json',
          title: `Export ${state.activeCollection.name} (JSON)`,
          description: `Download ${state.activeCollection.name} records as JSON format`,
          category: 'Actions',
          badge: 'EXPORT',
          icon: '⚡',
          keywords: ['export', 'export json', 'download', 'json', 'current collection', state.activeCollection.name],
          action: () => {
            if (typeof exportData === 'function') {
              exportData('json');
            }
          }
        });
        items.push({
          id: 'action-export-csv',
          title: `Export ${state.activeCollection.name} (CSV)`,
          description: `Download ${state.activeCollection.name} records as CSV spreadsheet`,
          category: 'Actions',
          badge: 'EXPORT',
          icon: '📄',
          keywords: ['export', 'export csv', 'download', 'csv', 'current collection', state.activeCollection.name],
          action: () => {
            if (typeof exportData === 'function') {
              exportData('csv');
            }
          }
        });
      } else {
        items.push({
          id: 'action-export',
          title: 'Export Collection Records',
          description: 'Trigger data export (requires active collection)',
          category: 'Actions',
          badge: 'EXPORT',
          icon: '⚡',
          keywords: ['export', 'download', 'json', 'csv'],
          action: () => {
            toast('Please select a collection first to export records', 'info');
          }
        });
      }

      // 4. Actions: New Collection
      items.push({
        id: 'action-new-collection',
        title: 'New Collection',
        description: 'Create a new schema from scratch',
        category: 'Actions',
        badge: 'CREATE',
        icon: '➕',
        keywords: ['new', 'create', 'collection', 'add collection', 'new collection'],
        action: () => {
          if (typeof openNewCollectionModal === 'function') {
            openNewCollectionModal();
          }
        }
      });

      // 5. Actions: Starter Templates
      items.push({
        id: 'action-templates',
        title: 'Starter Templates',
        description: 'Pre-seeded recipes (E-Commerce, Blog, CRM)',
        category: 'Actions',
        badge: 'RECIPE',
        icon: '✨',
        keywords: ['templates', 'starter templates', 'ecommerce', 'blog', 'crm', 'recipe'],
        action: () => {
          if (typeof openTemplatesModal === 'function') {
            openTemplatesModal();
          }
        }
      });

      // 6. Actions: Import JSON
      items.push({
        id: 'action-import-json',
        title: 'Import JSON Schema',
        description: 'Generate database schema from JSON sample',
        category: 'Actions',
        badge: 'IMPORT',
        icon: '📥',
        keywords: ['import', 'json', 'schema', 'upload'],
        action: () => {
          if (typeof openImportJsonModal === 'function') {
            openImportJsonModal();
          }
        }
      });

      // 7. Action: New Record (if collection active)
      if (state.activeCollection) {
        items.push({
          id: 'action-new-record',
          title: `Create Record in ${state.activeCollection.name}`,
          description: `Insert a new row into ${state.activeCollection.name}`,
          category: 'Actions',
          badge: 'RECORD',
          icon: '📝',
          keywords: ['new record', 'create record', 'add record', 'insert', 'row'],
          action: () => {
            if (typeof openNewRecordModal === 'function') {
              openNewRecordModal();
            }
          }
        });
      }

      // 8. Action: OpenAPI Docs
      items.push({
        id: 'action-docs',
        title: 'API Docs (OpenAPI)',
        description: 'Interactive OpenAPI 3.0 Reference & testing sandbox',
        category: 'Documentation',
        badge: 'DOCS',
        icon: '📖',
        keywords: ['docs', 'openapi', 'swagger', 'api reference'],
        action: () => {
          window.open('/_/docs', '_blank');
        }
      });

      return items;
    }

    function filterCommandPaletteItems(query) {
      const all = getAllCommandPaletteItems();
      const q = (query || '').trim().toLowerCase();
      if (!q) {
        return all;
      }

      const scored = [];
      for (const item of all) {
        let score = 0;
        const titleLower = item.title.toLowerCase();

        if (titleLower === q) {
          score += 100;
        } else if (titleLower.startsWith(q)) {
          score += 70;
        } else if (titleLower.includes(q)) {
          score += 40;
        }

        for (const kw of item.keywords || []) {
          if (kw === q) {
            score = Math.max(score, 90);
          } else if (kw.startsWith(q)) {
            score = Math.max(score, 60);
          } else if (kw.includes(q)) {
            score = Math.max(score, 30);
          }
        }

        if (item.description && item.description.toLowerCase().includes(q)) {
          score = Math.max(score, 20);
        }

        if (score > 0) {
          scored.push({ item, score });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.map(s => s.item);
    }

    function renderCommandPaletteResultsHtml(items, selectedIndex) {
      if (!items || items.length === 0) {
        return `<div class="command-palette-empty">No matching commands or collections found</div>`;
      }

      return items.map((item, idx) => `
        <div 
          class="command-palette-item ${idx === selectedIndex ? 'selected' : ''}" 
          id="command-palette-item-${idx}"
          onclick="executeCommandPaletteItem(${idx})"
          onmouseenter="setCommandPaletteActiveIndex(${idx})"
          data-index="${idx}"
          role="option"
          aria-selected="${idx === selectedIndex ? 'true' : 'false'}"
          tabindex="-1"
        >
          <div class="command-palette-item-left">
            <div class="command-palette-item-icon" aria-hidden="true">${item.icon || '⚡'}</div>
            <div class="command-palette-item-text">
              <div class="command-palette-item-title">${escapeHtml(item.title)}</div>
              <div class="command-palette-item-desc">${escapeHtml(item.description)}</div>
            </div>
          </div>
          <div class="command-palette-item-badge">${escapeHtml(item.badge || item.category)}</div>
        </div>
      `).join('');
    }

    function openCommandPalette() {
      commandPaletteActiveIndex = 0;
      commandPaletteFilteredItems = filterCommandPaletteItems('');
      const root = document.getElementById('command-palette-root');
      if (!root) return;

      root.innerHTML = `
        <div class="command-palette-backdrop" id="command-palette-backdrop" onclick="handleCommandPaletteBackdrop(event)" onkeydown="if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeCommandPalette();}">
          <div class="command-palette-modal" role="dialog" aria-modal="true" aria-label="Command Palette">
            <div class="command-palette-header">
              <svg class="command-palette-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input 
                type="text" 
                id="command-palette-input" 
                class="command-palette-input" 
                placeholder="Type a command or jump to... (e.g. users, metrics, export, new)" 
                autocomplete="off" 
                spellcheck="false"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="${commandPaletteFilteredItems.length > 0 ? 'true' : 'false'}"
                aria-haspopup="listbox"
                aria-controls="command-palette-results"
                ${commandPaletteFilteredItems.length > 0 ? 'aria-activedescendant="command-palette-item-0"' : ''}
                oninput="handleCommandPaletteInput(this.value)"
                onkeydown="handleCommandPaletteKeyDown(event)"
              />
              <span class="command-palette-esc-badge" onclick="closeCommandPalette()" role="button" aria-label="Close command palette">ESC</span>
            </div>
            <div class="command-palette-results" id="command-palette-results" role="listbox" aria-label="Commands and collections">
              ${renderCommandPaletteResultsHtml(commandPaletteFilteredItems, 0)}
            </div>
            <div class="command-palette-footer">
              <div class="command-palette-footer-shortcuts">
                <span><kbd class="palette-kbd">↑</kbd><kbd class="palette-kbd">↓</kbd> navigate</span>
                <span><kbd class="palette-kbd">↵</kbd> select</span>
                <span><kbd class="palette-kbd">esc</kbd> close</span>
              </div>
              <div style="font-size:10px; opacity:0.7;">NodeStack Quick Jump</div>
            </div>
          </div>
        </div>
      `;

      setTimeout(() => {
        const input = document.getElementById('command-palette-input');
        if (input) input.focus();
      }, 20);
    }

    function closeCommandPalette() {
      const root = document.getElementById('command-palette-root');
      if (root) root.innerHTML = '';
    }

    function handleCommandPaletteBackdrop(e) {
      if (e.target && e.target.id === 'command-palette-backdrop') {
        closeCommandPalette();
      }
    }

    function toggleCommandPalette() {
      const root = document.getElementById('command-palette-root');
      if (root && root.innerHTML.trim().length > 0) {
        closeCommandPalette();
      } else {
        openCommandPalette();
      }
    }

    function handleCommandPaletteInput(val) {
      commandPaletteActiveIndex = 0;
      commandPaletteFilteredItems = filterCommandPaletteItems(val);
      const container = document.getElementById('command-palette-results');
      const input = document.getElementById('command-palette-input');

      if (container) {
        container.innerHTML = renderCommandPaletteResultsHtml(commandPaletteFilteredItems, 0);
      }

      if (input) {
        if (commandPaletteFilteredItems.length > 0) {
          input.setAttribute('aria-expanded', 'true');
          input.setAttribute('aria-activedescendant', 'command-palette-item-0');
        } else {
          input.setAttribute('aria-expanded', 'false');
          input.removeAttribute('aria-activedescendant');
        }
      }
    }

    function handleCommandPaletteKeyDown(e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (commandPaletteFilteredItems.length > 0) {
          commandPaletteActiveIndex = (commandPaletteActiveIndex + 1) % commandPaletteFilteredItems.length;
          updateCommandPaletteActiveItem();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (commandPaletteFilteredItems.length > 0) {
          commandPaletteActiveIndex = (commandPaletteActiveIndex - 1 + commandPaletteFilteredItems.length) % commandPaletteFilteredItems.length;
          updateCommandPaletteActiveItem();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeCommandPaletteItem(commandPaletteActiveIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeCommandPalette();
      }
    }

    function updateCommandPaletteActiveItem() {
      const input = document.getElementById('command-palette-input');
      const items = document.querySelectorAll('.command-palette-item');
      let activeId = null;

      items.forEach((el, idx) => {
        if (idx === commandPaletteActiveIndex) {
          el.classList.add('selected');
          el.setAttribute('aria-selected', 'true');
          activeId = el.id;
          if (typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
          }
        } else {
          el.classList.remove('selected');
          el.setAttribute('aria-selected', 'false');
        }
      });

      if (input) {
        if (activeId) {
          input.setAttribute('aria-activedescendant', activeId);
        } else {
          input.removeAttribute('aria-activedescendant');
        }
      }
    }

    function setCommandPaletteActiveIndex(idx) {
      commandPaletteActiveIndex = idx;
      const input = document.getElementById('command-palette-input');
      const items = document.querySelectorAll('.command-palette-item');
      let activeId = null;

      items.forEach((el, i) => {
        if (i === idx) {
          el.classList.add('selected');
          el.setAttribute('aria-selected', 'true');
          activeId = el.id;
        } else {
          el.classList.remove('selected');
          el.setAttribute('aria-selected', 'false');
        }
      });

      if (input) {
        if (activeId) {
          input.setAttribute('aria-activedescendant', activeId);
        } else {
          input.removeAttribute('aria-activedescendant');
        }
      }
    }

    function executeCommandPaletteItem(index) {
      const item = commandPaletteFilteredItems[index];
      if (!item) return;
      closeCommandPalette();
      if (typeof item.action === 'function') {
        item.action();
      }
    }

    // Close menu when clicking outside
    window.addEventListener('click', (e) => {
      const menu = document.getElementById('collection-create-menu');
      if (menu && !e.target.closest('#btn-collection-new-dropdown') && !e.target.closest('#collection-create-menu')) {
        menu.style.display = 'none';
      }
    });

    // Global Keydown shortcuts: Ctrl+K / Cmd+K and Escape
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggleCommandPalette();
      } else if (e.key === 'Escape') {
        closeCollectionCreateMenu();
        const root = document.getElementById('command-palette-root');
        if (root && root.innerHTML.trim().length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          closeCommandPalette();
        }
      }
    });

    // Expose helpers on window for browser event handlers & tests
    if (typeof window !== 'undefined') {
      window.selectNav = selectNav;
      window.selectCollection = selectCollection;
      window.switchCollectionTab = switchCollectionTab;
      window.renderCollectionsList = renderCollectionsList;
      window.toggleCollectionSection = toggleCollectionSection;
      window.handleCollectionFilterInput = handleCollectionFilterInput;
      window.clearCollectionFilter = clearCollectionFilter;
      window.updateBreadcrumbs = updateBreadcrumbs;
      window.handleBreadcrumbClick = handleBreadcrumbClick;
      window.openCommandPalette = openCommandPalette;
      window.closeCommandPalette = closeCommandPalette;
      window.toggleCommandPalette = toggleCommandPalette;
      window.getAllCommandPaletteItems = getAllCommandPaletteItems;
      window.filterCommandPaletteItems = filterCommandPaletteItems;
      window.executeCommandPaletteItem = executeCommandPaletteItem;
      window.handleCommandPaletteInput = handleCommandPaletteInput;
      window.handleCommandPaletteKeyDown = handleCommandPaletteKeyDown;
      window.setCommandPaletteActiveIndex = setCommandPaletteActiveIndex;
    }

// Run on startup
window.addEventListener('DOMContentLoaded', init);
