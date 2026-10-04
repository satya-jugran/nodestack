// Overview, Logs & Settings Views
    function renderHomeView() {
      const main = document.getElementById('main-body');
      const collectionsCount = state.collections.length;
      main.innerHTML = `
        <div style="max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; padding: 1.25rem 0;">
          
          <!-- 1. Header Status Bar -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1rem 1.25rem; display: flex; align-items: center; gap: 0.85rem;">
            <div style="width: 40px; height: 40px; border-radius: 10px; background: #0c0e14; border: 1px solid rgba(59, 130, 246, 0.4); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <img src="/_/icon.svg" width="26" height="26" alt="NodeStack" style="display: block;" />
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 800; font-size: 16px; color: #fff; letter-spacing: -0.02em;">NodeStack Core</span>
                <span class="version-tag" style="background: rgba(59, 130, 246, 0.2); border-color: rgba(59, 130, 246, 0.4); color: #93c5fd; font-size: 11px;">v1.1.0</span>
                <span class="badge badge-get" style="font-size: 11px; display: inline-flex; align-items: center; gap: 5px;">
                  <span class="live-dot" style="width: 6px; height: 6px;"></span>
                  <span>Server Online</span>
                </span>
              </div>
              <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                Embedded SQLite Backend Stack • WAL Mode • Realtime SSE • End-to-End Type Safety
              </div>
            </div>
          </div>

          <!-- 2. Operational KPI Metric Cards Row -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem;">
            <!-- KPI 1: Collections -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.1rem 1.25rem;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 0.5rem;">
                <span style="font-size: 14px;">📦</span>
                <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Collections</span>
              </div>
              <div style="font-size: 22px; font-weight: 800; color: #fff;" id="home-stat-collections">${collectionsCount}</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">Registered database tables</div>
            </div>

            <!-- KPI 2: Active Records -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.1rem 1.25rem;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 0.5rem;">
                <span style="font-size: 14px;">📝</span>
                <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Total Records</span>
              </div>
              <div style="font-size: 22px; font-weight: 800; color: #60a5fa;" id="home-stat-records">--</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">Active rows across tables</div>
            </div>

            <!-- KPI 3: Storage Size -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.1rem 1.25rem;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 0.5rem;">
                <span style="font-size: 14px;">💾</span>
                <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Database Storage</span>
              </div>
              <div style="font-size: 22px; font-weight: 800; color: #34d399;" id="home-stat-size">--</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">data.db + WAL journal</div>
            </div>

            <!-- KPI 4: Realtime Clients -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.1rem 1.25rem;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 0.5rem;">
                <span style="font-size: 14px;">⚡</span>
                <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Realtime Streams</span>
              </div>
              <div style="font-size: 22px; font-weight: 800; color: #c084fc;" id="home-stat-realtime">--</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">Connected SSE clients</div>
            </div>
          </div>

          <!-- 3. System & Traffic Snapshot (Placed ABOVE Quick Accelerator Bar) -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">📊</span>
                <h3 style="font-size: 14px; font-weight: 700; color: #fff; margin: 0;">System & Traffic Snapshot</h3>
                <span class="badge badge-status-200" style="font-size: 10px;">24h Telemetry</span>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="selectNav('analytics')" style="padding: 3px 9px; font-size: 11px;">
                Open Full Metrics ➔
              </button>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0.75rem;">
              <!-- 24h Requests -->
              <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.75rem 1rem;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">24h API Requests</div>
                <div style="font-size: 18px; font-weight: 800; color: #fff; margin-top: 4px;" id="home-snap-requests">--</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Incoming HTTP traffic</div>
              </div>

              <!-- Avg Latency -->
              <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.75rem 1rem;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Avg Latency</div>
                <div style="font-size: 18px; font-weight: 800; color: #60a5fa; margin-top: 4px;" id="home-snap-latency">--</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Sub-millisecond SQLite</div>
              </div>

              <!-- Error Rate -->
              <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.75rem 1rem;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Error Rate</div>
                <div style="font-size: 18px; font-weight: 800; color: #34d399; margin-top: 4px;" id="home-snap-errors">--</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">4xx & 5xx HTTP codes</div>
              </div>

              <!-- Peak Throughput -->
              <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.75rem 1rem;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Peak Volume</div>
                <div style="font-size: 18px; font-weight: 800; color: #c084fc; margin-top: 4px;" id="home-snap-peak">--</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Max requests / hour</div>
              </div>
            </div>
          </div>

          <!-- 3.5 Quick Accelerator Bar (Confirmation modal on click) -->
          <div style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(139, 92, 246, 0.06) 100%); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 10px; padding: 0.85rem 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span style="font-size: 16px;">⚡</span>
              <span style="font-size: 12.5px; font-weight: 700; color: #fff;">1-Click Starter Accelerators:</span>
              <span style="font-size: 12px; color: var(--text-muted);">Launch pre-seeded schemas with confirmation</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <button class="btn btn-secondary btn-sm" onclick="openApplyTemplateConfirmModal('ecommerce')" style="border-color: rgba(59, 130, 246, 0.35); font-size: 11.5px; padding: 4px 10px;" title="Preview & install E-Commerce recipe">
                🛒 E-Commerce
              </button>
              <button class="btn btn-secondary btn-sm" onclick="openApplyTemplateConfirmModal('blog')" style="border-color: rgba(16, 185, 129, 0.35); font-size: 11.5px; padding: 4px 10px;" title="Preview & install Blog recipe">
                📝 Blog / Content
              </button>
              <button class="btn btn-secondary btn-sm" onclick="openApplyTemplateConfirmModal('crm')" style="border-color: rgba(139, 92, 246, 0.35); font-size: 11.5px; padding: 4px 10px;" title="Preview & install CRM recipe">
                👥 SaaS / CRM
              </button>
              <button class="btn btn-secondary btn-sm" onclick="openImportJsonModal()" style="border-color: rgba(245, 158, 11, 0.35); font-size: 11.5px; padding: 4px 10px;" title="Paste JSON → Auto-infer schema">
                ⚡ Import JSON
              </button>
              <button class="btn btn-secondary btn-sm" onclick="openTemplatesModal()" style="font-size: 11.5px; padding: 4px 9px;" title="Browse all template recipes">
                All ➔
              </button>
            </div>
          </div>

          <!-- 4. Live Presentation & Demo State Manager -->
          <div id="demo-state-home-card" style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(16, 185, 129, 0.06) 100%); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 10px; padding: 0.85rem 1.25rem; display: flex; flex-direction: column; gap: 0.9rem;">
            <!-- Populated dynamically by demo.js -->
          </div>

          <!-- 5. Active Database Collections Table (Centerpiece) -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; overflow: hidden;">
            <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">📂</span>
                <h3 style="font-size: 14px; font-weight: 700; color: #fff; margin: 0;">Database Collections</h3>
                <span class="badge badge-post" style="font-size: 11px;">${collectionsCount} Active</span>
              </div>
              <button class="btn btn-primary btn-sm" onclick="openNewCollectionModal()">+ Create Collection</button>
            </div>

            ${collectionsCount === 0 ? `
              <div style="padding: 2.5rem; text-align: center; color: var(--text-muted); font-size: 13px;">
                <p style="font-size: 14px; color: #fff; margin-bottom: 0.5rem; font-weight: 600;">No collections created yet</p>
                <p style="max-width: 480px; margin: 0 auto 1.25rem; line-height: 1.5;">Launch an instant working demo with pre-seeded data, or design your first collection schema from scratch.</p>
                <div style="display: flex; justify-content: center; gap: 0.75rem;">
                  <button class="btn btn-primary btn-sm" onclick="openApplyTemplateConfirmModal('ecommerce')">🚀 Launch E-Commerce</button>
                  <button class="btn btn-secondary btn-sm" onclick="openNewCollectionModal()">+ Create Blank Collection</button>
                </div>
              </div>
            ` : `
              <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
                  <thead>
                    <tr style="border-bottom: 1px solid var(--border-subtle); background: rgba(0,0,0,0.15); color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">
                      <th style="padding: 0.75rem 1.25rem;">Collection Name</th>
                      <th style="padding: 0.75rem 1rem;">Type</th>
                      <th style="padding: 0.75rem 1rem;">Fields</th>
                      <th style="padding: 0.75rem 1rem;">Records</th>
                      <th style="padding: 0.75rem 1rem;">Sync Status</th>
                      <th style="padding: 0.75rem 1.25rem; text-align: right;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${state.collections.map(c => `
                      <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.15s ease; cursor: pointer;" onmouseover="this.style.background='var(--bg-card-hover)'" onmouseout="this.style.background='transparent'" onclick="selectCollection('${c.name}')">
                        <td style="padding: 0.85rem 1.25rem;">
                          <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-weight: 700; color: #fff;">${c.name}</span>
                            ${c.system ? '<span class="badge" style="font-size:10px; background:rgba(255,255,255,0.06);">System</span>' : ''}
                          </div>
                        </td>
                        <td style="padding: 0.85rem 1rem;">
                          <span class="collection-badge">${c.type}</span>
                        </td>
                        <td style="padding: 0.85rem 1rem; color: var(--text-muted);">
                          ${c.schema.length} fields
                        </td>
                        <td style="padding: 0.85rem 1rem;">
                          <span id="col-count-${c.name}" style="font-family: var(--font-mono); font-weight: 600; color: #93c5fd;">--</span>
                        </td>
                        <td style="padding: 0.85rem 1rem;">
                          <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted);">
                            <span class="live-dot" style="width: 6px; height: 6px;"></span>
                            <span>Active Sync</span>
                          </div>
                        </td>
                        <td style="padding: 0.85rem 1.25rem; text-align: right;" onclick="event.stopPropagation()">
                          <div style="display: inline-flex; align-items: center; gap: 6px;">
                            <button class="btn btn-secondary btn-sm" style="padding: 3px 8px; font-size: 11px;" onclick="selectCollection('${c.name}')">
                              Open ➔
                            </button>
                            ${!c.system ? `
                              <button class="btn btn-danger btn-sm" style="padding: 3px 7px; font-size: 11px;" onclick="openDeleteCollectionModal('${c.name}')" title="Delete collection">
                                ✕
                              </button>
                            ` : ''}
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>

          <!-- 6. Developer Quick Tools -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
            <!-- TypeScript TypeGen -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.15rem 1.25rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.85rem;">
              <div>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
                  <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Type Safety</span>
                  <span class="badge badge-get" style="font-size: 10px;">types.d.ts</span>
                </div>
                <h4 style="font-size: 14px; font-weight: 700; color: #fff; margin: 0 0 0.25rem;">TypeScript TypeGen</h4>
                <p style="font-size: 12px; color: var(--text-muted); line-height: 1.4; margin: 0;">Auto-generated TypeScript definitions for full type safety across frontend and server clients.</p>
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="window.open('/_/types.d.ts', '_blank')">View types.d.ts</button>
                <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="copyToClipboard('npx nodestack typegen > nodestack-types.ts', this)">Copy CLI</button>
              </div>
            </div>

            <!-- REST & Realtime Base Endpoints -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.15rem 1.25rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.85rem;">
              <div>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
                  <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">API Connection</span>
                  <span class="badge badge-post" style="font-size: 10px;">HTTP + SSE</span>
                </div>
                <h4 style="font-size: 14px; font-weight: 700; color: #fff; margin: 0 0 0.25rem;">REST & Realtime Base URL</h4>
                <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 6px 10px; font-family: var(--font-mono); font-size: 11px; color: #93c5fd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 4px;">
                  ${window.location.origin}/api
                </div>
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="copyToClipboard('${window.location.origin}/api', this)">Copy API URL</button>
                <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="copyToClipboard('${window.location.origin}/api/realtime', this)">Copy SSE URL</button>
              </div>
            </div>
          </div>

        </div>
      `;

      if (typeof fetchDemoStatus === 'function') {
        fetchDemoStatus();
      }

      // Asynchronously enrich dashboard overview with live metrics and counts
      api('/api/metrics').then((metrics) => {
        if (!metrics) return;

        // Top KPI row
        const recEl = document.getElementById('home-stat-records');
        if (recEl && metrics.database?.totalRecords !== undefined) {
          recEl.textContent = metrics.database.totalRecords.toLocaleString();
        }

        const sizeEl = document.getElementById('home-stat-size');
        if (sizeEl && metrics.database?.sizeFormatted) {
          sizeEl.textContent = metrics.database.sizeFormatted;
        }

        const rtEl = document.getElementById('home-stat-realtime');
        if (rtEl && metrics.realtime?.connectedClients !== undefined) {
          rtEl.textContent = metrics.realtime.connectedClients.toString();
        }

        // System & Traffic Snapshot
        const reqEl = document.getElementById('home-snap-requests');
        if (reqEl && metrics.traffic24h?.totalRequests !== undefined) {
          reqEl.textContent = metrics.traffic24h.totalRequests.toLocaleString();
        }

        const latEl = document.getElementById('home-snap-latency');
        if (latEl && metrics.traffic24h?.avgDuration !== undefined) {
          latEl.textContent = `${metrics.traffic24h.avgDuration.toFixed(1)} ms`;
        }

        const errEl = document.getElementById('home-snap-errors');
        if (errEl && metrics.traffic24h?.overallErrorRate !== undefined) {
          const errRate = metrics.traffic24h.overallErrorRate;
          errEl.textContent = `${errRate.toFixed(1)} %`;
          errEl.style.color = errRate > 5 ? '#f87171' : '#34d399';
        }

        const peakEl = document.getElementById('home-snap-peak');
        if (peakEl && metrics.traffic24h?.peakHourRequests !== undefined) {
          peakEl.textContent = `${metrics.traffic24h.peakHourRequests} req/h`;
        }

        // Update record counts in collections table
        if (metrics.database?.collectionsBreakdown && Array.isArray(metrics.database.collectionsBreakdown)) {
          for (const item of metrics.database.collectionsBreakdown) {
            const countEl = document.getElementById(`col-count-${item.collection}`);
            if (countEl) {
              countEl.textContent = (item.count || 0).toLocaleString();
            }
          }
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
      let health = { version: '1.1.0', appName: 'NodeStack' };
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
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:18px;">🎯</span>
                <h3 style="font-size:16px; font-weight:700; margin:0;">Demo State & Presentations</h3>
              </div>
              <span class="badge badge-get" style="font-size:11px;">1-Click Restore</span>
            </div>
            <p style="font-size:13px; color:var(--text-muted); margin-bottom:1rem; line-height:1.4;">
              Freeze a pristine snapshot of your database and files before client demos or investor pitches. Restore it anytime in one click.
            </p>
            <div id="demo-settings-panel">
              <!-- Dynamically populated by updateDemoSettingsUI() -->
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

      if (typeof fetchDemoStatus === 'function') {
        fetchDemoStatus();
      }
    }
