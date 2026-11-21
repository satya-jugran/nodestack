// Native Cron & Scheduled Triggers Module for NodeStack Admin UI

const cronIcons = {
  clock: (w = 12, h = 12) => `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; display: inline-block;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  calendar: (w = 13, h = 13) => `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; display: inline-block;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
  globe: (w = 11, h = 11) => `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; display: inline-block;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`,
  alert: (w = 11, h = 11) => `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; display: inline-block;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  refresh: (w = 10, h = 10) => `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; display: inline-block;"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`,
  zap: (w = 10, h = 10) => `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; display: inline-block;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
  hourglass: (w = 10, h = 10) => `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; display: inline-block;"><path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path></svg>`,
  database: (w = 10, h = 10) => `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; display: inline-block;"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>`,
  play: (w = 9, h = 9) => `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align: -1px; display: inline-block;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
  externalLink: (w = 10, h = 10) => `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; display: inline-block;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`,
  copy: (w = 12, h = 12) => `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; display: inline-block;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
  chart: (w = 18, h = 18) => `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block;"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`,
};

let cronState = {
  subTab: 'schedules', // 'schedules' | 'history'
  schedules: [],
  functionsList: [],
  flowsList: [],
  searchQuery: '',
  statusFilter: 'all', // 'all' | 'enabled' | 'paused' | 'failed'
  sortBy: 'nextRun', // 'nextRun' | 'name' | 'lastRun' | 'created'
  stats: {
    totalSchedules: 0,
    activeSchedules: 0,
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    skippedRuns: 0,
    byTarget: { function: 0, flow: 0, snapshot: 0 },
  },
  runs: [],
  runFilter: {
    scheduleId: '',
    targetType: '',
    status: 'all',
    page: 1,
    perPage: 25,
    total: 0,
    totalPages: 1,
  },
  targetFilter: 'all', // 'all' | 'function' | 'flow' | 'snapshot'
  activeScheduleForEdit: null,
  activeRunForDetail: null,
};

if (typeof window !== 'undefined') {
  window.cronState = cronState;
}

function getCronApiPrefix() {
  const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
  return slug && slug !== 'default' ? `/api/apps/${encodeURIComponent(slug)}/cron` : '/api/cron';
}

function getFunctionsListApiPrefix() {
  const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
  return slug && slug !== 'default' ? `/api/apps/${encodeURIComponent(slug)}/functions` : '/api/functions';
}

function getFlowsListApiPrefix() {
  const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
  return slug && slug !== 'default' ? `/api/apps/${encodeURIComponent(slug)}/flows` : '/api/flows';
}

function getSupportedIanaTimezones() {
  if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {}
  }
  return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney'];
}

function isSqliteDatabase() {
  if (typeof state !== 'undefined' && state.demo && state.demo.supported === false) {
    return false;
  }
  if (typeof databaseState !== 'undefined' && databaseState.status?.provider) {
    return databaseState.status.provider.toLowerCase() === 'sqlite';
  }
  return true;
}

function renderSchedulesView() {
  const container = document.getElementById('page-view-schedules') || document.getElementById('main-body');
  if (!container) return;

  if (!isSqliteDatabase() && cronState.targetFilter === 'snapshot') {
    cronState.targetFilter = 'all';
  }

  container.innerHTML = `
    <div class="webhooks-container" id="schedules-manager-root">
      <!-- Header -->
      <div class="webhooks-header">
        <div class="webhooks-title-area">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            Schedules Manager
          </h2>
          <p>Configure automated Cron triggers for Serverless Functions, Orchestrated Flows, and Backups with atomic distributed DB leases.</p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm" id="btn-refresh-schedules" onclick="refreshSchedulesView()" title="Refresh Schedules & Stats">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
          <button class="btn btn-primary btn-sm" id="btn-new-schedule" onclick="openCreateScheduleDrawer()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Schedule
          </button>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="webhooks-stats-grid" id="cron-stats-grid">
        <div class="webhook-stat-card">
          <span class="webhook-stat-label" title="Total Schedules">Total Schedules</span>
          <div class="webhook-stat-value" id="cron-stat-total">0</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label" title="Active (Enabled)">Active (Enabled)</span>
          <div class="webhook-stat-value" style="color: var(--accent-success);" id="cron-stat-active">0</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label" title="Succeeded Runs">Succeeded Runs</span>
          <div class="webhook-stat-value" style="color: var(--accent-primary);" id="cron-stat-succeeded">0</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label" title="Failed Runs">Failed Runs</span>
          <div class="webhook-stat-value" style="color: var(--accent-danger);" id="cron-stat-failed">0</div>
        </div>
        <div class="webhook-stat-card">
          <span class="webhook-stat-label" title="Skipped (Missed Window)">Skipped (Missed Window)</span>
          <div class="webhook-stat-value" style="color: var(--accent-warning);" id="cron-stat-skipped">0</div>
        </div>
      </div>

      <!-- Subtabs Bar -->
      <div class="webhooks-tabs-bar" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <button class="webhook-tab-btn ${cronState.subTab === 'schedules' ? 'active' : ''}" id="tab-btn-cron-schedules" onclick="switchCronTab('schedules')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            Active Schedules
          </button>
          <button class="webhook-tab-btn ${cronState.subTab === 'history' ? 'active' : ''}" id="tab-btn-cron-history" onclick="switchCronTab('history')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            Execution History
          </button>
        </div>
        <div id="cron-tab-actions" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          ${cronState.subTab === 'schedules' ? `
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <input type="text" class="input input-sm" id="cron-search-input" placeholder="Search schedules..." value="${escapeHtml(cronState.searchQuery || '')}" oninput="handleCronSearchInput(this.value)" style="font-size: 11px; width: 140px; padding: 3px 8px;">
              <select class="input input-sm" id="cron-target-filter" onchange="handleCronTargetFilter(this.value)" style="font-size: 11px; padding: 3px 6px;">
                <option value="all" ${cronState.targetFilter === 'all' ? 'selected' : ''}>All Targets</option>
                <option value="function" ${cronState.targetFilter === 'function' ? 'selected' : ''}>Functions</option>
                <option value="flow" ${cronState.targetFilter === 'flow' ? 'selected' : ''}>Flows</option>
                ${isSqliteDatabase() ? `<option value="snapshot" ${cronState.targetFilter === 'snapshot' ? 'selected' : ''}>Snapshots</option>` : ''}
              </select>
              <select class="input input-sm" id="cron-status-filter" onchange="handleCronStatusFilter(this.value)" style="font-size: 11px; padding: 3px 6px;">
                <option value="all" ${cronState.statusFilter === 'all' ? 'selected' : ''}>All States</option>
                <option value="enabled" ${cronState.statusFilter === 'enabled' ? 'selected' : ''}>Active Only</option>
                <option value="paused" ${cronState.statusFilter === 'paused' ? 'selected' : ''}>Paused Only</option>
                <option value="failed" ${cronState.statusFilter === 'failed' ? 'selected' : ''}>Failing Only</option>
              </select>
              <select class="input input-sm" id="cron-sort-filter" onchange="handleCronSortChange(this.value)" style="font-size: 11px; padding: 3px 6px;">
                <option value="nextRun" ${cronState.sortBy === 'nextRun' ? 'selected' : ''}>Sort: Next Run</option>
                <option value="name" ${cronState.sortBy === 'name' ? 'selected' : ''}>Sort: Name</option>
                <option value="lastRun" ${cronState.sortBy === 'lastRun' ? 'selected' : ''}>Sort: Last Run</option>
                <option value="created" ${cronState.sortBy === 'created' ? 'selected' : ''}>Sort: Created</option>
              </select>
            </div>
          ` : `
            <button class="btn btn-secondary btn-sm" id="btn-clear-cron-history" onclick="handleClearRunHistory()" style="font-size: 11px;">
              ${cronState.runFilter.scheduleId ? 'Clear Schedule History' : 'Clear All History'}
            </button>
          `}
        </div>
      </div>

      <!-- Tab Content Area -->
      <div id="cron-tab-content" style="margin-top: 16px;">
        ${cronState.subTab === 'schedules' ? renderSchedulesListHtml() : renderHistoryTableHtml()}
      </div>
    </div>

    <!-- Datalist for IANA Timezones -->
    <datalist id="iana-timezones-list">
      ${getSupportedIanaTimezones().map(tz => `<option value="${escapeHtml(tz)}"></option>`).join('')}
    </datalist>

    <!-- Create / Edit Schedule Modal Container -->
    <div id="cron-schedule-modal-container"></div>
  `;

  loadCronData();
}

function switchCronTab(tab, updateUrl = true) {
  cronState.subTab = tab;
  if (updateUrl && typeof pushRoute === 'function') {
    pushRoute(`schedules/${tab}`);
  }
  renderSchedulesView();
}

function handleCronTargetFilter(target) {
  if (!isSqliteDatabase() && target === 'snapshot') {
    target = 'all';
  }
  cronState.targetFilter = target;
  refreshSchedulesListDom();
}

function handleCronSearchInput(query) {
  cronState.searchQuery = query || '';
  refreshSchedulesListDom();
}

function handleCronStatusFilter(status) {
  cronState.statusFilter = status;
  refreshSchedulesListDom();
}

function handleCronSortChange(sort) {
  cronState.sortBy = sort;
  refreshSchedulesListDom();
}

function refreshSchedulesListDom() {
  const contentArea = document.getElementById('cron-tab-content');
  if (contentArea && cronState.subTab === 'schedules') {
    contentArea.innerHTML = renderSchedulesListHtml();
  }
}

function viewScheduleHistory(scheduleId) {
  cronState.runFilter.scheduleId = scheduleId;
  cronState.runFilter.page = 1;
  switchCronTab('history');
}

function navigateToCronTarget(targetType, targetId) {
  if (targetType === 'function') {
    if (typeof selectNav === 'function') {
      selectNav('functions');
      if (typeof openFunctionWorkbench === 'function' && targetId) {
        setTimeout(() => openFunctionWorkbench(targetId), 120);
      }
    }
  } else if (targetType === 'flow') {
    if (typeof selectNav === 'function') {
      selectNav('flows');
      if (typeof openFlowInDesigner === 'function' && targetId) {
        setTimeout(() => openFlowInDesigner(targetId), 120);
      }
    }
  } else if (targetType === 'snapshot') {
    if (typeof selectNav === 'function') {
      selectNav('snapshots');
    }
  }
}

async function loadCronData() {
  try {
    const apiPrefix = getCronApiPrefix();
    const [stats, schedules] = await Promise.all([
      api(`${apiPrefix}/stats`).catch(() => null),
      api(`${apiPrefix}/schedules`).catch(() => []),
      loadFunctionsAndFlows(),
      (typeof fetchDatabaseStatus === 'function' && (typeof databaseState === 'undefined' || !databaseState.status)) ? fetchDatabaseStatus().catch(() => null) : Promise.resolve(null),
    ]);

    if (stats) {
      cronState.stats = stats;
      updateStatsDom();
    }
    if (schedules) {
      cronState.schedules = Array.isArray(schedules) ? schedules : (schedules.schedules || []);
      const contentArea = document.getElementById('cron-tab-content');
      if (contentArea && cronState.subTab === 'schedules') {
        contentArea.innerHTML = renderSchedulesListHtml();
      }
    }

    if (cronState.subTab === 'history') {
      await loadRunHistory();
    }
  } catch (err) {
    console.warn('[Cron] Failed to load schedule data:', err);
  }
}

function getTargetDisplayName(targetType, targetId) {
  if (!targetId) return '';
  if (targetType === 'function') {
    const fn = (cronState.functionsList || []).find(f => f.id === targetId || f.name === targetId);
    return fn ? fn.name : targetId;
  }
  if (targetType === 'flow') {
    const fl = (cronState.flowsList || []).find(f => f.id === targetId || f.name === targetId);
    return fl ? fl.name : targetId;
  }
  if (targetType === 'snapshot') {
    return targetId === 'data.db' ? 'data.db (SQLite)' : targetId;
  }
  return targetId;
}

async function loadCronStats() {
  try {
    const apiPrefix = getCronApiPrefix();
    const stats = await api(`${apiPrefix}/stats`).catch(() => null);
    if (stats) {
      cronState.stats = stats;
      updateStatsDom();
    }
  } catch (_) {}
}

async function loadFunctionsAndFlows() {
  try {
    const fnPrefix = getFunctionsListApiPrefix();
    const flowPrefix = getFlowsListApiPrefix();
    const [fnData, flowData] = await Promise.all([
      api(fnPrefix).catch(() => []),
      api(flowPrefix).catch(() => []),
    ]);
    cronState.functionsList = Array.isArray(fnData) ? fnData : (fnData?.items || fnData?.functions || []);
    cronState.flowsList = Array.isArray(flowData) ? flowData : (flowData?.items || flowData?.flows || []);

    // Re-render schedules list or target picker if open
    const contentArea = document.getElementById('cron-tab-content');
    if (contentArea && cronState.subTab === 'schedules' && cronState.schedules.length > 0) {
      contentArea.innerHTML = renderSchedulesListHtml();
    }

    // If modal target picker is open, refresh its options
    const pickerArea = document.getElementById('sched-target-picker-area');
    const targetTypeEl = document.getElementById('sched-input-target-type');
    const targetIdEl = document.getElementById('sched-input-target-id');
    if (pickerArea && targetTypeEl) {
      pickerArea.innerHTML = renderModalTargetPickerHtml(targetTypeEl.value, targetIdEl?.value || '');
    }
  } catch (_) {}
}

function updateStatsDom() {
  const s = cronState.stats;
  const totalEl = document.getElementById('cron-stat-total');
  const activeEl = document.getElementById('cron-stat-active');
  const succEl = document.getElementById('cron-stat-succeeded');
  const failEl = document.getElementById('cron-stat-failed');
  const skipEl = document.getElementById('cron-stat-skipped');

  if (totalEl) totalEl.textContent = s.totalSchedules || 0;
  if (activeEl) activeEl.textContent = s.activeSchedules || 0;
  if (succEl) succEl.textContent = s.successfulRuns || 0;
  if (failEl) failEl.textContent = s.failedRuns || 0;
  if (skipEl) skipEl.textContent = s.skippedRuns || 0;

  const sidebarCountEl = document.getElementById('sidebar-schedules-count');
  if (sidebarCountEl) {
    sidebarCountEl.textContent = s.totalSchedules || 0;
    sidebarCountEl.style.display = s.totalSchedules > 0 ? 'inline-block' : 'none';
  }

  const homeSchedEl = document.getElementById('home-stat-schedules');
  const homeSchedSubEl = document.getElementById('home-stat-schedules-sub');
  if (homeSchedEl) {
    homeSchedEl.textContent = String(s.totalSchedules || 0);
  }
  if (homeSchedSubEl) {
    const active = s.activeSchedules || 0;
    const runs = s.totalRuns || 0;
    homeSchedSubEl.textContent = `${active} active${runs > 0 ? ` • ${runs} runs` : ' • 0 runs'}`;
  }
}

function refreshSchedulesView() {
  loadCronData();
}

function renderSchedulesListHtml() {
  let list = (cronState.schedules || []).slice();

  // Target Filter
  if (cronState.targetFilter !== 'all') {
    list = list.filter(s => s.targetType === cronState.targetFilter);
  }

  // Status Filter
  if (cronState.statusFilter === 'enabled') {
    list = list.filter(s => Boolean(s.enabled));
  } else if (cronState.statusFilter === 'paused') {
    list = list.filter(s => !s.enabled);
  } else if (cronState.statusFilter === 'failed') {
    list = list.filter(s => s.lastStatus === 'failed');
  }

  // Search Filter
  if (cronState.searchQuery && cronState.searchQuery.trim()) {
    const q = cronState.searchQuery.trim().toLowerCase();
    list = list.filter(s =>
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.cronExpression && s.cronExpression.toLowerCase().includes(q)) ||
      (s.humanDescription && s.humanDescription.toLowerCase().includes(q)) ||
      (s.targetId && s.targetId.toLowerCase().includes(q)) ||
      (s.description && s.description.toLowerCase().includes(q))
    );
  }

  // Sorting
  list.sort((a, b) => {
    if (cronState.sortBy === 'name') {
      return a.name.localeCompare(b.name);
    }
    if (cronState.sortBy === 'created') {
      return new Date(b.created).getTime() - new Date(a.created).getTime();
    }
    if (cronState.sortBy === 'lastRun') {
      const tA = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
      const tB = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
      return tB - tA;
    }
    // Default 'nextRun': soonest nextRunAt first; disabled/null at the end
    const tA = a.enabled && a.nextRunAt ? new Date(a.nextRunAt).getTime() : Infinity;
    const tB = b.enabled && b.nextRunAt ? new Date(b.nextRunAt).getTime() : Infinity;
    return tA - tB;
  });

  if (list.length === 0) {
    if (cronState.schedules && cronState.schedules.length > 0) {
      return `
        <div style="padding: 40px 16px; text-align: center; background: var(--bg-card); border-radius: 8px; border: 1px dashed var(--border-subtle);">
          <h4 style="margin: 0 0 6px 0; font-size: 14px;">No Matching Schedules</h4>
          <p style="color: var(--text-muted); font-size: 12px; max-width: 420px; margin: 0 auto 14px auto;">
            No schedules matched your search query or active state filters.
          </p>
          <button class="btn btn-secondary btn-sm" onclick="handleResetScheduleFilters()">
            Reset Filters
          </button>
        </div>
      `;
    }
    return `
      <div style="padding: 48px 16px; text-align: center; background: var(--bg-card); border-radius: 8px; border: 1px dashed var(--border-subtle);">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 12px; color: var(--text-muted); opacity: 0.7;">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <h4 style="margin: 0 0 6px 0; font-size: 15px;">No Schedules Found</h4>
        <p style="color: var(--text-muted); font-size: 13px; max-width: 440px; margin: 0 auto 16px auto;">
          Automate periodic tasks like database health checks, daily metrics sync, scheduled flows, or automated backups.
        </p>
        <button class="btn btn-primary btn-sm" onclick="openCreateScheduleDrawer()">
          + Create First Schedule
        </button>
      </div>
    `;
  }

  return `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px;">
      ${list.map(s => renderScheduleCardHtml(s)).join('')}
    </div>
  `;
}

function handleResetScheduleFilters() {
  cronState.searchQuery = '';
  cronState.targetFilter = 'all';
  cronState.statusFilter = 'all';
  cronState.sortBy = 'nextRun';
  const searchInput = document.getElementById('cron-search-input');
  if (searchInput) searchInput.value = '';
  const targetFilterEl = document.getElementById('cron-target-filter');
  if (targetFilterEl) targetFilterEl.value = 'all';
  const statusFilterEl = document.getElementById('cron-status-filter');
  if (statusFilterEl) statusFilterEl.value = 'all';
  const sortFilterEl = document.getElementById('cron-sort-filter');
  if (sortFilterEl) sortFilterEl.value = 'nextRun';
  refreshSchedulesListDom();
}

function renderScheduleCardHtml(s) {
  const isEnabled = Boolean(s.enabled);
  const isUnsupportedSnapshot = s.targetType === 'snapshot' && !isSqliteDatabase();
  const dbProviderName = (typeof databaseState !== 'undefined' && databaseState.status?.provider ? databaseState.status.provider : 'remote').toUpperCase();
  const targetBadgeColor = s.targetType === 'function' ? 'var(--accent-primary)' : (s.targetType === 'flow' ? '#8b5cf6' : '#10b981');
  const lastStatusColor = s.lastStatus === 'succeeded' ? 'var(--accent-success)' : (s.lastStatus === 'failed' ? 'var(--accent-danger)' : (s.lastStatus === 'skipped' ? 'var(--accent-warning)' : 'var(--text-muted)'));

  // Target status checks (disabled or missing targets)
  let isTargetDisabled = false;
  let isTargetMissing = false;
  if (s.targetType === 'function' && (cronState.functionsList || []).length > 0) {
    const fn = cronState.functionsList.find(f => f.id === s.targetId || f.name === s.targetId);
    if (!fn) isTargetMissing = true;
    else if (fn.enabled === false) isTargetDisabled = true;
  } else if (s.targetType === 'flow' && (cronState.flowsList || []).length > 0) {
    const fl = cronState.flowsList.find(f => f.id === s.targetId || f.name === s.targetId);
    if (!fl) isTargetMissing = true;
    else if (fl.enabled === false) isTargetDisabled = true;
  }

  const nextRunStr = s.nextRunAt ? formatDualTime(s.nextRunAt, s.timezone) : 'Disabled / Never';
  const lastRunStr = s.lastRunAt ? formatRelativeTime(s.lastRunAt) : 'Never executed';

  return `
    <div style="background: var(--bg-card); border: 1px solid ${isUnsupportedSnapshot ? 'rgba(245,158,11,0.4)' : (isTargetMissing ? 'rgba(239,68,68,0.3)' : 'var(--border-subtle)')}; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between; position: relative; transition: border-color 0.15s ease;">
      <div>
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
          <div>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span style="font-size: 14px; font-weight: 600; color: var(--text-heading);">${escapeHtml(s.name)}</span>
              ${s.isSystemBound ? `<span class="badge" style="font-size: 10px; background: rgba(59,130,246,0.12); color: var(--accent-primary);">1:1 Bound</span>` : ''}
              ${isUnsupportedSnapshot ? `<span class="badge" style="font-size: 10px; background: rgba(245,158,11,0.15); color: var(--accent-warning);">${cronIcons.alert(10, 10)} Unsupported on ${dbProviderName}</span>` : ''}
              ${isTargetDisabled ? `<span class="badge" style="font-size: 10px; background: rgba(245,158,11,0.15); color: var(--accent-warning);" title="Target is currently disabled">${cronIcons.alert(10, 10)} Target Disabled</span>` : ''}
              ${isTargetMissing ? `<span class="badge" style="font-size: 10px; background: rgba(239,68,68,0.15); color: var(--accent-danger);" title="Target ID not found in system">${cronIcons.alert(10, 10)} Target Missing</span>` : ''}
            </div>
            ${s.description ? `<p style="font-size: 12px; color: var(--text-muted); margin: 3px 0 0 0;">${escapeHtml(s.description)}</p>` : ''}
          </div>
          <label class="switch" style="transform: scale(0.8); transform-origin: right center;">
            <input type="checkbox" ${isEnabled ? 'checked' : ''} ${isUnsupportedSnapshot ? 'disabled title="Snapshots cannot be enabled on ' + dbProviderName + '"' : 'onchange="handleToggleScheduleEnabled(\'' + s.id + '\', this.checked)" title="Enable / Disable Schedule"'}>
            <span class="slider round"></span>
          </label>
        </div>

        <!-- Human-Readable Cadence Display -->
        <div style="font-size: 12px; font-weight: 500; color: var(--text-heading); margin: 6px 0 8px 0; display: flex; align-items: center; gap: 6px;">
          ${cronIcons.calendar(13, 13)}
          <span>${escapeHtml(s.humanDescription || s.cronExpression)}</span>
        </div>

        <div style="display: flex; align-items: center; gap: 8px; margin: 8px 0 10px 0; font-size: 11px; flex-wrap: wrap;">
          <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 4px; background: var(--bg-card-hover); border: 1px solid var(--border-subtle); cursor: pointer; transition: background 0.15s ease;"
                onclick="navigateToCronTarget('${escapeHtml(s.targetType)}', '${escapeHtml(s.targetId)}')"
                title="Click to view ${escapeHtml(s.targetType)}">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: ${targetBadgeColor};"></span>
            <strong>${escapeHtml(s.targetType.toUpperCase())}:</strong> ${escapeHtml(getTargetDisplayName(s.targetType, s.targetId))} ${cronIcons.externalLink(10, 10)}
          </span>
          <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 4px; background: var(--bg-card-hover); border: 1px solid var(--border-subtle); font-family: monospace;" title="Cron expression: ${escapeHtml(s.cronExpression)}">
            ${cronIcons.clock(11, 11)} ${escapeHtml(s.cronExpression)}
          </span>
          <span style="display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted);">
            ${cronIcons.globe(11, 11)} ${escapeHtml(s.timezone || 'UTC')}
          </span>
        </div>

        ${(s.maxRetries > 0 || s.autoPauseAfterFailures > 0 || s.consecutiveFailures > 0 || s.expiresAt || (s.targetType === 'snapshot' && s.keepLast)) ? `
          <div style="display: flex; align-items: center; gap: 6px; margin: 0 0 10px 0; font-size: 10px; flex-wrap: wrap;">
            ${s.maxRetries > 0 ? `<span class="badge" style="background: rgba(99,102,241,0.12); color: #6366f1; display: inline-flex; align-items: center; gap: 3px;" title="Retries up to ${s.maxRetries} times with exponential backoff on failure">${cronIcons.refresh(10, 10)} ${s.maxRetries}x Retries</span>` : ''}
            ${s.autoPauseAfterFailures > 0 ? `<span class="badge" style="background: rgba(234,88,12,0.12); color: #ea580c; display: inline-flex; align-items: center; gap: 3px;" title="Circuit breaker: auto-pauses after ${s.autoPauseAfterFailures} consecutive failures">${cronIcons.zap(10, 10)} Auto-pause (${s.autoPauseAfterFailures}x)</span>` : ''}
            ${s.consecutiveFailures > 0 ? `<span class="badge" style="background: rgba(239,68,68,0.15); color: var(--accent-danger); display: inline-flex; align-items: center; gap: 3px;" title="${s.consecutiveFailures} consecutive failure(s)">${cronIcons.alert(10, 10)} ${s.consecutiveFailures} Failure${s.consecutiveFailures > 1 ? 's' : ''}</span>` : ''}
            ${s.expiresAt ? (() => {
              const isPast = new Date(s.expiresAt).getTime() <= Date.now();
              return `<span class="badge" style="background: ${isPast ? 'rgba(239,68,68,0.15)' : 'rgba(107,114,128,0.15)'}; color: ${isPast ? 'var(--accent-danger)' : 'var(--text-muted)'}; display: inline-flex; align-items: center; gap: 3px;" title="Auto-expires at ${escapeHtml(s.expiresAt)}">${cronIcons.hourglass(10, 10)} ${isPast ? `Expired (${formatRelativeTime(s.expiresAt)})` : `Expires: ${formatRelativeTime(s.expiresAt)}`}</span>`;
            })() : ''}
            ${s.targetType === 'snapshot' && s.keepLast ? `<span class="badge" style="background: rgba(16,185,129,0.12); color: #10b981; display: inline-flex; align-items: center; gap: 3px;" title="Retains last ${s.keepLast} snapshots created by this schedule">${cronIcons.database(10, 10)} Retain ${s.keepLast}</span>` : ''}
          </div>
        ` : ''}

        ${isUnsupportedSnapshot ? `
          <div style="background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.25); border-radius: 6px; padding: 7px 10px; font-size: 11px; color: var(--accent-warning); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
            ${cronIcons.alert(14, 14)}
            <span>In-app snapshots are exclusive to embedded SQLite applications and are paused on <strong>${dbProviderName}</strong>.</span>
          </div>
        ` : ''}

        <div style="background: var(--bg-page); border-radius: 6px; padding: 8px 10px; font-size: 11px; margin-bottom: 12px; border: 1px solid var(--border-subtle);">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: var(--text-muted);">Next Run:</span>
            <span style="font-weight: 500; color: ${isEnabled && !isUnsupportedSnapshot ? 'var(--text-heading)' : 'var(--text-muted)'};">${isUnsupportedSnapshot ? 'Paused (Requires SQLite)' : nextRunStr}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: var(--text-muted);">Last Run:</span>
            <span style="color: ${lastStatusColor}; font-weight: 500;">
              ${s.lastStatus ? `● ${escapeHtml(s.lastStatus)} (${lastRunStr})` : lastRunStr}
            </span>
          </div>
          ${s.lastError ? `
            <div style="color: var(--accent-danger); margin-top: 4px; font-size: 10px; word-break: break-all; display: flex; align-items: flex-start; gap: 4px;">
              ${cronIcons.alert(11, 11)} <span>${escapeHtml(s.lastError)}</span>
            </div>
          ` : ''}
        </div>
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; border-top: 1px solid var(--border-subtle); padding-top: 10px;">
        <span style="font-size: 11px; color: var(--text-muted);">
          Policy: <code style="font-size: 10px;">${escapeHtml(s.missedRunPolicy || 'skip')}</code>
        </span>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary btn-sm" onclick="viewScheduleHistory('${s.id}')" title="View execution history logs for this schedule" style="font-size: 11px; padding: 2px 8px;">
            History
          </button>
          <button class="btn btn-secondary btn-sm" ${isUnsupportedSnapshot ? 'disabled' : ''} onclick="handleTriggerSchedule('${s.id}')" title="${isUnsupportedSnapshot ? 'Snapshots are unsupported on ' + dbProviderName : 'Trigger immediately on-demand'}" style="font-size: 11px; padding: 2px 8px; display: inline-flex; align-items: center; gap: 4px;">
            ${cronIcons.play(9, 9)} Run Now
          </button>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="openEditScheduleDrawer('${s.id}')" title="Edit Schedule Configuration" style="font-size: 11px; padding: 2px 8px;">
            Edit
          </button>
          <button class="btn btn-danger btn-sm" onclick="handleDeleteSchedule('${s.id}')" title="Delete Schedule" style="font-size: 11px; padding: 2px 8px;">
            Delete
          </button>
        </div>
      </div>
    </div>
  `;
}

async function handleToggleScheduleEnabled(id, enabled) {
  try {
    const apiPrefix = getCronApiPrefix();
    await api(`${apiPrefix}/schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { enabled },
    });
    toast(enabled ? 'Schedule enabled' : 'Schedule disabled', 'success');
    await loadCronData();
  } catch (err) {
    toast(err.message || 'Failed to toggle schedule state', 'error');
    await loadCronData();
  }
}

async function handleTriggerSchedule(id) {
  try {
    toast('Triggering scheduled run...', 'info');
    const apiPrefix = getCronApiPrefix();
    const runLog = await api(`${apiPrefix}/schedules/${encodeURIComponent(id)}/trigger`, {
      method: 'POST',
    });
    if (runLog && runLog.status === 'succeeded') {
      toast(`Schedule executed successfully in ${runLog.durationMs}ms`, 'success');
    } else {
      toast(`Schedule run ended with status '${runLog?.status || 'failed'}': ${runLog?.error || 'Unknown error'}`, 'error');
    }
    await loadCronData();
  } catch (err) {
    toast(err.message || 'Trigger failed', 'error');
  }
}

async function handleDeleteSchedule(id) {
  const schedule = cronState.schedules.find(s => s.id === id);
  const name = schedule ? schedule.name : id;
  if (!confirm(`Are you sure you want to delete schedule "${name}"? This will cancel future runs and delete execution history for this schedule.`)) {
    return;
  }

  try {
    const apiPrefix = getCronApiPrefix();
    await api(`${apiPrefix}/schedules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    toast(`Schedule "${name}" deleted`, 'success');
    await loadCronData();
  } catch (err) {
    toast(err.message || 'Delete failed', 'error');
  }
}

// ==========================================
// Execution History Tab
// ==========================================

async function loadRunHistory() {
  try {
    const apiPrefix = getCronApiPrefix();
    const filter = cronState.runFilter;
    const params = new URLSearchParams();
    if (filter.scheduleId) params.set('scheduleId', filter.scheduleId);
    if (filter.targetType) params.set('targetType', filter.targetType);
    if (filter.status && filter.status !== 'all') params.set('status', filter.status);
    params.set('page', String(filter.page));
    params.set('perPage', String(filter.perPage));

    const data = await api(`${apiPrefix}/runs?${params.toString()}`);
    if (data) {
      cronState.runs = data.items || [];
      cronState.runFilter.total = data.total || 0;
      cronState.runFilter.totalPages = Math.ceil((data.total || 0) / filter.perPage) || 1;
      const contentArea = document.getElementById('cron-tab-content');
      if (contentArea && cronState.subTab === 'history') {
        contentArea.innerHTML = renderHistoryTableHtml();
      }
    }
  } catch (err) {
    console.warn('[Cron] Failed to load runs history:', err);
  }
}

function renderHistoryTableHtml() {
  const runs = cronState.runs || [];
  const filter = cronState.runFilter;

  return `
    <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 14px;">
      <!-- History Filters Bar -->
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <select class="input input-sm" onchange="handleHistoryStatusFilter(this.value)" style="font-size: 11px;">
            <option value="all" ${filter.status === 'all' ? 'selected' : ''}>All Statuses</option>
            <option value="succeeded" ${filter.status === 'succeeded' ? 'selected' : ''}>Succeeded</option>
            <option value="failed" ${filter.status === 'failed' ? 'selected' : ''}>Failed</option>
            <option value="skipped" ${filter.status === 'skipped' ? 'selected' : ''}>Skipped</option>
            <option value="running" ${filter.status === 'running' ? 'selected' : ''}>Running</option>
          </select>
          <select class="input input-sm" onchange="handleHistoryScheduleFilter(this.value)" style="font-size: 11px;">
            <option value="">All Schedules</option>
            ${cronState.schedules.map(s => `<option value="${s.id}" ${filter.scheduleId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        <div style="font-size: 11px; color: var(--text-muted);">
          Total: ${filter.total} runs
        </div>
      </div>

      <!-- History Table -->
      ${runs.length === 0 ? `
        <div style="padding: 32px 16px; text-align: center; color: var(--text-muted); font-size: 13px;">
          No execution runs recorded yet.
        </div>
      ` : `
        <div style="overflow-x: auto;">
          <table class="table" style="width: 100%; font-size: 12px;">
            <thead>
              <tr>
                <th style="text-align: left;">Timestamp</th>
                <th style="text-align: left;">Schedule</th>
                <th style="text-align: left;">Target</th>
                <th style="text-align: left;">Status</th>
                <th style="text-align: right;">Duration</th>
                <th style="text-align: left;">Details</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${runs.map(r => renderRunRowHtml(r)).join('')}
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 12px; font-size: 11px; color: var(--text-muted);">
          <span>Page ${filter.page} of ${filter.totalPages}</span>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-secondary btn-sm" ${filter.page <= 1 ? 'disabled' : ''} onclick="handleHistoryPageChange(${filter.page - 1})">Prev</button>
            <button class="btn btn-secondary btn-sm" ${filter.page >= filter.totalPages ? 'disabled' : ''} onclick="handleHistoryPageChange(${filter.page + 1})">Next</button>
          </div>
        </div>
      `}
    </div>
  `;
}

function renderRunRowHtml(r) {
  const statusBadge = r.status === 'succeeded'
    ? '<span class="badge" style="background: rgba(16,185,129,0.15); color: var(--accent-success);">Succeeded</span>'
    : (r.status === 'failed'
      ? '<span class="badge" style="background: rgba(239,68,68,0.15); color: var(--accent-danger);">Failed</span>'
      : (r.status === 'skipped'
        ? '<span class="badge" style="background: rgba(245,158,11,0.15); color: var(--accent-warning);">Skipped</span>'
        : '<span class="badge" style="background: rgba(59,130,246,0.15); color: var(--accent-primary);">Running</span>'));

  return `
    <tr style="border-bottom: 1px solid var(--border-subtle); cursor: pointer;" onclick="openRunDetailDrawer('${r.id}')" title="Click to view run details">
      <td style="white-space: nowrap; font-family: monospace;">${formatDateTime(r.startedAt)}</td>
      <td>
        <strong>${escapeHtml(r.scheduleName)}</strong>
        ${r.isCatchUp ? '<span class="badge" style="font-size: 9px; margin-left: 4px; background: rgba(139,92,246,0.15); color: #8b5cf6;">Catch-Up</span>' : ''}
        ${r.attempt && r.attempt > 1 ? `<span class="badge" style="font-size: 9px; margin-left: 4px; background: rgba(99,102,241,0.15); color: #6366f1;" title="Execution completed on attempt #${r.attempt}">Retry #${r.attempt}</span>` : ''}
      </td>
      <td>
        <span style="font-size: 11px; padding: 1px 5px; border-radius: 3px; background: var(--bg-card-hover);" title="${r.targetId ? `Target ID: ${escapeHtml(r.targetId)}` : ''}">
          ${escapeHtml(r.targetType)}: <strong>${escapeHtml(getTargetDisplayName(r.targetType, r.targetId))}</strong>
        </span>
      </td>
      <td>${statusBadge}</td>
      <td style="text-align: right; font-family: monospace;">${r.durationMs || 0}ms</td>
      <td style="max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${r.error ? `<span style="color: var(--accent-danger);" title="${escapeHtml(r.error)}">${cronIcons.alert(11, 11)} ${escapeHtml(r.error)}</span>` : (r.output ? `<code style="font-size: 10px;" title="${escapeHtml(r.output)}">${escapeHtml(r.output)}</code>` : '<span style="color: var(--text-muted);">-</span>')}
      </td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openRunDetailDrawer('${r.id}')" style="font-size: 10px; padding: 1px 7px;" title="Inspect output and error details">
          Inspect
        </button>
      </td>
    </tr>
  `;
}

function handleHistoryStatusFilter(status) {
  cronState.runFilter.status = status;
  cronState.runFilter.page = 1;
  loadRunHistory();
}

function handleHistoryScheduleFilter(scheduleId) {
  cronState.runFilter.scheduleId = scheduleId;
  cronState.runFilter.page = 1;
  const btn = document.getElementById('btn-clear-cron-history');
  if (btn) {
    btn.textContent = scheduleId ? 'Clear Schedule History' : 'Clear All History';
  }
  loadRunHistory();
}

function handleHistoryPageChange(newPage) {
  cronState.runFilter.page = Math.max(1, newPage);
  loadRunHistory();
}

async function handleClearRunHistory() {
  const scheduleId = cronState.runFilter.scheduleId;
  const targetSched = scheduleId ? (cronState.schedules || []).find(s => s.id === scheduleId) : null;
  const schedName = targetSched ? targetSched.name : scheduleId;

  const confirmMsg = targetSched
    ? `Are you sure you want to clear execution history for schedule "${schedName}"?`
    : (scheduleId
      ? 'Are you sure you want to clear execution history for the selected schedule?'
      : 'Are you sure you want to clear all execution run history logs across ALL schedules?');

  if (!confirm(confirmMsg)) {
    return;
  }
  try {
    const apiPrefix = getCronApiPrefix();
    const url = scheduleId
      ? `${apiPrefix}/runs?scheduleId=${encodeURIComponent(scheduleId)}`
      : `${apiPrefix}/runs`;
    await api(url, {
      method: 'DELETE',
    });
    toast(targetSched ? `Run history for "${schedName}" cleared` : 'Run history cleared', 'success');
    await loadCronData();
  } catch (err) {
    toast(err.message || 'Failed to clear run history', 'error');
  }
}

// ==========================================
// Slide-Over Drawer: Execution Run Detail Inspector
// ==========================================

function openRunDetailDrawer(runId) {
  const run = (cronState.runs || []).find(r => r.id === runId);
  if (!run) return;
  cronState.activeRunForDetail = run;
  renderRunDetailDrawer();
}

function renderRunDetailDrawer() {
  const r = cronState.activeRunForDetail;
  if (!r) return;

  let root = document.getElementById('drawer-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'drawer-root';
    document.body.appendChild(root);
  }

  let formattedOutput = '';
  if (r.output) {
    try {
      formattedOutput = JSON.stringify(JSON.parse(r.output), null, 2);
    } catch {
      formattedOutput = r.output;
    }
  }

  // Calculate jitter/latency between scheduledAt and startedAt
  let latencyStr = '';
  if (r.scheduledAt && r.startedAt) {
    const diff = new Date(r.startedAt).getTime() - new Date(r.scheduledAt).getTime();
    if (r.isCatchUp) {
      latencyStr = `Catch-up execution (${Math.round(diff / 1000)}s delayed)`;
    } else if (Math.abs(diff) < 1000) {
      latencyStr = `${diff}ms jitter (on-time)`;
    } else {
      latencyStr = `${Math.round(diff / 1000)}s dispatch delay`;
    }
  }

  const statusBadge = r.status === 'succeeded'
    ? '<span class="badge" style="background: rgba(16,185,129,0.15); color: var(--accent-success); font-size: 11px;">Succeeded</span>'
    : (r.status === 'failed'
      ? '<span class="badge" style="background: rgba(239,68,68,0.15); color: var(--accent-danger); font-size: 11px;">Failed</span>'
      : (r.status === 'skipped'
        ? '<span class="badge" style="background: rgba(245,158,11,0.15); color: var(--accent-warning); font-size: 11px;">Skipped</span>'
        : '<span class="badge" style="background: rgba(59,130,246,0.15); color: var(--accent-primary); font-size: 11px;">Running</span>'));

  root.innerHTML = `
    <div id="run-detail-backdrop" class="drawer-backdrop" onclick="closeRunDetailDrawer()" aria-hidden="true"></div>
    <aside id="run-detail-panel" class="schedule-drawer" role="dialog" aria-modal="true" aria-labelledby="run-detail-title" tabindex="-1">
      <div class="drawer-header">
        <div class="drawer-title-area">
          <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(59,130,246,0.12); color: var(--accent-primary); display: flex; align-items: center; justify-content: center; font-size: 17px; flex-shrink: 0;">
            ${cronIcons.chart(18, 18)}
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <h3 id="run-detail-title" class="drawer-title" style="margin: 0; font-size: 15px;">Run Details</h3>
              ${statusBadge}
            </div>
            <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(r.scheduleName)} &bull; ${formatDateTime(r.startedAt)}</span>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeRunDetailDrawer()" style="border: none; font-size: 18px; line-height: 1; cursor: pointer;" title="Close (Esc)">✕</button>
      </div>

      <div class="drawer-body" style="flex: 1; overflow-y: auto; padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
        <!-- Metadata Summary Card -->
        <div class="drawer-card">
          <span class="drawer-section-title">Execution Summary</span>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12px;">
            <div>
              <span style="color: var(--text-muted); display: block; font-size: 11px;">Schedule</span>
              <strong style="color: var(--text-heading);">${escapeHtml(r.scheduleName)}</strong>
            </div>
            <div>
              <span style="color: var(--text-muted); display: block; font-size: 11px;">Target</span>
              <strong>${escapeHtml(r.targetType.toUpperCase())}:</strong> ${escapeHtml(getTargetDisplayName(r.targetType, r.targetId))}
            </div>
            <div>
              <span style="color: var(--text-muted); display: block; font-size: 11px;">Started At</span>
              <span style="font-family: monospace;">${formatDateTime(r.startedAt)}</span>
            </div>
            <div>
              <span style="color: var(--text-muted); display: block; font-size: 11px;">Duration</span>
              <span style="font-family: monospace; font-weight: 600;">${r.durationMs || 0}ms</span>
            </div>
            <div>
              <span style="color: var(--text-muted); display: block; font-size: 11px;">Attempt Count</span>
              <span style="font-family: monospace; font-weight: 600;">${r.attempt || 1}</span>
            </div>
            <div>
              <span style="color: var(--text-muted); display: block; font-size: 11px;">Scheduled At</span>
              <span style="font-family: monospace;">${formatDateTime(r.scheduledAt)}</span>
            </div>
            <div>
              <span style="color: var(--text-muted); display: block; font-size: 11px;">Dispatch Accuracy</span>
              <span style="color: ${r.isCatchUp ? 'var(--accent-warning)' : 'var(--accent-success)'}; font-size: 11px; font-weight: 500;">${escapeHtml(latencyStr || 'On-time')}</span>
            </div>
            ${r.executionRefId ? `
              <div style="grid-column: span 2;">
                <span style="color: var(--text-muted); display: block; font-size: 11px;">Execution Reference ID</span>
                <code style="font-size: 11px; word-break: break-all;">${escapeHtml(r.executionRefId)}</code>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Error Card (if failed or error) -->
        ${r.error ? `
          <div class="drawer-card" style="border-left: 3px solid var(--accent-danger);">
            <span class="drawer-section-title" style="color: var(--accent-danger); margin-bottom: 6px;">Error Details</span>
            <div style="background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.2); border-radius: 6px; padding: 10px; font-family: monospace; font-size: 11px; color: var(--accent-danger); white-space: pre-wrap; word-break: break-word;">
              ${escapeHtml(r.error)}
            </div>
          </div>
        ` : ''}

        <!-- Output Card (if output) -->
        ${formattedOutput ? `
          <div class="drawer-card" style="flex: 1; display: flex; flex-direction: column;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <span class="drawer-section-title" style="margin-bottom: 0;">Output Data</span>
              <button class="btn btn-secondary btn-sm" onclick="copyRunOutputToClipboard()" style="font-size: 10px; padding: 2px 7px; display: inline-flex; align-items: center; gap: 4px;">
                ${cronIcons.copy(11, 11)} Copy Output
              </button>
            </div>
            <pre id="run-output-pre" style="background: var(--bg-page); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 10px; font-size: 11px; font-family: monospace; overflow: auto; max-height: 280px; margin: 0; white-space: pre-wrap; word-break: break-word;">${escapeHtml(formattedOutput)}</pre>
          </div>
        ` : `
          <div class="drawer-card">
            <span class="drawer-section-title">Output Data</span>
            <span style="color: var(--text-muted); font-size: 12px;">No output payload recorded for this execution.</span>
          </div>
        `}
      </div>

      <div class="drawer-footer" style="padding: 1rem 1.5rem; border-top: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; background: var(--bg-card); flex-shrink: 0;">
        <code style="font-size: 10px; color: var(--text-muted);">Run ID: ${escapeHtml(r.id)}</code>
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeRunDetailDrawer()">Close</button>
      </div>
    </aside>
  `;

  // Trigger animation
  const triggerDrawerOpen = () => {
    const backdrop = document.getElementById('run-detail-backdrop');
    const panel = document.getElementById('run-detail-panel');
    if (backdrop) backdrop.classList.add('open');
    if (panel) panel.classList.add('open');
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(triggerDrawerOpen);
  } else {
    triggerDrawerOpen();
  }

  window.removeEventListener('keydown', handleRunDetailDrawerKeyDown);
  window.addEventListener('keydown', handleRunDetailDrawerKeyDown);
}

function closeRunDetailDrawer() {
  const backdrop = document.getElementById('run-detail-backdrop');
  const panel = document.getElementById('run-detail-panel');
  if (backdrop) backdrop.classList.remove('open');
  if (panel) panel.classList.remove('open');

  window.removeEventListener('keydown', handleRunDetailDrawerKeyDown);
  cronState.activeRunForDetail = null;

  setTimeout(() => {
    const root = document.getElementById('drawer-root');
    if (root && root.querySelector('#run-detail-panel')) {
      root.innerHTML = '';
    }
  }, 280);
}

function handleRunDetailDrawerKeyDown(e) {
  if (e.key === 'Escape' && document.getElementById('run-detail-backdrop')) {
    closeRunDetailDrawer();
  }
}

function copyRunOutputToClipboard() {
  const pre = document.getElementById('run-output-pre');
  if (!pre) return;
  if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(pre.textContent || '').then(() => {
      toast('Output copied to clipboard', 'success');
    }).catch(() => {
      toast('Failed to copy', 'error');
    });
  }
}

// ==========================================
// Slide-Over Drawer: Create / Edit Schedule & Live Preview
// ==========================================

function openCreateScheduleDrawer(targetType = 'function', targetId = '') {
  if (!isSqliteDatabase() && targetType === 'snapshot') {
    targetType = 'function';
    targetId = '';
  }
  cronState.activeScheduleForEdit = null;
  cronState.createTargetType = targetType;
  cronState.createTargetId = targetId;
  renderScheduleDrawer();
}

function openEditScheduleDrawer(id) {
  const schedule = cronState.schedules.find(s => s.id === id);
  if (!schedule) return;
  cronState.activeScheduleForEdit = schedule;
  cronState.createTargetType = null;
  cronState.createTargetId = null;
  renderScheduleDrawer();
}

function closeScheduleDrawer() {
  const backdrop = document.getElementById('schedule-drawer-backdrop');
  const panel = document.getElementById('schedule-drawer-panel');
  if (backdrop) backdrop.classList.remove('open');
  if (panel) panel.classList.remove('open');

  window.removeEventListener('keydown', handleScheduleDrawerKeyDown);
  cronState.activeScheduleForEdit = null;
  cronState.createTargetType = null;
  cronState.createTargetId = null;

  setTimeout(() => {
    const root = document.getElementById('drawer-root');
    if (root && root.querySelector('#schedule-drawer-panel')) {
      root.innerHTML = '';
    }
    const modalRoot = document.getElementById('modal-root');
    if (modalRoot && modalRoot.querySelector('#schedule-drawer-panel')) {
      modalRoot.innerHTML = '';
    }
  }, 280);
}

function handleScheduleDrawerKeyDown(e) {
  if (e.key === 'Escape' && document.getElementById('schedule-drawer-backdrop')) {
    closeScheduleDrawer();
  }
}

// Aliases for compatibility
const openCreateScheduleModal = openCreateScheduleDrawer;
const openEditScheduleModal = openEditScheduleDrawer;
const closeScheduleModal = closeScheduleDrawer;

function renderScheduleDrawer() {
  let root = document.getElementById('drawer-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'drawer-root';
    document.body.appendChild(root);
  }

  const isEdit = Boolean(cronState.activeScheduleForEdit);
  const isSqlite = isSqliteDatabase();
  const dbProviderName = (typeof databaseState !== 'undefined' && databaseState.status?.provider ? databaseState.status.provider : 'remote').toUpperCase();
  let defaultTargetType = cronState.createTargetType || 'function';
  if (!isSqlite && defaultTargetType === 'snapshot') {
    defaultTargetType = 'function';
  }

  const s = cronState.activeScheduleForEdit || {
    name: '',
    targetType: defaultTargetType,
    targetId: cronState.createTargetId || '',
    cronExpression: '0 9 * * 1-5',
    timezone: 'UTC',
    missedRunPolicy: defaultTargetType === 'snapshot' ? 'catch_up_once' : 'skip',
    payload: null,
    enabled: true,
  };
  if (!isEdit && !isSqlite && s.targetType === 'snapshot') {
    s.targetType = 'function';
  }

  const payloadStr = s.payload !== undefined && s.payload !== null
    ? (typeof s.payload === 'string' ? s.payload : JSON.stringify(s.payload, null, 2))
    : '';

  root.innerHTML = `
    <div id="schedule-drawer-backdrop" class="drawer-backdrop" onclick="closeScheduleDrawer()" aria-hidden="true"></div>
    <aside id="schedule-drawer-panel" class="schedule-drawer" role="dialog" aria-modal="true" aria-labelledby="schedule-drawer-title" tabindex="-1">
      <!-- Drawer Header -->
      <div class="drawer-header">
        <div class="drawer-title-area">
          <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(59,130,246,0.12); color: var(--accent-primary); display: flex; align-items: center; justify-content: center; font-size: 17px; flex-shrink: 0;">
            ${cronIcons.clock(18, 18)}
          </div>
          <div>
            <h3 id="schedule-drawer-title" class="drawer-title" style="margin: 0; font-size: 15px;">${isEdit ? 'Edit Schedule' : 'Create New Schedule'}</h3>
            <span style="font-size: 11px; color: var(--text-muted);">${isEdit ? 'Modify scheduled trigger parameters and policies' : (isSqlite ? 'Configure an automated cron schedule for Functions, Flows, or Snapshots' : 'Configure an automated cron schedule for Functions or Flows')}</span>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeScheduleDrawer()" style="border: none; font-size: 18px; line-height: 1; cursor: pointer;" title="Close Drawer (Esc)">✕</button>
      </div>

      <!-- Drawer Body (Form) -->
      <form id="cron-schedule-form" onsubmit="handleSaveSchedule(event)" style="display: flex; flex-direction: column; flex: 1; overflow: hidden; margin: 0;">
        <div class="drawer-body" style="flex: 1; overflow-y: auto; padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1.25rem;">
          <!-- Schedule Name & Enabled -->
          <div class="drawer-card">
            <div style="display: flex; gap: 12px; align-items: flex-end;">
              <div style="flex: 1;">
                <label for="sched-input-name" style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Schedule Name *</label>
                <input type="text" id="sched-input-name" class="input" required value="${escapeHtml(s.name)}" placeholder="e.g. Daily Metrics Aggregation" style="width: 100%;">
              </div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                <label class="switch">
                  <input type="checkbox" id="sched-input-enabled" ${s.enabled ? 'checked' : ''}>
                  <span class="slider round"></span>
                </label>
                <span style="font-size: 12px; font-weight: 500;">Enabled</span>
              </div>
            </div>
          </div>

          <!-- Target Selection -->
          <div class="drawer-card">
            <span class="drawer-section-title">Trigger Target</span>
            <div style="display: grid; grid-template-columns: 140px 1fr; gap: 10px;">
              <div>
                <label for="sched-input-target-type" style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Target Type</label>
                <select id="sched-input-target-type" class="input" onchange="handleModalTargetTypeChange(this.value)" style="width: 100%;">
                  <option value="function" ${s.targetType === 'function' ? 'selected' : ''}>Function</option>
                  <option value="flow" ${s.targetType === 'flow' ? 'selected' : ''}>Flow</option>
                  ${isSqlite ? `<option value="snapshot" ${s.targetType === 'snapshot' ? 'selected' : ''}>Snapshot</option>` : (s.targetType === 'snapshot' ? `<option value="snapshot" selected>Snapshot (Unsupported on ${dbProviderName})</option>` : '')}
                </select>
              </div>
              <div>
                <label for="sched-input-target-id" style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Target Selection *</label>
                <div id="sched-target-picker-area">
                  ${renderModalTargetPickerHtml(s.targetType, s.targetId)}
                </div>
              </div>
            </div>
          </div>

          <!-- Schedule Cadence & Expression -->
          <div class="drawer-card">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span class="drawer-section-title" style="margin-bottom: 0;">Cron Cadence</span>
              <select class="input input-sm" onchange="handleModalPresetChange(this.value)" style="font-size: 11px; padding: 2px 6px;">
                <option value="">Preset Templates...</option>
                <option value="* * * * *">Every minute (* * * * *)</option>
                <option value="*/15 * * * *">Every 15 minutes (*/15 * * * *)</option>
                <option value="@hourly">Hourly (@hourly)</option>
                <option value="@daily">Daily at midnight (@daily)</option>
                <option value="0 9 * * *">Daily at 9:00 AM (0 9 * * *)</option>
                <option value="0 9 * * 1-5">Weekdays at 9:00 AM (0 9 * * 1-5)</option>
                <option value="@weekly">Weekly on Sunday (@weekly)</option>
                <option value="@monthly">Monthly on 1st day (@monthly)</option>
                <option value="0 0 L * *">Monthly on last day (0 0 L * *)</option>
                <option value="@yearly">Yearly on Jan 1st (@yearly)</option>
              </select>
            </div>

            <div style="display: flex; gap: 8px;">
              <input type="text" id="sched-input-expr" class="input" required value="${escapeHtml(s.cronExpression)}" placeholder="e.g. 0 9 * * 1-5" oninput="handleCronExpressionInput()" style="flex: 1; font-family: monospace; font-size: 13px;" autocomplete="off">
              <input type="text" id="sched-input-tz" class="input" required value="${escapeHtml(s.timezone || 'UTC')}" list="iana-timezones-list" placeholder="Timezone" oninput="handleCronExpressionInput()" style="width: 170px; font-size: 12px;">
            </div>
            <span style="font-size: 11px; color: var(--text-muted); margin-top: 3px; display: block;">
              Standard 5-field cron or macro (<code>@hourly</code>, <code>@daily</code>, <code>0 0 L * *</code>).
            </span>

            <!-- Live Next Runs Preview Card -->
            <div id="sched-preview-card" style="background: var(--bg-page); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 10px 12px; margin-top: 8px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-size: 11px; font-weight: 600; color: var(--text-heading);">Upcoming Executions Preview</span>
                <span id="sched-preview-human" style="font-size: 11px; color: var(--accent-primary);">Loading...</span>
              </div>
              <ul id="sched-preview-list" style="margin: 0; padding-left: 18px; font-size: 11px; font-family: monospace; color: var(--text-muted);">
                <li>Calculating...</li>
              </ul>
            </div>
          </div>

          <!-- Missed-Run Policy -->
          <div class="drawer-card">
            <span class="drawer-section-title">Missed-Run Policy (Misfire Grace >60s)</span>
            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
              <label style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer;">
                <input type="radio" name="missedRunPolicy" value="skip" ${s.missedRunPolicy === 'skip' ? 'checked' : ''} style="margin-top: 2px;">
                <div>
                  <strong>skip:</strong> Discard missed slots and jump next execution forward (default for Functions & Flows)
                </div>
              </label>
              <label style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer;">
                <input type="radio" name="missedRunPolicy" value="catch_up_once" ${s.missedRunPolicy === 'catch_up_once' ? 'checked' : ''} style="margin-top: 2px;">
                <div>
                  <strong>catch_up_once:</strong> Coalesce all missed slots into 1 immediate execution (default for Snapshots)
                </div>
              </label>
              <label style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer;">
                <input type="radio" name="missedRunPolicy" value="catch_up_all" ${s.missedRunPolicy === 'catch_up_all' ? 'checked' : ''} style="margin-top: 2px;">
                <div>
                  <strong>catch_up_all:</strong> Replay all missed slots sequentially (capped at safety limit of 10)
                </div>
              </label>
            </div>
          </div>

          <!-- Reliability & Lifecycle Controls -->
          <div class="drawer-card">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span class="drawer-section-title" style="margin-bottom: 0;">Reliability & Lifecycle Controls</span>
              <span style="font-size: 11px; color: var(--text-muted);">Retries, circuit breaker, expiration</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px;">
              <div>
                <label for="sched-input-retries" style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 3px;">Max Retries (Backoff)</label>
                <select id="sched-input-retries" class="input" style="width: 100%; font-size: 12px;">
                  <option value="0" ${Number(s.maxRetries || 0) === 0 ? 'selected' : ''}>No retries (0)</option>
                  <option value="1" ${Number(s.maxRetries) === 1 ? 'selected' : ''}>1 retry with backoff</option>
                  <option value="2" ${Number(s.maxRetries) === 2 ? 'selected' : ''}>2 retries with backoff</option>
                  <option value="3" ${Number(s.maxRetries) === 3 ? 'selected' : ''}>3 retries with backoff</option>
                  <option value="5" ${Number(s.maxRetries) === 5 ? 'selected' : ''}>5 retries with backoff</option>
                </select>
              </div>

              <div>
                <label for="sched-input-autopause" style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 3px;">Circuit Breaker (Auto-Pause)</label>
                <select id="sched-input-autopause" class="input" style="width: 100%; font-size: 12px;">
                  <option value="0" ${Number(s.autoPauseAfterFailures || 0) === 0 ? 'selected' : ''}>Never auto-pause (Disabled)</option>
                  <option value="3" ${Number(s.autoPauseAfterFailures) === 3 ? 'selected' : ''}>Pause after 3 failures</option>
                  <option value="5" ${Number(s.autoPauseAfterFailures) === 5 ? 'selected' : ''}>Pause after 5 failures</option>
                  <option value="10" ${Number(s.autoPauseAfterFailures) === 10 ? 'selected' : ''}>Pause after 10 failures</option>
                </select>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div>
                <label for="sched-input-expires" style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 3px;">Auto-Expire Date (Optional)</label>
                <input type="datetime-local" id="sched-input-expires" class="input" value="${s.expiresAt ? formatForDateTimeLocal(s.expiresAt) : ''}" style="width: 100%; font-size: 12px;">
                <span style="font-size: 10px; color: var(--text-muted); display: block; margin-top: 2px;">Schedule pauses after this timestamp</span>
              </div>

              <div id="sched-retention-container" style="${s.targetType === 'snapshot' ? '' : 'display: none;'}">
                <label for="sched-input-keeplast" style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 3px;">Snapshot Retention (keepLast)</label>
                <input type="number" id="sched-input-keeplast" class="input" min="1" max="1000" placeholder="e.g. 7" value="${s.keepLast ? s.keepLast : ''}" style="width: 100%; font-size: 12px;">
                <span style="font-size: 10px; color: var(--text-muted); display: block; margin-top: 2px;">Retain last N snapshots created by this schedule</span>
              </div>
            </div>
          </div>

          <!-- Input Payload (JSON) -->
          <div id="sched-payload-container" class="drawer-card" style="${s.targetType === 'snapshot' ? 'display: none;' : ''}">
            <label for="sched-input-payload" style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Payload / Context Data (JSON)</label>
            <textarea id="sched-input-payload" class="input" rows="3" placeholder='{"dryRun": false}' style="width: 100%; font-family: monospace; font-size: 12px;">${escapeHtml(payloadStr)}</textarea>
            <span style="font-size: 11px; color: var(--text-muted); margin-top: 3px; display: block;">
              Passed to function as <code>context.request.body</code> or flow as initial input payload.
            </span>
          </div>
        </div>

        <!-- Drawer Footer -->
        <div class="drawer-footer" style="padding: 1rem 1.5rem; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end; align-items: center; gap: 8px; background: var(--bg-card); flex-shrink: 0;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="closeScheduleDrawer()">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm" id="btn-save-schedule">${isEdit ? 'Save Changes' : 'Create Schedule'}</button>
        </div>
      </form>
    </aside>
  `;

  // Trigger smooth slide-in animation
  const triggerDrawerOpen = () => {
    const backdrop = document.getElementById('schedule-drawer-backdrop');
    const panel = document.getElementById('schedule-drawer-panel');
    if (backdrop) backdrop.classList.add('open');
    if (panel) {
      panel.classList.add('open');
      const firstInput = panel.querySelector('input:not([type="hidden"]), select, textarea');
      if (firstInput && typeof firstInput.focus === 'function') {
        try { firstInput.focus(); } catch (_) {}
      }
    }
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(triggerDrawerOpen);
  } else {
    triggerDrawerOpen();
  }

  window.removeEventListener('keydown', handleScheduleDrawerKeyDown);
  window.addEventListener('keydown', handleScheduleDrawerKeyDown);

  // Fetch initial preview
  handleCronExpressionInput();
}

const renderScheduleModal = renderScheduleDrawer;

function renderModalTargetPickerHtml(targetType, selectedId) {
  if (targetType === 'function') {
    const list = cronState.functionsList || [];
    if (list.length === 0) {
      return `<input type="text" id="sched-input-target-id" class="input" required value="${escapeHtml(selectedId || '')}" placeholder="Function ID or name" style="width: 100%;">`;
    }
    const nameCounts = {};
    for (const f of list) {
      nameCounts[f.name] = (nameCounts[f.name] || 0) + 1;
    }
    return `
      <select id="sched-input-target-id" class="input" required style="width: 100%;">
        <option value="">Select Function Target...</option>
        ${list.map(fn => {
          const isDup = (nameCounts[fn.name] || 0) > 1;
          const label = fn.name + (isDup ? ` (${fn.id.slice(0, 8)})` : '') + (fn.enabled === false ? ' [Disabled]' : '');
          return `<option value="${escapeHtml(fn.id)}" ${selectedId === fn.id || selectedId === fn.name ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        }).join('')}
      </select>
    `;
  }

  if (targetType === 'flow') {
    const list = cronState.flowsList || [];
    if (list.length === 0) {
      return `<input type="text" id="sched-input-target-id" class="input" required value="${escapeHtml(selectedId || '')}" placeholder="Flow ID or name" style="width: 100%;">`;
    }
    const nameCounts = {};
    for (const fl of list) {
      nameCounts[fl.name] = (nameCounts[fl.name] || 0) + 1;
    }
    return `
      <select id="sched-input-target-id" class="input" required style="width: 100%;">
        <option value="">Select Flow Target...</option>
        ${list.map(fl => {
          const isDup = (nameCounts[fl.name] || 0) > 1;
          const label = fl.name + (isDup ? ` (${fl.id.slice(0, 8)})` : '') + (fl.enabled === false ? ' [Disabled]' : '');
          return `<option value="${escapeHtml(fl.id)}" ${selectedId === fl.id || selectedId === fl.name ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        }).join('')}
      </select>
    `;
  }

  if (targetType === 'snapshot') {
    if (!isSqliteDatabase()) {
      return `
        <input type="hidden" id="sched-input-target-id" value="${escapeHtml(selectedId || 'data.db')}">
        <div class="alert alert-warning" style="font-size: 11px; padding: 8px 10px; margin: 0; border-radius: 4px; background: rgba(245,158,11,0.12); color: var(--accent-warning); border: 1px solid rgba(245,158,11,0.25);">
          Automated snapshots are exclusive to embedded SQLite databases and are paused.
        </div>
      `;
    }
    return `
      <input type="text" id="sched-input-target-id" class="input" value="${escapeHtml(selectedId || 'data.db')}" readonly style="width: 100%; background: var(--bg-card-hover);" title="Automated snapshot targets local SQLite database">
      <span style="font-size: 10px; color: var(--text-muted); margin-top: 2px; display: block;">
        Creates rolling baseline snapshots with oldest-unprotected eviction.
      </span>
    `;
  }

  return `<input type="text" id="sched-input-target-id" class="input" required value="${escapeHtml(selectedId || '')}" style="width: 100%;">`;
}

function handleModalTargetTypeChange(type) {
  if (!isSqliteDatabase() && type === 'snapshot') {
    type = 'function';
    const typeEl = document.getElementById('sched-input-target-type');
    if (typeEl) typeEl.value = 'function';
  }
  const pickerArea = document.getElementById('sched-target-picker-area');
  const payloadContainer = document.getElementById('sched-payload-container');
  const retentionContainer = document.getElementById('sched-retention-container');
  if (pickerArea) {
    pickerArea.innerHTML = renderModalTargetPickerHtml(type, '');
  }
  if (payloadContainer) {
    payloadContainer.style.display = type === 'snapshot' ? 'none' : 'block';
  }
  if (retentionContainer) {
    retentionContainer.style.display = type === 'snapshot' ? 'block' : 'none';
  }

  // When creating a new schedule, update the selected default policy for the target type
  if (!cronState.activeScheduleForEdit) {
    const defaultPolicy = type === 'snapshot' ? 'catch_up_once' : 'skip';
    const radio = document.querySelector(`input[name="missedRunPolicy"][value="${defaultPolicy}"]`);
    if (radio) {
      radio.checked = true;
    }
  }
}

function handleModalPresetChange(preset) {
  if (!preset) return;
  const exprInput = document.getElementById('sched-input-expr');
  if (exprInput) {
    exprInput.value = preset;
    handleCronExpressionInput();
  }
}

let cronPreviewDebounceTimer = null;
function handleCronExpressionInput() {
  if (cronPreviewDebounceTimer) {
    clearTimeout(cronPreviewDebounceTimer);
  }
  cronPreviewDebounceTimer = setTimeout(async () => {
    const exprInput = document.getElementById('sched-input-expr');
    const tzInput = document.getElementById('sched-input-tz');
    const humanEl = document.getElementById('sched-preview-human');
    const listEl = document.getElementById('sched-preview-list');

    if (!exprInput || !humanEl || !listEl) return;

    const cronExpression = exprInput.value.trim();
    const timezone = tzInput ? tzInput.value.trim() : 'UTC';

    if (!cronExpression) {
      humanEl.textContent = 'Enter expression';
      listEl.innerHTML = '<li>Awaiting 5-field expression...</li>';
      return;
    }

    try {
      const apiPrefix = getCronApiPrefix();
      const data = await api(`${apiPrefix}/preview`, {
        method: 'POST',
        body: { cronExpression, timezone, count: 5 },
      });
      if (data && data.valid) {
        humanEl.textContent = data.description || 'Valid Expression';
        humanEl.style.color = 'var(--accent-primary)';
        listEl.innerHTML = (data.nextRuns || []).map(r => `
          <li>${escapeHtml(r.zonedFormatted)} <span style="color: var(--text-muted); font-size: 10px;">(${escapeHtml(r.isoUtc)})</span></li>
        `).join('');
      } else {
        humanEl.textContent = data?.error || 'Invalid Expression';
        humanEl.style.color = 'var(--accent-danger)';
        listEl.innerHTML = `<li style="color: var(--accent-danger);">${escapeHtml(data?.error || 'Syntax error')}</li>`;
      }
    } catch {
      humanEl.textContent = 'Preview unavailable';
    }
  }, 250);
}

async function handleSaveSchedule(e) {
  e.preventDefault();
  const nameEl = document.getElementById('sched-input-name');
  const enabledEl = document.getElementById('sched-input-enabled');
  const targetTypeEl = document.getElementById('sched-input-target-type');
  const targetIdEl = document.getElementById('sched-input-target-id');
  const exprEl = document.getElementById('sched-input-expr');
  const tzEl = document.getElementById('sched-input-tz');
  const payloadEl = document.getElementById('sched-input-payload');
  const policyEl = document.querySelector('input[name="missedRunPolicy"]:checked');

  if (!nameEl || !targetTypeEl || !targetIdEl || !exprEl) return;

  const retriesEl = document.getElementById('sched-input-retries');
  const autoPauseEl = document.getElementById('sched-input-autopause');
  const expiresEl = document.getElementById('sched-input-expires');
  const keepLastEl = document.getElementById('sched-input-keeplast');

  const maxRetries = retriesEl ? parseInt(retriesEl.value, 10) : 0;
  const autoPauseAfterFailures = autoPauseEl ? parseInt(autoPauseEl.value, 10) : 0;
  const expiresAt = expiresEl && expiresEl.value ? new Date(expiresEl.value).toISOString() : null;
  const keepLast = (targetTypeEl.value === 'snapshot' && keepLastEl && keepLastEl.value) ? parseInt(keepLastEl.value, 10) : null;

  let parsedPayload = undefined;
  if (payloadEl && payloadEl.value.trim()) {
    try {
      parsedPayload = JSON.parse(payloadEl.value.trim());
    } catch (err) {
      toast('Invalid JSON payload: ' + err.message, 'error');
      return;
    }
  }

  if (targetTypeEl.value === 'snapshot' && !isSqliteDatabase() && enabledEl && enabledEl.checked) {
    toast('Snapshots cannot be enabled on non-SQLite databases and will remain paused.', 'warning');
    enabledEl.checked = false;
  }

  const dto = {
    name: nameEl.value.trim(),
    targetType: targetTypeEl.value,
    targetId: targetIdEl.value.trim(),
    cronExpression: exprEl.value.trim(),
    timezone: tzEl ? tzEl.value.trim() : 'UTC',
    missedRunPolicy: policyEl ? policyEl.value : 'skip',
    payload: parsedPayload,
    enabled: (!isSqliteDatabase() && targetTypeEl.value === 'snapshot') ? false : (enabledEl ? enabledEl.checked : true),
    maxRetries,
    autoPauseAfterFailures,
    expiresAt,
    keepLast,
  };

  try {
    const isEdit = Boolean(cronState.activeScheduleForEdit);
    const apiPrefix = getCronApiPrefix();
    const url = isEdit
      ? `${apiPrefix}/schedules/${encodeURIComponent(cronState.activeScheduleForEdit.id)}`
      : `${apiPrefix}/schedules`;
    const method = isEdit ? 'PATCH' : 'POST';

    await api(url, {
      method,
      body: dto,
    });

    closeScheduleModal();
    toast(isEdit ? 'Schedule updated' : 'Schedule created', 'success');
    await loadCronData();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

// ==========================================
// Helpers
// ==========================================

function formatDualTime(isoString, timezone) {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('en-US', {
      timeZone: timezone || 'UTC',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

function formatDateTime(isoString) {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

function formatRelativeTime(isoString) {
  try {
    const targetMs = new Date(isoString).getTime();
    if (isNaN(targetMs)) return isoString;
    const now = Date.now();
    const isFuture = targetMs > now;
    const diffSec = Math.floor(Math.abs(now - targetMs) / 1000);

    if (diffSec < 60) {
      if (diffSec < 5 && !isFuture) return 'just now';
      return isFuture ? `in ${diffSec}s` : `${diffSec}s ago`;
    }
    const min = Math.floor(diffSec / 60);
    if (min < 60) {
      return isFuture ? `in ${min}m` : `${min}m ago`;
    }
    const hr = Math.floor(min / 60);
    if (hr < 24) {
      return isFuture ? `in ${hr}h` : `${hr}h ago`;
    }
    const days = Math.floor(hr / 24);
    if (days < 30) {
      return isFuture ? `in ${days}d` : `${days}d ago`;
    }
    const months = Math.floor(days / 30);
    if (months < 12) {
      return isFuture ? `in ${months}mo` : `${months}mo ago`;
    }
    const years = Math.floor(days / 365);
    return isFuture ? `in ${years}y` : `${years}y ago`;
  } catch {
    return isoString;
  }
}

function formatForDateTimeLocal(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    const YYYY = d.getFullYear();
    const MM = pad(d.getMonth() + 1);
    const DD = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    return `${YYYY}-${MM}-${DD}T${hh}:${mm}`;
  } catch {
    return '';
  }
}

function showToast(msg, type = 'info') {
  if (typeof toast === 'function') {
    toast(msg, type);
  }
}

if (typeof window !== 'undefined') {
  window.cronState = cronState;
  window.renderSchedulesView = renderSchedulesView;
  window.refreshSchedulesView = refreshSchedulesView;
  window.switchCronTab = switchCronTab;
  window.handleCronTargetFilter = handleCronTargetFilter;
  window.handleCronSearchInput = handleCronSearchInput;
  window.handleCronStatusFilter = handleCronStatusFilter;
  window.handleCronSortChange = handleCronSortChange;
  window.handleResetScheduleFilters = handleResetScheduleFilters;
  window.viewScheduleHistory = viewScheduleHistory;
  window.navigateToCronTarget = navigateToCronTarget;
  window.openRunDetailDrawer = openRunDetailDrawer;
  window.renderRunDetailDrawer = renderRunDetailDrawer;
  window.closeRunDetailDrawer = closeRunDetailDrawer;
  window.copyRunOutputToClipboard = copyRunOutputToClipboard;
  window.openCreateScheduleDrawer = openCreateScheduleDrawer;
  window.openEditScheduleDrawer = openEditScheduleDrawer;
  window.closeScheduleDrawer = closeScheduleDrawer;
  window.renderScheduleDrawer = renderScheduleDrawer;
  window.openCreateScheduleModal = openCreateScheduleDrawer;
  window.openEditScheduleModal = openEditScheduleDrawer;
  window.closeScheduleModal = closeScheduleDrawer;
  window.renderScheduleModal = renderScheduleDrawer;
  window.handleModalTargetTypeChange = handleModalTargetTypeChange;
  window.handleModalPresetChange = handleModalPresetChange;
  window.handleToggleScheduleEnabled = handleToggleScheduleEnabled;
  window.handleTriggerSchedule = handleTriggerSchedule;
  window.handleDeleteSchedule = handleDeleteSchedule;
  window.handleClearRunHistory = handleClearRunHistory;
  window.handleCronExpressionInput = handleCronExpressionInput;
  window.handleSaveSchedule = handleSaveSchedule;
  window.formatForDateTimeLocal = formatForDateTimeLocal;
  window.loadCronData = loadCronData;
  window.loadCronStats = loadCronStats;
  window.showToast = showToast;
}

if (typeof state !== 'undefined' && state.token && typeof loadCronStats === 'function') {
  loadCronStats();
}
