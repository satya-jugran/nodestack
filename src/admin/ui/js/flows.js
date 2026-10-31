// Functions Flow Manager Module for NodeStack Admin UI
// State, flows list overview, executions history, and serverless functions lookup

let flowsState = {
  currentView: 'list', // 'list' | 'designer'
  subTab: 'flows', // 'flows' | 'executions'
  flows: [],
  executions: [],
  functions: [], // loaded from /api/functions for dropdowns
  filter: {
    search: '',
  },
  activeFlowForEdit: null,
};

if (typeof window !== 'undefined') {
  window.flowsState = flowsState;
}

// ==========================================
// 1. API Fetching
// ==========================================

async function loadFlows() {
  try {
    const res = await api('/api/flows');
    flowsState.flows = Array.isArray(res) ? res : res?.data || [];
    updateSidebarFlowsCount();
    return flowsState.flows;
  } catch (err) {
    console.error('Failed to load flows:', err);
    return [];
  }
}

async function loadFlowExecutions(flowId = '') {
  try {
    const url = flowId ? `/api/flows/${flowId}/executions` : '/api/flows/executions';
    const res = await api(url);
    flowsState.executions = res?.items || (Array.isArray(res) ? res : []);
    return flowsState.executions;
  } catch (err) {
    console.error('Failed to load flow executions:', err);
    return [];
  }
}

async function loadFunctionsForPicker() {
  try {
    const res = await api('/api/functions');
    flowsState.functions = Array.isArray(res) ? res : res?.data || [];
  } catch (err) {
    console.error('Failed to load functions for picker:', err);
  }
}

function updateSidebarFlowsCount() {
  const badge = document.getElementById('sidebar-flows-count');
  if (!badge) return;
  const count = (flowsState.flows || []).length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline-block' : 'none';
}

// ==========================================
// 2. Flows Overview Page Render
// ==========================================

async function renderFlowsView() {
  if (flowsState.currentView === 'designer') {
    const active = (typeof designerState !== 'undefined' && designerState.activeFlow)
      ? designerState.activeFlow
      : flowsState.activeFlowForEdit;
    if (active && typeof renderFlowDesignerWorkbench === 'function') {
      renderFlowDesignerWorkbench(active);
    }
    return;
  }

  const container = document.getElementById('page-view-flows') || document.getElementById('main-body');
  if (!container) return;

  container.innerHTML = `
    <div class="flows-container">
      <!-- Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2 style="font-size: 1.35rem; font-weight: 700; color: var(--text-main); margin: 0 0 0.25rem 0; display: flex; align-items: center; gap: 0.5rem;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="6" cy="19" r="3"/><circle cx="18" cy="19" r="3"/><path d="M12 12h-6v4"/><path d="M12 12h6v4"/>
            </svg>
            Functions Flow
          </h2>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">
            Visual state machine orchestration for chaining serverless functions with branching, loops, and map-reduce.
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="btn btn-secondary btn-sm" onclick="refreshFlowsView()" title="Refresh Flows">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
          <button class="btn btn-primary btn-sm" onclick="openCreateFlowModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Flow
          </button>
        </div>
      </div>

      <!-- Stats Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Total Flows</span>
          <div class="webhook-stat-value">
            <span id="flow-stat-total">${flowsState.flows.length}</span>
          </div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Active Flows</span>
          <div class="webhook-stat-value">
            <span id="flow-stat-active" style="color: var(--accent-success);">${flowsState.flows.filter(f => f.enabled).length}</span>
          </div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Available Functions</span>
          <div class="webhook-stat-value" id="flow-stat-functions">
            ${flowsState.functions.length}
          </div>
        </div>
      </div>

      <!-- Subtabs Bar -->
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle, #334155); padding-bottom: 0.5rem; margin-top: 0.5rem;">
        <div style="display: flex; gap: 1rem;">
          <button class="btn-subtab ${flowsState.subTab === 'flows' ? 'active' : ''}" onclick="switchFlowsTab('flows')" style="background:none; border:none; color: ${flowsState.subTab === 'flows' ? 'var(--accent-primary, #6366f1)' : 'var(--text-muted)'}; font-weight: 600; font-size: 0.9rem; cursor: pointer; padding: 0.25rem 0.5rem; border-bottom: 2px solid ${flowsState.subTab === 'flows' ? 'var(--accent-primary, #6366f1)' : 'transparent'};">
            Configured Flows (${flowsState.flows.length})
          </button>
          <button class="btn-subtab ${flowsState.subTab === 'executions' ? 'active' : ''}" onclick="switchFlowsTab('executions')" style="background:none; border:none; color: ${flowsState.subTab === 'executions' ? 'var(--accent-primary, #6366f1)' : 'var(--text-muted)'}; font-weight: 600; font-size: 0.9rem; cursor: pointer; padding: 0.25rem 0.5rem; border-bottom: 2px solid ${flowsState.subTab === 'executions' ? 'var(--accent-primary, #6366f1)' : 'transparent'};">
            Execution History
          </button>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <input
            type="text"
            id="flows-search-input"
            class="flow-field-input"
            placeholder="Search flows by name..."
            style="width: 220px;"
            value="${escapeHtml(flowsState.filter.search || '')}"
            oninput="handleFlowsSearch(this.value)"
          />
        </div>
      </div>

      <!-- Content Section -->
      <div id="flows-subtab-content">
        ${flowsState.subTab === 'flows' ? renderFlowsListHtml() : renderFlowExecutionsListHtml()}
      </div>
    </div>
  `;

  // Pre-load data in background
  if (flowsState.functions.length === 0) {
    loadFunctionsForPicker().then(() => {
      const el = document.getElementById('flow-stat-functions');
      if (el) el.textContent = flowsState.functions.length;
    });
  }
}

function renderFlowsListHtml() {
  const filtered = flowsState.flows.filter(f => {
    if (!flowsState.filter.search) return true;
    const q = flowsState.filter.search.toLowerCase();
    return f.name.toLowerCase().includes(q) || (f.description && f.description.toLowerCase().includes(q));
  });

  if (filtered.length === 0) {
    return `
      <div style="text-align: center; padding: 4rem 2rem; background: var(--bg-card); border: 1px dashed var(--border-subtle); border-radius: 8px;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="margin-bottom: 1rem;"><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="6" cy="19" r="3"/><circle cx="18" cy="19" r="3"/><path d="M12 12h-6v4"/><path d="M12 12h6v4"/></svg>
        <h3 style="font-size: 1.1rem; color: var(--text-main); margin: 0 0 0.5rem 0;">No Functions Flows Yet</h3>
        <p style="color: var(--text-muted); font-size: 0.85rem; max-width: 420px; margin: 0 auto 1.25rem auto;">
          Create a state machine flow to connect serverless functions, add conditional branching, loops, or batch map-reduce.
        </p>
        <button class="btn btn-primary btn-sm" onclick="openCreateFlowModal()">
          + Create First Flow
        </button>
      </div>
    `;
  }

  return `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 1rem;">
      ${filtered.map(flow => {
        const stateCount = flow.definition && flow.definition.states ? Object.keys(flow.definition.states).length : 0;
        return `
          <div class="webhook-stat-card" style="cursor: default;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem;">
              <div>
                <h4 style="margin: 0 0 0.25rem 0; font-size: 1rem; color: var(--text-main); font-weight: 600;">
                  ${escapeHtml(flow.name)}
                </h4>
                <p style="margin: 0; font-size: 0.8rem; color: var(--text-muted); min-height: 1.2rem;">
                  ${escapeHtml(flow.description || 'No description provided')}
                </p>
              </div>
              <span class="badge ${flow.enabled ? 'badge-get' : 'badge-danger'}" style="font-size: 10px;">
                ${flow.enabled ? 'ACTIVE' : 'DISABLED'}
              </span>
            </div>

            <div style="display: flex; align-items: center; gap: 0.75rem; margin: 0.75rem 0; font-size: 0.75rem; color: var(--text-muted);">
              <span><strong>Trigger:</strong> <code style="color: var(--accent-primary);">${formatFlowTriggerLabel(flow)}</code></span>
              <span>•</span>
              <span><strong>Steps:</strong> ${stateCount} states</span>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border-subtle); padding-top: 0.75rem; margin-top: auto;">
              <div style="display: flex; gap: 6px;">
                <button class="btn btn-primary btn-sm" data-flow-id="${escapeHtml(flow.id)}" onclick="openFlowDesigner(this.getAttribute('data-flow-id'))" style="font-weight: 600;">
                  Open Designer
                </button>
                <button class="btn btn-secondary btn-sm" data-flow-id="${escapeHtml(flow.id)}" onclick="quickTestFlow(this.getAttribute('data-flow-id'))" title="Test Flow Execution">
                  ▶ Run
                </button>
              </div>
              <div style="display: flex; gap: 6px;">
                <button class="btn btn-secondary btn-sm" data-flow-id="${escapeHtml(flow.id)}" data-enabled="${!flow.enabled}" onclick="toggleFlowStatus(this.getAttribute('data-flow-id'), this.getAttribute('data-enabled') === 'true')" title="${flow.enabled ? 'Disable' : 'Enable'}">
                  ${flow.enabled ? 'Disable' : 'Enable'}
                </button>
                <button class="btn btn-danger btn-sm" data-flow-id="${escapeHtml(flow.id)}" data-flow-name="${escapeHtml(flow.name)}" onclick="deleteFlowPrompt(this.getAttribute('data-flow-id'), this.getAttribute('data-flow-name'))" title="Delete Flow">
                  🗑
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderFlowExecutionsListHtml() {
  const executions = flowsState.executions || [];
  if (executions.length === 0) {
    return `
      <div style="text-align: center; padding: 3rem; background: var(--bg-card); border-radius: 8px; color: var(--text-muted);">
        <p style="margin: 0;">No flow executions recorded yet. Run a flow to inspect step timeline and logs.</p>
      </div>
    `;
  }

  return `
    <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; overflow: hidden;">
      <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
        <thead>
          <tr style="background: rgba(0,0,0,0.15); border-bottom: 1px solid var(--border-subtle); color: var(--text-muted);">
            <th style="padding: 0.75rem 1rem;">Status</th>
            <th style="padding: 0.75rem 1rem;">Flow Name</th>
            <th style="padding: 0.75rem 1rem;">Duration</th>
            <th style="padding: 0.75rem 1rem;">Steps</th>
            <th style="padding: 0.75rem 1rem;">Started At</th>
            <th style="padding: 0.75rem 1rem; text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${executions.map(exec => {
            const statusColor = exec.status === 'succeeded' ? 'var(--accent-success)' : exec.status === 'failed' ? 'var(--accent-danger)' : '#3b82f6';
            const stepCount = (exec.stepLogs || []).length;
            return `
              <tr style="border-bottom: 1px solid var(--border-subtle);">
                <td style="padding: 0.75rem 1rem;">
                  <span style="font-weight: 700; color: ${statusColor}; text-transform: uppercase; font-size: 0.75rem;">
                    ● ${exec.status}
                  </span>
                </td>
                <td style="padding: 0.75rem 1rem; font-weight: 600; color: var(--text-main);">
                  ${escapeHtml(exec.flowName)}
                </td>
                <td style="padding: 0.75rem 1rem; color: var(--text-muted);">
                  ${exec.durationMs}ms
                </td>
                <td style="padding: 0.75rem 1rem; color: var(--text-muted);">
                  ${stepCount} steps
                </td>
                <td style="padding: 0.75rem 1rem; color: var(--text-muted); font-size: 0.8rem;">
                  ${new Date(exec.startedAt).toLocaleString()}
                </td>
                <td style="padding: 0.75rem 1rem; text-align: right;">
                  <button class="btn btn-secondary btn-sm" data-exec-id="${escapeHtml(exec.id)}" onclick="inspectExecutionDetail(this.getAttribute('data-exec-id'))">
                    Inspect
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ==========================================
// 3. User Actions
// ==========================================

async function refreshFlowsView() {
  await loadFlows();
  if (flowsState.subTab === 'executions') {
    await loadFlowExecutions();
  }
  renderFlowsView();
}

function switchFlowsTab(tab, pushState = true) {
  flowsState.subTab = tab;
  if (pushState && typeof updateUrl === 'function') {
    const path = (tab === 'executions') ? '/_/flows/executions' : '/_/flows';
    updateUrl(path);
  }
  if (typeof updateBreadcrumbs === 'function') {
    updateBreadcrumbs();
  }
  if (tab === 'executions') {
    loadFlowExecutions().then(() => renderFlowsView());
  } else {
    renderFlowsView();
  }
}

function handleFlowsSearch(val) {
  flowsState.filter.search = val;
  const content = document.getElementById('flows-subtab-content');
  if (content && flowsState.subTab === 'flows') {
    content.innerHTML = renderFlowsListHtml();
  }
}

async function toggleFlowStatus(flowId, enabled) {
  try {
    await api(`/api/flows/${flowId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    await refreshFlowsView();
    toast(`Flow ${enabled ? 'enabled' : 'disabled'} successfully`, 'success');
  } catch (err) {
    toast('Failed to update flow: ' + (err.message || err), 'error');
  }
}

async function deleteFlowPrompt(flowId, name) {
  if (!confirm(`Are you sure you want to delete flow "${name}"? This action cannot be undone.`)) {
    return;
  }
  try {
    await api(`/api/flows/${flowId}`, { method: 'DELETE' });
    await refreshFlowsView();
    toast(`Flow "${name}" deleted successfully`, 'success');
  } catch (err) {
    toast('Failed to delete flow: ' + (err.message || err), 'error');
  }
}

function openCreateFlowModal() {
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeFlowModal()">
      <div class="modal" style="max-width: 520px;">
        <div class="modal-header">
          <h2 class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="6" cy="19" r="3"/><circle cx="18" cy="19" r="3"/><path d="M12 12h-6v4"/><path d="M12 12h6v4"/></svg>
            Create New Functions Flow
          </h2>
          <button type="button" class="btn btn-secondary btn-sm" onclick="closeFlowModal()">✕</button>
        </div>
        <form onsubmit="handleCreateFlowSubmit(event)">
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label" for="new-flow-name">Flow Name *</label>
              <input
                type="text"
                id="new-flow-name"
                class="form-input"
                placeholder="e.g. OrderProcessingFlow"
                required
                autofocus
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-flow-desc">Description</label>
              <textarea
                id="new-flow-desc"
                class="form-textarea"
                style="min-height: 60px;"
                placeholder="Brief description of what this workflow orchestrates..."
              ></textarea>
            </div>
            <div class="form-group">
              <label class="form-label" for="new-flow-trigger">Trigger Type</label>
              <select id="new-flow-trigger" class="form-select" onchange="toggleFlowTriggerInput(this.value)">
                <option value="http">HTTP Endpoint (POST /api/flows/:id/execute)</option>
                <option value="event">Database Event Hook (e.g. orders:create)</option>
                <option value="manual">Manual Execution Only</option>
              </select>
            </div>
            <div class="form-group" id="flow-event-field" style="display: none;">
              <label class="form-label" for="new-flow-event">Target Event Pattern</label>
              <input
                type="text"
                id="new-flow-event"
                class="form-input"
                placeholder="collection:action (e.g. orders:create, users:*)"
              />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="closeFlowModal()">Cancel</button>
            <button type="submit" class="btn btn-primary" style="font-weight: 600;">+ Create & Open Designer</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function closeFlowModal() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) modalRoot.innerHTML = '';
}

function toggleFlowTriggerInput(val) {
  const field = document.getElementById('flow-event-field');
  if (field) field.style.display = val === 'event' ? 'flex' : 'none';
}

async function handleCreateFlowSubmit(e) {
  e.preventDefault();
  const nameInput = document.getElementById('new-flow-name');
  const descInput = document.getElementById('new-flow-desc');
  const triggerInput = document.getElementById('new-flow-trigger');
  const eventInput = document.getElementById('new-flow-event');

  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) return;

  const triggerType = triggerInput ? triggerInput.value : 'http';
  const eventTrigger = triggerType === 'event' && eventInput ? eventInput.value.trim() : null;

  const initialFlow = {
    name,
    description: descInput ? descInput.value.trim() : '',
    enabled: true,
    triggerType,
    eventTrigger,
    definition: {
      startAt: 'FirstStep',
      states: {
        FirstStep: {
          type: 'Pass',
          result: { message: 'Hello from NodeStack Functions Flow!' },
          end: true,
        },
      },
    },
  };

  try {
    const created = await api('/api/flows', {
      method: 'POST',
      body: JSON.stringify(initialFlow),
    });
    closeFlowModal();
    await loadFlows();
    openFlowDesigner(created.id);
  } catch (err) {
    toast('Failed to create flow: ' + (err.message || err), 'error');
  }
}

function formatFlowTriggerLabel(flow) {
  if (flow.triggerType === 'event') {
    return `DB Event${flow.eventTrigger ? `: ${escapeHtml(flow.eventTrigger)}` : ''}`;
  }
  if (flow.triggerType === 'manual') {
    return 'Manual (On-demand)';
  }
  return 'HTTP API';
}

function quickTestFlow(flowId) {
  if (typeof openFlowDesigner === 'function') {
    return openFlowDesigner(flowId, true);
  }
}

async function inspectExecutionDetail(executionId) {
  try {
    let exec = (flowsState.executions || []).find((e) => e.id === executionId);
    if (!exec || !exec.stepLogs) {
      exec = await api(`/api/flows/executions/${executionId}`);
    }
    if (!exec) {
      toast('Execution record not found', 'error');
      return;
    }

    let root = document.getElementById('drawer-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'drawer-root';
      document.body.appendChild(root);
    }

    const isSuccess = exec.status === 'succeeded';
    const statusColor = isSuccess ? 'var(--accent-success)' : exec.status === 'failed' ? 'var(--accent-danger)' : '#3b82f6';
    const stepCount = (exec.stepLogs || []).length;

    root.innerHTML = `
      <div id="flow-exec-drawer-backdrop" class="drawer-backdrop" onclick="closeFlowExecutionDrawer()" aria-hidden="true"></div>
      <aside id="flow-exec-drawer-panel" class="record-drawer flow-execution-drawer" role="dialog" aria-modal="true" aria-labelledby="flow-exec-drawer-title" tabindex="-1">
        <!-- Drawer Header -->
        <div class="drawer-header" style="display: flex; align-items: center; justify-content: space-between;">
          <div class="drawer-title-area" style="display: flex; align-items: center; gap: 0.75rem;">
            <span style="font-weight: 800; color: ${statusColor}; text-transform: uppercase; font-size: 0.78rem; background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 6px; border: 1px solid ${statusColor}44;">
              ● ${escapeHtml(exec.status).toUpperCase()}
            </span>
            <div>
              <h3 class="drawer-title" id="flow-exec-drawer-title" style="margin: 0; font-size: 1.1rem; color: var(--text-main);">
                ${escapeHtml(exec.flowName)}
              </h3>
              <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono, monospace);">
                ${escapeHtml(exec.id)} • ${exec.durationMs}ms
              </span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button
              class="btn btn-secondary btn-sm"
              data-flow-id="${escapeHtml(exec.flowId)}"
              data-exec-id="${escapeHtml(exec.id)}"
              onclick="openFlowFromExecution(this.getAttribute('data-flow-id'), this.getAttribute('data-exec-id'))"
              title="Open flow in visual designer with this execution"
              style="font-size: 11px; padding: 4px 8px; font-weight: 600;"
            >
              Open in Designer ↗
            </button>
            <button class="drawer-close-btn" onclick="closeFlowExecutionDrawer()" aria-label="Close drawer">✕</button>
          </div>
        </div>

        <!-- Drawer Body -->
        <div class="drawer-body" style="padding: 1.25rem 1.5rem; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 1.25rem;">
          <!-- Meta Grid -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 10px 14px; font-size: 12px;">
            <div>
              <span style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; display: block;">Status</span>
              <strong style="color: ${statusColor}; text-transform: uppercase;">${escapeHtml(exec.status)}</strong>
            </div>
            <div>
              <span style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; display: block;">Duration</span>
              <span style="font-weight: 600; color: var(--text-main);">${exec.durationMs}ms</span>
            </div>
            <div>
              <span style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; display: block;">Steps</span>
              <span style="font-weight: 600; color: var(--text-main);">${stepCount} steps</span>
            </div>
            <div>
              <span style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; display: block;">Started</span>
              <span style="color: var(--text-muted);" title="${escapeHtml(exec.startedAt)}">${new Date(exec.startedAt).toLocaleTimeString()}</span>
            </div>
          </div>

          <!-- Error Alert Banner (if failed) -->
          ${exec.error ? `
            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 10px 14px; font-size: 12px; color: var(--accent-danger);">
              <strong>Execution Error:</strong> ${escapeHtml(exec.error)}
            </div>
          ` : ''}

          <!-- Step-by-Step Execution Timeline -->
          <div>
            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 8px; letter-spacing: 0.05em;">
              Step-by-Step Timeline (${stepCount})
            </span>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${(exec.stepLogs || []).map((log, idx) => {
                const stepSuccess = log.status === 'succeeded';
                const stepColor = stepSuccess ? 'var(--accent-success)' : 'var(--accent-danger)';
                return `
                  <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-left: 3px solid ${stepColor}; border-radius: 6px; padding: 10px 12px; font-size: 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 10px; color: var(--text-muted); font-weight: 700;">#${idx + 1}</span>
                        <strong style="color: var(--text-main); font-size: 13px;">${escapeHtml(log.step)}</strong>
                        <span class="flow-step-type-pill pill-${(log.type || 'Task').toLowerCase()}" style="font-size: 9px; padding: 1px 6px;">
                          ${escapeHtml((log.type || 'TASK')).toUpperCase()}
                        </span>
                      </div>
                      <span style="color: var(--text-muted); font-size: 11px; font-family: var(--font-mono, monospace);">
                        ${log.durationMs}ms
                      </span>
                    </div>
                    ${log.error ? `
                      <div style="color: var(--accent-danger); font-size: 11px; margin-top: 4px;">
                        ${escapeHtml(log.error)}
                      </div>
                    ` : ''}
                    ${log.output !== undefined ? `
                      <details style="margin-top: 6px; font-size: 11px;">
                        <summary style="cursor: pointer; color: var(--text-muted); font-weight: 600;">View Step Result</summary>
                        <pre style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 6px 8px; margin-top: 4px; max-height: 120px; overflow-y: auto; font-size: 11px; color: var(--text-main); font-family: var(--font-mono, monospace);">${escapeHtml(JSON.stringify(log.output, null, 2))}</pre>
                      </details>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Input Payload -->
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">
                Input Payload
              </span>
              <button class="btn btn-secondary btn-sm" onclick="copyFlowJson(this, 'flow-exec-input-json')" style="padding: 2px 8px; font-size: 10px;">
                Copy JSON
              </button>
            </div>
            <pre id="flow-exec-input-json" style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 10px 12px; font-family: var(--font-mono, monospace); font-size: 11px; color: var(--text-main); max-height: 160px; overflow-y: auto; margin: 0;">${escapeHtml(JSON.stringify(exec.input || {}, null, 2))}</pre>
          </div>

          <!-- Final Output Payload -->
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">
                Final Output Payload
              </span>
              <button class="btn btn-secondary btn-sm" onclick="copyFlowJson(this, 'flow-exec-output-json')" style="padding: 2px 8px; font-size: 10px;">
                Copy JSON
              </button>
            </div>
            <pre id="flow-exec-output-json" style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 10px 12px; font-family: var(--font-mono, monospace); font-size: 11px; color: var(--text-main); max-height: 200px; overflow-y: auto; margin: 0;">${escapeHtml(JSON.stringify(exec.output !== undefined ? exec.output : (exec.error ? { error: exec.error } : {}), null, 2))}</pre>
          </div>
        </div>
      </aside>
    `;

    setTimeout(() => {
      document.getElementById('flow-exec-drawer-backdrop')?.classList.add('open');
      document.getElementById('flow-exec-drawer-panel')?.classList.add('open');
    }, 10);
  } catch (err) {
    toast('Failed to inspect flow execution: ' + (err.message || err), 'error');
  }
}

function closeFlowExecutionDrawer() {
  const backdrop = document.getElementById('flow-exec-drawer-backdrop');
  const panel = document.getElementById('flow-exec-drawer-panel');
  if (backdrop) backdrop.classList.remove('open');
  if (panel) panel.classList.remove('open');
  setTimeout(() => {
    const root = document.getElementById('drawer-root');
    if (root && root.querySelector('#flow-exec-drawer-panel')) {
      root.innerHTML = '';
    }
  }, 200);
}

async function openFlowFromExecution(flowId, executionId) {
  const exec = (flowsState.executions || []).find((e) => e.id === executionId);
  closeFlowExecutionDrawer();
  if (typeof openFlowDesigner === 'function') {
    await openFlowDesigner(flowId, true);
    if (exec && typeof designerState !== 'undefined') {
      designerState.latestExecution = exec;
      const drawer = document.getElementById('flow-test-drawer');
      if (drawer && typeof renderTestDrawerHtml === 'function') {
        drawer.innerHTML = renderTestDrawerHtml(designerState.activeFlow);
      }
      if (typeof renderSvgFlowchart === 'function') {
        renderSvgFlowchart(designerState.activeFlow);
      }
    }
  }
}

function copyFlowJson(btn, elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(el.textContent || '').then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    } else {
      toast('Copied to clipboard', 'info');
    }
  } catch (_) {
    toast('Copied to clipboard', 'info');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

if (typeof window !== 'undefined') {
  window.renderFlowsView = renderFlowsView;
  window.loadFlows = loadFlows;
  window.refreshFlowsView = refreshFlowsView;
  window.switchFlowsTab = switchFlowsTab;
  window.handleFlowsSearch = handleFlowsSearch;
  window.toggleFlowStatus = toggleFlowStatus;
  window.deleteFlowPrompt = deleteFlowPrompt;
  window.openCreateFlowModal = openCreateFlowModal;
  window.closeFlowModal = closeFlowModal;
  window.toggleFlowTriggerInput = toggleFlowTriggerInput;
  window.handleCreateFlowSubmit = handleCreateFlowSubmit;
  window.quickTestFlow = quickTestFlow;
  window.formatFlowTriggerLabel = formatFlowTriggerLabel;
  window.inspectExecutionDetail = inspectExecutionDetail;
  window.closeFlowExecutionDrawer = closeFlowExecutionDrawer;
  window.openFlowFromExecution = openFlowFromExecution;
  window.copyFlowJson = copyFlowJson;
}
