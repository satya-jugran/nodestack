// Webhooks Manager Module for NodeStack Admin UI

let webhooksState = {
  subTab: 'webhooks', // 'webhooks' | 'deliveries'
  webhooks: [],
  stats: {
    totalWebhooks: 0,
    activeWebhooks: 0,
    totalDeliveries: 0,
    successDeliveries: 0,
    failedDeliveries: 0,
    successRate: '100%',
  },
  deliveries: [],
  deliveryFilter: {
    webhookId: '',
    collection: '',
    status: 'all',
    search: '',
    page: 1,
    perPage: 25,
    totalItems: 0,
    totalPages: 1,
  },
  activeWebhookForEdit: null,
};

if (typeof window !== 'undefined') {
  window.webhooksState = webhooksState;
}

function renderWebhooksView() {
  const container = document.getElementById('page-view-webhooks') || document.getElementById('main-body');
  if (!container) return;

  container.innerHTML = `
    <div class="webhooks-container">
      <!-- Header -->
      <div class="webhooks-header">
        <div class="webhooks-title-area">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c0-2.21 1.79-4 4-4h5.99c1.1 0 1.95-.94 2.48-1.9A4 4 0 0 1 22 13c0 2.21-1.79 4-4 4z"/>
              <circle cx="6" cy="17" r="1"/>
              <circle cx="18" cy="13" r="1"/>
            </svg>
            Webhooks Manager
          </h2>
          <p>Configure outbound HTTP webhooks on collection mutations with HMAC signing and delivery tracking.</p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="btn btn-secondary btn-sm" onclick="refreshWebhooksView()" title="Refresh Webhooks & Logs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
          <button class="btn btn-primary btn-sm" onclick="openCreateWebhookModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            + New Webhook
          </button>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="webhooks-stats-grid" id="webhooks-stats-grid">
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Active Webhooks</span>
          <div class="webhook-stat-value">
            <span id="wh-stat-active">0</span>
            <span class="webhook-stat-subtext" id="wh-stat-total">/ 0 total</span>
          </div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Total Deliveries</span>
          <div class="webhook-stat-value" id="wh-stat-deliveries">0</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Success Rate</span>
          <div class="webhook-stat-value" style="color: #34d399;" id="wh-stat-rate">100%</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Failed Deliveries</span>
          <div class="webhook-stat-value" style="color: #f87171;" id="wh-stat-failed">0</div>
        </div>
      </div>

      <!-- Subtabs Bar -->
      <div class="webhooks-tabs-bar">
        <button class="webhook-tab-btn ${webhooksState.subTab === 'webhooks' ? 'active' : ''}" id="tab-btn-wh-list" onclick="switchWebhooksTab('webhooks')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          Configured Webhooks
        </button>
        <button class="webhook-tab-btn ${webhooksState.subTab === 'deliveries' ? 'active' : ''}" id="tab-btn-wh-deliveries" onclick="switchWebhooksTab('deliveries')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Delivery Logs
        </button>
      </div>

      <!-- Content Area -->
      <div id="webhooks-tab-content">
        <!-- Rendered by switchWebhooksTab() -->
      </div>
    </div>
  `;

  loadWebhookStats();
  if (webhooksState.subTab === 'webhooks') {
    loadWebhooksList();
  } else {
    loadWebhookDeliveries();
  }
}

async function refreshWebhooksView() {
  await loadWebhookStats();
  if (webhooksState.subTab === 'webhooks') {
    await loadWebhooksList();
  } else {
    await loadWebhookDeliveries();
  }
  if (typeof toast === 'function') toast('Webhooks updated', 'info');
}

function switchWebhooksTab(tab) {
  webhooksState.subTab = tab;
  const btnList = document.getElementById('tab-btn-wh-list');
  const btnDel = document.getElementById('tab-btn-wh-deliveries');
  if (btnList) btnList.classList.toggle('active', tab === 'webhooks');
  if (btnDel) btnDel.classList.toggle('active', tab === 'deliveries');

  if (tab === 'webhooks') {
    loadWebhooksList();
  } else {
    loadWebhookDeliveries();
  }
  if (typeof updateBreadcrumbs === 'function') updateBreadcrumbs();
}

async function loadWebhookStats() {
  try {
    const stats = await api('/api/webhooks/stats');
    if (stats) {
      webhooksState.stats = stats;
      const elActive = document.getElementById('wh-stat-active');
      const elTotal = document.getElementById('wh-stat-total');
      const elDeliveries = document.getElementById('wh-stat-deliveries');
      const elRate = document.getElementById('wh-stat-rate');
      const elFailed = document.getElementById('wh-stat-failed');

      if (elActive) elActive.textContent = stats.activeWebhooks;
      if (elTotal) elTotal.textContent = `/ ${stats.totalWebhooks} total`;
      if (elDeliveries) elDeliveries.textContent = stats.totalDeliveries.toLocaleString();
      if (elRate) elRate.textContent = stats.successRate;
      if (elFailed) elFailed.textContent = stats.failedDeliveries.toLocaleString();

      const sidebarBadge = document.getElementById('sidebar-webhooks-count');
      if (sidebarBadge) {
        const count = stats.totalWebhooks !== undefined ? stats.totalWebhooks : stats.activeWebhooks;
        sidebarBadge.textContent = String(count);
        sidebarBadge.title = `${stats.activeWebhooks || 0} active / ${stats.totalWebhooks || 0} total`;
        sidebarBadge.style.display = count > 0 ? 'inline-block' : 'none';
      }

      const homeWhEl = document.getElementById('home-stat-webhooks');
      const homeWhSubEl = document.getElementById('home-stat-webhooks-sub');
      if (homeWhEl) {
        homeWhEl.textContent = (stats.totalWebhooks !== undefined ? stats.totalWebhooks : 0).toString();
      }
      if (homeWhSubEl) {
        const active = stats.activeWebhooks || 0;
        const deliveries = stats.totalDeliveries || 0;
        homeWhSubEl.textContent = `${active} active${deliveries > 0 ? ` • ${deliveries} delivered` : ' • 0 delivered'}`;
      }
    }
  } catch (err) {
    console.error('Failed to load webhook stats:', err);
  }
}

// ==========================================
// Webhook List Rendering
// ==========================================

async function loadWebhooksList() {
  const content = document.getElementById('webhooks-tab-content');
  if (!content) return;

  content.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-muted);">Loading webhooks...</div>`;

  try {
    const webhooks = await api('/api/webhooks');
    webhooksState.webhooks = webhooks || [];

    const sidebarBadge = document.getElementById('sidebar-webhooks-count');
    if (sidebarBadge) {
      const count = webhooksState.webhooks.length;
      sidebarBadge.textContent = String(count);
      sidebarBadge.style.display = count > 0 ? 'inline-block' : 'none';
    }

    if (!webhooks || webhooks.length === 0) {
      content.innerHTML = `
        <div style="text-align:center; padding: 4rem 2rem; background: var(--bg-card); border: 1px dashed var(--border-subtle); border-radius: 8px;">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🔗</div>
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; color: var(--text-main);">No Outbound Webhooks Configured</h3>
          <p style="margin: 0 0 1.5rem 0; font-size: 0.85rem; color: var(--text-muted); max-width: 480px; margin-left: auto; margin-right: auto;">
            Send real-time HTTP payloads to external endpoints whenever database records in a collection are created, updated, or deleted.
          </p>
          <button class="btn btn-primary btn-sm" onclick="openCreateWebhookModal()">+ Create Your First Webhook</button>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="webhook-table-wrapper">
        <table class="webhook-table">
          <thead>
            <tr>
              <th style="min-width: 180px; width: 25%;">Webhook Name</th>
              <th style="min-width: 150px; width: 20%;">Collection & Event</th>
              <th style="min-width: 200px; width: 30%;">Target Endpoint</th>
              <th style="min-width: 130px; width: 10%;">Security</th>
              <th style="min-width: 160px; width: 15%; text-align: right; white-space: nowrap;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${webhooks.map(wh => {
              const eventFormatted = wh.event.includes('.') ? wh.event : `${wh.collection}.${wh.event}`;
              const hasHeaders = wh.headers && Object.keys(wh.headers).length > 0;
              const headerCount = hasHeaders ? Object.keys(wh.headers).length : 0;

              return `
                <tr>
                  <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span class="webhook-status-dot ${wh.enabled ? 'active' : 'paused'}" style="display: inline-block; width: 8px; height: 8px; min-width: 8px; min-height: 8px; flex-shrink: 0; border-radius: 50%; background: ${wh.enabled ? '#10b981' : '#64748b'};" title="${wh.enabled ? 'Active' : 'Disabled'}"></span>
                      <div style="min-width: 0;">
                        <div style="font-weight: 600; color: var(--text-main); word-break: break-word;">${escapeHtml(wh.name)}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${wh.enabled ? 'Active' : 'Paused'} • ${wh.method}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
                      <span class="badge-event" title="Collection mutation event trigger">${escapeHtml(eventFormatted)}</span>
                      <span style="font-size: 11px; color: var(--text-muted);">Collection: <strong>${escapeHtml(wh.collection)}</strong></span>
                    </div>
                  </td>
                  <td>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span style="font-family:'JetBrains Mono', monospace; font-size: 12px; color: var(--text-main); word-break: break-all;">${escapeHtml(wh.url)}</span>
                    </div>
                    ${hasHeaders ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${headerCount} custom header${headerCount === 1 ? '' : 's'}</div>` : ''}
                  </td>
                  <td>
                    ${wh.secret ? `
                      <span class="badge-signature" title="Payloads signed with HMAC-SHA256 in X-NodeStack-Signature header">
                        🔒 X-NodeStack-Signature
                      </span>
                    ` : `
                      <span style="font-size: 11px; color: var(--text-muted);">No secret</span>
                    `}
                  </td>
                  <td style="text-align: right; white-space: nowrap;">
                    <div style="display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
                      <button class="btn btn-secondary btn-sm" data-id="${escapeHtml(wh.id)}" onclick="triggerTestWebhook(this.getAttribute('data-id'))" title="Test Webhook with Live Sample Event" style="padding: 3px 8px; font-size: 11px;">
                        ⚡ Test
                      </button>
                      <button class="btn btn-secondary btn-sm" data-id="${escapeHtml(wh.id)}" onclick="viewWebhookDeliveries(this.getAttribute('data-id'))" title="View Delivery Logs" style="padding: 3px 8px; font-size: 11px;">
                        Logs
                      </button>
                      <button class="btn btn-secondary btn-sm" data-id="${escapeHtml(wh.id)}" onclick="openEditWebhookModal(this.getAttribute('data-id'))" title="Edit Webhook" style="padding: 3px 8px; font-size: 11px;">
                        Edit
                      </button>
                      <button class="btn btn-secondary btn-sm" data-id="${escapeHtml(wh.id)}" data-name="${escapeHtml(wh.name)}" onclick="handleDeleteWebhookClick(this)" title="Delete Webhook" style="padding: 3px 6px; font-size: 11px; color: #f87171;">
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div style="color:#f87171; padding:2rem; text-align:center;">Failed to load webhooks: ${escapeHtml(err.message || String(err))}</div>`;
  }
}

function viewWebhookDeliveries(webhookId) {
  webhooksState.deliveryFilter.webhookId = webhookId;
  webhooksState.deliveryFilter.page = 1;
  switchWebhooksTab('deliveries');
}

// ==========================================
// Delivery Logs Rendering & Manual Retry
// ==========================================

async function loadWebhookDeliveries() {
  const content = document.getElementById('webhooks-tab-content');
  if (!content) return;

  const f = webhooksState.deliveryFilter;
  const collectionsList = (state.collections || []).map(c => c.name);

  content.innerHTML = `
    <!-- Filter Bar -->
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 1rem; background: var(--bg-card); border: 1px solid var(--border-subtle); padding: 10px 14px; border-radius: 8px;">
      <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px;">
        <select id="wh-filter-webhook" class="form-control" style="width: auto; padding: 4px 8px; font-size: 12px;" onchange="handleDeliveryFilterChange()">
          <option value="">All Webhooks</option>
          ${webhooksState.webhooks.map(w => `<option value="${w.id}" ${f.webhookId === w.id ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('')}
        </select>

        <select id="wh-filter-col" class="form-control" style="width: auto; padding: 4px 8px; font-size: 12px;" onchange="handleDeliveryFilterChange()">
          <option value="">All Collections</option>
          ${collectionsList.map(c => `<option value="${c}" ${f.collection === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>

        <select id="wh-filter-status" class="form-control" style="width: auto; padding: 4px 8px; font-size: 12px;" onchange="handleDeliveryFilterChange()">
          <option value="all" ${f.status === 'all' ? 'selected' : ''}>All Statuses</option>
          <option value="success" ${f.status === 'success' ? 'selected' : ''}>Success Only</option>
          <option value="failed" ${f.status === 'failed' ? 'selected' : ''}>Failed Only</option>
        </select>

        <input
          type="text"
          id="wh-filter-search"
          placeholder="Search url, event, or error..."
          value="${escapeHtml(f.search)}"
          class="form-control"
          style="width: 200px; padding: 4px 8px; font-size: 12px;"
          onkeyup="if(event.key==='Enter') handleDeliveryFilterChange()"
        />
        <button class="btn btn-secondary btn-sm" onclick="handleDeliveryFilterChange()" style="padding: 4px 8px;">Filter</button>
        ${(f.webhookId || f.collection || f.status !== 'all' || f.search) ? `
          <button class="btn btn-secondary btn-sm" onclick="clearDeliveryFilters()" style="padding: 4px 8px; font-size: 11px;">Clear Filters</button>
        ` : ''}
      </div>

      <div>
        <button class="btn btn-secondary btn-sm" onclick="clearAllDeliveryLogs()" style="color: #f87171; font-size: 11px; padding: 4px 8px;">
          Clear Logs
        </button>
      </div>
    </div>

    <!-- Deliveries Table Container -->
    <div class="webhook-table-wrapper">
      <table class="webhook-table">
        <thead>
          <tr>
            <th style="min-width: 130px; width: 14%; white-space: nowrap;">Response Code</th>
            <th style="min-width: 150px; width: 16%;">Event</th>
            <th style="min-width: 200px; width: 30%;">Target Endpoint</th>
            <th style="min-width: 120px; width: 14%; white-space: nowrap;">Duration / Attempt</th>
            <th style="min-width: 120px; width: 12%; white-space: nowrap;">Delivered At</th>
            <th style="min-width: 130px; width: 14%; text-align: right; white-space: nowrap;">Actions</th>
          </tr>
        </thead>
        <tbody id="wh-deliveries-table-body">
          <tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-muted);">Loading deliveries...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination Footer -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 1rem; font-size: 12px; color: var(--text-muted);" id="wh-deliveries-pagination">
      <span id="wh-page-info">Showing page 1 of 1</span>
      <div style="display: flex; gap: 6px;">
        <button class="btn btn-secondary btn-sm" id="btn-wh-prev" onclick="changeDeliveryPage(-1)">← Previous</button>
        <button class="btn btn-secondary btn-sm" id="btn-wh-next" onclick="changeDeliveryPage(1)">Next →</button>
      </div>
    </div>
  `;

  await fetchAndRenderDeliveriesRows();
}

async function fetchAndRenderDeliveriesRows() {
  const tbody = document.getElementById('wh-deliveries-table-body');
  if (!tbody) return;

  const f = webhooksState.deliveryFilter;
  const q = new URLSearchParams();
  q.set('page', String(f.page));
  q.set('perPage', String(f.perPage));
  if (f.webhookId) q.set('webhookId', f.webhookId);
  if (f.collection) q.set('collection', f.collection);
  if (f.status && f.status !== 'all') q.set('status', f.status);
  if (f.search) q.set('search', f.search);

  try {
    const res = await api('/api/webhooks/deliveries?' + q.toString());
    webhooksState.deliveries = res.items || [];
    f.totalItems = res.totalItems;
    f.totalPages = Math.max(1, res.totalPages);

    const pageInfo = document.getElementById('wh-page-info');
    const btnPrev = document.getElementById('btn-wh-prev');
    const btnNext = document.getElementById('btn-wh-next');

    if (pageInfo) {
      pageInfo.textContent = `Showing page ${res.page} of ${f.totalPages} (${res.totalItems} total deliver${res.totalItems === 1 ? 'y' : 'ies'})`;
    }
    if (btnPrev) btnPrev.disabled = res.page <= 1;
    if (btnNext) btnNext.disabled = res.page >= f.totalPages;

    if (!res.items || res.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:3rem; color:var(--text-muted);">No webhook delivery logs found matching filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = res.items.map(del => {
      const is2xx = del.responseStatus >= 200 && del.responseStatus < 300;
      const is4xx = del.responseStatus >= 400 && del.responseStatus < 500;
      const badgeClass = is2xx ? 'badge-status-2xx' : is4xx ? 'badge-status-4xx' : 'badge-status-5xx';
      const statusText = del.responseStatus > 0 ? `${del.responseStatus} ${del.status.toUpperCase()}` : 'FAILED (NETWORK)';

      return `
        <tr>
          <td>
            <span class="badge-status-code ${badgeClass}">
              ${escapeHtml(statusText)}
            </span>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span class="badge-event">${escapeHtml(del.event)}</span>
              <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(del.webhookName)}</span>
            </div>
          </td>
          <td>
            <div style="font-family:'JetBrains Mono', monospace; font-size: 12px; color: var(--text-main); word-break: break-all;">
              ${escapeHtml(del.url)}
            </div>
            ${del.error ? `<div style="font-size: 11px; color: #f87171; margin-top: 2px;">Error: ${escapeHtml(del.error)}</div>` : ''}
          </td>
          <td>
            <div style="font-size: 12px; color: var(--text-main);">${del.durationMs}ms</div>
            <div style="font-size: 11px; color: var(--text-muted);">Attempt #${del.attempt || 1}</div>
          </td>
          <td>
            <div style="font-size: 11px; color: var(--text-muted);" title="${del.created}">
              ${formatRelativeTime(del.created)}
            </div>
          </td>
          <td style="text-align: right; white-space: nowrap;">
            <div style="display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
              <button class="btn btn-secondary btn-sm" data-id="${escapeHtml(del.id)}" onclick="openDeliveryDetailModal(this.getAttribute('data-id'))" title="Inspect Request Payload & Response" style="padding: 3px 8px; font-size: 11px;">
                👁 View
              </button>
              <button class="btn-retry-action" id="btn-retry-${escapeHtml(del.id)}" data-id="${escapeHtml(del.id)}" onclick="retryWebhookDelivery(this.getAttribute('data-id'), this)" title="Manual Retry: Re-send Payload to Target Endpoint">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Retry
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#f87171; text-align:center; padding:2rem;">Failed to fetch deliveries: ${escapeHtml(err.message || String(err))}</td></tr>`;
  }
}

function handleDeliveryFilterChange() {
  const whEl = document.getElementById('wh-filter-webhook');
  const colEl = document.getElementById('wh-filter-col');
  const statusEl = document.getElementById('wh-filter-status');
  const searchEl = document.getElementById('wh-filter-search');

  if (whEl) webhooksState.deliveryFilter.webhookId = whEl.value;
  if (colEl) webhooksState.deliveryFilter.collection = colEl.value;
  if (statusEl) webhooksState.deliveryFilter.status = statusEl.value;
  if (searchEl) webhooksState.deliveryFilter.search = searchEl.value;
  webhooksState.deliveryFilter.page = 1;

  fetchAndRenderDeliveriesRows();
}

function clearDeliveryFilters() {
  webhooksState.deliveryFilter = {
    webhookId: '',
    collection: '',
    status: 'all',
    search: '',
    page: 1,
    perPage: 25,
    totalItems: 0,
    totalPages: 1,
  };
  loadWebhookDeliveries();
}

function changeDeliveryPage(delta) {
  const newPage = webhooksState.deliveryFilter.page + delta;
  if (newPage >= 1 && newPage <= webhooksState.deliveryFilter.totalPages) {
    webhooksState.deliveryFilter.page = newPage;
    fetchAndRenderDeliveriesRows();
  }
}

/**
 * Manual Retry Action: Re-delivers the exact payload and updates UI in real-time
 */
async function retryWebhookDelivery(deliveryId, btnElement) {
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.classList.add('retrying');
    btnElement.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      Retrying...
    `;
  }

  try {
    const result = await api(`/api/webhooks/deliveries/${deliveryId}/retry`, { method: 'POST' });
    const is2xx = result && result.responseStatus >= 200 && result.responseStatus < 300;

    if (is2xx) {
      if (typeof toast === 'function') {
        toast(`Webhook retried successfully: HTTP ${result.responseStatus} (${result.durationMs}ms)`, 'success');
      }
    } else {
      if (typeof toast === 'function') {
        toast(`Retry completed with status: HTTP ${result.responseStatus || 0} (${result.error || 'Failed'})`, 'warning');
      }
    }

    await loadWebhookStats();
    await fetchAndRenderDeliveriesRows();
  } catch (err) {
    if (typeof toast === 'function') {
      toast(`Retry failed: ${err.message || String(err)}`, 'error');
    }
  } finally {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.classList.remove('retrying');
      btnElement.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        Retry
      `;
    }
  }
}

async function triggerTestWebhook(webhookId) {
  try {
    if (typeof toast === 'function') toast('Dispatching live test webhook...', 'info');
    const result = await api(`/api/webhooks/${webhookId}/test`, { method: 'POST' });
    const is2xx = result.responseStatus >= 200 && result.responseStatus < 300;

    if (is2xx) {
      if (typeof toast === 'function') {
        toast(`Test successful! Received HTTP ${result.responseStatus} in ${result.durationMs}ms`, 'success');
      }
    } else {
      if (typeof toast === 'function') {
        toast(`Test received HTTP ${result.responseStatus || 0}: ${result.error || 'Failed'}`, 'warning');
      }
    }

    await loadWebhookStats();
    openDeliveryDetailModal(result.id);
  } catch (err) {
    if (typeof toast === 'function') {
      toast(`Test webhook dispatch failed: ${err.message || String(err)}`, 'error');
    }
  }
}

async function clearAllDeliveryLogs() {
  if (!confirm('Are you sure you want to clear all webhook delivery logs? This cannot be undone.')) {
    return;
  }
  try {
    const res = await api('/api/webhooks/deliveries', { method: 'DELETE' });
    if (typeof toast === 'function') toast(`Cleared ${res.deletedCount || 0} delivery log(s)`, 'success');
    await loadWebhookStats();
    await fetchAndRenderDeliveriesRows();
  } catch (err) {
    if (typeof toast === 'function') toast(`Failed to clear logs: ${err.message}`, 'error');
  }
}

// ==========================================
// Modal: Create & Edit Webhook
// ==========================================

function openCreateWebhookModal(webhookToEdit = null) {
  webhooksState.activeWebhookForEdit = webhookToEdit;
  const isEdit = Boolean(webhookToEdit);
  const collections = state.collections || [];

  const initialName = webhookToEdit?.name || '';
  const initialUrl = webhookToEdit?.url || '';
  const initialCol = webhookToEdit?.collection || (collections[0]?.name || '*');
  const initialEvent = webhookToEdit?.event || 'created';
  const initialMethod = webhookToEdit?.method || 'POST';
  const initialSecret = webhookToEdit?.secret || '';
  const initialHeaders = webhookToEdit?.headers ? JSON.stringify(webhookToEdit.headers, null, 2) : '{\n  "Content-Type": "application/json"\n}';
  const initialEnabled = webhookToEdit ? webhookToEdit.enabled : true;

  const modalHtml = `
    <div class="modal-backdrop" id="webhook-modal-backdrop" onclick="if(event.target===this)closeWebhookModal()">
      <div class="modal" style="max-width: 650px;">
        <div class="modal-header">
          <h3 class="modal-title">${isEdit ? 'Edit Webhook Configuration' : 'Create Outbound Webhook'}</h3>
          <button class="btn btn-secondary btn-sm" onclick="closeWebhookModal()">✕</button>
        </div>

        <div class="modal-body" style="display: flex; flex-direction: column; gap: 14px; max-height: 75vh; overflow-y: auto;">
          <!-- Name -->
          <div class="form-group">
            <label class="form-label" for="wh-form-name">Webhook Name *</label>
            <input type="text" id="wh-form-name" class="form-control" placeholder="e.g. Order Notification Service" value="${escapeHtml(initialName)}" />
          </div>

          <!-- Target Endpoint URL & Method -->
          <div style="display: grid; grid-template-columns: 130px 1fr; gap: 12px;">
            <div class="form-group">
              <label class="form-label" for="wh-form-method">Method *</label>
              <select id="wh-form-method" class="form-control">
                <option value="POST" ${initialMethod === 'POST' ? 'selected' : ''}>POST</option>
                <option value="PUT" ${initialMethod === 'PUT' ? 'selected' : ''}>PUT</option>
                <option value="PATCH" ${initialMethod === 'PATCH' ? 'selected' : ''}>PATCH</option>
                <option value="DELETE" ${initialMethod === 'DELETE' ? 'selected' : ''}>DELETE</option>
                <option value="GET" ${initialMethod === 'GET' ? 'selected' : ''}>GET</option>
                <option value="HEAD" ${initialMethod === 'HEAD' ? 'selected' : ''}>HEAD</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="wh-form-url">Target Endpoint URL *</label>
              <input type="url" id="wh-form-url" class="form-control" placeholder="https://api.example.com/webhooks" value="${escapeHtml(initialUrl)}" />
            </div>
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: -6px;">Outbound request dispatched to this URL on matching events (POST/PUT/PATCH/DELETE carry JSON body, GET/HEAD are dispatched body-free with query encoding).</div>

          <!-- Collection & Event Selection -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="form-group">
              <label class="form-label" for="wh-form-collection">Collection *</label>
              <select id="wh-form-collection" class="form-control" onchange="updateWebhookEventPreview()">
                <option value="*" ${initialCol === '*' ? 'selected' : ''}>* (All Collections)</option>
                ${collections.map(c => `<option value="${c.name}" ${initialCol === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="wh-form-event">Trigger Event *</label>
              <select id="wh-form-event" class="form-control" onchange="updateWebhookEventPreview()">
                <option value="created" ${initialEvent === 'created' || initialEvent === 'create' ? 'selected' : ''}>Record Created (.created)</option>
                <option value="updated" ${initialEvent === 'updated' || initialEvent === 'update' ? 'selected' : ''}>Record Updated (.updated)</option>
                <option value="deleted" ${initialEvent === 'deleted' || initialEvent === 'delete' ? 'selected' : ''}>Record Deleted (.deleted)</option>
                <option value="*" ${initialEvent === '*' ? 'selected' : ''}>All Events (*)</option>
              </select>
            </div>
          </div>

          <!-- Event Preview Badge -->
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 12px; color: var(--text-muted);">Preview Matched Event:</span>
            <span class="badge-event" id="wh-form-event-preview">${initialCol === '*' ? '*' : initialCol}.${initialEvent}</span>
          </div>

          <!-- Secret Signature (X-NodeStack-Signature) -->
          <div class="form-group">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <label class="form-label" for="wh-form-secret" style="margin-bottom:0;">Secret Signature Key (Optional)</label>
              <button type="button" class="btn btn-secondary btn-sm" onclick="generateRandomWebhookSecret()" style="padding: 2px 8px; font-size: 11px;">
                ⚡ Generate Secret
              </button>
            </div>
            <input type="text" id="wh-form-secret" class="form-control" placeholder="Enter signing secret or click Generate" value="${escapeHtml(initialSecret)}" style="font-family:'JetBrains Mono', monospace;" />
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">
              When provided, NodeStack calculates HMAC-SHA256 of the payload and sends it in the <code>X-NodeStack-Signature</code> header.
            </div>
          </div>

          <!-- Custom Headers -->
          <div class="form-group">
            <label class="form-label" for="wh-form-headers">Custom HTTP Headers (JSON)</label>
            <textarea id="wh-form-headers" class="form-control" rows="3" style="font-family:'JetBrains Mono', monospace; font-size: 11px;">${escapeHtml(initialHeaders)}</textarea>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">
              Optional custom headers (e.g. <code>Authorization: Bearer ...</code>, <code>X-Api-Key</code>).
            </div>
          </div>

          <!-- Enabled Checkbox -->
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
            <input type="checkbox" id="wh-form-enabled" ${initialEnabled ? 'checked' : ''} style="cursor: pointer;" />
            <label for="wh-form-enabled" style="font-size: 13px; color: var(--text-main); cursor: pointer; user-select: none;">
              Enable this webhook for immediate outbound dispatch
            </label>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px;">
          <button class="btn btn-secondary btn-sm" onclick="closeWebhookModal()">Cancel</button>
          <button class="btn btn-primary btn-sm" id="btn-save-webhook" data-id="${escapeHtml(webhookToEdit?.id || '')}" onclick="submitWebhookForm(this.getAttribute('data-id'))">
            ${isEdit ? 'Save Changes' : 'Create Webhook'}
          </button>
        </div>
      </div>
    </div>
  `;

  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) {
    modalRoot.innerHTML = modalHtml;
  }
}

function closeWebhookModal() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) {
    modalRoot.innerHTML = '';
  }
}

function updateWebhookEventPreview() {
  const colEl = document.getElementById('wh-form-collection');
  const evEl = document.getElementById('wh-form-event');
  const preview = document.getElementById('wh-form-event-preview');
  if (colEl && evEl && preview) {
    const col = colEl.value;
    const ev = evEl.value;
    preview.textContent = `${col}.${ev}`;
  }
}

function generateRandomWebhookSecret() {
  const secretEl = document.getElementById('wh-form-secret');
  if (!secretEl) return;
  const array = new Uint8Array(24);
  window.crypto.getRandomValues(array);
  const secret = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  secretEl.value = 'whsec_' + secret;
}

async function submitWebhookForm(existingId) {
  const targetId = existingId || webhooksState.activeWebhookForEdit?.id || null;
  const nameEl = document.getElementById('wh-form-name');
  const urlEl = document.getElementById('wh-form-url');
  const methodEl = document.getElementById('wh-form-method');
  const colEl = document.getElementById('wh-form-collection');
  const evEl = document.getElementById('wh-form-event');
  const secretEl = document.getElementById('wh-form-secret');
  const headersEl = document.getElementById('wh-form-headers');
  const enabledEl = document.getElementById('wh-form-enabled');
  const saveBtn = document.getElementById('btn-save-webhook');

  const name = nameEl?.value?.trim();
  const url = urlEl?.value?.trim();
  const method = methodEl?.value || 'POST';
  const collection = colEl?.value || '*';
  const event = evEl?.value || 'created';
  const secret = secretEl?.value?.trim() || null;
  const enabled = Boolean(enabledEl?.checked);

  if (!name) {
    if (typeof toast === 'function') toast('Please enter a webhook name', 'warning');
    nameEl?.focus();
    return;
  }
  if (!url) {
    if (typeof toast === 'function') toast('Please enter a target HTTP URL', 'warning');
    urlEl?.focus();
    return;
  }

  let headers = {};
  if (headersEl && headersEl.value.trim()) {
    try {
      headers = JSON.parse(headersEl.value.trim());
    } catch {
      if (typeof toast === 'function') toast('Headers must be valid JSON', 'error');
      headersEl.focus();
      return;
    }
  }

  const payload = {
    name,
    url,
    method,
    collection,
    event,
    headers,
    secret,
    enabled,
  };

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    if (targetId) {
      await api(`/api/webhooks/${targetId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      if (typeof toast === 'function') toast('Webhook updated successfully', 'success');
    } else {
      await api('/api/webhooks', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (typeof toast === 'function') toast('Webhook created successfully', 'success');
    }

    closeWebhookModal();
    await loadWebhookStats();
    await loadWebhooksList();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to save webhook', 'error');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = targetId ? 'Save Changes' : 'Create Webhook';
    }
  }
}

async function openEditWebhookModal(id) {
  try {
    const webhook = await api(`/api/webhooks/${id}`);
    if (webhook) {
      openCreateWebhookModal(webhook);
    }
  } catch (err) {
    if (typeof toast === 'function') toast('Failed to load webhook: ' + err.message, 'error');
  }
}

function handleDeleteWebhookClick(btnEl) {
  if (!btnEl) return;
  const id = btnEl.getAttribute('data-id');
  const name = btnEl.getAttribute('data-name');
  deleteWebhook(id, name);
}

async function deleteWebhook(id, name) {
  const webhook = (webhooksState.webhooks || []).find(w => w.id === id);
  const webhookName = name || webhook?.name || 'this webhook';
  if (!confirm(`Are you sure you want to delete webhook "${webhookName}"?`)) {
    return;
  }
  try {
    await api(`/api/webhooks/${id}`, { method: 'DELETE' });
    if (typeof toast === 'function') toast('Webhook deleted', 'success');
    await loadWebhookStats();
    await loadWebhooksList();
  } catch (err) {
    if (typeof toast === 'function') toast('Failed to delete webhook: ' + err.message, 'error');
  }
}

// ==========================================
// Slide-Over Drawer: Delivery Details Inspection
// ==========================================

async function openDeliveryDetailDrawer(deliveryId) {
  try {
    const del = await api(`/api/webhooks/deliveries/${deliveryId}`);
    if (!del) return;

    let root = document.getElementById('drawer-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'drawer-root';
      document.body.appendChild(root);
    }

    const is2xx = del.responseStatus >= 200 && del.responseStatus < 300;
    const is4xx = del.responseStatus >= 400 && del.responseStatus < 500;
    const badgeClass = is2xx ? 'badge-status-2xx' : is4xx ? 'badge-status-4xx' : 'badge-status-5xx';
    const statusText = del.responseStatus > 0 ? `${del.responseStatus} ${del.status.toUpperCase()}` : 'FAILED (NETWORK)';

    root.innerHTML = `
      <div id="webhook-drawer-backdrop" class="drawer-backdrop" onclick="closeWebhookDrawer()" aria-hidden="true"></div>
      <aside id="webhook-drawer-panel" class="record-drawer webhook-drawer" role="dialog" aria-modal="true" aria-labelledby="webhook-drawer-title" tabindex="-1">
        <!-- Drawer Header -->
        <div class="drawer-header">
          <div class="drawer-title-area">
            <span class="badge-status-code ${badgeClass}">${escapeHtml(statusText)}</span>
            <div>
              <h3 class="drawer-title" id="webhook-drawer-title" style="margin:0; font-size:1.05rem;">
                ${escapeHtml(del.event)}
              </h3>
              <span style="font-size:11px; color:var(--text-muted);">${escapeHtml(del.webhookName)} • Attempt #${del.attempt || 1}</span>
            </div>
          </div>
          <div class="drawer-header-actions" style="display:flex; align-items:center; gap:6px;">
            <button class="drawer-close-btn" id="webhook-drawer-close-btn" onclick="closeWebhookDrawer()" aria-label="Close drawer">✕</button>
          </div>
        </div>

        <!-- Drawer Body -->
        <div class="drawer-body" style="padding:1.25rem 1.5rem; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:1.15rem;">
          <!-- Meta Grid -->
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(110px, 1fr)); gap:8px; background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:8px; padding:10px 14px; font-size:12px;">
            <div>
              <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Status</span>
              <strong style="color:${is2xx ? '#34d399' : '#f87171'};">${del.status.toUpperCase()} (${del.responseStatus || 0})</strong>
            </div>
            <div>
              <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Duration</span>
              <span>${del.durationMs}ms</span>
            </div>
            <div>
              <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Attempt</span>
              <span>#${del.attempt || 1}</span>
            </div>
            <div>
              <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Delivered</span>
              <span title="${del.created}">${formatRelativeTime(del.created)}</span>
            </div>
          </div>

          <!-- Error Alert Banner (if failed) -->
          ${del.error ? `
            <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:6px; padding:10px 14px; font-size:12px; color:#f87171;">
              <strong>Delivery Error:</strong> ${escapeHtml(del.error)}
            </div>
          ` : ''}

          <!-- Target Endpoint URL -->
          <div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
              <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted);">Target Endpoint URL</span>
              <button class="btn btn-secondary btn-sm" id="btn-copy-webhook-url" data-url="${escapeHtml(del.url)}" onclick="handleCopyWebhookUrl(this)" style="padding:2px 8px; font-size:10px;">Copy URL</button>
            </div>
            <div style="background:#090d16; border:1px solid var(--border-subtle); border-radius:6px; padding:8px 12px; font-family:'JetBrains Mono', monospace; font-size:12px; color:var(--text-main); word-break:break-all;">
              POST ${escapeHtml(del.url)}
            </div>
          </div>

          <!-- Outbound Request Card -->
          <div class="webhook-drawer-card">
            <div class="webhook-drawer-card-header">
              <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:#93c5fd;">Outbound Request</span>
              <button class="btn btn-secondary btn-sm" id="btn-copy-webhook-payload" onclick="handleCopyWebhookPayload()" style="padding:2px 8px; font-size:10px;">Copy Payload</button>
            </div>
            <div class="webhook-drawer-card-body">
              <div>
                <span style="font-size:10px; font-weight:700; text-transform:uppercase; color:var(--text-muted);">Request Headers</span>
                <pre class="webhook-code-preview" style="max-height:120px; margin-top:4px;">${escapeHtml(JSON.stringify(del.requestHeaders, null, 2))}</pre>
              </div>
              <div>
                <span style="font-size:10px; font-weight:700; text-transform:uppercase; color:var(--text-muted);">Payload Body (JSON)</span>
                <pre class="webhook-code-preview" id="wh-req-payload-code" style="max-height:200px; margin-top:4px;">${escapeHtml(JSON.stringify(del.requestPayload, null, 2))}</pre>
              </div>
            </div>
          </div>

          <!-- Endpoint Response Card -->
          <div class="webhook-drawer-card">
            <div class="webhook-drawer-card-header">
              <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:${is2xx ? '#34d399' : '#f87171'};">Endpoint Response</span>
              <span class="badge-status-code ${badgeClass}">${escapeHtml(statusText)}</span>
            </div>
            <div class="webhook-drawer-card-body">
              ${del.responseHeaders && Object.keys(del.responseHeaders).length > 0 ? `
                <div>
                  <span style="font-size:10px; font-weight:700; text-transform:uppercase; color:var(--text-muted);">Response Headers</span>
                  <pre class="webhook-code-preview" style="max-height:120px; margin-top:4px;">${escapeHtml(JSON.stringify(del.responseHeaders, null, 2))}</pre>
                </div>
              ` : ''}
              <div>
                <span style="font-size:10px; font-weight:700; text-transform:uppercase; color:var(--text-muted);">Response Body</span>
                <pre class="webhook-code-preview" style="max-height:200px; margin-top:4px;">${escapeHtml(del.responseBody || (del.error ? `Error: ${del.error}` : '(No response body)'))}</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- Drawer Footer -->
        <div class="drawer-footer" style="padding:1rem 1.5rem; border-top:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center; background:#11141d; flex-shrink:0;">
          <button class="btn-retry-action" id="drawer-retry-btn" data-id="${escapeHtml(del.id)}" onclick="retryWebhookDelivery(this.getAttribute('data-id'), this)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Retry Delivery Now
          </button>
          <button class="btn btn-secondary btn-sm" onclick="closeWebhookDrawer()">Close</button>
        </div>
      </aside>
    `;

    // Smooth slide-in animation
    const triggerDrawerOpen = () => {
      const backdrop = document.getElementById('webhook-drawer-backdrop');
      const panel = document.getElementById('webhook-drawer-panel');
      if (backdrop) backdrop.classList.add('open');
      if (panel) panel.classList.add('open');
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(triggerDrawerOpen);
    } else {
      triggerDrawerOpen();
    }
  } catch (err) {
    if (typeof toast === 'function') toast('Failed to load delivery details: ' + err.message, 'error');
  }
}

function closeWebhookDrawer() {
  const backdrop = document.getElementById('webhook-drawer-backdrop');
  const panel = document.getElementById('webhook-drawer-panel');
  if (backdrop) backdrop.classList.remove('open');
  if (panel) panel.classList.remove('open');
  setTimeout(() => {
    const root = document.getElementById('drawer-root');
    if (root && root.querySelector('#webhook-drawer-panel')) {
      root.innerHTML = '';
    }
  }, 280);
}

function handleCopyWebhookUrl(btnEl) {
  if (!btnEl) return;
  const url = btnEl.getAttribute('data-url') || '';
  copyWebhookText(url, 'URL copied!');
}

function handleCopyWebhookPayload() {
  const codeEl = document.getElementById('wh-req-payload-code');
  copyWebhookText(codeEl?.textContent || '', 'Payload copied!');
}

function copyWebhookText(text, msg) {
  if (!text) return;
  if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  if (typeof toast === 'function') toast(msg || 'Copied to clipboard!', 'info');
}

// Backward compatibility alias
const openDeliveryDetailModal = openDeliveryDetailDrawer;

// Helpers
function closeModalDirect(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.remove();
}

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  return date.toLocaleDateString();
}

// Global Exports
if (typeof window !== 'undefined') {
  window.renderWebhooksView = renderWebhooksView;
  window.refreshWebhooksView = refreshWebhooksView;
  window.switchWebhooksTab = switchWebhooksTab;
  window.loadWebhookStats = loadWebhookStats;
  window.loadWebhooksList = loadWebhooksList;
  window.loadWebhookDeliveries = loadWebhookDeliveries;
  window.openCreateWebhookModal = openCreateWebhookModal;
  window.openEditWebhookModal = openEditWebhookModal;
  window.deleteWebhook = deleteWebhook;
  window.handleDeleteWebhookClick = handleDeleteWebhookClick;
  window.updateWebhookEventPreview = updateWebhookEventPreview;
  window.generateRandomWebhookSecret = generateRandomWebhookSecret;
  window.submitWebhookForm = submitWebhookForm;
  window.openDeliveryDetailModal = openDeliveryDetailModal;
  window.openDeliveryDetailDrawer = openDeliveryDetailDrawer;
  window.closeWebhookDrawer = closeWebhookDrawer;
  window.closeWebhookModal = closeWebhookModal;
  window.retryWebhookDelivery = retryWebhookDelivery;
  window.triggerTestWebhook = triggerTestWebhook;
  window.clearAllDeliveryLogs = clearAllDeliveryLogs;
  window.handleDeliveryFilterChange = handleDeliveryFilterChange;
  window.clearDeliveryFilters = clearDeliveryFilters;
  window.changeDeliveryPage = changeDeliveryPage;
  window.closeModalDirect = closeModalDirect;
  window.viewWebhookDeliveries = viewWebhookDeliveries;
  window.handleCopyWebhookUrl = handleCopyWebhookUrl;
  window.handleCopyWebhookPayload = handleCopyWebhookPayload;
  window.copyWebhookText = copyWebhookText;
}

// Automatically load webhook stats if admin token exists
if (typeof state !== 'undefined' && state.token) {
  loadWebhookStats();
}
