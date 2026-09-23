// Analytics & Metrics Dashboard View & Chart Engine

let analyticsState = {
  data: null,
  refreshTimer: null,
  autoRefreshEnabled: true,
  refreshIntervalMs: 10000,
};

function renderAnalyticsView() {
  const main = document.getElementById('main-body');
  if (!main) return;

  main.innerHTML = `
    <div class="analytics-container">
      <!-- Top Title and Controls Bar -->
      <div class="analytics-top-header">
        <div class="analytics-header-title">
          <h2>Analytics & Metrics</h2>
          <span class="analytics-status-tag">
            <span class="live-pulse-dot"></span>
            <span>Realtime Active</span>
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <button id="analytics-autorefresh-btn" class="btn btn-secondary btn-sm" onclick="toggleAnalyticsAutoRefresh()">
            <span id="autorefresh-indicator" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981; margin-right:6px;"></span>
            <span id="autorefresh-label">Auto-Refresh: 10s</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="loadAnalytics()" title="Refresh metrics">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
        </div>
      </div>

      <!-- KPI Metrics Cards Row -->
      <div class="analytics-kpi-grid">
        <!-- Card 1: Active Records Count -->
        <div class="analytics-card analytics-card-accent-blue">
          <div class="analytics-card-header">
            <span class="analytics-card-title">Active Records</span>
            <div class="analytics-card-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
            </div>
          </div>
          <div class="analytics-card-value" id="kpi-records-count">
            <span>--</span>
          </div>
          <div class="analytics-card-sub">
            <span id="kpi-collections-count">Across -- collections</span>
            <span class="badge badge-get" style="font-size:10px;">SQLite</span>
          </div>
        </div>

        <!-- Card 2: Database Size on Disk -->
        <div class="analytics-card analytics-card-accent-emerald">
          <div class="analytics-card-header">
            <span class="analytics-card-title">Database Size on Disk</span>
            <div class="analytics-card-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>
            </div>
          </div>
          <div class="analytics-card-value" id="kpi-db-size">
            <span>--</span>
          </div>
          <div class="analytics-card-sub">
            <span id="kpi-db-wal">data.db + WAL</span>
            <span class="badge badge-status-200" style="font-size:10px;">WAL Mode</span>
          </div>
        </div>

        <!-- Card 3: Realtime Connected Clients -->
        <div class="analytics-card analytics-card-accent-purple">
          <div class="analytics-card-header">
            <span class="analytics-card-title">Realtime Clients</span>
            <div class="analytics-card-icon" style="color:#a78bfa;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
          </div>
          <div class="analytics-card-value" id="kpi-realtime-clients">
            <span>--</span>
          </div>
          <div class="analytics-card-sub">
            <span style="display:flex; align-items:center; gap:6px;">
              <span class="live-pulse-dot"></span>
              <span>SSE Listeners</span>
            </span>
            <span class="badge badge-post" style="font-size:10px;">Live Stream</span>
          </div>
        </div>

        <!-- Card 4: 24h Request Volume & Latency -->
        <div class="analytics-card analytics-card-accent-amber">
          <div class="analytics-card-header">
            <span class="analytics-card-title">24h Requests & Errors</span>
            <div class="analytics-card-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </div>
          </div>
          <div class="analytics-card-value" id="kpi-traffic-total">
            <span>--</span>
          </div>
          <div class="analytics-card-sub">
            <span id="kpi-traffic-error-rate">Error Rate: --</span>
            <span id="kpi-traffic-latency" style="color:#93c5fd; font-family:var(--font-mono); font-size:11px;">-- ms avg</span>
          </div>
        </div>
      </div>

      <!-- Charts Section -->
      <div class="analytics-charts-grid">
        <!-- Chart 1: 24h Request Throughput -->
        <div class="chart-panel">
          <div class="chart-panel-header">
            <div class="chart-title-area">
              <h3>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                24-Hour Request Throughput
              </h3>
              <p>Hourly distribution of incoming API traffic and request volume</p>
            </div>
            <div class="chart-summary-stat">
              <div class="stat-num" id="throughput-peak-stat">-- req</div>
              <div class="stat-lbl">Peak Throughput / hr</div>
            </div>
          </div>
          <div class="chart-svg-container" id="throughput-chart-container">
            <div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted);">
              Loading throughput chart...
            </div>
          </div>
          <div class="chart-tooltip" id="throughput-tooltip"></div>
        </div>

        <!-- Chart 2: 24h Error Rate Graph -->
        <div class="chart-panel">
          <div class="chart-panel-header">
            <div class="chart-title-area">
              <h3>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                24-Hour Error Rate & Failed Requests
              </h3>
              <p>Percentage and volume of 4xx client and 5xx server errors</p>
            </div>
            <div class="chart-summary-stat">
              <div class="stat-num" id="error-rate-avg-stat" style="color:#f87171;">--%</div>
              <div class="stat-lbl">24h Error Rate</div>
            </div>
          </div>
          <div class="chart-svg-container" id="error-rate-chart-container">
            <div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted);">
              Loading error rate chart...
            </div>
          </div>
          <div class="chart-tooltip" id="error-rate-tooltip"></div>
        </div>
      </div>

      <!-- Collections Distribution Table -->
      <div class="collections-distribution-panel">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem;">
          <div>
            <h3 style="font-size:15px; font-weight:700; color:#fff;">Collections Storage Breakdown</h3>
            <p style="font-size:12px; color:var(--text-muted); margin-top:2px;">Record distribution across all schema tables</p>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="selectNav('home')">View All Collections ➔</button>
        </div>
        <table class="collections-table">
          <thead>
            <tr>
              <th style="width: 25%;">Collection</th>
              <th style="width: 15%;">Type</th>
              <th style="width: 20%;">Active Records</th>
              <th style="width: 40%;">Share of Database</th>
            </tr>
          </thead>
          <tbody id="analytics-collections-tbody">
            <tr><td colspan="4" style="text-align:center; padding:1.5rem; color:var(--text-muted);">Loading collection breakdown...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function loadAnalytics() {
  try {
    const res = await api('/api/metrics');
    analyticsState.data = res;
    updateAnalyticsUI(res);
  } catch (err) {
    console.error('Failed to load analytics metrics:', err);
    toast('Failed to load analytics metrics: ' + err.message, 'error');
  }
}

function updateAnalyticsUI(data) {
  if (!data) return;

  // 1. Update KPI Card 1: Active Records
  const kpiRecords = document.getElementById('kpi-records-count');
  if (kpiRecords) {
    kpiRecords.innerHTML = `<span>${(data.database?.totalRecords || 0).toLocaleString()}</span>`;
  }
  const kpiCols = document.getElementById('kpi-collections-count');
  if (kpiCols) {
    const colCount = data.database?.collectionsBreakdown?.length || 0;
    kpiCols.textContent = `Across ${colCount} collection${colCount === 1 ? '' : 's'}`;
  }

  // 2. Update KPI Card 2: DB Size
  const kpiDbSize = document.getElementById('kpi-db-size');
  if (kpiDbSize) {
    kpiDbSize.innerHTML = `<span>${data.database?.sizeFormatted || '0 B'}</span>`;
  }
  const kpiDbWal = document.getElementById('kpi-db-wal');
  if (kpiDbWal) {
    const walBytes = data.database?.walSizeBytes || 0;
    if (walBytes > 0) {
      kpiDbWal.textContent = `WAL: ${formatBytesInClient(walBytes)}`;
    } else {
      kpiDbWal.textContent = 'WAL Synchronized';
    }
  }

  // 3. Update KPI Card 3: Realtime Clients
  const kpiClients = document.getElementById('kpi-realtime-clients');
  if (kpiClients) {
    const clientCount = data.realtime?.connectedClients || 0;
    kpiClients.innerHTML = `<span>${clientCount}</span> <span class="unit">connected</span>`;
  }

  // 4. Update KPI Card 4: 24h Traffic & Error Rate
  const kpiTraffic = document.getElementById('kpi-traffic-total');
  if (kpiTraffic) {
    kpiTraffic.innerHTML = `<span>${(data.traffic24h?.totalRequests || 0).toLocaleString()}</span> <span class="unit">requests</span>`;
  }
  const kpiErrorRate = document.getElementById('kpi-traffic-error-rate');
  if (kpiErrorRate) {
    const rate = data.traffic24h?.overallErrorRate || 0;
    const errors = data.traffic24h?.totalErrors || 0;
    let color = '#34d399';
    if (rate > 5) color = '#f87171';
    else if (rate > 1) color = '#fbbf24';
    kpiErrorRate.innerHTML = `Error Rate: <strong style="color:${color};">${rate}%</strong> (${errors} err)`;
  }
  const kpiLatency = document.getElementById('kpi-traffic-latency');
  if (kpiLatency) {
    const avgMs = data.traffic24h?.avgDuration || 0;
    kpiLatency.textContent = `${avgMs} ms avg`;
  }

  // 5. Update Peak Throughput & Error Rate Header Stats
  const peakStat = document.getElementById('throughput-peak-stat');
  if (peakStat) {
    peakStat.textContent = `${(data.traffic24h?.peakHourRequests || 0).toLocaleString()} req`;
  }
  const errorStat = document.getElementById('error-rate-avg-stat');
  if (errorStat) {
    const rate = data.traffic24h?.overallErrorRate || 0;
    errorStat.textContent = `${rate}%`;
    errorStat.style.color = rate > 5 ? '#f87171' : rate > 1 ? '#fbbf24' : '#34d399';
  }

  // 6. Draw Charts
  drawThroughputChart(data.traffic24h?.series || []);
  drawErrorRateChart(data.traffic24h?.series || []);

  // 7. Update Collections Breakdown Table
  const tbody = document.getElementById('analytics-collections-tbody');
  if (tbody) {
    const list = data.database?.collectionsBreakdown || [];
    const total = data.database?.totalRecords || 0;

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1.5rem; color:var(--text-muted);">No collections registered yet.</td></tr>';
    } else {
      tbody.innerHTML = list.map((item) => {
        const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : 0;
        return `
          <tr>
            <td style="font-weight:600; color:#fff;">
              <span style="cursor:pointer;" onclick="selectCollection('${item.collection}')">${item.collection}</span>
            </td>
            <td><span class="collection-badge">${item.type}</span></td>
            <td style="font-family:var(--font-mono); font-weight:600;">${item.count.toLocaleString()}</td>
            <td>
              <div style="display:flex; align-items:center; justify-content:space-between; font-size:11.5px; color:var(--text-muted);">
                <span>${pct}%</span>
                <span>${item.count} / ${total}</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style="width: ${pct}%;"></div>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  }
}

// Chart 1: SVG 24h Request Throughput (Bar & Trend Line Chart)
function drawThroughputChart(series) {
  const container = document.getElementById('throughput-chart-container');
  const tooltip = document.getElementById('throughput-tooltip');
  if (!container || !series || series.length === 0) return;

  const width = 800;
  const height = 200;
  const padLeft = 45;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 30;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxVal = Math.max(5, ...series.map((d) => d.totalRequests));
  const stepX = chartW / series.length;
  const barWidth = Math.max(6, stepX * 0.65);

  // Y-axis grid lines (3 tiers)
  const yTicks = [0, Math.round(maxVal / 2), maxVal];
  const gridLines = yTicks.map((val) => {
    const y = padTop + chartH - (val / maxVal) * chartH;
    return `
      <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3" />
      <text x="${padLeft - 8}" y="${y + 4}" fill="#6b7280" font-size="10" text-anchor="end" font-family="var(--font-mono)">${val}</text>
    `;
  }).join('');

  // Bars and trend points
  const bars = [];
  const points = [];

  series.forEach((d, i) => {
    const x = padLeft + i * stepX + (stepX - barWidth) / 2;
    const barH = (d.totalRequests / maxVal) * chartH;
    const y = padTop + chartH - barH;
    const cx = x + barWidth / 2;
    const cy = y;

    // Bar rect with hover trigger
    bars.push(`
      <rect 
        class="chart-bar-rect" 
        x="${x}" 
        y="${y}" 
        width="${barWidth}" 
        height="${Math.max(2, barH)}" 
        rx="3" 
        fill="url(#blue-bar-grad)" 
        opacity="0.85"
        data-index="${i}"
        style="cursor: pointer; transition: opacity 0.15s ease;"
      />
    `);

    // Only label every 3rd hour on X-axis for clean readability
    if (i % 3 === 0 || i === series.length - 1) {
      bars.push(`
        <text x="${cx}" y="${height - 8}" fill="#9ca3af" font-size="10" text-anchor="middle" font-family="var(--font-mono)">
          ${d.label}
        </text>
      `);
    }

    points.push(`${cx},${cy}`);
  });

  const svgContent = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%; height:100%;">
      <defs>
        <linearGradient id="blue-bar-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#60a5fa" />
          <stop offset="100%" stop-color="#1d4ed8" />
        </linearGradient>
      </defs>
      ${gridLines}
      ${bars.join('')}
      <!-- Baseline -->
      <line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="#374151" stroke-width="1" />
    </svg>
  `;

  container.innerHTML = svgContent;

  // Add Interactive Tooltip Listeners
  const rectEls = container.querySelectorAll('.chart-bar-rect');
  rectEls.forEach((el) => {
    el.addEventListener('mouseenter', (e) => {
      const idx = parseInt(el.getAttribute('data-index'), 10);
      const d = series[idx];
      if (!d || !tooltip) return;

      el.setAttribute('opacity', '1');
      el.setAttribute('stroke', '#93c5fd');
      el.setAttribute('stroke-width', '1.5');

      tooltip.innerHTML = `
        <div class="chart-tooltip-title">${d.hourKey}:00 UTC (${d.label})</div>
        <div class="chart-tooltip-row">
          <span>Total Requests:</span>
          <strong>${d.totalRequests.toLocaleString()}</strong>
        </div>
        <div class="chart-tooltip-row">
          <span>Successes:</span>
          <span style="color:#34d399;">${d.successRequests}</span>
        </div>
        <div class="chart-tooltip-row">
          <span>Errors (>=400):</span>
          <span style="color:#f87171;">${d.errorRequests}</span>
        </div>
        <div class="chart-tooltip-row">
          <span>Avg Latency:</span>
          <span style="color:#60a5fa;">${d.avgDuration} ms</span>
        </div>
      `;

      const rect = el.getBoundingClientRect();
      const parentRect = container.getBoundingClientRect();
      const left = rect.left - parentRect.left + rect.width / 2;
      const top = rect.top - parentRect.top;

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.classList.add('visible');
    });

    el.addEventListener('mouseleave', () => {
      el.setAttribute('opacity', '0.85');
      el.removeAttribute('stroke');
      el.removeAttribute('stroke-width');
      if (tooltip) tooltip.classList.remove('visible');
    });
  });
}

// Chart 2: SVG 24h Error Rate (Smooth Area Line Chart)
function drawErrorRateChart(series) {
  const container = document.getElementById('error-rate-chart-container');
  const tooltip = document.getElementById('error-rate-tooltip');
  if (!container || !series || series.length === 0) return;

  const width = 800;
  const height = 200;
  const padLeft = 45;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 30;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxVal = Math.max(5, ...series.map((d) => d.errorRate));
  const stepX = chartW / (series.length - 1);

  // Y-axis grid lines
  const yTicks = [0, Math.round(maxVal / 2), maxVal];
  const gridLines = yTicks.map((val) => {
    const y = padTop + chartH - (val / maxVal) * chartH;
    return `
      <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3" />
      <text x="${padLeft - 8}" y="${y + 4}" fill="#6b7280" font-size="10" text-anchor="end" font-family="var(--font-mono)">${val}%</text>
    `;
  }).join('');

  // Compute points and path
  const points = [];
  const markers = [];
  const xLabels = [];

  series.forEach((d, i) => {
    const x = padLeft + i * stepX;
    const y = padTop + chartH - (d.errorRate / maxVal) * chartH;
    points.push(`${x},${y}`);

    // Add interactive hover circle marker
    markers.push(`
      <circle 
        class="chart-error-marker"
        cx="${x}" 
        cy="${y}" 
        r="${d.errorRequests > 0 ? 5 : 3}" 
        fill="${d.errorRequests > 0 ? '#ef4444' : '#6b7280'}" 
        stroke="#151821" 
        stroke-width="2" 
        data-index="${i}"
        style="cursor: pointer; transition: r 0.15s ease;"
      />
    `);

    if (i % 3 === 0 || i === series.length - 1) {
      xLabels.push(`
        <text x="${x}" y="${height - 8}" fill="#9ca3af" font-size="10" text-anchor="middle" font-family="var(--font-mono)">
          ${d.label}
        </text>
      `);
    }
  });

  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `M ${padLeft},${padTop + chartH} L ${points.join(' L ')} L ${padLeft + chartW},${padTop + chartH} Z`;

  const svgContent = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%; height:100%;">
      <defs>
        <linearGradient id="red-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(239, 68, 68, 0.45)" />
          <stop offset="100%" stop-color="rgba(239, 68, 68, 0.0)" />
        </linearGradient>
      </defs>
      ${gridLines}
      <path d="${areaPath}" fill="url(#red-area-grad)" />
      <path d="${linePath}" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      ${markers.join('')}
      ${xLabels.join('')}
      <!-- Baseline -->
      <line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="#374151" stroke-width="1" />
    </svg>
  `;

  container.innerHTML = svgContent;

  // Add Hover Listeners for Error Rate markers
  const markerEls = container.querySelectorAll('.chart-error-marker');
  markerEls.forEach((el) => {
    el.addEventListener('mouseenter', () => {
      const idx = parseInt(el.getAttribute('data-index'), 10);
      const d = series[idx];
      if (!d || !tooltip) return;

      el.setAttribute('r', '7');
      el.setAttribute('stroke', '#ffffff');

      tooltip.innerHTML = `
        <div class="chart-tooltip-title">${d.hourKey}:00 UTC (${d.label})</div>
        <div class="chart-tooltip-row">
          <span>Error Rate:</span>
          <strong style="color:${d.errorRate > 0 ? '#f87171' : '#34d399'};">${d.errorRate}%</strong>
        </div>
        <div class="chart-tooltip-row">
          <span>Failed Requests:</span>
          <span style="color:#f87171;">${d.errorRequests}</span>
        </div>
        <div class="chart-tooltip-row">
          <span>Total Requests:</span>
          <span>${d.totalRequests}</span>
        </div>
      `;

      const rect = el.getBoundingClientRect();
      const parentRect = container.getBoundingClientRect();
      const left = rect.left - parentRect.left + rect.width / 2;
      const top = rect.top - parentRect.top;

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.classList.add('visible');
    });

    el.addEventListener('mouseleave', () => {
      const idx = parseInt(el.getAttribute('data-index'), 10);
      const d = series[idx];
      el.setAttribute('r', d && d.errorRequests > 0 ? '5' : '3');
      el.setAttribute('stroke', '#151821');
      if (tooltip) tooltip.classList.remove('visible');
    });
  });
}

function toggleAnalyticsAutoRefresh() {
  analyticsState.autoRefreshEnabled = !analyticsState.autoRefreshEnabled;
  const ind = document.getElementById('autorefresh-indicator');
  const lbl = document.getElementById('autorefresh-label');

  if (analyticsState.autoRefreshEnabled) {
    if (ind) ind.style.background = '#10b981';
    if (lbl) lbl.textContent = 'Auto-Refresh: 10s';
    startAnalyticsAutoRefresh();
    toast('Auto-refresh enabled (10s)', 'info');
  } else {
    if (ind) ind.style.background = '#6b7280';
    if (lbl) lbl.textContent = 'Auto-Refresh: Paused';
    stopAnalyticsAutoRefresh();
    toast('Auto-refresh paused', 'info');
  }
}

function startAnalyticsAutoRefresh() {
  stopAnalyticsAutoRefresh();
  analyticsState.refreshTimer = setInterval(() => {
    if (state.activeNav === 'analytics') {
      loadAnalytics();
    }
  }, analyticsState.refreshIntervalMs);
}

function stopAnalyticsAutoRefresh() {
  if (analyticsState.refreshTimer) {
    clearInterval(analyticsState.refreshTimer);
    analyticsState.refreshTimer = null;
  }
}

function formatBytesInClient(bytes) {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
