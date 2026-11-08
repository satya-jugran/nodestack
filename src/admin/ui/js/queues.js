// Queues Manager Module for NodeStack Admin UI

let queuesState = {
  subTab: 'queues', // 'queues' | 'messages'
  includeSystem: false,
  queues: [],
  functionsList: [],
  stats: {
    totalQueues: 0,
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    dead_letter: 0,
    total: 0,
  },
  messages: [],
  jobs: [],
  messageFilter: {
    queue: '',
    status: 'all',
    page: 1,
    perPage: 25,
    totalItems: 0,
    totalPages: 1,
  },
  jobFilter: {
    queue: '',
    status: 'all',
    page: 1,
    perPage: 25,
    totalItems: 0,
    totalPages: 1,
  },
  activeQueueForEdit: null,
};
queuesState.jobFilter = queuesState.messageFilter;

if (typeof window !== 'undefined') {
  window.queuesState = queuesState;
}

function getQueuesApiPrefix() {
  const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
  return slug && slug !== 'default' ? `/api/apps/${encodeURIComponent(slug)}/queues` : '/api/queues';
}

function getFunctionsApiPrefix() {
  const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
  return slug && slug !== 'default' ? `/api/apps/${encodeURIComponent(slug)}/functions` : '/api/functions';
}

function renderQueuesView() {
  const container = document.getElementById('page-view-queues') || document.getElementById('main-body');
  if (!container) return;

  container.innerHTML = `
    <div class="webhooks-container" id="queues-manager-root">
      <!-- Header -->
      <div class="webhooks-header">
        <div class="webhooks-title-area">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
            Queues Manager
          </h2>
          <p>Configure SQLite-backed message queues, bind Serverless Function workers, manage concurrency, and inspect messages & Dead-Letter Queues.</p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm" id="btn-cleanup-queues" onclick="handleCleanupOldQueueMessages()" title="Prune terminal completed/failed messages older than retention window">
            🧹 Cleanup Old Messages
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-refresh-queues" onclick="refreshQueuesView()" title="Refresh Queues & Messages">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
          <button class="btn btn-primary btn-sm" id="btn-new-queue" onclick="openCreateQueueDrawer()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Queue
          </button>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="webhooks-stats-grid" id="queues-stats-grid">
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Configured Queues</span>
          <div class="webhook-stat-value" id="q-stat-queues">0</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Queued / Pending</span>
          <div class="webhook-stat-value" style="color: #60a5fa;" id="q-stat-queued">0</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Processing (Active)</span>
          <div class="webhook-stat-value" style="color: #fbbf24;" id="q-stat-processing">0</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Completed Messages</span>
          <div class="webhook-stat-value" style="color: var(--accent-success);" id="q-stat-completed">0</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label">Dead-Letter / Failed</span>
          <div class="webhook-stat-value" style="color: var(--accent-danger);" id="q-stat-dlq">0</div>
        </div>
      </div>

      <!-- Subtabs Bar -->
      <div class="webhooks-tabs-bar" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <button class="webhook-tab-btn ${queuesState.subTab === 'queues' ? 'active' : ''}" id="tab-btn-queues-list" onclick="switchQueuesTab('queues')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Configured Queues
          </button>
          <button class="webhook-tab-btn ${queuesState.subTab === 'messages' || queuesState.subTab === 'jobs' ? 'active' : ''}" id="tab-btn-queues-messages" data-legacy-id="tab-btn-queues-jobs" onclick="switchQueuesTab('messages')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Messages Inspector
          </button>
        </div>

        <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); cursor: pointer; user-select: none;">
          <input type="checkbox" id="chk-queues-include-system" ${queuesState.includeSystem ? 'checked' : ''} onchange="toggleIncludeSystemQueues(this.checked)" />
          <span>Show System Flow Queues (<code>_system:*</code>)</span>
        </label>
      </div>

      <!-- Content Area -->
      <div id="queues-tab-content">
        <!-- Rendered by switchQueuesTab() -->
      </div>
    </div>
  `;

  loadQueueStats();
  if (queuesState.subTab === 'queues') {
    loadQueuesList();
  } else {
    loadQueueMessagesList();
  }
}

async function refreshQueuesView() {
  await loadQueueStats();
  if (queuesState.subTab === 'queues') {
    await loadQueuesList();
  } else {
    await loadQueueMessagesList();
  }
  if (typeof toast === 'function') toast('Queues updated', 'info');
}

function toggleIncludeSystemQueues(checked) {
  queuesState.includeSystem = Boolean(checked);
  const filter = queuesState.messageFilter || queuesState.jobFilter;
  if (!queuesState.includeSystem && filter && filter.queue && filter.queue.startsWith('_system:')) {
    filter.queue = '';
  }
  loadQueueStats();
  if (queuesState.subTab === 'queues') {
    loadQueuesList();
  } else {
    loadQueueMessagesList();
  }
}

function switchQueuesTab(tab, pushState = true) {
  const isMessages = tab === 'messages' || tab === 'jobs';
  queuesState.subTab = isMessages ? (tab === 'jobs' ? 'jobs' : 'messages') : 'queues';
  const btnList = document.getElementById('tab-btn-queues-list');
  const btnMessages = document.getElementById('tab-btn-queues-messages') || document.getElementById('tab-btn-queues-jobs');
  if (btnList) btnList.classList.toggle('active', !isMessages);
  if (btnMessages) btnMessages.classList.toggle('active', isMessages);

  if (pushState && typeof updateUrl === 'function') {
    const path = isMessages ? (tab === 'jobs' ? '/_/queues/jobs' : '/_/queues/messages') : '/_/queues';
    updateUrl(path);
  }

  if (isMessages) {
    loadQueueMessagesList();
  } else {
    loadQueuesList();
  }
  if (typeof updateBreadcrumbs === 'function') updateBreadcrumbs();
}

async function loadQueueStats() {
  try {
    const prefix = getQueuesApiPrefix();
    const includeParam = queuesState.includeSystem ? '?includeSystem=true' : '';
    const stats = await api(`${prefix}/stats${includeParam}`);
    if (stats) {
      queuesState.stats = stats;
      const elQueues = document.getElementById('q-stat-queues');
      const elQueued = document.getElementById('q-stat-queued');
      const elProc = document.getElementById('q-stat-processing');
      const elComp = document.getElementById('q-stat-completed');
      const elDlq = document.getElementById('q-stat-dlq');

      const totalQueues = stats.totalQueues !== undefined ? stats.totalQueues : (queuesState.queues || []).filter(q => !q.isSystem).length;
      if (elQueues) elQueues.textContent = String(totalQueues);
      if (elQueued) elQueued.textContent = (stats.queued || 0).toLocaleString();
      if (elProc) elProc.textContent = (stats.processing || 0).toLocaleString();
      if (elComp) elComp.textContent = (stats.completed || 0).toLocaleString();
      const totalDlq = (stats.dead_letter !== undefined ? stats.dead_letter : stats.deadLetter) || 0;
      if (elDlq) elDlq.textContent = (totalDlq + (stats.failed || 0)).toLocaleString();

      const sidebarBadge = document.getElementById('sidebar-queues-count');
      if (sidebarBadge) {
        sidebarBadge.textContent = String(totalQueues);
        sidebarBadge.style.display = totalQueues > 0 ? 'inline-block' : 'none';
      }

      const homeQueueEl = document.getElementById('home-stat-queues');
      const homeQueueSubEl = document.getElementById('home-stat-queues-sub');
      if (homeQueueEl) {
        homeQueueEl.textContent = String(totalQueues);
      }
      if (homeQueueSubEl) {
        const queued = stats.queued || 0;
        const comp = stats.completed || 0;
        homeQueueSubEl.textContent = `${queued} queued • ${comp} completed`;
      }
    }
  } catch (err) {
    console.error('Failed to load queue stats:', err);
  }
}

async function loadQueuesList() {
  const content = document.getElementById('queues-tab-content');
  if (!content) return;

  content.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-muted);">Loading queues...</div>`;

  try {
    const prefix = getQueuesApiPrefix();
    const includeParam = queuesState.includeSystem ? '?includeSystem=true' : '';
    const queues = await api(`${prefix}${includeParam}`);
    queuesState.queues = Array.isArray(queues) ? queues : [];

    const displayQueues = (queuesState.queues || []).filter(q =>
      queuesState.includeSystem || (!q.isSystem && !q.name.startsWith('_system:'))
    );

    const userQueuesCount = (queuesState.queues || []).filter(q => !q.isSystem && !q.name.startsWith('_system:')).length;
    const sidebarBadge = document.getElementById('sidebar-queues-count');
    if (sidebarBadge) {
      sidebarBadge.textContent = String(userQueuesCount);
      sidebarBadge.style.display = userQueuesCount > 0 ? 'inline-block' : 'none';
    }

    const homeQueueEl = document.getElementById('home-stat-queues');
    if (homeQueueEl) {
      homeQueueEl.textContent = String(userQueuesCount);
    }
    const elQueues = document.getElementById('q-stat-queues');
    if (elQueues) {
      elQueues.textContent = String(queuesState.includeSystem ? (queuesState.queues || []).length : userQueuesCount);
    }

    if (displayQueues.length === 0) {
      content.innerHTML = `
        <div style="text-align:center; padding: 4rem 2rem; background: var(--bg-card); border: 1px dashed var(--border-subtle); border-radius: 8px;">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">📬</div>
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; color: var(--text-main);">No Queues Configured Yet</h3>
          <p style="margin: 0 0 1.5rem 0; font-size: 0.85rem; color: var(--text-muted); max-width: 520px; margin-left: auto; margin-right: auto;">
            Create a persistent background queue to process messages asynchronously, bind a Serverless Function worker (<code>targetFunction</code>), or throttle concurrency with automatic retries and Dead-Letter Queues.
          </p>
          <button class="btn btn-primary btn-sm" onclick="openCreateQueueDrawer()">+ Create Your First Queue</button>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="webhook-table-wrapper" style="overflow-x: auto; width: 100%;">
        <table class="webhook-table" style="min-width: 1160px; width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="min-width: 220px; width: 22%;">Queue Name</th>
              <th style="min-width: 150px; width: 15%;">Worker Binding</th>
              <th style="min-width: 180px; width: 18%;">Policy & Concurrency</th>
              <th style="min-width: 170px; width: 17%;">Live Message Counts</th>
              <th style="min-width: 360px; width: 28%; text-align: right; white-space: nowrap;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${displayQueues.map(q => {
              const s = q.stats || { queued: 0, processing: 0, completed: 0, failed: 0, deadLetter: 0, dead_letter: 0 };
              const qDlq = (s.dead_letter !== undefined ? s.dead_letter : s.deadLetter) || 0;
              const isDlqTarget = (queuesState.queues || []).some(other => other.deadLetterQueue === q.name);
              const isSys = Boolean(q.isSystem || (q.name && q.name.startsWith('_system:')));
              const concurrencyText = q.concurrency && q.concurrency > 0 ? `${q.concurrency} max concurrent` : 'Unbounded';

              return `
                <tr data-queue-name="${escapeHtml(q.name)}">
                  <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${isSys ? '#8b5cf6' : '#10b981'}; flex-shrink: 0;"></span>
                      <div style="min-width: 0;">
                        <div style="font-weight: 600; color: var(--text-main); font-family: var(--font-mono); font-size: 12.5px; word-break: break-all;">
                          ${escapeHtml(q.name)}
                          ${q.strictOrder ? '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-size: 10px; margin-left: 6px; font-family: var(--font-sans);" title="Strict Head-of-Line FIFO Ordering & Group Blocking">Strict FIFO</span>' : ''}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted);">
                          ${isSys ? 'System Queue' : isDlqTarget ? 'Dead-Letter Queue (DLQ)' : 'User Queue'}
                          ${q.deadLetterQueue ? ` • DLQ: <code>${escapeHtml(q.deadLetterQueue)}</code>` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    ${q.targetFunction ? `
                      <div style="display: flex; flex-direction: column; gap: 3px; align-items: flex-start;">
                        <span class="badge badge-post" style="font-family: var(--font-mono); font-size: 11px;" title="Bound Serverless Function Worker">
                          ⚡ ${escapeHtml(q.targetFunction)}
                        </span>
                        <span style="font-size: 10.5px; color: var(--text-muted);">Auto-dispatches on enqueue</span>
                      </div>
                    ` : isSys ? `
                      <span class="badge badge-get" style="font-size: 10.5px;">🔀 Flow Engine Worker</span>
                    ` : `
                      <span style="font-size: 11.5px; color: var(--text-muted);">Pull / SDK Worker</span>
                    `}
                  </td>
                  <td>
                    <div style="font-size: 12px; color: var(--text-main); font-weight: 600;">${escapeHtml(concurrencyText)}</div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                      ${q.maxAttempts || 3} attempts • ${q.visibilityTimeoutSeconds || 30}s lease • ${q.backoffDelayMs || 1000}ms backoff
                    </div>
                  </td>
                  <td>
                    <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 11px;">
                      <span class="badge badge-get" title="Queued messages">${s.queued || 0} queued</span>
                      ${(s.processing || 0) > 0 ? `<span class="badge badge-post" title="Processing messages">${s.processing} active</span>` : ''}
                      <span style="color: var(--text-muted);" title="Completed messages">${s.completed || 0} done</span>
                      ${(qDlq + (s.failed || 0)) > 0 ? `
                        <span class="badge badge-delete" title="Dead-letter / Failed messages">${qDlq + (s.failed || 0)} DLQ/err</span>
                      ` : isDlqTarget && (s.queued || 0) > 0 ? `
                        <span class="badge badge-delete" title="Forwarded Dead-Letter messages waiting in DLQ">${s.queued} DLQ messages</span>
                      ` : ''}
                    </div>
                  </td>
                  <td style="text-align: right; white-space: nowrap; min-width: 360px;">
                    <div style="display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; white-space: nowrap;">
                      ${!isSys ? `
                        <button class="btn btn-secondary btn-sm" data-name="${escapeHtml(q.name)}" onclick="openSendMessageDrawer(this.getAttribute('data-name'))" title="Enqueue Message into Queue" style="padding: 3px 8px; font-size: 11px;">
                          ✉ Send
                        </button>
                      ` : ''}
                      <button class="btn btn-secondary btn-sm" data-name="${escapeHtml(q.name)}" onclick="inspectQueueMessages(this.getAttribute('data-name'))" title="Inspect Messages in Queue" style="padding: 3px 8px; font-size: 11px;">
                        Messages
                      </button>
                      ${(qDlq > 0 || (isDlqTarget && (s.queued || 0) > 0)) ? `
                        <button class="btn btn-secondary btn-sm" data-name="${escapeHtml(q.name)}" onclick="handleRetryQueueDlq(this.getAttribute('data-name'))" title="${isDlqTarget ? 'Replay Forwarded DLQ Messages to Original Queue' : 'Retry Dead-Letter Messages'}" style="padding: 3px 8px; font-size: 11px; color: #fbbf24;">
                          ↻ DLQ
                        </button>
                      ` : ''}
                      ${!isSys ? `
                        <button class="btn btn-secondary btn-sm" data-name="${escapeHtml(q.name)}" onclick="openEditQueueDrawer(this.getAttribute('data-name'))" title="Edit Queue Configuration" style="padding: 3px 8px; font-size: 11px;">
                          Edit
                        </button>
                        <button class="btn btn-secondary btn-sm" data-name="${escapeHtml(q.name)}" onclick="handlePurgeQueue(this.getAttribute('data-name'))" title="Purge All Messages in Queue" style="padding: 3px 8px; font-size: 11px;">
                          Purge
                        </button>
                        <button class="btn btn-secondary btn-sm" data-name="${escapeHtml(q.name)}" onclick="handleDeleteQueue(this.getAttribute('data-name'))" title="Delete Queue" style="padding: 3px 7px; font-size: 11px; color: var(--accent-danger);">
                          ✕
                        </button>
                      ` : ''}
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
    content.innerHTML = `<div style="color: var(--accent-danger); padding:2rem; text-align:center;">Failed to load queues: ${escapeHtml(err.message || String(err))}</div>`;
  }
}

function inspectQueueMessages(queueName) {
  const f = queuesState.messageFilter || queuesState.jobFilter;
  f.queue = queueName || '';
  f.page = 1;
  switchQueuesTab('messages');
}
const inspectQueueJobs = inspectQueueMessages;

// ==========================================
// Message Inspector Subtab
// ==========================================

async function loadQueueMessagesList() {
  const content = document.getElementById('queues-tab-content');
  if (!content) return;

  const f = queuesState.messageFilter || queuesState.jobFilter;
  if (!queuesState.includeSystem && f.queue && f.queue.startsWith('_system:')) {
    f.queue = '';
  }
  const knownQueues = (queuesState.queues || [])
    .filter(q => queuesState.includeSystem || (!q.isSystem && !q.name.startsWith('_system:')))
    .map(q => q.name);
  if (f.queue && !knownQueues.includes(f.queue) && (queuesState.includeSystem || !f.queue.startsWith('_system:'))) {
    knownQueues.unshift(f.queue);
  }

  content.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 1rem; background: var(--bg-card); border: 1px solid var(--border-subtle); padding: 10px 14px; border-radius: 8px;">
      <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px;">
        <select id="q-filter-queue" class="form-select" style="width: auto; padding: 4px 10px; font-size: 12px;" onchange="handleQueueMessageFilterChange()">
          <option value="">All Queues</option>
          ${knownQueues.map(qName => `<option value="${escapeHtml(qName)}" ${f.queue === qName ? 'selected' : ''}>${escapeHtml(qName)}</option>`).join('')}
        </select>

        <select id="q-filter-status" class="form-select" style="width: auto; padding: 4px 10px; font-size: 12px;" onchange="handleQueueMessageFilterChange()">
          <option value="all" ${f.status === 'all' ? 'selected' : ''}>All Statuses</option>
          <option value="queued" ${f.status === 'queued' ? 'selected' : ''}>Queued</option>
          <option value="processing" ${f.status === 'processing' ? 'selected' : ''}>Processing</option>
          <option value="completed" ${f.status === 'completed' ? 'selected' : ''}>Completed</option>
          <option value="dead_letter" ${f.status === 'dead_letter' ? 'selected' : ''}>Dead Letter (DLQ)</option>
          <option value="failed" ${f.status === 'failed' ? 'selected' : ''}>Failed</option>
        </select>

        ${(f.queue || f.status !== 'all') ? `
          <button class="btn btn-secondary btn-sm" onclick="clearQueueMessageFilters()" style="padding: 4px 8px; font-size: 11px;">Clear Filters</button>
        ` : ''}
      </div>

      <div style="display: flex; align-items: center; gap: 8px;">
        ${f.queue && !f.queue.startsWith('_system:') ? `
          <button class="btn btn-primary btn-sm" data-name="${escapeHtml(f.queue)}" onclick="openSendMessageDrawer(this.getAttribute('data-name'))" style="padding: 4px 10px; font-size: 11.5px;">
            + Send Message to ${escapeHtml(f.queue)}
          </button>
        ` : ''}
      </div>
    </div>

    <div id="queue-messages-table-area">
      <div style="text-align:center; padding: 2rem; color: var(--text-muted);">Loading messages...</div>
    </div>
  `;

  try {
    const prefix = getQueuesApiPrefix();
    const params = new URLSearchParams();
    params.set('page', String(f.page || 1));
    params.set('perPage', String(f.perPage || 25));
    if (f.queue) params.set('queue', f.queue);
    if (f.status && f.status !== 'all') params.set('status', f.status);
    if (queuesState.includeSystem) params.set('includeSystem', 'true');

    const res = await api(`${prefix}/messages?${params.toString()}`);
    const items = (res && Array.isArray(res.items)) ? res.items : [];
    queuesState.messages = items;
    queuesState.jobs = items;
    f.totalItems = res?.totalItems || items.length;
    f.totalPages = Math.max(1, res?.totalPages || 1);

    const tableArea = document.getElementById('queue-messages-table-area') || document.getElementById('queue-jobs-table-area');
    if (!tableArea) return;

    if (items.length === 0) {
      tableArea.innerHTML = `
        <div style="text-align:center; padding: 3rem 1.5rem; background: var(--bg-card); border: 1px dashed var(--border-subtle); border-radius: 8px; color: var(--text-muted);">
          No messages found matching the current filters.
        </div>
      `;
      return;
    }

    tableArea.innerHTML = `
      <div class="webhook-table-wrapper" style="overflow-x: auto; width: 100%;">
        <table class="webhook-table" style="min-width: 1040px; width: 100%;">
          <thead>
            <tr>
              <th style="width: 150px; min-width: 150px;">Message ID</th>
              <th style="width: 160px; min-width: 150px;">Queue</th>
              <th style="width: 120px; min-width: 110px;">Status</th>
              <th style="width: 100px; min-width: 90px;">Attempts</th>
              <th style="min-width: 260px;">Payload / Error Preview</th>
              <th style="width: 150px; min-width: 140px;">Created</th>
              <th style="width: 110px; min-width: 100px; text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(msg => {
              const statusBadge = renderQueueMessageStatusBadge(msg.status);
              const payloadPreview = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload ?? {});
              const shortPreview = payloadPreview.length > 90 ? payloadPreview.slice(0, 90) + '…' : payloadPreview;

              return `
                <tr data-message-id="${escapeHtml(msg.id)}" data-job-id="${escapeHtml(msg.id)}">
                  <td>
                    <span class="id-pill" style="cursor: pointer;" data-id="${escapeHtml(msg.id)}" onclick="openQueueMessageDetailDrawer(this.getAttribute('data-id'))" title="Click to inspect message">${escapeHtml(msg.id)}</span>
                  </td>
                  <td>
                    <span style="font-family: var(--font-mono); font-size: 12px; font-weight: 600;">${escapeHtml(msg.queue)}</span>
                    ${msg.groupKey ? `<div style="font-size: 10.5px; color: var(--text-muted);">Group: ${escapeHtml(msg.groupKey)}</div>` : ''}
                  </td>
                  <td>${statusBadge}</td>
                  <td style="font-family: var(--font-mono); font-size: 12px;">
                    ${msg.attempts || 0} / ${msg.maxAttempts === 0 ? '∞ (infinite)' : (msg.maxAttempts || 3)}
                    ${msg.priority ? `<div style="font-size: 10px; color: var(--text-muted);">Prio: ${msg.priority}</div>` : ''}
                  </td>
                  <td style="max-width: 320px;">
                    <code style="font-size: 11.5px; color: var(--text-main); word-break: break-all;">${escapeHtml(shortPreview)}</code>
                    ${(msg.error || msg.lastError) ? `<div style="font-size: 11px; color: var(--accent-danger); margin-top: 2px;">⚠️ ${escapeHtml(msg.error || msg.lastError)}</div>` : ''}
                  </td>
                  <td style="font-size: 11.5px; color: var(--text-muted); white-space: nowrap;">
                    ${msg.created ? new Date(msg.created).toLocaleString() : '--'}
                  </td>
                  <td style="text-align: right; white-space: nowrap;">
                    <button class="btn btn-secondary btn-sm" data-id="${escapeHtml(msg.id)}" onclick="openQueueMessageDetailDrawer(this.getAttribute('data-id'))" style="padding: 3px 8px; font-size: 11px;">
                      Inspect
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 0.85rem; font-size: 12px; color: var(--text-muted);">
        <span>Showing page ${f.page} of ${f.totalPages} (${f.totalItems} total messages)</span>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary btn-sm" ${f.page <= 1 ? 'disabled' : ''} onclick="changeQueueMessagePage(-1)">Previous</button>
          <button class="btn btn-secondary btn-sm" ${f.page >= f.totalPages ? 'disabled' : ''} onclick="changeQueueMessagePage(1)">Next</button>
        </div>
      </div>
    `;
  } catch (err) {
    const tableArea = document.getElementById('queue-messages-table-area') || document.getElementById('queue-jobs-table-area');
    if (tableArea) {
      tableArea.innerHTML = `<div style="color: var(--accent-danger); padding: 2rem; text-align: center;">Failed to load messages: ${escapeHtml(err.message || String(err))}</div>`;
    }
  }
}

function renderQueueMessageStatusBadge(status) {
  const s = (status || 'queued').toLowerCase();
  if (s === 'completed') return `<span class="badge badge-get">COMPLETED</span>`;
  if (s === 'processing') return `<span class="badge badge-post">PROCESSING</span>`;
  if (s === 'dead_letter' || s === 'failed') return `<span class="badge badge-delete">${escapeHtml(s.toUpperCase())}</span>`;
  return `<span class="badge" style="background: rgba(96, 165, 250, 0.15); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.3);">QUEUED</span>`;
}
const renderQueueJobStatusBadge = renderQueueMessageStatusBadge;

function handleQueueMessageFilterChange() {
  const qEl = document.getElementById('q-filter-queue');
  const sEl = document.getElementById('q-filter-status');
  const f = queuesState.messageFilter || queuesState.jobFilter;
  if (qEl) f.queue = qEl.value;
  if (sEl) f.status = sEl.value;
  f.page = 1;
  loadQueueMessagesList();
}
const handleQueueJobFilterChange = handleQueueMessageFilterChange;

function clearQueueMessageFilters() {
  const f = queuesState.messageFilter || queuesState.jobFilter;
  f.queue = '';
  f.status = 'all';
  f.page = 1;
  loadQueueMessagesList();
}
const clearQueueJobFilters = clearQueueMessageFilters;

function changeQueueMessagePage(delta) {
  const f = queuesState.messageFilter || queuesState.jobFilter;
  const next = f.page + delta;
  if (next >= 1 && next <= f.totalPages) {
    f.page = next;
    loadQueueMessagesList();
  }
}
const changeQueueJobPage = changeQueueMessagePage;
const loadQueueJobsList = loadQueueMessagesList;

// ==========================================
// Slide-Over Drawer: Create / Configure Queue
// ==========================================

function ensureDrawerRoot() {
  let root = document.getElementById('drawer-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'drawer-root';
    document.body.appendChild(root);
  }
  return root;
}

function handleQueueDrawerKeyDown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    closeQueueDrawer();
  }
}

function animateQueueDrawerOpen() {
  const triggerOpen = () => {
    const backdrop = document.getElementById('queue-drawer-backdrop');
    const panel = document.getElementById('queue-drawer-panel');
    if (backdrop) backdrop.classList.add('open');
    if (panel) panel.classList.add('open');
    const firstInput = panel?.querySelector('input:not([readonly]):not([type="hidden"]), select, textarea');
    if (firstInput && typeof firstInput.focus === 'function') {
      firstInput.focus();
    } else if (panel && typeof panel.focus === 'function') {
      panel.focus();
    }
  };

  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleQueueDrawerKeyDown);
    window.addEventListener('keydown', handleQueueDrawerKeyDown);
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(triggerOpen);
  } else {
    setTimeout(triggerOpen, 16);
  }
}

async function openCreateQueueDrawer(queueToEdit = null) {
  queuesState.activeQueueForEdit = queueToEdit;

  try {
    const fnRes = await api(getFunctionsApiPrefix());
    queuesState.functionsList = Array.isArray(fnRes) ? fnRes : (fnRes?.items || []);
  } catch (_) {
    queuesState.functionsList = [];
  }

  const isEdit = Boolean(queueToEdit && queueToEdit.name);
  const nameVal = isEdit ? queueToEdit.name : '';
  const concurrencyVal = isEdit && queueToEdit.concurrency !== null && queueToEdit.concurrency !== undefined && queueToEdit.concurrency > 0 ? queueToEdit.concurrency : '';
  const strictOrderVal = isEdit ? Boolean(queueToEdit.strictOrder) : false;
  const defaultMaxAttempts = strictOrderVal ? 0 : 3;
  const maxAttemptsVal = isEdit && queueToEdit.maxAttempts !== undefined ? queueToEdit.maxAttempts : defaultMaxAttempts;
  const visTimeoutVal = isEdit && queueToEdit.visibilityTimeoutSeconds !== undefined ? queueToEdit.visibilityTimeoutSeconds : 30;
  const defaultBackoff = strictOrderVal ? 0 : 1000;
  const backoffVal = isEdit && queueToEdit.backoffDelayMs !== undefined ? queueToEdit.backoffDelayMs : defaultBackoff;
  const dlqVal = isEdit && queueToEdit.deadLetterQueue ? queueToEdit.deadLetterQueue : '';
  const targetFnVal = isEdit && queueToEdit.targetFunction ? queueToEdit.targetFunction : '';

  const fnOptions = queuesState.functionsList.map(fn => {
    const fnName = fn.name || fn.id;
    return `<option value="${escapeHtml(fnName)}" ${targetFnVal === fnName ? 'selected' : ''}>${escapeHtml(fnName)}</option>`;
  }).join('');

  const root = ensureDrawerRoot();
  root.innerHTML = `
    <div id="queue-drawer-backdrop" class="drawer-backdrop" onclick="closeQueueDrawer()" aria-hidden="true"></div>
    <aside id="queue-drawer-panel" class="record-drawer webhook-drawer" role="dialog" aria-modal="true" aria-labelledby="queue-drawer-title" tabindex="-1" onkeydown="if(event.key==='Escape'){event.preventDefault();if(event.stopPropagation)event.stopPropagation();closeQueueDrawer();}">
      <!-- Drawer Header -->
      <div class="drawer-header">
        <div class="drawer-title-area">
          <span class="badge ${isEdit ? 'badge-post' : 'badge-get'}">${isEdit ? 'EDIT QUEUE' : 'NEW QUEUE'}</span>
          <div>
            <h3 class="drawer-title" id="queue-drawer-title" style="margin:0; font-size:1.05rem;">
              ${isEdit ? escapeHtml(nameVal) : 'Create & Configure Queue'}
            </h3>
            <span style="font-size:11px; color:var(--text-muted);">
              ${isEdit ? 'Update concurrency, retry policy, and worker binding' : 'Provision a persistent SQLite-backed message queue'}
            </span>
          </div>
        </div>
        <div class="drawer-header-actions">
          <button class="btn btn-secondary btn-sm" onclick="closeQueueDrawer()" aria-label="Close drawer">✕</button>
        </div>
      </div>

      <!-- Drawer Body -->
      <div class="drawer-body">
        <!-- Section 1: Identity & Worker Binding -->
        <div>
          <div class="drawer-section-title">1. Queue Identity & Worker Binding</div>
          <div class="drawer-card">
            <div class="form-group">
              <label class="form-label" for="queue-input-name">Queue Name <span style="color:var(--accent-danger);">*</span></label>
              <input
                type="text"
                id="queue-input-name"
                class="form-input"
                placeholder="e.g. emails-outbox or invoice-pdf-generator"
                value="${escapeHtml(nameVal)}"
                ${isEdit ? 'readonly style="opacity:0.7; cursor:not-allowed;"' : ''}
              />
              <div style="font-size: 11px; color: var(--text-muted);">
                Alphanumeric, dashes, underscores, or colons (cannot start with <code>_system:</code>).
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="queue-input-target-fn">Serverless Function Worker Binding (Optional)</label>
              <select id="queue-input-target-fn" class="form-select">
                <option value="">-- None (Pull via REST API or SDK Worker) --</option>
                ${fnOptions}
                ${targetFnVal && !queuesState.functionsList.some(f => (f.name || f.id) === targetFnVal) ? `<option value="${escapeHtml(targetFnVal)}" selected>${escapeHtml(targetFnVal)}</option>` : ''}
              </select>
              <div style="font-size: 11px; color: var(--text-muted);">
                When bound, NodeStack automatically invokes this Serverless Function for every claimed message.
              </div>
            </div>
          </div>
        </div>

        <!-- Section 2: Concurrency & Retry Policy -->
        <div>
          <div class="drawer-section-title">2. Concurrency & Retry Policy</div>
          <div class="drawer-card">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem;">
              <div class="form-group">
                <label class="form-label" for="queue-input-concurrency">Max Concurrency</label>
                <input
                  type="number"
                  id="queue-input-concurrency"
                  class="form-input"
                  min="1"
                  placeholder="Unbounded (blank)"
                  value="${escapeHtml(String(concurrencyVal))}"
                />
                <div style="font-size: 11px; color: var(--text-muted);">Max parallel messages (blank = unlimited)</div>
              </div>

              <div class="form-group">
                <label class="form-label" for="queue-input-max-attempts">Max Attempts</label>
                <input
                  type="number"
                  id="queue-input-max-attempts"
                  class="form-input"
                  min="1"
                  max="100"
                  value="${escapeHtml(String(maxAttemptsVal))}"
                />
                <div style="font-size: 11px; color: var(--text-muted);">Retries before moving to DLQ</div>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem;">
              <div class="form-group">
                <label class="form-label" for="queue-input-vis-timeout">Visibility Timeout (sec)</label>
                <input
                  type="number"
                  id="queue-input-vis-timeout"
                  class="form-input"
                  min="1"
                  value="${escapeHtml(String(visTimeoutVal))}"
                />
                <div style="font-size: 11px; color: var(--text-muted);">Crash-recovery lease duration</div>
              </div>

              <div class="form-group">
                <label class="form-label" for="queue-input-backoff">Backoff Delay (ms)</label>
                <input
                  type="number"
                  id="queue-input-backoff"
                  class="form-input"
                  min="0"
                  value="${escapeHtml(String(backoffVal))}"
                />
                <div style="font-size: 11px; color: var(--text-muted);">Base retry backoff in milliseconds</div>
              </div>
            </div>
            <div class="form-group" style="margin-top: 0.85rem; padding-top: 0.85rem; border-top: 1px solid var(--border-subtle);">
              <label class="form-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;">
                <input
                  type="checkbox"
                  id="queue-input-strict-order"
                  ${strictOrderVal ? 'checked' : ''}
                  onchange="handleStrictOrderToggle(this.checked)"
                  style="cursor: pointer; width: 16px; height: 16px;"
                />
                <span style="font-weight: 600; color: var(--text-main);">Strict Ordering (Head-of-Line FIFO & Group Blocking)</span>
              </label>
              <div style="font-size: 11px; color: var(--text-muted); margin-left: 24px;">
                Enforces strict ordering per partition (<code>groupKey</code> or whole queue). A failed/unacked message blocks subsequent messages in its group until Acked or dead-lettered.
              </div>
            </div>
          </div>
        </div>

        <!-- Section 3: Dead-Letter Queue Routing -->
        <div>
          <div class="drawer-section-title">3. Dead-Letter Routing</div>
          <div class="drawer-card">
            <div class="form-group">
              <label class="form-label" for="queue-input-dlq">Dead-Letter Queue Name (Optional)</label>
              <input
                type="text"
                id="queue-input-dlq"
                class="form-input"
                placeholder="e.g. emails-outbox-dlq"
                value="${escapeHtml(dlqVal)}"
              />
              <div style="font-size: 11px; color: var(--text-muted);">
                Optional target queue or label for messages that exhaust all retry attempts.
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Drawer Footer -->
      <div class="drawer-footer" style="padding:1rem 1.5rem; border-top:1px solid var(--border-subtle); display:flex; justify-content:flex-end; align-items:center; gap: 0.75rem; background:var(--bg-card); flex-shrink:0;">
        <button class="btn btn-secondary btn-sm" onclick="closeQueueDrawer()">Cancel</button>
        <button class="btn btn-primary btn-sm" id="btn-save-queue" onclick="submitQueueForm()">
          ${isEdit ? 'Save Changes' : 'Create Queue'}
        </button>
      </div>
    </aside>
  `;

  animateQueueDrawerOpen();
}

async function openEditQueueDrawer(queueName) {
  try {
    const prefix = getQueuesApiPrefix();
    const queue = await api(`${prefix}/${encodeURIComponent(queueName)}`);
    if (queue) {
      await openCreateQueueDrawer(queue);
    }
  } catch (err) {
    if (typeof toast === 'function') toast('Failed to load queue: ' + err.message, 'error');
  }
}

function handleStrictOrderToggle(checked) {
  const backoffEl = document.getElementById('queue-input-backoff');
  if (backoffEl && (!queuesState.activeQueueForEdit || backoffEl.value === '1000' || backoffEl.value === '0')) {
    backoffEl.value = checked ? '0' : '1000';
  }
}

async function submitQueueForm() {
  const nameEl = document.getElementById('queue-input-name');
  const targetFnEl = document.getElementById('queue-input-target-fn');
  const concEl = document.getElementById('queue-input-concurrency');
  const attemptsEl = document.getElementById('queue-input-max-attempts');
  const visEl = document.getElementById('queue-input-vis-timeout');
  const backoffEl = document.getElementById('queue-input-backoff');
  const dlqEl = document.getElementById('queue-input-dlq');
  const strictEl = document.getElementById('queue-input-strict-order');
  const saveBtn = document.getElementById('btn-save-queue');

  const name = (nameEl?.value || '').trim();
  if (!name) {
    if (typeof toast === 'function') toast('Queue name is required', 'error');
    nameEl?.focus();
    return;
  }
  if (name.startsWith('_system:')) {
    if (typeof toast === 'function') toast('User queue names cannot start with _system:', 'error');
    nameEl?.focus();
    return;
  }

  const concRaw = (concEl?.value || '').trim();
  const concurrency = concRaw === '' ? 0 : Math.max(0, parseInt(concRaw, 10) || 0);
  const maxAttempts = Math.max(1, parseInt(attemptsEl?.value || '3', 10) || 3);
  const visibilityTimeoutSeconds = Math.max(1, parseInt(visEl?.value || '30', 10) || 30);
  const backoffDelayMs = Math.max(0, parseInt(backoffEl?.value || '1000', 10) || 0);
  const deadLetterQueue = (dlqEl?.value || '').trim() || null;
  const targetFunction = (targetFnEl?.value || '').trim() || null;
  const strictOrder = Boolean(strictEl?.checked);

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const prefix = getQueuesApiPrefix();
    await api(prefix, {
      method: 'POST',
      body: JSON.stringify({
        name,
        concurrency,
        maxAttempts,
        visibilityTimeoutSeconds,
        backoffDelayMs,
        deadLetterQueue,
        targetFunction,
        strictOrder,
      }),
    });

    if (typeof toast === 'function') {
      toast(queuesState.activeQueueForEdit ? `Queue "${name}" updated` : `Queue "${name}" created`, 'success');
    }
    closeQueueDrawer();
    await loadQueueStats();
    await loadQueuesList();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to save queue', 'error');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = queuesState.activeQueueForEdit ? 'Save Changes' : 'Create Queue';
    }
  }
}

// ==========================================
// Slide-Over Drawer: Send Message to Queue
// ==========================================

function openSendMessageDrawer(queueName) {
  const root = ensureDrawerRoot();

  root.innerHTML = `
    <div id="queue-drawer-backdrop" class="drawer-backdrop" onclick="closeQueueDrawer()" aria-hidden="true"></div>
    <aside id="queue-drawer-panel" class="record-drawer webhook-drawer" role="dialog" aria-modal="true" aria-labelledby="queue-send-drawer-title" tabindex="-1" onkeydown="if(event.key==='Escape'){event.preventDefault();if(event.stopPropagation)event.stopPropagation();closeQueueDrawer();}">
      <!-- Drawer Header -->
      <div class="drawer-header">
        <div class="drawer-title-area">
          <span class="badge badge-post">ENQUEUE</span>
          <div>
            <h3 class="drawer-title" id="queue-send-drawer-title" style="margin:0; font-size:1.05rem;">
              Send Message to <code>${escapeHtml(queueName)}</code>
            </h3>
            <span style="font-size:11px; color:var(--text-muted);">Dispatch a JSON payload into the queue with optional priority or delay</span>
          </div>
        </div>
        <div class="drawer-header-actions">
          <button class="btn btn-secondary btn-sm" onclick="closeQueueDrawer()" aria-label="Close drawer">✕</button>
        </div>
      </div>

      <!-- Drawer Body -->
      <div class="drawer-body">
        <input type="hidden" id="send-msg-queue-name" value="${escapeHtml(queueName)}" />

        <div>
          <div class="drawer-section-title">1. Message Payload</div>
          <div class="drawer-card">
            <div class="form-group">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <label class="form-label" for="send-msg-payload" style="margin:0;">Payload Body (JSON) <span style="color:var(--accent-danger);">*</span></label>
                <button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;" onclick="if(typeof formatJsonField==='function') formatJsonField('send-msg-payload')">Format JSON</button>
              </div>
              <textarea
                id="send-msg-payload"
                class="form-textarea json-textarea"
                rows="8"
              >{\n  "event": "test_message",\n  "timestamp": "${new Date().toISOString()}"\n}</textarea>
            </div>
          </div>
        </div>

        <div>
          <div class="drawer-section-title">2. Delivery Options</div>
          <div class="drawer-card">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem;">
              <div class="form-group">
                <label class="form-label" for="send-msg-priority">Priority</label>
                <input type="number" id="send-msg-priority" class="form-input" value="0" />
                <div style="font-size: 11px; color: var(--text-muted);">Higher numbers are claimed first</div>
              </div>
              <div class="form-group">
                <label class="form-label" for="send-msg-delay">Delay (sec)</label>
                <input type="number" id="send-msg-delay" class="form-input" min="0" value="0" />
                <div style="font-size: 11px; color: var(--text-muted);">Seconds before message becomes visible</div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="send-msg-dedup">Deduplication ID (Optional)</label>
              <input type="text" id="send-msg-dedup" class="form-input" placeholder="e.g. order-123-confirmation" />
              <div style="font-size: 11px; color: var(--text-muted);">Prevents duplicate active messages with the same deduplication key</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Drawer Footer -->
      <div class="drawer-footer" style="padding:1rem 1.5rem; border-top:1px solid var(--border-subtle); display:flex; justify-content:flex-end; align-items:center; gap: 0.75rem; background:var(--bg-card); flex-shrink:0;">
        <button class="btn btn-secondary btn-sm" onclick="closeQueueDrawer()">Cancel</button>
        <button class="btn btn-primary btn-sm" id="btn-submit-queue-msg" onclick="submitSendQueueMessage()">
          ✉ Enqueue Message
        </button>
      </div>
    </aside>
  `;

  animateQueueDrawerOpen();
}

async function submitSendQueueMessage() {
  const queueName = document.getElementById('send-msg-queue-name')?.value || '';
  const payloadRaw = document.getElementById('send-msg-payload')?.value || '{}';
  const priority = parseInt(document.getElementById('send-msg-priority')?.value || '0', 10) || 0;
  const delaySeconds = Math.max(0, parseInt(document.getElementById('send-msg-delay')?.value || '0', 10) || 0);
  const deduplicationId = (document.getElementById('send-msg-dedup')?.value || '').trim() || undefined;
  const btn = document.getElementById('btn-submit-queue-msg');

  let parsedPayload;
  try {
    parsedPayload = JSON.parse(payloadRaw);
  } catch (_) {
    if (typeof toast === 'function') toast('Payload must be valid JSON', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Enqueuing...';
  }

  try {
    const prefix = getQueuesApiPrefix();
    await api(`${prefix}/${encodeURIComponent(queueName)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        payload: parsedPayload,
        priority,
        delaySeconds,
        deduplicationId,
      }),
    });
    if (typeof toast === 'function') toast(`Message enqueued to "${queueName}"`, 'success');
    closeQueueDrawer();
    await loadQueueStats();
    if (queuesState.subTab === 'queues') {
      await loadQueuesList();
    } else {
      await loadQueueMessagesList();
    }
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to enqueue message', 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✉ Enqueue Message';
    }
  }
}

// ==========================================
// Queue Actions: Retry DLQ, Purge, Delete, Cleanup
// ==========================================

async function handleRequeueMessage(messageId, queueName) {
  try {
    const prefix = getQueuesApiPrefix();
    const endpoint = `${prefix}/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(messageId)}/retry`;
    await api(endpoint, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (typeof toast === 'function') {
      toast(`Message "${messageId}" retried / requeued successfully`, 'success');
    }
    closeQueueDrawer();
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to retry message', 'error');
  }
}

const handleRequeueJob = handleRequeueMessage;
const handleRetryJob = handleRequeueMessage;
const handleRetrySingleJob = handleRequeueJob;

async function handleDeleteQueueMessage(messageId, queueName) {
  const safeId = typeof escapeHtml === 'function' ? escapeHtml(messageId) : messageId;
  const confirmed = typeof showConfirmDialog === 'function'
    ? await showConfirmDialog({
        title: 'Delete / Cancel Message',
        message: `Are you sure you want to delete / cancel message <strong style="color: var(--text-heading); font-family: var(--font-mono);">${safeId}</strong>?`,
        messageText: `Are you sure you want to delete / cancel message "${messageId}"?`,
        warning: 'This action cannot be undone. The message will be permanently removed from the queue.',
        warningType: 'danger',
        confirmText: 'Delete Message',
        cancelText: 'Cancel',
        variant: 'danger',
        icon: '🗑️',
      })
    : confirm(`Are you sure you want to delete / cancel message "${messageId}"?`);

  if (!confirmed) return;

  try {
    const prefix = getQueuesApiPrefix();
    const endpoint = `${prefix}/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(messageId)}`;
    await api(endpoint, {
      method: 'DELETE',
    });
    if (typeof toast === 'function') {
      toast(`Message "${messageId}" deleted / cancelled successfully`, 'success');
    }
    closeQueueDrawer();
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to delete message', 'error');
  }
}

const handleDeleteQueueJob = handleDeleteQueueMessage;
const handleCancelQueueJob = handleDeleteQueueMessage;
const handleCancelJob = handleDeleteQueueJob;

async function handleRetryQueueDlq(queueName) {
  try {
    const prefix = getQueuesApiPrefix();
    const res = await api(`${prefix}/${encodeURIComponent(queueName)}/dlq/retry`, {
      method: 'POST',
      body: JSON.stringify({ limit: 100 }),
    });
    if (typeof toast === 'function') {
      toast(`Retried ${res?.retriedCount || 0} dead-letter messages in "${queueName}"`, 'success');
    }
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to retry DLQ', 'error');
  }
}

async function handlePurgeQueue(queueName) {
  const confirmed = typeof showConfirmDialog === 'function'
    ? await showConfirmDialog({
        title: 'Purge Queue Messages',
        message: `Are you sure you want to purge all messages in queue <strong style="color: var(--text-heading); font-family: var(--font-mono);">${escapeHtml(queueName)}</strong>?`,
        warning: 'This will permanently delete all queued, processing, completed, and dead-letter messages in this queue.',
        warningType: 'warning',
        confirmText: 'Purge Messages',
        cancelText: 'Cancel',
        variant: 'warning',
        icon: '⚠️',
      })
    : confirm(`Purge all messages in queue "${queueName}"?`);

  if (!confirmed) return;

  try {
    const prefix = getQueuesApiPrefix();
    const res = await api(`${prefix}/${encodeURIComponent(queueName)}/purge`, {
      method: 'DELETE',
    });
    if (typeof toast === 'function') {
      toast(`Purged ${res?.purgedCount || 0} messages from "${queueName}"`, 'success');
    }
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to purge queue', 'error');
  }
}

async function handleDeleteQueue(queueName) {
  const confirmed = typeof showConfirmDialog === 'function'
    ? await showConfirmDialog({
        title: 'Delete Queue',
        message: `Are you sure you want to delete queue <strong style="color: var(--text-heading); font-family: var(--font-mono);">${escapeHtml(queueName)}</strong>?`,
        warning: 'This action cannot be undone. Both the queue configuration and all associated messages will be removed.',
        warningType: 'danger',
        confirmText: 'Delete Queue',
        cancelText: 'Cancel',
        variant: 'danger',
        icon: '⚠️',
      })
    : confirm(`Delete queue "${queueName}" and all its messages?`);

  if (!confirmed) return;

  try {
    const prefix = getQueuesApiPrefix();
    await api(`${prefix}/${encodeURIComponent(queueName)}`, {
      method: 'DELETE',
    });
    if (typeof toast === 'function') toast(`Queue "${queueName}" deleted`, 'success');
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to delete queue', 'error');
  }
}

async function handleCleanupOldQueueMessages() {

  try {
    const prefix = getQueuesApiPrefix();
    const res = await api(`${prefix}/cleanup`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (typeof toast === 'function') {
      toast(`Cleaned up ${res?.prunedCount || 0} expired terminal messages`, 'success');
    }
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to cleanup messages', 'error');
  }
}

// ==========================================
// Slide-Over Drawer: Message Detail Inspection
// ==========================================

async function openQueueMessageDetailDrawer(messageId) {
  try {
    const prefix = getQueuesApiPrefix();
    const msg = await api(`${prefix}/messages/${encodeURIComponent(messageId)}`);
    if (!msg) return;

    const root = ensureDrawerRoot();
    const isSys = Boolean(msg.queue && msg.queue.startsWith('_system:'));
    let queueConfig = queuesState.queues.find(q => q.name === msg.queue);
    if (!queueConfig && msg.queue) {
      try {
        queueConfig = await api(`${prefix}/${encodeURIComponent(msg.queue)}`);
      } catch {}
    }
    const isStrictOrder = Boolean(queueConfig?.strictOrder);
    const isForwardedDlq = Boolean(
      msg.originalMessageId ||
      msg.originalJobId ||
      (msg.payload && typeof msg.payload === 'object' && (msg.payload.originalMessageId || msg.payload.originalJobId) && msg.payload.originalQueue)
    );
    const origId = msg.originalMessageId || msg.originalJobId || (msg.payload && (msg.payload.originalMessageId || msg.payload.originalJobId));
    const origQueue = (msg.payload && msg.payload.originalQueue) || '';

    root.innerHTML = `
      <div id="queue-drawer-backdrop" class="drawer-backdrop" onclick="closeQueueDrawer()" aria-hidden="true"></div>
      <aside id="queue-drawer-panel" class="record-drawer webhook-drawer" role="dialog" aria-modal="true" tabindex="-1" onkeydown="if(event.key==='Escape'){event.preventDefault();if(event.stopPropagation)event.stopPropagation();closeQueueDrawer();}">
        <div class="drawer-header">
          <div class="drawer-title-area">
            ${renderQueueMessageStatusBadge(msg.status)}
            <div>
              <h3 class="drawer-title" style="margin:0; font-size:1.02rem; font-family: var(--font-mono);">${escapeHtml(msg.id)}</h3>
              <span style="font-size:11px; color:var(--text-muted);">Queue: <strong>${escapeHtml(msg.queue)}</strong> • Attempt ${msg.attempts || 0}/${msg.maxAttempts === 0 ? '∞ (infinite)' : (msg.maxAttempts || 3)}</span>
            </div>
          </div>
          <div class="drawer-header-actions">
            <button class="btn btn-secondary btn-sm" onclick="closeQueueDrawer()" aria-label="Close drawer">✕</button>
          </div>
        </div>

        <div class="drawer-body">
          <div>
            <div class="drawer-section-title">Message Metadata</div>
            <div class="drawer-card">
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:10px; font-size:12px;">
                <div>
                  <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Status</span>
                  <strong>${escapeHtml((msg.status || '').toUpperCase())}</strong>
                </div>
                <div>
                  <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Priority</span>
                  <span>${msg.priority || 0}</span>
                </div>
                <div>
                  <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Created</span>
                  <span>${msg.created ? new Date(msg.created).toLocaleString() : '--'}</span>
                </div>
                <div>
                  <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Completed</span>
                  <span>${msg.completedAt || msg.finishedAt ? new Date(msg.completedAt || msg.finishedAt).toLocaleString() : '--'}</span>
                </div>
                ${(msg.forwardedToMessageId || msg.forwardedToJobId) ? `
                  <div>
                    <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Forwarded DLQ ID</span>
                    <span style="font-family: var(--font-mono); font-size:11px; color:#fbbf24;">${escapeHtml(msg.forwardedToMessageId || msg.forwardedToJobId)}</span>
                  </div>
                ` : ''}
                ${isForwardedDlq ? `
                  <div>
                    <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Original Queue</span>
                    <strong style="color: #60a5fa; font-family: var(--font-mono); font-size:11.5px;">${escapeHtml(origQueue || '--')}</strong>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>

          ${isForwardedDlq ? `
            <div style="background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3); border-radius:6px; padding:10px 14px; font-size:12px; color: #fbbf24; margin-top: 10px;">
              <strong>Forwarded DLQ Message:</strong> This message was forwarded from queue <strong>${escapeHtml(origQueue || '--')}</strong> (Original ID: <code>${escapeHtml(origId || '--')}</code>).
              ${msg.payload && msg.payload.error ? `<div style="margin-top: 4px; color: var(--accent-danger);"><strong>Failure Reason:</strong> ${escapeHtml(msg.payload.error)}</div>` : ''}
            </div>
          ` : ''}

          ${(msg.error || msg.lastError) ? `
            <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:6px; padding:10px 14px; font-size:12px; color: var(--accent-danger);">
              <strong>Error:</strong> ${escapeHtml(msg.error || msg.lastError)}
            </div>
          ` : ''}

          <div>
            <div class="drawer-section-title">Message Payload</div>
            <div class="drawer-json-container">
              <div class="drawer-json-bar">
                <span>JSON Payload</span>
              </div>
              <pre class="drawer-json-pre"><code>${escapeHtml(JSON.stringify(msg.payload, null, 2))}</code></pre>
            </div>
          </div>

          ${msg.result !== undefined && msg.result !== null ? `
            <div>
              <div class="drawer-section-title">Worker Execution Result</div>
              <div class="drawer-json-container">
                <div class="drawer-json-bar">
                  <span style="color: #34d399; font-weight: 700;">Result</span>
                </div>
                <pre class="drawer-json-pre"><code>${escapeHtml(JSON.stringify(msg.result, null, 2))}</code></pre>
              </div>
            </div>
          ` : ''}

          ${msg.executionLogs ? `
            <div>
              <div class="drawer-section-title">Captured Worker Logs</div>
              <div class="drawer-json-container">
                <div class="drawer-json-bar">
                  <span style="color: #38bdf8; font-weight: 700;">Worker Output ${msg.executionDurationMs ? `(${msg.executionDurationMs}ms)` : ''}</span>
                </div>
                <pre class="drawer-json-pre" style="color: #38bdf8; white-space: pre-wrap; font-family: 'JetBrains Mono', Consolas, Monaco, monospace; font-size: 11.5px; line-height: 1.5; padding: 12px; background: #0f172a; margin: 0;"><code>${escapeHtml(msg.executionLogs)}</code></pre>
              </div>
            </div>
          ` : ''}

          <div style="font-size: 11px; color: var(--text-muted); padding: 4px 2px;">
            💡 <em>Worker function logs are also recorded under the <strong>Functions → Logs</strong> tab.</em>
          </div>
        </div>

        <div class="drawer-footer" style="padding:1rem 1.5rem; border-top:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center; background:var(--bg-card); flex-shrink:0;">
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${!isSys && msg.status === 'processing' ? `
              <button class="btn btn-primary btn-sm" id="btn-message-ack" data-legacy-id="btn-job-ack" data-queue="${escapeHtml(msg.queue)}" data-id="${escapeHtml(msg.id)}" onclick="handleAckQueueMessage(this.getAttribute('data-queue'), this.getAttribute('data-id'))">✓ ACK (Complete)</button>
              <button class="btn btn-secondary btn-sm" id="btn-message-nack" data-legacy-id="btn-job-nack" data-queue="${escapeHtml(msg.queue)}" data-id="${escapeHtml(msg.id)}" onclick="handleNackQueueMessage(this.getAttribute('data-queue'), this.getAttribute('data-id'))">✕ NACK (Fail)</button>
            ` : ''}
            ${!isSys && isStrictOrder && (msg.status === 'queued' || msg.status === 'processing') ? `
              <button class="btn btn-secondary btn-sm" id="btn-force-skip-message" data-queue="${escapeHtml(msg.queue)}" data-id="${escapeHtml(msg.id)}" onclick="handleForceSkipQueueMessage(this.getAttribute('data-queue'), this.getAttribute('data-id'))" style="color: #f59e0b; border-color: rgba(245, 158, 11, 0.4);" title="Force skip this blocking head-of-line message to DLQ to unblock pending messages">
                ⚠️ Force Skip to DLQ
              </button>
            ` : ''}
            ${!isSys && isForwardedDlq ? `
              <button class="btn btn-primary btn-sm" id="btn-message-retry" data-legacy-id="btn-job-retry" data-queue="${escapeHtml(msg.queue)}" data-id="${escapeHtml(msg.id)}" onclick="handleRequeueMessage(this.getAttribute('data-id'), this.getAttribute('data-queue'))">
                ↻ Replay to "${escapeHtml(origQueue || 'Original Queue')}"
              </button>
            ` : !isSys && (msg.status === 'dead_letter' || msg.status === 'failed') ? `
              <button class="btn btn-primary btn-sm" id="btn-message-retry" data-legacy-id="btn-job-retry" data-queue="${escapeHtml(msg.queue)}" data-id="${escapeHtml(msg.id)}" onclick="handleRequeueMessage(this.getAttribute('data-id'), this.getAttribute('data-queue'))" title="Retry this single message">
                ↻ Retry Message
              </button>
              <button class="btn btn-secondary btn-sm" id="btn-retry-all-dlq" data-queue="${escapeHtml(msg.queue)}" onclick="handleRetryQueueDlq(this.getAttribute('data-queue')); closeQueueDrawer();" title="Retry all dead-letter messages in this queue">
                ↻ Retry All Queue DLQ
              </button>
            ` : ''}
            ${!isSys ? `
              <button class="btn btn-danger btn-sm" id="btn-message-delete" data-legacy-id="btn-job-delete" data-queue="${escapeHtml(msg.queue)}" data-id="${escapeHtml(msg.id)}" onclick="handleDeleteQueueMessage(this.getAttribute('data-id'), this.getAttribute('data-queue'))" style="color: var(--accent-danger); border-color: rgba(239, 68, 68, 0.35);" title="Delete / Cancel this individual message">
                🗑 Delete / Cancel Message
              </button>
            ` : ''}
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-drawer-close" onclick="closeQueueDrawer()">Close</button>
        </div>
      </aside>
    `;

    animateQueueDrawerOpen();
  } catch (err) {
    if (typeof toast === 'function') toast('Failed to load message details: ' + err.message, 'error');
  }
}


async function handleForceSkipQueueMessage(queueName, messageId) {
  const safeId = typeof escapeHtml === 'function' ? escapeHtml(messageId) : messageId;
  const confirmed = typeof showConfirmDialog === 'function'
    ? await showConfirmDialog({
        title: 'Force Skip Message to DLQ?',
        message: `Are you sure you want to force-skip message <strong style="color: var(--text-heading); font-family: var(--font-mono);">${safeId}</strong> to the Dead-Letter Queue?`,
        messageText: `Are you sure you want to force-skip message "${messageId}" to DLQ?`,
        warning: 'In strict-ordered queues, this bypasses the head-of-line block and immediately allows pending messages to resume processing.',
        warningType: 'warning',
        confirmText: 'Force Skip to DLQ',
        cancelText: 'Cancel',
        variant: 'danger',
        icon: '⚠️',
      })
    : confirm(`Force-skip message "${messageId}" to DLQ to unblock strict queue?`);

  if (!confirmed) return;

  try {
    const prefix = getQueuesApiPrefix();
    await api(`${prefix}/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(messageId)}/skip`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Force-skipped to DLQ by operator via Admin UI' }),
    });
    if (typeof toast === 'function') {
      toast(`Message "${messageId}" skipped to DLQ`, 'warning');
    }
    closeQueueDrawer();
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to force-skip message', 'error');
  }
}

async function handleAckQueueMessage(queueName, messageId) {
  try {
    const prefix = getQueuesApiPrefix();
    await api(`${prefix}/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(messageId)}/ack`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (typeof toast === 'function') toast('Message marked completed (ACK)', 'success');
    closeQueueDrawer();
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to ACK message', 'error');
  }
}
const handleAckQueueJob = handleAckQueueMessage;

async function handleNackQueueMessage(queueName, messageId) {
  try {
    const prefix = getQueuesApiPrefix();
    await api(`${prefix}/${encodeURIComponent(queueName)}/messages/${encodeURIComponent(messageId)}/nack`, {
      method: 'POST',
      body: JSON.stringify({ error: 'Rejected manually from Admin UI' }),
    });
    if (typeof toast === 'function') toast('Message rejected (NACK)', 'info');
    closeQueueDrawer();
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to NACK message', 'error');
  }
}
const handleNackQueueJob = handleNackQueueMessage;

function closeQueueDrawer() {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleQueueDrawerKeyDown);
  }
  const backdrop = document.getElementById('queue-drawer-backdrop');
  const panel = document.getElementById('queue-drawer-panel');
  if (backdrop) backdrop.classList.remove('open');
  if (panel) panel.classList.remove('open');
  setTimeout(() => {
    const root = document.getElementById('drawer-root');
    if (root && root.querySelector('#queue-drawer-panel')) {
      root.innerHTML = '';
    }
  }, 260);
}

// Keep aliases for backward compatibility
const openCreateQueueModal = openCreateQueueDrawer;
const openEditQueueModal = openEditQueueDrawer;
const openSendMessageModal = openSendMessageDrawer;
const closeQueueModal = closeQueueDrawer;
const openQueueJobDetailDrawer = openQueueMessageDetailDrawer;
const handleCleanupOldQueueJobs = handleCleanupOldQueueMessages;

if (typeof window !== 'undefined') {
  window.renderQueuesView = renderQueuesView;
  window.refreshQueuesView = refreshQueuesView;
  window.switchQueuesTab = switchQueuesTab;
  window.toggleIncludeSystemQueues = toggleIncludeSystemQueues;
  window.loadQueueStats = loadQueueStats;
  window.loadQueuesList = loadQueuesList;
  window.loadQueueMessagesList = loadQueueMessagesList;
  window.loadQueueJobsList = loadQueueMessagesList;
  window.inspectQueueMessages = inspectQueueMessages;
  window.inspectQueueJobs = inspectQueueMessages;
  window.handleQueueMessageFilterChange = handleQueueMessageFilterChange;
  window.handleQueueJobFilterChange = handleQueueMessageFilterChange;
  window.clearQueueMessageFilters = clearQueueMessageFilters;
  window.clearQueueJobFilters = clearQueueMessageFilters;
  window.changeQueueMessagePage = changeQueueMessagePage;
  window.changeQueueJobPage = changeQueueMessagePage;
  window.openCreateQueueDrawer = openCreateQueueDrawer;
  window.openEditQueueDrawer = openEditQueueDrawer;
  window.openCreateQueueModal = openCreateQueueModal;
  window.openEditQueueModal = openEditQueueModal;
  window.submitQueueForm = submitQueueForm;
  window.openSendMessageDrawer = openSendMessageDrawer;
  window.openSendMessageModal = openSendMessageModal;
  window.submitSendQueueMessage = submitSendQueueMessage;
  window.closeQueueDrawer = closeQueueDrawer;
  window.closeQueueModal = closeQueueModal;
  window.handleRetryQueueDlq = handleRetryQueueDlq;
  window.handleRequeueMessage = handleRequeueMessage;
  window.handleRequeueJob = handleRequeueMessage;
  window.handleRetryJob = handleRequeueMessage;
  window.handleRetrySingleJob = handleRequeueMessage;
  window.handleDeleteQueueMessage = handleDeleteQueueMessage;
  window.handleDeleteQueueJob = handleDeleteQueueMessage;
  window.handleCancelQueueJob = handleDeleteQueueMessage;
  window.handleCancelJob = handleDeleteQueueMessage;
  window.handleQueueDrawerKeyDown = handleQueueDrawerKeyDown;
  window.handlePurgeQueue = handlePurgeQueue;
  window.handleDeleteQueue = handleDeleteQueue;
  window.handleCleanupOldQueueMessages = typeof handleCleanupOldQueueMessages !== 'undefined' ? handleCleanupOldQueueMessages : handleCleanupOldQueueJobs;
  window.handleCleanupOldQueueJobs = typeof handleCleanupOldQueueMessages !== 'undefined' ? handleCleanupOldQueueMessages : handleCleanupOldQueueJobs;
  window.openQueueMessageDetailDrawer = openQueueMessageDetailDrawer;
  window.openQueueJobDetailDrawer = openQueueMessageDetailDrawer;
  window.handleForceSkipQueueMessage = handleForceSkipQueueMessage;
  window.handleForceSkipMessage = handleForceSkipQueueMessage;
  window.handleAckQueueMessage = handleAckQueueMessage;
  window.handleAckQueueJob = handleAckQueueMessage;
  window.handleNackQueueMessage = handleNackQueueMessage;
  window.handleNackQueueJob = handleNackQueueMessage;
}
