// Demo State Management ("Snapshot Demo State" & "Reset Demo Data")

async function fetchDemoStatus() {
  try {
    const res = await api('/api/demo/status');
    state.demo = res || { hasSnapshot: false, snapshot: null };
  } catch {
    state.demo = { hasSnapshot: false, snapshot: null };
  }

  updateDemoSidebarDot();

  if (state.activeNav === 'snapshots') {
    renderSnapshotsView();
  }
  updateDemoHomeCardUI();
  updateDemoSettingsUI();
  return state.demo;
}

function updateDemoSidebarDot() {
  const dot = document.getElementById('sidebar-snapshot-dot');
  if (!dot) return;

  if (state.demo && state.demo.hasSnapshot) {
    const isModified = Boolean(state.demo.liveStats?.drift?.isModified);
    dot.style.display = 'inline-block';
    dot.style.background = isModified ? '#f59e0b' : '#10b981';
    dot.title = isModified
      ? `Demo Snapshot: changes detected (${state.demo.liveStats?.drift?.recordsDelta >= 0 ? '+' : ''}${state.demo.liveStats?.drift?.recordsDelta} records)`
      : `Demo Snapshot: clean baseline (${state.demo.snapshot?.name})`;
  } else {
    dot.style.display = 'none';
  }
}

// ==========================================
// Dedicated Snapshots View
// ==========================================

function renderSnapshotsView() {
  const main = document.getElementById('main-body');
  if (!main) return;

  const hasSnap = Boolean(state.demo && state.demo.hasSnapshot && state.demo.snapshot);
  const snap = hasSnap ? state.demo.snapshot : null;
  const drift = state.demo?.liveStats?.drift;
  const isModified = Boolean(drift?.isModified);

  const snapTime = snap
    ? new Date(snap.createdAt).toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';

  let heroHtml = '';
  let statsHtml = '';
  let collectionsTableHtml = '';

  if (hasSnap && snap) {
    const recDelta = drift?.recordsDelta !== undefined
      ? (drift.recordsDelta >= 0 ? `+${drift.recordsDelta}` : `${drift.recordsDelta}`)
      : '0';

    const driftLabel = (drift?.recordsDelta !== 0 && drift?.recordsDelta !== undefined)
      ? `${recDelta} records`
      : 'Content modified';

    const statusBadge = isModified
      ? `<span class="badge badge-post" style="font-size:11.5px; background:rgba(245, 158, 11, 0.15); border-color:rgba(245, 158, 11, 0.4); color:#fbbf24; padding:3px 9px;">⚠️ Live Data Modified (${driftLabel})</span>`
      : `<span class="badge badge-get" style="font-size:11.5px; background:rgba(16, 185, 129, 0.15); border-color:rgba(16, 185, 129, 0.4); color:#34d399; padding:3px 9px;">● Pristine Clean Baseline</span>`;

    heroHtml = `
      <div style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(16, 185, 129, 0.07) 100%); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
          <div style="display: flex; align-items: flex-start; gap: 1rem;">
            <div style="width: 46px; height: 46px; border-radius: 12px; background: #0c0e14; border: 1px solid rgba(59, 130, 246, 0.4); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);">
              <span style="font-size: 24px;">📸</span>
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <h2 style="font-size: 18px; font-weight: 800; color: #fff; margin: 0;">${snap.name}</h2>
                ${statusBadge}
              </div>
              <div style="font-size: 12.5px; color: var(--text-muted); margin-top: 4px;">
                Frozen on <strong style="color: #cbd5e1;">${snapTime}</strong> • ${snap.description || 'Clean showcase baseline'}
              </div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-warning" onclick="openResetDemoModal()" style="font-size: 12.5px; padding: 6px 14px; font-weight: 700; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.2);">
              ↺ Reset Demo Data
            </button>
            <button class="btn btn-secondary" onclick="openSnapshotDemoModal()" style="font-size: 12.5px; padding: 6px 12px;">
              📸 Update Snapshot
            </button>
            <button class="btn btn-danger btn-sm" onclick="openClearDemoModal()" style="font-size: 11px; padding: 6px 10px;">
              Clear
            </button>
          </div>
        </div>
      </div>
    `;

    statsHtml = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem;">
        <!-- KPI 1: Preserved Records -->
        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.1rem 1.25rem;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Preserved Baseline</div>
          <div style="font-size: 22px; font-weight: 800; color: #60a5fa; margin-top: 4px;">${snap.totalRecords.toLocaleString()}</div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Records across ${snap.totalCollections} collections</div>
        </div>

        <!-- KPI 2: Uploaded Files -->
        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.1rem 1.25rem;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Storage & Media</div>
          <div style="font-size: 22px; font-weight: 800; color: #c084fc; margin-top: 4px;">${snap.totalFiles} Files</div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${(snap.storageSizeBytes / 1024).toFixed(1)} KB preserved assets</div>
        </div>

        <!-- KPI 3: Live Drift Status -->
        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.1rem 1.25rem;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Live Drift Status</div>
          <div style="font-size: 22px; font-weight: 800; color: ${isModified ? '#fbbf24' : '#34d399'}; margin-top: 4px;">
            ${isModified ? (drift?.recordsDelta !== 0 ? `${recDelta} Changes` : 'Modified') : '0 Changes'}
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
            ${isModified ? 'Data modified during evaluations' : 'Exact match with baseline'}
          </div>
        </div>
      </div>
    `;

    // Collections Breakdown Table
    collectionsTableHtml = `
      <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; overflow: hidden;">
        <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">📂</span>
            <h3 style="font-size: 14px; font-weight: 700; color: #fff; margin: 0;">Preserved Collections Scope</h3>
            <span class="badge badge-post" style="font-size: 11px;">${snap.collections.length} Tables</span>
          </div>
        </div>
        <div class="table-container" style="border: none; border-radius: 0;">
          <table>
            <thead>
              <tr>
                <th>Collection</th>
                <th>Type</th>
                <th>Fields</th>
                <th>Baseline Records</th>
                <th>Current Live</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${snap.collections.map((c) => {
                const liveCol = state.collections.find((sc) => sc.name === c.name);
                const liveCountRow = document.getElementById(`col-count-${c.name}`);
                const currentCount = liveCol ? (liveCountRow ? parseInt(liveCountRow.textContent || '0', 10) : c.recordsCount) : 0;
                const isTableModified = currentCount !== c.recordsCount;

                return `
                  <tr>
                    <td><strong style="color: #fff; font-family: var(--font-mono);">${c.name}</strong></td>
                    <td><span class="collection-badge">${c.type}</span></td>
                    <td style="color: var(--text-muted); font-size: 12px;">${c.schemaFieldsCount} fields</td>
                    <td><span style="font-weight: 700; color: #60a5fa;">${c.recordsCount}</span></td>
                    <td><span style="font-weight: 700; color: #fff;">${currentCount}</span></td>
                    <td>
                      ${isTableModified
                        ? `<span class="badge badge-post" style="font-size: 10.5px;">Modified</span>`
                        : `<span class="badge badge-get" style="font-size: 10.5px;">Matches</span>`}
                    </td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="selectCollection('${c.name}')" style="padding: 2px 7px; font-size: 11px;">
                        Browse ➔
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else {
    // Empty state
    heroHtml = `
      <div style="background: var(--bg-card); border: 1px dashed rgba(59, 130, 246, 0.35); border-radius: 12px; padding: 2.5rem 1.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem;">
        <div style="width: 56px; height: 56px; border-radius: 16px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); display: flex; align-items: center; justify-content: center;">
          <span style="font-size: 28px;">📸</span>
        </div>
        <div style="max-width: 520px;">
          <h2 style="font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 6px;">No Demo Baseline Saved Yet</h2>
          <p style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin: 0;">
            Freeze your current database tables and file assets as the clean baseline.
            Let prospects, evaluators, or investors test and create dummy records freely, then click <strong>"Reset Demo Data"</strong> anytime to restore your exact clean state before the next presentation.
          </p>
        </div>
        <button class="btn btn-primary" onclick="openSnapshotDemoModal()" style="font-size: 13px; padding: 7px 18px; margin-top: 0.5rem; display: inline-flex; align-items: center; gap: 6px;">
          <span>📸 Freeze Clean Demo State Now</span>
        </button>
      </div>
    `;
  }

  // Presentation Guide Card
  const guideHtml = `
    <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1.25rem;">
      <h3 style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 6px;">
        <span>🎯</span>
        <span>How Live Demo State Works</span>
      </h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem;">
        <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1rem;">
          <div style="font-size: 12px; font-weight: 700; color: #60a5fa; margin-bottom: 4px;">1. Freeze Clean Baseline</div>
          <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4;">
            Pre-seed sample products, deals, or articles. Click <strong>Snapshot Demo State</strong> to freeze transactional SQLite state and uploaded storage assets.
          </div>
        </div>
        <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1rem;">
          <div style="font-size: 12px; font-weight: 700; color: #fbbf24; margin-bottom: 4px;">2. Present & Test Freely</div>
          <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4;">
            Let evaluators create test rows, delete records, or modify fields during live pitches. NodeStack tracks modifications in real time.
          </div>
        </div>
        <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1rem;">
          <div style="font-size: 12px; font-weight: 700; color: #34d399; margin-bottom: 4px;">3. 1-Click Instant Restore</div>
          <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4;">
            Click <strong>Reset Demo Data</strong> before your next meeting. In &lt;50ms, all test changes are wiped and the pristine baseline is restored.
          </div>
        </div>
      </div>
      <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; font-size: 11.5px; color: var(--text-muted);">
        <span>CLI Access: <code style="color: #60a5fa;">npx nodestack demo reset</code></span>
        <span>Client SDK: <code style="color: #60a5fa;">await client.demo.reset()</code></span>
      </div>
    </div>
  `;

  main.innerHTML = `
    <div style="max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; padding: 1rem 0;">
      ${heroHtml}
      ${statsHtml}
      ${collectionsTableHtml}
      ${guideHtml}
    </div>
  `;
}

function updateDemoHomeCardUI() {
  const card = document.getElementById('demo-state-home-card');
  if (!card) return;

  if (state.demo && state.demo.hasSnapshot && state.demo.snapshot) {
    const snap = state.demo.snapshot;
    const drift = state.demo.liveStats?.drift;
    const isModified = Boolean(drift?.isModified);

    const recDelta = drift?.recordsDelta !== undefined
      ? (drift.recordsDelta >= 0 ? `+${drift.recordsDelta}` : `${drift.recordsDelta}`)
      : '0';

    const driftLabel = (drift?.recordsDelta !== 0 && drift?.recordsDelta !== undefined)
      ? `${recDelta} records`
      : 'Content modified';

    const statusPill = isModified
      ? `<span class="badge badge-post" style="font-size:10.5px;">⚠️ Modified (${driftLabel})</span>`
      : `<span class="badge badge-get" style="font-size:10.5px;">● Clean Baseline</span>`;

    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:16px;">📸</span>
          <strong style="color:#fff; font-size:13px;">Demo Snapshot: ${snap.name}</strong>
          ${statusPill}
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button class="btn btn-warning btn-sm" onclick="openResetDemoModal()" style="font-weight:700; padding:3px 9px; font-size:11px;">
            ↺ Reset Demo
          </button>
          <button class="btn btn-secondary btn-sm" onclick="selectNav('snapshots')" style="padding:3px 9px; font-size:11px;">
            Manage Snapshots ➔
          </button>
        </div>
      </div>
    `;
  } else {
    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:16px;">📸</span>
          <span style="color:#fff; font-size:13px; font-weight:600;">Live Demo & Presentation Mode</span>
          <span class="badge" style="font-size:10.5px; opacity:0.7;">No Snapshot Saved</span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="selectNav('snapshots')" style="padding:3px 9px; font-size:11px;">
          Open Snapshots ➔
        </button>
      </div>
    `;
  }
}

function updateDemoSettingsUI() {
  const container = document.getElementById('demo-settings-panel');
  if (!container) return;

  if (state.demo && state.demo.hasSnapshot && state.demo.snapshot) {
    const snap = state.demo.snapshot;
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.85rem; font-size:13px;">
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-subtle); padding-bottom:0.5rem;">
          <span style="color:var(--text-muted);">Baseline Snapshot Name</span>
          <strong style="color:#fff;">${snap.name}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-subtle); padding-bottom:0.5rem;">
          <span style="color:var(--text-muted);">Frozen At</span>
          <code>${new Date(snap.createdAt).toLocaleString()}</code>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-subtle); padding-bottom:0.5rem;">
          <span style="color:var(--text-muted);">Preserved Data</span>
          <span>${snap.totalCollections} collections, ${snap.totalRecords} records, ${snap.totalFiles} files</span>
        </div>
        <div style="display:flex; gap:8px; margin-top:0.5rem;">
          <button class="btn btn-warning btn-sm" onclick="openResetDemoModal()">↺ Reset Demo Data</button>
          <button class="btn btn-secondary btn-sm" onclick="selectNav('snapshots')">Open Snapshots View ➔</button>
          <button class="btn btn-danger btn-sm" onclick="openClearDemoModal()">Clear Snapshot</button>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:1rem;">
        No demo snapshot has been created yet. Freeze your clean database state to enable 1-click restore during live presentations.
      </p>
      <button class="btn btn-primary btn-sm" onclick="openSnapshotDemoModal()">📸 Snapshot Demo State</button>
    `;
  }
}

// ==========================================
// Snapshot Demo State Modal
// ==========================================

function openSnapshotDemoModal() {
  const modal = document.getElementById('modal-root');
  const collectionsCount = state.collections ? state.collections.length : 0;
  const isUpdate = Boolean(state.demo && state.demo.hasSnapshot);

  modal.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:480px;">
        <div class="modal-header">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <span style="font-size:20px;">📸</span>
            <div>
              <h2 class="modal-title" style="font-size:16px;">${isUpdate ? 'Update Demo Snapshot' : 'Snapshot Demo State'}</h2>
              <span style="font-size:11px; color:var(--text-muted);">Freeze clean baseline for presentations & pitches</span>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
        </div>

        <div class="modal-body" style="display:flex; flex-direction:column; gap:1rem;">
          <p style="font-size:13px; color:var(--text-muted); margin:0; line-height:1.5;">
            Freeze your current database state as the clean baseline. During meetings, let clients or investors create, update, and delete records without worrying about ruining your data.
          </p>

          <div style="background:var(--bg-input); border:1px solid var(--border-subtle); border-radius:8px; padding:0.85rem 1rem; display:flex; align-items:center; justify-content:space-between;">
            <div>
              <div style="font-size:11px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Active Schema Scope</div>
              <div style="font-size:14px; font-weight:700; color:#fff; margin-top:2px;">${collectionsCount} Collections Active</div>
            </div>
            <span class="badge badge-get" style="font-size:11px;">SQLite WAL Snapshot</span>
          </div>

          <div class="form-group" style="margin:0;">
            <label class="form-label">Snapshot Label / Name</label>
            <input type="text" class="form-input" id="snapshot-demo-name" value="${state.demo?.snapshot?.name || 'Initial Clean State'}" placeholder="e.g. Investor Pitch Demo" autofocus>
          </div>

          <div class="form-group" style="margin:0;">
            <label class="form-label">Description (Optional)</label>
            <input type="text" class="form-input" id="snapshot-demo-desc" value="${state.demo?.snapshot?.description || 'Clean showcase baseline data'}" placeholder="e.g. Baseline with 20 sample products and 4 reviews">
          </div>
        </div>

        <div class="modal-footer" style="padding:0.75rem 1.25rem;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="btn-submit-snapshot" onclick="submitSnapshotDemo()">
            <span>📸 Freeze Demo State</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

async function submitSnapshotDemo() {
  const btn = document.getElementById('btn-submit-snapshot');
  const name = document.getElementById('snapshot-demo-name')?.value || 'Initial Clean State';
  const description = document.getElementById('snapshot-demo-desc')?.value || '';

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <div style="width:13px; height:13px; border:2px solid #ffffff; border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite; display:inline-block; margin-right:4px;"></div>
      <span>Freezing State...</span>
    `;
  }

  try {
    const res = await api('/api/demo/snapshot', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });

    toast(`📸 Demo baseline '${res.name}' frozen! (${res.totalRecords} records preserved)`, 'success');
    closeModal();
    await fetchDemoStatus();
  } catch (err) {
    toast(`Failed to take snapshot: ${err.message || String(err)}`, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>📸 Freeze Demo State</span>';
    }
  }
}

// ==========================================
// Reset Demo Data Modal
// ==========================================

function openResetDemoModal() {
  if (!state.demo || !state.demo.hasSnapshot) {
    openSnapshotDemoModal();
    return;
  }

  const snap = state.demo.snapshot;
  const drift = state.demo.liveStats?.drift;
  const isModified = Boolean(drift?.isModified);
  const snapTime = new Date(snap.createdAt).toLocaleString();

  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:480px;">
        <div class="modal-header" style="border-bottom-color:rgba(245, 158, 11, 0.25);">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <span style="font-size:20px;">↺</span>
            <div>
              <h2 class="modal-title" style="font-size:16px; color:#fbbf24;">Reset Demo Data</h2>
              <span style="font-size:11px; color:var(--text-muted);">Restore pristine state before your next presentation</span>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
        </div>

        <div class="modal-body" style="display:flex; flex-direction:column; gap:1rem;">
          <div style="background:rgba(245, 158, 11, 0.08); border:1px solid rgba(245, 158, 11, 0.3); border-radius:8px; padding:0.85rem 1rem;">
            <div style="font-size:13px; font-weight:700; color:#fbbf24; margin-bottom:4px;">
              Ready to restore '${snap.name}'?
            </div>
            <div style="font-size:12px; color:#e2e8f0; line-height:1.4;">
              All records created, edited, or deleted during test evaluations will be instantly reverted back to the exact clean snapshot taken on <strong style="color:#fff;">${snapTime}</strong>.
            </div>
          </div>

          <div style="background:var(--bg-input); border:1px solid var(--border-subtle); border-radius:8px; padding:0.85rem 1rem; display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
            <div>
              <div style="font-size:11px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Collections Restored</div>
              <div style="font-size:15px; font-weight:700; color:#fff; margin-top:2px;">${snap.totalCollections} Collections</div>
            </div>
            <div>
              <div style="font-size:11px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Records Restored</div>
              <div style="font-size:15px; font-weight:700; color:#60a5fa; margin-top:2px;">${snap.totalRecords} Records</div>
            </div>
          </div>

          ${isModified ? `
            <div style="font-size:12px; color:#f87171; background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.25); border-radius:6px; padding:0.6rem 0.85rem;">
              ⚠️ Changes detected: ${drift.recordsDelta >= 0 ? `+${drift.recordsDelta}` : drift.recordsDelta} records will be wiped to restore your clean baseline.
            </div>
          ` : `
            <div style="font-size:12px; color:#34d399; background:rgba(16, 185, 129, 0.08); border:1px solid rgba(16, 185, 129, 0.25); border-radius:6px; padding:0.6rem 0.85rem;">
              ✓ Database will be cleanly refreshed to the pristine snapshot.
            </div>
          `}
        </div>

        <div class="modal-footer" style="padding:0.75rem 1.25rem;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-warning" id="btn-submit-reset-demo" onclick="submitResetDemo()" style="font-weight:700;">
            <span>↺ Reset Demo Data Now</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

async function submitResetDemo() {
  const btn = document.getElementById('btn-submit-reset-demo');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <div style="width:13px; height:13px; border:2px solid #ffffff; border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite; display:inline-block; margin-right:4px;"></div>
      <span>Restoring Clean State...</span>
    `;
  }

  try {
    const res = await api('/api/demo/reset', {
      method: 'POST',
    });

    toast(`✨ Clean demo state restored in ${res.durationMs}ms! (${res.snapshot.totalRecords} records restored)`, 'success');
    closeModal();

    await fetchDemoStatus();
    await loadCollections();

    if (state.activeNav === 'snapshots') {
      renderSnapshotsView();
    } else if (state.activeCollection) {
      if (state.collectionTab === 'records') {
        loadRecords();
      } else {
        renderSchemaView();
      }
    } else if (state.activeNav === 'home') {
      renderHomeView();
    }
  } catch (err) {
    toast(`Failed to reset demo: ${err.message || String(err)}`, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>↺ Reset Demo Data Now</span>';
    }
  }
}

// Clear snapshot confirmation modal
function openClearDemoModal() {
  if (!confirm('Are you sure you want to delete the saved demo snapshot?')) return;
  api('/api/demo/snapshot', { method: 'DELETE' })
    .then(() => {
      toast('Demo snapshot deleted', 'info');
      fetchDemoStatus();
    })
    .catch((err) => toast(err.message, 'error'));
}
