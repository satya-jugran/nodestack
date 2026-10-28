// Serverless Functions Manager Module for NodeStack Admin UI
// Core state, functions overview list, and global execution logs

// ==========================================
// 1. State & Constants
// ==========================================

let functionsState = {
  currentView: 'list', // 'list' | 'editor'
  subTab: 'functions', // 'functions' | 'logs'
  editorTab: 'code', // 'code' | 'test' | 'config' | 'logs'
  isCtxRefExpanded: false, // vertically collapsible, collapsed by default
  cmEditor: null, // active CodeMirror instance
  functions: [],
  stats: {
    totalFunctions: 0,
    activeFunctions: 0,
    totalExecutions: 0,
    successExecutions: 0,
    failedExecutions: 0,
    successRate: '100%',
  },
  logs: [],
  editorLogs: [],
  logFilter: {
    functionId: '',
    status: 'all',
    page: 1,
    perPage: 25,
    totalItems: 0,
    totalPages: 1,
  },
  activeFunctionForEdit: null,
};

if (typeof window !== 'undefined') {
  window.functionsState = functionsState;
}

const STARTER_RECIPES = {
  starter: `// Serverless Function Starter
export default async function(ctx) {
  ctx.log("Invoked function in app:", ctx.app.slug);
  const name = ctx.request.body?.name || "World";
  return {
    status: 200,
    body: { message: "Hello, " + name + "!" }
  };
}`,
  discount: `// Calculate cart discount with RuleEngine access rules preserved
export default async function(ctx) {
  const { cartTotal, couponCode } = ctx.request.body || {};
  let discountRate = 0;

  if (couponCode === "SAVE20") {
    discountRate = 0.20;
  } else if (couponCode === "VIP50" && ctx.request.auth) {
    discountRate = 0.50;
  }

  const discount = (cartTotal || 0) * discountRate;
  const finalTotal = Math.max(0, (cartTotal || 0) - discount);

  return {
    status: 200,
    headers: { 'x-applied-rate': (discountRate * 100) + '%' },
    body: {
      originalTotal: cartTotal,
      discount: discount,
      finalTotal: finalTotal
    }
  };
}`,
  hook: `// Lifecycle Hook: validate and enrich records before creation
export default async function(ctx) {
  if (ctx.event && ctx.event.record) {
    const record = ctx.event.record;
    
    // 1. Validation guardrail
    if (record.amount !== undefined && record.amount < 0) {
      return { status: 400, body: { cancel: true, reason: "Amount cannot be negative" } };
    }
    
    // 2. Data enrichment / normalization
    if (record.title) {
      record.slug = record.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }
    record.status = "processed";
    
    return { status: 200, body: { record: record } };
  }
  return { status: 200 };
}`,
  fetch: `// Outbound HTTP Integration with SSRF Guardrails
export default async function(ctx) {
  // Guarded fetch rejects private IPs, loopback, and cloud metadata
  const res = await ctx.fetch('https://httpbin.org/json');
  const data = await res.json();
  
  return {
    status: 200,
    body: {
      origin: data.origin,
      url: data.url,
      timestamp: new Date().toISOString()
    }
  };
}`
};

if (typeof window !== 'undefined') {
  window.STARTER_RECIPES = STARTER_RECIPES;
}

// ==========================================
// 2. Functions Overview Page & Statistics
// ==========================================

function renderFunctionsView() {
  if (functionsState.currentView === 'editor' && functionsState.activeFunctionForEdit) {
    if (typeof renderFunctionEditorView === 'function') {
      renderFunctionEditorView(functionsState.activeFunctionForEdit);
    }
    return;
  }

  const container = document.getElementById('page-view-functions') || document.getElementById('main-body');
  if (!container) return;

  container.innerHTML = `
    <div class="webhooks-container" style="max-width: 1400px; margin: 0 auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem;">
      <!-- Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2 style="font-size: 1.35rem; font-weight: 700; color: var(--text-main); margin: 0 0 0.25rem 0; display: flex; align-items: center; gap: 0.5rem;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
            Serverless Functions
          </h2>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">
            Sandboxed in-engine JavaScript/TypeScript lambda functions wired to API endpoints and lifecycle hooks.
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="btn btn-secondary btn-sm" onclick="refreshFunctionsView()" title="Refresh Functions & Stats">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
          <button class="btn btn-primary btn-sm" onclick="openCreateFunctionPage()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Function
          </button>
        </div>
      </div>

      <!-- Stats Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Active Functions</span>
          <div class="webhook-stat-value">
            <span id="fn-stat-active">0</span>
            <span class="webhook-stat-subtext" id="fn-stat-total">/ 0 total</span>
          </div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Total Executions</span>
          <div class="webhook-stat-value" id="fn-stat-executions">0</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Success Rate</span>
          <div class="webhook-stat-value" style="color: var(--accent-success);" id="fn-stat-rate">100%</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Failed Runs</span>
          <div class="webhook-stat-value" style="color: var(--accent-danger);" id="fn-stat-failed">0</div>
        </div>
      </div>

      <!-- Subtabs Bar -->
      <div class="webhooks-tabs-bar" style="display: flex; align-items: center; gap: 0.5rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.5rem;">
        <button class="webhook-tab-btn ${functionsState.subTab === 'functions' ? 'active' : ''}" id="tab-btn-fn-list" onclick="switchFunctionsTab('functions')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          Configured Functions
        </button>
        <button class="webhook-tab-btn ${functionsState.subTab === 'logs' ? 'active' : ''}" id="tab-btn-fn-logs" onclick="switchFunctionsTab('logs')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Execution History & Logs
        </button>
      </div>

      <!-- Tab Content Area -->
      <div id="functions-tab-content"></div>
    </div>
  `;

  loadFunctionStats();
  if (functionsState.subTab === 'functions') {
    loadFunctionsList();
  } else {
    loadFunctionLogs();
  }
}

function switchFunctionsTab(tab, pushState = true) {
  functionsState.subTab = tab;
  document.getElementById('tab-btn-fn-list')?.classList.toggle('active', tab === 'functions');
  document.getElementById('tab-btn-fn-logs')?.classList.toggle('active', tab === 'logs');

  if (pushState) {
    const path = (tab === 'logs') ? '/_/functions/logs' : '/_/functions';
    if (typeof updateUrl === 'function') {
      updateUrl(path);
    }
  }

  if (typeof updateBreadcrumbs === 'function') {
    updateBreadcrumbs();
  }

  if (tab === 'functions') {
    loadFunctionsList();
  } else {
    loadFunctionLogs();
  }
}

async function refreshFunctionsView() {
  await loadFunctionStats();
  if (functionsState.subTab === 'functions') {
    await loadFunctionsList();
  } else {
    await loadFunctionLogs();
  }
  toast('Functions data refreshed', 'info');
}

async function loadFunctionStats() {
  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const endpoint = slug && slug !== 'default' ? `/api/apps/${slug}/functions/stats` : '/api/functions/stats';
    const res = await api(endpoint);
    if (res) {
      functionsState.stats = res;
      const elActive = document.getElementById('fn-stat-active');
      const elTotal = document.getElementById('fn-stat-total');
      const elExec = document.getElementById('fn-stat-executions');
      const elRate = document.getElementById('fn-stat-rate');
      const elFailed = document.getElementById('fn-stat-failed');

      if (elActive) elActive.textContent = res.activeFunctions || 0;
      if (elTotal) elTotal.textContent = `/ ${res.totalFunctions || 0} total`;
      if (elExec) elExec.textContent = res.totalExecutions || 0;
      if (elRate) elRate.textContent = res.successRate || '100%';
      if (elFailed) elFailed.textContent = res.failedExecutions || 0;

      // Update sidebar counter badge
      const sidebarBadge = document.getElementById('sidebar-functions-count');
      if (sidebarBadge) {
        sidebarBadge.textContent = res.totalFunctions || 0;
        sidebarBadge.style.display = (res.totalFunctions > 0) ? 'inline-block' : 'none';
      }
    }
  } catch (err) {
    console.warn('Failed to load function stats:', err);
  }
}

async function loadFunctionsList() {
  const container = document.getElementById('functions-tab-content');
  if (!container) return;

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; padding: 4rem; color: var(--text-muted);">
      <span class="spinner" style="margin-right: 8px;"></span> Loading serverless functions...
    </div>
  `;

  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const endpoint = slug && slug !== 'default' ? `/api/apps/${slug}/functions` : '/api/functions';
    const list = await api(endpoint);
    functionsState.functions = Array.isArray(list) ? list : [];

    // Sync count badge
    const count = functionsState.functions.length;
    const sidebarBadge = document.getElementById('sidebar-functions-count');
    if (sidebarBadge) {
      sidebarBadge.textContent = count;
      sidebarBadge.style.display = count > 0 ? 'inline-block' : 'none';
    }

    renderFunctionsTable(functionsState.functions);
  } catch (err) {
    container.innerHTML = `
      <div class="card" style="padding: 2rem; text-align: center; color: var(--accent-danger);">
        <p>Failed to load functions: ${escapeHtml(err.message || String(err))}</p>
        <button class="btn btn-secondary btn-sm" onclick="loadFunctionsList()">Try Again</button>
      </div>
    `;
  }
}

function renderFunctionsTable(functions) {
  const container = document.getElementById('functions-tab-content');
  if (!container) return;

  if (!functions || functions.length === 0) {
    container.innerHTML = `
      <div class="card" style="padding: 3.5rem 1.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1rem;">
        <div style="width: 56px; height: 56px; border-radius: 50%; background: var(--bg-card-hover); display: flex; align-items: center; justify-content: center; color: var(--accent-primary);">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        </div>
        <div>
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 600;">No Serverless Functions Yet</h3>
          <p style="margin: 0; color: var(--text-muted); font-size: 0.875rem; max-width: 480px;">
            Create lightweight, sandboxed functions to implement custom backend logic, third-party webhooks, and database triggers.
          </p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openCreateFunctionPage()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create First Function
        </button>
      </div>
    `;
    return;
  }

  const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
  const invokePrefix = slug && slug !== 'default' ? `/api/apps/${slug}/functions` : '/api/functions';

  const rows = functions.map(fn => {
    const isEnabled = fn.enabled !== false;
    const authBadgeClass = fn.authPolicy === 'public' ? 'badge-success' : (fn.authPolicy === 'admin' ? 'badge-danger' : 'badge-primary');
    const authLabel = (fn.authPolicy || 'public').toUpperCase();
    const invokePath = `${invokePrefix}/${fn.name}/invoke`;

    return `
      <tr style="border-bottom: 1px solid var(--border-subtle); transition: background 0.15s ease;">
        <td style="padding: 12px 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="status-indicator ${isEnabled ? 'status-active' : 'status-inactive'}" title="${isEnabled ? 'Active' : 'Disabled'}"></span>
            <div>
              <a href="javascript:void(0)" onclick="openFunctionEditor('${fn.id}')" style="font-weight: 600; color: var(--accent-primary); text-decoration: none; font-size: 13.5px; font-family: monospace;">
                ${escapeHtml(fn.name)}
              </a>
              ${fn.description ? `<div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">${escapeHtml(fn.description)}</div>` : ''}
            </div>
          </div>
        </td>
        <td style="padding: 12px 16px;">
          <span class="badge ${authBadgeClass}" style="font-size: 11px;">${authLabel}</span>
          ${fn.elevated ? '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-size: 10px; margin-left: 4px;" title="Runs with elevated privileges">Elevated</span>' : ''}
        </td>
        <td style="padding: 12px 16px; font-size: 12px;">
          ${fn.eventTrigger ? `<code style="font-size: 11.5px; background: var(--bg-card-hover); padding: 2px 6px; border-radius: 4px; color: var(--text-heading);">${escapeHtml(fn.eventTrigger)}</code>` : '<span style="color: var(--text-muted);">None (HTTP only)</span>'}
        </td>
        <td style="padding: 12px 16px; font-size: 11.5px; font-family: monospace; color: var(--text-muted);">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span>ANY ${escapeHtml(invokePath)}</span>
            <button class="btn btn-secondary btn-sm" onclick="copyFunctionEndpoint('${invokePath}')" style="padding: 1px 6px; font-size: 10px;" title="Copy endpoint">
              📋
            </button>
          </div>
        </td>
        <td style="padding: 12px 16px; font-size: 12px; color: var(--text-muted);">
          ${fn.timeoutMs || 1000}ms / ${fn.memoryLimitMb || 32}MB
        </td>
        <td style="padding: 12px 16px; text-align: right;">
          <div style="display: inline-flex; align-items: center; gap: 6px;">
            <button class="btn btn-secondary btn-sm" onclick="openFunctionEditor('${fn.id}', true, 'test')" title="Test Function in Sandbox">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Test
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openFunctionEditor('${fn.id}', true, 'code')" title="Edit Code & Configuration">
              Edit
            </button>
            <button class="btn btn-secondary btn-sm" onclick="toggleFunctionEnabled('${fn.id}', ${!isEnabled})" title="${isEnabled ? 'Disable function' : 'Enable function'}">
              ${isEnabled ? 'Disable' : 'Enable'}
            </button>
            <button class="btn btn-secondary btn-sm" onclick="deleteFunctionPrompt('${fn.id}', '${escapeHtml(fn.name)}')" style="color: var(--accent-danger);" title="Delete function">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="card" style="padding: 0; overflow: hidden;">
      <div style="overflow-x: auto;">
        <table class="table" style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border-subtle); background: var(--bg-card-hover);">
              <th style="padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Function</th>
              <th style="padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Auth Policy</th>
              <th style="padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Hook Trigger</th>
              <th style="padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Invoke Endpoint</th>
              <th style="padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Limits</th>
              <th style="padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function toggleFunctionEnabled(id, enabled) {
  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const endpoint = slug && slug !== 'default' ? `/api/apps/${slug}/functions/${id}` : `/api/functions/${id}`;
    await api(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    toast(`Function ${enabled ? 'enabled' : 'disabled'}`, 'info');
    await loadFunctionStats();
    await loadFunctionsList();
  } catch (err) {
    toast(err.message || 'Failed to toggle status', 'error');
  }
}

async function deleteFunctionPrompt(id, name) {
  if (!confirm(`Are you sure you want to delete function '${name}'? All invocation history will be removed.`)) {
    return;
  }
  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const endpoint = slug && slug !== 'default' ? `/api/apps/${slug}/functions/${id}` : `/api/functions/${id}`;
    await api(endpoint, { method: 'DELETE' });
    toast(`Function '${name}' deleted`, 'info');
    await loadFunctionStats();
    await loadFunctionsList();
  } catch (err) {
    toast(err.message || 'Failed to delete function', 'error');
  }
}

function copyFunctionEndpoint(path) {
  const fullUrl = window.location.origin + path;
  if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(fullUrl).then(() => {
      toast('Copied function endpoint URL to clipboard', 'info');
    }).catch(() => {
      prompt('Copy function endpoint URL:', fullUrl);
    });
  } else {
    prompt('Copy function endpoint URL:', fullUrl);
  }
}

// ==========================================
// 3. Global Execution History & Logs
// ==========================================

async function loadFunctionLogs(page = 1) {
  const container = document.getElementById('functions-tab-content');
  if (!container) return;

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; padding: 4rem; color: var(--text-muted);">
      <span class="spinner" style="margin-right: 8px;"></span> Loading invocation logs...
    </div>
  `;

  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const baseUrl = slug && slug !== 'default' ? `/api/apps/${slug}/functions/logs` : '/api/functions/logs';
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(functionsState.logFilter.perPage || 25),
    });
    if (functionsState.logFilter.functionId) {
      params.append('functionId', functionsState.logFilter.functionId);
    }
    if (functionsState.logFilter.status && functionsState.logFilter.status !== 'all') {
      params.append('status', functionsState.logFilter.status);
    }

    const res = await api(`${baseUrl}?${params.toString()}`);
    functionsState.logs = res.items || [];
    functionsState.logFilter.page = res.page || 1;
    functionsState.logFilter.totalItems = res.totalItems || 0;
    functionsState.logFilter.totalPages = res.totalPages || 1;

    renderFunctionLogsTable(functionsState.logs);
  } catch (err) {
    container.innerHTML = `
      <div class="card" style="padding: 2rem; text-align: center; color: var(--accent-danger);">
        <p>Failed to load logs: ${escapeHtml(err.message || String(err))}</p>
        <button class="btn btn-secondary btn-sm" onclick="loadFunctionLogs()">Try Again</button>
      </div>
    `;
  }
}

function renderFunctionLogsTable(logs) {
  const container = document.getElementById('functions-tab-content');
  if (!container) return;

  const fnOptions = (functionsState.functions || []).map(f => `
    <option value="${f.id}" ${functionsState.logFilter.functionId === f.id ? 'selected' : ''}>
      ${escapeHtml(f.name)}
    </option>
  `).join('');

  if (!logs || logs.length === 0) {
    container.innerHTML = `
      <div class="card" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <select class="input" style="font-size: 12px; padding: 4px 8px;" onchange="filterFunctionLogs(this.value)">
              <option value="">All Functions</option>
              ${fnOptions}
            </select>
          </div>
        </div>
        <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
          No execution logs recorded yet.
        </div>
      </div>
    `;
    return;
  }

  const rows = logs.map(l => {
    const isOk = l.status === 'success';
    const statusBadge = isOk
      ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-size: 11px;">${l.statusCode || 200} OK</span>`
      : `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-size: 11px;">${escapeHtml(l.status.toUpperCase())}</span>`;

    return `
      <tr style="border-bottom: 1px solid var(--border-subtle);">
        <td style="padding: 10px 14px; font-size: 12px; color: var(--text-muted);">${formatTimestamp(l.timestamp || l.createdAt)}</td>
        <td style="padding: 10px 14px;">
          <a href="javascript:void(0)" onclick="openFunctionEditor('${l.functionId}', true, 'logs')" style="font-weight: 600; color: var(--accent-primary); text-decoration: none; font-family: monospace; font-size: 12px;">
            ${escapeHtml(l.functionName || l.functionId)}
          </a>
        </td>
        <td style="padding: 10px 14px;">${statusBadge}</td>
        <td style="padding: 10px 14px; font-size: 12px; font-weight: 600;">${l.durationMs}ms</td>
        <td style="padding: 10px 14px;"><code style="font-size: 11px;">${escapeHtml(l.method || 'POST')}</code></td>
        <td style="padding: 10px 14px; font-size: 12px; color: var(--text-muted);">${escapeHtml(l.actorId || 'public')}</td>
        <td style="padding: 10px 14px; text-align: right;">
          <button class="btn btn-secondary btn-sm" onclick="viewLogPayload('${l.id}')" title="Inspect Request/Response payload" style="font-size: 11px; padding: 2px 8px;">
            Inspect
          </button>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="card" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <select class="input" style="font-size: 12px; padding: 4px 8px;" onchange="filterFunctionLogs(this.value)">
            <option value="">All Functions</option>
            ${fnOptions}
          </select>
          <span style="font-size: 12px; color: var(--text-muted);">
            Showing ${logs.length} of ${functionsState.logFilter.totalItems || logs.length} logs
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="btn btn-secondary btn-sm" onclick="loadFunctionLogs(${functionsState.logFilter.page || 1})">
            Refresh
          </button>
        </div>
      </div>

      <div style="overflow-x: auto; border: 1px solid var(--border-subtle); border-radius: 6px;">
        <table class="table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border-subtle); background: var(--bg-card-hover);">
              <th style="padding: 10px 14px; font-size: 11.5px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Timestamp</th>
              <th style="padding: 10px 14px; font-size: 11.5px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Function</th>
              <th style="padding: 10px 14px; font-size: 11.5px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Status</th>
              <th style="padding: 10px 14px; font-size: 11.5px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Latency</th>
              <th style="padding: 10px 14px; font-size: 11.5px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Method</th>
              <th style="padding: 10px 14px; font-size: 11.5px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Caller</th>
              <th style="padding: 10px 14px; font-size: 11.5px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; text-align: right;">Payload</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function filterFunctionLogs(fnId) {
  functionsState.logFilter.functionId = fnId || '';
  loadFunctionLogs(1);
}

function viewFunctionLogs(functionId) {
  switchFunctionsTab('logs');
  filterFunctionLogs(functionId);
}

async function viewLogPayload(logId) {
  let log = (functionsState.editorLogs || []).find(l => l.id === logId)
    || (functionsState.logs || []).find(l => l.id === logId);

  if (!log) {
    try {
      const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
      const baseUrl = slug && slug !== 'default' ? `/api/apps/${slug}/functions/logs` : '/api/functions/logs';
      const res = await api(`${baseUrl}?perPage=100`);
      if (res && res.items) {
        log = res.items.find(l => l.id === logId);
      }
    } catch (_) {}
  }

  if (!log) {
    if (typeof toast === 'function') toast('Execution log details not found', 'warning');
    return;
  }

  let modalRoot = document.getElementById('modal-root');
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'modal-root';
    document.body.appendChild(modalRoot);
  }

  let consoleOutput = '(No console output logged)';
  if (log.logs) {
    if (Array.isArray(log.logs) && log.logs.length > 0) {
      consoleOutput = log.logs.join('\n');
    } else if (typeof log.logs === 'string' && log.logs.trim().length > 0) {
      consoleOutput = log.logs;
    }
  }

  let reqFormatted = '{}';
  if (log.requestPayload) {
    try {
      reqFormatted = JSON.stringify(typeof log.requestPayload === 'string' ? JSON.parse(log.requestPayload) : log.requestPayload, null, 2);
    } catch {
      reqFormatted = String(log.requestPayload);
    }
  }

  let resFormatted = '{}';
  if (log.responsePayload) {
    try {
      resFormatted = JSON.stringify(typeof log.responsePayload === 'string' ? JSON.parse(log.responsePayload) : log.responsePayload, null, 2);
    } catch {
      resFormatted = String(log.error || log.responsePayload);
    }
  } else if (log.error) {
    resFormatted = String(log.error);
  }

  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="this.remove()">
      <div class="modal-dialog" style="max-width: 720px; width: 95%; max-height: 85vh; display: flex; flex-direction: column; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-subtle); overflow: hidden;" onclick="event.stopPropagation()">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--border-subtle);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <h3 style="margin: 0; font-size: 1.1rem; font-weight: 600;">Execution Payload Inspector</h3>
            <span class="badge" style="font-size: 11px;">${log.durationMs}ms</span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="this.closest('.modal-backdrop').remove()" style="border: none; font-size: 18px; line-height: 1;">✕</button>
        </div>
        <div style="flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px;">
          <div>
            <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--text-muted);">Console Output Logs</label>
            <pre style="background: #0f172a; color: #38bdf8; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 11px; max-height: 140px; overflow-y: auto; margin: 0; white-space: pre-wrap;">${escapeHtml(consoleOutput)}</pre>
          </div>
          <div>
            <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--text-muted);">Request Payload</label>
            <pre style="background: var(--bg-card-hover); padding: 10px; border-radius: 6px; font-family: monospace; font-size: 11px; max-height: 160px; overflow-y: auto; margin: 0;">${escapeHtml(reqFormatted)}</pre>
          </div>
          <div>
            <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--text-muted);">Response Payload</label>
            <pre style="background: var(--bg-card-hover); padding: 10px; border-radius: 6px; font-family: monospace; font-size: 11px; max-height: 180px; overflow-y: auto; margin: 0; color: ${log.status === 'success' ? '#a7f3d0' : '#f87171'};">${escapeHtml(resFormatted)}</pre>
          </div>
        </div>
        <div style="padding: 12px 20px; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end;">
          <button class="btn btn-secondary btn-sm" onclick="this.closest('.modal-backdrop').remove()">Close</button>
        </div>
      </div>
    </div>
  `;
}

async function clearAllFunctionLogs() {
  if (!confirm('Are you sure you want to clear execution logs? This cannot be undone.')) return;
  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const endpoint = slug && slug !== 'default' ? `/api/apps/${slug}/functions/logs` : '/api/functions/logs';
    await api(endpoint, { method: 'DELETE' });
    toast('Execution logs cleared', 'info');
    await loadFunctionLogs();
  } catch (err) {
    toast(err.message || 'Failed to clear logs', 'error');
  }
}

function formatTimestamp(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString();
  } catch {
    return iso;
  }
}

// Forwarders for workbench functions
function openFunctionEditor(idOrName = 'new', pushState = true, initialTab = 'code') {
  if (typeof window.openFunctionEditor === 'function' && window.openFunctionEditor !== openFunctionEditor) {
    return window.openFunctionEditor(idOrName, pushState, initialTab);
  }
}

function openCreateFunctionPage() {
  if (typeof window.openCreateFunctionPage === 'function' && window.openCreateFunctionPage !== openCreateFunctionPage) {
    return window.openCreateFunctionPage();
  }
}

// ==========================================
// 4. Global Exports & Startup Hook
// ==========================================

if (typeof window !== 'undefined') {
  window.functionsState = functionsState;
  window.STARTER_RECIPES = STARTER_RECIPES;
  window.renderFunctionsView = renderFunctionsView;
  window.switchFunctionsTab = switchFunctionsTab;
  window.refreshFunctionsView = refreshFunctionsView;
  window.loadFunctionStats = loadFunctionStats;
  window.loadFunctionsList = loadFunctionsList;
  window.renderFunctionsTable = renderFunctionsTable;
  window.toggleFunctionEnabled = toggleFunctionEnabled;
  window.deleteFunctionPrompt = deleteFunctionPrompt;
  window.copyFunctionEndpoint = copyFunctionEndpoint;
  window.openFunctionEditor = window.openFunctionEditor || openFunctionEditor;
  window.openCreateFunctionPage = window.openCreateFunctionPage || openCreateFunctionPage;
  window.loadFunctionLogs = loadFunctionLogs;
  window.renderFunctionLogsTable = renderFunctionLogsTable;
  window.filterFunctionLogs = filterFunctionLogs;
  window.viewFunctionLogs = viewFunctionLogs;
  window.viewLogPayload = viewLogPayload;
  window.clearAllFunctionLogs = clearAllFunctionLogs;
  window.formatTimestamp = formatTimestamp;
}

if (typeof state !== 'undefined' && state.token && typeof loadFunctionStats === 'function') {
  loadFunctionStats();
}
