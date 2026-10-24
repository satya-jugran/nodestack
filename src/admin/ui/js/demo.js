// Application Snapshots & State Management ("Take Snapshot", "Restore Checkpoint", "10-Snapshot FIFO Retention")

async function fetchDemoStatus() {
  try {
    const res = await api('/api/snapshots');
    state.demo = res || { hasSnapshot: false, snapshots: [], total: 0, maxLimit: 10, snapshot: null, activeSnapshot: null };
  } catch {
    try {
      const res = await api('/api/demo/status');
      state.demo = res || { hasSnapshot: false, snapshots: [], total: 0, maxLimit: 10, snapshot: null, activeSnapshot: null };
    } catch {
      state.demo = { hasSnapshot: false, snapshots: [], total: 0, maxLimit: 10, snapshot: null, activeSnapshot: null };
    }
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
    const active = state.demo.activeSnapshot || state.demo.snapshot;
    dot.title = isModified
      ? `Snapshots (${state.demo.total || 1}): live data modified (${state.demo.liveStats?.drift?.recordsDelta >= 0 ? '+' : ''}${state.demo.liveStats?.drift?.recordsDelta} records)`
      : `Snapshots (${state.demo.total || 1}): clean baseline (${active?.name || 'Active'})`;
  } else {
    dot.style.display = 'none';
  }
}

// ==========================================
// Dedicated Snapshots View
// ==========================================

function renderSnapshotsView() {
  const main = document.getElementById('page-view-snapshots') || document.getElementById('main-body');
  if (!main) return;

  const demoState = state.demo || {};
  const snapshots = Array.isArray(demoState.snapshots) ? demoState.snapshots : (demoState.snapshot ? [demoState.snapshot] : []);
  const total = demoState.total || snapshots.length;
  const maxLimit = demoState.maxLimit || 10;
  const activeSnap = demoState.activeSnapshot || demoState.snapshot || (snapshots.length > 0 ? snapshots[snapshots.length - 1] : null);
  const drift = demoState.liveStats?.drift;
  const isModified = Boolean(drift?.isModified);

  // 1. Top Header Bar
  const headerHtml = `
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem; padding-bottom:0.75rem; border-bottom:1px solid var(--border-subtle);">
      <div>
        <div style="display:flex; align-items:center; gap:10px;">
          <h2 style="font-size:18px; font-weight:800; color:#fff; margin:0;">Application Snapshots</h2>
          <span class="badge" style="font-size:11.5px; background:rgba(59, 130, 246, 0.12); border:1px solid rgba(59, 130, 246, 0.3); color:#60a5fa; font-weight:600; padding:2px 8px;">
            ${total} / ${maxLimit} Used
          </span>
        </div>
        <p style="font-size:12.5px; color:var(--text-muted); margin:4px 0 0 0;">
          Point-in-time full application checkpoints (SQLite database & storage files). Jump between any checkpoints without losing history.
        </p>
      </div>

      <div style="display:flex; align-items:center; gap:8px;">
        <button class="btn btn-primary" onclick="openCreateSnapshotModal()" style="font-size:12.5px; padding:6px 14px; font-weight:600;">
          + Create Snapshot
        </button>
        ${snapshots.length > 0 ? `
          <button class="btn btn-secondary btn-sm" onclick="openClearAllSnapshotsModal()" style="font-size:11.5px; padding:6px 10px; color:#f87171;">
            Clear All
          </button>
        ` : ''}
      </div>
    </div>
  `;

  // 2. Active Baseline Drift Card (clean left accent, no tacky icon box)
  let activeCardHtml = '';
  if (activeSnap) {
    const snapTime = new Date(activeSnap.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const recDelta = drift?.recordsDelta !== undefined
      ? (drift.recordsDelta >= 0 ? `+${drift.recordsDelta}` : `${drift.recordsDelta}`)
      : '0';
    const driftLabel = (drift?.recordsDelta !== 0 && drift?.recordsDelta !== undefined)
      ? `${recDelta} records`
      : 'Content modified';

    const statusBadge = isModified
      ? `<span class="badge badge-post" style="font-size:11px; background:rgba(245, 158, 11, 0.15); border-color:rgba(245, 158, 11, 0.4); color:#fbbf24; padding:2px 8px;">Live Data Modified (${driftLabel})</span>`
      : `<span class="badge badge-get" style="font-size:11px; background:rgba(16, 185, 129, 0.15); border-color:rgba(16, 185, 129, 0.4); color:#34d399; padding:2px 8px;">Live Matches Baseline</span>`;

    activeCardHtml = `
      <div style="background: var(--bg-card); border: 1px solid rgba(59, 130, 246, 0.35); border-left: 3px solid #3b82f6; border-radius: 8px; padding: 1.1rem 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.06em;">Active Restore Baseline:</span>
            <strong style="font-size: 15px; color: #fff;">${activeSnap.name}</strong>
            ${statusBadge}
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
            Captured on <strong style="color: #cbd5e1;">${snapTime}</strong> • ${activeSnap.totalRecords} records across ${activeSnap.totalCollections} collections
          </div>
        </div>

        <div>
          <button class="btn btn-warning btn-sm" onclick="openRestoreSnapshotModal('${activeSnap.id}')" style="font-weight:700; padding:6px 12px; font-size:12px;">
            Restore Baseline
          </button>
        </div>
      </div>
    `;
  }

  // 3. Snapshots Timeline / History List (clean minimalist rows, no tacky icons)
  let listHtml = '';
  if (snapshots.length > 0) {
    // Reverse chronologically so newest is at the top
    const displayList = [...snapshots].reverse();

    listHtml = `
      <div style="display:flex; flex-direction:column; gap:0.85rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
          <h3 style="font-size:13.5px; font-weight:700; color:#fff; margin:0;">
            Saved Checkpoints (${snapshots.length} of ${maxLimit})
          </h3>
          <span style="font-size:11.5px; color:var(--text-muted);">
            Oldest snapshot is automatically pruned when taking snapshot #11 after confirmation.
          </span>
        </div>

        <div style="display:grid; grid-template-columns:1fr; gap:0.65rem;">
          ${displayList.map((snap) => {
            const isSnapActive = activeSnap && snap.id === activeSnap.id;
            const snapTime = new Date(snap.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
            const storageKb = (snap.storageSizeBytes / 1024).toFixed(1);
            const dbKb = (snap.dbSizeBytes / 1024).toFixed(1);

            return `
              <div style="background:var(--bg-card); border:1px solid ${isSnapActive ? 'rgba(59, 130, 246, 0.45)' : 'var(--border-subtle)'}; border-left:${isSnapActive ? '3px solid #3b82f6' : '1px solid var(--border-subtle)'}; border-radius:8px; padding:1rem 1.25rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem; transition:border-color 0.15s ease;">
                <div style="flex:1; min-width:240px;">
                  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <h4 style="font-size:14px; font-weight:700; color:#fff; margin:0;">${snap.name}</h4>
                    ${isSnapActive ? `<span class="badge badge-get" style="font-size:10px; padding:2px 6px;">Active Baseline</span>` : ''}
                    <code style="font-size:10.5px; color:var(--text-muted); background:var(--bg-input); padding:2px 6px; border-radius:4px; font-family:var(--font-mono);">${snap.id}</code>
                  </div>
                  <div style="font-size:12px; color:var(--text-muted); margin-top:3px;">
                    ${snap.description ? `${snap.description} • ` : ''}Created on <strong style="color:#cbd5e1;">${snapTime}</strong>
                  </div>

                  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:8px; font-size:11.5px; color:var(--text-muted);">
                    <span><strong style="color:#60a5fa;">${snap.totalRecords}</strong> records</span>
                    <span style="opacity:0.35;">•</span>
                    <span><strong style="color:#fff;">${snap.totalCollections}</strong> collections</span>
                    <span style="opacity:0.35;">•</span>
                    <span><strong style="color:#cbd5e1;">${snap.totalFiles}</strong> files (${storageKb} KB)</span>
                    <span style="opacity:0.35;">•</span>
                    <span><strong style="color:#cbd5e1;">${dbKb} KB</strong> SQLite</span>
                  </div>
                </div>

                <div style="display:flex; align-items:center; gap:8px;">
                  <button class="btn btn-secondary btn-sm" onclick="openRestoreSnapshotModal('${snap.id}')" style="font-weight:600; font-size:11.5px; padding:5px 12px;">
                    Restore
                  </button>
                  <button class="btn btn-secondary btn-sm" onclick="deleteSnapshot('${snap.id}')" title="Delete snapshot" style="font-size:11px; padding:5px 10px; color:#f87171;">
                    Delete
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  } else {
    // Empty State (no tacky icons)
    listHtml = `
      <div style="background: var(--bg-card); border: 1px dashed var(--border-subtle); border-radius: 8px; padding: 2.5rem 1.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem;">
        <h2 style="font-size: 16px; font-weight: 700; color: #fff; margin: 0;">No Snapshots Saved Yet</h2>
        <p style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin: 0; max-width: 480px;">
          Capture full application state snapshots of your database and storage files. Restore from any point in time without losing newer checkpoints.
        </p>
        <button class="btn btn-primary" onclick="openCreateSnapshotModal()" style="font-size: 12.5px; padding: 6px 16px; margin-top: 0.5rem;">
          + Create First Snapshot
        </button>
      </div>
    `;
  }

  // 4. Feature Guide Card (clean and structured)
  const guideHtml = `
    <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.25rem;">
      <h3 style="font-size: 13.5px; font-weight: 700; color: #fff; margin-bottom: 0.75rem;">
        How Application Snapshots Work
      </h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem;">
        <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.85rem 1rem;">
          <div style="font-size: 12px; font-weight: 700; color: #60a5fa; margin-bottom: 4px;">1. Full State Checkpoints</div>
          <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4;">
            Captures atomic SQLite WAL database state and uploaded file assets into an independent, self-contained backup.
          </div>
        </div>
        <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.85rem 1rem;">
          <div style="font-size: 12px; font-weight: 700; color: #34d399; margin-bottom: 4px;">2. Non-Destructive Restore</div>
          <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4;">
            Restoring an earlier snapshot never destroys newer checkpoints. Jump backward and forward freely across your history.
          </div>
        </div>
        <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.85rem 1rem;">
          <div style="font-size: 12px; font-weight: 700; color: #fbbf24; margin-bottom: 4px;">3. 10-Snapshot Rolling Cap</div>
          <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4;">
            Stores up to 10 snapshots. If the limit is reached, you are prompted with a confirmation before the oldest snapshot is purged.
          </div>
        </div>
      </div>
      <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; font-size: 11.5px; color: var(--text-muted);">
        <span>CLI: <code style="color: #60a5fa;">npx nodestack snapshots list</code></span>
        <span>SDK: <code style="color: #60a5fa;">await client.snapshots.create({ name: 'Before migration' })</code></span>
      </div>
    </div>
  `;

  main.innerHTML = `
    <div style="max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; padding: 1rem 0;">
      ${headerHtml}
      ${activeCardHtml}
      ${listHtml}
      ${guideHtml}
    </div>
  `;
}

function updateDemoHomeCardUI() {
  const card = document.getElementById('demo-state-home-card');
  if (!card) return;

  const total = state.demo?.total || (state.demo?.snapshots?.length) || (state.demo?.hasSnapshot ? 1 : 0);
  const active = state.demo?.activeSnapshot || state.demo?.snapshot;

  if (state.demo && state.demo.hasSnapshot && active) {
    const drift = state.demo.liveStats?.drift;
    const isModified = Boolean(drift?.isModified);
    const recDelta = drift?.recordsDelta !== undefined
      ? (drift.recordsDelta >= 0 ? `+${drift.recordsDelta}` : `${drift.recordsDelta}`)
      : '0';

    const statusPill = isModified
      ? `<span class="badge badge-post" style="font-size:10.5px;">Live Data Modified (${recDelta} recs)</span>`
      : `<span class="badge badge-get" style="font-size:10.5px;">Clean Baseline</span>`;

    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
        <div style="display:flex; align-items:center; gap:8px;">
          <strong style="color:#fff; font-size:13px;">Snapshot: ${active.name}</strong>
          <span class="badge" style="font-size:10px; background:rgba(59, 130, 246, 0.15); color:#60a5fa;">${total}/10 saved</span>
          ${statusPill}
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button class="btn btn-warning btn-sm" onclick="openRestoreSnapshotModal('${active.id}')" style="font-weight:700; padding:3px 9px; font-size:11px;">
            Restore
          </button>
          <button class="btn btn-secondary btn-sm" onclick="selectNav('snapshots')" style="padding:3px 9px; font-size:11px;">
            Manage Snapshots →
          </button>
        </div>
      </div>
    `;
  } else {
    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
        <div>
          <span style="color:#fff; font-size:13px; font-weight:600;">Application Snapshots & Checkpoints</span>
          <span class="badge" style="font-size:10.5px; opacity:0.7; margin-left:6px;">No Snapshots Saved</span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="selectNav('snapshots')" style="padding:3px 9px; font-size:11px;">
          Open Snapshots →
        </button>
      </div>
    `;
  }
}

function updateDemoSettingsUI() {
  const container = document.getElementById('demo-settings-panel');
  if (!container) return;

  const total = state.demo?.total || (state.demo?.snapshots?.length) || (state.demo?.hasSnapshot ? 1 : 0);
  const active = state.demo?.activeSnapshot || state.demo?.snapshot;

  if (state.demo && state.demo.hasSnapshot && active) {
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.85rem; font-size:13px;">
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-subtle); padding-bottom:0.5rem;">
          <span style="color:var(--text-muted);">Snapshots Saved</span>
          <strong style="color:#60a5fa;">${total} of 10 max</strong>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-subtle); padding-bottom:0.5rem;">
          <span style="color:var(--text-muted);">Active Baseline</span>
          <strong style="color:#fff;">${active.name}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-subtle); padding-bottom:0.5rem;">
          <span style="color:var(--text-muted);">Created At</span>
          <code>${new Date(active.createdAt).toLocaleString()}</code>
        </div>
        <div style="display:flex; gap:8px; margin-top:0.5rem;">
          <button class="btn btn-warning btn-sm" onclick="openRestoreSnapshotModal('${active.id}')">Restore Active</button>
          <button class="btn btn-secondary btn-sm" onclick="selectNav('snapshots')">Manage Snapshots (${total}) →</button>
          <button class="btn btn-danger btn-sm" onclick="openClearAllSnapshotsModal()">Clear All Snapshots</button>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:1rem;">
        No application snapshots created yet. Freeze your database and file storage state to enable 1-click restore.
      </p>
      <button class="btn btn-primary btn-sm" onclick="openCreateSnapshotModal()">+ Take Application Snapshot</button>
    `;
  }
}

// ==========================================
// Create Snapshot Modal (with 10-limit confirmation)
// ==========================================

function openCreateSnapshotModal() {
  const modal = document.getElementById('modal-root');
  const collectionsCount = state.collections ? state.collections.length : 0;
  const snapshots = state.demo?.snapshots || [];
  const total = state.demo?.total || snapshots.length;
  const maxLimit = state.demo?.maxLimit || 10;
  const isAtLimit = total >= maxLimit;
  const oldestSnapshot = snapshots.length > 0 ? snapshots[0] : null;

  let limitWarningHtml = '';
  if (isAtLimit && oldestSnapshot) {
    const oldestDate = new Date(oldestSnapshot.createdAt).toLocaleString();
    limitWarningHtml = `
      <div style="background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.3); border-radius:8px; padding:0.85rem 1rem;">
        <div style="font-size:13px; font-weight:700; color:#f87171; margin-bottom:4px;">
          Snapshot Capacity Limit Reached (${total} / ${maxLimit})
        </div>
        <div style="font-size:12px; color:#cbd5e1; line-height:1.4;">
          Taking this new snapshot will <strong>permanently delete the oldest snapshot</strong>:
        </div>
        <div style="margin-top:6px; background:rgba(0,0,0,0.25); border:1px solid rgba(239, 68, 68, 0.2); border-radius:6px; padding:6px 10px; font-size:11.5px;">
          <strong style="color:#fff;">${oldestSnapshot.name}</strong> • ${oldestDate} (${oldestSnapshot.totalRecords} records)
        </div>
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:480px;">
        <div class="modal-header">
          <div>
            <h2 class="modal-title" style="font-size:16px;">Create Application Snapshot</h2>
            <span style="font-size:11px; color:var(--text-muted);">
              ${isAtLimit ? 'Confirm replacement of oldest snapshot' : `Checkpoint ${total + 1} of ${maxLimit}`}
            </span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
        </div>

        <div class="modal-body" style="display:flex; flex-direction:column; gap:1rem;">
          ${limitWarningHtml}

          <div style="background:var(--bg-input); border:1px solid var(--border-subtle); border-radius:8px; padding:0.85rem 1rem; display:flex; align-items:center; justify-content:space-between;">
            <div>
              <div style="font-size:11px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Active Application State</div>
              <div style="font-size:14px; font-weight:700; color:#fff; margin-top:2px;">${collectionsCount} Collections Active</div>
            </div>
            <span class="badge badge-get" style="font-size:11px;">SQLite WAL & Storage</span>
          </div>

          <div class="form-group" style="margin:0;">
            <label class="form-label">Snapshot Name / Label</label>
            <input type="text" class="form-input" id="snapshot-modal-name" value="Snapshot #${total + 1}" placeholder="e.g. Before schema migration" autofocus>
          </div>

          <div class="form-group" style="margin:0;">
            <label class="form-label">Description (Optional)</label>
            <input type="text" class="form-input" id="snapshot-modal-desc" placeholder="e.g. State before bulk import or demo pitch">
          </div>
        </div>

        <div class="modal-footer" style="padding:0.75rem 1.25rem;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn ${isAtLimit ? 'btn-warning' : 'btn-primary'}" id="btn-submit-snapshot" onclick="submitCreateSnapshot(${isAtLimit ? 'true' : 'false'})">
            <span>${isAtLimit ? 'Confirm & Evict Oldest' : 'Create Snapshot'}</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

async function submitCreateSnapshot(evictOldest = false) {
  const btn = document.getElementById('btn-submit-snapshot');
  const name = document.getElementById('snapshot-modal-name')?.value || 'Application Snapshot';
  const description = document.getElementById('snapshot-modal-desc')?.value || '';

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <div style="width:13px; height:13px; border:2px solid #ffffff; border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite; display:inline-block; margin-right:4px;"></div>
      <span>Capturing State...</span>
    `;
  }

  try {
    const res = await api('/api/snapshots', {
      method: 'POST',
      body: JSON.stringify({ name, description, evictOldest }),
    });

    toast(`Snapshot '${res.name}' created! (${res.totalRecords} records preserved)`, 'success');
    closeModal();
    await fetchDemoStatus();
  } catch (err) {
    if (err?.data?.code === 'SNAPSHOT_LIMIT_REACHED' || err?.message?.includes('Snapshot limit')) {
      toast(err.message, 'warning');
      closeModal();
      openEvictionConfirmationModal(name, description, err?.data?.oldestSnapshot);
      return;
    }

    toast(`Failed to create snapshot: ${err.message || String(err)}`, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>Create Snapshot</span>`;
    }
  }
}

function openEvictionConfirmationModal(name, description, oldest) {
  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:460px;">
        <div class="modal-header" style="border-bottom-color:rgba(239, 68, 68, 0.3);">
          <div>
            <h2 class="modal-title" style="font-size:16px; color:#f87171;">Snapshot Limit Reached</h2>
            <span style="font-size:11px; color:var(--text-muted);">Maximum 10 snapshots allowed</span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
        </div>

        <div class="modal-body" style="display:flex; flex-direction:column; gap:1rem;">
          <p style="font-size:13px; color:#cbd5e1; margin:0; line-height:1.5;">
            You have already reached the maximum storage capacity of <strong>10 snapshots</strong>.
            Creating <strong>'${name}'</strong> will permanently evict and delete your oldest snapshot:
          </p>

          ${oldest ? `
            <div style="background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.3); border-radius:8px; padding:0.85rem 1rem;">
              <strong style="color:#fff; font-size:13px;">${oldest.name}</strong>
              <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">
                Created: ${new Date(oldest.createdAt).toLocaleString()}
              </div>
            </div>
          ` : ''}

          <p style="font-size:12px; color:var(--text-muted); margin:0;">
            Do you want to proceed and replace the oldest snapshot?
          </p>
        </div>

        <div class="modal-footer" style="padding:0.75rem 1.25rem;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-warning" id="btn-confirm-evict" onclick="executeEvictionAndCreate('${encodeURIComponent(name)}', '${encodeURIComponent(description)}')">
            <span>Proceed & Delete Oldest</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

async function executeEvictionAndCreate(encodedName, encodedDesc) {
  const name = decodeURIComponent(encodedName);
  const description = decodeURIComponent(encodedDesc);
  const btn = document.getElementById('btn-confirm-evict');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>Saving...</span>`;
  }

  try {
    const res = await api('/api/snapshots', {
      method: 'POST',
      body: JSON.stringify({ name, description, evictOldest: true }),
    });

    toast(`Snapshot '${res.name}' created! (Oldest snapshot evicted)`, 'success');
    closeModal();
    await fetchDemoStatus();
  } catch (err) {
    toast(`Failed to take snapshot: ${err.message || String(err)}`, 'error');
    if (btn) btn.disabled = false;
  }
}

// ==========================================
// Restore Snapshot Modal
// ==========================================

function openRestoreSnapshotModal(snapshotId) {
  const snapshots = state.demo?.snapshots || [];
  const snap = snapshots.find((s) => s.id === snapshotId) || state.demo?.activeSnapshot || state.demo?.snapshot;
  if (!snap) return;

  const snapTime = new Date(snap.createdAt).toLocaleString();
  const modal = document.getElementById('modal-root');

  modal.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width:480px;">
        <div class="modal-header" style="border-bottom-color:rgba(245, 158, 11, 0.25);">
          <div>
            <h2 class="modal-title" style="font-size:16px; color:#fbbf24;">Restore Application Snapshot</h2>
            <span style="font-size:11px; color:var(--text-muted);">Safe non-destructive restoration</span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
        </div>

        <div class="modal-body" style="display:flex; flex-direction:column; gap:1rem;">
          <div style="background:rgba(245, 158, 11, 0.08); border:1px solid rgba(245, 158, 11, 0.3); border-radius:8px; padding:0.85rem 1rem;">
            <div style="font-size:13px; font-weight:700; color:#fbbf24; margin-bottom:4px;">
              Restore checkpoint '${snap.name}'?
            </div>
            <div style="font-size:12px; color:#e2e8f0; line-height:1.4;">
              Your live database and uploaded files will be reverted to this checkpoint taken on <strong style="color:#fff;">${snapTime}</strong>.
            </div>
          </div>

          <div style="background:var(--bg-input); border:1px solid var(--border-subtle); border-radius:8px; padding:0.85rem 1rem; display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
            <div>
              <div style="font-size:11px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Collections</div>
              <div style="font-size:15px; font-weight:700; color:#fff; margin-top:2px;">${snap.totalCollections} Collections</div>
            </div>
            <div>
              <div style="font-size:11px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Records</div>
              <div style="font-size:15px; font-weight:700; color:#60a5fa; margin-top:2px;">${snap.totalRecords} Records</div>
            </div>
          </div>

          <div style="font-size:12px; color:#34d399; background:rgba(16, 185, 129, 0.08); border:1px solid rgba(16, 185, 129, 0.25); border-radius:6px; padding:0.6rem 0.85rem;">
            Safe restoration: Older and newer snapshots in your history will remain safe and unaffected.
          </div>
        </div>

        <div class="modal-footer" style="padding:0.75rem 1.25rem;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-warning" id="btn-submit-restore-snap" onclick="submitRestoreSnapshot('${snap.id}')" style="font-weight:700;">
            <span>Restore Checkpoint Now</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

async function submitRestoreSnapshot(snapshotId) {
  const btn = document.getElementById('btn-submit-restore-snap');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <div style="width:13px; height:13px; border:2px solid #ffffff; border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite; display:inline-block; margin-right:4px;"></div>
      <span>Restoring State...</span>
    `;
  }

  try {
    const res = await api(`/api/snapshots/${encodeURIComponent(snapshotId)}/restore`, {
      method: 'POST',
    });

    toast(`Restored '${res.snapshot.name}' in ${res.durationMs}ms (${res.snapshot.totalRecords} records restored)`, 'success');
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
    toast(`Failed to restore: ${err.message || String(err)}`, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Restore Checkpoint Now</span>';
    }
  }
}

// Delete single snapshot
async function deleteSnapshot(snapshotId) {
  const snapshots = state.demo?.snapshots || [];
  const target = snapshots.find((s) => s.id === snapshotId);
  const label = target ? target.name : snapshotId;

  if (!confirm(`Are you sure you want to delete snapshot '${label}'?`)) return;

  try {
    await api(`/api/snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
    toast(`Snapshot '${label}' deleted`, 'info');
    await fetchDemoStatus();
  } catch (err) {
    toast(`Failed to delete snapshot: ${err.message || String(err)}`, 'error');
  }
}

// Clear all snapshots
async function openClearAllSnapshotsModal() {
  if (!confirm('Are you sure you want to delete ALL application snapshots? This cannot be undone.')) return;
  try {
    await api('/api/snapshots', { method: 'DELETE' });
    toast('All snapshots deleted', 'info');
    await fetchDemoStatus();
  } catch (err) {
    toast(`Failed to clear snapshots: ${err.message || String(err)}`, 'error');
  }
}

// Backwards compatibility aliases for existing buttons / triggers
function openSnapshotDemoModal() {
  openCreateSnapshotModal();
}

function openResetDemoModal() {
  const activeId = state.demo?.activeSnapshot?.id || state.demo?.snapshot?.id;
  if (activeId) {
    openRestoreSnapshotModal(activeId);
  } else {
    openCreateSnapshotModal();
  }
}

function openClearDemoModal() {
  openClearAllSnapshotsModal();
}
