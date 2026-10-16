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
          <button class="btn btn-secondary btn-sm" onclick="openImportModal()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Import JSON</button>
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
      } else if (state.pluginNavItems && state.pluginNavItems.some(p => p.id === nav || (nav === 'resend' && p.id === 'resend-email'))) {
        state.activeCollection = null;
        renderCollectionsList();
        showPageView('plugins');
        document.getElementById('collection-tabs').style.display = 'none';
        document.getElementById('nav-plugins')?.classList.add('active');
        document.getElementById('nav-' + nav)?.classList.add('active');
        const pluginItem = state.pluginNavItems.find(p => p.id === nav || (nav === 'resend' && p.id === 'resend-email'));
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
      `;

      const target = document.getElementById('plugins-detail-pane') || document.getElementById('main-body');
      if (!target) return;

      const title = (item.view && typeof item.view === 'object' && item.view.title) ? item.view.title : item.title;
      const desc = (item.view && typeof item.view === 'object' && item.view.description) ? item.view.description : 'Configured via NodeStack formal plugin architecture.';

      let bodyContent = '';
      if (typeof item.view === 'string') {
        bodyContent = item.view;
      } else if (item.view && typeof item.view === 'object' && item.view.html) {
        bodyContent = item.view.html;
      }

      if (!bodyContent || !bodyContent.trim()) {
        bodyContent = `
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
        `;
      }

      const cardHtml = `
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
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <button class="btn btn-primary btn-sm" onclick="openPluginTesterDrawer('${escapeHtml(item.id)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:4px;"><path d="M10 2v7.31L4.69 18.59A2 2 0 0 0 6.41 22h11.18a2 2 0 0 0 1.72-3.41L14 9.31V2"/><line x1="8.5" y1="2" x2="15.5" y2="2"/><line x1="14" y1="9.3" x2="10" y2="9.3"/></svg>Test Plugin</button>
              <button class="btn btn-secondary btn-sm" onclick="selectNav('plugins')">Back to Plugins</button>
            </div>
          </div>
          
          ${bodyContent}
        </div>
      `;

      const isStripeLive = item.id === 'stripe' && (item.badge === 'LIVE' || item.badgeVariant === 'danger');
      const liveAlertHtml = isStripeLive ? `
        <div class="alert alert-danger" style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 8px; padding: 0.75rem 1rem; color: #fca5a5; font-size: 11.5px; display: flex; align-items: flex-start; gap: 0.75rem;">
          <span style="font-size: 16px; line-height: 1;">🚨</span>
          <div>
            <strong style="color: #ef4444; font-size: 12px; display: block; margin-bottom: 2px;">CAUTION: LIVE PRODUCTION MODE ACTIVE</strong>
            This extension is configured with a live Stripe secret key. All checkout and payment operations will debit real payment methods and deduct real currency.
          </div>
        </div>
      ` : '';

      const disclaimerHtml = `
        <div class="plugin-disclaimer-banner" style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 0.75rem 1rem; font-size: 11.5px; line-height: 1.45; color: #fcd34d;">
          <div style="font-weight: 700; display: flex; align-items: center; gap: 6px; margin-bottom: 2px; color: #fbbf24;">
            <span>⚠️</span> <span>Third-Party Integration & Credentials Disclaimer</span>
          </div>
          <div style="color: #cbd5e1; font-size: 11.5px;">
            This extension connects and transmits credentials directly to external third-party services. NodeStack operates solely as an execution harness; you are solely responsible for securing API keys, monitoring quotas, and any external account billing, charges, or data mutations incurred.
          </div>
        </div>
      `;

      target.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; gap: 1.25rem;">
          ${liveAlertHtml}
          ${disclaimerHtml}
          ${cardHtml}
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
                      ${field.type === 'select' ? `
                        <select class="form-input" disabled
                          style="opacity: 0.7; cursor: not-allowed; background: rgba(0,0,0,0.35); font-size: 12.5px; border-color: rgba(255,255,255,0.06); color: #fff;">
                          ${field.value !== undefined && !(field.options || []).some(opt => String(typeof opt === 'object' && opt !== null && 'value' in opt ? opt.value : opt) === String(field.value)) ? `
                            <option value="${escapeHtml(String(field.value))}" selected>${escapeHtml(String(field.value))}</option>
                          ` : ''}
                          ${(field.options || []).map(opt => {
                            const optVal = typeof opt === 'object' && opt !== null && 'value' in opt ? opt.value : opt;
                            const optLabel = typeof opt === 'object' && opt !== null && 'label' in opt ? opt.label : opt;
                            const isSelected = String(field.value) === String(optVal);
                            return `<option value="${escapeHtml(String(optVal))}" ${isSelected ? 'selected' : ''}>${escapeHtml(String(optLabel))}</option>`;
                          }).join('')}
                        </select>
                      ` : `
                        <input type="text" class="form-input" disabled value="${escapeHtml(field.type === 'password' ? '••••••••' : (field.value !== undefined ? String(field.value) : ''))}"
                          style="opacity: 0.7; cursor: not-allowed; background: rgba(0,0,0,0.35); font-family: monospace; font-size: 12.5px; border-color: rgba(255,255,255,0.06);" />
                      `}
                      <div style="font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 4px;">
                        <span>🔒</span> <span>${escapeHtml(field.lockReason || 'Managed by environment')}</span>
                      </div>
                    ` : (field.type === 'boolean' ? `
                      <div style="display: flex; align-items: center; gap: 0.5rem; height: 36px;">
                        <input type="checkbox" id="${fieldId}" ${field.value ? 'checked' : ''} style="cursor: pointer; width: 18px; height: 18px;" />
                        <label for="${fieldId}" style="font-size: 12.5px; color: #e2e8f0; cursor: pointer;">Enabled</label>
                      </div>
                    ` : (field.type === 'select' ? `
                      <select class="form-input" id="${fieldId}"
                        style="cursor: pointer; font-size: 12.5px; background: var(--bg-card); color: #fff;">
                        ${!field.required && !(field.options || []).some(opt => (typeof opt === 'object' && opt !== null && 'value' in opt ? opt.value : opt) === '') ? `
                          <option value="" ${field.value === undefined || field.value === '' ? 'selected' : ''}>${escapeHtml(field.placeholder || '-- Select an option --')}</option>
                        ` : (field.placeholder && (field.value === undefined || field.value === '') ? `
                          <option value="" disabled selected>${escapeHtml(field.placeholder)}</option>
                        ` : '')}
                        ${(field.options || []).map(opt => {
                          const optVal = typeof opt === 'object' && opt !== null && 'value' in opt ? opt.value : opt;
                          const optLabel = typeof opt === 'object' && opt !== null && 'label' in opt ? opt.label : opt;
                          const isSelected = String(field.value) === String(optVal);
                          return `<option value="${escapeHtml(String(optVal))}" ${isSelected ? 'selected' : ''}>${escapeHtml(String(optLabel))}</option>`;
                        }).join('')}
                      </select>
                    ` : (field.type === 'password' ? `
                      <input type="password" class="form-input" id="${fieldId}"
                        value="" placeholder="${field.hasValue ? '•••••••• (Secret configured - leave blank to keep unchanged)' : escapeHtml(field.placeholder || 'Enter secret...')}"
                        autocomplete="new-password"
                        style="font-family: monospace; font-size: 12.5px;" />
                      ${field.hasValue ? `
                        <div style="font-size: 10.5px; color: #34d399; display: flex; align-items: center; gap: 4px; margin-top: 2px;">
                          <span>✓</span> <span>Secret is configured. Leave blank to keep existing secret.</span>
                        </div>
                      ` : ''}
                    ` : `
                      <input type="text" class="form-input" id="${fieldId}"
                        value="${escapeHtml(field.value !== undefined ? String(field.value) : '')}" placeholder="${escapeHtml(field.placeholder || '')}"
                        style="font-family: monospace; font-size: 12.5px;" />
                    `)))}

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
          } else if (field.type === 'password') {
            if (fieldEl.value && fieldEl.value.trim() !== '') {
              updates[field.name] = fieldEl.value;
            }
          } else if (field.type === 'select') {
            const hasEmptyOpt = (field.options || []).some(opt => (typeof opt === 'object' && opt !== null && 'value' in opt ? opt.value : opt) === '');
            updates[field.name] = (fieldEl.value === '' && !hasEmptyOpt) ? undefined : fieldEl.value;
          } else {
            updates[field.name] = fieldEl.value;
          }
        }

        await api('/api/plugins/' + encodeURIComponent(pluginId) + '/config', {
          method: 'PUT',
          body: JSON.stringify(updates),
        });

        toast('Configuration updated and applied successfully!', 'success');
        try {
          const navRes = await api('/api/plugins');
          if (navRes && navRes.navItems) {
            state.pluginNavItems = navRes.navItems;
            if (typeof renderPluginNavItems === 'function') renderPluginNavItems();
            const activeItem = state.pluginNavItems.find(p => p.id === pluginId);
            if (activeItem && typeof mountCustomView === 'function' && state.activeNav === pluginId) {
              mountCustomView(activeItem);
              return;
            }
          }
        } catch (_) {}
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

    const DEFAULT_OFFICIAL_CATALOG = [
      {
        id: 'stripe',
        name: 'stripe',
        packageName: '@nodestackapp/plugin-stripe',
        title: 'Stripe Payments',
        category: 'Payments & Checkout',
        description: 'Process checkout sessions, customer billing portals, and verify webhook signatures with audit logs.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
        badge: 'PAYMENTS',
        collections: ['_stripe_payments'],
      },
      {
        id: 's3-storage',
        name: 's3-storage',
        packageName: '@nodestackapp/plugin-s3',
        title: 'S3 Cloud Storage',
        category: 'Object Storage & CDN',
        description: 'AWS S3, MinIO, and Cloudflare R2 object storage with SigV4 presigned upload URLs and file tracking.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
        badge: 'STORAGE',
        collections: ['_s3_uploads'],
      },
      {
        id: 'resend',
        name: 'resend',
        packageName: '@nodestackapp/plugin-resend',
        title: 'Resend Transactional Email',
        category: 'Communications',
        description: 'Transactional email delivery via Resend API with safe dry-run mode and delivery logs in SQLite.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
        badge: 'EMAIL',
        collections: ['_email_logs'],
      },
      {
        id: 'webhooks',
        name: 'webhooks',
        packageName: '@nodestackapp/plugin-webhooks',
        title: 'Discord & Slack Webhooks',
        category: 'Automation & Alerts',
        description: 'Real-time outbound notifications to Discord and Slack channels on database mutations with payload logs.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
        badge: 'WEBHOOKS',
        collections: ['_webhook_logs'],
      },
      {
        id: 'algolia',
        name: 'algolia',
        packageName: '@nodestackapp/plugin-algolia',
        title: 'Algolia Search Sync',
        category: 'Search & Discovery',
        description: 'Realtime search indexing on record mutations, background sync queues, and batch re-indexing.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
        badge: 'SEARCH',
        collections: ['_algolia_sync_queue'],
      },
    ];

    async function enablePlugin(id) {
      const btn = document.getElementById(`btn-enable-${id}`);
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Enabling...';
      }
      try {
        const res = await api(`/api/plugins/${encodeURIComponent(id)}/enable`, { method: 'POST' });
        toast(res?.message || `Extension "${id}" enabled successfully!`, 'success');

        // Reload collections list so any new system collection appears immediately
        try {
          if (typeof loadCollections === 'function') {
            await loadCollections();
          }
        } catch (_) {}

        // Reload plugins info
        const pluginData = await api('/api/plugins');
        if (pluginData) {
          state.pluginNavItems = pluginData.navItems || [];
          state.pluginCatalog = pluginData.catalog || [];
          renderPluginNavItems();
          renderPluginsHubView();
        }
      } catch (err) {
        toast(err.message || 'Failed to enable plugin', 'error');
        if (btn) {
          btn.disabled = false;
          btn.textContent = '+ Enable Extension';
        }
      }
    }

    async function disablePlugin(id) {
      if (!confirm(`Are you sure you want to disable the "${id}" extension? Any background workers will stop.`)) {
        return;
      }
      try {
        const res = await api(`/api/plugins/${encodeURIComponent(id)}/disable`, { method: 'POST' });
        toast(res?.message || `Extension "${id}" disabled successfully`, 'info');

        // Reload collections list
        try {
          if (typeof loadCollections === 'function') {
            await loadCollections();
          }
        } catch (_) {}

        // Reload plugins info
        const pluginData = await api('/api/plugins');
        if (pluginData) {
          state.pluginNavItems = pluginData.navItems || [];
          state.pluginCatalog = pluginData.catalog || [];
          renderPluginNavItems();
          renderPluginsHubView();
        }
      } catch (err) {
        toast(err.message || 'Failed to disable plugin', 'error');
      }
    }

    window.enablePlugin = enablePlugin;
    window.disablePlugin = disablePlugin;

    function renderPluginsHubView() {
      const target = document.getElementById('plugins-detail-pane') || document.getElementById('main-body');
      if (!target) return;
      const items = state.pluginNavItems || [];
      const catalog = (state.pluginCatalog && state.pluginCatalog.length > 0)
        ? state.pluginCatalog
        : (window.__NODESTACK_PLUGIN_CATALOG__ && window.__NODESTACK_PLUGIN_CATALOG__.length > 0)
          ? window.__NODESTACK_PLUGIN_CATALOG__
          : DEFAULT_OFFICIAL_CATALOG;

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
              <span style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Official Catalog</span>
              <span style="font-size:13px; font-weight:700; color:#10b981; margin-top:4px;">● ${catalog.length} Available</span>
            </div>
          </div>
        </div>

        ${items.length > 0 ? `
          <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin:0.75rem 0 0.5rem 0;">
            Active Plugins (${items.length})
          </div>
          <div class="hub-cards-grid" style="margin-bottom:1.5rem;">
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
                    <div style="display:flex; align-items:center; gap:6px;">
                      <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openPluginTesterDrawer('${escapeHtml(item.id)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:4px;"><path d="M10 2v7.31L4.69 18.59A2 2 0 0 0 6.41 22h11.18a2 2 0 0 0 1.72-3.41L14 9.31V2"/><line x1="8.5" y1="2" x2="15.5" y2="2"/><line x1="14" y1="9.3" x2="10" y2="9.3"/></svg>Test</button>
                      ${isExternal ? `
                        <span class="btn btn-secondary btn-sm" style="display:inline-flex; align-items:center; gap:4px;">
                          <span>Open Portal</span><span>↗</span>
                        </span>
                      ` : `
                        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); selectNav('${escapeHtml(item.id)}')">
                          Dashboard ➔
                        </button>
                      `}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:10px; padding:1.25rem; text-align:center; color:var(--text-muted); margin-bottom:1.5rem;">
            <div style="font-size:22px; margin-bottom:0.25rem;">🧩</div>
            <div style="font-weight:700; font-size:14px; color:#fff;">No Extensions Currently Active</div>
            <div style="font-size:12px; margin-top:4px;">Enable any of the official community extensions below with 1-click, or mount custom plugins using <code>app.use(plugin)</code> in code.</div>
          </div>
        `}

        <div style="display:flex; align-items:center; justify-content:space-between; margin:1.5rem 0 0.5rem 0; flex-wrap:wrap; gap:0.5rem;">
          <div>
            <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted);">
              Official Extensions Catalog (${catalog.length} Available)
            </div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
              Ready-to-use official extensions. Enable instantly with zero configuration or customize anytime.
            </div>
          </div>
        </div>

        <div class="hub-cards-grid">
          ${catalog.map(cat => {
            const isInstalled = Boolean(cat.isInstalled) || items.some(i => i.id === cat.id || i.id === cat.name || (cat.id === 'resend' && i.id === 'resend-email'));
            const icon = cat.icon || '🧩';

            return `
              <div class="hub-card" style="cursor:default;" onclick="${isInstalled ? `selectNav('${escapeHtml(cat.id)}')` : ''}">
                <div class="hub-card-header">
                  <div class="hub-card-title">
                    <span style="display:inline-flex; align-items:center;">${icon}</span>
                    <span>${escapeHtml(cat.title)}</span>
                  </div>
                  ${cat.badge ? `<span class="badge badge-primary" style="font-size:10px;">${escapeHtml(cat.badge)}</span>` : ''}
                </div>
                <div style="font-size:11px; font-family:monospace; color:#93c5fa; margin-top:-4px;">
                  ${escapeHtml(cat.packageName || `@nodestackapp/plugin-${cat.name}`)}
                </div>
                <div class="hub-card-desc">
                  ${escapeHtml(cat.description)}
                </div>
                ${cat.collections && cat.collections.length ? `
                  <div style="font-size:11px; color:var(--text-muted);">
                    Creates collection: <code style="color:#a78bfa;">${escapeHtml(cat.collections.join(', '))}</code>
                  </div>
                ` : ''}
                <div class="hub-card-footer">
                  ${isInstalled ? `
                    <span style="font-size:11px; color:#10b981; font-weight:700; display:inline-flex; align-items:center; gap:4px;">
                      ● Active
                    </span>
                    <div style="display:flex; align-items:center; gap:0.4rem;">
                      <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); openPluginTesterDrawer('${escapeHtml(cat.id)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:4px;"><path d="M10 2v7.31L4.69 18.59A2 2 0 0 0 6.41 22h11.18a2 2 0 0 0 1.72-3.41L14 9.31V2"/><line x1="8.5" y1="2" x2="15.5" y2="2"/><line x1="14" y1="9.3" x2="10" y2="9.3"/></svg>Test</button>
                      <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); selectNav('${escapeHtml(cat.id)}')">
                        Configure ⚙
                      </button>
                      <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); disablePlugin('${escapeHtml(cat.id)}')">
                        Disable
                      </button>
                    </div>
                  ` : `
                    <span style="font-size:11px; color:var(--text-muted); display:inline-flex; align-items:center; gap:4px;">
                      ○ Available
                    </span>
                    <button class="btn btn-primary btn-sm" id="btn-enable-${escapeHtml(cat.id)}" onclick="event.stopPropagation(); enablePlugin('${escapeHtml(cat.id)}')">
                      + Enable Extension
                    </button>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // === Slide-Over Plugin Tester Drawer ===
    function openPluginTesterDrawer(pluginId) {
      const cleanId = String(pluginId || '').replace(/^nav-/, '').toLowerCase();
      const catalog = (state.pluginCatalog && state.pluginCatalog.length > 0)
        ? state.pluginCatalog
        : (window.__NODESTACK_PLUGIN_CATALOG__ && window.__NODESTACK_PLUGIN_CATALOG__.length > 0)
          ? window.__NODESTACK_PLUGIN_CATALOG__
          : DEFAULT_OFFICIAL_CATALOG;

      const meta = catalog.find(c => c.id === cleanId || c.name === cleanId) || {
        title: cleanId.charAt(0).toUpperCase() + cleanId.slice(1),
        icon: '🧩',
        collections: []
      };

      const title = meta.title || cleanId;
      const icon = meta.icon || '🧩';
      const relatedCol = meta.collections && meta.collections.length > 0 ? meta.collections[0] : null;

      let formHtml = '';
      if (cleanId === 'stripe') {
        const stripeNavItem = (state.pluginNavItems || []).find(p => p.id === 'stripe');
        const isStripeLive = stripeNavItem && (stripeNavItem.badge === 'LIVE' || stripeNavItem.badgeVariant === 'danger');

        formHtml = `
          ${isStripeLive ? `
            <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 0.85rem; color: #fca5a5; font-size: 11.5px;">
              <div style="font-weight: 800; color: #ef4444; display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
                <span>🚨</span> <span>LIVE PRODUCTION MODE ACTIVE</span>
              </div>
              <div>Live Stripe Secret Key (<code>sk_live_...</code>) is configured. Creating checkout sessions will initiate REAL credit card transactions and monetary deductions!</div>
            </div>
          ` : `
            <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 6px; padding: 0.5rem 0.75rem; margin-bottom: 0.85rem; color: #93c5fd; font-size: 11px;">
              🛡️ <strong>Test Mode Active:</strong> Using Stripe test credentials (<code>sk_test_...</code>). Simulated charges will not debit real payment cards.
            </div>
          `}
          <div class="drawer-section-title">1. Create Checkout Session</div>
          <div class="drawer-card">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <div>
                <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Customer Email</label>
                <input type="email" id="test-stripe-email" class="form-control" value="customer@example.com" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
              </div>
              <div>
                <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Amount (Cents)</label>
                <input type="number" id="test-stripe-amount" class="form-control" value="4900" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
              </div>
            </div>
            <button class="btn btn-primary btn-sm" onclick="runStripeCheckoutTest()" style="margin-top: 4px;">
              Create Checkout Session ($49.00)
            </button>
          </div>

          <div class="drawer-section-title" style="margin-top: 0.85rem;">2. Simulate Incoming Webhook</div>
          <div class="drawer-card">
            <div>
              <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Event Type</label>
              <select id="test-stripe-event-type" class="form-control" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;">
                <option value="payment_intent.succeeded">payment_intent.succeeded</option>
                <option value="checkout.session.completed">checkout.session.completed</option>
                <option value="customer.subscription.created">customer.subscription.created</option>
              </select>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="runStripeWebhookSimulation()" style="margin-top: 4px;">
              Dispatch Mock Webhook
            </button>
          </div>
        `;
      } else if (cleanId === 's3' || cleanId === 's3-storage') {
        const s3NavItem = (state.pluginNavItems || []).find(p => p.id === 's3-storage' || p.id === 's3');
        const isS3Configured = s3NavItem && s3NavItem.badge !== 'UNCONFIGURED' && !s3NavItem.view?.description?.includes('Unconfigured');
        formHtml = `
          ${!isS3Configured ? `
            <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 0.85rem; color: #fcd34d; font-size: 11.5px;">
              <div style="font-weight: 700; color: #fbbf24; display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
                <span>⚠️</span> <span>S3 Cloud Storage Unconfigured</span>
              </div>
              <div style="color: #cbd5e1; font-size: 11px;">
                No S3 bucket has been configured yet. URL presigning and bucket connectivity tests will fail until you specify a bucket name in extension settings or environment variables.
              </div>
            </div>
          ` : ''}
          <div class="drawer-section-title">1. Generate SigV4 Presigned Upload URL</div>
          <div class="drawer-card">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <div>
                <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">File Key</label>
                <input type="text" id="test-s3-key" class="form-control" value="uploads/avatar-demo.png" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
              </div>
              <div>
                <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">MIME Type</label>
                <input type="text" id="test-s3-mimetype" class="form-control" value="image/png" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
              </div>
            </div>
            <button class="btn btn-primary btn-sm" onclick="runS3PresignedUrlTest()" style="margin-top: 4px;">
              Generate Presigned Upload URL
            </button>
          </div>

          <div class="drawer-section-title" style="margin-top: 0.85rem;">2. Bucket Connectivity & Health</div>
          <div class="drawer-card">
            <div style="font-size: 12px; color: var(--text-muted);">
              Verifies S3 bucket configuration, region, and endpoint resolution.
            </div>
            <button class="btn btn-secondary btn-sm" onclick="runS3StatusTest()" style="margin-top: 4px;">
              Verify Bucket Status
            </button>
          </div>
        `;
      } else if (cleanId === 'resend' || cleanId === 'resend-email') {
        formHtml = `
          <div class="drawer-section-title">1. Send Transactional Email</div>
          <div class="drawer-card">
            <div>
              <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Recipient Email (To)</label>
              <input type="email" id="test-resend-to" class="form-control" value="developer@example.com" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
            </div>
            <div style="margin-top: 4px;">
              <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Subject Line</label>
              <input type="text" id="test-resend-subject" class="form-control" value="NodeStack Test Notification" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
            </div>
            <div style="margin-top: 4px;">
              <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Email Body</label>
              <textarea id="test-resend-body" class="form-control" rows="2" style="margin-top: 3px; font-size: 12px; padding: 6px 8px; font-family: sans-serif;">Hello from NodeStack! This is an interactive transactional test email.</textarea>
            </div>
            <button class="btn btn-primary btn-sm" onclick="runResendSendTest()" style="margin-top: 4px;">
              Send Test Email
            </button>
          </div>
        `;
      } else if (cleanId === 'webhooks') {
        formHtml = `
          <div class="drawer-section-title">1. Dispatch Test Webhook</div>
          <div class="drawer-card">
            <div>
              <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Target Platform</label>
              <select id="test-webhook-platform" class="form-control" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;">
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
              </select>
            </div>
            <div style="margin-top: 4px;">
              <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Notification Message</label>
              <input type="text" id="test-webhook-message" class="form-control" value="NodeStack database mutation event" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
            </div>
            <button class="btn btn-primary btn-sm" onclick="runWebhookDispatchTest()" style="margin-top: 4px;">
              Dispatch Outbound Webhook
            </button>
          </div>
        `;
      } else if (cleanId === 'algolia') {
        const algoliaNavItem = (state.pluginNavItems || []).find(p => p.id === 'algolia');
        const isAlgoliaConfigured = algoliaNavItem && algoliaNavItem.badge !== 'UNCONFIGURED' && !algoliaNavItem.view?.description?.includes('Unconfigured');
        const userCols = (state.collections || []).filter(c => typeof c === 'object' && !c.name.startsWith('_'));
        const optionsHtml = userCols.length > 0
          ? userCols.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('')
          : '<option value="users">users</option>';
        formHtml = `
          ${!isAlgoliaConfigured ? `
            <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 0.85rem; color: #fcd34d; font-size: 11.5px;">
              <div style="font-weight: 700; color: #fbbf24; display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
                <span>⚠️</span> <span>Algolia Search Unconfigured</span>
              </div>
              <div style="color: #cbd5e1; font-size: 11px;">
                No Algolia Application ID or Admin API Key configured. Index synchronization and queue processing will fail until credentials are configured in extension settings or environment variables.
              </div>
            </div>
          ` : ''}
          <div class="drawer-section-title">1. Trigger Collection Reindex</div>
          <div class="drawer-card">
            <div>
              <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Collection to Index</label>
              <select id="test-algolia-col" class="form-control" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;">
                ${optionsHtml}
              </select>
            </div>
            <button class="btn btn-primary btn-sm" onclick="runAlgoliaReindexTest()" style="margin-top: 4px;">
              Trigger Full Re-index
            </button>
          </div>

          <div class="drawer-section-title" style="margin-top: 0.85rem;">2. Process Sync Queue</div>
          <div class="drawer-card">
            <div style="font-size: 12px; color: var(--text-muted);">
              Manually triggers background worker queue to flush and synchronize pending mutations.
            </div>
            <button class="btn btn-secondary btn-sm" onclick="runAlgoliaProcessQueueTest()" style="margin-top: 4px;">
              Process Queue Now
            </button>
          </div>
        `;
      } else {
        formHtml = `
          <div class="drawer-section-title">Plugin Workbench</div>
          <div class="drawer-card">
            <div style="font-size: 12.5px; color: var(--text-muted);">
              Custom registered plugin: <code style="color: #60a5fa;">${escapeHtml(cleanId)}</code>
            </div>
            <button class="btn btn-primary btn-sm" onclick="checkPluginTesterStatus('${escapeHtml(cleanId)}')" style="margin-top: 4px;">
              Check Extension Status
            </button>
          </div>
        `;
      }

      let root = document.getElementById('drawer-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'drawer-root';
        document.body.appendChild(root);
      }

      const activePluginNavItem = (state.pluginNavItems || []).find(
        p => p.id === cleanId || (cleanId === 's3' && p.id === 's3-storage') || (cleanId === 'resend' && p.id === 'resend-email')
      );
      const isUnconfigured = activePluginNavItem && (activePluginNavItem.badge === 'UNCONFIGURED' || activePluginNavItem.badgeVariant === 'warning');
      const statusBadgeHtml = isUnconfigured
        ? `<span class="badge badge-warning" style="font-size: 10px; background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);">● UNCONFIGURED</span>`
        : `<span class="badge badge-success" style="font-size: 10px;">● ACTIVE</span>`;

      root.innerHTML = `
        <div id="plugin-drawer-backdrop" class="drawer-backdrop" onclick="closePluginTesterDrawer()" aria-hidden="true"></div>
        <aside id="plugin-drawer-panel" class="record-drawer plugin-drawer" role="dialog" aria-modal="true" aria-labelledby="plugin-drawer-title" tabindex="-1">
          <div class="drawer-header">
            <div class="drawer-title-area">
              <span style="font-size: 1.2rem; display: inline-flex; align-items: center;">${icon}</span>
              <div>
                <h2 id="plugin-drawer-title" class="drawer-title" style="margin:0; font-size:1.05rem;">
                  Test ${escapeHtml(title)}
                </h2>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 1px;">
                  Interactive In-Context Developer Tester
                </div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              ${statusBadgeHtml}
              <button class="btn btn-secondary btn-sm" id="plugin-drawer-close-btn" onclick="closePluginTesterDrawer()" title="Close drawer (Esc)" aria-label="Close drawer">✕</button>
            </div>
          </div>

          <div class="drawer-quick-actions">
            ${relatedCol ? `
              <button class="btn btn-secondary btn-sm" onclick="selectCollection('${escapeHtml(relatedCol)}'); closePluginTesterDrawer();" style="font-size: 11.5px;">
                View <code>${escapeHtml(relatedCol)}</code> Table ↗
              </button>
            ` : ''}
            <button class="btn btn-secondary btn-sm" onclick="checkPluginTesterStatus('${escapeHtml(cleanId)}')" style="font-size: 11.5px;">
              Check Status
            </button>
            <button class="btn btn-secondary btn-sm" onclick="clearPluginTesterOutput()" style="font-size: 11.5px; margin-left: auto;">
              Clear Output
            </button>
          </div>

          <div class="drawer-body">
            <div class="plugin-disclaimer-banner" style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 0.85rem; font-size: 11.5px; line-height: 1.45; color: #fcd34d;">
              <div style="font-weight: 700; display: flex; align-items: center; gap: 5px; margin-bottom: 2px; color: #fbbf24;">
                <span>⚠️</span> <span>External Service Disclaimer</span>
              </div>
              <div style="color: #cbd5e1; font-size: 11px;">
                Actions executed here communicate directly with your configured external service provider. Live operations, resource usage, or data changes may occur. You are solely responsible for all actions triggered and any external fees or modifications incurred.
              </div>
            </div>

            ${formHtml}

            <div class="drawer-section-title" style="margin-top: 1rem; display: flex; align-items: center; justify-content: space-between;">
              <span>Live Response Payload</span>
              <span id="plugin-tester-latency" style="font-family: var(--font-mono); font-size: 10px; color: var(--text-muted);">--</span>
            </div>
            <div class="drawer-json-container">
              <div class="drawer-json-bar">
                <span id="plugin-tester-status-badge" style="font-weight: 700; color: var(--text-muted);">Status: Ready</span>
                <button class="btn btn-secondary btn-sm" style="padding: 2px 7px; font-size: 10.5px;" onclick="copyPluginTesterOutput()">Copy</button>
              </div>
              <pre class="drawer-json-pre"><code id="plugin-tester-output">// Run an action above to inspect live responses...</code></pre>
            </div>
          </div>
        </aside>
      `;

      const triggerDrawerOpen = () => {
        const backdrop = document.getElementById('plugin-drawer-backdrop');
        const panel = document.getElementById('plugin-drawer-panel');
        if (backdrop) backdrop.classList.add('open');
        if (panel) {
          panel.classList.add('open');
          if (typeof panel.focus === 'function') panel.focus();
        }
      };

      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(triggerDrawerOpen);
      } else {
        setTimeout(triggerDrawerOpen, 16);
      }
    }

    function closePluginTesterDrawer() {
      const backdrop = document.getElementById('plugin-drawer-backdrop');
      const panel = document.getElementById('plugin-drawer-panel');
      if (backdrop) backdrop.classList.remove('open');
      if (panel) panel.classList.remove('open');
      setTimeout(() => {
        const root = document.getElementById('drawer-root');
        if (root && root.querySelector('#plugin-drawer-panel')) {
          root.innerHTML = '';
        }
      }, 250);
    }

    async function executePluginTest(actionFn) {
      const badge = document.getElementById('plugin-tester-status-badge');
      const latency = document.getElementById('plugin-tester-latency');
      const output = document.getElementById('plugin-tester-output');
      if (badge) {
        badge.textContent = 'Status: Executing...';
        badge.style.color = '#60a5fa';
      }
      if (output) output.textContent = '// Sending request...';
      const start = performance.now();
      try {
        const data = await actionFn();
        const duration = Math.round(performance.now() - start);
        if (latency) latency.textContent = `${duration}ms`;
        if (badge) {
          badge.textContent = 'Status: 200 OK';
          badge.style.color = '#34d399';
        }
        if (output) output.textContent = JSON.stringify(data, null, 2);
        toast('Action completed successfully!', 'success');
      } catch (err) {
        const duration = Math.round(performance.now() - start);
        if (latency) latency.textContent = `${duration}ms`;
        if (badge) {
          badge.textContent = `Status: ${err.status ? err.status + ' Error' : 'Error'}`;
          badge.style.color = '#ef4444';
        }
        const errPayload = err.data || { error: err.message };
        if (output) output.textContent = JSON.stringify(errPayload, null, 2);
        toast(err.message || 'Action failed', 'danger');
      }
    }

    function checkPluginTesterStatus(pluginId) {
      const cleanId = String(pluginId || '').replace(/^nav-/, '').toLowerCase();
      const endpoints = {
        stripe: '/api/stripe/status',
        s3: '/api/s3/status',
        's3-storage': '/api/s3/status',
        resend: '/api/resend/status',
        webhooks: '/api/webhooks/status',
        algolia: '/api/algolia/status',
      };
      const ep = endpoints[cleanId] || `/api/plugins/${encodeURIComponent(cleanId)}/config`;
      return executePluginTest(async () => {
        const res = await api(ep, { skipAuthRedirect: true });
        if ((cleanId === 's3' || cleanId === 's3-storage') && (!res || !res.connected || !res.bucket)) {
          const err = new Error(
            res?.message || 'S3 Cloud Storage is not configured. Please configure your bucket name in extension settings.'
          );
          err.status = res?.statusCode || 400;
          err.data = res;
          throw err;
        }
        if (cleanId === 'algolia' && (!res || res.configured === false || !res.appId)) {
          const err = new Error(
            res?.message || 'Algolia Search is not configured. Please configure your Application ID and Admin API Key in extension settings.'
          );
          err.status = res?.statusCode || 400;
          err.data = res;
          throw err;
        }
        return res;
      });
    }

    function runStripeCheckoutTest() {
      const email = document.getElementById('test-stripe-email')?.value || 'customer@example.com';
      const amount = Number(document.getElementById('test-stripe-amount')?.value || 4900);
      const stripeNavItem = (state.pluginNavItems || []).find(p => p.id === 'stripe');
      const isStripeLive = stripeNavItem && (stripeNavItem.badge === 'LIVE' || stripeNavItem.badgeVariant === 'danger');

      if (isStripeLive && typeof window.confirm === 'function') {
        const confirmed = window.confirm(
          `⚠️ WARNING: LIVE STRIPE CREDENTIALS DETECTED!\n\nYou are in LIVE Production Mode. This test will create a real Stripe checkout session for $${(amount / 100).toFixed(2)} USD.\n\nAre you sure you want to proceed?`
        );
        if (!confirmed) {
          toast('Checkout session creation canceled', 'info');
          return Promise.resolve();
        }
      }

      return executePluginTest(() => api('/api/stripe/checkout-session', {
        method: 'POST',
        body: JSON.stringify({ email, amount }),
        skipAuthRedirect: true,
      }));
    }

    function runStripeWebhookSimulation() {
      const type = document.getElementById('test-stripe-event-type')?.value || 'payment_intent.succeeded';
      return executePluginTest(() => api('/api/stripe/webhook', {
        method: 'POST',
        body: JSON.stringify({
          type,
          data: {
            object: {
              id: 'pi_mock_' + Math.random().toString(36).substring(2, 9),
              amount: 4900,
              currency: 'usd',
              status: 'succeeded'
            }
          }
        }),
        skipAuthRedirect: true,
      }));
    }

    function runS3PresignedUrlTest() {
      const filename = document.getElementById('test-s3-key')?.value || 'uploads/avatar-demo.png';
      const mimeType = document.getElementById('test-s3-mimetype')?.value || 'image/png';
      return executePluginTest(() => api('/api/s3/sign-upload-url', {
        method: 'POST',
        body: JSON.stringify({ filename, mimeType }),
        skipAuthRedirect: true,
      }));
    }

    function runS3StatusTest() {
      return executePluginTest(async () => {
        const res = await api('/api/s3/status', { skipAuthRedirect: true });
        if (!res || !res.connected || !res.bucket) {
          const err = new Error(
            res?.message || 'S3 Cloud Storage is not configured. Please configure your bucket name in extension settings.'
          );
          err.status = res?.statusCode || 400;
          err.data = res;
          throw err;
        }
        return res;
      });
    }

    function runResendSendTest() {
      const to = document.getElementById('test-resend-to')?.value || 'developer@example.com';
      const subject = document.getElementById('test-resend-subject')?.value || 'NodeStack Notification';
      const body = document.getElementById('test-resend-body')?.value || 'Test message';
      return executePluginTest(() => api('/api/resend/send', {
        method: 'POST',
        body: JSON.stringify({
          to,
          subject,
          html: `<p>${escapeHtml(body)}</p>`,
          text: body
        }),
        skipAuthRedirect: true,
      }));
    }

    function runWebhookDispatchTest() {
      const platform = document.getElementById('test-webhook-platform')?.value || 'discord';
      const message = document.getElementById('test-webhook-message')?.value || 'Test webhook message';
      return executePluginTest(() => api('/api/webhooks/test', {
        method: 'POST',
        body: JSON.stringify({
          platform,
          payload: { message }
        }),
        skipAuthRedirect: true,
      }));
    }

    function runAlgoliaReindexTest() {
      const collection = document.getElementById('test-algolia-col')?.value;
      if (!collection) {
        toast('Please select a collection to reindex', 'warning');
        return Promise.resolve();
      }
      return executePluginTest(() => api('/api/algolia/reindex', {
        method: 'POST',
        body: JSON.stringify({ collection }),
        skipAuthRedirect: true,
      }));
    }

    function runAlgoliaProcessQueueTest() {
      return executePluginTest(() => api('/api/algolia/process-queue', {
        method: 'POST',
        skipAuthRedirect: true,
      }));
    }

    function copyPluginTesterOutput() {
      const output = document.getElementById('plugin-tester-output');
      if (output && navigator.clipboard) {
        navigator.clipboard.writeText(output.textContent || '');
        toast('Payload copied to clipboard!', 'info');
      }
    }

    function clearPluginTesterOutput() {
      const output = document.getElementById('plugin-tester-output');
      const badge = document.getElementById('plugin-tester-status-badge');
      const latency = document.getElementById('plugin-tester-latency');
      if (output) output.textContent = '// Ready';
      if (badge) {
        badge.textContent = 'Status: Ready';
        badge.style.color = 'var(--text-muted)';
      }
      if (latency) latency.textContent = '--';
    }

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
    async function selectCollection(name) {
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
          icon: '📥',
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
          icon: '📥',
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
            <div class="command-palette-item-icon" aria-hidden="true">${item.icon || '▶'}</div>
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
      window.openPluginTesterDrawer = openPluginTesterDrawer;
      window.closePluginTesterDrawer = closePluginTesterDrawer;
      window.executePluginTest = executePluginTest;
      window.checkPluginTesterStatus = checkPluginTesterStatus;
      window.runStripeCheckoutTest = runStripeCheckoutTest;
      window.runStripeWebhookSimulation = runStripeWebhookSimulation;
      window.runS3PresignedUrlTest = runS3PresignedUrlTest;
      window.runS3StatusTest = runS3StatusTest;
      window.runResendSendTest = runResendSendTest;
      window.runWebhookDispatchTest = runWebhookDispatchTest;
      window.runAlgoliaReindexTest = runAlgoliaReindexTest;
      window.runAlgoliaProcessQueueTest = runAlgoliaProcessQueueTest;
    }

// Run on startup
window.addEventListener('DOMContentLoaded', init);
