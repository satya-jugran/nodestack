// Serverless Functions Live Sandbox Test Runner & Workbench Logs Module
// Companion module for NodeStack Admin UI Functions Workbench

// ==========================================
// 1. Sandbox Test Runner Sub-Renderer
// ==========================================

function renderWorkbenchTestPane(fn, isNew) {
  if (isNew) {
    return `
      <div id="fn-editor-pane-test" class="fn-editor-pane" style="display: ${functionsState.editorTab === 'test' ? 'flex' : 'none'}; width: 100%;">
        <div class="card" style="padding: 3.5rem 1.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1rem; width: 100%;">
          <div style="width: 54px; height: 54px; border-radius: 50%; background: rgba(99, 102, 241, 0.12); display: flex; align-items: center; justify-content: center; color: var(--accent-primary);">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          <div>
            <h3 style="margin: 0 0 0.5rem 0; font-size: 1.2rem; font-weight: 600;">Function Not Yet Created</h3>
            <p style="margin: 0; color: var(--text-muted); font-size: 0.875rem; max-width: 480px;">
              Create this function first to unlock live sandboxed HTTP executions and real-time response inspecting.
            </p>
          </div>
          <button class="btn btn-primary btn-sm" onclick="saveFunctionEditor()" style="display: flex; align-items: center; gap: 6px; font-weight: 600; margin-top: 4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span>Create Function & Unlock Runner</span>
          </button>
        </div>
      </div>
    `;
  }

  return `
    <div id="fn-editor-pane-test" class="fn-editor-pane" style="display: ${functionsState.editorTab === 'test' ? 'grid' : 'none'}; grid-template-columns: 1fr 1fr; gap: 1rem; align-items: start;">
      <!-- Left: Test Request Builder -->
      <div class="card" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
        <div style="font-weight: 600; font-size: 13px; color: var(--text-heading); display: flex; align-items: center; justify-content: space-between;">
          <span>Simulate Invocation</span>
          <span style="font-size: 11px; font-weight: normal; color: var(--text-muted);">QuickJS Sandbox Execution</span>
        </div>

        <div style="display: grid; grid-template-columns: 110px 1fr; gap: 10px;">
          <div>
            <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px;">Method</label>
            <select id="editor-test-method" class="input" style="width: 100%;">
              <option value="POST">POST</option>
              <option value="GET">GET</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div>
            <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px;">Simulated Caller Role / Auth</label>
            <select id="editor-test-auth" class="input" style="width: 100%;" onchange="toggleEditorTestAuthCustom(this.value)">
              <option value="none">Public (No Authorization Header)</option>
              <option value="admin">Current Admin Session (Bearer Token)</option>
              <option value="custom">Custom Token...</option>
            </select>
          </div>
        </div>

        <div id="editor-test-custom-auth-row" style="display: none;">
          <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px;">Custom Token (JWT / API Key)</label>
          <input type="text" id="editor-test-custom-token" class="input" placeholder="eyJhbGciOi..." style="width: 100%; font-family: monospace; font-size: 11px;">
        </div>

        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <label style="font-size: 11px; font-weight: 600;">Custom Request Headers (JSON)</label>
            <button type="button" class="btn btn-secondary btn-sm" onclick="setEditorTestSampleHeaders()" style="font-size: 10px; padding: 1px 6px;">Sample Headers</button>
          </div>
          <textarea id="editor-test-headers-input" style="width: 100%; height: 60px; font-family: monospace; font-size: 11px; padding: 8px; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg-input); color: var(--text-main);" placeholder='{ "Content-Type": "application/json" }'></textarea>
        </div>

        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <label style="font-size: 11px; font-weight: 600;">Request Body (JSON)</label>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="setEditorTestSampleBody('empty')" style="font-size: 10px; padding: 1px 6px;">{}</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="setEditorTestSampleBody('sample')" style="font-size: 10px; padding: 1px 6px;">Sample Data</button>
            </div>
          </div>
          <textarea id="editor-test-body" style="width: 100%; height: 160px; font-family: 'JetBrains Mono', Consolas, Monaco, monospace; font-size: 12px; line-height: 1.4; padding: 10px; border-radius: 6px; border: 1px solid var(--border-subtle); background: #0f172a; color: #f8fafc;" placeholder='{ "items": [{ "id": "p1", "price": 49.99 }] }'>{ "name": "NodeStack Developer" }</textarea>
        </div>

        <div>
          <button class="btn btn-primary" id="btn-run-editor-test" onclick="executeFunctionEditorTest()" style="width: 100%; justify-content: center; font-weight: 600; padding: 8px;">
            ⚡ Run Sandbox Test
          </button>
        </div>
      </div>

      <!-- Right: Execution Output -->
      <div class="card" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; min-height: 480px;">
        <div id="editor-test-empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; padding: 3rem 1rem; text-align: center; color: var(--text-muted); gap: 10px;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--bg-card-hover); display: flex; align-items: center; justify-content: center; color: var(--accent-primary);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          <div style="font-weight: 600; font-size: 13px; color: var(--text-heading);">Ready to Test</div>
          <p style="margin: 0; font-size: 12px; max-width: 320px;">
            Click <strong>Run Sandbox Test</strong> to execute this function isolated in QuickJS and inspect return values, logs, and headers.
          </p>
        </div>

        <div id="editor-test-result-pane" style="display: none; flex-direction: column; gap: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span id="editor-test-badge-status" class="badge" style="font-size: 12px; font-weight: 700; border: 1px solid transparent;">HTTP 200</span>
              <span id="editor-test-badge-duration" class="badge" style="background: var(--bg-card-hover); color: var(--text-muted); font-size: 11px;">0ms</span>
            </div>
            <span style="font-size: 11px; color: var(--text-muted);">Sandbox Invocation</span>
          </div>

          <div>
            <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--text-muted);">Captured Logs (ctx.log & console.log):</label>
            <pre id="editor-test-logs" style="background: #0f172a; color: #38bdf8; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 11px; max-height: 120px; overflow-y: auto; margin: 0; white-space: pre-wrap;"></pre>
          </div>

          <div>
            <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--text-muted);">Response Body:</label>
            <pre id="editor-test-response" style="background: #0f172a; color: #a7f3d0; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 12px; max-height: 240px; overflow-y: auto; margin: 0; white-space: pre-wrap;"></pre>
          </div>

          <div>
            <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--text-muted);">Response Headers:</label>
            <pre id="editor-test-headers" style="background: var(--bg-input); color: var(--text-muted); padding: 8px; border-radius: 6px; font-family: monospace; font-size: 11px; max-height: 80px; overflow-y: auto; margin: 0;"></pre>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ==========================================
// 2. Test Parameter Helpers
// ==========================================

function setEditorTestSampleHeaders() {
  const el = document.getElementById('editor-test-headers-input');
  if (el) el.value = JSON.stringify({ "x-custom-source": "admin-sandbox", "Content-Type": "application/json" }, null, 2);
}

function setEditorTestSampleBody(type) {
  const el = document.getElementById('editor-test-body');
  if (!el) return;
  if (type === 'empty') el.value = '{}';
  else if (type === 'sample') el.value = JSON.stringify({ name: 'NodeStack', amount: 150, items: ['item_1', 'item_2'] }, null, 2);
}

function toggleEditorTestAuthCustom(val) {
  const row = document.getElementById('editor-test-custom-auth-row');
  if (row) row.style.display = val === 'custom' ? 'block' : 'none';
}

// ==========================================
// 3. Sandbox Execution Engine
// ==========================================

async function executeFunctionEditorTest() {
  const btn = document.getElementById('btn-run-editor-test');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Executing...';
  }

  const fn = functionsState.activeFunctionForEdit;
  if (!fn) return;

  const outputEmpty = document.getElementById('editor-test-empty-state');
  const outputResult = document.getElementById('editor-test-result-pane');
  const badgeStatus = document.getElementById('editor-test-badge-status');
  const badgeDuration = document.getElementById('editor-test-badge-duration');
  const logsPre = document.getElementById('editor-test-logs');
  const resPre = document.getElementById('editor-test-response');
  const headersPre = document.getElementById('editor-test-headers');

  try {
    const method = document.getElementById('editor-test-method')?.value || 'POST';
    const authType = document.getElementById('editor-test-auth')?.value || 'none';
    const customAuthToken = document.getElementById('editor-test-custom-token')?.value || '';

    let body = {};
    const bodyRaw = document.getElementById('editor-test-body')?.value.trim();
    if (bodyRaw) {
      try {
        body = JSON.parse(bodyRaw);
      } catch {
        throw new Error('Mock request body must be valid JSON');
      }
    }

    let headers = {};
    const headersRaw = document.getElementById('editor-test-headers-input')?.value.trim();
    if (headersRaw) {
      try {
        headers = JSON.parse(headersRaw);
      } catch {
        throw new Error('Request headers must be valid JSON');
      }
    }

    if (authType === 'admin' && typeof state !== 'undefined' && state.token) {
      headers['authorization'] = `Bearer ${state.token}`;
    } else if (authType === 'custom' && customAuthToken) {
      headers['authorization'] = `Bearer ${customAuthToken.trim()}`;
    }

    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const endpoint = slug && slug !== 'default'
      ? `/api/apps/${slug}/functions/${fn.id}/test`
      : `/api/functions/${fn.id}/test`;

    const res = await api(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, body, headers }),
    });

    if (outputEmpty) outputEmpty.style.display = 'none';
    if (outputResult) outputResult.style.display = 'flex';

    const isOk = res.status === 'success';
    const statusColor = isOk ? 'var(--accent-success)' : 'var(--accent-danger)';
    if (badgeStatus) {
      badgeStatus.textContent = `HTTP ${res.statusCode || 200}`;
      badgeStatus.style.color = statusColor;
      badgeStatus.style.borderColor = statusColor;
    }
    if (badgeDuration) {
      badgeDuration.textContent = `${res.durationMs || 0}ms`;
    }

    if (logsPre) {
      logsPre.textContent = (res.logs && res.logs.length > 0) ? res.logs.join('\n') : '(No console output logged)';
    }

    if (resPre) {
      if (res.error) {
        resPre.style.color = 'var(--accent-danger)';
        resPre.textContent = res.error;
      } else {
        resPre.style.color = '#a7f3d0';
        resPre.textContent = typeof res.body === 'object' ? JSON.stringify(res.body, null, 2) : String(res.body);
      }
    }

    if (headersPre) {
      headersPre.textContent = res.headers ? JSON.stringify(res.headers, null, 2) : '{}';
    }

    if (typeof loadFunctionStats === 'function') {
      await loadFunctionStats();
    }
  } catch (err) {
    if (outputEmpty) outputEmpty.style.display = 'none';
    if (outputResult) outputResult.style.display = 'flex';
    if (badgeStatus) {
      badgeStatus.textContent = 'ERROR';
      badgeStatus.style.color = 'var(--accent-danger)';
    }
    if (resPre) {
      resPre.style.color = 'var(--accent-danger)';
      resPre.textContent = err.message || String(err);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Run Sandbox Test';
    }
  }
}

// ==========================================
// 4. Workbench Function Logs Sub-Renderer & Loader
// ==========================================

function renderWorkbenchLogsPane(fn, isNew) {
  if (isNew) {
    return `
      <div id="fn-editor-pane-logs" class="fn-editor-pane" style="display: ${functionsState.editorTab === 'logs' ? 'flex' : 'none'}; flex-direction: column; gap: 1rem; width: 100%;">
        <div class="card" style="padding: 3.5rem 1.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1rem; width: 100%;">
          <div style="width: 54px; height: 54px; border-radius: 50%; background: var(--bg-card-hover); display: flex; align-items: center; justify-content: center; color: var(--text-muted);">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <div>
            <h3 style="margin: 0 0 0.5rem 0; font-size: 1.2rem; font-weight: 600;">No Logs Available</h3>
            <p style="margin: 0; color: var(--text-muted); font-size: 0.875rem; max-width: 440px;">
              Execution history and stdout/stderr traces will be recorded here once this function is deployed and invoked.
            </p>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div id="fn-editor-pane-logs" class="fn-editor-pane" style="display: ${functionsState.editorTab === 'logs' ? 'flex' : 'none'}; flex-direction: column; gap: 1rem; width: 100%;">
      <div class="card" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-weight: 600; font-size: 13px; color: var(--text-heading);">
            Execution History for <code style="color: var(--accent-primary);">${escapeHtml(fn.name)}</code>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="loadFunctionEditorLogs()">
            Refresh Logs
          </button>
        </div>

        <div id="fn-editor-logs-container">
          <div style="display: flex; align-items: center; justify-content: center; padding: 3rem; color: var(--text-muted);">
            <span class="spinner" style="margin-right: 8px;"></span> Loading logs...
          </div>
        </div>
      </div>
    </div>
  `;
}

function formatTimestampSafe(iso) {
  if (typeof formatTimestamp === 'function') {
    return formatTimestamp(iso);
  }
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString();
  } catch {
    return iso;
  }
}

async function loadFunctionEditorLogs() {
  const container = document.getElementById('fn-editor-logs-container');
  if (!container) return;

  const fn = functionsState.activeFunctionForEdit;
  if (!fn) return;

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; padding: 3rem; color: var(--text-muted);">
      <span class="spinner" style="margin-right: 8px;"></span> Loading logs for ${escapeHtml(fn.name)}...
    </div>
  `;

  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const baseUrl = slug && slug !== 'default' ? `/api/apps/${slug}/functions/logs` : '/api/functions/logs';
    const params = new URLSearchParams({
      functionId: fn.id,
      page: '1',
      perPage: '50',
    });

    const res = await api(`${baseUrl}?${params.toString()}`);
    const items = res.items || [];
    functionsState.editorLogs = items;
    renderFunctionEditorLogsTable(items);
  } catch (err) {
    container.innerHTML = `
      <div class="card" style="padding: 2rem; text-align: center; color: var(--accent-danger);">
        Failed to load logs: ${escapeHtml(err.message || String(err))}
      </div>
    `;
  }
}

function renderFunctionEditorLogsTable(logs) {
  const container = document.getElementById('fn-editor-logs-container');
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = `
      <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); font-size: 13px;">
        No execution logs recorded for this function yet. Switch to the <strong>Live Test Runner</strong> tab to run a sandbox test.
      </div>
    `;
    return;
  }

  const rows = logs.map(l => {
    const isOk = l.status === 'success';
    const statusBadge = isOk
      ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">${l.statusCode || 200} OK</span>`
      : `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444;">${escapeHtml(l.status.toUpperCase())}</span>`;

    return `
      <tr>
        <td style="font-size: 12px; color: var(--text-muted);">${formatTimestampSafe(l.timestamp || l.createdAt)}</td>
        <td>${statusBadge}</td>
        <td style="font-size: 12px; font-weight: 600;">${l.durationMs}ms</td>
        <td><code style="font-size: 11px;">${escapeHtml(l.method || 'POST')}</code></td>
        <td style="font-size: 12px; color: var(--text-muted);">${escapeHtml(l.actorId || 'public')}</td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-sm" onclick="viewLogPayload('${l.id}')" title="Inspect Request/Response payload" style="font-size: 11px; padding: 2px 7px;">
            Inspect
          </button>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x: auto;">
      <table class="table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 1px solid var(--border-subtle); background: var(--bg-card-hover);">
            <th style="text-align: left; padding: 8px 12px;">Timestamp</th>
            <th style="text-align: left; padding: 8px 12px;">Status</th>
            <th style="text-align: left; padding: 8px 12px;">Latency</th>
            <th style="text-align: left; padding: 8px 12px;">Method</th>
            <th style="text-align: left; padding: 8px 12px;">Caller</th>
            <th style="text-align: right; padding: 8px 12px;">Payload</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

// Global Exports
if (typeof window !== 'undefined') {
  window.renderWorkbenchTestPane = renderWorkbenchTestPane;
  window.setEditorTestSampleHeaders = setEditorTestSampleHeaders;
  window.setEditorTestSampleBody = setEditorTestSampleBody;
  window.toggleEditorTestAuthCustom = toggleEditorTestAuthCustom;
  window.executeFunctionEditorTest = executeFunctionEditorTest;
  window.renderWorkbenchLogsPane = renderWorkbenchLogsPane;
  window.loadFunctionEditorLogs = loadFunctionEditorLogs;
  window.renderFunctionEditorLogsTable = renderFunctionEditorLogsTable;
}
