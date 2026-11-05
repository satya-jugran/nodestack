// Queues Manager Module for NodeStack Admin UI

let queuesState = {
  subTab: 'queues', // 'queues' | 'jobs'
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
  jobs: [],
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
          <p>Configure SQLite-backed message queues, bind Serverless Function workers, manage concurrency, and inspect jobs & Dead-Letter Queues.</p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm" id="btn-cleanup-queues" onclick="handleCleanupOldQueueJobs()" title="Prune terminal completed/failed jobs older than retention window">
            🧹 Cleanup Old Jobs
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-refresh-queues" onclick="refreshQueuesView()" title="Refresh Queues & Jobs">
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
          <span class="webhook-stat-label">Completed Jobs</span>
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
          <button class="webhook-tab-btn ${queuesState.subTab === 'jobs' ? 'active' : ''}" id="tab-btn-queues-jobs" onclick="switchQueuesTab('jobs')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Job Inspector
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
    loadQueueJobsList();
  }
}

async function refreshQueuesView() {
  await loadQueueStats();
  if (queuesState.subTab === 'queues') {
    await loadQueuesList();
  } else {
    await loadQueueJobsList();
  }
  if (typeof toast === 'function') toast('Queues updated', 'info');
}

function toggleIncludeSystemQueues(checked) {
  queuesState.includeSystem = Boolean(checked);
  if (!queuesState.includeSystem && queuesState.jobFilter.queue && queuesState.jobFilter.queue.startsWith('_system:')) {
    queuesState.jobFilter.queue = '';
  }
  loadQueueStats();
  if (queuesState.subTab === 'queues') {
    loadQueuesList();
  } else {
    loadQueueJobsList();
  }
}

function switchQueuesTab(tab, pushState = true) {
  queuesState.subTab = tab;
  const btnList = document.getElementById('tab-btn-queues-list');
  const btnJobs = document.getElementById('tab-btn-queues-jobs');
  if (btnList) btnList.classList.toggle('active', tab === 'queues');
  if (btnJobs) btnJobs.classList.toggle('active', tab === 'jobs');

  if (pushState && typeof updateUrl === 'function') {
    const path = tab === 'jobs' ? '/_/queues/jobs' : '/_/queues';
    updateUrl(path);
  }

  if (tab === 'queues') {
    loadQueuesList();
  } else {
    loadQueueJobsList();
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

    const userQueuesCount = queuesState.queues.filter(q => !q.isSystem).length;
    const sidebarBadge = document.getElementById('sidebar-queues-count');
    if (sidebarBadge) {
      sidebarBadge.textContent = String(userQueuesCount);
      sidebarBadge.style.display = userQueuesCount > 0 ? 'inline-block' : 'none';
    }
    const elQueues = document.getElementById('q-stat-queues');
    if (elQueues) {
      elQueues.textContent = String(userQueuesCount);
    }

    if (queuesState.queues.length === 0) {
      content.innerHTML = `
        <div style="text-align:center; padding: 4rem 2rem; background: var(--bg-card); border: 1px dashed var(--border-subtle); border-radius: 8px;">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">📬</div>
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; color: var(--text-main);">No Queues Configured Yet</h3>
          <p style="margin: 0 0 1.5rem 0; font-size: 0.85rem; color: var(--text-muted); max-width: 520px; margin-left: auto; margin-right: auto;">
            Create a persistent background queue to process jobs asynchronously, bind a Serverless Function worker (<code>targetFunction</code>), or throttle concurrency with automatic retries and Dead-Letter Queues.
          </p>
          <button class="btn btn-primary btn-sm" onclick="openCreateQueueDrawer()">+ Create Your First Queue</button>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="webhook-table-wrapper">
        <table class="webhook-table">
          <thead>
            <tr>
              <th style="min-width: 180px; width: 22%;">Queue Name</th>
              <th style="min-width: 160px; width: 20%;">Worker Binding</th>
              <th style="min-width: 170px; width: 20%;">Policy & Concurrency</th>
              <th style="min-width: 190px; width: 20%;">Live Job Counts</th>
              <th style="min-width: 210px; width: 18%; text-align: right; white-space: nowrap;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${queuesState.queues.map(q => {
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
                      <span class="badge badge-get" title="Queued jobs">${s.queued || 0} queued</span>
                      ${(s.processing || 0) > 0 ? `<span class="badge badge-post" title="Processing jobs">${s.processing} active</span>` : ''}
                      <span style="color: var(--text-muted);" title="Completed jobs">${s.completed || 0} done</span>
                      ${(qDlq + (s.failed || 0)) > 0 ? `
                        <span class="badge badge-delete" title="Dead-letter / Failed jobs">${qDlq + (s.failed || 0)} DLQ/err</span>
                      ` : isDlqTarget && (s.queued || 0) > 0 ? `
                        <span class="badge badge-delete" title="Forwarded Dead-Letter jobs waiting in DLQ">${s.queued} DLQ jobs</span>
                      ` : ''}
                    </div>
                  </td>
                  <td style="text-align: right; white-space: nowrap;">
                    <div style="display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
                      ${!isSys ? `
                        <button class="btn btn-secondary btn-sm" data-name="${escapeHtml(q.name)}" onclick="openSendMessageDrawer(this.getAttribute('data-name'))" title="Enqueue Message into Queue" style="padding: 3px 8px; font-size: 11px;">
                          ✉ Send
                        </button>
                      ` : ''}
                      <button class="btn btn-secondary btn-sm" data-name="${escapeHtml(q.name)}" onclick="inspectQueueJobs(this.getAttribute('data-name'))" title="Inspect Jobs in Queue" style="padding: 3px 8px; font-size: 11px;">
                        Jobs
                      </button>
                      ${(qDlq > 0 || (isDlqTarget && (s.queued || 0) > 0)) ? `
                        <button class="btn btn-secondary btn-sm" data-name="${escapeHtml(q.name)}" onclick="handleRetryQueueDlq(this.getAttribute('data-name'))" title="${isDlqTarget ? 'Replay Forwarded DLQ Jobs to Original Queue' : 'Retry Dead-Letter Jobs'}" style="padding: 3px 8px; font-size: 11px; color: #fbbf24;">
                          ↻ DLQ
                        </button>
                      ` : ''}
                      ${!isSys ? `
                        <button class="btn btn-secondary btn-sm" data-name="${escapeHtml(q.name)}" onclick="openEditQueueDrawer(this.getAttribute('data-name'))" title="Edit Queue Configuration" style="padding: 3px 8px; font-size: 11px;">
                          Edit
                        </button>
                        <button class="btn btn-secondary btn-sm" data-name="${escapeHtml(q.name)}" onclick="handlePurgeQueue(this.getAttribute('data-name'))" title="Purge All Jobs in Queue" style="padding: 3px 8px; font-size: 11px;">
                          Purge
                        </button>
                        <button class="btn btn-secondary btn-sm" data-name="${escapeHtml(q.name)}" onclick="handleDeleteQueue(this.getAttribute('data-name'))" title="Delete Queue" style="padding: 3px 6px; font-size: 11px; color: var(--accent-danger);">
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

function inspectQueueJobs(queueName) {
  queuesState.jobFilter.queue = queueName || '';
  queuesState.jobFilter.page = 1;
  switchQueuesTab('jobs');
}

// ==========================================
// Job Inspector Subtab
// ==========================================

async function loadQueueJobsList() {
  const content = document.getElementById('queues-tab-content');
  if (!content) return;

  const f = queuesState.jobFilter;
  if (!queuesState.includeSystem && f.queue && f.queue.startsWith('_system:')) {
    f.queue = '';
  }
  const knownQueues = (queuesState.queues || [])
    .filter(q => queuesState.includeSystem || !q.name.startsWith('_system:'))
    .map(q => q.name);
  if (f.queue && !knownQueues.includes(f.queue) && (queuesState.includeSystem || !f.queue.startsWith('_system:'))) {
    knownQueues.unshift(f.queue);
  }

  content.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 1rem; background: var(--bg-card); border: 1px solid var(--border-subtle); padding: 10px 14px; border-radius: 8px;">
      <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px;">
        <select id="q-filter-queue" class="form-select" style="width: auto; padding: 4px 10px; font-size: 12px;" onchange="handleQueueJobFilterChange()">
          <option value="">All Queues</option>
          ${knownQueues.map(qName => `<option value="${escapeHtml(qName)}" ${f.queue === qName ? 'selected' : ''}>${escapeHtml(qName)}</option>`).join('')}
        </select>

        <select id="q-filter-status" class="form-select" style="width: auto; padding: 4px 10px; font-size: 12px;" onchange="handleQueueJobFilterChange()">
          <option value="all" ${f.status === 'all' ? 'selected' : ''}>All Statuses</option>
          <option value="queued" ${f.status === 'queued' ? 'selected' : ''}>Queued</option>
          <option value="processing" ${f.status === 'processing' ? 'selected' : ''}>Processing</option>
          <option value="completed" ${f.status === 'completed' ? 'selected' : ''}>Completed</option>
          <option value="dead_letter" ${f.status === 'dead_letter' ? 'selected' : ''}>Dead Letter (DLQ)</option>
          <option value="failed" ${f.status === 'failed' ? 'selected' : ''}>Failed</option>
        </select>

        ${(f.queue || f.status !== 'all') ? `
          <button class="btn btn-secondary btn-sm" onclick="clearQueueJobFilters()" style="padding: 4px 8px; font-size: 11px;">Clear Filters</button>
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

    <div id="queue-jobs-table-area">
      <div style="text-align:center; padding: 2rem; color: var(--text-muted);">Loading jobs...</div>
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

    const res = await api(`${prefix}/jobs?${params.toString()}`);
    const items = (res && Array.isArray(res.items)) ? res.items : [];
    queuesState.jobs = items;
    f.totalItems = res?.totalItems || items.length;
    f.totalPages = Math.max(1, res?.totalPages || 1);

    const tableArea = document.getElementById('queue-jobs-table-area');
    if (!tableArea) return;

    if (items.length === 0) {
      tableArea.innerHTML = `
        <div style="text-align:center; padding: 3rem 1.5rem; background: var(--bg-card); border: 1px dashed var(--border-subtle); border-radius: 8px; color: var(--text-muted);">
          No jobs found matching the current filters.
        </div>
      `;
      return;
    }

    tableArea.innerHTML = `
      <div class="webhook-table-wrapper">
        <table class="webhook-table">
          <thead>
            <tr>
              <th style="width: 140px;">Job ID</th>
              <th style="width: 160px;">Queue</th>
              <th style="width: 120px;">Status</th>
              <th style="width: 100px;">Attempts</th>
              <th>Payload / Error Preview</th>
              <th style="width: 150px;">Created</th>
              <th style="width: 110px; text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(job => {
              const statusBadge = renderQueueJobStatusBadge(job.status);
              const payloadPreview = typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload ?? {});
              const shortPreview = payloadPreview.length > 90 ? payloadPreview.slice(0, 90) + '…' : payloadPreview;

              return `
                <tr data-job-id="${escapeHtml(job.id)}">
                  <td>
                    <span class="id-pill" style="cursor: pointer;" data-id="${escapeHtml(job.id)}" onclick="openQueueJobDetailDrawer(this.getAttribute('data-id'))" title="Click to inspect job">${escapeHtml(job.id)}</span>
                  </td>
                  <td>
                    <span style="font-family: var(--font-mono); font-size: 12px; font-weight: 600;">${escapeHtml(job.queue)}</span>
                    ${job.groupKey ? `<div style="font-size: 10.5px; color: var(--text-muted);">Group: ${escapeHtml(job.groupKey)}</div>` : ''}
                  </td>
                  <td>${statusBadge}</td>
                  <td style="font-family: var(--font-mono); font-size: 12px;">
                    ${job.attempts || 0} / ${job.maxAttempts || 3}
                    ${job.priority ? `<div style="font-size: 10px; color: var(--text-muted);">Prio: ${job.priority}</div>` : ''}
                  </td>
                  <td style="max-width: 320px;">
                    <code style="font-size: 11.5px; color: var(--text-main); word-break: break-all;">${escapeHtml(shortPreview)}</code>
                    ${(job.error || job.lastError) ? `<div style="font-size: 11px; color: var(--accent-danger); margin-top: 2px;">⚠️ ${escapeHtml(job.error || job.lastError)}</div>` : ''}
                  </td>
                  <td style="font-size: 11.5px; color: var(--text-muted); white-space: nowrap;">
                    ${job.created ? new Date(job.created).toLocaleString() : '--'}
                  </td>
                  <td style="text-align: right; white-space: nowrap;">
                    <button class="btn btn-secondary btn-sm" data-id="${escapeHtml(job.id)}" onclick="openQueueJobDetailDrawer(this.getAttribute('data-id'))" style="padding: 3px 8px; font-size: 11px;">
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
        <span>Showing page ${f.page} of ${f.totalPages} (${f.totalItems} total jobs)</span>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary btn-sm" ${f.page <= 1 ? 'disabled' : ''} onclick="changeQueueJobPage(-1)">Previous</button>
          <button class="btn btn-secondary btn-sm" ${f.page >= f.totalPages ? 'disabled' : ''} onclick="changeQueueJobPage(1)">Next</button>
        </div>
      </div>
    `;
  } catch (err) {
    const tableArea = document.getElementById('queue-jobs-table-area');
    if (tableArea) {
      tableArea.innerHTML = `<div style="color: var(--accent-danger); padding: 2rem; text-align: center;">Failed to load jobs: ${escapeHtml(err.message || String(err))}</div>`;
    }
  }
}

function renderQueueJobStatusBadge(status) {
  const s = (status || 'queued').toLowerCase();
  if (s === 'completed') return `<span class="badge badge-get">COMPLETED</span>`;
  if (s === 'processing') return `<span class="badge badge-post">PROCESSING</span>`;
  if (s === 'dead_letter' || s === 'failed') return `<span class="badge badge-delete">${escapeHtml(s.toUpperCase())}</span>`;
  return `<span class="badge" style="background: rgba(96, 165, 250, 0.15); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.3);">QUEUED</span>`;
}

function handleQueueJobFilterChange() {
  const qEl = document.getElementById('q-filter-queue');
  const sEl = document.getElementById('q-filter-status');
  if (qEl) queuesState.jobFilter.queue = qEl.value;
  if (sEl) queuesState.jobFilter.status = sEl.value;
  queuesState.jobFilter.page = 1;
  loadQueueJobsList();
}

function clearQueueJobFilters() {
  queuesState.jobFilter.queue = '';
  queuesState.jobFilter.status = 'all';
  queuesState.jobFilter.page = 1;
  loadQueueJobsList();
}

function changeQueueJobPage(delta) {
  const next = queuesState.jobFilter.page + delta;
  if (next >= 1 && next <= queuesState.jobFilter.totalPages) {
    queuesState.jobFilter.page = next;
    loadQueueJobsList();
  }
}

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

function animateQueueDrawerOpen() {
  const triggerOpen = () => {
    const backdrop = document.getElementById('queue-drawer-backdrop');
    const panel = document.getElementById('queue-drawer-panel');
    if (backdrop) backdrop.classList.add('open');
    if (panel) panel.classList.add('open');
    const firstInput = panel?.querySelector('input:not([readonly]):not([type="hidden"]), select, textarea');
    if (firstInput && typeof firstInput.focus === 'function') {
      firstInput.focus();
    }
  };
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
  const maxAttemptsVal = isEdit && queueToEdit.maxAttempts !== undefined ? queueToEdit.maxAttempts : 3;
  const visTimeoutVal = isEdit && queueToEdit.visibilityTimeoutSeconds !== undefined ? queueToEdit.visibilityTimeoutSeconds : 30;
  const backoffVal = isEdit && queueToEdit.backoffDelayMs !== undefined ? queueToEdit.backoffDelayMs : 1000;
  const dlqVal = isEdit && queueToEdit.deadLetterQueue ? queueToEdit.deadLetterQueue : '';
  const targetFnVal = isEdit && queueToEdit.targetFunction ? queueToEdit.targetFunction : '';

  const fnOptions = queuesState.functionsList.map(fn => {
    const fnName = fn.name || fn.id;
    return `<option value="${escapeHtml(fnName)}" ${targetFnVal === fnName ? 'selected' : ''}>${escapeHtml(fnName)}</option>`;
  }).join('');

  const root = ensureDrawerRoot();
  root.innerHTML = `
    <div id="queue-drawer-backdrop" class="drawer-backdrop" onclick="closeQueueDrawer()" aria-hidden="true"></div>
    <aside id="queue-drawer-panel" class="record-drawer webhook-drawer" role="dialog" aria-modal="true" aria-labelledby="queue-drawer-title" tabindex="-1">
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
                <div style="font-size: 11px; color: var(--text-muted);">Max parallel jobs (blank = unlimited)</div>
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

async function submitQueueForm() {
  const nameEl = document.getElementById('queue-input-name');
  const targetFnEl = document.getElementById('queue-input-target-fn');
  const concEl = document.getElementById('queue-input-concurrency');
  const attemptsEl = document.getElementById('queue-input-max-attempts');
  const visEl = document.getElementById('queue-input-vis-timeout');
  const backoffEl = document.getElementById('queue-input-backoff');
  const dlqEl = document.getElementById('queue-input-dlq');
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
    <aside id="queue-drawer-panel" class="record-drawer webhook-drawer" role="dialog" aria-modal="true" aria-labelledby="queue-send-drawer-title" tabindex="-1">
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
              <div style="font-size: 11px; color: var(--text-muted);">Prevents duplicate active jobs with the same deduplication key</div>
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
      await loadQueueJobsList();
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

async function handleRequeueJob(jobId, queueName) {
  try {
    const prefix = getQueuesApiPrefix();
    const endpoint = queueName
      ? `${prefix}/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/retry`
      : `${prefix}/jobs/${encodeURIComponent(jobId)}/retry`;
    await api(endpoint, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (typeof toast === 'function') {
      toast(`Job "${jobId}" requeued successfully`, 'success');
    }
    closeQueueDrawer();
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to requeue job', 'error');
  }
}

async function handleRetryQueueDlq(queueName) {
  try {
    const prefix = getQueuesApiPrefix();
    const res = await api(`${prefix}/${encodeURIComponent(queueName)}/dlq/retry`, {
      method: 'POST',
      body: JSON.stringify({ limit: 100 }),
    });
    if (typeof toast === 'function') {
      toast(`Retried ${res?.retriedCount || 0} dead-letter jobs in "${queueName}"`, 'success');
    }
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to retry DLQ', 'error');
  }
}

async function handlePurgeQueue(queueName) {
  const confirmed = typeof showConfirmDialog === 'function'
    ? await showConfirmDialog({
        title: 'Purge Queue Jobs',
        message: `Are you sure you want to purge all jobs in queue <strong style="color: var(--text-heading); font-family: var(--font-mono);">${escapeHtml(queueName)}</strong>?`,
        warning: 'This will permanently delete all queued, processing, completed, and dead-letter jobs in this queue.',
        warningType: 'warning',
        confirmText: 'Purge Jobs',
        cancelText: 'Cancel',
        variant: 'warning',
        icon: '⚠️',
      })
    : confirm(`Purge all jobs in queue "${queueName}"?`);

  if (!confirmed) return;

  try {
    const prefix = getQueuesApiPrefix();
    const res = await api(`${prefix}/${encodeURIComponent(queueName)}/purge`, {
      method: 'DELETE',
    });
    if (typeof toast === 'function') {
      toast(`Purged ${res?.purgedCount || 0} jobs from "${queueName}"`, 'success');
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
        warning: 'This action cannot be undone. Both the queue configuration and all associated jobs will be removed.',
        warningType: 'danger',
        confirmText: 'Delete Queue',
        cancelText: 'Cancel',
        variant: 'danger',
        icon: '⚠️',
      })
    : confirm(`Delete queue "${queueName}" and all its jobs?`);

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

async function handleCleanupOldQueueJobs() {
  try {
    const prefix = getQueuesApiPrefix();
    const res = await api(`${prefix}/cleanup`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (typeof toast === 'function') {
      toast(`Cleaned up ${res?.prunedCount || 0} expired terminal jobs`, 'success');
    }
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to cleanup jobs', 'error');
  }
}

// ==========================================
// Slide-Over Drawer: Job Detail Inspection
// ==========================================

async function openQueueJobDetailDrawer(jobId) {
  try {
    const prefix = getQueuesApiPrefix();
    const job = await api(`${prefix}/jobs/${encodeURIComponent(jobId)}`);
    if (!job) return;

    const root = ensureDrawerRoot();
    const isSys = Boolean(job.queue && job.queue.startsWith('_system:'));
    const isForwardedDlq = Boolean(
      job.originalJobId ||
      (job.payload && typeof job.payload === 'object' && job.payload.originalJobId && job.payload.originalQueue)
    );
    const origId = job.originalJobId || (job.payload && job.payload.originalJobId);
    const origQueue = (job.payload && job.payload.originalQueue) || '';

    root.innerHTML = `
      <div id="queue-drawer-backdrop" class="drawer-backdrop" onclick="closeQueueDrawer()" aria-hidden="true"></div>
      <aside id="queue-drawer-panel" class="record-drawer webhook-drawer" role="dialog" aria-modal="true" tabindex="-1">
        <div class="drawer-header">
          <div class="drawer-title-area">
            ${renderQueueJobStatusBadge(job.status)}
            <div>
              <h3 class="drawer-title" style="margin:0; font-size:1.02rem; font-family: var(--font-mono);">${escapeHtml(job.id)}</h3>
              <span style="font-size:11px; color:var(--text-muted);">Queue: <strong>${escapeHtml(job.queue)}</strong> • Attempt ${job.attempts || 0}/${job.maxAttempts || 3}</span>
            </div>
          </div>
          <div class="drawer-header-actions">
            <button class="btn btn-secondary btn-sm" onclick="closeQueueDrawer()" aria-label="Close drawer">✕</button>
          </div>
        </div>

        <div class="drawer-body">
          <div>
            <div class="drawer-section-title">Job Metadata</div>
            <div class="drawer-card">
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:10px; font-size:12px;">
                <div>
                  <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Status</span>
                  <strong>${escapeHtml((job.status || '').toUpperCase())}</strong>
                </div>
                <div>
                  <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Priority</span>
                  <span>${job.priority || 0}</span>
                </div>
                <div>
                  <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Created</span>
                  <span>${job.created ? new Date(job.created).toLocaleString() : '--'}</span>
                </div>
                <div>
                  <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Completed</span>
                  <span>${job.completedAt || job.finishedAt ? new Date(job.completedAt || job.finishedAt).toLocaleString() : '--'}</span>
                </div>
                ${job.forwardedToJobId ? `
                  <div>
                    <span style="font-size:10px; text-transform:uppercase; color:var(--text-muted); font-weight:700; display:block;">Forwarded DLQ ID</span>
                    <span style="font-family: var(--font-mono); font-size:11px; color:#fbbf24;">${escapeHtml(job.forwardedToJobId)}</span>
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
              <strong>Forwarded DLQ Job:</strong> This job was forwarded from queue <strong>${escapeHtml(origQueue || '--')}</strong> (Original ID: <code>${escapeHtml(origId || '--')}</code>).
              ${job.payload && job.payload.error ? `<div style="margin-top: 4px; color: var(--accent-danger);"><strong>Failure Reason:</strong> ${escapeHtml(job.payload.error)}</div>` : ''}
            </div>
          ` : ''}

          ${(job.error || job.lastError) ? `
            <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:6px; padding:10px 14px; font-size:12px; color: var(--accent-danger);">
              <strong>Error:</strong> ${escapeHtml(job.error || job.lastError)}
            </div>
          ` : ''}

          <div>
            <div class="drawer-section-title">Job Payload</div>
            <div class="drawer-json-container">
              <div class="drawer-json-bar">
                <span>JSON Payload</span>
              </div>
              <pre class="drawer-json-pre"><code>${escapeHtml(JSON.stringify(job.payload, null, 2))}</code></pre>
            </div>
          </div>

          ${job.result !== undefined && job.result !== null ? `
            <div>
              <div class="drawer-section-title">Worker Execution Result</div>
              <div class="drawer-json-container">
                <div class="drawer-json-bar">
                  <span style="color: #34d399; font-weight: 700;">Result</span>
                </div>
                <pre class="drawer-json-pre"><code>${escapeHtml(JSON.stringify(job.result, null, 2))}</code></pre>
              </div>
            </div>
          ` : ''}

          ${job.executionLogs ? `
            <div>
              <div class="drawer-section-title">Captured Worker Logs</div>
              <div class="drawer-json-container">
                <div class="drawer-json-bar">
                  <span style="color: #38bdf8; font-weight: 700;">Worker Output ${job.executionDurationMs ? `(${job.executionDurationMs}ms)` : ''}</span>
                </div>
                <pre class="drawer-json-pre" style="color: #38bdf8; white-space: pre-wrap; font-family: 'JetBrains Mono', Consolas, Monaco, monospace; font-size: 11.5px; line-height: 1.5; padding: 12px; background: #0f172a; margin: 0;"><code>${escapeHtml(job.executionLogs)}</code></pre>
              </div>
            </div>
          ` : ''}

          <div style="font-size: 11px; color: var(--text-muted); padding: 4px 2px;">
            💡 <em>Worker function logs are also recorded under the <strong>Functions → Logs</strong> tab.</em>
          </div>
        </div>

        <div class="drawer-footer" style="padding:1rem 1.5rem; border-top:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center; background:var(--bg-card); flex-shrink:0;">
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${!isSys && job.status === 'processing' ? `
              <button class="btn btn-primary btn-sm" data-queue="${escapeHtml(job.queue)}" data-id="${escapeHtml(job.id)}" onclick="handleAckQueueJob(this.getAttribute('data-queue'), this.getAttribute('data-id'))">✓ ACK (Complete)</button>
              <button class="btn btn-secondary btn-sm" data-queue="${escapeHtml(job.queue)}" data-id="${escapeHtml(job.id)}" onclick="handleNackQueueJob(this.getAttribute('data-queue'), this.getAttribute('data-id'))">✕ NACK (Fail)</button>
            ` : ''}
            ${!isSys && isForwardedDlq ? `
              <button class="btn btn-primary btn-sm" data-queue="${escapeHtml(job.queue)}" data-id="${escapeHtml(job.id)}" onclick="handleRequeueJob(this.getAttribute('data-id'), this.getAttribute('data-queue'))">
                ↻ Replay to "${escapeHtml(origQueue || 'Original Queue')}"
              </button>
            ` : !isSys && (job.status === 'dead_letter' || job.status === 'failed') ? `
              <button class="btn btn-primary btn-sm" data-queue="${escapeHtml(job.queue)}" data-id="${escapeHtml(job.id)}" onclick="handleRequeueJob(this.getAttribute('data-id'), this.getAttribute('data-queue'))">
                ↻ Requeue Job
              </button>
              <button class="btn btn-secondary btn-sm" data-queue="${escapeHtml(job.queue)}" onclick="handleRetryQueueDlq(this.getAttribute('data-queue')); closeQueueDrawer();" title="Retry all dead-letter jobs in this queue">
                ↻ Retry All Queue DLQ
              </button>
            ` : ''}
          </div>
          <button class="btn btn-secondary btn-sm" onclick="closeQueueDrawer()">Close</button>
        </div>
      </aside>
    `;

    animateQueueDrawerOpen();
  } catch (err) {
    if (typeof toast === 'function') toast('Failed to load job details: ' + err.message, 'error');
  }
}

async function handleAckQueueJob(queueName, jobId) {
  try {
    const prefix = getQueuesApiPrefix();
    await api(`${prefix}/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/ack`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (typeof toast === 'function') toast('Job marked completed (ACK)', 'success');
    closeQueueDrawer();
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to ACK job', 'error');
  }
}

async function handleNackQueueJob(queueName, jobId) {
  try {
    const prefix = getQueuesApiPrefix();
    await api(`${prefix}/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/nack`, {
      method: 'POST',
      body: JSON.stringify({ error: 'Rejected manually from Admin UI' }),
    });
    if (typeof toast === 'function') toast('Job rejected (NACK)', 'info');
    closeQueueDrawer();
    await refreshQueuesView();
  } catch (err) {
    if (typeof toast === 'function') toast(err.message || 'Failed to NACK job', 'error');
  }
}

function closeQueueDrawer() {
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

if (typeof window !== 'undefined') {
  window.renderQueuesView = renderQueuesView;
  window.refreshQueuesView = refreshQueuesView;
  window.switchQueuesTab = switchQueuesTab;
  window.toggleIncludeSystemQueues = toggleIncludeSystemQueues;
  window.loadQueueStats = loadQueueStats;
  window.loadQueuesList = loadQueuesList;
  window.loadQueueJobsList = loadQueueJobsList;
  window.inspectQueueJobs = inspectQueueJobs;
  window.handleQueueJobFilterChange = handleQueueJobFilterChange;
  window.clearQueueJobFilters = clearQueueJobFilters;
  window.changeQueueJobPage = changeQueueJobPage;
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
  window.handleRequeueJob = handleRequeueJob;
  window.handlePurgeQueue = handlePurgeQueue;
  window.handleDeleteQueue = handleDeleteQueue;
  window.handleCleanupOldQueueJobs = handleCleanupOldQueueJobs;
  window.openQueueJobDetailDrawer = openQueueJobDetailDrawer;
  window.handleAckQueueJob = handleAckQueueJob;
  window.handleNackQueueJob = handleNackQueueJob;
}
