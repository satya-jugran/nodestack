// Collections Management, Sidebar & Hub Views

function renderCollectionsHubView() {
  const target = document.getElementById('collections-detail-pane') || document.getElementById('main-body');
  if (!target) return;
  const allCols = Array.isArray(state.collections)
    ? state.collections
    : (state.collections && Array.isArray(state.collections.items) ? state.collections.items : []);
  const userCols = allCols.filter(c => !isSystemCollection(c));
  const systemCols = allCols.filter(c => isSystemCollection(c));

  target.innerHTML = `
    <div class="hub-hero-banner">
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem;">
        <div>
          <h2 style="font-size:18px; font-weight:800; color:#fff; letter-spacing:-0.02em;">Collections & Schema Directory</h2>
          <p style="font-size:12px; color:var(--text-muted); margin-top:3px;">
            Embedded SQLite database tables with instant REST API, CRUD endpoints, and realtime subscriptions.
          </p>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <button class="btn btn-primary btn-sm" onclick="openNewCollectionModal()">+ New Collection</button>
          <button class="btn btn-secondary btn-sm" onclick="openTemplatesModal()">✨ Starter Recipes</button>
          <button class="btn btn-secondary btn-sm" onclick="openImportModal()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Import JSON</button>
        </div>
      </div>

      <div class="hub-stats-row" style="margin-top:0.5rem;">
        <div class="hub-stat-card">
          <span style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Total Collections</span>
          <span style="font-size:20px; font-weight:800; color:#fff;">${allCols.length}</span>
        </div>
        <div class="hub-stat-card">
          <span style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">User Collections</span>
          <span style="font-size:20px; font-weight:800; color:#60a5fa;">${userCols.length}</span>
        </div>
        <div class="hub-stat-card">
          <span style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">System Tables</span>
          <span style="font-size:20px; font-weight:800; color:#34d399;">${systemCols.length}</span>
        </div>
      </div>
    </div>

    <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin:0.25rem 0;">
      All Registered Collections (${allCols.length})
    </div>

    <div class="hub-cards-grid">
      ${allCols.map(col => {
        const isSys = isSystemCollection(col);
        const fieldCount = col.schema ? col.schema.length : 0;
        return `
          <div class="hub-card" onclick="selectCollection('${escapeHtml(col.name)}')">
            <div class="hub-card-header">
              <div class="hub-card-title">
                <span>${isSys ? '⚙️' : '📁'}</span>
                <span>${escapeHtml(col.name)}</span>
              </div>
              <div style="display:flex; align-items:center; gap:4px;">
                <span class="badge ${col.type === 'auth' ? 'badge-post' : 'badge-get'}" style="font-size:10px;">${escapeHtml(col.type)}</span>
                ${isSys ? `<span class="badge badge-warning" style="font-size:9.5px;">SYSTEM</span>` : ''}
              </div>
            </div>
            <div class="hub-card-desc">
              ${fieldCount} schema fields defined. Managed embedded table with automatic API rules and validation.
            </div>
            <div class="hub-card-footer">
              <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); selectCollection('${escapeHtml(col.name)}')">
                Open Data Grid ➔
              </button>
              <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); selectCollection('${escapeHtml(col.name)}'); switchCollectionTab('schema');" title="Configure schema">
                ⚙️ Schema
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function loadCollections() {
  try {
    const res = await api('/api/collections');
    state.collections = res.items || [];
    renderCollectionsList();
    if (typeof renderPluginNavItems === 'function') {
      renderPluginNavItems();
    }
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

  const rawCols = state.collections;
  const allCols = Array.isArray(rawCols)
    ? rawCols
    : (rawCols && Array.isArray(rawCols.items) ? rawCols.items : []);

  const filterTerm = (state.collectionFilterTerm || '').toLowerCase();
  const userCols = allCols.filter(c => !isSystemCollection(c));
  const systemCols = allCols.filter(c => isSystemCollection(c));

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

  const countEl = document.getElementById('sidebar-collections-count');
  if (countEl) {
    countEl.textContent = String(state.collections ? state.collections.length : 0);
  }

  if (state.activeNav === 'collections' && !state.activeCollection) {
    renderCollectionsHubView();
  }

  if (state.admin) {
    const emailEl = document.getElementById('admin-user-email');
    if (emailEl) {
      emailEl.textContent = `Logout (${state.admin.email})`;
    }
  }
}

// Select Collection
async function selectCollection(name, pushState = true) {
  state.activeNav = 'collection';
  const allCols = Array.isArray(state.collections)
    ? state.collections
    : (state.collections && Array.isArray(state.collections.items) ? state.collections.items : []);
  state.activeCollection = allCols.find(c => c.name === name);
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

  showPageView('collections');
  clearSidebarNavActive();
  document.getElementById('nav-collections')?.classList.add('active');

  renderCollectionsList();

  document.getElementById('collection-tabs').style.display = 'flex';

  document.getElementById('view-title').textContent = state.activeCollection ? state.activeCollection.name : name;
  document.getElementById('view-title').style.display = 'inline-block';
  const badge = document.getElementById('view-badge');
  if (badge && state.activeCollection) {
    badge.style.display = 'inline-flex';
    badge.textContent = state.activeCollection.type.toUpperCase();
    badge.className = 'badge ' + (state.activeCollection.type === 'auth' ? 'badge-post' : 'badge-get');
  }

  updateBreadcrumbs();

  if (state.collectionTab === 'records') {
    renderRecordsView();
    await loadRecords();
  } else {
    renderSchemaView();
  }

  if (pushState) {
    const sub = (state.collectionTab === 'schema') ? '/schema' : '';
    if (typeof updateUrl === 'function') {
      updateUrl('/_/collections/' + encodeURIComponent(name) + sub);
    }
  }
}

// Collection Tabs
function switchCollectionTab(tab, pushState = true) {
  state.collectionTab = tab;
  document.getElementById('tab-records').className = tab === 'records' ? 'tab-btn active' : 'tab-btn';
  document.getElementById('tab-schema').className = tab === 'schema' ? 'tab-btn active' : 'tab-btn';

  updateBreadcrumbs();

  if (pushState && state.activeCollection) {
    const sub = (tab === 'schema') ? '/schema' : '';
    if (typeof updateUrl === 'function') {
      updateUrl('/_/collections/' + encodeURIComponent(state.activeCollection.name) + sub);
    }
  }

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

  // 1. NodeStack Root
  crumbs.push({
    label: 'NodeStack',
    clickable: true,
    action: () => selectNav('home')
  });

  if (state.activeNav === 'collection' && state.activeCollection) {
    crumbs.push({
      label: 'Collections',
      clickable: true,
      action: () => selectNav('collections')
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
  } else if (state.activeNav === 'collections') {
    crumbs.push({ label: 'Collections', active: true });
  } else if (state.activeNav === 'plugins') {
    crumbs.push({ label: 'Plugins', active: true });
  } else if (state.activeNav === 'webhooks') {
    if (typeof webhooksState !== 'undefined' && webhooksState.subTab === 'deliveries') {
      crumbs.push({ label: 'Webhooks', clickable: true, action: () => { if (typeof switchWebhooksTab === 'function') switchWebhooksTab('webhooks'); } });
      crumbs.push({ label: 'Delivery Logs', active: true });
    } else {
      crumbs.push({ label: 'Webhooks', active: true });
    }
  } else if (state.activeNav === 'functions') {
    if (typeof functionsState !== 'undefined' && functionsState.subTab === 'logs') {
      crumbs.push({ label: 'Functions', clickable: true, action: () => { if (typeof switchFunctionsTab === 'function') switchFunctionsTab('functions'); } });
      crumbs.push({ label: 'Execution Logs', active: true });
    } else {
      crumbs.push({ label: 'Functions', active: true });
    }
  } else if (state.activeNav === 'home') {
    crumbs.push({ label: 'Overview', active: true });
  } else if (state.activeNav === 'analytics') {
    crumbs.push({ label: 'Analytics', active: true });
  } else if (state.activeNav === 'snapshots') {
    crumbs.push({ label: 'Snapshots', active: true });
  } else if (state.activeNav === 'logs') {
    crumbs.push({ label: 'Audit Logs', active: true });

  } else if (state.pluginNavItems && state.pluginNavItems.some(p => p.id === state.activeNav)) {
    const item = state.pluginNavItems.find(p => p.id === state.activeNav);
    crumbs.push({ label: 'Plugins', clickable: true, action: () => selectNav('plugins') });
    crumbs.push({ label: item.title, active: true });
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

// Expose on window for browser event handlers & test harnesses
if (typeof window !== 'undefined') {
  window.renderCollectionsHubView = renderCollectionsHubView;
  window.loadCollections = loadCollections;
  window.isSystemCollection = isSystemCollection;
  window.toggleCollectionSection = toggleCollectionSection;
  window.handleCollectionFilterInput = handleCollectionFilterInput;
  window.clearCollectionFilter = clearCollectionFilter;
  window.renderCollectionItemHtml = renderCollectionItemHtml;
  window.renderCollectionsList = renderCollectionsList;
  window.selectCollection = selectCollection;
  window.switchCollectionTab = switchCollectionTab;
  window.updateBreadcrumbs = updateBreadcrumbs;
  window.handleBreadcrumbClick = handleBreadcrumbClick;
  window.toggleCollectionCreateMenu = toggleCollectionCreateMenu;
  window.closeCollectionCreateMenu = closeCollectionCreateMenu;
  window.handleCollectionMenuAction = handleCollectionMenuAction;
}
