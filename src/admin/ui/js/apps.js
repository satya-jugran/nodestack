// Multi-Application / MVP Management & App Switcher

async function fetchApps() {
  if (!state.token) {
    updateAppSwitcherUI();
    return;
  }
  try {
    const res = await api('/api/apps');
    state.apps = (res && res.items) ? res.items : [];
    
    // Validate or default activeApp
    if (!state.activeApp || !state.apps.some(a => a.slug === state.activeApp.slug || a.id === state.activeApp.id)) {
      const defaultApp = state.apps.find(a => a.isDefault) || state.apps[0] || { id: 'app_default', slug: 'default', name: 'Default App', isDefault: true };
      state.activeApp = defaultApp;
      try {
        localStorage.setItem('nodestack_active_app', JSON.stringify(defaultApp));
      } catch {}
    } else {
      // Sync latest properties (name, stats)
      const fresh = state.apps.find(a => a.slug === state.activeApp.slug || a.id === state.activeApp.id);
      if (fresh) {
        state.activeApp = fresh;
      }
    }

    updateAppSwitcherUI();
  } catch (err) {
    console.warn('[NodeStack] fetchApps error:', err);
    // If apps endpoint fails or active app was not found, fallback to default
    if (!state.activeApp || (err && (err.status === 404 || err.message?.includes('Application ')))) {
      state.activeApp = { id: 'app_default', slug: 'default', name: 'Default App', isDefault: true };
      try {
        localStorage.setItem('nodestack_active_app', JSON.stringify(state.activeApp));
      } catch {}
    }
    updateAppSwitcherUI();
  }
}

function updateAppSwitcherUI() {
  const labelEl = document.getElementById('app-switcher-label');
  const iconEl = document.getElementById('app-switcher-icon');
  const itemsContainer = document.getElementById('app-switcher-items');

  if (labelEl && state.activeApp) {
    labelEl.textContent = state.activeApp.name || 'Default App';
  }
  if (iconEl && state.activeApp) {
    iconEl.textContent = state.activeApp.isDefault ? '⚡' : '🚀';
  }

  updateDocsLinks();

  if (!itemsContainer) return;

  const apps = Array.isArray(state.apps) && state.apps.length > 0
    ? state.apps
    : (state.activeApp ? [state.activeApp] : [{ id: 'app_default', slug: 'default', name: 'Default App', isDefault: true }]);

  itemsContainer.innerHTML = apps.map(app => {
    const isActive = state.activeApp && (state.activeApp.slug === app.slug || state.activeApp.id === app.id);
    const countInfo = app.stats ? `${app.stats.collectionsCount} cols` : '';
    const isDefault = Boolean(app.isDefault || app.slug === 'default');

    return `
      <div 
        class="app-switcher-item ${isActive ? 'active' : ''}" 
        onclick="selectApp('${escapeHtml(app.slug)}')"
      >
        <div class="app-switcher-item-left">
          <span>${isDefault ? '⚡' : '🚀'}</span>
          <span class="app-switcher-item-name">${escapeHtml(app.name)}</span>
          ${isDefault ? '<span class="badge app-switcher-default-badge">default</span>' : ''}
        </div>
        <div class="app-switcher-item-right">
          ${countInfo ? `<span class="app-switcher-item-count">${countInfo}</span>` : ''}
          ${isActive ? '<span class="app-switcher-check">✓</span>' : ''}
          ${!isDefault ? `
            <button 
              type="button" 
              class="btn-delete-app" 
              title="Delete application '${escapeHtml(app.name)}'" 
              onclick="event.stopPropagation(); promptDeleteApp('${escapeHtml(app.slug)}', '${escapeHtml(app.name)}')"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function toggleAppSwitcher(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('app-switcher-menu');
  if (!menu) return;

  const isVisible = menu.style.display === 'block';
  menu.style.display = isVisible ? 'none' : 'block';

  if (!isVisible) {
    if (typeof updateAppSwitcherUI === 'function') {
      updateAppSwitcherUI();
    }
    if (typeof fetchApps === 'function') {
      fetchApps().catch(() => {});
    }
    const closeListener = (evt) => {
      if (!menu.contains(evt.target)) {
        menu.style.display = 'none';
        document.removeEventListener('click', closeListener);
      }
    };
    setTimeout(() => document.addEventListener('click', closeListener), 0);
  }
}

function closeAppSwitcher() {
  const menu = document.getElementById('app-switcher-menu');
  if (menu) menu.style.display = 'none';
}

async function selectApp(slugOrId) {
  const app = (state.apps || []).find(a => a.slug === slugOrId || a.id === slugOrId);
  if (!app) return;

  state.activeApp = app;
  localStorage.setItem('nodestack_active_app', JSON.stringify(app));
  updateAppSwitcherUI();
  closeAppSwitcher();

  if (typeof toast === 'function') {
    toast(`Active App: ${app.name}`, 'info');
  }

  // Refresh active context
  state.collections = [];
  state.activeCollection = null;
  if (typeof webhooksState !== 'undefined') {
    webhooksState.webhooks = [];
    webhooksState.deliveries = [];
  }

  try {
    if (typeof loadCollections === 'function') {
      await loadCollections();
    }
    if (typeof fetchDemoStatus === 'function') {
      await fetchDemoStatus();
    }
    if (typeof loadWebhookStats === 'function') {
      await loadWebhookStats();
    }
    if (typeof loadWebhooksList === 'function' && state.activeNav === 'webhooks') {
      await loadWebhooksList();
    }
    if (typeof loadFunctionStats === 'function') {
      await loadFunctionStats();
    }
    if (typeof loadFunctionsList === 'function' && state.activeNav === 'functions') {
      await loadFunctionsList();
    }

    // Refresh plugin catalog and nav items for the switched app
    try {
      if (typeof api === 'function') {
        const pluginData = await api('/api/plugins');
        if (pluginData) {
          state.pluginNavItems = pluginData.navItems || [];
          state.pluginCatalog = pluginData.catalog || [];
          if (typeof renderPluginNavItems === 'function') renderPluginNavItems();
        }
      }
    } catch {}

    if (state.activeNav === 'home' && typeof renderHomeView === 'function') {
      renderHomeView();
    } else if (state.activeNav === 'snapshots' && typeof renderSnapshotsView === 'function') {
      renderSnapshotsView();
    } else if (state.activeNav === 'webhooks' && typeof renderWebhooksView === 'function') {
      renderWebhooksView();
    } else if (state.activeNav === 'functions' && typeof renderFunctionsView === 'function') {
      renderFunctionsView();
    } else if (state.activeNav === 'collection' && typeof renderCollectionsHubView === 'function') {
      renderCollectionsHubView();
    } else if (state.activeNav === 'analytics' && typeof renderAnalyticsView === 'function') {
      renderAnalyticsView();
      if (typeof loadAnalytics === 'function') loadAnalytics();
    } else if (state.activeNav === 'plugins' && typeof renderPluginsHubView === 'function') {
      renderPluginsHubView();
    } else if (state.pluginNavItems && state.pluginNavItems.some(i => i.id === state.activeNav)) {
      const pluginItem = state.pluginNavItems.find(i => i.id === state.activeNav);
      if (pluginItem && typeof renderPluginView === 'function') {
        renderPluginView(pluginItem);
      }
    }
    updateDocsLinks(app.slug);
  } catch (err) {
    if (typeof toast === 'function') {
      toast(`Failed to switch application: ${err.message}`, 'error');
    }
  }
}

function getActiveAppSlug() {
  if (typeof state === 'undefined' || !state.activeApp) return 'default';
  if (typeof state.activeApp === 'string') return state.activeApp;
  return state.activeApp.slug || state.activeApp.id || 'default';
}
window.getActiveAppSlug = getActiveAppSlug;

function updateDocsLinks(appSlug) {
  const slug = (typeof appSlug === 'string' && appSlug)
    ? appSlug
    : getActiveAppSlug();
  const docsUrl = slug && slug !== 'default' ? `/_/docs?app=${encodeURIComponent(slug)}` : '/_/docs';
  const navDocs = document.getElementById('nav-docs');
  if (navDocs) navDocs.href = docsUrl;
  const pluginDocs = document.getElementById('plugin-docs-link');
  if (pluginDocs) pluginDocs.href = docsUrl;
}
window.updateDocsLinks = updateDocsLinks;

function openDocsWithApp(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const slug = getActiveAppSlug();
  const url = slug && slug !== 'default' ? `/_/docs?app=${encodeURIComponent(slug)}` : '/_/docs';
  window.open(url, '_blank');
}
window.openDocsWithApp = openDocsWithApp;

function openCreateAppModal() {
  closeAppSwitcher();
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeCreateAppModal()">
      <div class="modal" style="max-width: 520px;">
        <div class="modal-header">
          <h2 class="modal-title">Create New App</h2>
          <button type="button" class="btn btn-secondary btn-sm" onclick="closeCreateAppModal()">✕</button>
        </div>
        <form onsubmit="handleCreateAppSubmit(event)" style="display: flex; flex-direction: column; flex: 1; min-height: 0; margin: 0;">
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label" for="new-app-name">Application Name *</label>
              <input 
                type="text" 
                id="new-app-name" 
                class="form-input" 
                placeholder="e.g. SaaS CRM Launchpad" 
                required 
                oninput="handleAppNameInput(this.value)"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="new-app-slug">Application Slug (URL identifier) *</label>
              <input 
                type="text" 
                id="new-app-slug" 
                class="form-input" 
                placeholder="e.g. saas-crm" 
                required 
                oninput="this.dataset.manuallyEdited='true'"
                style="font-family: var(--font-mono, monospace);"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="new-app-desc">Description (Optional)</label>
              <textarea 
                id="new-app-desc" 
                class="form-textarea" 
                rows="2" 
                placeholder="Brief description of this app..." 
                style="min-height: 64px; font-family: inherit;"
              ></textarea>
            </div>

            <div class="form-group">
              <label class="form-label" for="new-app-template">Starter Template (Optional)</label>
              <select 
                id="new-app-template" 
                class="form-select"
              >
                <option value="">Blank / Clean (Standard users collection only)</option>
                <option value="ecommerce">E-Commerce (products, categories, orders, reviews)</option>
                <option value="crm">CRM (contacts, deals, companies, activities)</option>
                <option value="blog">Blog / Editorial (articles, authors, tags, comments)</option>
              </select>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="closeCreateAppModal()">Cancel</button>
            <button type="submit" class="btn btn-primary" id="btn-submit-create-app">Create App</button>
          </div>
        </form>
      </div>
    </div>
  `;

  setTimeout(() => {
    document.getElementById('new-app-name')?.focus();
  }, 50);
}

function handleAppNameInput(val) {
  const slugInput = document.getElementById('new-app-slug');
  if (slugInput && !slugInput.dataset.manuallyEdited) {
    slugInput.value = val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
}

function closeCreateAppModal() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) modalRoot.innerHTML = '';
}

async function handleCreateAppSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('new-app-name')?.value?.trim();
  const slug = document.getElementById('new-app-slug')?.value?.trim();
  const description = document.getElementById('new-app-desc')?.value?.trim();
  const template = document.getElementById('new-app-template')?.value?.trim();
  const submitBtn = document.getElementById('btn-submit-create-app');

  if (!name || !slug) return;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
  }

  try {
    const created = await api('/api/apps', {
      method: 'POST',
      body: JSON.stringify({ name, slug, description, template }),
    });

    closeCreateAppModal();
    if (typeof toast === 'function') {
      toast(`Application '${created.name}' created!`, 'success');
    }

    await fetchApps();
    await selectApp(created.slug || created.id);
  } catch (err) {
    if (typeof toast === 'function') {
      toast('Failed to create application: ' + err.message, 'error');
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create App';
    }
  }
}

function promptDeleteApp(slug, name) {
  closeAppSwitcher();
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeDeleteAppModal()">
      <div class="modal" style="max-width: 440px;">
        <div class="modal-header" style="border-bottom-color: rgba(239, 68, 68, 0.2);">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 18px;">⚠️</span>
            <h2 class="modal-title" style="color: #ef4444; font-size: 16px;">Delete Application</h2>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="closeDeleteAppModal()">✕</button>
        </div>
        <div class="modal-body" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
          <p style="font-size: 13px; color: #cbd5e1; line-height: 1.5; margin: 0;">
            Are you sure you want to permanently delete application <strong style="color: var(--text-heading); font-family: var(--font-mono);">${escapeHtml(name)}</strong> (<code style="font-size: 12px; color: var(--accent-primary, #6366f1);">${escapeHtml(slug)}</code>)?
          </p>
          <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 6px; padding: 0.75rem; font-size: 12px; color: #fca5a5; line-height: 1.4;">
            This will permanently delete its SQLite database, files in storage, and schema collections. This action cannot be undone.
          </div>
        </div>
        <div class="modal-footer" style="padding: 0.75rem 1.25rem;">
          <button type="button" class="btn btn-secondary" onclick="closeDeleteAppModal()">Cancel</button>
          <button type="button" class="btn btn-danger" id="btn-confirm-delete-app" onclick="submitDeleteApp('${escapeHtml(slug)}', '${escapeHtml(name)}')">
            Delete Application
          </button>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    document.getElementById('btn-confirm-delete-app')?.focus();
  }, 50);
}

function closeDeleteAppModal() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) modalRoot.innerHTML = '';
}

async function submitDeleteApp(slug, name) {
  const btn = document.getElementById('btn-confirm-delete-app');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <div style="width:12px; height:12px; border:2px solid #ffffff; border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite; display:inline-block; margin-right:4px;"></div>
      <span>Deleting...</span>
    `;
  }

  try {
    await api('/api/apps/' + encodeURIComponent(slug), {
      method: 'DELETE',
    });

    closeDeleteAppModal();
    if (typeof toast === 'function') {
      toast(`Application '${name}' deleted successfully`, 'success');
    }

    const isActiveDeleted = state.activeApp && (state.activeApp.slug === slug || state.activeApp.id === slug);

    await fetchApps();

    if (isActiveDeleted) {
      const defaultApp = (state.apps && state.apps.find(a => a.isDefault || a.slug === 'default')) || { id: 'app_default', slug: 'default', name: 'Default App', isDefault: true };
      state.activeApp = defaultApp;
      try {
        localStorage.setItem('nodestack_active_app', JSON.stringify(defaultApp));
      } catch {}
      await selectApp(defaultApp.slug || defaultApp.id);
    }
  } catch (err) {
    if (typeof toast === 'function') {
      toast(`Failed to delete application: ${err.message || String(err)}`, 'error');
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Delete Application';
    }
  }
}

window.promptDeleteApp = promptDeleteApp;
window.closeDeleteAppModal = closeDeleteAppModal;
window.submitDeleteApp = submitDeleteApp;

