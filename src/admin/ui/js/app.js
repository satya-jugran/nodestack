// Application Navigation & Lifecycle

function showPageView(viewName) {
  const views = ['home', 'collections', 'plugins', 'webhooks', 'analytics', 'snapshots', 'logs', 'settings'];
  for (const v of views) {
    const el = document.getElementById('page-view-' + v);
    if (el) {
      if (v === 'collections' || v === 'plugins') {
        el.style.display = (v === viewName) ? 'flex' : 'none';
      } else {
        el.style.display = (v === viewName) ? 'block' : 'none';
      }
    }
  }
}

function clearSidebarNavActive() {
  const navIds = ['nav-home', 'nav-collections', 'nav-plugins', 'nav-webhooks', 'nav-analytics', 'nav-snapshots', 'nav-logs', 'nav-settings'];
  for (const id of navIds) {
    document.getElementById(id)?.classList.remove('active');
  }
  if (state.pluginNavItems && Array.isArray(state.pluginNavItems)) {
    for (const item of state.pluginNavItems) {
      document.getElementById('nav-' + item.id)?.classList.remove('active');
    }
  }
  document.querySelectorAll('.sidebar-nav-item.active').forEach(el => el.classList.remove('active'));
}

async function selectNav(nav) {
  state.activeNav = nav;

  if (typeof stopAnalyticsAutoRefresh === 'function') {
    stopAnalyticsAutoRefresh();
  }

  clearSidebarNavActive();

  if (nav === 'home') {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('home');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('view-badge').style.display = 'none';
    document.getElementById('nav-home')?.classList.add('active');
    document.getElementById('view-title').textContent = 'Dashboard Overview';
    document.getElementById('view-actions').innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="selectNav('collections')">📦 Collections</button>
      <button class="btn btn-secondary btn-sm" onclick="selectNav('plugins')">🧩 Plugins</button>
      <button class="btn btn-secondary btn-sm" onclick="selectNav('analytics')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Metrics
      </button>
      <button class="btn btn-secondary btn-sm" onclick="window.open('/_/docs', '_blank')">API Docs (OpenAPI)</button>
      <button class="btn btn-primary btn-sm" onclick="openNewCollectionModal()">+ New Collection</button>
    `;
    if (typeof renderHomeView === 'function') renderHomeView();
  } else if (nav === 'collections') {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('collections');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('nav-collections')?.classList.add('active');
    document.getElementById('view-title').textContent = 'Collections';
    document.getElementById('view-title').style.display = 'inline-block';
    const count = state.collections ? state.collections.length : 0;
    const badgeEl = document.getElementById('view-badge');
    badgeEl.textContent = count + ' Tables';
    badgeEl.className = 'badge badge-get';
    badgeEl.style.display = 'inline-block';
    document.getElementById('view-actions').innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="openNewCollectionModal()">+ New Collection</button>
      <button class="btn btn-secondary btn-sm" onclick="openTemplatesModal()">✨ Recipes</button>
      <button class="btn btn-secondary btn-sm" onclick="openImportModal()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Import JSON</button>
    `;
    if (typeof renderCollectionsHubView === 'function') renderCollectionsHubView();
  } else if (nav === 'plugins') {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('plugins');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('nav-plugins')?.classList.add('active');
    document.getElementById('view-title').textContent = 'Plugins';
    document.getElementById('view-title').style.display = 'inline-block';
    const pCount = (state.pluginNavItems || []).length;
    const badgeEl = document.getElementById('view-badge');
    badgeEl.textContent = pCount + ' Active';
    badgeEl.className = 'badge badge-primary';
    badgeEl.style.display = pCount > 0 ? 'inline-block' : 'none';
    document.getElementById('view-actions').innerHTML = `
      <a href="/_/docs" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration:none;">OpenAPI Specs ↗</a>
    `;
    if (typeof renderPluginNavItems === 'function') renderPluginNavItems();
    if (typeof renderPluginsHubView === 'function') renderPluginsHubView();
  } else if (nav === 'webhooks') {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('webhooks');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('view-badge').style.display = 'none';
    document.getElementById('nav-webhooks')?.classList.add('active');
    document.getElementById('view-title').textContent = 'Webhooks Manager';
    document.getElementById('view-title').style.display = 'none';
    document.getElementById('view-actions').innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="refreshWebhooksView()">Refresh</button>
      <button class="btn btn-primary btn-sm" onclick="openCreateWebhookModal()">+ New Webhook</button>
    `;
    if (typeof renderWebhooksView === 'function') renderWebhooksView();
  } else if (nav === 'analytics') {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('analytics');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('view-badge').style.display = 'none';
    document.getElementById('nav-analytics')?.classList.add('active');
    document.getElementById('view-title').textContent = 'Analytics & Metrics';
    document.getElementById('view-actions').innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="loadAnalytics()">Refresh</button>
      <button class="btn btn-primary btn-sm" onclick="selectNav('home')">Overview</button>
    `;
    if (typeof renderAnalyticsView === 'function') renderAnalyticsView();
    if (typeof loadAnalytics === 'function') loadAnalytics();
    if (typeof analyticsState !== 'undefined' && analyticsState.autoRefreshEnabled && typeof startAnalyticsAutoRefresh === 'function') {
      startAnalyticsAutoRefresh();
    }
  } else if (nav === 'snapshots') {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('snapshots');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('view-badge').style.display = 'none';
    document.getElementById('nav-snapshots')?.classList.add('active');
    document.getElementById('view-title').textContent = 'Demo Snapshots';
    document.getElementById('view-actions').innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="openSnapshotDemoModal()">
        📸 Snapshot Demo State
      </button>
      <button class="btn btn-warning btn-sm" onclick="openResetDemoModal()" style="font-weight:700;">
        ↺ Reset Demo Data
      </button>
    `;
    if (typeof renderSnapshotsView === 'function') renderSnapshotsView();
  } else if (nav === 'logs') {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('logs');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('view-badge').style.display = 'none';
    document.getElementById('nav-logs')?.classList.add('active');
    document.getElementById('view-title').textContent = 'Traffic & Logs';
    if (typeof renderLogsView === 'function') renderLogsView();
    if (typeof loadLogsSubTab === 'function') {
      loadLogsSubTab();
    } else if (typeof loadLogs === 'function') {
      loadLogs();
    }
  } else if (nav === 'settings') {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('settings');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('view-badge').style.display = 'none';
    document.getElementById('nav-settings')?.classList.add('active');
    document.getElementById('view-title').textContent = 'System Info';
    document.getElementById('view-actions').innerHTML = '';
    if (typeof renderSettingsView === 'function') renderSettingsView();
  } else if (state.pluginNavItems && state.pluginNavItems.some(p => p.id === nav || (nav === 'resend' && p.id === 'resend-email'))) {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('plugins');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('nav-plugins')?.classList.add('active');
    document.getElementById('nav-' + nav)?.classList.add('active');
    const pluginItem = state.pluginNavItems.find(p => p.id === nav || (nav === 'resend' && p.id === 'resend-email'));
    if (typeof renderPluginView === 'function') renderPluginView(pluginItem);
  }

  if (typeof updateBreadcrumbs === 'function') updateBreadcrumbs();
}

// Close dropdown menu when clicking outside
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
    if (typeof toggleCommandPalette === 'function') {
      toggleCommandPalette();
    }
  } else if (e.key === 'Escape') {
    if (typeof closeCollectionCreateMenu === 'function') {
      closeCollectionCreateMenu();
    }
    const root = document.getElementById('command-palette-root');
    if (root && root.innerHTML.trim().length > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (typeof closeCommandPalette === 'function') {
        closeCommandPalette();
      }
      return;
    }
    const drawerRoot = document.getElementById('drawer-root');
    if (drawerRoot && drawerRoot.innerHTML.trim().length > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (typeof closePluginTesterDrawer === 'function') {
        closePluginTesterDrawer();
      }
      if (typeof closeRecordDrawer === 'function') {
        closeRecordDrawer();
      }
      if (typeof closeWebhookDrawer === 'function') {
        closeWebhookDrawer();
      }
      return;
    }
    const modalRoot = document.getElementById('modal-root');
    if (modalRoot && modalRoot.innerHTML.trim().length > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (typeof closeWebhookModal === 'function') {
        closeWebhookModal();
      }
      if (typeof closeModal === 'function') {
        closeModal();
      }
      return;
    }
  }
});

// Expose core navigation & lifecycle helpers on window
if (typeof window !== 'undefined') {
  window.showPageView = showPageView;
  window.clearSidebarNavActive = clearSidebarNavActive;
  window.selectNav = selectNav;

  // Mirror modular exports to window if present
  if (typeof selectCollection !== 'undefined') window.selectCollection = selectCollection;
  if (typeof switchCollectionTab !== 'undefined') window.switchCollectionTab = switchCollectionTab;
  if (typeof renderCollectionsList !== 'undefined') window.renderCollectionsList = renderCollectionsList;
  if (typeof toggleCollectionSection !== 'undefined') window.toggleCollectionSection = toggleCollectionSection;
  if (typeof handleCollectionFilterInput !== 'undefined') window.handleCollectionFilterInput = handleCollectionFilterInput;
  if (typeof clearCollectionFilter !== 'undefined') window.clearCollectionFilter = clearCollectionFilter;
  if (typeof updateBreadcrumbs !== 'undefined') window.updateBreadcrumbs = updateBreadcrumbs;
  if (typeof handleBreadcrumbClick !== 'undefined') window.handleBreadcrumbClick = handleBreadcrumbClick;
  if (typeof openCommandPalette !== 'undefined') window.openCommandPalette = openCommandPalette;
  if (typeof closeCommandPalette !== 'undefined') window.closeCommandPalette = closeCommandPalette;
  if (typeof toggleCommandPalette !== 'undefined') window.toggleCommandPalette = toggleCommandPalette;
  if (typeof getAllCommandPaletteItems !== 'undefined') window.getAllCommandPaletteItems = getAllCommandPaletteItems;
  if (typeof filterCommandPaletteItems !== 'undefined') window.filterCommandPaletteItems = filterCommandPaletteItems;
  if (typeof executeCommandPaletteItem !== 'undefined') window.executeCommandPaletteItem = executeCommandPaletteItem;
  if (typeof handleCommandPaletteInput !== 'undefined') window.handleCommandPaletteInput = handleCommandPaletteInput;
  if (typeof handleCommandPaletteKeyDown !== 'undefined') window.handleCommandPaletteKeyDown = handleCommandPaletteKeyDown;
  if (typeof setCommandPaletteActiveIndex !== 'undefined') window.setCommandPaletteActiveIndex = setCommandPaletteActiveIndex;
  if (typeof renderPluginNavItems !== 'undefined') window.renderPluginNavItems = renderPluginNavItems;
  if (typeof renderPluginView !== 'undefined') window.renderPluginView = renderPluginView;
  if (typeof openPluginTesterDrawer !== 'undefined') window.openPluginTesterDrawer = openPluginTesterDrawer;
  if (typeof closePluginTesterDrawer !== 'undefined') window.closePluginTesterDrawer = closePluginTesterDrawer;
  if (typeof executePluginTest !== 'undefined') window.executePluginTest = executePluginTest;
  if (typeof checkPluginTesterStatus !== 'undefined') window.checkPluginTesterStatus = checkPluginTesterStatus;
  if (typeof runStripeCheckoutTest !== 'undefined') window.runStripeCheckoutTest = runStripeCheckoutTest;
  if (typeof runStripeWebhookSimulation !== 'undefined') window.runStripeWebhookSimulation = runStripeWebhookSimulation;
  if (typeof runS3PresignedUrlTest !== 'undefined') window.runS3PresignedUrlTest = runS3PresignedUrlTest;
  if (typeof runS3StatusTest !== 'undefined') window.runS3StatusTest = runS3StatusTest;
  if (typeof runResendSendTest !== 'undefined') window.runResendSendTest = runResendSendTest;
  if (typeof runWebhookDispatchTest !== 'undefined') window.runWebhookDispatchTest = runWebhookDispatchTest;
  if (typeof runAlgoliaReindexTest !== 'undefined') window.runAlgoliaReindexTest = runAlgoliaReindexTest;
  if (typeof runAlgoliaProcessQueueTest !== 'undefined') window.runAlgoliaProcessQueueTest = runAlgoliaProcessQueueTest;
}

// Run on startup
window.addEventListener('DOMContentLoaded', init);
