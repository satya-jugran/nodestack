// Application Navigation & Lifecycle
    async function selectNav(nav) {
      state.activeNav = nav;
      state.activeCollection = null;
      renderCollectionsList();

      document.getElementById('collection-tabs').style.display = 'none';
      document.getElementById('view-badge').style.display = 'none';

      if (typeof stopAnalyticsAutoRefresh === 'function') {
        stopAnalyticsAutoRefresh();
      }

      if (nav === 'home') {
        document.getElementById('nav-home')?.classList.add('active');
        document.getElementById('nav-analytics')?.classList.remove('active');
        document.getElementById('nav-snapshots')?.classList.remove('active');
        document.getElementById('nav-logs')?.classList.remove('active');
        document.getElementById('nav-settings')?.classList.remove('active');
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
        document.getElementById('nav-home')?.classList.remove('active');
        document.getElementById('nav-analytics')?.classList.add('active');
        document.getElementById('nav-snapshots')?.classList.remove('active');
        document.getElementById('nav-logs')?.classList.remove('active');
        document.getElementById('nav-settings')?.classList.remove('active');
        document.getElementById('view-title').textContent = 'Analytics & Metrics';
        document.getElementById('view-actions').innerHTML = `
          <button class="btn btn-secondary btn-sm" onclick="loadAnalytics()">Refresh</button>
          <button class="btn btn-primary btn-sm" onclick="selectNav('home')">Overview</button>
        `;
        renderAnalyticsView();
        loadAnalytics();
        if (analyticsState.autoRefreshEnabled) {
          startAnalyticsAutoRefresh();
        }
      } else if (nav === 'snapshots') {
        document.getElementById('nav-home')?.classList.remove('active');
        document.getElementById('nav-analytics')?.classList.remove('active');
        document.getElementById('nav-snapshots')?.classList.add('active');
        document.getElementById('nav-logs')?.classList.remove('active');
        document.getElementById('nav-settings')?.classList.remove('active');
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
        document.getElementById('nav-home')?.classList.remove('active');
        document.getElementById('nav-analytics')?.classList.remove('active');
        document.getElementById('nav-snapshots')?.classList.remove('active');
        document.getElementById('nav-logs')?.classList.add('active');
        document.getElementById('nav-settings')?.classList.remove('active');
        document.getElementById('view-title').textContent = 'Traffic & Logs';
        document.getElementById('view-actions').innerHTML = `
          <button class="btn btn-secondary btn-sm" onclick="loadLogs()">Refresh</button>
          <button class="btn btn-danger btn-sm" onclick="clearLogs()">Clear Logs</button>
        `;
        renderLogsView();
        loadLogs();
      } else if (nav === 'settings') {
        document.getElementById('nav-home')?.classList.remove('active');
        document.getElementById('nav-analytics')?.classList.remove('active');
        document.getElementById('nav-snapshots')?.classList.remove('active');
        document.getElementById('nav-settings')?.classList.add('active');
        document.getElementById('nav-logs')?.classList.remove('active');
        document.getElementById('view-title').textContent = 'System & Settings';
        document.getElementById('view-actions').innerHTML = '';
        renderSettingsView();
      }
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

    function renderCollectionsList() {
      const container = document.getElementById('collections-list');
      container.innerHTML = state.collections.map(col => `
        <div class="collection-item ${state.activeCollection?.name === col.name ? 'active' : ''}" onclick="selectCollection('${col.name}')" style="display:flex; align-items:center; justify-content:space-between; gap:4px;">
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${col.name}</span>
          <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
            <span class="collection-badge">${col.type}</span>
            ${!col.system ? `
              <span class="col-del-btn" title="Delete collection" onclick="event.stopPropagation(); openDeleteCollectionModal('${col.name}')" style="cursor:pointer; opacity:0.4; font-size:11px; padding:2px 4px; border-radius:3px; transition:all 0.15s;" onmouseover="this.style.opacity='1'; this.style.color='#ef4444'; this.style.background='rgba(239,68,68,0.15)'" onmouseout="this.style.opacity='0.4'; this.style.color='inherit'; this.style.background='transparent'">
                ✕
              </span>
            ` : ''}
          </div>
        </div>
      `).join('');


      if (state.admin) {
        document.getElementById('admin-user-email').textContent = `Logout (${state.admin.email})`;
      }
    }

    // Select Collection
    async function selectCollection(name) {
      state.activeNav = 'collection';
      state.activeCollection = state.collections.find(c => c.name === name);
      renderCollectionsList();

      document.getElementById('nav-home')?.classList.remove('active');
      document.getElementById('nav-logs').classList.remove('active');
      document.getElementById('nav-settings').classList.remove('active');
      document.getElementById('collection-tabs').style.display = 'flex';

      document.getElementById('view-title').textContent = state.activeCollection.name;
      const badge = document.getElementById('view-badge');
      badge.style.display = 'inline-flex';
      badge.textContent = state.activeCollection.type.toUpperCase();
      badge.className = 'badge badge-post';

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

      if (tab === 'records') {
        renderRecordsView();
        loadRecords();
      } else {
        renderSchemaView();
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

    // Close menu when clicking outside
    window.addEventListener('click', (e) => {
      const menu = document.getElementById('collection-create-menu');
      if (menu && !e.target.closest('#btn-collection-new-dropdown') && !e.target.closest('#collection-create-menu')) {
        menu.style.display = 'none';
      }
    });

    // Close on Escape
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeCollectionCreateMenu();
      }
    });

// Run on startup
window.addEventListener('DOMContentLoaded', init);
