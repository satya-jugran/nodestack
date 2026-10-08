// Overview, Logs & Settings Views
    function renderHomeView() {
      const main = document.getElementById('main-body');
      const collectionsCount = state.collections.length;
      main.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; gap: 1.25rem;">
          
          <!-- Consolidated Header & Presentation Status Bar -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 0.85rem 1.25rem; display: flex; flex-direction: column; gap: 0.65rem;">
            <!-- Core Header Status Line -->
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <div style="width: 34px; height: 34px; border-radius: 8px; background: #0c0e14; border: 1px solid rgba(59, 130, 246, 0.4); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                  <img src="/_/icon.svg" width="22" height="22" alt="NodeStack" style="display: block;" />
                </div>
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-weight: 800; font-size: 15px; color: #fff; letter-spacing: -0.02em;">NodeStack Core</span>
                    <span class="version-tag" style="background: rgba(59, 130, 246, 0.2); border-color: rgba(59, 130, 246, 0.4); color: #93c5fd; font-size: 10.5px;">v1.1.0</span>
                    <span class="badge badge-get" style="font-size: 10.5px; display: inline-flex; align-items: center; gap: 5px;">
                      <span class="live-dot" style="width: 6px; height: 6px;"></span>
                      <span>Server Online</span>
                    </span>
                  </div>
                  <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 1px;">
                    Embedded SQLite Backend Stack • WAL Mode • Realtime SSE • End-to-End Type Safety
                  </div>
                </div>
              </div>
            </div>

            <!-- Demo State Notification Bar (populated dynamically by demo.js) -->
            <div id="demo-state-home-card" style="border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 0.55rem;">
              <!-- Populated dynamically by demo.js -->
            </div>
          </div>

          <!-- Zone 1 (Vitals Strip): High-Density 4-KPI Row + Integrated Telemetry Bar -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; overflow: hidden;">
            <!-- Top: 4 Horizontal KPI Metrics (Responsive auto-fitting row) -->
            <div class="home-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 0.75rem; padding: 0.85rem 1.15rem;">
              <!-- KPI 1: Collections -->
              <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.75rem 1rem;">
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 0.35rem;">
                  <span style="font-size: 13px;">📦</span>
                  <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Collections</span>
                </div>
                <div style="font-size: 22px; font-weight: 800; color: #fff;" id="home-stat-collections">${collectionsCount}</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Registered tables</div>
              </div>

              <!-- KPI 2: Active Records -->
              <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.75rem 1rem;">
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 0.35rem;">
                  <span style="font-size: 13px;">📝</span>
                  <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Total Records</span>
                </div>
                <div style="font-size: 22px; font-weight: 800; color: #60a5fa;" id="home-stat-records">--</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Active database rows</div>
              </div>

              <!-- KPI 3: Storage Size -->
              <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.75rem 1rem;">
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 0.35rem;">
                  <span style="font-size: 13px;">💾</span>
                  <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Storage Size</span>
                </div>
                <div style="font-size: 22px; font-weight: 800; color: #34d399;" id="home-stat-size">--</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">data.db + WAL journal</div>
              </div>

              <!-- KPI 4: Realtime Streams -->
              <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.75rem 1rem;">
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 0.35rem;">
                  <span style="font-size: 13px;">⚡</span>
                  <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Realtime Streams</span>
                </div>
                <div style="font-size: 22px; font-weight: 800; color: #c084fc;" id="home-stat-realtime">--</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Connected SSE clients</div>
              </div>
            </div>

            <!-- Bottom: Integrated 24h Telemetry Strip -->
            <div style="background: rgba(0, 0, 0, 0.25); border-top: 1px solid var(--border-subtle); padding: 0.65rem 1.15rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
              <div style="display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 13px;">📊</span>
                  <span style="font-size: 11px; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.04em;">24h Telemetry</span>
                  <span class="badge badge-status-200" style="font-size: 9.5px; padding: 1px 5px;">Live</span>
                </div>
                <div style="display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap; font-size: 12px; color: var(--text-muted);">
                  <span>Requests: <strong id="home-snap-requests" style="color: #fff; font-family: var(--font-mono); font-weight: 700;">--</strong></span>
                  <span>Latency: <strong id="home-snap-latency" style="color: #60a5fa; font-family: var(--font-mono); font-weight: 700;">--</strong></span>
                  <span>Error Rate: <strong id="home-snap-errors" style="color: #34d399; font-family: var(--font-mono); font-weight: 700;">--</strong></span>
                  <span>Peak: <strong id="home-snap-peak" style="color: #c084fc; font-family: var(--font-mono); font-weight: 700;">--</strong></span>
                </div>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="selectNav('analytics')" style="padding: 2px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" title="Open in-depth analytics">
                <span>Full Metrics</span><span>➔</span>
              </button>
            </div>
          </div>

          <!-- Zone 2 (Workspace Centerpiece): Active Collections Table -->
          <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">
            <div style="padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">📂</span>
                <h3 style="font-size: 14px; font-weight: 700; color: #fff; margin: 0;">Database Collections</h3>
                <span class="badge badge-post" style="font-size: 11px;">${collectionsCount} Active</span>
              </div>
              <button class="btn btn-primary btn-sm" onclick="openNewCollectionModal()" style="display: inline-flex; align-items: center; gap: 5px; font-weight: 600;">
                <span>+</span><span>New Collection</span>
              </button>
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

          <!-- Zone 3 (Accelerators & Tools): Side-by-Side Starter Templates & Developer Tools -->
          <div class="home-tools-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 1rem;">
            <!-- Left: Starter Accelerators & Schema Recipes -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1.1rem 1.25rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.85rem;">
              <div>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
                  <div style="display: flex; align-items: center; gap: 7px;">
                    <span style="font-size: 15px;">⚡</span>
                    <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Starter Accelerators</span>
                  </div>
                  <button class="btn btn-secondary btn-sm" onclick="openTemplatesModal()" style="font-size: 11px; padding: 2px 8px;" title="Browse all template recipes">
                    All Recipes ➔
                  </button>
                </div>
                <h4 style="font-size: 14px; font-weight: 700; color: #fff; margin: 0 0 0.2rem;">1-Click Schema Templates</h4>
                <p style="font-size: 12px; color: var(--text-muted); line-height: 1.4; margin: 0;">
                  Launch pre-seeded schemas with confirmation or auto-infer structures from JSON payload.
                </p>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 130px), 1fr)); gap: 0.6rem;">
                <button class="btn btn-secondary btn-sm" onclick="openApplyTemplateConfirmModal('ecommerce')" style="border-color: rgba(59, 130, 246, 0.35); font-size: 12px; padding: 7px 12px; display: flex; align-items: center; justify-content: center; gap: 6px;" title="Preview & install E-Commerce recipe">
                  <span>🛒</span><span>E-Commerce</span>
                </button>
                <button class="btn btn-secondary btn-sm" onclick="openApplyTemplateConfirmModal('blog')" style="border-color: rgba(16, 185, 129, 0.35); font-size: 12px; padding: 7px 12px; display: flex; align-items: center; justify-content: center; gap: 6px;" title="Preview & install Blog recipe">
                  <span>📝</span><span>Blog / CMS</span>
                </button>
                <button class="btn btn-secondary btn-sm" onclick="openApplyTemplateConfirmModal('crm')" style="border-color: rgba(139, 92, 246, 0.35); font-size: 12px; padding: 7px 12px; display: flex; align-items: center; justify-content: center; gap: 6px;" title="Preview & install CRM recipe">
                  <span>👥</span><span>SaaS / CRM</span>
                </button>
                <button class="btn btn-secondary btn-sm" onclick="openImportJsonModal()" style="border-color: rgba(245, 158, 11, 0.35); font-size: 12px; padding: 7px 12px; display: flex; align-items: center; justify-content: center; gap: 6px;" title="Paste JSON → Auto-infer schema">
                  <span>⚡</span><span>Import JSON</span>
                </button>
              </div>
            </div>

            <!-- Right: Developer Quick Tools (TypeGen & Base Endpoints) -->
            <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1.1rem 1.25rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.85rem;">
              <div>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
                  <div style="display: flex; align-items: center; gap: 7px;">
                    <span style="font-size: 15px;">🛠️</span>
                    <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Developer Quick Tools</span>
                  </div>
                  <span class="badge badge-get" style="font-size: 10px;">SDK & API</span>
                </div>
                <h4 style="font-size: 14px; font-weight: 700; color: #fff; margin: 0 0 0.2rem;">TypeGen & API Endpoints</h4>
                <p style="font-size: 12px; color: var(--text-muted); line-height: 1.4; margin: 0;">
                  End-to-end type generation and connection URLs for client applications.
                </p>
              </div>

              <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                <!-- Tool Row 1: TypeGen -->
                <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.65rem 0.9rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 12.5px; font-weight: 700; color: #fff;">TypeScript TypeGen</span>
                    <span class="badge badge-get" style="font-size: 10px; padding: 1px 6px;">types.d.ts</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <button class="btn btn-secondary btn-sm" style="padding: 3px 9px; font-size: 11.5px;" onclick="window.open('/_/types.d.ts', '_blank')" title="View types.d.ts">View types.d.ts</button>
                    <button class="btn btn-primary btn-sm" style="padding: 3px 9px; font-size: 11.5px;" onclick="copyToClipboard('npx nodestack typegen > nodestack-types.ts', this)" title="Copy CLI command">Copy CLI</button>
                  </div>
                </div>

                <!-- Tool Row 2: API Endpoints -->
                <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.65rem 0.9rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                  <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                    <span style="font-size: 12.5px; font-weight: 700; color: #fff; white-space: nowrap;">API Base</span>
                    <span class="badge badge-post" style="font-size: 10px; padding: 1px 6px; white-space: nowrap;">REST + SSE</span>
                    <code style="background: rgba(0,0,0,0.3); padding: 2px 8px; border-radius: 4px; font-family: var(--font-mono); font-size: 11px; color: #93c5fd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${window.location.origin}/api">
                      ${window.location.origin}/api
                    </code>
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                    <button class="btn btn-secondary btn-sm" style="padding: 3px 9px; font-size: 11.5px;" onclick="copyToClipboard('${window.location.origin}/api', this)" title="Copy REST API URL">Copy API</button>
                    <button class="btn btn-secondary btn-sm" style="padding: 3px 9px; font-size: 11.5px;" onclick="copyToClipboard('${window.location.origin}/api/realtime', this)" title="Copy SSE Realtime URL">Copy SSE</button>
                  </div>
                </div>
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
          const safeUrl = escapeHtml(log.url);

          return `
            <tr>
              <td><span class="badge ${statusClass}">${escapeHtml(log.status)}</span></td>
              <td><span class="badge ${methodClass}">${escapeHtml(log.method)}</span></td>
              <td>
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                  <code style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:280px;" title="${safeUrl}">${safeUrl}</code>
                  <button class="btn btn-secondary btn-sm" style="padding:4px 6px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; border-radius:5px;" data-url="${safeUrl}" onclick="copyToClipboard(this.getAttribute('data-url'), this)" title="Copy URL">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
              </td>
              <td>${log.duration.toFixed(1)}ms</td>
              <td style="color:var(--text-muted);font-size:12px;">${new Date(log.created).toLocaleTimeString()}</td>
              <td>${escapeHtml(log.ip || '127.0.0.1')}</td>
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
