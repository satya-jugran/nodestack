// Serverless Functions Manager Module for NodeStack Admin UI

let functionsState = {
  subTab: 'functions', // 'functions' | 'logs'
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
  const name = ctx.request.body.name || "World";
  return {
    status: 200,
    body: { message: "Hello, " + name + "!" }
  };
}`,
  discount: `// Calculate cart discount with RuleEngine access rules preserved
export default async function(ctx) {
  const { cartTotal, couponCode } = ctx.request.body;
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
      externalData: data,
      timestamp: new Date().toISOString()
    }
  };
}`
};

function renderFunctionsView() {
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
          <button class="btn btn-primary btn-sm" onclick="openCreateFunctionModal()">
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

// ==========================================
// API Operations
// ==========================================

async function loadFunctionStats() {
  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const endpoint = slug && slug !== 'default' ? `/api/apps/${slug}/functions/stats` : '/api/functions/stats';
    const res = await api(endpoint);
    if (res) {
      functionsState.stats = res;
      const act = document.getElementById('fn-stat-active');
      const tot = document.getElementById('fn-stat-total');
      const exec = document.getElementById('fn-stat-executions');
      const rate = document.getElementById('fn-stat-rate');
      const fail = document.getElementById('fn-stat-failed');

      if (act) act.textContent = res.activeFunctions || 0;
      if (tot) tot.textContent = `/ ${res.totalFunctions || 0} total`;
      if (exec) exec.textContent = res.totalExecutions || 0;
      if (rate) rate.textContent = res.successRate || '100%';
      if (fail) fail.textContent = res.failedExecutions || 0;

      // Update sidebar badge
      const badge = document.getElementById('sidebar-functions-count') || document.getElementById('sidebar-functions-badge');
      if (badge) {
        const count = res.totalFunctions !== undefined ? res.totalFunctions : (res.activeFunctions || 0);
        badge.textContent = String(count);
        badge.title = `${res.activeFunctions || 0} active / ${res.totalFunctions || 0} total`;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
      }

      // Update overview home card if present
      const homeFnEl = document.getElementById('home-stat-functions');
      const homeFnSubEl = document.getElementById('home-stat-functions-sub');
      if (homeFnEl) {
        homeFnEl.textContent = (res.totalFunctions !== undefined ? res.totalFunctions : (res.activeFunctions || 0)).toString();
      }
      if (homeFnSubEl) {
        const active = res.activeFunctions || 0;
        const execs = res.totalExecutions || 0;
        homeFnSubEl.textContent = `${active} active${execs > 0 ? ` • ${execs} runs` : ' • 0 runs'}`;
      }
    }
  } catch (_) {}
}

async function loadFunctionsList() {
  const container = document.getElementById('functions-tab-content');
  if (!container) return;

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; padding: 3rem; color: var(--text-muted);">
      <span class="spinner" style="margin-right: 8px;"></span> Loading serverless functions...
    </div>
  `;

  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const endpoint = slug && slug !== 'default' ? `/api/apps/${slug}/functions` : '/api/functions';
    const list = await api(endpoint);
    functionsState.functions = Array.isArray(list) ? list : [];
    const badge = document.getElementById('sidebar-functions-count') || document.getElementById('sidebar-functions-badge');
    if (badge) {
      const count = functionsState.functions.length;
      badge.textContent = String(count);
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
    renderFunctionsTable(functionsState.functions);
  } catch (err) {
    container.innerHTML = `
      <div class="card" style="padding: 2rem; text-align: center; color: var(--accent-danger);">
        Failed to load functions: ${escapeHtml(err.message || String(err))}
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
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1.15rem; font-weight: 600;">No Serverless Functions Yet</h3>
          <p style="margin: 0; color: var(--text-muted); font-size: 0.875rem; max-width: 480px;">
            Create your first lambda function to execute custom business logic, Stripe workflows, and row-level data transformations.
          </p>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openCreateFunctionModal()">
          + Create First Function
        </button>
      </div>
    `;
    return;
  }

  const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';

  const rowsHtml = functions.map(fn => {
    const invokePath = slug && slug !== 'default'
      ? `/api/apps/${slug}/functions/${fn.name}/invoke`
      : `/api/functions/${fn.name}/invoke`;

    let triggerBadge = `<code style="font-size: 11px; background: var(--bg-card-hover); padding: 2px 6px; border-radius: 4px;">ANY ${invokePath}</code>`;
    if (fn.eventTrigger) {
      triggerBadge += `<div style="font-size: 11px; color: var(--accent-primary); margin-top: 4px;">⚡ Hook: ${escapeHtml(fn.eventTrigger)}</div>`;
    }

    let authBadge = '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">Public</span>';
    if (fn.authPolicy === 'auth') {
      authBadge = '<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6;">User Token</span>';
    } else if (fn.authPolicy === 'admin') {
      authBadge = '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">Admin Only</span>';
    } else if (fn.authPolicy === 'apiKey') {
      authBadge = '<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #a855f7;">API Key</span>';
    }

    if (fn.elevated) {
      authBadge += ' <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444;" title="Runs with elevated service-role bypassing access rules">Elevated</span>';
    }

    return `
      <tr>
        <td style="font-weight: 600;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-family: monospace; font-size: 13px; color: var(--text-main);">${escapeHtml(fn.name)}</span>
            ${!fn.enabled ? '<span class="badge" style="background: var(--bg-card-hover); color: var(--text-muted); font-size: 10px;">Disabled</span>' : ''}
          </div>
          ${fn.description ? `<div style="font-size: 11px; color: var(--text-muted); font-weight: normal; margin-top: 2px;">${escapeHtml(fn.description)}</div>` : ''}
        </td>
        <td>${triggerBadge}</td>
        <td>${authBadge}</td>
        <td style="font-size: 12px; color: var(--text-muted);">
          <span>${fn.timeoutMs}ms</span> / <span>${fn.memoryLimitMb}MB</span>
        </td>
        <td>
          <label class="toggle-switch" style="position: relative; display: inline-block; width: 34px; height: 18px; margin: 0;">
            <input type="checkbox" ${fn.enabled ? 'checked' : ''} onchange="toggleFunctionEnabled('${fn.id}', this.checked)" style="opacity: 0; width: 0; height: 0;">
            <span class="toggle-slider" style="position: absolute; cursor: pointer; inset: 0; background-color: ${fn.enabled ? 'var(--accent-primary)' : 'var(--bg-card-hover)'}; border-radius: 18px; transition: 0.2s;"></span>
          </label>
        </td>
        <td style="text-align: right;">
          <div style="display: inline-flex; align-items: center; gap: 6px;">
            <button class="btn btn-secondary btn-sm" onclick="openTestFunctionModal('${fn.id}')" title="Test Live in Sandbox">
              ▶ Test
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openEditFunctionModal('${fn.id}')" title="Edit Code & Config">
              ✎ Edit
            </button>
            <button class="btn btn-secondary btn-sm" onclick="viewFunctionLogs('${fn.id}')" title="View Logs">
              Logs
            </button>
            <button class="btn btn-secondary btn-sm" onclick="deleteFunctionPrompt('${fn.id}', '${escapeHtml(fn.name)}')" title="Delete Function" style="color: var(--accent-danger);">
              ✕
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="card" style="overflow: hidden; padding: 0;">
      <div style="overflow-x: auto;">
        <table class="table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border-subtle); background: var(--bg-card);">
              <th style="text-align: left; padding: 10px 16px;">Function Name</th>
              <th style="text-align: left; padding: 10px 16px;">Trigger & Endpoint</th>
              <th style="text-align: left; padding: 10px 16px;">Auth Policy</th>
              <th style="text-align: left; padding: 10px 16px;">Limits</th>
              <th style="text-align: left; padding: 10px 16px;">Active</th>
              <th style="text-align: right; padding: 10px 16px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ==========================================
// Function Modal: Create & Edit
// ==========================================

function openCreateFunctionModal() {
  functionsState.activeFunctionForEdit = null;
  renderFunctionModal({
    isNew: true,
    id: '',
    name: '',
    description: '',
    code: STARTER_RECIPES.starter,
    enabled: true,
    authPolicy: 'public',
    methods: ['GET', 'POST'],
    eventTrigger: '',
    timeoutMs: 1000,
    memoryLimitMb: 32,
    allowedDomains: [],
    elevated: false,
    env: {},
  });
}

function openEditFunctionModal(id) {
  const fn = functionsState.functions.find(f => f.id === id);
  if (!fn) return;
  functionsState.activeFunctionForEdit = fn;
  renderFunctionModal({
    isNew: false,
    ...fn
  });
}

function renderFunctionModal(fnData) {
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return;

  const envString = fnData.env && Object.keys(fnData.env).length > 0
    ? JSON.stringify(fnData.env, null, 2)
    : '{}';

  const allowedDomainsString = (fnData.allowedDomains || []).join(', ');

  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="closeFunctionModal(event)">
      <div class="modal-dialog" style="max-width: 850px; width: 95%; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-subtle);" onclick="event.stopPropagation()">
        
        <!-- Modal Header -->
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--border-subtle);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            <h3 style="margin: 0; font-size: 1.1rem; font-weight: 600;">
              ${fnData.isNew ? 'New Serverless Function' : 'Edit Function: ' + escapeHtml(fnData.name)}
            </h3>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="closeFunctionModal()" style="border: none; font-size: 18px; line-height: 1;">✕</button>
        </div>

        <!-- Modal Body (Scrollable) -->
        <div style="flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px;">
          <!-- Basic Info Form Grid -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">Function Identifier *</label>
              <input type="text" id="fn-modal-name" class="input" value="${escapeHtml(fnData.name)}" placeholder="e.g. calculate-discount" style="width: 100%; font-family: monospace;" ${!fnData.isNew ? 'readonly' : ''}>
            </div>
            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">Auth Policy</label>
              <select id="fn-modal-auth" class="input" style="width: 100%;">
                <option value="public" ${fnData.authPolicy === 'public' ? 'selected' : ''}>Public (No Token Required)</option>
                <option value="auth" ${fnData.authPolicy === 'auth' ? 'selected' : ''}>User Token (Bearer JWT)</option>
                <option value="admin" ${fnData.authPolicy === 'admin' ? 'selected' : ''}>Admin Only (Superuser)</option>
                <option value="apiKey" ${fnData.authPolicy === 'apiKey' ? 'selected' : ''}>API Key (nsk_live_...)</option>
              </select>
            </div>
          </div>

          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">Description</label>
            <input type="text" id="fn-modal-desc" class="input" value="${escapeHtml(fnData.description || '')}" placeholder="What does this function do?" style="width: 100%;">
          </div>

          <!-- Triggers & Guardrails Grid -->
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; background: var(--bg-card-hover); padding: 12px; border-radius: 8px;">
            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">Lifecycle Hook Trigger</label>
              <input type="text" id="fn-modal-hook" class="input" value="${escapeHtml(fnData.eventTrigger || '')}" placeholder="e.g. orders:beforeCreate" style="width: 100%; font-size: 12px;">
            </div>
            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">Timeout (ms)</label>
              <input type="number" id="fn-modal-timeout" class="input" value="${fnData.timeoutMs || 1000}" min="100" max="15000" style="width: 100%; font-size: 12px;">
            </div>
            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">Memory Cap (MB)</label>
              <input type="number" id="fn-modal-memory" class="input" value="${fnData.memoryLimitMb || 32}" min="4" max="128" style="width: 100%; font-size: 12px;">
            </div>
          </div>

          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">Outbound Egress Whitelist (SSRF Protection)</label>
            <input type="text" id="fn-modal-domains" class="input" value="${escapeHtml(allowedDomainsString)}" placeholder="e.g. api.stripe.com, *.resend.com (Leave blank for all public domains)" style="width: 100%; font-size: 12px;">
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="fn-modal-elevated" ${fnData.elevated ? 'checked' : ''} style="cursor: pointer;">
            <label for="fn-modal-elevated" style="font-size: 12px; font-weight: 600; cursor: pointer; color: var(--text-main);">
              Elevated Service Role (Bypass collection access rules & run as admin)
            </label>
          </div>

          <!-- Code Editor Area -->
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <label style="font-size: 12px; font-weight: 600; color: var(--text-main);">
                Function Source Code (JavaScript / TypeScript)
              </label>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 11px; color: var(--text-muted);">Starter Recipes:</span>
                <select class="input" style="font-size: 11px; padding: 2px 6px;" onchange="applyStarterRecipe(this.value)">
                  <option value="">Select Recipe...</option>
                  <option value="starter">Basic Hello World</option>
                  <option value="discount">Cart Discount Calculation</option>
                  <option value="hook">Validation & Mutation Hook</option>
                  <option value="fetch">External API Fetch</option>
                </select>
              </div>
            </div>
            <textarea id="fn-modal-code" style="width: 100%; height: 260px; font-family: 'JetBrains Mono', Consolas, Monaco, monospace; font-size: 13px; line-height: 1.5; padding: 12px; border-radius: 8px; border: 1px solid var(--border-subtle); background: #0f172a; color: #f8fafc; resize: vertical;" spellcheck="false">${escapeHtml(fnData.code)}</textarea>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
              Global <code style="color: var(--accent-primary);">ctx</code> injected: <code style="color: var(--text-main);">ctx.records</code> (scoped DB), <code style="color: var(--text-main);">ctx.fetch</code> (anti-SSRF), <code style="color: var(--text-main);">ctx.env</code>, <code style="color: var(--text-main);">ctx.log()</code>.
            </div>
          </div>

          <!-- Secrets JSON -->
          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">Function Secrets & Environment (JSON)</label>
            <textarea id="fn-modal-env" style="width: 100%; height: 75px; font-family: monospace; font-size: 12px; padding: 8px; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg-card-hover); color: var(--text-main);" placeholder='{ "STRIPE_SECRET": "sk_test_..." }'>${escapeHtml(envString)}</textarea>
          </div>
        </div>

        <!-- Modal Footer -->
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border-subtle); background: var(--bg-card);">
          <button class="btn btn-secondary btn-sm" onclick="closeFunctionModal()">Cancel</button>
          <button class="btn btn-primary btn-sm" id="btn-save-fn" onclick="saveFunctionModal(${fnData.isNew})">
            ${fnData.isNew ? 'Create Function' : 'Save Changes'}
          </button>
        </div>

      </div>
    </div>
  `;
}

function applyStarterRecipe(key) {
  if (!key || !STARTER_RECIPES[key]) return;
  const area = document.getElementById('fn-modal-code');
  if (area) {
    area.value = STARTER_RECIPES[key];
  }
}

function closeFunctionModal() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) modalRoot.innerHTML = '';
}

async function saveFunctionModal(isNew) {
  const btn = document.getElementById('btn-save-fn');
  if (btn) btn.disabled = true;

  try {
    const name = document.getElementById('fn-modal-name').value.trim();
    const description = document.getElementById('fn-modal-desc').value.trim();
    const authPolicy = document.getElementById('fn-modal-auth').value;
    const eventTrigger = document.getElementById('fn-modal-hook').value.trim();
    const timeoutMs = parseInt(document.getElementById('fn-modal-timeout').value, 10) || 1000;
    const memoryLimitMb = parseInt(document.getElementById('fn-modal-memory').value, 10) || 32;
    const code = document.getElementById('fn-modal-code').value;
    const elevated = document.getElementById('fn-modal-elevated').checked;

    const domainsRaw = document.getElementById('fn-modal-domains').value.trim();
    const allowedDomains = domainsRaw ? domainsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

    let env = {};
    const envRaw = document.getElementById('fn-modal-env').value.trim();
    if (envRaw) {
      try {
        env = JSON.parse(envRaw);
      } catch {
        throw new Error('Environment secrets must be valid JSON');
      }
    }

    if (!name) {
      throw new Error('Function name is required');
    }

    const payload = {
      name,
      description,
      authPolicy,
      eventTrigger: eventTrigger || null,
      timeoutMs,
      memoryLimitMb,
      allowedDomains,
      elevated,
      code,
      env,
    };

    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const baseUrl = slug && slug !== 'default' ? `/api/apps/${slug}/functions` : '/api/functions';

    if (isNew) {
      await api(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      toast(`Function '${name}' created successfully`, 'success');
    } else {
      const id = functionsState.activeFunctionForEdit?.id;
      await api(`${baseUrl}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      toast(`Function '${name}' updated successfully`, 'success');
    }

    closeFunctionModal();
    await loadFunctionStats();
    await loadFunctionsList();
  } catch (err) {
    toast(err.message || 'Failed to save function', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
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

// ==========================================
// Live Test Runner Modal
// ==========================================

function openTestFunctionModal(id) {
  const fn = functionsState.functions.find(f => f.id === id);
  if (!fn) return;

  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return;

  const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
  const invokeUrl = slug && slug !== 'default'
    ? `/api/apps/${slug}/functions/${fn.name}/invoke`
    : `/api/functions/${fn.name}/invoke`;

  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="closeFunctionModal(event)">
      <div class="modal-dialog" style="max-width: 780px; width: 95%; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-subtle); display: flex; flex-direction: column; overflow: hidden;" onclick="event.stopPropagation()">
        
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--border-subtle);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="color: var(--accent-success); font-size: 16px;">▶</span>
            <h3 style="margin: 0; font-size: 1.1rem; font-weight: 600;">
              Live Test Runner: <code style="font-family: monospace;">${escapeHtml(fn.name)}</code>
            </h3>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="closeFunctionModal()" style="border: none; font-size: 18px; line-height: 1;">✕</button>
        </div>

        <div style="padding: 20px; display: flex; flex-direction: column; gap: 14px; max-height: 80vh; overflow-y: auto;">
          <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted);">
            <span>Target Endpoint:</span>
            <code style="background: var(--bg-card-hover); padding: 3px 8px; border-radius: 4px; color: var(--text-main);">${escapeHtml(invokeUrl)}</code>
          </div>

          <div style="display: grid; grid-template-columns: 120px 1fr; gap: 10px;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Method</label>
              <select id="test-fn-method" class="input" style="width: 100%;">
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Mock Request Body (JSON)</label>
              <textarea id="test-fn-body" style="width: 100%; height: 90px; font-family: monospace; font-size: 12px; padding: 8px; border-radius: 6px; border: 1px solid var(--border-subtle); background: #0f172a; color: #f8fafc;" placeholder='{ "amount": 100 }'>{ "amount": 100 }</textarea>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end;">
            <button class="btn btn-primary btn-sm" id="btn-run-sandbox" onclick="executeFunctionLiveTest('${fn.id}')">
              ⚡ Run Test in Sandbox
            </button>
          </div>

          <!-- Execution Output Container -->
          <div id="test-fn-output-area" style="display: none; flex-direction: column; gap: 10px; border-top: 1px solid var(--border-subtle); padding-top: 14px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-weight: 600; font-size: 12px;">Sandbox Execution Result:</span>
              <div style="display: flex; align-items: center; gap: 8px;" id="test-fn-badges"></div>
            </div>

            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 2px; color: var(--text-muted);">Captured Console Logs:</label>
              <pre id="test-fn-logs" style="background: #0f172a; color: #38bdf8; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 11px; max-height: 100px; overflow-y: auto; margin: 0;"></pre>
            </div>

            <div>
              <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 2px; color: var(--text-muted);">Returned Response Body:</label>
              <pre id="test-fn-response" style="background: #0f172a; color: #a7f3d0; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 12px; max-height: 180px; overflow-y: auto; margin: 0;"></pre>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
}

async function executeFunctionLiveTest(id) {
  const btn = document.getElementById('btn-run-sandbox');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Executing...';
  }

  const outputArea = document.getElementById('test-fn-output-area');
  const badgesArea = document.getElementById('test-fn-badges');
  const logsPre = document.getElementById('test-fn-logs');
  const resPre = document.getElementById('test-fn-response');

  try {
    const method = document.getElementById('test-fn-method').value;
    let body = {};
    const bodyRaw = document.getElementById('test-fn-body').value.trim();
    if (bodyRaw) {
      try {
        body = JSON.parse(bodyRaw);
      } catch {
        throw new Error('Mock request body must be valid JSON');
      }
    }

    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const endpoint = slug && slug !== 'default'
      ? `/api/apps/${slug}/functions/${id}/test`
      : `/api/functions/${id}/test`;

    const res = await api(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, body }),
    });

    if (outputArea) outputArea.style.display = 'flex';

    if (badgesArea) {
      const isOk = res.status === 'success';
      const statusColor = isOk ? '#10b981' : '#ef4444';
      badgesArea.innerHTML = `
        <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: ${statusColor};">HTTP ${res.statusCode || 200}</span>
        <span class="badge" style="background: var(--bg-card-hover); color: var(--text-muted);">${res.durationMs || 0}ms</span>
      `;
    }

    if (logsPre) {
      logsPre.textContent = (res.logs && res.logs.length > 0) ? res.logs.join('\n') : '(No console output logged)';
    }

    if (resPre) {
      if (res.error) {
        resPre.style.color = '#f87171';
        resPre.textContent = res.error;
      } else {
        resPre.style.color = '#a7f3d0';
        resPre.textContent = typeof res.body === 'object' ? JSON.stringify(res.body, null, 2) : String(res.body);
      }
    }

    await loadFunctionStats();
  } catch (err) {
    if (outputArea) outputArea.style.display = 'flex';
    if (resPre) {
      resPre.style.color = '#f87171';
      resPre.textContent = err.message || String(err);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Run Test in Sandbox';
    }
  }
}

// ==========================================
// Execution Logs
// ==========================================

async function loadFunctionLogs(page = 1) {
  const container = document.getElementById('functions-tab-content');
  if (!container) return;

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; padding: 3rem; color: var(--text-muted);">
      <span class="spinner" style="margin-right: 8px;"></span> Loading execution logs...
    </div>
  `;

  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const baseUrl = slug && slug !== 'default' ? `/api/apps/${slug}/functions/logs` : '/api/functions/logs';
    const params = new URLSearchParams({
      page: String(page),
      perPage: '25',
    });
    if (functionsState.logFilter.functionId) {
      params.append('functionId', functionsState.logFilter.functionId);
    }

    const res = await api(`${baseUrl}?${params.toString()}`);
    functionsState.logs = res.items || [];
    functionsState.logFilter.page = res.page;
    functionsState.logFilter.totalPages = res.totalPages;
    functionsState.logFilter.totalItems = res.totalItems;

    renderFunctionLogsTable(functionsState.logs);
  } catch (err) {
    container.innerHTML = `
      <div class="card" style="padding: 2rem; text-align: center; color: var(--accent-danger);">
        Failed to load logs: ${escapeHtml(err.message || String(err))}
      </div>
    `;
  }
}

function renderFunctionLogsTable(logs) {
  const container = document.getElementById('functions-tab-content');
  if (!container) return;

  const fnOptions = (functionsState.functions || []).map(f => {
    return `<option value="${f.id}" ${functionsState.logFilter.functionId === f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`;
  }).join('');

  if (!logs || logs.length === 0) {
    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
        <select class="input" style="font-size: 12px; width: 220px;" onchange="filterFunctionLogs(this.value)">
          <option value="">All Functions</option>
          ${fnOptions}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="clearAllFunctionLogs()">Clear History</button>
      </div>
      <div class="card" style="padding: 3rem 1.5rem; text-align: center; color: var(--text-muted);">
        No execution logs recorded yet. Run a live test or invoke a function via HTTP endpoint.
      </div>
    `;
    return;
  }

  const rows = logs.map(l => {
    const isOk = l.status === 'success';
    const statusBadge = isOk
      ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">${l.statusCode || 200} OK</span>`
      : `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444;">${l.status.toUpperCase()}</span>`;

    return `
      <tr>
        <td style="font-family: monospace; font-size: 12px; color: var(--text-muted);">${formatTimestamp(l.timestamp)}</td>
        <td style="font-weight: 600; font-family: monospace;">${escapeHtml(l.functionName)}</td>
        <td><span class="badge" style="background: var(--bg-card-hover); font-size: 11px;">${escapeHtml(l.trigger)}</span></td>
        <td>${statusBadge}</td>
        <td style="font-size: 12px; color: var(--text-muted);">${l.durationMs}ms</td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-sm" onclick="viewLogPayload('${l.id}')">
            View Details
          </button>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 12px; color: var(--text-muted);">Filter by Function:</span>
        <select class="input" style="font-size: 12px; width: 220px;" onchange="filterFunctionLogs(this.value)">
          <option value="">All Functions</option>
          ${fnOptions}
        </select>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="clearAllFunctionLogs()" style="color: var(--accent-danger);">
        Clear Logs
      </button>
    </div>

    <div class="card" style="overflow: hidden; padding: 0;">
      <div style="overflow-x: auto;">
        <table class="table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border-subtle); background: var(--bg-card);">
              <th style="text-align: left; padding: 10px 16px;">Timestamp</th>
              <th style="text-align: left; padding: 10px 16px;">Function</th>
              <th style="text-align: left; padding: 10px 16px;">Trigger</th>
              <th style="text-align: left; padding: 10px 16px;">Status</th>
              <th style="text-align: left; padding: 10px 16px;">Duration</th>
              <th style="text-align: right; padding: 10px 16px;">Details</th>
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

function viewFunctionLogs(functionId) {
  functionsState.subTab = 'logs';
  functionsState.logFilter.functionId = functionId;
  switchFunctionsTab('logs');
}

function filterFunctionLogs(fnId) {
  functionsState.logFilter.functionId = fnId;
  loadFunctionLogs(1);
}

function viewLogPayload(logId) {
  const log = functionsState.logs.find(l => l.id === logId);
  if (!log) return;

  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="closeFunctionModal(event)">
      <div class="modal-dialog" style="max-width: 650px; width: 95%; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-subtle); overflow: hidden;" onclick="event.stopPropagation()">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--border-subtle);">
          <h3 style="margin: 0; font-size: 1.1rem; font-weight: 600;">
            Execution Details: ${escapeHtml(log.functionName)}
          </h3>
          <button class="btn btn-secondary btn-sm" onclick="closeFunctionModal()" style="border: none; font-size: 18px;">✕</button>
        </div>
        <div style="padding: 20px; display: flex; flex-direction: column; gap: 12px; max-height: 80vh; overflow-y: auto;">
          <div>
            <label style="font-size: 11px; font-weight: 600; color: var(--text-muted);">Request Payload:</label>
            <pre style="background: #0f172a; color: #f8fafc; padding: 8px; border-radius: 6px; font-size: 11px; margin: 4px 0 0 0;">${escapeHtml(log.requestPayload || '(No body)')}</pre>
          </div>
          <div>
            <label style="font-size: 11px; font-weight: 600; color: var(--text-muted);">Response Payload:</label>
            <pre style="background: #0f172a; color: #a7f3d0; padding: 8px; border-radius: 6px; font-size: 11px; margin: 4px 0 0 0;">${escapeHtml(log.responsePayload || '(Empty)')}</pre>
          </div>
          ${log.error ? `
            <div>
              <label style="font-size: 11px; font-weight: 600; color: var(--accent-danger);">Error:</label>
              <pre style="background: #0f172a; color: #f87171; padding: 8px; border-radius: 6px; font-size: 11px; margin: 4px 0 0 0;">${escapeHtml(log.error)}</pre>
            </div>
          ` : ''}
          <div>
            <label style="font-size: 11px; font-weight: 600; color: var(--text-muted);">Captured Logs:</label>
            <pre style="background: #0f172a; color: #38bdf8; padding: 8px; border-radius: 6px; font-size: 11px; margin: 4px 0 0 0;">${escapeHtml(log.logs || '(No logs)')}</pre>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function clearAllFunctionLogs() {
  if (!confirm('Are you sure you want to clear function execution history?')) return;
  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const baseUrl = slug && slug !== 'default' ? `/api/apps/${slug}/functions/logs` : '/api/functions/logs';
    await api(baseUrl, { method: 'DELETE' });
    toast('Execution logs cleared', 'info');
    await loadFunctionStats();
    await loadFunctionLogs(1);
  } catch (err) {
    toast(err.message || 'Failed to clear logs', 'error');
  }
}

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

// Global Exports
if (typeof window !== 'undefined') {
  window.renderFunctionsView = renderFunctionsView;
  window.switchFunctionsTab = switchFunctionsTab;
  window.refreshFunctionsView = refreshFunctionsView;
  window.loadFunctionStats = loadFunctionStats;
  window.loadFunctionsList = loadFunctionsList;
  window.renderFunctionsTable = renderFunctionsTable;
  window.openCreateFunctionModal = openCreateFunctionModal;
  window.openEditFunctionModal = openEditFunctionModal;
  window.renderFunctionModal = renderFunctionModal;
  window.applyStarterRecipe = applyStarterRecipe;
  window.closeFunctionModal = closeFunctionModal;
  window.saveFunctionModal = saveFunctionModal;
  window.toggleFunctionEnabled = toggleFunctionEnabled;
  window.deleteFunctionPrompt = deleteFunctionPrompt;
  window.openTestFunctionModal = openTestFunctionModal;
  window.executeFunctionLiveTest = executeFunctionLiveTest;
  window.loadFunctionLogs = loadFunctionLogs;
  window.renderFunctionLogsTable = renderFunctionLogsTable;
  window.viewFunctionLogs = viewFunctionLogs;
  window.filterFunctionLogs = filterFunctionLogs;
  window.viewLogPayload = viewLogPayload;
  window.clearAllFunctionLogs = clearAllFunctionLogs;
}

// Automatically load function stats if admin token exists
if (typeof state !== 'undefined' && state.token && typeof loadFunctionStats === 'function') {
  loadFunctionStats();
}
