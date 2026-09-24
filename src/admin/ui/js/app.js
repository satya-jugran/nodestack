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
        document.getElementById('nav-logs')?.classList.remove('active');
        document.getElementById('nav-settings')?.classList.remove('active');
        document.getElementById('view-title').textContent = 'Dashboard Overview';
        document.getElementById('view-actions').innerHTML = `
          <button class="btn btn-secondary btn-sm" onclick="selectNav('analytics')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Metrics Dashboard
          </button>
          <button class="btn btn-secondary btn-sm" onclick="window.open('/_/docs', '_blank')">API Docs (OpenAPI)</button>
          <button class="btn btn-secondary btn-sm" onclick="openImportJsonModal()">⚡ Import from JSON</button>
          <button class="btn btn-primary btn-sm" onclick="openNewCollectionModal()">+ New Collection</button>
        `;
        renderHomeView();
      } else if (nav === 'analytics') {
        document.getElementById('nav-home')?.classList.remove('active');
        document.getElementById('nav-analytics')?.classList.add('active');
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
      } else if (nav === 'logs') {
        document.getElementById('nav-home')?.classList.remove('active');
        document.getElementById('nav-analytics')?.classList.remove('active');
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
        <div class="collection-item ${state.activeCollection?.name === col.name ? 'active' : ''}" onclick="selectCollection('${col.name}')">
          <span>${col.name}</span>
          <span class="collection-badge">${col.type}</span>
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

    // Records View

// Run on startup
window.addEventListener('DOMContentLoaded', init);
