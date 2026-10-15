// Application Navigation & Lifecycle

    function showPageView(viewName) {
      const views = ['home', 'collections', 'plugins', 'analytics', 'snapshots', 'logs', 'settings'];
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
      const navIds = ['nav-home', 'nav-collections', 'nav-plugins', 'nav-analytics', 'nav-snapshots', 'nav-logs', 'nav-settings'];
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
        renderCollectionsList();
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
        renderHomeView();
      } else if (nav === 'collections') {
        state.activeCollection = null;
        renderCollectionsList();
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
          <button class="btn btn-secondary btn-sm" onclick="openImportModal()">⚡ Import JSON</button>
        `;
        renderCollectionsHubView();
      } else if (nav === 'plugins') {
        state.activeCollection = null;
        renderCollectionsList();
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
          <a href="/demo/" target="_blank" class="btn btn-primary btn-sm" style="text-decoration:none;">Demo App Portal ↗</a>
          <a href="/_/docs" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration:none;">OpenAPI Specs ↗</a>
        `;
        renderPluginNavItems();
        renderPluginsHubView();
      } else if (nav === 'analytics') {
        state.activeCollection = null;
        renderCollectionsList();
        showPageView('analytics');
        document.getElementById('collection-tabs').style.display = 'none';
        document.getElementById('view-badge').style.display = 'none';
        document.getElementById('nav-analytics')?.classList.add('active');
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
        state.activeCollection = null;
        renderCollectionsList();
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
        renderSnapshotsView();
      } else if (nav === 'logs') {
        state.activeCollection = null;
        renderCollectionsList();
        showPageView('logs');
        document.getElementById('collection-tabs').style.display = 'none';
        document.getElementById('view-badge').style.display = 'none';
        document.getElementById('nav-logs')?.classList.add('active');
        document.getElementById('view-title').textContent = 'Traffic & Logs';
        document.getElementById('view-actions').innerHTML = `
          <button class="btn btn-secondary btn-sm" onclick="loadLogs()">Refresh</button>
          <button class="btn btn-danger btn-sm" onclick="clearLogs()">Clear Logs</button>
        `;
        renderLogsView();
        loadLogs();
      } else if (nav === 'settings') {
        state.activeCollection = null;
        renderCollectionsList();
        showPageView('settings');
        document.getElementById('collection-tabs').style.display = 'none';
        document.getElementById('view-badge').style.display = 'none';
        document.getElementById('nav-settings')?.classList.add('active');
        document.getElementById('view-title').textContent = 'System & Settings';
        document.getElementById('view-actions').innerHTML = '';
        renderSettingsView();
      } else if (state.pluginNavItems && state.pluginNavItems.some(p => p.id === nav)) {
        state.activeCollection = null;
        renderCollectionsList();
        showPageView('plugins');
        document.getElementById('collection-tabs').style.display = 'none';
        document.getElementById('nav-plugins')?.classList.add('active');
        document.getElementById('nav-' + nav)?.classList.add('active');
        const pluginItem = state.pluginNavItems.find(p => p.id === nav);
        renderPluginView(pluginItem);
      }

      updateBreadcrumbs();
    }

    function renderPluginNavItems() {
      const group = document.getElementById('sidebar-plugins-group');
      const container = document.getElementById('sidebar-plugin-items');
      const badgeEl = document.getElementById('sidebar-plugins-badge');
      const railCount = document.getElementById('plugins-rail-count');

      const items = state.pluginNavItems || [];
      if (badgeEl) {
        badgeEl.textContent = items.length > 0 ? String(items.length) : '0';
        badgeEl.style.display = items.length > 0 ? 'inline-block' : 'none';
      }
      if (railCount) {
        railCount.textContent = String(items.length);
      }

      if (!group || !container) return;

      if (items.length === 0) {
        group.style.display = 'none';
        container.innerHTML = '<div style="font-size:11px; color:var(--text-muted); padding:0.5rem;">No plugins registered</div>';
        return;
      }

      group.style.display = 'flex';
      container.innerHTML = items.map(item => {
        const isActive = state.activeNav === item.id;
        const iconHtml = item.icon || `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
        const badgeClass = item.badgeVariant ? 'badge-' + item.badgeVariant : 'badge-get';
        const badgeHtml = item.badge ? `<span class="badge ${badgeClass}" style="margin-left:auto; font-size:10px; padding:1px 5px;">${escapeHtml(item.badge)}</span>` : '';

        if (item.path && (item.target === '_blank' || item.path.startsWith('http'))) {
          return `
            <a href="${escapeHtml(item.path)}" target="${item.target || '_blank'}" class="sidebar-nav-item" id="nav-${escapeHtml(item.id)}" style="text-decoration:none; color:inherit;">
              ${iconHtml}
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${escapeHtml(item.title)}</span>
              ${badgeHtml || '<span style="margin-left:auto; font-size:11px; opacity:0.6;">↗</span>'}
            </a>
          `;
        }

        return `
          <div class="sidebar-nav-item ${isActive ? 'active' : ''}" id="nav-${escapeHtml(item.id)}" onclick="selectNav('${escapeHtml(item.id)}')">
            ${iconHtml}
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${escapeHtml(item.title)}</span>
            ${badgeHtml}
          </div>
        `;
      }).join('');

      if (state.activeNav === 'plugins') {
        renderPluginsHubView();
      }
    }

    function renderPluginView(item) {
      showPageView('plugins');
      clearSidebarNavActive();
      document.getElementById('nav-plugins')?.classList.add('active');
      document.getElementById('nav-' + item.id)?.classList.add('active');

      document.getElementById('view-title').textContent = item.title;
      document.getElementById('view-title').style.display = 'inline-block';
      const badgeEl = document.getElementById('view-badge');
      if (item.badge) {
        badgeEl.textContent = item.badge;
        badgeEl.className = 'badge ' + (item.badgeVariant ? 'badge-' + item.badgeVariant : 'badge-get');
        badgeEl.style.display = 'inline-block';
      } else {
        badgeEl.style.display = 'none';
      }

      document.getElementById('view-actions').innerHTML = `
        <button class="btn btn-secondary btn-sm" onclick="selectNav('plugins')">← All Plugins</button>
        <a href="/demo/" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration:none;">Demo Portal ↗</a>
      `;

      const target = document.getElementById('plugins-detail-pane') || document.getElementById('main-body');
      if (!target) return;

      let baseHtml = '';
      if (typeof item.view === 'string') {
        baseHtml = item.view;
      } else if (item.view && typeof item.view === 'object' && item.view.html) {
        baseHtml = item.view.html;
      } else {
        const title = (item.view && typeof item.view === 'object' && item.view.title) ? item.view.title : item.title;
        const desc = (item.view && typeof item.view === 'object' && item.view.description) ? item.view.description : 'Configured via NodeStack formal plugin architecture.';

        baseHtml = `
          <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <div style="width: 40px; height: 40px; border-radius: 10px; background: #0c0e14; border: 1px solid rgba(59, 130, 246, 0.4); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                  <span style="font-size: 20px;">🧩</span>
                </div>
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-weight: 800; font-size: 16px; color: #fff;">${escapeHtml(title)}</span>
                    ${item.badge ? `<span class="badge ${item.badgeVariant ? 'badge-' + item.badgeVariant : 'badge-get'}">${escapeHtml(item.badge)}</span>` : ''}
                  </div>
                  <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                    ${escapeHtml(desc)}
                  </div>
                </div>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="selectNav('plugins')">Back to Plugins</button>
            </div>
            
            <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1rem;">
              <div style="font-size: 11.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em;">Plugin Status & Integration</div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;">
                <div style="background: rgba(0,0,0,0.2); padding: 0.65rem 0.85rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04);">
                  <div style="font-size: 11px; color: var(--text-muted);">Plugin ID</div>
                  <div style="font-size: 13px; font-weight: 600; color: #60a5fa; font-family: monospace;">${escapeHtml(item.id)}</div>
                </div>
                <div style="background: rgba(0,0,0,0.2); padding: 0.65rem 0.85rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04);">
                  <div style="font-size: 11px; color: var(--text-muted);">Lifecycle State</div>
                  <div style="font-size: 13px; font-weight: 600; color: #34d399;">Active & Mounted</div>
                </div>
              </div>
            </div>
          </div>
        `;
      }

      target.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; gap: 1.25rem;">
          ${baseHtml}
          <div id="plugin-config-container-${escapeHtml(item.id)}"></div>
        </div>
      `;

      loadPluginConfig(item.id);
    }

    async function loadPluginConfig(pluginId) {
      const container = document.getElementById('plugin-config-container-' + pluginId);
      if (!container) return;

      try {
        const res = await api('/api/plugins/' + encodeURIComponent(pluginId) + '/config');
        if (!res || !res.hasConfig || !res.fields || res.fields.length === 0) {
          container.innerHTML = '';
          return;
        }

        const lockedCount = res.fields.filter(f => f.isLocked).length;
        const editableCount = res.fields.length - lockedCount;

        container.innerHTML = `
          <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.85rem;">
              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-weight: 800; font-size: 15px; color: #fff;">⚙️ Configuration & Credentials</span>
                  <span class="badge badge-info" style="font-size: 10.5px;">Option B Precedence</span>
                </div>
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 3px;">
                  Parameters defined in <code>.env</code> or server code are strictly locked for deployment safety. Remaining parameters can be edited below.
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 11.5px;">
                <span class="badge" style="background: rgba(30,41,59,0.8); border: 1px solid rgba(148,163,184,0.25); color: #94a3b8;">🔒 ${lockedCount} Locked</span>
                <span class="badge" style="background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); color: #34d399;">✏️ ${editableCount} Editable</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
              ${res.fields.map(field => {
                const isLocked = field.isLocked;
                const fieldId = `cfg-${pluginId}-${field.name}`;
                return `
                  <div style="background: var(--bg-input); border: 1px solid ${isLocked ? 'rgba(255,255,255,0.06)' : 'var(--border-subtle)'}; border-radius: 8px; padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.45rem;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                      <label style="font-size: 12.5px; font-weight: 700; color: #fff;" for="${fieldId}">
                        ${escapeHtml(field.label)} ${field.required ? '<span style="color:#ef4444;">*</span>' : ''}
                      </label>
                      ${isLocked ? `
                        <span class="badge" style="background: rgba(15,23,42,0.8); border: 1px solid rgba(148,163,184,0.3); color: #94a3b8; font-size: 10px; padding: 2px 6px;" title="${escapeHtml(field.lockReason || 'Locked')}">
                          🔒 ENV LOCKED
                        </span>
                      ` : (field.source === 'db' ? `
                        <span class="badge" style="background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); color: #34d399; font-size: 10px; padding: 2px 6px;">
                          ✏️ DATABASE OVERRIDE
                        </span>
                      ` : `
                        <span class="badge" style="background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.3); color: #60a5fa; font-size: 10px; padding: 2px 6px;">
                          ✏️ ${field.source === 'code' ? 'CODE DEFAULT' : 'DEFAULT'}
                        </span>
                      `)}
                    </div>

                    ${isLocked ? `
                      <input type="text" class="form-input" disabled value="${escapeHtml(field.maskedValue || field.value || '')}"
                        style="opacity: 0.7; cursor: not-allowed; background: rgba(0,0,0,0.35); font-family: monospace; font-size: 12.5px; border-color: rgba(255,255,255,0.06);" />
                      <div style="font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 4px;">
                        <span>🔒</span> <span>${escapeHtml(field.lockReason || 'Managed by environment')}</span>
                      </div>
                    ` : (field.type === 'boolean' ? `
                      <div style="display: flex; align-items: center; gap: 0.5rem; height: 36px;">
                        <input type="checkbox" id="${fieldId}" ${field.value ? 'checked' : ''} style="cursor: pointer; width: 18px; height: 18px;" />
                        <label for="${fieldId}" style="font-size: 12.5px; color: #e2e8f0; cursor: pointer;">Enabled</label>
                      </div>
                    ` : `
                      <input type="${field.type === 'password' ? 'password' : 'text'}" class="form-input" id="${fieldId}"
                        value="${escapeHtml(field.value || '')}" placeholder="${escapeHtml(field.placeholder || '')}"
                        style="font-family: monospace; font-size: 12.5px;" />
                    `)}

                    <div style="font-size: 11px; color: var(--text-muted); line-height: 1.35;">
                      ${escapeHtml(field.description || '')}
                      ${field.envKey ? `<span style="display:inline-block; margin-left: 4px; font-family: monospace; opacity: 0.8;">(${escapeHtml(field.envKey)})</span>` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.5rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle);">
              <div style="font-size: 11.5px; color: var(--text-muted);">
                ${editableCount > 0 ? 'Database settings are persisted to <code>_plugin_settings</code> in SQLite and immediately hot-reloaded.' : 'All options are strictly controlled by environment variables or code.'}
              </div>
              ${editableCount > 0 ? `
                <button class="btn btn-primary btn-sm" id="btn-save-cfg-${escapeHtml(pluginId)}" onclick="savePluginConfig('${escapeHtml(pluginId)}')">
                  Save Configuration
                </button>
              ` : ''}
            </div>
          </div>
        `;
      } catch (e) {
        container.innerHTML = '';
      }
    }

    async function savePluginConfig(pluginId) {
      const btn = document.getElementById('btn-save-cfg-' + pluginId);
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving...';
      }

      try {
        const configData = await api('/api/plugins/' + encodeURIComponent(pluginId) + '/config');
        if (!configData || !configData.fields) throw new Error('Could not read plugin configuration');

        const updates = {};
        for (const field of configData.fields) {
          if (field.isLocked) continue;
          const fieldEl = document.getElementById(`cfg-${pluginId}-${field.name}`);
          if (!fieldEl) continue;

          if (field.type === 'boolean') {
            updates[field.name] = fieldEl.checked;
          } else if (field.type === 'number') {
            updates[field.name] = fieldEl.value === '' ? undefined : Number(fieldEl.value);
          } else {
            updates[field.name] = fieldEl.value;
          }
        }

        await api('/api/plugins/' + encodeURIComponent(pluginId) + '/config', {
          method: 'PUT',
          body: JSON.stringify(updates),
        });

        toast('Configuration updated and applied successfully!', 'success');
        await loadPluginConfig(pluginId);
      } catch (err) {
        toast(err.message || 'Failed to update plugin configuration', 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Save Configuration';
        }
      }
    }

    window.loadPluginConfig = loadPluginConfig;
    window.savePluginConfig = savePluginConfig;

    function renderPluginsHubView() {
      const target = document.getElementById('plugins-detail-pane') || document.getElementById('main-body');
      if (!target) return;
      const items = state.pluginNavItems || [];

      target.innerHTML = `
        <div class="hub-hero-banner">
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem;">
            <div>
              <h2 style="font-size:18px; font-weight:800; color:#fff; letter-spacing:-0.02em;">Installed Extensions & Plugins Hub</h2>
              <p style="font-size:12px; color:var(--text-muted); margin-top:3px;">
                Modular official plugins extending NodeStack with Stripe payments, S3 cloud storage, Resend emails, Webhooks, and Algolia search.
              </p>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <a href="/demo/" target="_blank" class="btn btn-primary btn-sm" style="text-decoration:none;">Interactive Demo App ↗</a>
              <a href="/_/docs" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration:none;">OpenAPI Specs ↗</a>
            </div>
          </div>

          <div class="hub-stats-row" style="margin-top:0.5rem;">
            <div class="hub-stat-card">
              <span style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Active Extensions</span>
              <span style="font-size:20px; font-weight:800; color:#60a5fa;">${items.length}</span>
            </div>
            <div class="hub-stat-card">
              <span style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Architecture</span>
              <span style="font-size:13px; font-weight:700; color:#34d399; margin-top:4px;">app.use(plugin)</span>
            </div>
            <div class="hub-stat-card">
              <span style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Integration Status</span>
              <span style="font-size:13px; font-weight:700; color:#10b981; margin-top:4px;">● Live & Ready</span>
            </div>
          </div>
        </div>

        <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin:0.25rem 0;">
          Active Plugins (${items.length})
        </div>

        ${items.length === 0 ? `
          <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:10px; padding:2rem; text-align:center; color:var(--text-muted);">
            <div style="font-size:28px; margin-bottom:0.5rem;">🧩</div>
            <div style="font-weight:700; font-size:15px; color:#fff;">No Plugins Registered</div>
            <div style="font-size:12px; margin-top:4px;">Mount community extension plugins using <code>app.use(plugin)</code> in your NodeStack server code.</div>
          </div>
        ` : `
          <div class="hub-cards-grid">
            ${items.map(item => {
              const title = (item.view && typeof item.view === 'object' && item.view.title) ? item.view.title : item.title;
              const desc = (item.view && typeof item.view === 'object' && item.view.description) ? item.view.description : 'Configured via NodeStack formal plugin architecture.';
              const icon = item.icon || '🧩';
              const isExternal = item.path && (item.target === '_blank' || item.path.startsWith('http'));

              return `
                <div class="hub-card" onclick="${isExternal ? `window.open('${escapeHtml(item.path)}', '${item.target || '_blank'}')` : `selectNav('${escapeHtml(item.id)}')`}">
                  <div class="hub-card-header">
                    <div class="hub-card-title">
                      <span style="display:inline-flex; align-items:center;">${icon}</span>
                      <span>${escapeHtml(item.title)}</span>
                    </div>
                    ${item.badge ? `<span class="badge ${item.badgeVariant ? 'badge-' + item.badgeVariant : 'badge-get'}" style="font-size:10px;">${escapeHtml(item.badge)}</span>` : ''}
                  </div>
                  <div class="hub-card-desc">
                    ${escapeHtml(desc)}
                  </div>
                  <div class="hub-card-footer">
                    <span style="font-family:monospace; font-size:11px; color:var(--text-muted);">${escapeHtml(item.id)}</span>
                    ${isExternal ? `
                      <span class="btn btn-secondary btn-sm" style="display:inline-flex; align-items:center; gap:4px;">
                        <span>Open Portal</span><span>↗</span>
                      </span>
                    ` : `
                      <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); selectNav('${escapeHtml(item.id)}')">
                        Open Dashboard ➔
                      </button>
                    `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      `;
    }

    function renderCollectionsHubView() {
      const target = document.getElementById('collections-detail-pane') || document.getElementById('main-body');
      if (!target) return;
      const userCols = (state.collections || []).filter(c => !isSystemCollection(c));
      const systemCols = (state.collections || []).filter(c => isSystemCollection(c));

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
              <button class="btn btn-secondary btn-sm" onclick="openImportModal()">⚡ Import JSON</button>
            </div>
          </div>

          <div class="hub-stats-row" style="margin-top:0.5rem;">
            <div class="hub-stat-card">
              <span style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Total Collections</span>
              <span style="font-size:20px; font-weight:800; color:#fff;">${(state.collections || []).length}</span>
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
          All Registered Collections (${(state.collections || []).length})
        </div>

        <div class="hub-cards-grid">
          ${(state.collections || []).map(col => {
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
        renderPluginNavItems();
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
        id: 'nav-collections',
        title: 'Collections',
        description: 'Dedicated database collections directory, tables & schema',
        category: 'Navigation',
        badge: 'PAGE',
        icon: '📦',
        keywords: ['collections', 'database', 'tables', 'schema', 'records'],
        action: () => selectNav('collections')
      });

      items.push({
        id: 'nav-plugins',
        title: 'Plugins',
        description: 'Dedicated official extensions & community plugins directory',
        category: 'Navigation',
        badge: 'PAGE',
        icon: '🧩',
        keywords: ['plugins', 'extensions', 'addons', 'stripe', 's3', 'resend', 'webhooks', 'algolia'],
        action: () => selectNav('plugins')
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

      // 2.5 Plugin navigation items
      if (state.pluginNavItems && state.pluginNavItems.length > 0) {
        for (const p of state.pluginNavItems) {
          items.push({
            id: 'plugin-' + p.id,
            title: p.title,
            description: (p.view && typeof p.view === 'object' && p.view.description) ? p.view.description : `Plugin extension: ${p.title}`,
            category: 'Plugins',
            badge: p.badge || 'PLUGIN',
            icon: '🧩',
            keywords: [p.id, p.title.toLowerCase(), 'plugin', 'extension'],
            action: () => selectNav(p.id)
          });
        }
      }

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
          return;
        }
        const modalRoot = document.getElementById('modal-root');
        if (modalRoot && modalRoot.innerHTML.trim().length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (typeof closeModal === 'function') {
            closeModal();
          }
          return;
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
      window.renderPluginNavItems = renderPluginNavItems;
      window.renderPluginView = renderPluginView;
    }

// Run on startup
window.addEventListener('DOMContentLoaded', init);
