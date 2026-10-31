// Application Navigation & Lifecycle

// URL Routing, Deep Linking & History API

function getAppQueryParam() {
  if (typeof window === 'undefined' || !window.location) return '';
  const searchParams = new URLSearchParams(window.location.search);
  const activeSlug = getActiveAppSlug();
  if (activeSlug && activeSlug !== 'default') {
    searchParams.set('app', activeSlug);
  } else {
    searchParams.delete('app');
  }
  const q = searchParams.toString();
  return q ? `?${q}` : '';
}

function updateUrl(targetPath, replace = false) {
  if (typeof window === 'undefined' || !window.history || !window.location) return;
  const targetUrl = targetPath + getAppQueryParam();
  const currentUrl = window.location.pathname + window.location.search;
  if (currentUrl === targetUrl) return;

  if (replace) {
    window.history.replaceState({ path: targetPath }, '', targetUrl);
  } else {
    window.history.pushState({ path: targetPath }, '', targetUrl);
  }
}

async function parseUrlAndNavigate(initial = false) {
  if (typeof window === 'undefined' || !window.location) return;

  // Resolve and synchronize active application from URL query parameter (?app=<slugOrId>)
  const searchParams = new URLSearchParams(window.location.search || '');
  const requestedAppSlug = searchParams.get('app');

  if (requestedAppSlug) {
    let targetApp = (state.apps || []).find(a => a.slug === requestedAppSlug || a.id === requestedAppSlug || (requestedAppSlug === 'default' && a.isDefault));
    if (!targetApp) {
      try {
        await fetchApps();
        targetApp = (state.apps || []).find(a => a.slug === requestedAppSlug || a.id === requestedAppSlug || (requestedAppSlug === 'default' && a.isDefault));
      } catch (_) {}
    }
    const currentSlug = getActiveAppSlug();
    if (targetApp && currentSlug !== targetApp.slug) {
      state.activeApp = targetApp;
      try {
        localStorage.setItem('nodestack_active_app', JSON.stringify(targetApp));
      } catch (_) {}
      updateAppSwitcherUI();
      updateDocsLinks(targetApp.slug);
      try {
        await loadCollections();
      } catch (_) {}
    }
  } else if (!initial && state.activeApp && state.activeApp.slug !== 'default') {
    // Navigating back/forward (popstate) to a route without ?app= query parameter; restore default app
    const defaultApp = (state.apps || []).find(a => a.isDefault || a.slug === 'default') || { id: 'app_default', slug: 'default', name: 'Default App', isDefault: true };
    if (state.activeApp.slug !== defaultApp.slug) {
      state.activeApp = defaultApp;
      try {
        localStorage.setItem('nodestack_active_app', JSON.stringify(defaultApp));
      } catch (_) {}
      updateAppSwitcherUI();
      updateDocsLinks(defaultApp.slug);
      try {
        await loadCollections();
      } catch (_) {}
    }
  }

  const pathname = window.location.pathname || '/';

  // Normalise route:
  // e.g. '/_/' -> ''
  // '/_/collections' -> 'collections'
  // '/_/collections/users/schema' -> 'collections/users/schema'
  let route = pathname;
  if (route.startsWith('/_')) {
    route = route.slice(2);
  }
  if (route.startsWith('/')) {
    route = route.slice(1);
  }
  if (route.endsWith('/')) {
    route = route.slice(0, -1);
  }

  const parts = route ? route.split('/').map(p => decodeURIComponent(p)) : [];

  if (parts.length === 0 || parts[0] === 'home') {
    await selectNav('home', false);
    return;
  }

  const root = parts[0];

  if (root === 'collections') {
    if (parts.length === 1) {
      await selectNav('collections', false);
    } else {
      const colName = parts[1];
      const tab = (parts[2] === 'schema') ? 'schema' : 'records';
      const allCols = Array.isArray(state.collections)
        ? state.collections
        : (state.collections && Array.isArray(state.collections.items) ? state.collections.items : []);
      const colExists = allCols.some(c => c.name === colName);
      if (colExists) {
        state.collectionTab = tab;
        await selectCollection(colName, false);
        if (tab === 'schema') {
          switchCollectionTab('schema', false);
        } else {
          switchCollectionTab('records', false);
        }
      } else {
        await selectNav('collections', false);
      }
    }
  } else if (root === 'functions') {
    await selectNav('functions', false);
    if (parts.length >= 2 && parts[1] && parts[1] !== 'logs') {
      if (typeof openFunctionEditor === 'function') {
        await openFunctionEditor(parts[1], false);
      }
    } else if (parts[1] === 'logs') {
      if (typeof switchFunctionsTab === 'function') switchFunctionsTab('logs', false);
    } else {
      if (typeof switchFunctionsTab === 'function') switchFunctionsTab('functions', false);
    }
  } else if (root === 'flows') {
    await selectNav('flows', false);
    if (parts.length >= 2 && parts[1]) {
      if (parts[1] === 'executions') {
        if (typeof switchFlowsTab === 'function') switchFlowsTab('executions', false);
      } else {
        if (typeof openFlowDesigner === 'function') await openFlowDesigner(parts[1], false, false);
      }
    } else {
      if (typeof closeFlowDesigner === 'function' && typeof flowsState !== 'undefined' && flowsState.currentView === 'designer') {
        closeFlowDesigner(false);
      } else if (typeof switchFlowsTab === 'function') {
        switchFlowsTab('flows', false);
      }
    }
  } else if (root === 'webhooks') {
    await selectNav('webhooks', false);
    if (parts[1] === 'deliveries') {
      if (typeof switchWebhooksTab === 'function') switchWebhooksTab('deliveries', false);
    } else {
      if (typeof switchWebhooksTab === 'function') switchWebhooksTab('webhooks', false);
    }
  } else if (root === 'plugins') {
    if (parts.length >= 2 && state.pluginNavItems && state.pluginNavItems.some(p => p.id === parts[1])) {
      await selectNav(parts[1], false);
    } else {
      await selectNav('plugins', false);
    }
  } else if (root === 'analytics') {
    await selectNav('analytics', false);
  } else if (root === 'snapshots') {
    await selectNav('snapshots', false);
  } else if (root === 'logs') {
    await selectNav('logs', false);
    if (parts[1] === 'audit') {
      if (typeof switchLogsSubTab === 'function') switchLogsSubTab('audit', false);
    } else {
      if (typeof switchLogsSubTab === 'function') switchLogsSubTab('traffic', false);
    }
  } else if (state.pluginNavItems && state.pluginNavItems.some(p => p.id === root)) {
    await selectNav(root, false);
  } else {
    await selectNav('home', false);
  }
}

let isRouterInitialized = false;

function initRouter() {
  if (typeof window === 'undefined' || isRouterInitialized) return;
  isRouterInitialized = true;

  window.addEventListener('popstate', async () => {
    // Gracefully dismiss open modals, drawers, or command palette on Back/Forward navigation
    if (typeof closeModal === 'function') closeModal();
    if (typeof closeRecordDrawer === 'function') closeRecordDrawer();
    if (typeof closeWebhookModal === 'function') closeWebhookModal();
    if (typeof closeWebhookDrawer === 'function') closeWebhookDrawer();
    if (typeof closeFunctionModal === 'function') closeFunctionModal();
    if (typeof closeFlowModal === 'function') closeFlowModal();
    if (typeof closeFlowExecutionDrawer === 'function') closeFlowExecutionDrawer();
    if (typeof closeCommandPalette === 'function') closeCommandPalette();

    await parseUrlAndNavigate(false);
  });
}


function showPageView(viewName) {
  const views = ['home', 'collections', 'plugins', 'webhooks', 'functions', 'flows', 'analytics', 'snapshots', 'logs'];
  for (const v of views) {
    const el = document.getElementById('page-view-' + v);
    if (el) {
      if (v === 'collections' || v === 'plugins' || v === 'flows') {
        el.style.display = (v === viewName) ? 'flex' : 'none';
      } else {
        el.style.display = (v === viewName) ? 'block' : 'none';
      }
    }
  }
}

function clearSidebarNavActive() {
  const navIds = ['nav-home', 'nav-collections', 'nav-plugins', 'nav-webhooks', 'nav-functions', 'nav-flows', 'nav-analytics', 'nav-snapshots', 'nav-logs'];
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

async function selectNav(nav, pushState = true) {
  state.activeNav = nav;

  if (typeof stopAnalyticsAutoRefresh === 'function') {
    stopAnalyticsAutoRefresh();
  }

  clearSidebarNavActive();

  const colActions = document.getElementById('collection-actions');
  if (colActions && nav !== 'collection') {
    colActions.innerHTML = '';
  }

  if (nav === 'home') {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('home');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('view-badge').style.display = 'none';
    document.getElementById('nav-home')?.classList.add('active');
    document.getElementById('view-title').textContent = 'Overview';
    document.getElementById('view-actions').innerHTML = '';
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
    document.getElementById('view-actions').innerHTML = '';
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
      <a href="/_/docs" target="_blank" onclick="openDocsWithApp(event)" class="btn btn-secondary btn-sm" style="text-decoration:none;">OpenAPI Specs ↗</a>
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
    document.getElementById('view-actions').innerHTML = '';
    if (typeof renderWebhooksView === 'function') renderWebhooksView();
  } else if (nav === 'functions') {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('functions');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('view-badge').style.display = 'none';
    document.getElementById('nav-functions')?.classList.add('active');
    document.getElementById('view-title').textContent = 'Functions';
    document.getElementById('view-title').style.display = 'none';
    document.getElementById('view-actions').innerHTML = '';
    if (typeof renderFunctionsView === 'function') renderFunctionsView();
  } else if (nav === 'flows') {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('flows');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('view-badge').style.display = 'none';
    document.getElementById('nav-flows')?.classList.add('active');
    document.getElementById('view-title').textContent = 'Functions Flow';
    document.getElementById('view-title').style.display = 'none';
    document.getElementById('view-actions').innerHTML = '';
    if (typeof renderFlowsView === 'function') renderFlowsView();
    if (typeof loadFlows === 'function') loadFlows().then(() => { if (typeof renderFlowsView === 'function') renderFlowsView(); });
  } else if (nav === 'analytics') {
    state.activeCollection = null;
    if (typeof renderCollectionsList === 'function') renderCollectionsList();
    showPageView('analytics');
    document.getElementById('collection-tabs').style.display = 'none';
    document.getElementById('view-badge').style.display = 'none';
    document.getElementById('nav-analytics')?.classList.add('active');
    document.getElementById('view-title').textContent = 'Analytics';
    document.getElementById('view-actions').innerHTML = '';
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
    document.getElementById('view-title').textContent = 'Snapshots';
    document.getElementById('view-actions').innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="openCreateSnapshotModal()" style="font-weight:600;">
        + Create Snapshot
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
    document.getElementById('view-title').textContent = 'Audit Logs';
    if (typeof renderLogsView === 'function') renderLogsView();
    if (typeof loadLogsSubTab === 'function') {
      loadLogsSubTab();
    } else if (typeof loadLogs === 'function') {
      loadLogs();
    }

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

  if (pushState) {
    if (nav === 'home') {
      updateUrl('/_/');
    } else if (nav === 'collections') {
      updateUrl('/_/collections');
    } else if (nav === 'webhooks') {
      const sub = (typeof webhooksState !== 'undefined' && webhooksState.subTab === 'deliveries') ? '/deliveries' : '';
      updateUrl('/_/webhooks' + sub);
    } else if (nav === 'functions') {
      const sub = (typeof functionsState !== 'undefined' && functionsState.currentView === 'editor' && functionsState.activeFunctionForEdit)
        ? '/' + (functionsState.activeFunctionForEdit.isNew ? 'new' : encodeURIComponent(functionsState.activeFunctionForEdit.name || functionsState.activeFunctionForEdit.id))
        : (typeof functionsState !== 'undefined' && functionsState.subTab === 'logs') ? '/logs' : '';
      updateUrl('/_/functions' + sub);
    } else if (nav === 'flows') {
      const activeFlow = (typeof flowsState !== 'undefined' && flowsState.activeFlowForEdit) || (typeof designerState !== 'undefined' && designerState.activeFlow);
      const sub = (typeof flowsState !== 'undefined' && flowsState.currentView === 'designer' && activeFlow)
        ? '/' + encodeURIComponent(activeFlow.name || activeFlow.id)
        : (typeof flowsState !== 'undefined' && flowsState.subTab === 'executions') ? '/executions' : '';
      updateUrl('/_/flows' + sub);
    } else if (nav === 'analytics') {
      updateUrl('/_/analytics');
    } else if (nav === 'snapshots') {
      updateUrl('/_/snapshots');
    } else if (nav === 'logs') {
      const sub = (typeof auditState !== 'undefined' && auditState.subTab === 'audit') ? '/audit' : '';
      updateUrl('/_/logs' + sub);
    } else if (nav === 'plugins') {
      updateUrl('/_/plugins');
    } else if (state.pluginNavItems && state.pluginNavItems.some(p => p.id === nav || (nav === 'resend' && p.id === 'resend-email'))) {
      updateUrl('/_/plugins/' + encodeURIComponent(nav));
    }
  }
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
      if (typeof closeFlowExecutionDrawer === 'function') {
        closeFlowExecutionDrawer();
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
      if (typeof closeFlowModal === 'function') {
        closeFlowModal();
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
  window.getAppQueryParam = getAppQueryParam;
  window.updateUrl = updateUrl;
  window.parseUrlAndNavigate = parseUrlAndNavigate;
  window.initRouter = initRouter;

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

if (typeof window !== 'undefined') {
  initRouter();
}

// Run on startup
window.addEventListener('DOMContentLoaded', init);
