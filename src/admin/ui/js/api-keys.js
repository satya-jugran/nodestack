// ==========================================
// API Keys & Visual Scope Matrix Management
// ==========================================

const apiKeysState = {
  keys: [],
  functions: [],
  flows: [],
  queues: [],
  isLoading: false,
  editingKeyId: null,
  lastFocusedElement: null,
};

function setAppShellInert(isInert) {
  if (typeof document === 'undefined') return;
  const appRoot = document.getElementById('app');
  if (!appRoot) return;
  try {
    if (isInert) {
      appRoot.setAttribute('inert', '');
    } else {
      appRoot.removeAttribute('inert');
    }
  } catch (_) {}
}

function updateSidebarApiKeysBadge(keysList) {
  if (typeof document === 'undefined') return;
  const badge = document.getElementById('sidebar-api-keys-count');
  if (!badge) return;
  const list = Array.isArray(keysList) ? keysList : apiKeysState.keys;
  const activeCount = list.filter(k => k.status === 'active').length;
  badge.textContent = String(activeCount);
  badge.style.display = activeCount > 0 ? 'inline-block' : 'none';
}

function getApiKeysApiPrefix() {
  const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : (typeof state !== 'undefined' && state?.activeApp?.slug) || 'default';
  return slug && slug !== 'default' ? `/api/apps/${encodeURIComponent(slug)}/api-keys` : '/api/api-keys';
}

async function loadApiKeys() {
  apiKeysState.isLoading = true;
  if (state.activeNav === 'api-keys') {
    renderApiKeysView();
  }
  try {
    const res = await api(getApiKeysApiPrefix());
    apiKeysState.keys = Array.isArray(res) ? res : (res?.items || []);
    updateSidebarApiKeysBadge(apiKeysState.keys);
  } catch (err) {
    apiKeysState.keys = [];
    if (state.activeNav === 'api-keys' && typeof toast === 'function') {
      toast('Failed to load API keys: ' + (err.message || err), 'error');
    }
  } finally {
    apiKeysState.isLoading = false;
    if (state.activeNav === 'api-keys') {
      renderApiKeysView();
    }
  }
}

function formatApiKeyDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return escapeHtml(String(iso));
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderScopeChipsHtml(key) {
  if (key.role === 'admin' || (Array.isArray(key.scopes) && (key.scopes.includes('*') || key.scopes.includes('admin:*')))) {
    return '<span class="badge badge-danger" style="font-size: 10.5px;">Full Admin (*)</span>';
  }
  const scopes = Array.isArray(key.scopes) ? key.scopes : [];
  if (scopes.length === 0) {
    return '<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">No scopes assigned</span>';
  }
  const visible = scopes.slice(0, 4);
  const extra = scopes.length - visible.length;
  return `
    <div style="display: flex; flex-wrap: wrap; gap: 4px; max-width: 320px;">
      ${visible.map(s => `<code style="font-size: 10.5px; padding: 1px 6px; border-radius: 4px; background: var(--bg-card-hover); border: 1px solid var(--border-subtle); color: var(--text-main);">${escapeHtml(s)}</code>`).join('')}
      ${extra > 0 ? `<span class="badge badge-primary" style="font-size: 10px;">+${extra} more</span>` : ''}
    </div>
  `;
}

function renderApiKeysView() {
  const container = document.getElementById('page-view-api-keys');
  if (!container) return;

  const keys = apiKeysState.keys || [];
  const activeCount = keys.filter(k => k.status === 'active').length;
  const scopedCount = keys.filter(k => k.status === 'active' && k.role !== 'admin' && !(k.scopes || []).includes('*')).length;
  const adminCount = keys.filter(k => k.status === 'active' && (k.role === 'admin' || (k.scopes || []).includes('*'))).length;
  const totalRequests = keys.reduce((sum, k) => sum + Number(k.totalRequests || 0), 0);

  const activeAppLabel = (typeof state !== 'undefined' && state.activeApp)
    ? `${state.activeApp.name || 'Default App'} (${state.activeApp.slug || 'default'})`
    : 'Default App (default)';

  container.innerHTML = `
    <div class="webhooks-container" style="max-width: 1400px; margin: 0 auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem;">
      <!-- Header -->
      <div class="webhooks-header">
        <div class="webhooks-title-area">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
            API Keys
          </h2>
          <p>
            Provision scoped machine-to-machine credentials for <strong style="color: var(--accent-primary); font-family: var(--font-mono);">${escapeHtml(activeAppLabel)}</strong> across Collections, Functions, Flows, and Queues.
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="loadApiKeys()" aria-label="Refresh API keys list" title="Refresh API keys">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
          <button type="button" id="btn-create-api-key" class="btn btn-primary btn-sm" onclick="openApiKeyDrawer()" style="font-weight: 600;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create API Key
          </button>
        </div>
      </div>

      <!-- Summary Metric Cards -->
      <div class="webhooks-stats-grid" id="api-keys-stats-grid">
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Active Keys</span>
          <div class="webhook-stat-value">${activeCount}</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Scoped Service Keys</span>
          <div class="webhook-stat-value" style="color: var(--accent-primary);">${scopedCount}</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Full Admin Keys</span>
          <div class="webhook-stat-value" style="color: ${adminCount > 0 ? 'var(--accent-danger)' : 'var(--text-heading)'};">${adminCount}</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Total Requests</span>
          <div class="webhook-stat-value">${totalRequests}</div>
        </div>
      </div>

      <!-- Main Content / Table Region -->
      ${apiKeysState.isLoading && keys.length === 0 ? `
        <div style="padding: 4rem 2rem; text-align: center; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; color: var(--text-muted); font-size: 13px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <span class="spinner" style="margin-right: 8px; display: inline-block;"></span> Loading API keys...
        </div>
      ` : keys.length === 0 ? `
        <div style="text-align: center; padding: 4rem 2rem; background: var(--bg-card); border: 1px dashed var(--border-subtle); border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div style="display: flex; justify-content: center; margin-bottom: 0.75rem;" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted);"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          </div>
          <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--text-heading); margin: 0 0 0.5rem 0;">No API Keys Configured</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); max-width: 480px; margin: 0 auto 1.5rem auto; line-height: 1.5;">
            Create a scoped API key to grant microservices least-privilege access to specific collections, functions, queues, or HTTP flows without sharing superuser credentials.
          </p>
          <button type="button" class="btn btn-primary btn-sm" onclick="openApiKeyDrawer()" style="font-weight: 600;">+ Create First API Key</button>
        </div>
      ` : `
        <div class="webhook-table-wrapper" style="box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow-x: auto; width: 100%;">
          <table class="webhook-table" style="min-width: 1100px; width: 100%; border-collapse: collapse;">
            <caption id="api-keys-table-caption" class="visually-hidden">Configured API keys and access scopes</caption>
            <thead>
              <tr>
                <th scope="col" style="min-width: 200px; width: 20%;">Name &amp; Description</th>
                <th scope="col" style="min-width: 140px; width: 14%;">Key Prefix</th>
                <th scope="col" style="min-width: 250px; width: 24%;">Permissions / Scopes</th>
                <th scope="col" style="min-width: 130px; width: 12%;">Status &amp; Usage</th>
                <th scope="col" style="min-width: 320px; width: 30%; text-align: right; white-space: nowrap; padding-right: 16px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${keys.map(key => {
                const isActive = key.status === 'active';
                const statusBadge = isActive
                  ? '<span class="badge badge-success" style="font-size: 10.5px;">Active</span>'
                  : (key.status === 'revoked'
                    ? '<span class="badge badge-danger" style="font-size: 10.5px;">Revoked</span>'
                    : '<span class="badge badge-warning" style="font-size: 10.5px;">Expired</span>');
                const safeName = escapeHtml(key.name || 'Unnamed Key');
                return `
                  <tr>
                    <td>
                      <div style="font-weight: 600; color: var(--text-heading); word-break: break-word;">${safeName}</div>
                      ${key.description ? `<div style="font-size: 11px; font-weight: 400; color: var(--text-muted); margin-top: 2px;">${escapeHtml(key.description)}</div>` : ''}
                      ${Array.isArray(key.allowedIps) && key.allowedIps.length > 0 ? `<div style="font-size: 10.5px; font-weight: 400; color: var(--text-muted); margin-top: 3px;">IPs: <code>${escapeHtml(key.allowedIps.join(', '))}</code></div>` : ''}
                    </td>
                    <td>
                      <code style="font-size: 11.5px; background: var(--bg-input); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-subtle);">${escapeHtml(key.redactedKey || (key.keyPrefix + '...'))}</code>
                      <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 4px;">
                        Expires: ${key.expiresAt ? formatApiKeyDate(key.expiresAt) : 'Never'}
                      </div>
                    </td>
                    <td>
                      ${renderScopeChipsHtml(key)}
                    </td>
                    <td>
                      <div>${statusBadge}</div>
                      <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${Number(key.totalRequests || 0)} requests</div>
                      <div style="font-size: 10.5px; color: var(--text-muted);">Last used: ${key.lastUsedAt ? formatApiKeyDate(key.lastUsedAt) : 'Never'}</div>
                    </td>
                    <td style="text-align: right; white-space: nowrap; min-width: 320px; padding-right: 16px;">
                      <div style="display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end;">
                        <button type="button" class="btn btn-secondary btn-sm" data-action="test" data-key-id="${escapeHtml(key.id)}" aria-label="Test permissions for ${safeName}" title="Test permissions">Test</button>
                        <button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-key-id="${escapeHtml(key.id)}" aria-label="Edit scopes for ${safeName}">Edit</button>
                        <button type="button" class="btn btn-secondary btn-sm" data-action="rotate" data-key-id="${escapeHtml(key.id)}" aria-label="Rotate secret for ${safeName}" title="Rotate secret key">Rotate</button>
                        <button type="button" class="btn btn-secondary btn-sm" data-action="toggle-status" data-key-id="${escapeHtml(key.id)}" data-next-status="${isActive ? 'revoked' : 'active'}" aria-label="${isActive ? 'Revoke' : 'Restore'} ${safeName}">
                          ${isActive ? 'Revoke' : 'Restore'}
                        </button>
                        <button type="button" class="btn btn-danger btn-sm" data-action="delete" data-key-id="${escapeHtml(key.id)}" aria-label="Delete ${safeName}" title="Permanently delete key">✕</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  const tableWrapper = container.querySelector('.webhook-table-wrapper');
  if (tableWrapper) {
    tableWrapper.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const keyId = btn.getAttribute('data-key-id');
      if (!keyId) return;

      if (action === 'test') {
        openApiKeyTesterModal(keyId);
      } else if (action === 'edit') {
        openApiKeyDrawer(keyId);
      } else if (action === 'rotate') {
        handleRotateApiKey(keyId);
      } else if (action === 'toggle-status') {
        const nextStatus = btn.getAttribute('data-next-status') || 'revoked';
        handleToggleApiKeyStatus(keyId, nextStatus);
      } else if (action === 'delete') {
        handleDeleteApiKey(keyId);
      }
    });
  }
}

function handleApiKeyDrawerKeyDown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    closeApiKeyDrawer();
  }
}

async function openApiKeyDrawer(keyId = null) {
  apiKeysState.editingKeyId = keyId;
  apiKeysState.lastFocusedElement = typeof document !== 'undefined' ? document.activeElement : null;

  // Fetch subsystem resources for active app so scope checkboxes stay up-to-date
  const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : (typeof state !== 'undefined' && state?.activeApp?.slug) || 'default';
  const fnEndpoint = slug && slug !== 'default' ? `/api/apps/${encodeURIComponent(slug)}/functions` : '/api/functions';
  const flowEndpoint = slug && slug !== 'default' ? `/api/apps/${encodeURIComponent(slug)}/flows` : '/api/flows';
  const queueEndpoint = slug && slug !== 'default' ? `/api/apps/${encodeURIComponent(slug)}/queues` : '/api/queues';

  const [fnRes, flowRes, queueRes] = await Promise.allSettled([
    api(fnEndpoint),
    api(flowEndpoint),
    api(queueEndpoint),
  ]);
  apiKeysState.functions = fnRes.status === 'fulfilled' && Array.isArray(fnRes.value) ? fnRes.value : (fnRes.status === 'fulfilled' && fnRes.value?.items ? fnRes.value.items : []);
  apiKeysState.flows = flowRes.status === 'fulfilled' && Array.isArray(flowRes.value) ? flowRes.value : (flowRes.status === 'fulfilled' && flowRes.value?.items ? flowRes.value.items : []);
  const rawQueues = queueRes.status === 'fulfilled' && Array.isArray(queueRes.value) ? queueRes.value : (queueRes.status === 'fulfilled' && queueRes.value?.items ? queueRes.value.items : []);
  apiKeysState.queues = rawQueues.filter(q => q && q.name && !String(q.name).startsWith('_system:') && !q.isSystem);

  const existing = keyId ? (apiKeysState.keys || []).find(k => k.id === keyId) : null;
  const isEdit = Boolean(existing);
  const existingScopes = new Set(Array.isArray(existing?.scopes) ? existing.scopes.map(s => String(s).trim()) : []);
  const isAdminTier = Boolean(existing && (existing.role === 'admin' || existingScopes.has('*') || existingScopes.has('admin:*')));

  const collections = (typeof state !== 'undefined' && Array.isArray(state.collections) ? state.collections : [])
    .filter(c => c && c.name && !c.system && !String(c.name).startsWith('_'));
  const httpFlows = (apiKeysState.flows || []).filter(f => !f.triggerType || f.triggerType === 'http');

  // Identify known matrix scopes so unknown manual scopes stay preserved in Raw Extras
  const knownMatrixScopes = new Set([
    '*', 'admin:*', '*:read', '*:write',
    'functions:invoke', 'functions:execute', 'functions:*',
    'flows:execute', 'flows:invoke', 'flows:*',
    'queues:send', 'queues:read', 'queues:delete', 'queues:*',
  ]);
  for (const col of collections) {
    knownMatrixScopes.add(`${col.name}:read`);
    knownMatrixScopes.add(`${col.name}:write`);
  }
  for (const fn of apiKeysState.functions) {
    knownMatrixScopes.add(`functions:${fn.name}`);
  }
  for (const fl of httpFlows) {
    knownMatrixScopes.add(`flows:${fl.name}`);
  }
  for (const q of apiKeysState.queues) {
    knownMatrixScopes.add(`queues:${q.name}:send`);
    knownMatrixScopes.add(`queues:${q.name}:read`);
    knownMatrixScopes.add(`queues:${q.name}:delete`);
  }

  const extraScopes = Array.from(existingScopes).filter(s => !knownMatrixScopes.has(s));

  let root = document.getElementById('drawer-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'drawer-root';
    document.body.appendChild(root);
  }

  root.innerHTML = `
    <div id="apikey-drawer-backdrop" class="drawer-backdrop open" onclick="if(event.target===this)closeApiKeyDrawer()"></div>
    <aside
      id="apikey-drawer-panel"
      class="record-drawer webhook-drawer open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="apikey-drawer-title"
      tabindex="-1"
      style="width: 640px; max-width: 96vw;"
    >
      <div class="drawer-header">
        <div class="drawer-title-area" style="display: flex; align-items: center; gap: 8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary);"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          <h2 id="apikey-drawer-title" class="drawer-title" style="margin: 0;">${isEdit ? 'Edit API Key Scopes' : 'Create Scoped API Key'}</h2>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeApiKeyDrawer()" aria-label="Close drawer">✕</button>
      </div>

      <form id="api-key-form" onsubmit="handleSaveApiKey(event)" style="display: flex; flex-direction: column; flex: 1; min-height: 0;">
        <div class="drawer-body" style="flex: 1; overflow-y: auto;">
          <!-- General Details -->
          <div class="drawer-card">
            <div class="form-group" style="margin: 0;">
              <label class="form-label" for="apikey-name-input">Key Name <span aria-hidden="true">*</span></label>
              <input
                type="text"
                id="apikey-name-input"
                name="name"
                class="form-input"
                value="${escapeHtml(existing?.name || '')}"
                placeholder="e.g. billing-worker-service"
                required
                autocorrect="off"
                autocapitalize="none"
                spellcheck="false"
              />
            </div>

            <div class="form-group" style="margin: 0;">
              <label class="form-label" for="apikey-desc-input">Description</label>
              <input
                type="text"
                id="apikey-desc-input"
                name="description"
                class="form-input"
                value="${escapeHtml(existing?.description || '')}"
                placeholder="What microservice or automation uses this key?"
              />
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
              ${!isEdit ? `
                <div class="form-group" style="margin: 0;">
                  <label class="form-label" for="apikey-expiry-select">Expiration</label>
                  <select id="apikey-expiry-select" name="expiresInDays" class="form-select">
                    <option value="">Never expires</option>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">365 days</option>
                  </select>
                </div>
              ` : `
                <div class="form-group" style="margin: 0;">
                  <label class="form-label" for="apikey-prefix-readonly">Key Prefix</label>
                  <input type="text" id="apikey-prefix-readonly" class="form-input" value="${escapeHtml(existing?.redactedKey || '')}" readonly style="opacity: 0.75; font-family: monospace;" />
                </div>
              `}
              <div class="form-group" style="margin: 0;">
                <label class="form-label" for="apikey-ips-input">Allowed IPs (Optional)</label>
                <input
                  type="text"
                  id="apikey-ips-input"
                  name="allowedIps"
                  class="form-input"
                  value="${escapeHtml(Array.isArray(existing?.allowedIps) ? existing.allowedIps.join(', ') : '')}"
                  placeholder="e.g. 10.0.0.1, 192.168.1.50"
                  aria-describedby="apikey-ips-help"
                  autocorrect="off"
                  autocapitalize="none"
                  spellcheck="false"
                />
                <span id="apikey-ips-help" style="font-size: 10.5px; color: var(--text-muted);">Comma-separated IPv4/IPv6 addresses. Leave blank for any IP.</span>
              </div>
            </div>
          </div>

          <!-- Access Tier Selector -->
          <fieldset class="drawer-card" style="border: 1px solid var(--border-subtle); margin: 0;">
            <legend style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); padding: 0 6px;">Access Tier</legend>
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
              <label for="apikey-tier-service" style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer;">
                <input type="radio" id="apikey-tier-service" name="keyTier" value="service" ${!isAdminTier ? 'checked' : ''} onchange="toggleApiKeyTier('service')" style="margin-top: 3px;">
                <div>
                  <strong style="font-size: 13px; color: var(--text-heading);">Scoped Service Key (Recommended)</strong>
                  <div style="font-size: 11.5px; color: var(--text-muted);">Least-privilege access: select only the exact Collections, Functions, Flows, and Queues needed.</div>
                </div>
              </label>

              <label for="apikey-tier-admin" style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer;">
                <input type="radio" id="apikey-tier-admin" name="keyTier" value="admin" ${isAdminTier ? 'checked' : ''} onchange="toggleApiKeyTier('admin')" style="margin-top: 3px;">
                <div>
                  <strong style="font-size: 13px; color: #ef4444;">Full Admin Key (<code>*</code>)</strong>
                  <div style="font-size: 11.5px; color: var(--text-muted);">Grants unrestricted super-admin access and bypasses collection rules.</div>
                </div>
              </label>
            </div>
          </fieldset>

          <div id="apikey-admin-warning" style="display: ${isAdminTier ? 'block' : 'none'}; padding: 0.85rem 1rem; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.08); font-size: 12px; color: #ef4444;">
            <strong>Caution:</strong> A Full Admin Key grants total administrative authority over schemas, queues, snapshots, and all records in this application.
          </div>

          <!-- 4-Subsystem Scope Matrix -->
          <div id="apikey-scope-matrix" style="display: ${isAdminTier ? 'none' : 'flex'}; flex-direction: column; gap: 1rem;">
            <!-- 1. Collections -->
            <fieldset class="drawer-card" style="border: 1px solid var(--border-subtle); margin: 0;">
              <legend style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); padding: 0 6px;">Collections Scopes</legend>
              <div style="display: flex; gap: 1rem; flex-wrap: wrap; padding-bottom: 6px; border-bottom: 1px solid var(--border-subtle);">
                <label for="scope-col-all-read" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer;">
                  <input type="checkbox" id="scope-col-all-read" class="apikey-scope-cb" data-scope-group="col-read" data-scope-role="all" onchange="syncApiKeyScopeExclusions('col-read')" value="*:read" ${existingScopes.has('*:read') ? 'checked' : ''}>
                  <span>All Collections Read (<code>*:read</code>)</span>
                </label>
                <label for="scope-col-all-write" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer;">
                  <input type="checkbox" id="scope-col-all-write" class="apikey-scope-cb" data-scope-group="col-write" data-scope-role="all" onchange="syncApiKeyScopeExclusions('col-write')" value="*:write" ${existingScopes.has('*:write') ? 'checked' : ''}>
                  <span>All Collections Write (<code>*:write</code>)</span>
                </label>
              </div>
              ${collections.length === 0 ? '<div style="font-size: 11.5px; color: var(--text-muted);">No user collections available.</div>' : `
                <div style="display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto;">
                  ${collections.map((c, idx) => `
                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; padding: 3px 0;">
                      <code style="color: var(--text-heading); font-weight: 600;">${escapeHtml(c.name)}</code>
                      <div style="display: flex; gap: 12px;">
                        <label for="scope-col-r-${idx}" style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                          <input type="checkbox" id="scope-col-r-${idx}" class="apikey-scope-cb" data-scope-group="col-read" data-scope-role="specific" onchange="syncApiKeyScopeExclusions('col-read')" value="${escapeHtml(c.name)}:read" ${existingScopes.has(`${c.name}:read`) ? 'checked' : ''}> Read
                        </label>
                        <label for="scope-col-w-${idx}" style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                          <input type="checkbox" id="scope-col-w-${idx}" class="apikey-scope-cb" data-scope-group="col-write" data-scope-role="specific" onchange="syncApiKeyScopeExclusions('col-write')" value="${escapeHtml(c.name)}:write" ${existingScopes.has(`${c.name}:write`) ? 'checked' : ''}> Write
                        </label>
                      </div>
                    </div>
                  `).join('')}
                </div>
              `}
            </fieldset>

            <!-- 2. Functions -->
            <fieldset class="drawer-card" style="border: 1px solid var(--border-subtle); margin: 0;">
              <legend style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); padding: 0 6px;">Serverless Functions Scopes</legend>
              <div style="padding-bottom: 6px; border-bottom: 1px solid var(--border-subtle);">
                <label for="scope-fn-all" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer;">
                  <input type="checkbox" id="scope-fn-all" class="apikey-scope-cb" data-scope-group="fn-invoke" data-scope-role="all" onchange="syncApiKeyScopeExclusions('fn-invoke')" value="functions:invoke" ${existingScopes.has('functions:invoke') || existingScopes.has('functions:execute') || existingScopes.has('functions:*') ? 'checked' : ''}>
                  <span>Invoke All Functions (<code>functions:invoke</code>)</span>
                </label>
              </div>
              ${apiKeysState.functions.length === 0 ? '<div style="font-size: 11.5px; color: var(--text-muted);">No serverless functions created yet.</div>' : `
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px; max-height: 150px; overflow-y: auto;">
                  ${apiKeysState.functions.map((fn, idx) => `
                    <label for="scope-fn-${idx}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer;">
                      <input type="checkbox" id="scope-fn-${idx}" class="apikey-scope-cb" data-scope-group="fn-invoke" data-scope-role="specific" onchange="syncApiKeyScopeExclusions('fn-invoke')" value="functions:${escapeHtml(fn.name)}" ${existingScopes.has(`functions:${fn.name}`) ? 'checked' : ''}>
                      <code style="font-size: 11.5px;">${escapeHtml(fn.name)}</code>
                    </label>
                  `).join('')}
                </div>
              `}
            </fieldset>

            <!-- 3. Flows -->
            <fieldset class="drawer-card" style="border: 1px solid var(--border-subtle); margin: 0;">
              <legend style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); padding: 0 6px;">HTTP Flows Scopes</legend>
              <div style="padding-bottom: 6px; border-bottom: 1px solid var(--border-subtle);">
                <label for="scope-flow-all" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer;">
                  <input type="checkbox" id="scope-flow-all" class="apikey-scope-cb" data-scope-group="flow-execute" data-scope-role="all" onchange="syncApiKeyScopeExclusions('flow-execute')" value="flows:execute" ${existingScopes.has('flows:execute') || existingScopes.has('flows:invoke') || existingScopes.has('flows:*') ? 'checked' : ''}>
                  <span>Execute All HTTP Flows (<code>flows:execute</code>)</span>
                </label>
              </div>
              ${httpFlows.length === 0 ? '<div style="font-size: 11.5px; color: var(--text-muted);">No HTTP-triggered flows created yet.</div>' : `
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px; max-height: 150px; overflow-y: auto;">
                  ${httpFlows.map((fl, idx) => `
                    <label for="scope-flow-${idx}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer;">
                      <input type="checkbox" id="scope-flow-${idx}" class="apikey-scope-cb" data-scope-group="flow-execute" data-scope-role="specific" onchange="syncApiKeyScopeExclusions('flow-execute')" value="flows:${escapeHtml(fl.name)}" ${existingScopes.has(`flows:${fl.name}`) ? 'checked' : ''}>
                      <code style="font-size: 11.5px;">${escapeHtml(fl.name)}</code>
                    </label>
                  `).join('')}
                </div>
              `}
            </fieldset>

            <!-- 4. Queues -->
            <fieldset class="drawer-card" style="border: 1px solid var(--border-subtle); margin: 0;">
              <legend style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); padding: 0 6px;">Message Queues Scopes</legend>
              <div style="display: flex; gap: 1rem; flex-wrap: wrap; padding-bottom: 6px; border-bottom: 1px solid var(--border-subtle);">
                <label for="scope-q-all-send" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer;">
                  <input type="checkbox" id="scope-q-all-send" class="apikey-scope-cb" data-scope-group="queue-send" data-scope-role="all" onchange="syncApiKeyScopeExclusions('queue-send')" value="queues:send" ${existingScopes.has('queues:send') || existingScopes.has('queues:*') ? 'checked' : ''}>
                  <span>Send All (<code>queues:send</code>)</span>
                </label>
                <label for="scope-q-all-read" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer;">
                  <input type="checkbox" id="scope-q-all-read" class="apikey-scope-cb" data-scope-group="queue-read" data-scope-role="all" onchange="syncApiKeyScopeExclusions('queue-read')" value="queues:read" ${existingScopes.has('queues:read') || existingScopes.has('queues:*') ? 'checked' : ''}>
                  <span>Read All (<code>queues:read</code>)</span>
                </label>
                <label for="scope-q-all-delete" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer;">
                  <input type="checkbox" id="scope-q-all-delete" class="apikey-scope-cb" data-scope-group="queue-delete" data-scope-role="all" onchange="syncApiKeyScopeExclusions('queue-delete')" value="queues:delete" ${existingScopes.has('queues:delete') || existingScopes.has('queues:*') ? 'checked' : ''}>
                  <span>Delete All (<code>queues:delete</code>)</span>
                </label>
              </div>
              ${apiKeysState.queues.length === 0 ? '<div style="font-size: 11.5px; color: var(--text-muted);">No user queues configured yet.</div>' : `
                <div style="display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto;">
                  ${apiKeysState.queues.map((q, idx) => `
                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; padding: 3px 0;">
                      <code style="color: var(--text-heading); font-weight: 600;">${escapeHtml(q.name)}</code>
                      <div style="display: flex; gap: 10px;">
                        <label for="scope-q-s-${idx}" style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                          <input type="checkbox" id="scope-q-s-${idx}" class="apikey-scope-cb" data-scope-group="queue-send" data-scope-role="specific" onchange="syncApiKeyScopeExclusions('queue-send')" value="queues:${escapeHtml(q.name)}:send" ${existingScopes.has(`queues:${q.name}:send`) ? 'checked' : ''}> Send
                        </label>
                        <label for="scope-q-r-${idx}" style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                          <input type="checkbox" id="scope-q-r-${idx}" class="apikey-scope-cb" data-scope-group="queue-read" data-scope-role="specific" onchange="syncApiKeyScopeExclusions('queue-read')" value="queues:${escapeHtml(q.name)}:read" ${existingScopes.has(`queues:${q.name}:read`) ? 'checked' : ''}> Read
                        </label>
                        <label for="scope-q-d-${idx}" style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                          <input type="checkbox" id="scope-q-d-${idx}" class="apikey-scope-cb" data-scope-group="queue-delete" data-scope-role="specific" onchange="syncApiKeyScopeExclusions('queue-delete')" value="queues:${escapeHtml(q.name)}:delete" ${existingScopes.has(`queues:${q.name}:delete`) ? 'checked' : ''}> Delete
                        </label>
                      </div>
                    </div>
                  `).join('')}
                </div>
              `}
            </fieldset>

            <!-- Custom Extra Scopes -->
            <div class="form-group" style="margin: 0;">
              <label class="form-label" for="apikey-extra-scopes">Additional Custom Scopes (Optional)</label>
              <input
                type="text"
                id="apikey-extra-scopes"
                name="extraScopes"
                class="form-input"
                value="${escapeHtml(extraScopes.join(', '))}"
                placeholder="e.g. orders:export, custom:billing"
                aria-describedby="apikey-extra-help"
                autocorrect="off"
                autocapitalize="none"
                spellcheck="false"
              />
              <span id="apikey-extra-help" style="font-size: 10.5px; color: var(--text-muted);">Comma-separated custom scope strings preserved alongside checked permissions.</span>
            </div>
          </div>
        </div>

        <div class="drawer-footer" style="padding: 1rem 1.5rem; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end; gap: 0.65rem; background: var(--bg-card);">
          <button type="button" class="btn btn-secondary btn-sm" onclick="closeApiKeyDrawer()">Cancel</button>
          <button type="submit" id="btn-save-api-key" class="btn btn-primary btn-sm" style="font-weight: 600;">
            ${isEdit ? 'Save Key Scopes' : 'Generate API Key'}
          </button>
        </div>
      </form>
    </aside>
  `;

  syncApiKeyScopeExclusions();
  setAppShellInert(true);
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleApiKeyDrawerKeyDown);
    window.addEventListener('keydown', handleApiKeyDrawerKeyDown);
  }
  const nameInput = document.getElementById('apikey-name-input');
  if (nameInput && typeof nameInput.focus === 'function') {
    nameInput.focus();
  }
}

function closeApiKeyDrawer() {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleApiKeyDrawerKeyDown);
  }
  const panel = typeof document !== 'undefined' ? document.getElementById('apikey-drawer-panel') : null;
  if (!panel) return;
  const root = document.getElementById('drawer-root');
  if (root) root.innerHTML = '';
  setAppShellInert(false);
  apiKeysState.editingKeyId = null;
  if (apiKeysState.lastFocusedElement && typeof apiKeysState.lastFocusedElement.focus === 'function') {
    try {
      apiKeysState.lastFocusedElement.focus();
    } catch (_) {}
  }
  apiKeysState.lastFocusedElement = null;
}

const APIKEY_SCOPE_GROUPS = [
  'col-read',
  'col-write',
  'fn-invoke',
  'flow-execute',
  'queue-send',
  'queue-read',
  'queue-delete',
];

function setScopeCheckboxDisabled(cb, disabled) {
  if (!cb) return;
  cb.disabled = Boolean(disabled);
  if (disabled) {
    cb.checked = false;
  }
  const lbl = cb.closest('label') || (cb.id ? document.querySelector(`label[for="${cb.id}"]`) : null);
  if (lbl) {
    lbl.style.opacity = disabled ? '0.45' : '1';
    lbl.style.cursor = disabled ? 'not-allowed' : 'pointer';
  }
}

function syncApiKeyScopeExclusions(targetGroup) {
  const groups = targetGroup ? [targetGroup] : APIKEY_SCOPE_GROUPS;
  for (const group of groups) {
    const allCb = document.querySelector(`.apikey-scope-cb[data-scope-group="${group}"][data-scope-role="all"]`);
    const specificCbs = Array.from(
      document.querySelectorAll(`.apikey-scope-cb[data-scope-group="${group}"][data-scope-role="specific"]`)
    );

    if (allCb && allCb.checked) {
      setScopeCheckboxDisabled(allCb, false);
      specificCbs.forEach(cb => setScopeCheckboxDisabled(cb, true));
    } else if (specificCbs.some(cb => cb.checked)) {
      if (allCb) setScopeCheckboxDisabled(allCb, true);
      specificCbs.forEach(cb => setScopeCheckboxDisabled(cb, false));
    } else {
      if (allCb) setScopeCheckboxDisabled(allCb, false);
      specificCbs.forEach(cb => setScopeCheckboxDisabled(cb, false));
    }
  }
}

function toggleApiKeyTier(tier) {
  const isAdmin = tier === 'admin';
  const warn = document.getElementById('apikey-admin-warning');
  const matrix = document.getElementById('apikey-scope-matrix');
  if (warn) warn.style.display = isAdmin ? 'block' : 'none';
  if (matrix) matrix.style.display = isAdmin ? 'none' : 'flex';
}

async function handleSaveApiKey(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();

  const name = document.getElementById('apikey-name-input')?.value?.trim() || '';
  if (!name) {
    if (typeof toast === 'function') toast('Key Name is required', 'error');
    return;
  }

  const description = document.getElementById('apikey-desc-input')?.value?.trim() || '';
  const ipsRaw = document.getElementById('apikey-ips-input')?.value || '';
  const allowedIps = ipsRaw.split(',').map(s => s.trim()).filter(Boolean);

  const tierEl = document.querySelector('input[name="keyTier"]:checked');
  const isAdminTier = tierEl && tierEl.value === 'admin';

  let scopes = [];
  if (isAdminTier) {
    scopes = ['*'];
  } else {
    const checked = Array.from(document.querySelectorAll('.apikey-scope-cb:checked:not(:disabled)')).map(cb => cb.value);
    const extraRaw = document.getElementById('apikey-extra-scopes')?.value || '';
    const extra = extraRaw.split(',').map(s => s.trim()).filter(Boolean);
    scopes = Array.from(new Set([...checked, ...extra]));
  }

  const role = isAdminTier ? 'admin' : 'service';
  const isEdit = Boolean(apiKeysState.editingKeyId);
  const submitBtn = document.getElementById('btn-save-api-key');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const prefix = getApiKeysApiPrefix();
    if (isEdit) {
      await api(`${prefix}/${encodeURIComponent(apiKeysState.editingKeyId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, description, role, scopes, allowedIps }),
      });
      closeApiKeyDrawer();
      if (typeof toast === 'function') toast('API key updated successfully', 'success');
      await loadApiKeys();
    } else {
      const expiryRaw = document.getElementById('apikey-expiry-select')?.value;
      const createPayload = {
        name,
        description,
        role,
        scopes,
        allowedIps,
      };
      if (expiryRaw) {
        createPayload.expiresInDays = parseInt(expiryRaw, 10);
      }
      const created = await api(prefix, {
        method: 'POST',
        body: JSON.stringify(createPayload),
      });
      closeApiKeyDrawer();
      await loadApiKeys();
      showApiKeySecretModal(created);
    }
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to save API key', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function showApiKeySecretModal(keyResult) {
  let modalRoot = document.getElementById('modal-root');
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'modal-root';
    document.body.appendChild(modalRoot);
  }
  const secret = keyResult?.secretKey || '';
  const safeSecret = escapeHtml(secret);

  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeApiKeySecretModal()">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="apikey-secret-title" style="max-width: 560px;">
        <div class="modal-header">
          <h2 id="apikey-secret-title" class="modal-title" style="margin: 0; display: flex; align-items: center; gap: 8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary);"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            API Key Generated
          </h2>
          <button type="button" class="btn btn-secondary btn-sm" onclick="closeApiKeySecretModal()" aria-label="Close modal">✕</button>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; gap: 0.9rem;">
          <div style="padding: 0.75rem 1rem; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.1); color: #f59e0b; font-size: 12px;">
            <strong>Save this key now:</strong> For your security, the full plaintext secret key is shown only once and cannot be retrieved later.
          </div>
          <div>
            <label class="form-label" for="generated-apikey-secret">Secret Key</label>
            <div style="display: flex; gap: 6px;">
              <input type="text" id="generated-apikey-secret" class="form-input" value="${safeSecret}" readonly style="font-family: monospace; font-size: 12.5px;" />
              <button type="button" class="btn btn-primary btn-sm" onclick="copyGeneratedApiKeySecret()">Copy</button>
            </div>
          </div>
          <div>
            <div style="font-size: 11.5px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">HTTP Usage Header</div>
            <pre style="margin: 0; padding: 0.65rem 0.85rem; border-radius: 6px; background: var(--bg-input); border: 1px solid var(--border-subtle); font-size: 11.5px; overflow-x: auto;">Authorization: ApiKey ${safeSecret}</pre>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-primary btn-sm" onclick="closeApiKeySecretModal()">I Have Saved This Key</button>
        </div>
      </div>
    </div>
  `;
}

function copyGeneratedApiKeySecret() {
  const input = document.getElementById('generated-apikey-secret');
  if (!input) return;
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(input.value);
  }
  if (typeof toast === 'function') toast('API secret key copied to clipboard', 'success');
}

function closeApiKeySecretModal() {
  const titleEl = typeof document !== 'undefined' ? document.getElementById('apikey-secret-title') : null;
  if (!titleEl) return;
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) modalRoot.innerHTML = '';
}

const API_KEY_SUBSYSTEM_META = {
  collections: {
    label: 'Collections',
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary); flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
  },
  functions: {
    label: 'Functions',
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary); flex-shrink: 0;"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
  },
  flows: {
    label: 'Flows',
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary); flex-shrink: 0;"><circle cx="12" cy="5" r="3"></circle><line x1="12" y1="8" x2="12" y2="12"></line><circle cx="6" cy="19" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="M12 12h-6v4"></path><path d="M12 12h6v4"></path></svg>',
  },
  queues: {
    label: 'Queues',
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary); flex-shrink: 0;"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>',
  },
};

function toggleTesterSubsystemMenu(e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  const popover = document.getElementById('tester-subsystem-popover');
  if (popover) {
    popover.style.display = popover.style.display === 'none' ? 'flex' : 'none';
  }
}

function selectTesterSubsystem(subsystem, keyId) {
  const select = document.getElementById('tester-subsystem-select');
  if (select) select.value = subsystem;
  const popover = document.getElementById('tester-subsystem-popover');
  if (popover) popover.style.display = 'none';
  handleTesterSubsystemChange(subsystem, keyId);
}

let currentTesterKeyId = null;

async function openApiKeyTesterModal(keyId) {
  currentTesterKeyId = keyId;
  const key = (apiKeysState.keys || []).find(k => k.id === keyId);
  if (!key) {
    if (typeof toast === 'function') toast('API key not found', 'error');
    return;
  }

  // Ensure functions, flows, queues are loaded
  if (!apiKeysState.functions.length || !apiKeysState.flows.length || !apiKeysState.queues.length) {
    try {
      const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : (typeof state !== 'undefined' && state?.activeApp?.slug) || 'default';
      const fnEndpoint = slug && slug !== 'default' ? `/api/apps/${encodeURIComponent(slug)}/functions` : '/api/functions';
      const flowEndpoint = slug && slug !== 'default' ? `/api/apps/${encodeURIComponent(slug)}/flows` : '/api/flows';
      const queueEndpoint = slug && slug !== 'default' ? `/api/apps/${encodeURIComponent(slug)}/queues` : '/api/queues';

      const [fnRes, flowRes, queueRes] = await Promise.allSettled([
        api(fnEndpoint),
        api(flowEndpoint),
        api(queueEndpoint),
      ]);
      apiKeysState.functions = fnRes.status === 'fulfilled' && Array.isArray(fnRes.value) ? fnRes.value : (fnRes.status === 'fulfilled' && fnRes.value?.items ? fnRes.value.items : []);
      apiKeysState.flows = flowRes.status === 'fulfilled' && Array.isArray(flowRes.value) ? flowRes.value : (flowRes.status === 'fulfilled' && flowRes.value?.items ? flowRes.value.items : []);
      const rawQueues = queueRes.status === 'fulfilled' && Array.isArray(queueRes.value) ? queueRes.value : (queueRes.status === 'fulfilled' && queueRes.value?.items ? queueRes.value.items : []);
      apiKeysState.queues = rawQueues.filter(q => q && q.name && !String(q.name).startsWith('_system:') && !q.isSystem);
    } catch (_) {}
  }

  let modalRoot = document.getElementById('modal-root');
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'modal-root';
    document.body.appendChild(modalRoot);
  }

  const safeName = escapeHtml(key.name || 'Unnamed Key');
  const roleBadge = key.role === 'admin'
    ? '<span class="badge badge-danger" style="font-size: 11px;">Admin Key</span>'
    : (key.role === 'service'
      ? '<span class="badge badge-primary" style="font-size: 11px;">Service Key</span>'
      : '<span class="badge badge-warning" style="font-size: 11px;">Custom Role</span>');

  const statusBadge = key.status === 'active'
    ? '<span class="badge badge-success" style="font-size: 11px;">Active</span>'
    : (key.status === 'revoked'
      ? '<span class="badge badge-danger" style="font-size: 11px;">Revoked</span>'
      : '<span class="badge badge-warning" style="font-size: 11px;">Expired</span>');

  const scopesList = Array.isArray(key.scopes) ? key.scopes : [];
  const ipList = Array.isArray(key.allowedIps) && key.allowedIps.length > 0 ? key.allowedIps.join(', ') : 'None (Any IP allowed)';

  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeApiKeyTesterModal()">
      <div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="apikey-tester-title" style="max-width: 680px; width: 95vw;">
        <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary);"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <h2 id="apikey-tester-title" class="modal-title" style="margin: 0; font-size: 1.1rem;">API Key Permissions Tester</h2>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="closeApiKeyTesterModal()" aria-label="Close tester">✕</button>
        </div>

        <div class="modal-body" style="display: flex; flex-direction: column; gap: 1rem; max-height: 80vh; overflow-y: auto;">
          <!-- Key Meta Info Card -->
          <div style="background: var(--bg-card-hover); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
              <div style="font-weight: 700; color: var(--text-heading); font-size: 13.5px;">${safeName}</div>
              <div style="display: flex; align-items: center; gap: 6px;">
                ${roleBadge}
                ${statusBadge}
              </div>
            </div>
            <div style="font-size: 11.5px; color: var(--text-muted); display: flex; flex-wrap: wrap; gap: 12px;">
              <span>Key ID: <code style="font-size: 11px;">${escapeHtml(key.id)}</code></span>
              <span>Prefix: <code style="font-size: 11px;">${escapeHtml(key.redactedKey || key.keyPrefix + '...')}</code></span>
              <span>Allowed IPs: <code style="font-size: 11px;">${escapeHtml(ipList)}</code></span>
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
              Configured Scopes (${scopesList.length}): <code style="font-size: 10.5px;">${escapeHtml(scopesList.slice(0, 5).join(', '))}${scopesList.length > 5 ? ` +${scopesList.length - 5} more` : ''}</code>
            </div>
          </div>

          <!-- Configuration Controls -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            <!-- Subsystem -->
            <div class="form-group" style="margin: 0; position: relative;">
              <label class="form-label" style="font-weight: 600; font-size: 12px;">Target Subsystem</label>
              <div class="dropdown-wrapper" style="width: 100%;">
                <button type="button" id="tester-subsystem-trigger" class="form-select" onclick="toggleTesterSubsystemMenu(event)" style="width: 100%; display: flex; align-items: center; justify-content: space-between; text-align: left; cursor: pointer; padding: 0.55rem 0.75rem; background: var(--bg-input);">
                  <div id="tester-subsystem-selected" style="display: flex; align-items: center; gap: 8px;">
                    ${API_KEY_SUBSYSTEM_META.collections.icon}
                    <span style="font-size: 13px; font-weight: 500;">Collections</span>
                  </div>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-muted); flex-shrink: 0;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <div id="tester-subsystem-popover" class="dropdown-menu-popover" style="display: none; position: absolute; left: 0; right: 0; width: 100%; top: calc(100% + 4px); z-index: 1000; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; box-shadow: var(--shadow-dropdown); padding: 4px;">
                  ${['collections', 'functions', 'flows', 'queues'].map(s => `
                    <button type="button" class="dropdown-menu-item tester-subsystem-item" data-subsystem="${s}" onclick="selectTesterSubsystem('${s}', '${escapeHtml(key.id)}')" style="display: flex; align-items: center; gap: 8px; border-radius: 6px; padding: 7px 10px; font-size: 13px; font-weight: 500; border: none; cursor: pointer; text-align: left; width: 100%; transition: background 0.15s ease;">
                      ${API_KEY_SUBSYSTEM_META[s].icon}
                      <span>${API_KEY_SUBSYSTEM_META[s].label}</span>
                    </button>
                  `).join('')}
                </div>
              </div>
              <select id="tester-subsystem-select" style="display: none;" onchange="handleTesterSubsystemChange(this.value, '${escapeHtml(key.id)}')">
                <option value="collections">Collections</option>
                <option value="functions">Functions</option>
                <option value="flows">Flows</option>
                <option value="queues">Queues</option>
              </select>
            </div>

            <!-- Resource -->
            <div class="form-group" style="margin: 0;">
              <label class="form-label" for="tester-resource-select" style="font-weight: 600; font-size: 12px;">Target Resource</label>
              <div id="tester-resource-container">
                <!-- Dynamically populated -->
              </div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            <!-- Action -->
            <div class="form-group" style="margin: 0;">
              <label class="form-label" for="tester-action-select" style="font-weight: 600; font-size: 12px;">Action / Operation</label>
              <div id="tester-action-container">
                <!-- Dynamically populated -->
              </div>
            </div>

            <!-- Client IP Simulation -->
            <div class="form-group" style="margin: 0;">
              <label class="form-label" for="tester-ip-input" style="font-weight: 600; font-size: 12px;">Simulated Client IP <span style="font-weight: 400; color: var(--text-muted);">(optional)</span></label>
              <input type="text" id="tester-ip-input" class="form-input" placeholder="127.0.0.1" value="127.0.0.1" />
            </div>
          </div>

          <!-- Action Buttons -->
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px;">
            <button type="button" id="btn-run-api-key-test" class="btn btn-primary btn-sm" onclick="runApiKeySimulation('${escapeHtml(key.id)}')" style="font-weight: 600; padding: 6px 14px;">
              Test Permission
            </button>
            <button type="button" id="btn-run-api-key-audit" class="btn btn-secondary btn-sm" onclick="runApiKeyFullAudit('${escapeHtml(key.id)}')" style="font-weight: 500;">
              Audit All Resources
            </button>
          </div>

          <!-- Result Area -->
          <div id="api-key-tester-result" style="margin-top: 4px;">
            <div style="padding: 1.5rem; text-align: center; background: var(--bg-card); border: 1px dashed var(--border-subtle); border-radius: 8px; color: var(--text-muted); font-size: 12px;">
              Select a target resource and action above, then click <strong>Test Permission</strong> to evaluate the authorization engine.
            </div>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: flex-end;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="closeApiKeyTesterModal()">Close</button>
        </div>
      </div>
    </div>
  `;

  handleTesterSubsystemChange('collections', key.id);
}

function closeApiKeyTesterModal() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) modalRoot.innerHTML = '';
  currentTesterKeyId = null;
}

function handleTesterSubsystemChange(subsystem, keyId) {
  const select = document.getElementById('tester-subsystem-select');
  if (select && select.value !== subsystem) select.value = subsystem;

  const display = document.getElementById('tester-subsystem-selected');
  const meta = API_KEY_SUBSYSTEM_META[subsystem];
  if (display && meta) {
    display.innerHTML = `
      ${meta.icon}
      <span style="font-size: 13px; font-weight: 500;">${meta.label}</span>
    `;
  }

  if (typeof document !== 'undefined') {
    document.querySelectorAll('.tester-subsystem-item').forEach(btn => {
      const isCur = btn.getAttribute('data-subsystem') === subsystem;
      btn.style.background = isCur ? 'var(--nav-active-bg)' : 'transparent';
      btn.style.color = isCur ? 'var(--nav-active-text)' : 'var(--text-main)';
    });
  }

  const resContainer = document.getElementById('tester-resource-container');
  const actContainer = document.getElementById('tester-action-container');
  if (!resContainer || !actContainer) return;

  const collections = (typeof state !== 'undefined' && Array.isArray(state.collections) ? state.collections : [])
    .filter(c => c && c.name && !c.system && !String(c.name).startsWith('_'));
  const functions = apiKeysState.functions || [];
  const flows = apiKeysState.flows || [];
  const queues = apiKeysState.queues || [];

  if (subsystem === 'collections') {
    const optionsHtml = collections.length > 0
      ? collections.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('')
      : '<option value="orders">orders</option>';
    resContainer.innerHTML = `
      <select id="tester-resource-select" class="form-select">
        ${optionsHtml}
      </select>
    `;
    actContainer.innerHTML = `
      <select id="tester-action-select" class="form-select">
        <option value="list">list (List records)</option>
        <option value="view">view (Get record by ID)</option>
        <option value="create">create (Insert record)</option>
        <option value="update">update (Modify record)</option>
        <option value="delete">delete (Remove record)</option>
      </select>
    `;
  } else if (subsystem === 'functions') {
    const optionsHtml = functions.length > 0
      ? functions.map(fn => `<option value="${escapeHtml(fn.name)}">${escapeHtml(fn.name)}</option>`).join('')
      : '<option value="hello-world">hello-world</option>';
    resContainer.innerHTML = `
      <select id="tester-resource-select" class="form-select">
        ${optionsHtml}
      </select>
    `;
    actContainer.innerHTML = `
      <select id="tester-action-select" class="form-select">
        <option value="invoke">invoke (Execute function)</option>
      </select>
    `;
  } else if (subsystem === 'flows') {
    const optionsHtml = flows.length > 0
      ? flows.map(fl => `<option value="${escapeHtml(fl.name)}">${escapeHtml(fl.name)}</option>`).join('')
      : '<option value="approval-flow">approval-flow</option>';
    resContainer.innerHTML = `
      <select id="tester-resource-select" class="form-select">
        ${optionsHtml}
      </select>
    `;
    actContainer.innerHTML = `
      <select id="tester-action-select" class="form-select">
        <option value="execute">execute (Trigger flow)</option>
        <option value="poll">poll (Check execution status)</option>
      </select>
    `;
  } else if (subsystem === 'queues') {
    const optionsHtml = queues.length > 0
      ? queues.map(q => `<option value="${escapeHtml(q.name)}">${escapeHtml(q.name)}</option>`).join('')
      : '<option value="email-jobs">email-jobs</option>';
    resContainer.innerHTML = `
      <select id="tester-resource-select" class="form-select">
        ${optionsHtml}
      </select>
    `;
    actContainer.innerHTML = `
      <select id="tester-action-select" class="form-select">
        <option value="send">send (Enqueue job / message)</option>
        <option value="read">read / claim (Consume job)</option>
        <option value="delete">delete (Purge / cancel message)</option>
      </select>
    `;
  }
}

async function runApiKeySimulation(keyId) {
  const subEl = document.getElementById('tester-subsystem-select');
  const resEl = document.getElementById('tester-resource-select');
  const actEl = document.getElementById('tester-action-select');
  const ipEl = document.getElementById('tester-ip-input');
  const resultContainer = document.getElementById('api-key-tester-result');
  if (!resultContainer) return;

  const subsystem = subEl?.value || 'collections';
  const resource = resEl?.value || '';
  const action = actEl?.value || 'list';
  const clientIp = ipEl?.value?.trim() || undefined;

  resultContainer.innerHTML = `
    <div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 12.5px;">
      <span class="spinner" style="margin-right: 6px;"></span> Evaluating authorization engine...
    </div>
  `;

  try {
    const prefix = getApiKeysApiPrefix();
    const res = await api(`${prefix}/${encodeURIComponent(keyId)}/simulate`, {
      method: 'POST',
      body: JSON.stringify({
        subsystem,
        resource,
        action,
        clientIp,
      }),
    });

    if (res.allowed) {
      resultContainer.innerHTML = `
        <div class="tester-result-card allowed" style="padding: 1rem; border-radius: 8px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.35); display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: #10b981; font-size: 13.5px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              ACCESS GRANTED (HTTP 200)
            </span>
            <span class="badge badge-success" style="font-size: 11px;">${escapeHtml(res.matchedScope || 'Admin / Wildcard')}</span>
          </div>
          <div style="font-size: 12.5px; color: var(--text-heading); font-weight: 500;">
            ${escapeHtml(res.reason)}
          </div>
          ${res.ipCheck && res.ipCheck.enforced ? `
            <div style="font-size: 11px; color: #10b981;">
              Client IP verified: <code>${escapeHtml(res.ipCheck.clientIp || 'client')}</code>
            </div>
          ` : ''}
          ${res.curlExample ? `
            <div style="margin-top: 6px; border-top: 1px solid rgba(16, 185, 129, 0.2); padding-top: 8px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                <span style="font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">Equivalent cURL Request</span>
                <button type="button" class="btn btn-secondary btn-xs" onclick="copyTesterCurl()" style="padding: 2px 8px; font-size: 11px;">Copy cURL</button>
              </div>
              <pre id="tester-curl-code" style="margin: 0; padding: 0.6rem 0.8rem; border-radius: 6px; background: var(--bg-input); border: 1px solid var(--border-subtle); font-size: 11px; font-family: monospace; overflow-x: auto; white-space: pre-wrap;">${escapeHtml(res.curlExample)}</pre>
            </div>
          ` : ''}
        </div>
      `;
    } else {
      resultContainer.innerHTML = `
        <div class="tester-result-card forbidden" style="padding: 1rem; border-radius: 8px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: #ef4444; font-size: 13.5px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              ACCESS DENIED (HTTP 403)
            </span>
            <span class="badge badge-danger" style="font-size: 11px;">Blocked</span>
          </div>
          <div style="font-size: 12.5px; color: var(--text-heading); font-weight: 500;">
            ${escapeHtml(res.reason)}
          </div>
          ${res.requiredScope ? `
            <div style="font-size: 11.5px; color: var(--text-muted);">
              Required Scope: <code style="font-size: 11px; background: var(--bg-input); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-subtle);">${escapeHtml(res.requiredScope)}</code>
            </div>
          ` : ''}
          ${res.ipCheck && res.ipCheck.enforced && !res.ipCheck.allowed ? `
            <div style="font-size: 11.5px; color: #ef4444;">
              Client IP blocked: <code>${escapeHtml(res.ipCheck.clientIp)}</code> is not in this key's allowed IP range.
            </div>
          ` : ''}
        </div>
      `;
    }
  } catch (err) {
    resultContainer.innerHTML = `
      <div style="padding: 1rem; border-radius: 8px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); color: #ef4444; font-size: 12.5px;">
        Simulation failed: ${escapeHtml(err.message || String(err))}
      </div>
    `;
  }
}

async function runApiKeyFullAudit(keyId) {
  const resultContainer = document.getElementById('api-key-tester-result');
  if (!resultContainer) return;

  const collections = (typeof state !== 'undefined' && Array.isArray(state.collections) ? state.collections : [])
    .filter(c => c && c.name && !c.system && !String(c.name).startsWith('_'));
  const functions = apiKeysState.functions || [];
  const flows = apiKeysState.flows || [];
  const queues = apiKeysState.queues || [];

  const targets = [];
  for (const c of collections) {
    targets.push({ subsystem: 'collections', resource: c.name, action: 'list', label: `${c.name}:read` });
    targets.push({ subsystem: 'collections', resource: c.name, action: 'create', label: `${c.name}:write` });
  }
  for (const fn of functions) {
    targets.push({ subsystem: 'functions', resource: fn.name, action: 'invoke', label: `functions:${fn.name}` });
  }
  for (const fl of flows) {
    targets.push({ subsystem: 'flows', resource: fl.name, action: 'execute', label: `flows:${fl.name}` });
  }
  for (const q of queues) {
    targets.push({ subsystem: 'queues', resource: q.name, action: 'send', label: `queues:${q.name}:send` });
    targets.push({ subsystem: 'queues', resource: q.name, action: 'read', label: `queues:${q.name}:read` });
  }

  if (targets.length === 0) {
    resultContainer.innerHTML = `
      <div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 12.5px;">
        No collections, functions, flows, or queues are currently configured in this app to audit.
      </div>
    `;
    return;
  }

  resultContainer.innerHTML = `
    <div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 12.5px;">
      <span class="spinner" style="margin-right: 6px;"></span> Auditing ${targets.length} target permissions across the app...
    </div>
  `;

  try {
    const prefix = getApiKeysApiPrefix();
    const results = await Promise.all(targets.map(async (t) => {
      try {
        const res = await api(`${prefix}/${encodeURIComponent(keyId)}/simulate`, {
          method: 'POST',
          body: JSON.stringify({
            subsystem: t.subsystem,
            resource: t.resource,
            action: t.action,
          }),
        });
        return { ...t, allowed: res.allowed, reason: res.reason, matchedScope: res.matchedScope };
      } catch (err) {
        return { ...t, allowed: false, reason: err.message || 'Error', matchedScope: null };
      }
    }));

    const allowedCount = results.filter(r => r.allowed).length;
    const deniedCount = results.length - allowedCount;

    resultContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 4px 0;">
          <span style="font-weight: 700; font-size: 12.5px; color: var(--text-heading);">Permissions Audit Summary</span>
          <div style="display: flex; gap: 6px;">
            <span class="badge badge-success" style="font-size: 11px;">${allowedCount} Allowed</span>
            <span class="badge badge-danger" style="font-size: 11px;">${deniedCount} Blocked</span>
          </div>
        </div>
        <div style="max-height: 220px; overflow-y: auto; border: 1px solid var(--border-subtle); border-radius: 6px; background: var(--bg-card);">
          <table style="width: 100%; border-collapse: collapse; font-size: 11.5px;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-subtle); background: var(--bg-card-hover); color: var(--text-muted); text-align: left;">
                <th style="padding: 6px 10px;">Subsystem</th>
                <th style="padding: 6px 10px;">Resource &amp; Action</th>
                <th style="padding: 6px 10px;">Permission</th>
                <th style="padding: 6px 10px; text-align: right;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${results.map(r => `
                <tr style="border-bottom: 1px solid var(--border-subtle);">
                  <td style="padding: 5px 10px; text-transform: capitalize; color: var(--text-muted);">${escapeHtml(r.subsystem)}</td>
                  <td style="padding: 5px 10px; font-weight: 600; color: var(--text-heading);">${escapeHtml(r.resource)} <span style="font-weight: 400; color: var(--text-muted);">(${escapeHtml(r.action)})</span></td>
                  <td style="padding: 5px 10px;"><code>${escapeHtml(r.label)}</code></td>
                  <td style="padding: 5px 10px; text-align: right;">
                    ${r.allowed
                      ? `<span class="badge badge-success" style="font-size: 10px; padding: 2px 6px;">Allowed</span>`
                      : `<span class="badge badge-danger" style="font-size: 10px; padding: 2px 6px;">Blocked</span>`}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    resultContainer.innerHTML = `
      <div style="padding: 1rem; border-radius: 8px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); color: #ef4444; font-size: 12.5px;">
        Audit failed: ${escapeHtml(err.message || String(err))}
      </div>
    `;
  }
}

function copyTesterCurl() {
  const pre = document.getElementById('tester-curl-code');
  if (!pre) return;
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(pre.textContent);
  }
  if (typeof toast === 'function') toast('cURL command copied to clipboard', 'success');
}

async function handleRotateApiKey(id, name) {
  try {
    const keyObj = (apiKeysState.keys || []).find(k => k.id === id);
    const displayName = name || keyObj?.name || id;
    const prefix = getApiKeysApiPrefix();
    const rotated = await api(`${prefix}/${encodeURIComponent(id)}/rotate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (typeof toast === 'function') toast(`Rotated secret for '${displayName}'`, 'success');
    await loadApiKeys();
    showApiKeySecretModal(rotated);
  } catch (err) {
    if (typeof toast === 'function') toast('Failed to rotate key: ' + (err.message || err), 'error');
  }
}

async function handleToggleApiKeyStatus(id, nextStatus) {
  try {
    const prefix = getApiKeysApiPrefix();
    await api(`${prefix}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus }),
    });
    if (typeof toast === 'function') toast(`API key ${nextStatus === 'active' ? 'restored' : 'revoked'}`, 'success');
    await loadApiKeys();
  } catch (err) {
    if (typeof toast === 'function') toast('Failed to update status: ' + (err.message || err), 'error');
  }
}

async function handleDeleteApiKey(id, name) {
  try {
    const keyObj = (apiKeysState.keys || []).find(k => k.id === id);
    const displayName = name || keyObj?.name || id;
    const prefix = getApiKeysApiPrefix();
    await api(`${prefix}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (typeof toast === 'function') toast(`Deleted API key '${displayName}'`, 'success');
    await loadApiKeys();
  } catch (err) {
    if (typeof toast === 'function') toast('Failed to delete API key: ' + (err.message || err), 'error');
  }
}

if (typeof window !== 'undefined') {
  window.apiKeysState = apiKeysState;
  window.getApiKeysApiPrefix = getApiKeysApiPrefix;
  window.loadApiKeys = loadApiKeys;
  window.renderApiKeysView = renderApiKeysView;
  window.updateSidebarApiKeysBadge = updateSidebarApiKeysBadge;
  window.openApiKeyDrawer = openApiKeyDrawer;
  window.closeApiKeyDrawer = closeApiKeyDrawer;
  window.toggleApiKeyTier = toggleApiKeyTier;
  window.syncApiKeyScopeExclusions = syncApiKeyScopeExclusions;
  window.handleSaveApiKey = handleSaveApiKey;
  window.showApiKeySecretModal = showApiKeySecretModal;
  window.copyGeneratedApiKeySecret = copyGeneratedApiKeySecret;
  window.closeApiKeySecretModal = closeApiKeySecretModal;
  window.handleRotateApiKey = handleRotateApiKey;
  window.handleToggleApiKeyStatus = handleToggleApiKeyStatus;
  window.handleDeleteApiKey = handleDeleteApiKey;
  window.openApiKeyTesterModal = openApiKeyTesterModal;
  window.closeApiKeyTesterModal = closeApiKeyTesterModal;
  window.toggleTesterSubsystemMenu = toggleTesterSubsystemMenu;
  window.selectTesterSubsystem = selectTesterSubsystem;
  window.handleTesterSubsystemChange = handleTesterSubsystemChange;
  window.runApiKeySimulation = runApiKeySimulation;
  window.runApiKeyFullAudit = runApiKeyFullAudit;
  window.copyTesterCurl = copyTesterCurl;
}
