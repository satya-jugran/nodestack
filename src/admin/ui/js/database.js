// Database Engine Configuration & Switcher (SQLite, PostgreSQL, SQL Server)

let databaseState = {
  status: null,
  loading: false,
  selectedProvider: 'postgres',
  configMode: 'url', // 'url' or 'params'
  testResult: null,
  isTesting: false,
  isSwitching: false,
  showConfirmSwitch: false,
  migrateData: true,
};

async function fetchDatabaseStatus() {
  try {
    const res = await api('/api/system/database/status');
    if (res && res.provider) {
      databaseState.status = res;
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

function openDatabaseModal(providerToSelect) {
  if (typeof closeModal === 'function') closeModal();
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return;

  if (providerToSelect) {
    databaseState.selectedProvider = providerToSelect;
  } else if (databaseState.status?.provider) {
    // Default to the next available provider or current
    databaseState.selectedProvider = databaseState.status.provider;
  }

  databaseState.testResult = null;
  databaseState.showConfirmSwitch = false;
  databaseState.isSwitching = false;

  renderDatabaseModal();

  // Freshly refresh status in background
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
  databaseState.selectedProvider = provider;
  databaseState.testResult = null;
  databaseState.showConfirmSwitch = false;
  renderDatabaseModal();
}

function setDatabaseConfigMode(mode) {
  databaseState.configMode = mode;
  databaseState.testResult = null;
  renderDatabaseModal();
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
  const selected = databaseState.selectedProvider || 'postgres';
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
          <span style="font-size: 18px; margin-bottom: 2px;">⚡</span>
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
  if (selected === 'postgres') {
    return `
      <div class="form-group" style="margin: 0;">
        <label class="form-label" for="db-field-url" style="font-size: 11.5px;">PostgreSQL Connection URL *</label>
        <input 
          type="text" 
          id="db-field-url" 
          class="form-input" 
          placeholder="postgresql://postgres:secret@localhost:5432/nodestack?sslmode=prefer"
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
  return `
    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 8px;">
      <div class="form-group" style="margin: 0;">
        <label class="form-label" for="db-field-host" style="font-size: 11.5px;">${isPg ? 'Host' : 'Server Host'} *</label>
        <input type="text" id="db-field-host" class="form-input" placeholder="localhost" style="font-size: 12px;" />
      </div>
      <div class="form-group" style="margin: 0;">
        <label class="form-label" for="db-field-port" style="font-size: 11.5px;">Port</label>
        <input type="number" id="db-field-port" class="form-input" placeholder="${isPg ? '5432' : '1433'}" style="font-size: 12px;" />
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      <div class="form-group" style="margin: 0;">
        <label class="form-label" for="db-field-database" style="font-size: 11.5px;">Database Name *</label>
        <input type="text" id="db-field-database" class="form-input" placeholder="nodestack" style="font-size: 12px;" />
      </div>
      <div class="form-group" style="margin: 0;">
        <label class="form-label" for="db-field-user" style="font-size: 11.5px;">Username *</label>
        <input type="text" id="db-field-user" class="form-input" placeholder="${isPg ? 'postgres' : 'sa'}" style="font-size: 12px;" />
      </div>
    </div>

    <div class="form-group" style="margin: 0;">
      <label class="form-label" for="db-field-password" style="font-size: 11.5px;">Password *</label>
      <input type="password" id="db-field-password" class="form-input" placeholder="••••••••" style="font-size: 12px;" />
    </div>

    <div style="display: flex; align-items: center; gap: 1rem; margin-top: 2px;">
      ${isPg ? `
        <label style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; cursor: pointer;">
          <input type="checkbox" id="db-field-ssl" />
          <span>Enable SSL Connection</span>
        </label>
      ` : `
        <label style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; cursor: pointer;">
          <input type="checkbox" id="db-field-trust-cert" checked />
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
  const provider = databaseState.selectedProvider;
  if (provider === 'sqlite') {
    return { provider: 'sqlite' };
  }

  const isUrlMode = databaseState.configMode === 'url';
  let config = {};
  if (isUrlMode) {
    const urlEl = document.getElementById('db-field-url');
    const url = urlEl ? urlEl.value.trim() : '';
    config = {
      provider,
      connectionString: url,
    };
  } else {
    const host = document.getElementById('db-field-host')?.value?.trim();
    const port = parseInt(document.getElementById('db-field-port')?.value?.trim() || '0', 10);
    const database = document.getElementById('db-field-database')?.value?.trim();
    const user = document.getElementById('db-field-user')?.value?.trim();
    const password = document.getElementById('db-field-password')?.value || '';
    const ssl = Boolean(document.getElementById('db-field-ssl')?.checked);
    const trustServerCertificate = Boolean(document.getElementById('db-field-trust-cert')?.checked);

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
  renderDatabaseModal();

  try {
    const res = await api('/api/system/database/test', {
      method: 'POST',
      body: config,
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
    renderDatabaseModal();
  }
}

function proceedToSwitchConfirm() {
  const config = getEnteredDatabaseConfig();
  if (config.provider !== 'sqlite' && !config.connectionString && !config.host) {
    if (typeof toast === 'function') toast('Please enter connection credentials first', 'warning');
    return;
  }
  databaseState.showConfirmSwitch = true;
  renderDatabaseModal();
}

function cancelSwitchConfirm() {
  databaseState.showConfirmSwitch = false;
  renderDatabaseModal();
}

function renderConfirmSwitchStep(activeProvider, targetProvider) {
  const labelMap = {
    sqlite: 'SQLite',
    postgres: 'PostgreSQL',
    mssql: 'Microsoft SQL Server',
  };
  const fromLabel = labelMap[activeProvider] || activeProvider;
  const toLabel = labelMap[targetProvider] || targetProvider;

  return `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      
      <!-- Warning Banner -->
      <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid #f59e0b; border-radius: 8px; padding: 12px 16px; color: #f59e0b; display: flex; align-items: flex-start; gap: 10px;">
        <span style="font-size: 20px; line-height: 1;">⚠️</span>
        <div style="font-size: 12.5px; line-height: 1.5;">
          <strong style="font-size: 13.5px; display: block; margin-bottom: 2px;">Database Cutover Confirmation</strong>
          You are about to switch the live active database from <strong>${fromLabel}</strong> to <strong>${toLabel}</strong>.
          Incoming writes will be temporarily queued during the schema and data cutover.
        </div>
      </div>

      <!-- Safe Migration Checkbox -->
      <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer; padding: 12px 14px; background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; transition: border-color 0.15s ease;">
        <input 
          type="checkbox" 
          id="db-migrate-data-checkbox" 
          ${databaseState.migrateData ? 'checked' : ''} 
          onchange="databaseState.migrateData = this.checked; renderDatabaseModal();" 
          style="margin-top: 3px; width: 16px; height: 16px; cursor: pointer;"
        />
        <div>
          <div style="font-weight: 700; font-size: 13px; color: var(--text-heading);">
            Safely migrate all existing collections and records (Recommended)
          </div>
          <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 3px; line-height: 1.45;">
            NodeStack will automatically transfer all collections, schemas, and row data from ${fromLabel} to ${toLabel} with verification checksums.
          </div>
        </div>
      </label>

      ${!databaseState.migrateData ? `
        <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid #ef4444; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #ef4444;">
          <strong>Warning:</strong> Without migration, the new database will start with empty schemas. Your existing data will remain intact in ${fromLabel}, but will not be active.
        </div>
      ` : ''}

      <!-- Progress / Switching State -->
      ${databaseState.isSwitching ? `
        <div style="display: flex; align-items: center; justify-content: center; gap: 10px; padding: 1rem; background: var(--bg-input); border-radius: 8px;">
          <span class="live-dot" style="width: 10px; height: 10px;"></span>
          <span style="font-weight: 700; font-size: 13px; color: var(--accent-primary);">
            Migrating schemas, data, and activating new database engine...
          </span>
        </div>
      ` : ''}

      <!-- Actions -->
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 0.5rem; pt: 0.5rem; border-top: 1px solid var(--border-subtle); padding-top: 0.85rem;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="cancelSwitchConfirm()" ${databaseState.isSwitching ? 'disabled' : ''}>
          Back to Config
        </button>
        <button type="button" class="btn btn-primary btn-sm" onclick="executeDatabaseSwitch()" ${databaseState.isSwitching ? 'disabled' : ''} style="font-weight: 700; background: #10b981; border-color: #10b981;">
          ${databaseState.isSwitching ? 'Switching...' : `Confirm & Activate ${toLabel}`}
        </button>
      </div>

    </div>
  `;
}

async function executeDatabaseSwitch() {
  const config = getEnteredDatabaseConfig();
  const migrateData = Boolean(databaseState.migrateData);

  databaseState.isSwitching = true;
  renderDatabaseModal();

  try {
    const res = await api('/api/system/database/switch', {
      method: 'POST',
      body: {
        config,
        migrateData,
      },
    });

    if (res && res.success) {
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

      closeDatabaseModal();
    } else {
      throw new Error(res?.message || 'Database switch failed');
    }
  } catch (err) {
    if (typeof toast === 'function') {
      toast(err.message || 'Failed to switch database', 'error');
    }
    databaseState.isSwitching = false;
    renderDatabaseModal();
  }
}

// Window attachments for modular script access
if (typeof window !== 'undefined') {
  window.databaseState = databaseState;
  window.fetchDatabaseStatus = fetchDatabaseStatus;
  window.openDatabaseModal = openDatabaseModal;
  window.closeDatabaseModal = closeDatabaseModal;
  window.setDatabaseProviderTab = setDatabaseProviderTab;
  window.setDatabaseConfigMode = setDatabaseConfigMode;
  window.handleTestConnectionClick = handleTestConnectionClick;
  window.proceedToSwitchConfirm = proceedToSwitchConfirm;
  window.cancelSwitchConfirm = cancelSwitchConfirm;
  window.executeDatabaseSwitch = executeDatabaseSwitch;
}
