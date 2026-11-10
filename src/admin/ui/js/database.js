// Database Engine Configuration & Switcher (SQLite, PostgreSQL, SQL Server)

let databaseState = {
  status: null,
  loading: false,
  selectedProvider: null,
  configMode: 'url', // 'url' or 'params'
  testResult: null,
  isTesting: false,
  isSwitching: false,
  showConfirmSwitch: false,
  migrateData: true,
  confirmText: '',
  migrationProgress: null,
  migrationInterval: null,
};

async function fetchDatabaseStatus(forceResetProvider = false) {
  try {
    const slug = (typeof state !== 'undefined' && state?.activeApp?.slug) ? state.activeApp.slug : 'default';
    const res = await api(`/api/system/database/status?app=${encodeURIComponent(slug)}`);
    if (res && res.provider) {
      const isDifferentApp = databaseState.status?.appSlug && databaseState.status.appSlug !== res.appSlug;
      databaseState.status = res;
      if (forceResetProvider || isDifferentApp || !databaseState.selectedProvider) {
        databaseState.selectedProvider = (res.provider || 'sqlite').toLowerCase();
        databaseState.showConfirmSwitch = false;
        databaseState.confirmText = '';
        databaseState.testResult = null;
      }
      updateDatabaseStatusUI(res);
    }
    return res;
  } catch (err) {
    console.warn('Failed to fetch database status:', err);
    return null;
  }
}

function updateDatabaseStatusUI(status) {
  if (!status) return;
  const provider = (status.provider || 'sqlite').toLowerCase();
  const labelMap = {
    sqlite: 'SQLite',
    postgres: 'PostgreSQL',
    mssql: 'SQL Server',
  };
  const providerLabel = labelMap[provider] || provider.toUpperCase();

  // Top Bar button label
  const topLabel = document.getElementById('topbar-database-label');
  if (topLabel) {
    topLabel.textContent = `Database: ${providerLabel}`;
  }

  // Sidebar badge
  const sidebarBadge = document.getElementById('sidebar-database-badge');
  if (sidebarBadge) {
    sidebarBadge.textContent = providerLabel;
    if (provider === 'sqlite') {
      sidebarBadge.className = 'badge badge-primary';
    } else if (provider === 'postgres') {
      sidebarBadge.className = 'badge badge-success';
    } else {
      sidebarBadge.className = 'badge badge-warning';
    }
  }

  // Home view header badge
  const homeBadge = document.getElementById('home-status-db-label');
  if (homeBadge) {
    homeBadge.textContent = `DB: ${providerLabel}`;
  }
  const homeKpi = document.getElementById('home-kpi-db-engine');
  if (homeKpi) {
    homeKpi.textContent = providerLabel;
  }
}

function renderDatabaseUI() {
  if (typeof state !== 'undefined' && state.activeNav === 'database' && typeof renderDatabaseView === 'function') {
    renderDatabaseView();
  }
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot && modalRoot.innerHTML.trim() !== '') {
    renderDatabaseModal();
  }
}

function openDatabaseModal(providerToSelect) {
  if (providerToSelect) {
    databaseState.selectedProvider = providerToSelect;
  } else if (databaseState.status?.provider) {
    databaseState.selectedProvider = databaseState.status.provider.toLowerCase();
  } else {
    databaseState.selectedProvider = null;
  }

  databaseState.testResult = null;
  databaseState.showConfirmSwitch = false;
  databaseState.isSwitching = false;

  if (typeof selectNav === 'function') {
    selectNav('database');
    return;
  }

  if (typeof closeModal === 'function') closeModal();
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return;

  renderDatabaseModal();

  fetchDatabaseStatus().then(() => {
    renderDatabaseModal();
  });
}

function closeDatabaseModal() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) {
    modalRoot.innerHTML = '';
  }
  databaseState.testResult = null;
  databaseState.showConfirmSwitch = false;
  databaseState.isSwitching = false;
}

function setDatabaseProviderTab(provider) {
  try { getEnteredDatabaseConfig(); } catch {}
  databaseState.selectedProvider = provider;
  databaseState.testResult = null;
  databaseState.showConfirmSwitch = false;
  renderDatabaseUI();
}

function setDatabaseConfigMode(mode) {
  try { getEnteredDatabaseConfig(); } catch {}
  databaseState.configMode = mode;
  databaseState.testResult = null;
  renderDatabaseUI();
}

function renderDatabaseView() {
  const container = document.getElementById('page-view-database') || document.getElementById('main-body');
  if (!container) return;

  const currentAppSlug = (typeof state !== 'undefined' && state?.activeApp?.slug) ? state.activeApp.slug : 'default';

  // If status is not yet loaded or belongs to a different application, trigger a refresh
  if (!databaseState.status || (databaseState.status.appSlug && databaseState.status.appSlug !== currentAppSlug)) {
    if (!databaseState.isLoadingStatus) {
      databaseState.isLoadingStatus = true;
      fetchDatabaseStatus(true).then(() => {
        databaseState.isLoadingStatus = false;
        if (state.activeNav === 'database') {
          renderDatabaseView();
        }
      }).catch(() => {
        databaseState.isLoadingStatus = false;
      });
    }
  }

  const status = databaseState.status || {
    provider: 'sqlite',
    connected: true,
    latencyMs: 1,
    availableProviders: ['sqlite', 'postgres', 'mssql'],
    appSlug: currentAppSlug,
  };

  const activeProvider = (status.provider || 'sqlite').toLowerCase();
  const selected = (databaseState.selectedProvider || activeProvider).toLowerCase();
  const isSelectedActive = selected === activeProvider;

  const labelMap = {
    sqlite: 'SQLite (Embedded)',
    postgres: 'PostgreSQL',
    mssql: 'Microsoft SQL Server',
  };

  container.innerHTML = `
    <div style="width: 100%; max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; padding-bottom: 2.5rem;">
      
      <!-- Top Overview Banner -->
      <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 1.25rem 1.75rem; display: flex; flex-direction: column; gap: 1rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="width: 44px; height: 44px; border-radius: 10px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-primary);">
                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
              </svg>
            </div>
            <div>
              <h2 style="font-size: 18px; font-weight: 800; color: var(--text-heading); margin: 0; letter-spacing: -0.01em;">
                Database Engine
              </h2>
              <p style="font-size: 12px; color: var(--text-muted); margin: 3px 0 0 0; line-height: 1.4;">
                Application: <strong style="color: var(--accent-primary); font-family: var(--font-mono); font-size: 12px;">${state.activeApp?.name || 'Default App'} (${state.activeApp?.slug || 'default'})</strong> • Configure storage engines and zero-downtime migrations.
              </p>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="fetchDatabaseStatus().then(() => renderDatabaseView())" style="display: flex; align-items: center; gap: 6px; padding: 6px 12px;">
              <span>↻</span><span>Refresh Status</span>
            </button>
          </div>
        </div>

        <!-- Telemetry & Status Strip -->
        <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 0.9rem 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
          <div>
            <div style="font-size: 10.5px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.06em;">Active Storage Engine</div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
              <span style="font-size: 17px; font-weight: 800; color: var(--text-heading);">${labelMap[activeProvider] || activeProvider}</span>
              <span class="badge ${status.connected ? 'badge-success' : 'badge-danger'}" style="font-size: 10.5px; padding: 2px 8px;">
                ${status.connected ? '● Connected' : '✕ Disconnected'}
              </span>
              ${status.latencyMs !== undefined ? `<span style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono); font-weight: 600;">(${status.latencyMs}ms latency)</span>` : ''}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap; font-size: 12px; color: var(--text-muted);">
            <div>Tenant Isolation: <strong style="color: var(--text-heading); font-family: var(--font-mono);">app_&lt;slug&gt; schema</strong></div>
            <div>Control Plane: <strong style="color: var(--text-heading);">Encrypted AES-256</strong></div>
            <div>Driver: <strong style="color: var(--text-heading); text-transform: capitalize;">${activeProvider}</strong></div>
          </div>
        </div>
      </div>

      <!-- Engine Selector Cards -->
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <label style="font-weight: 700; font-size: 13px; color: var(--text-heading); text-transform: uppercase; letter-spacing: 0.04em;">
            Select Database Engine
          </label>
          <span style="font-size: 11.5px; color: var(--text-muted);">Click an engine card to view credentials & clustering configuration</span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 1rem;">
          
          <!-- SQLite Card -->
          <div onclick="setDatabaseProviderTab('sqlite')" 
               style="background: ${selected === 'sqlite' ? 'rgba(59, 130, 246, 0.06)' : 'var(--bg-card)'}; border: 2px solid ${selected === 'sqlite' ? 'var(--accent-primary)' : 'var(--border-subtle)'}; border-radius: 10px; padding: 1.25rem; cursor: pointer; transition: all 0.15s ease; display: flex; flex-direction: column; justify-content: space-between; gap: 0.85rem;">
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 24px;">🪶</span>
                  <span style="font-size: 16px; font-weight: 800; color: var(--text-heading);">SQLite</span>
                </div>
                ${activeProvider === 'sqlite' ? '<span class="badge badge-success" style="font-size: 10px; padding: 2px 7px;">ACTIVE</span>' : ''}
              </div>
              <div style="font-size: 11.5px; font-weight: 600; color: var(--accent-primary); margin-bottom: 4px;">Embedded / Single-File</div>
              <p style="font-size: 12px; color: var(--text-muted); line-height: 1.45; margin: 0;">
                Zero-setup embedded database powered by Node.js native <code>node:sqlite</code>. High-speed local disk storage with WAL journaling.
              </p>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span class="badge" style="font-size: 10px; padding: 2px 7px;">Zero Config</span>
              <span class="badge" style="font-size: 10px; padding: 2px 7px;">WAL Mode</span>
              <span class="badge" style="font-size: 10px; padding: 2px 7px;">Local File</span>
            </div>
          </div>

          <!-- PostgreSQL Card -->
          <div onclick="setDatabaseProviderTab('postgres')" 
               style="background: ${selected === 'postgres' ? 'rgba(59, 130, 246, 0.06)' : 'var(--bg-card)'}; border: 2px solid ${selected === 'postgres' ? 'var(--accent-primary)' : 'var(--border-subtle)'}; border-radius: 10px; padding: 1.25rem; cursor: pointer; transition: all 0.15s ease; display: flex; flex-direction: column; justify-content: space-between; gap: 0.85rem;">
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 24px;">🐘</span>
                  <span style="font-size: 16px; font-weight: 800; color: var(--text-heading);">PostgreSQL</span>
                </div>
                ${activeProvider === 'postgres' ? '<span class="badge badge-success" style="font-size: 10px; padding: 2px 7px;">ACTIVE</span>' : ''}
              </div>
              <div style="font-size: 11.5px; font-weight: 600; color: var(--accent-primary); margin-bottom: 4px;">Multi-Cluster / HA Replicas</div>
              <p style="font-size: 12px; color: var(--text-muted); line-height: 1.45; margin: 0;">
                Enterprise-grade ACID SQL engine. Features schema-isolated multi-tenancy, built-in connection pooling, and horizontal read replicas.
              </p>
            </div>
            <div style="display: flex; align-items: gap: 6px; flex-wrap: wrap;">
              <span class="badge" style="font-size: 10px; padding: 2px 7px;">Connection Pool</span>
              <span class="badge" style="font-size: 10px; padding: 2px 7px;">HA Replicas</span>
              <span class="badge" style="font-size: 10px; padding: 2px 7px;">Multi-Tenant Schemas</span>
            </div>
          </div>

          <!-- SQL Server Card -->
          <div onclick="setDatabaseProviderTab('mssql')" 
               style="background: ${selected === 'mssql' ? 'rgba(59, 130, 246, 0.06)' : 'var(--bg-card)'}; border: 2px solid ${selected === 'mssql' ? 'var(--accent-primary)' : 'var(--border-subtle)'}; border-radius: 10px; padding: 1.25rem; cursor: pointer; transition: all 0.15s ease; display: flex; flex-direction: column; justify-content: space-between; gap: 0.85rem;">
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 24px;">🏢</span>
                  <span style="font-size: 16px; font-weight: 800; color: var(--text-heading);">SQL Server</span>
                </div>
                ${activeProvider === 'mssql' ? '<span class="badge badge-success" style="font-size: 10px; padding: 2px 7px;">ACTIVE</span>' : ''}
              </div>
              <div style="font-size: 11.5px; font-weight: 600; color: var(--accent-primary); margin-bottom: 4px;">Enterprise / Azure SQL</div>
              <p style="font-size: 12px; color: var(--text-muted); line-height: 1.45; margin: 0;">
                Microsoft SQL Server for enterprise environments and Azure Cloud. TDS protocol support, encrypted TLS connections, and HA clustering.
              </p>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span class="badge" style="font-size: 10px; padding: 2px 7px;">Azure SQL</span>
              <span class="badge" style="font-size: 10px; padding: 2px 7px;">TDS Protocol</span>
              <span class="badge" style="font-size: 10px; padding: 2px 7px;">Enterprise HA</span>
            </div>
          </div>

        </div>
      </div>

      <!-- Provider Configuration Card -->
      <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem;">
        ${databaseState.showConfirmSwitch ? renderConfirmSwitchStep(activeProvider, selected) : `
          ${renderProviderFields(selected)}
          ${renderTestResultBanner()}
          
          <!-- Actions Footer -->
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; margin-top: 0.5rem; padding-top: 1rem; border-top: 1px solid var(--border-subtle);">
            <div style="font-size: 12px; color: var(--text-muted);">
              ${isSelectedActive ? '✓ This database engine is currently running your live applications.' : 'Test connectivity before switching.'}
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              ${selected !== 'sqlite' ? `
                <button type="button" class="btn btn-secondary btn-sm" onclick="handleTestConnectionClick()" ${databaseState.isTesting ? 'disabled' : ''} style="display: flex; align-items: center; gap: 6px; padding: 7px 14px; font-weight: 600;">
                  <span>🔌</span>
                  <span>${databaseState.isTesting ? 'Testing connection...' : 'Test Connection'}</span>
                </button>
              ` : ''}

              ${!isSelectedActive ? `
                <button type="button" class="btn btn-primary btn-sm" onclick="proceedToSwitchConfirm()" style="display: flex; align-items: center; gap: 6px; padding: 7px 16px; font-weight: 700;">
                  <span>Switch to ${selected === 'sqlite' ? 'SQLite' : selected === 'postgres' ? 'PostgreSQL' : 'SQL Server'}</span>
                  <span>➔</span>
                </button>
              ` : `
                <button type="button" class="btn btn-secondary btn-sm" disabled style="opacity: 0.6; padding: 7px 14px; font-weight: 600;">
                  Active Engine
                </button>
              `}
            </div>
          </div>
        `}
      </div>

    </div>
  `;
}

function renderDatabaseModal() {
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return;

  const status = databaseState.status || {
    provider: 'sqlite',
    connected: true,
    latencyMs: 1,
    availableProviders: ['sqlite', 'postgres', 'mssql'],
  };

  const activeProvider = (status.provider || 'sqlite').toLowerCase();
  const selected = (databaseState.selectedProvider || activeProvider).toLowerCase();
  const isSelectedActive = selected === activeProvider;

  const labelMap = {
    sqlite: 'SQLite (Embedded)',
    postgres: 'PostgreSQL',
    mssql: 'Microsoft SQL Server',
  };

  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeDatabaseModal()">
      <div class="modal modal-lg" style="max-width: 680px; width: 95%;">
        
        <!-- Header -->
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 32px; height: 32px; border-radius: 8px; background: var(--bg-main); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: center;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-primary);">
                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
              </svg>
            </div>
            <div>
              <h2 class="modal-title" style="margin: 0; font-size: 16px;">Database Engine Configuration</h2>
              <p style="font-size: 11.5px; color: var(--text-muted); margin: 2px 0 0 0;">
                Connect NodeStack to SQLite, PostgreSQL, or SQL Server. System settings remain protected in control plane.
              </p>
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="closeDatabaseModal()" title="Close">✕</button>
        </div>

        <!-- Body -->
        <div class="modal-body" style="padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
          
          <!-- Current Active DB Strip -->
          <div style="background: var(--bg-card-hover); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1.15rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
            <div>
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Currently Active Engine</div>
              <div style="display: flex; align-items: center; gap: 8px; margin-top: 3px;">
                <span style="font-size: 15px; font-weight: 800; color: var(--text-heading);">${labelMap[activeProvider] || activeProvider}</span>
                <span class="badge ${status.connected ? 'badge-success' : 'badge-danger'}" style="font-size: 10.5px; padding: 2px 7px;">
                  ${status.connected ? '● Connected' : '✕ Disconnected'}
                </span>
                ${status.latencyMs !== undefined ? `<span style="font-size: 11.5px; color: var(--text-muted);">(${status.latencyMs}ms latency)</span>` : ''}
              </div>
            </div>
            <div style="font-size: 11.5px; color: var(--text-muted); text-align: right;">
              <div>Control Plane: <strong>Encrypted AES-256</strong></div>
              <div>Data Isolation: <strong>Multi-Tenant Schemas</strong></div>
            </div>
          </div>

          ${databaseState.showConfirmSwitch ? renderConfirmSwitchStep(activeProvider, selected) : renderConfigFormStep(activeProvider, selected, isSelectedActive)}

        </div>

      </div>
    </div>
  `;
}

function renderConfigFormStep(activeProvider, selected, isSelectedActive) {
  return `
    <!-- Provider Selector Tabs -->
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <label class="form-label" style="font-weight: 700; font-size: 12px;">Select Database Engine</label>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
        
        <!-- SQLite -->
        <button type="button" 
          onclick="setDatabaseProviderTab('sqlite')"
          style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 8px; border-radius: 8px; border: 2px solid ${selected === 'sqlite' ? 'var(--accent-primary)' : 'var(--border-subtle)'}; background: ${selected === 'sqlite' ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-input)'}; cursor: pointer; transition: all 0.15s ease;">
          <span style="font-size: 18px; margin-bottom: 2px;">🪶</span>
          <span style="font-weight: 700; font-size: 12.5px; color: var(--text-heading);">SQLite</span>
          <span style="font-size: 10.5px; color: var(--text-muted);">Embedded / File</span>
        </button>

        <!-- PostgreSQL -->
        <button type="button" 
          onclick="setDatabaseProviderTab('postgres')"
          style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 8px; border-radius: 8px; border: 2px solid ${selected === 'postgres' ? 'var(--accent-primary)' : 'var(--border-subtle)'}; background: ${selected === 'postgres' ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-input)'}; cursor: pointer; transition: all 0.15s ease;">
          <span style="font-size: 18px; margin-bottom: 2px;">🐘</span>
          <span style="font-weight: 700; font-size: 12.5px; color: var(--text-heading);">PostgreSQL</span>
          <span style="font-size: 10.5px; color: var(--text-muted);">Multi-Cluster / HA</span>
        </button>

        <!-- Microsoft SQL Server -->
        <button type="button" 
          onclick="setDatabaseProviderTab('mssql')"
          style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 8px; border-radius: 8px; border: 2px solid ${selected === 'mssql' ? 'var(--accent-primary)' : 'var(--border-subtle)'}; background: ${selected === 'mssql' ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-input)'}; cursor: pointer; transition: all 0.15s ease;">
          <span style="font-size: 18px; margin-bottom: 2px;">🏢</span>
          <span style="font-weight: 700; font-size: 12.5px; color: var(--text-heading);">SQL Server</span>
          <span style="font-size: 10.5px; color: var(--text-muted);">Enterprise / Azure</span>
        </button>

      </div>
    </div>

    <!-- Provider Configuration Body -->
    <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.15rem; display: flex; flex-direction: column; gap: 0.85rem;">
      ${renderProviderFields(selected)}
    </div>

    <!-- Test Result Banner (if tested) -->
    ${renderTestResultBanner()}

    <!-- Action Buttons -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 0.5rem; pt: 0.5rem; border-top: 1px solid var(--border-subtle); padding-top: 0.85rem;">
      <div style="font-size: 11.5px; color: var(--text-muted);">
        ${isSelectedActive ? '✓ This database is currently active.' : 'Test connectivity before switching.'}
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        ${selected !== 'sqlite' ? `
          <button type="button" class="btn btn-secondary btn-sm" onclick="handleTestConnectionClick()" ${databaseState.isTesting ? 'disabled' : ''}>
            ${databaseState.isTesting ? 'Testing connection...' : '🔌 Test Connection'}
          </button>
        ` : ''}

        ${!isSelectedActive ? `
          <button type="button" class="btn btn-primary btn-sm" onclick="proceedToSwitchConfirm()" style="font-weight: 700;">
            Switch to ${selected === 'sqlite' ? 'SQLite' : selected === 'postgres' ? 'PostgreSQL' : 'SQL Server'} ➔
          </button>
        ` : `
          <button type="button" class="btn btn-secondary btn-sm" disabled style="opacity: 0.6;">
            Active Engine
          </button>
        `}
      </div>
    </div>
  `;
}

function renderProviderFields(selected) {
  if (selected === 'sqlite') {
    return `
      <div style="display: flex; align-items: flex-start; gap: 10px;">
        <span style="font-size: 20px;">📁</span>
        <div>
          <div style="font-weight: 700; font-size: 13px; color: var(--text-heading);">Embedded SQLite Engine</div>
          <p style="font-size: 12px; color: var(--text-muted); margin: 3px 0 0 0; line-height: 1.45;">
            Local zero-configuration engine. Uses Node.js native <code>node:sqlite</code> module.
            Each application runs in an isolated database file under <code>apps/&lt;slug&gt;/data.db</code>.
          </p>
        </div>
      </div>
    `;
  }

  const isUrlMode = databaseState.configMode === 'url';

  return `
    <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.65rem;">
      <div style="font-weight: 700; font-size: 12.5px; color: var(--text-heading);">
        ${selected === 'postgres' ? 'PostgreSQL Credentials' : 'SQL Server (MSSQL) Credentials'}
      </div>
      <div style="display: flex; align-items: center; gap: 4px; background: var(--bg-input); padding: 2px; border-radius: 6px; border: 1px solid var(--border-subtle);">
        <button type="button" onclick="setDatabaseConfigMode('url')" style="padding: 3px 8px; font-size: 11px; font-weight: 600; border-radius: 4px; border: none; background: ${isUrlMode ? 'var(--accent-primary)' : 'transparent'}; color: ${isUrlMode ? '#fff' : 'var(--text-muted)'}; cursor: pointer;">
          Connection URI
        </button>
        <button type="button" onclick="setDatabaseConfigMode('params')" style="padding: 3px 8px; font-size: 11px; font-weight: 600; border-radius: 4px; border: none; background: ${!isUrlMode ? 'var(--accent-primary)' : 'transparent'}; color: ${!isUrlMode ? '#fff' : 'var(--text-muted)'}; cursor: pointer;">
          Parameters
        </button>
      </div>
    </div>

    ${isUrlMode ? renderUrlInputs(selected) : renderParameterInputs(selected)}

    <!-- Optional Read Replicas for HA Multi-Cluster -->
    <div style="border-top: 1px solid var(--border-subtle); padding-top: 0.75rem; margin-top: 0.25rem; display: flex; flex-direction: column; gap: 0.4rem;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <label class="form-label" for="db-field-replicas" style="font-size: 11.5px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 6px;">
          <span>Read Replicas (Optional — HA Multi-Cluster)</span>
          <span class="badge badge-primary" style="font-size: 9.5px; padding: 1px 5px;">Load Balanced</span>
        </label>
      </div>
      <textarea 
        id="db-field-replicas" 
        class="form-input" 
        rows="2" 
        placeholder="${selected === 'postgres' ? 'postgresql://user:secret@replica-1.db:5432/nodestack\npostgresql://user:secret@replica-2.db:5432/nodestack' : 'Server=replica-1.db,1433;Database=nodestack;User Id=sa;Password=Secret123!\nServer=replica-2.db,1433;Database=nodestack;User Id=sa;Password=Secret123!'}"
        style="font-family: var(--font-mono, monospace); font-size: 11.5px; resize: vertical;"
      >${(databaseState.enteredReplicas !== undefined ? databaseState.enteredReplicas : (databaseState.status?.config?.readReplicas || []).join('\n'))}</textarea>
      <span style="font-size: 10.5px; color: var(--text-muted); line-height: 1.4;">
        Enter replica connection URIs (one per line). Read requests (<code>find</code>, <code>records</code>, <code>list</code>) will be load-balanced across replicas, while all writes and transactions execute on the primary.
      </span>
    </div>

    <div style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; margin-top: 4px;">
      <span style="color: var(--accent-primary);">ℹ</span>
      <span>NodeStack automatically isolates individual apps into schemas (<code>app_&lt;slug&gt;</code>) within the same database.</span>
    </div>
  `;
}

function renderUrlInputs(selected) {
  const currentVal = databaseState.enteredUrl !== undefined
    ? databaseState.enteredUrl
    : (databaseState.status?.config?.connectionString || '');

  if (selected === 'postgres') {
    return `
      <div class="form-group" style="margin: 0;">
        <label class="form-label" for="db-field-url" style="font-size: 11.5px;">PostgreSQL Connection URL *</label>
        <input 
          type="text" 
          id="db-field-url" 
          class="form-input" 
          value="${escapeDbHtml(currentVal)}"
          placeholder="postgresql://postgres:postgres@localhost:5432/nodestack?sslmode=disable"
          style="font-family: var(--font-mono, monospace); font-size: 12px;"
        />
        <span style="font-size: 10.5px; color: var(--text-muted);">Format: <code>postgresql://[user]:[password]@[host]:[port]/[database]?sslmode=[mode]</code></span>
      </div>
    `;
  } else {
    return `
      <div class="form-group" style="margin: 0;">
        <label class="form-label" for="db-field-url" style="font-size: 11.5px;">SQL Server Connection String *</label>
        <input 
          type="text" 
          id="db-field-url" 
          class="form-input" 
          value="${escapeDbHtml(currentVal)}"
          placeholder="Server=localhost,1433;Database=nodestack;User Id=sa;Password=Secret123!;TrustServerCertificate=true"
          style="font-family: var(--font-mono, monospace); font-size: 12px;"
        />
        <span style="font-size: 10.5px; color: var(--text-muted);">Standard ADO.NET connection string or mssql connection URI.</span>
      </div>
    `;
  }
}

function renderParameterInputs(selected) {
  const isPg = selected === 'postgres';
  const cfg = databaseState.status?.config || {};
  const currentHost = databaseState.enteredHost !== undefined ? databaseState.enteredHost : (cfg.host || '');
  const currentPort = databaseState.enteredPort !== undefined ? databaseState.enteredPort : (cfg.port || '');
  const currentDb = databaseState.enteredDatabase !== undefined ? databaseState.enteredDatabase : (cfg.database || '');
  const currentUser = databaseState.enteredUser !== undefined ? databaseState.enteredUser : (cfg.user || '');
  const currentPass = databaseState.enteredPassword !== undefined ? databaseState.enteredPassword : '';
  const currentSsl = databaseState.enteredSsl !== undefined ? databaseState.enteredSsl : Boolean(cfg.ssl);
  const currentTrustCert = databaseState.enteredTrustCert !== undefined ? databaseState.enteredTrustCert : true;

  return `
    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 8px;">
      <div class="form-group" style="margin: 0;">
        <label class="form-label" for="db-field-host" style="font-size: 11.5px;">${isPg ? 'Host' : 'Server Host'} *</label>
        <input type="text" id="db-field-host" class="form-input" value="${escapeDbHtml(currentHost)}" placeholder="localhost" style="font-size: 12px;" />
      </div>
      <div class="form-group" style="margin: 0;">
        <label class="form-label" for="db-field-port" style="font-size: 11.5px;">Port</label>
        <input type="number" id="db-field-port" class="form-input" value="${currentPort ? escapeDbHtml(currentPort) : ''}" placeholder="${isPg ? '5432' : '1433'}" style="font-size: 12px;" />
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      <div class="form-group" style="margin: 0;">
        <label class="form-label" for="db-field-database" style="font-size: 11.5px;">Database Name *</label>
        <input type="text" id="db-field-database" class="form-input" value="${escapeDbHtml(currentDb)}" placeholder="nodestack" style="font-size: 12px;" />
      </div>
      <div class="form-group" style="margin: 0;">
        <label class="form-label" for="db-field-user" style="font-size: 11.5px;">Username *</label>
        <input type="text" id="db-field-user" class="form-input" value="${escapeDbHtml(currentUser)}" placeholder="${isPg ? 'postgres' : 'sa'}" style="font-size: 12px;" />
      </div>
    </div>

    <div class="form-group" style="margin: 0;">
      <label class="form-label" for="db-field-password" style="font-size: 11.5px;">Password *</label>
      <input type="password" id="db-field-password" class="form-input" value="${escapeDbHtml(currentPass)}" placeholder="••••••••" style="font-size: 12px;" />
    </div>

    <div style="display: flex; align-items: center; gap: 1rem; margin-top: 2px;">
      ${isPg ? `
        <label style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; cursor: pointer;">
          <input type="checkbox" id="db-field-ssl" ${currentSsl ? 'checked' : ''} />
          <span>Enable SSL Connection</span>
        </label>
      ` : `
        <label style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; cursor: pointer;">
          <input type="checkbox" id="db-field-trust-cert" ${currentTrustCert ? 'checked' : ''} />
          <span>Trust Server Certificate</span>
        </label>
      `}
    </div>
  `;
}

function escapeDbHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderTestResultBanner() {
  const result = databaseState.testResult;
  if (!result) return '';

  const renderReplicaDetails = () => {
    if (!result.replicas || result.replicas.length === 0) return '';
    return `
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.15); display: flex; flex-direction: column; gap: 4px;">
        <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.9;">
          HA Read Replicas Verification (${result.replicas.length}):
        </div>
        ${result.replicas.map((r, i) => `
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; padding: 2px 0;">
            <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <span style="color: ${r.ok ? '#10b981' : '#ef4444'}; font-weight: 700;">${r.ok ? '✓' : '✗'}</span>
              <span style="font-family: var(--font-mono, monospace); font-size: 11px;">Replica ${i + 1}: ${escapeDbHtml(r.url)}</span>
            </div>
            <span style="font-size: 10.5px; opacity: 0.85; margin-left: 8px;">
              ${r.ok ? `${r.latencyMs}ms latency` : `<span style="color: #ef4444;">${escapeDbHtml(r.error || 'Failed')}</span>`}
            </span>
          </div>
        `).join('')}
      </div>
    `;
  };

  if (result.ok) {
    return `
      <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; border-radius: 6px; padding: 10px 14px; color: #10b981; display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 16px;">✓</span>
          <div style="font-size: 12px;">
            <strong>Primary Connection Successful!</strong> Latency: ${result.latencyMs}ms${result.version ? ' • Version: ' + escapeDbHtml(result.version) : ''}
            <div style="font-size: 11px; opacity: 0.9; margin-top: 2px;">Primary schema & table creation privileges verified successfully.</div>
          </div>
        </div>
        ${renderReplicaDetails()}
      </div>
    `;
  } else {
    return `
      <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 6px; padding: 10px 14px; color: #ef4444; display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; align-items: flex-start; gap: 10px;">
          <span style="font-size: 16px; line-height: 1;">⚠</span>
          <div style="font-size: 12px;">
            <strong>Connection Failed</strong>
            <div style="font-size: 11.5px; margin-top: 2px; word-break: break-all;">${escapeDbHtml(result.error || 'Could not connect to target database.')}</div>
          </div>
        </div>
        ${renderReplicaDetails()}
      </div>
    `;
  }
}

function getEnteredDatabaseConfig() {
  const activeProvider = (databaseState.status?.provider || 'sqlite').toLowerCase();
  const provider = (databaseState.selectedProvider || activeProvider).toLowerCase();
  if (provider === 'sqlite') {
    return { provider: 'sqlite' };
  }

  const isUrlMode = databaseState.configMode === 'url';
  let config = {};
  if (isUrlMode) {
    const urlEl = document.getElementById('db-field-url');
    const url = urlEl ? urlEl.value.trim() : (databaseState.enteredUrl || '');
    databaseState.enteredUrl = url;
    config = {
      provider,
      connectionString: url,
    };
  } else {
    const hostEl = document.getElementById('db-field-host');
    const host = hostEl ? hostEl.value.trim() : (databaseState.enteredHost || '');
    const portEl = document.getElementById('db-field-port');
    const port = parseInt(portEl?.value?.trim() || String(databaseState.enteredPort || '0'), 10);
    const dbEl = document.getElementById('db-field-database');
    const database = dbEl ? dbEl.value.trim() : (databaseState.enteredDatabase || '');
    const userEl = document.getElementById('db-field-user');
    const user = userEl ? userEl.value.trim() : (databaseState.enteredUser || '');
    const passEl = document.getElementById('db-field-password');
    const password = passEl ? passEl.value : (databaseState.enteredPassword || '');
    const sslEl = document.getElementById('db-field-ssl');
    const ssl = sslEl ? Boolean(sslEl.checked) : Boolean(databaseState.enteredSsl);
    const trustCertEl = document.getElementById('db-field-trust-cert');
    const trustServerCertificate = trustCertEl ? Boolean(trustCertEl.checked) : (databaseState.enteredTrustCert !== undefined ? databaseState.enteredTrustCert : true);

    databaseState.enteredHost = host;
    databaseState.enteredPort = port > 0 ? port : undefined;
    databaseState.enteredDatabase = database;
    databaseState.enteredUser = user;
    databaseState.enteredPassword = password;
    databaseState.enteredSsl = ssl;
    databaseState.enteredTrustCert = trustServerCertificate;

    config = {
      provider,
      host,
      port: port > 0 ? port : undefined,
      database,
      user,
      password,
      ssl: ssl ? true : undefined,
      options: {
        trustServerCertificate,
      },
    };
  }

  // Extract optional read replicas
  const replicasEl = document.getElementById('db-field-replicas');
  if (replicasEl) {
    databaseState.enteredReplicas = replicasEl.value;
    const readReplicas = replicasEl.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (readReplicas.length > 0) {
      config.readReplicas = readReplicas;
    }
  }

  return config;
}

async function handleTestConnectionClick() {
  const config = getEnteredDatabaseConfig();
  if (config.provider !== 'sqlite' && !config.connectionString && !config.host && !config.database) {
    if (typeof toast === 'function') toast('Please enter a connection URL or host credentials', 'warning');
    return;
  }

  databaseState.isTesting = true;
  databaseState.testResult = null;
  renderDatabaseUI();

  try {
    const res = await api('/api/system/database/test', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    databaseState.testResult = res;
    if (typeof toast === 'function') {
      if (res.ok) {
        toast(`Database connection verified! (${res.latencyMs}ms)`, 'success');
      } else {
        toast(res.error || 'Connection test failed', 'error');
      }
    }
  } catch (err) {
    databaseState.testResult = {
      ok: false,
      error: err.message || 'Connection test failed',
    };
    if (typeof toast === 'function') toast(err.message || 'Connection test failed', 'error');
  } finally {
    databaseState.isTesting = false;
    renderDatabaseUI();
  }
}

function proceedToSwitchConfirm() {
  const config = getEnteredDatabaseConfig();
  if (config.provider !== 'sqlite' && !config.connectionString && !config.host) {
    if (typeof toast === 'function') toast('Please enter connection credentials first', 'warning');
    return;
  }
  databaseState.showConfirmSwitch = true;
  renderDatabaseUI();
}

function cancelSwitchConfirm() {
  databaseState.showConfirmSwitch = false;
  renderDatabaseUI();
}

function renderConfirmSwitchStep(activeProvider, targetProvider) {
  const labelMap = {
    sqlite: 'SQLite',
    postgres: 'PostgreSQL',
    mssql: 'Microsoft SQL Server',
  };
  const fromLabel = labelMap[activeProvider] || activeProvider;
  const toLabel = labelMap[targetProvider] || targetProvider;
  const activeAppSlug = state.activeApp?.slug || 'default';
  const activeAppName = state.activeApp?.name || 'Default App';
  const isTargetSqlite = targetProvider === 'sqlite';
  const isMigrate = Boolean(databaseState.migrateData);
  const isConsentValid = !isMigrate || (databaseState.confirmText || '').trim().toLowerCase() === 'migrate';

  return `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      
      <!-- Warning Banner -->
      <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid #f59e0b; border-radius: 8px; padding: 12px 16px; color: #f59e0b; display: flex; align-items: flex-start; gap: 10px;">
        <span style="font-size: 20px; line-height: 1;">⚠️</span>
        <div style="font-size: 12.5px; line-height: 1.5;">
          <strong style="font-size: 13.5px; display: block; margin-bottom: 2px;">Application Database Cutover: ${escapeDbHtml(activeAppName)} (${escapeDbHtml(activeAppSlug)})</strong>
          You are about to switch the live database for application <strong>${escapeDbHtml(activeAppName)}</strong> from <strong>${fromLabel}</strong> to <strong>${toLabel}</strong>. Other applications will remain unaffected.
        </div>
      </div>

      <!-- Consequence Alert Banner -->
      <div style="background: rgba(239, 68, 68, 0.08); border: 1.5px solid #ef4444; border-radius: 8px; padding: 12px 16px; color: #ef4444; font-size: 12.5px; line-height: 1.5;">
        <div style="display: flex; align-items: flex-start; gap: 8px;">
          <span style="font-size: 16px;">⚠️</span>
          <div>
            <strong style="font-size: 13px; display: block; margin-bottom: 2px;">Snapshot Lifecycle Consequence</strong>
            All existing snapshots for <strong>${escapeDbHtml(activeAppName)}</strong> will be deleted post-migration.
            ${isTargetSqlite 
              ? 'A fresh baseline snapshot will be automatically created immediately after cutover.'
              : 'In-app snapshots are disabled on PostgreSQL / SQL Server (cloud backups recommended for production).'
            }
          </div>
        </div>
      </div>

      <!-- Safe Migration Checkbox -->
      <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer; padding: 12px 14px; background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; transition: border-color 0.15s ease;">
        <input 
          type="checkbox" 
          id="db-migrate-data-checkbox" 
          ${databaseState.migrateData ? 'checked' : ''} 
          onchange="databaseState.migrateData = this.checked; renderDatabaseUI();" 
          style="margin-top: 3px; width: 16px; height: 16px; cursor: pointer;"
        />
        <div>
          <div style="font-weight: 700; font-size: 13px; color: var(--text-heading);">
            Safely migrate all collections and records for '${escapeDbHtml(activeAppSlug)}' (Recommended)
          </div>
          <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 3px; line-height: 1.45;">
            NodeStack will automatically transfer all collections, schemas, and row data from ${fromLabel} to ${toLabel} with verification checksums.
          </div>
        </div>
      </label>

      ${!databaseState.migrateData ? `
        <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid #ef4444; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #ef4444;">
          <strong>Warning:</strong> Without migration, the new database will start with empty schemas. Existing data will remain intact in ${fromLabel}, but will not be active.
        </div>
      ` : ''}

      <!-- Consent Input Box -->
      ${isMigrate ? `
        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;">
          <label style="font-size: 12px; font-weight: 700; color: var(--text-heading);">
            Type <code style="color: #ef4444; font-size: 12.5px; background: rgba(239, 68, 68, 0.1); padding: 1px 6px; border-radius: 4px;">migrate</code> to confirm and unlock activation:
          </label>
          <input 
            type="text" 
            id="db-confirm-text-input" 
            class="form-control" 
            placeholder="Type migrate to confirm" 
            value="${escapeDbHtml(databaseState.confirmText || '')}"
            oninput="databaseState.confirmText = this.value; const btn = document.getElementById('db-confirm-switch-btn'); if (btn) { btn.disabled = this.value.trim().toLowerCase() !== 'migrate' || databaseState.isSwitching; }"
            style="font-family: var(--font-mono); font-weight: 700; font-size: 13px; max-width: 320px; padding: 6px 12px;"
            autocomplete="off"
          />
        </div>
      ` : ''}

      <!-- Progress / Switching State -->
      ${databaseState.isSwitching ? renderMigrationProgressBar() : ''}

      <!-- Actions -->
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 0.5rem; border-top: 1px solid var(--border-subtle); padding-top: 0.85rem;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="cancelSwitchConfirm()" ${databaseState.isSwitching ? 'disabled' : ''}>
          Back to Config
        </button>
        <button 
          type="button" 
          id="db-confirm-switch-btn" 
          class="btn btn-primary btn-sm" 
          onclick="executeDatabaseSwitch()" 
          ${(!isConsentValid || databaseState.isSwitching) ? 'disabled' : ''} 
          style="font-weight: 700; background: #10b981; border-color: #10b981;">
          ${databaseState.isSwitching ? 'Switching...' : `Confirm & Activate ${toLabel}`}
        </button>
      </div>

    </div>
  `;
}

function renderMigrationProgressBar() {
  const p = databaseState.migrationProgress || {
    percent: 0,
    message: 'Preparing database cutover & schema initialization...',
    currentTable: '',
    tableIndex: 0,
    totalTables: 0,
    rowsCopiedInTable: 0,
    totalRowsInTable: 0,
    totalRowsCopied: 0,
    totalRowsOverall: 0,
  };

  const percent = Math.min(100, Math.max(0, p.percent || 0));
  const hasRows = (p.totalRowsOverall || 0) > 0;
  const tableText = p.currentTable ? `Table: <strong>${escapeDbHtml(p.currentTable)}</strong>` : '';
  const rowsText = p.totalRowsInTable > 0 ? ` (${p.rowsCopiedInTable || 0} / ${p.totalRowsInTable} rows)` : '';
  const overallText = hasRows ? `Overall: ${p.totalRowsCopied || 0} / ${p.totalRowsOverall} records` : (p.totalTables > 0 ? `Step ${p.tableIndex || 0} of ${p.totalTables}` : '');

  return `
    <div id="db-migration-progress-card" style="background: var(--bg-input); border: 1.5px solid var(--accent-primary); border-radius: 10px; padding: 1.25rem; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 4px 14px rgba(0,0,0,0.06);">
      
      <!-- Header row: Message & Percentage badge -->
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          <span class="live-dot" style="width: 10px; height: 10px; flex-shrink: 0;"></span>
          <span id="db-migration-msg" style="font-weight: 700; font-size: 13px; color: var(--text-heading); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeDbHtml(p.message || 'Migrating database...')}
          </span>
        </div>
        <span id="db-migration-pct" class="badge badge-primary" style="font-size: 12.5px; font-weight: 800; padding: 3px 10px; font-family: var(--font-mono, monospace);">
          ${percent}%
        </span>
      </div>

      <!-- Outer Progress Track -->
      <div style="width: 100%; height: 12px; background: rgba(0, 0, 0, 0.12); border-radius: 999px; overflow: hidden; position: relative;">
        <!-- Inner Progress Fill -->
        <div id="db-migration-fill" style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, #3b82f6, #10b981); border-radius: 999px; transition: width 0.3s ease;"></div>
      </div>

      <!-- Detail Status Row -->
      <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: var(--text-muted); flex-wrap: wrap; gap: 6px;">
        <span id="db-migration-detail">${tableText}${rowsText}</span>
        <span id="db-migration-overall">${overallText}</span>
      </div>

    </div>
  `;
}

function updateMigrationProgressDOM(p) {
  if (!p) return;
  const percent = Math.min(100, Math.max(0, p.percent || 0));
  const fill = document.getElementById('db-migration-fill');
  const pct = document.getElementById('db-migration-pct');
  const msg = document.getElementById('db-migration-msg');
  const detail = document.getElementById('db-migration-detail');
  const overall = document.getElementById('db-migration-overall');

  if (fill) fill.style.width = `${percent}%`;
  if (pct) pct.textContent = `${percent}%`;
  if (msg && p.message) msg.textContent = p.message;
  
  if (detail) {
    const tableText = p.currentTable ? `Table: ${p.currentTable}` : '';
    const rowsText = p.totalRowsInTable > 0 ? ` (${p.rowsCopiedInTable || 0} / ${p.totalRowsInTable} rows)` : '';
    detail.textContent = `${tableText}${rowsText}`;
  }
  
  if (overall) {
    const hasRows = (p.totalRowsOverall || 0) > 0;
    const overallText = hasRows ? `Overall: ${p.totalRowsCopied || 0} / ${p.totalRowsOverall} records` : (p.totalTables > 0 ? `Step ${p.tableIndex || 0} of ${p.totalTables}` : '');
    overall.textContent = overallText;
  }
}

async function executeDatabaseSwitch() {
  const config = getEnteredDatabaseConfig();
  const migrateData = Boolean(databaseState.migrateData);

  databaseState.isSwitching = true;
  databaseState.migrationProgress = {
    percent: 1,
    message: 'Initiating database cutover...',
  };
  renderDatabaseUI();

  if (databaseState.migrationInterval) {
    clearInterval(databaseState.migrationInterval);
    databaseState.migrationInterval = null;
  }

  // Frequent polling for smooth progress updates
  databaseState.migrationInterval = setInterval(async () => {
    try {
      const prog = await api('/api/system/database/migration-progress');
      if (prog && databaseState.isSwitching) {
        databaseState.migrationProgress = prog;
        const fill = document.getElementById('db-migration-fill');
        if (fill) {
          updateMigrationProgressDOM(prog);
        } else {
          renderDatabaseUI();
        }
      }
    } catch {}
  }, 250);

  try {
    const res = await api('/api/system/database/switch', {
      method: 'POST',
      body: JSON.stringify({
        config,
        migrateData,
        confirmText: databaseState.confirmText || '',
        appSlug: state.activeApp?.slug || 'default',
      }),
    });

    if (res && res.success) {
      databaseState.migrationProgress = {
        percent: 100,
        message: 'Switch completed successfully!',
      };
      updateMigrationProgressDOM(databaseState.migrationProgress);

      if (typeof toast === 'function') {
        const recCount = res.migration?.recordsCount ?? res.migration?.totalRecords ?? 0;
        const colCount = res.migration?.collectionsCount ?? res.migration?.totalCollections ?? 0;
        const migText = res.migration ? ` (Migrated ${recCount} records across ${colCount} collections)` : '';
        toast(`Database successfully switched to ${config.provider.toUpperCase()}!${migText}`, 'success');
      }

      await fetchDatabaseStatus();
      if (typeof loadCollections === 'function') {
        await loadCollections();
      }

      databaseState.showConfirmSwitch = false;
      databaseState.confirmText = '';
      databaseState.selectedProvider = (config.provider || 'sqlite').toLowerCase();
      if (typeof fetchDemoStatus === 'function') {
        fetchDemoStatus().catch(() => {});
      }
      closeDatabaseModal();
      renderDatabaseUI();
    } else {
      throw new Error(res?.message || 'Database switch failed');
    }
  } catch (err) {
    if (typeof toast === 'function') {
      toast(err.message || 'Failed to switch database', 'error');
    }
    renderDatabaseUI();
  } finally {
    if (databaseState.migrationInterval) {
      clearInterval(databaseState.migrationInterval);
      databaseState.migrationInterval = null;
    }
    databaseState.isSwitching = false;
    renderDatabaseUI();
  }
}

// Window attachments for modular script access
if (typeof window !== 'undefined') {
  window.databaseState = databaseState;
  window.fetchDatabaseStatus = fetchDatabaseStatus;
  window.openDatabaseModal = openDatabaseModal;
  window.closeDatabaseModal = closeDatabaseModal;
  window.renderDatabaseView = renderDatabaseView;
  window.renderDatabaseUI = renderDatabaseUI;
  window.setDatabaseProviderTab = setDatabaseProviderTab;
  window.setDatabaseConfigMode = setDatabaseConfigMode;
  window.handleTestConnectionClick = handleTestConnectionClick;
  window.proceedToSwitchConfirm = proceedToSwitchConfirm;
  window.cancelSwitchConfirm = cancelSwitchConfirm;
  window.executeDatabaseSwitch = executeDatabaseSwitch;
  window.renderMigrationProgressBar = renderMigrationProgressBar;
  window.updateMigrationProgressDOM = updateMigrationProgressDOM;
}
