// Overview, Logs & Settings Views
    function renderHomeView() {
      const main = document.getElementById('main-body');
      const collectionsCount = state.collections.length;
      main.innerHTML = `
        <div style="max-width: 980px; margin: 0 auto; display:flex; flex-direction:column; gap:1.75rem; padding: 1rem 0;">
          <!-- Hero Header with Brand SVG -->
          <div style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(139, 92, 246, 0.08) 100%); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px; padding: 2rem 2.25rem; display: flex; align-items: center; gap: 2rem;">
            <div style="width: 80px; height: 80px; border-radius: 18px; background: #0c0e14; border: 1px solid rgba(59, 130, 246, 0.4); display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px -4px rgba(59, 130, 246, 0.4); flex-shrink: 0;">
              <img src="/_/icon.svg" width="56" height="56" alt="NodeStack" style="display: block;" />
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                <h2 style="font-size: 26px; font-weight: 800; letter-spacing: -0.03em; color: #fff;">NodeStack</h2>
                <span class="version-tag" style="background: rgba(59, 130, 246, 0.2); border-color: rgba(59, 130, 246, 0.4); color: #93c5fd;">v1.0.0</span>
                <span class="badge badge-get" style="font-size: 11px;">● Server Online</span>
              </div>
              <p style="color: var(--text-muted); font-size: 14px; line-height: 1.5; max-width: 620px;">
                The TypeScript-Native Embedded Backend Stack. Single-process backend powered by embedded SQLite, instant CRUD, Auth, Realtime SSE, and end-to-end type safety.
              </p>
            </div>
          </div>

          <!-- Quick Action Cards Grid -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
            <!-- Card 1: Collections -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.25rem; display:flex; flex-direction:column; justify-content:space-between; gap:1rem;">
              <div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem;">
                  <span style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.05em;">Database</span>
                  <span class="badge badge-post">${collectionsCount} Collections</span>
                </div>
                <h4 style="font-size:16px; font-weight:700; margin-bottom:0.4rem;">Schema & Records</h4>
                <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">Manage tables, schema fields, and access rules with real-time UI synchronization.</p>
              </div>
              <div style="display:flex; gap:0.5rem;">
                <button class="btn btn-primary btn-sm" style="flex:1;" onclick="openImportJsonModal()">⚡ Import from JSON</button>
                <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="openNewCollectionModal()">+ Create</button>
              </div>
            </div>

            <!-- Card 2: TypeScript TypeGen -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.25rem; display:flex; flex-direction:column; justify-content:space-between; gap:1rem;">
              <div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem;">
                  <span style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.05em;">Type Safety</span>
                  <span class="badge badge-get">types.d.ts</span>
                </div>
                <h4 style="font-size:16px; font-weight:700; margin-bottom:0.4rem;">TypeScript TypeGen</h4>
                <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">Auto-generated definitions for 100% end-to-end type safety across your client apps.</p>
              </div>
              <div style="display:flex; gap:0.5rem;">
                <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="window.open('/_/types.d.ts', '_blank')">View types.d.ts</button>
                <button class="btn btn-primary btn-sm" style="flex:1;" onclick="copyToClipboard('npx nodestack typegen > nodestack-types.ts', this)">Copy CLI</button>
              </div>
            </div>

            <!-- Card 3: Traffic & Logs -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.25rem; display:flex; flex-direction:column; justify-content:space-between; gap:1rem;">
              <div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem;">
                  <span style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.05em;">Monitoring</span>
                  <span class="badge badge-status-200">Realtime</span>
                </div>
                <h4 style="font-size:16px; font-weight:700; margin-bottom:0.4rem;">Traffic & Request Logs</h4>
                <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">Inspect incoming API requests, HTTP status codes, latency, and client details.</p>
              </div>
              <button class="btn btn-secondary btn-sm" style="width:100%;" onclick="selectNav('logs')">View Traffic Logs</button>
            </div>

            <!-- Card 4: Analytics & Metrics Dashboard -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.25rem; display:flex; flex-direction:column; justify-content:space-between; gap:1rem;">
              <div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem;">
                  <span style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.05em;">Analytics</span>
                  <span class="badge badge-post" id="home-kpi-badge" style="display:inline-flex; align-items:center; gap:4px;"><span class="live-pulse-dot" style="width:6px; height:6px;"></span> Live Metrics</span>
                </div>
                <h4 style="font-size:16px; font-weight:700; margin-bottom:0.4rem;">Metrics & Telemetry</h4>
                <p style="font-size:12px; color:var(--text-muted); line-height:1.4;" id="home-kpi-summary">
                  Database storage, active record counts, live SSE clients, and 24h throughput & error rate graphs.
                </p>
              </div>
              <button class="btn btn-primary btn-sm" style="width:100%;" onclick="selectNav('analytics')">Open Metrics Dashboard ➔</button>
            </div>
          </div>

          <!-- Quick Reference & Schema Overview -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.5rem;">
            <h3 style="font-size:15px; font-weight:700; margin-bottom:1rem; display:flex; align-items:center; justify-content:space-between;">
              <span>Active Collections</span>
              <span style="font-size:12px; font-weight:normal; color:var(--text-muted);">${collectionsCount} registered</span>
            </h3>
            <div style="display:flex; flex-direction:column; gap:0.5rem;">
              ${state.collections.map(c => `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:0.65rem 0.85rem; background:var(--bg-input); border-radius:6px; font-size:13px; cursor:pointer;" onclick="selectCollection('${c.name}')">
                  <div style="display:flex; align-items:center; gap:0.6rem;">
                    <span style="font-weight:600; color:#fff;">${c.name}</span>
                    <span style="color:var(--text-muted); font-size:11px;">(${c.schema.length} fields)</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:0.5rem;">
                    <span class="collection-badge">${c.type}</span>
                    <span style="color:#60a5fa; font-size:12px;">Open ➔</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;

      // Asynchronously enrich home overview card with live metrics
      api('/api/metrics').then((metrics) => {
        const el = document.getElementById('home-kpi-summary');
        if (el && metrics) {
          el.innerHTML = `<strong>${metrics.database.totalRecords.toLocaleString()}</strong> records &bull; <strong>${metrics.database.sizeFormatted}</strong> on disk &bull; <strong>${metrics.realtime.connectedClients}</strong> live client${metrics.realtime.connectedClients === 1 ? '' : 's'}.`;
        }
      }).catch(() => {});
    }

    function renderLogsView() {
      const main = document.getElementById('main-body');
      main.innerHTML = `
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Method</th>
                <th>URL</th>
                <th>Duration</th>
                <th>Time</th>
                <th>Client IP</th>
              </tr>
            </thead>
            <tbody id="logs-body">
              <tr><td colspan="6" style="text-align:center;padding:2rem;">Loading logs...</td></tr>
            </tbody>
          </table>
        </div>
      `;
    }

    async function loadLogs() {
      try {
        const res = await api('/api/logs?perPage=100');
        const tb = document.getElementById('logs-body');
        if (!tb) return;

        if (!res.items || res.items.length === 0) {
          tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted);">No requests logged yet.</td></tr>';
          return;
        }

        tb.innerHTML = res.items.map(log => {
          let statusClass = 'badge-status-200';
          if (log.status >= 500) statusClass = 'badge-status-500';
          else if (log.status >= 400) statusClass = 'badge-status-400';

          const methodClass = `badge-${log.method.toLowerCase()}`;

          return `
            <tr>
              <td><span class="badge ${statusClass}">${log.status}</span></td>
              <td><span class="badge ${methodClass}">${log.method}</span></td>
              <td>
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                  <code style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:280px;" title="${log.url}">${log.url}</code>
                  <button class="btn btn-secondary btn-sm" style="padding:4px 6px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; border-radius:5px;" onclick="copyToClipboard('${log.url.replace(/'/g, "\\'")}', this)" title="Copy URL">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
              </td>
              <td>${log.duration.toFixed(1)}ms</td>
              <td style="color:var(--text-muted);font-size:12px;">${new Date(log.created).toLocaleTimeString()}</td>
              <td>${log.ip || '127.0.0.1'}</td>
            </tr>
          `;
        }).join('');
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    async function clearLogs() {
      if (!confirm('Clear all logs?')) return;
      try {
        await api('/api/logs', { method: 'DELETE' });
        toast('Logs cleared', 'success');
        loadLogs();
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    // Settings View
    async function renderSettingsView() {
      const main = document.getElementById('main-body');
      let health = { version: '1.0.0', appName: 'NodeStack' };
      try {
        health = await api('/api/health');
      } catch {}

      main.innerHTML = `
        <div style="max-width: 700px; display:flex; flex-direction:column; gap:1.5rem;">
          <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:8px; padding:1.5rem;">
            <h3 style="font-size:16px; font-weight:700; margin-bottom:1rem;">NodeStack System Info</h3>
            <div style="display:flex; flex-direction:column; gap:0.75rem; font-size:13px;">
              <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-subtle); padding-bottom:0.5rem;">
                <span style="color:var(--text-muted);">Version</span>
                <code>${health.version}</code>
              </div>
              <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-subtle); padding-bottom:0.5rem;">
                <span style="color:var(--text-muted);">Uptime</span>
                <code>${Math.floor(health.uptime || 0)} seconds</code>
              </div>
              <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-subtle); padding-bottom:0.5rem;">
                <span style="color:var(--text-muted);">Node.js Runtime</span>
                <code>${window.navigator.userAgent}</code>
              </div>
            </div>
          </div>

          <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:8px; padding:1.5rem;">
            <h3 style="font-size:16px; font-weight:700; margin-bottom:0.5rem;">TypeScript Server Hooks</h3>
            <p style="color:var(--text-muted); font-size:13px; margin-bottom:1rem;">
              Extend your backend using standard TypeScript with full access to npm:
            </p>
            <pre style="background:var(--bg-input); padding:1rem; border-radius:6px; font-family:var(--font-mono); font-size:12px; overflow-x:auto;">
import { NodeStack } from 'nodestack';

const app = new NodeStack();

app.onRecordBeforeCreate('posts', async (e) => {
  // Validate, enrich data, or call any npm library
  console.log('Creating post:', e.record.title);
});

await app.start(8090);</pre>
          </div>
        </div>
      `;
    }
