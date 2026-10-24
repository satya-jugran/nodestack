// Plugins Hub, Extensions Management & Configuration

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

  const homePlugEl = document.getElementById('home-stat-plugins');
  const homePlugSubEl = document.getElementById('home-stat-plugins-sub');
  if (homePlugEl) {
    homePlugEl.textContent = String(items.length);
  }
  if (homePlugSubEl) {
    const catalogCount = (state.pluginCatalog && state.pluginCatalog.length) || 5;
    homePlugSubEl.textContent = `${items.length} active / ${catalogCount} available`;
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
    <div id="plugin-overview-card-${escapeHtml(item.id)}" style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 40px; height: 40px; border-radius: 10px; background: #0c0e14; border: 1px solid rgba(59, 130, 246, 0.4); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <span style="font-size: 20px;">🧩</span>
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span id="plugin-overview-title-${escapeHtml(item.id)}" style="font-weight: 800; font-size: 16px; color: #fff;">${escapeHtml(title)}</span>
              <span id="plugin-overview-badge-${escapeHtml(item.id)}">${item.badge ? `<span class="badge ${item.badgeVariant ? 'badge-' + item.badgeVariant : 'badge-get'}">${escapeHtml(item.badge)}</span>` : ''}</span>
            </div>
            <div id="plugin-overview-desc-${escapeHtml(item.id)}" style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              ${escapeHtml(desc)}
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <button class="btn btn-primary btn-sm" onclick="openPluginTesterDrawer('${escapeHtml(item.id)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:4px;"><path d="M10 2v7.31L4.69 18.59A2 2 0 0 0 6.41 22h11.18a2 2 0 0 0 1.72-3.41L14 9.31V2"/><line x1="8.5" y1="2" x2="15.5" y2="2"/><line x1="14" y1="9.3" x2="10" y2="9.3"/></svg>Test Plugin</button>
          <button class="btn btn-secondary btn-sm" onclick="selectNav('plugins')">Back to Plugins</button>
        </div>
      </div>
      
      <div id="plugin-overview-body-${escapeHtml(item.id)}">
        ${bodyContent}
      </div>
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

function syncPluginOverview(pluginId, fields) {
  if (!fields || !Array.isArray(fields)) return;
  const descEl = document.getElementById('plugin-overview-desc-' + pluginId);
  const badgeEl = document.getElementById('plugin-overview-badge-' + pluginId);
  const bodyEl = document.getElementById('plugin-overview-body-' + pluginId);
  const topBadgeEl = document.getElementById('view-badge');

  if (pluginId === 's3' || pluginId === 's3-storage') {
    const bucketField = fields.find(f => f.name === 'bucket');
    const regionField = fields.find(f => f.name === 'region');
    const curBucket = bucketField?.value || '';
    const curRegion = regionField?.value || 'us-east-1';
    const isConfigured = Boolean(curBucket && String(curBucket).trim() !== '');

    if (descEl) {
      descEl.textContent = isConfigured
        ? `Connected to bucket "${curBucket}" in region ${curRegion}`
        : `Unconfigured — No S3 bucket specified (Default Region: ${curRegion})`;
    }
    const badgeText = isConfigured ? String(curRegion).toUpperCase() : 'UNCONFIGURED';
    const badgeClass = isConfigured ? 'badge-info' : 'badge-warning';
    if (badgeEl) {
      badgeEl.innerHTML = `<span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span>`;
    }
    if (topBadgeEl) {
      topBadgeEl.textContent = badgeText;
      topBadgeEl.className = 'badge ' + badgeClass;
    }
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem;">
          <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Bucket Name</div>
            <div style="font-size: 13px; font-weight: 700; color: ${isConfigured ? '#60a5fa' : '#f59e0b'}; font-family: monospace; margin-top: 4px;">${escapeHtml(curBucket || '(Not Configured)')}</div>
          </div>
          <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Region</div>
            <div style="font-size: 13px; font-weight: 700; color: #34d399; font-family: monospace; margin-top: 4px;">${escapeHtml(curRegion)}</div>
          </div>
          <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Tracking Collection</div>
            <div style="font-size: 13px; font-weight: 700; color: #eab308; font-family: monospace; margin-top: 4px;">_s3_uploads</div>
          </div>
        </div>
      `;
    }
  } else if (pluginId === 'stripe') {
    const secKeyField = fields.find(f => f.name === 'secretKey');
    const dryRunField = fields.find(f => f.name === 'dryRun');
    const hasSecret = Boolean(secKeyField?.hasValue || (secKeyField?.value && String(secKeyField.value).trim()));
    const isConfigured = hasSecret || Boolean(dryRunField?.value);
    const isLive = Boolean(secKeyField?.value && String(secKeyField.value).startsWith('sk_live_'));

    const badgeText = !isConfigured ? 'UNCONFIGURED' : isLive ? 'LIVE' : 'TEST MODE';
    const badgeClass = !isConfigured ? 'badge-warning' : isLive ? 'badge-danger' : 'badge-warning';
    if (badgeEl) badgeEl.innerHTML = `<span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span>`;
    if (topBadgeEl) {
      topBadgeEl.textContent = badgeText;
      topBadgeEl.className = 'badge ' + badgeClass;
    }
    if (descEl) {
      descEl.textContent = !isConfigured
        ? 'Unconfigured — Stripe Secret Key (sk_test_... or sk_live_...) required.'
        : `Configured in ${isLive ? 'Live Mode' : 'Test Mode'} with collections _stripe_customers & _stripe_payments.`;
    }
  } else if (pluginId === 'resend') {
    const apiKeyField = fields.find(f => f.name === 'apiKey');
    const dryRunField = fields.find(f => f.name === 'dryRun');
    const fromField = fields.find(f => f.name === 'from');
    const isConfigured = Boolean(apiKeyField?.hasValue || apiKeyField?.value || dryRunField?.value);
    const fromAddr = fromField?.value || 'noreply@nodestack.io';

    const badgeText = isConfigured ? 'ACTIVE' : 'UNCONFIGURED';
    const badgeClass = isConfigured ? 'badge-success' : 'badge-warning';
    if (badgeEl) badgeEl.innerHTML = `<span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span>`;
    if (topBadgeEl) {
      topBadgeEl.textContent = badgeText;
      topBadgeEl.className = 'badge ' + badgeClass;
    }
    if (descEl) {
      descEl.textContent = isConfigured
        ? `Configured with default sender "${fromAddr}"`
        : 'Unconfigured — Resend API Key required';
    }
  } else if (pluginId === 'algolia') {
    const appIdField = fields.find(f => f.name === 'appId');
    const apiKeyField = fields.find(f => f.name === 'apiKey');
    const curAppId = appIdField?.value || '';
    const isConfigured = Boolean((appIdField?.hasValue || curAppId) && (apiKeyField?.hasValue || apiKeyField?.value));

    const badgeText = isConfigured ? 'ACTIVE' : 'UNCONFIGURED';
    const badgeClass = isConfigured ? 'badge-success' : 'badge-warning';
    if (badgeEl) badgeEl.innerHTML = `<span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span>`;
    if (topBadgeEl) {
      topBadgeEl.textContent = badgeText;
      topBadgeEl.className = 'badge ' + badgeClass;
    }
    if (descEl) {
      descEl.textContent = isConfigured
        ? `Syncing collections with Algolia application "${curAppId}"`
        : 'Unconfigured — Algolia Application ID and Admin API Key required.';
    }
  }
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

    // Sync overview card with active app config
    syncPluginOverview(pluginId, res.fields);

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
        if (activeItem && state.activeNav === pluginId && typeof renderPluginView === 'function') {
          renderPluginView(activeItem);
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
          <a href="/_/docs" target="_blank" onclick="openDocsWithApp(event)" class="btn btn-secondary btn-sm" style="text-decoration:none;">OpenAPI Specs ↗</a>
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

// Expose on window for browser event handlers & tests
if (typeof window !== 'undefined') {
  window.renderPluginNavItems = renderPluginNavItems;
  window.renderPluginView = renderPluginView;
  window.loadPluginConfig = loadPluginConfig;
  window.savePluginConfig = savePluginConfig;
  window.DEFAULT_OFFICIAL_CATALOG = DEFAULT_OFFICIAL_CATALOG;
  window.enablePlugin = enablePlugin;
  window.disablePlugin = disablePlugin;
  window.renderPluginsHubView = renderPluginsHubView;
}
