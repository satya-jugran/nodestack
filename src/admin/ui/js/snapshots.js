// Application Snapshots & State Management ("Take Snapshot", "Restore Checkpoint", "10-Snapshot FIFO Retention")

async function fetchDemoStatus() {
  try {
    const res = await api('/api/snapshots');
    state.demo = res || { hasSnapshot: false, snapshots: [], total: 0, maxLimit: 10, snapshot: null, activeSnapshot: null };
  } catch {
    state.demo = { hasSnapshot: false, snapshots: [], total: 0, maxLimit: 10, snapshot: null, activeSnapshot: null };
  }

  // Also fetch scheduled snapshot backup if snapshot service is supported
  if (state.demo && state.demo.supported !== false) {
    try {
      const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
      const cronUrl = slug && slug !== 'default' ? `/api/apps/${slug}/cron/schedules?targetType=snapshot` : '/api/cron/schedules?targetType=snapshot';
      const cronRes = await api(cronUrl);
      const schedules = Array.isArray(cronRes) ? cronRes : (cronRes && cronRes.schedules ? cronRes.schedules : []);
      state.snapshotSchedule = schedules.length > 0 ? schedules[0] : null;
    } catch (_) {
      state.snapshotSchedule = null;
    }
  } else {
    state.snapshotSchedule = null;
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

  if (state.demo && state.demo.supported === false) {
    dot.style.display = 'none';
    return;
  }

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

  if (demoState && demoState.supported === false) {
    const providerName = (demoState.provider || 'remote').toUpperCase();
    const appName = state.activeApp?.name || 'Default App';
    main.innerHTML = `
      <div style="width: 100%; max-width: 800px; margin: 2rem auto; display: flex; flex-direction: column; gap: 1.5rem;">
        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 2.5rem 2rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1rem; box-shadow: 0 4px 14px rgba(0,0,0,0.06);">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.25); display: flex; align-items: center; justify-content: center; font-size: 26px;">
            📸
          </div>
          <div>
            <h3 style="font-size: 18px; font-weight: 800; color: var(--text-heading); margin: 0 0 8px 0;">
              In-App Snapshots are Exclusive to SQLite Applications
            </h3>
            <p style="font-size: 13px; color: var(--text-muted); line-height: 1.55; margin: 0; max-width: 560px;">
              <strong>${appName}</strong> is currently running on <strong>${providerName}</strong>. In-app snapshots are designed for zero-overhead dev, test, and demo checkpoints on embedded SQLite. For production databases, use native cloud backups and automated disaster recovery tools.
            </p>
          </div>
          <div style="display: flex; gap: 10px; margin-top: 0.5rem;">
            <button class="btn btn-secondary btn-sm" onclick="selectNav('database')" style="font-weight: 600; padding: 6px 14px;">
              Configure Database Engine
            </button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // 1. Top Header Bar
  const headerHtml = `
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem; padding-bottom:0.75rem; border-bottom:1px solid var(--border-subtle);">
      <div>
        <div style="display:flex; align-items:center; gap:10px;">
          <h2 style="font-size:18px; font-weight:800; color: var(--text-heading); margin:0;">Application Snapshots</h2>
          <span class="badge" class="badge badge-primary" style="font-size:11.5px; font-weight:600; padding:2px 8px;">
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
      ? `<span class="badge badge-warning" style="font-size:11px; padding:2px 8px;">Live Data Modified (${driftLabel})</span>`
      : `<span class="badge badge-success" style="font-size:11px; padding:2px 8px;">Live Matches Baseline</span>`;

    activeCardHtml = `
      <div style="background: var(--bg-card); border: 1px solid rgba(59, 130, 246, 0.35); border-left: 3px solid #3b82f6; border-radius: 8px; padding: 1.1rem 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.06em;">Active Restore Baseline:</span>
            <strong style="font-size: 15px; color: var(--text-heading);">${activeSnap.name}</strong>
            ${statusBadge}
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
            Captured on <strong style="color: var(--text-heading);">${snapTime}</strong> • ${activeSnap.totalRecords} records across ${activeSnap.totalCollections} collections
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
          <h3 style="font-size:13.5px; font-weight:700; color: var(--text-heading); margin:0;">
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
                    <h4 style="font-size:14px; font-weight:700; color: var(--text-heading); margin:0;">${snap.name}</h4>
                    ${isSnapActive ? `<span class="badge badge-get" style="font-size:10px; padding:2px 6px;">Active Baseline</span>` : ''}
                    <code style="font-size:10.5px; color:var(--text-muted); background:var(--bg-input); padding:2px 6px; border-radius:4px; font-family:var(--font-mono);">${snap.id}</code>
                  </div>
                  <div style="font-size:12px; color:var(--text-muted); margin-top:3px;">
                    ${snap.description ? `${snap.description} • ` : ''}Created on <strong style="color:var(--text-heading);">${snapTime}</strong>
                  </div>

                  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:8px; font-size:11.5px; color:var(--text-muted);">
                    <span><strong style="color:var(--accent-primary);">${snap.totalRecords}</strong> records</span>
                    <span style="opacity:0.35;">•</span>
                    <span><strong style="color: var(--text-heading);">${snap.totalCollections}</strong> collections</span>
                    <span style="opacity:0.35;">•</span>
                    <span><strong style="color:var(--text-heading);">${snap.totalFiles}</strong> files (${storageKb} KB)</span>
                    <span style="opacity:0.35;">•</span>
                    <span><strong style="color:var(--text-heading);">${dbKb} KB</strong> SQLite</span>
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
        <h2 style="font-size: 16px; font-weight: 700; color: var(--text-heading); margin: 0;">No Snapshots Saved Yet</h2>
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
      <h3 style="font-size: 13.5px; font-weight: 700; color: var(--text-heading); margin-bottom: 0.75rem;">
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
          <div style="font-size: 12px; font-weight: 700; color: var(--accent-success); margin-bottom: 4px;">2. Non-Destructive Restore</div>
          <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4;">
            Restoring an earlier snapshot never destroys newer checkpoints. Jump backward and forward freely across your history.
          </div>
        </div>
        <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.85rem 1rem;">
          <div style="font-size: 12px; font-weight: 700; color: var(--accent-warning); margin-bottom: 4px;">3. 10-Snapshot Rolling Cap</div>
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
      ${renderScheduledBackupsCardHtml()}
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
          <strong style="color: var(--text-heading); font-size:13px;">Snapshot: ${active.name}</strong>
          <span class="badge badge-primary" style="font-size:10px;">${total}/10 saved</span>
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
          <span style="color: var(--text-heading); font-size:13px; font-weight:600;">Application Snapshots & Checkpoints</span>
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
          <strong style="color: var(--text-heading);">${active.name}</strong>
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
        <div style="font-size:13px; font-weight:700; color:var(--accent-danger); margin-bottom:4px;">
          Snapshot Capacity Limit Reached (${total} / ${maxLimit})
        </div>
        <div style="font-size:12px; color:var(--text-main); line-height:1.4;">
          Taking this new snapshot will <strong>permanently delete the oldest snapshot</strong>:
        </div>
        <div style="margin-top:6px; background:rgba(0,0,0,0.25); border:1px solid rgba(239, 68, 68, 0.2); border-radius:6px; padding:6px 10px; font-size:11.5px;">
          <strong style="color: var(--text-heading);">${oldestSnapshot.name}</strong> • ${oldestDate} (${oldestSnapshot.totalRecords} records)
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
              <div style="font-size:14px; font-weight:700; color: var(--text-heading); margin-top:2px;">${collectionsCount} Collections Active</div>
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
            <h2 class="modal-title" style="font-size:16px; color:var(--accent-danger);">Snapshot Limit Reached</h2>
            <span style="font-size:11px; color:var(--text-muted);">Maximum 10 snapshots allowed</span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
        </div>

        <div class="modal-body" style="display:flex; flex-direction:column; gap:1rem;">
          <p style="font-size:13px; color:var(--text-main); margin:0; line-height:1.5;">
            You have already reached the maximum storage capacity of <strong>10 snapshots</strong>.
            Creating <strong>'${name}'</strong> will permanently evict and delete your oldest snapshot:
          </p>

          ${oldest ? `
            <div style="background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.3); border-radius:8px; padding:0.85rem 1rem;">
              <strong style="color: var(--text-heading); font-size:13px;">${oldest.name}</strong>
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
            <h2 class="modal-title" style="font-size:16px; color:var(--accent-warning);">Restore Application Snapshot</h2>
            <span style="font-size:11px; color:var(--text-muted);">Safe non-destructive restoration</span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
        </div>

        <div class="modal-body" style="display:flex; flex-direction:column; gap:1rem;">
          <div style="background:rgba(245, 158, 11, 0.08); border:1px solid rgba(245, 158, 11, 0.3); border-radius:8px; padding:0.85rem 1rem;">
            <div style="font-size:13px; font-weight:700; color:var(--accent-warning); margin-bottom:4px;">
              Restore checkpoint '${snap.name}'?
            </div>
            <div style="font-size:12px; color:#e2e8f0; line-height:1.4;">
              Your live database and uploaded files will be reverted to this checkpoint taken on <strong style="color: var(--text-heading);">${snapTime}</strong>.
            </div>
          </div>

          <div style="background:var(--bg-input); border:1px solid var(--border-subtle); border-radius:8px; padding:0.85rem 1rem; display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
            <div>
              <div style="font-size:11px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Collections</div>
              <div style="font-size:15px; font-weight:700; color: var(--text-heading); margin-top:2px;">${snap.totalCollections} Collections</div>
            </div>
            <div>
              <div style="font-size:11px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Records</div>
              <div style="font-size:15px; font-weight:700; color:#60a5fa; margin-top:2px;">${snap.totalRecords} Records</div>
            </div>
          </div>

          <div style="font-size:12px; color:var(--accent-success); background:var(--accent-success-subtle); border:1px solid var(--border-subtle); border-radius:6px; padding:0.6rem 0.85rem;">
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

  const safeLabel = typeof escapeHtml === 'function' ? escapeHtml(label) : label;
  const confirmed = typeof showConfirmDialog === 'function'
    ? await showConfirmDialog({
        title: 'Delete Snapshot',
        message: `Are you sure you want to delete snapshot <strong style="color: var(--text-heading); font-family: var(--font-mono);">${safeLabel}</strong>?`,
        messageText: `Are you sure you want to delete snapshot '${label}'?`,
        warning: 'This action cannot be undone. The snapshot data will be permanently removed.',
        warningType: 'danger',
        confirmText: 'Delete Snapshot',
        cancelText: 'Cancel',
        variant: 'danger',
        icon: '⚠️',
      })
    : confirm(`Are you sure you want to delete snapshot '${label}'?`);
  if (!confirmed) return;

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
  const confirmed = typeof showConfirmDialog === 'function'
    ? await showConfirmDialog({
        title: 'Delete All Snapshots',
        message: 'Are you sure you want to delete ALL application snapshots?',
        messageText: 'Are you sure you want to delete ALL application snapshots? This cannot be undone.',
        warning: 'This action cannot be undone. All stored application snapshots will be permanently removed.',
        warningType: 'danger',
        confirmText: 'Delete All Snapshots',
        cancelText: 'Cancel',
        variant: 'danger',
        icon: '⚠️',
      })
    : confirm('Are you sure you want to delete ALL application snapshots? This cannot be undone.');
  if (!confirmed) return;
  try {
    await api('/api/snapshots', { method: 'DELETE' });
    toast('All snapshots deleted', 'info');
    await fetchDemoStatus();
  } catch (err) {
    toast(`Failed to clear snapshots: ${err.message || String(err)}`, 'error');
  }
}

// ==========================================
// Automated Scheduled Backups (SQLite)
// ==========================================

function renderScheduledBackupsCardHtml() {
  const sched = state.snapshotSchedule;
  const isEnabled = sched && sched.enabled;
  const nextRun = sched?.nextRunAt ? new Date(sched.nextRunAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled';

  return `
    <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.85rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 32px; height: 32px; border-radius: 6px; background: rgba(16, 185, 129, 0.12); display: flex; align-items: center; justify-content: center; font-size: 16px;">
            ⏱️
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <h3 style="font-size: 14px; font-weight: 700; color: var(--text-heading); margin: 0;">Automated Scheduled Backups</h3>
              ${isEnabled
                ? `<span class="badge badge-success" style="font-size: 10.5px; padding: 2px 7px;">● Active</span>`
                : `<span class="badge" style="font-size: 10.5px; padding: 2px 7px; background: var(--bg-input); color: var(--text-muted);">○ ${sched ? 'Paused' : 'Not Configured'}</span>`
              }
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              ${sched
                ? `Recurring schedule: <code style="font-family: var(--font-mono); font-size: 11px; background: var(--bg-input); padding: 1px 5px; border-radius: 3px;">${escapeHtml(sched.cronExpression)}</code> (${escapeHtml(sched.timezone || 'UTC')}) • Next run: <strong>${nextRun}</strong>`
                : 'Automatically capture point-in-time snapshots of database and storage files on a recurring schedule.'
              }
            </div>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 8px;">
          ${sched ? `
            <button class="btn btn-secondary btn-sm" onclick="triggerSnapshotScheduleNow('${sched.id}')" style="font-size: 11.5px; padding: 5px 10px;" title="Trigger immediate backup">
              ▶ Run Backup Now
            </button>
            <button class="btn btn-secondary btn-sm" onclick="toggleSnapshotSchedule('${sched.id}', ${!isEnabled})" style="font-size: 11.5px; padding: 5px 10px;">
              ${isEnabled ? 'Pause' : 'Resume'}
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openSnapshotScheduleModal()" style="font-size: 11.5px; padding: 5px 10px; font-weight: 600;">
              ⚙️ Configure
            </button>
          ` : `
            <button class="btn btn-primary btn-sm" onclick="openSnapshotScheduleModal()" style="font-size: 12px; padding: 5px 12px; font-weight: 600;">
              + Set Up Automated Backups
            </button>
          `}
        </div>
      </div>
    </div>
  `;
}

function openSnapshotScheduleModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;

  const existing = state.snapshotSchedule;
  const currentExpr = existing?.cronExpression || '0 2 * * *';
  const currentTz = existing?.timezone || 'UTC';
  const currentPolicy = existing?.missedRunPolicy || 'catch_up_once';
  const isEnabled = existing ? existing.enabled : true;

  let presetVal = 'custom';
  if (currentExpr === '0 2 * * *') presetVal = 'daily_2am';
  else if (currentExpr === '0 0 * * *') presetVal = 'daily_midnight';
  else if (currentExpr === '0 3 * * 0') presetVal = 'weekly_sun';
  else if (currentExpr === '0 * * * *') presetVal = 'hourly';

  root.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal" onclick="event.stopPropagation()" style="max-width: 520px; width: 100%;">
        <div class="modal-header">
          <div>
            <h2 class="modal-title" style="font-size: 16px;">Automated Backup Schedule</h2>
            <span style="font-size: 11px; color: var(--text-muted);">Periodic SQLite database & storage snapshots</span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
        </div>

        <form onsubmit="saveSnapshotScheduleModal(event)">
          <div class="modal-body" style="display: flex; flex-direction: column; gap: 1rem;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Frequency Preset</label>
              <select id="snap-sched-preset" class="form-select" onchange="handleSnapshotSchedulePresetChange(this.value)">
                <option value="daily_2am" ${presetVal === 'daily_2am' ? 'selected' : ''}>Daily at 02:00 AM (Recommended)</option>
                <option value="daily_midnight" ${presetVal === 'daily_midnight' ? 'selected' : ''}>Daily at Midnight (00:00)</option>
                <option value="weekly_sun" ${presetVal === 'weekly_sun' ? 'selected' : ''}>Weekly on Sunday at 03:00 AM</option>
                <option value="hourly" ${presetVal === 'hourly' ? 'selected' : ''}>Hourly (At minute 0)</option>
                <option value="custom" ${presetVal === 'custom' ? 'selected' : ''}>Custom 5-Field Cron Expression</option>
              </select>
            </div>

            <div id="snap-sched-custom-group" style="display: ${presetVal === 'custom' ? 'block' : 'none'};">
              <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Cron Expression</label>
              <input type="text" id="snap-sched-expr" class="input" style="width: 100%; font-family: var(--font-mono); font-size: 12px;" value="${escapeHtml(currentExpr)}" placeholder="0 2 * * *" oninput="updateSnapshotScheduleModalPreview()">
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Timezone</label>
                <input type="text" id="snap-sched-tz" class="input" list="iana-timezones-list" style="width: 100%; font-size: 12px;" value="${escapeHtml(currentTz)}" placeholder="UTC" oninput="updateSnapshotScheduleModalPreview()">
              </div>
              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Missed Run Policy</label>
                <select id="snap-sched-policy" class="form-select">
                  <option value="catch_up_once" ${currentPolicy === 'catch_up_once' ? 'selected' : ''}>Catch-up once on reboot</option>
                  <option value="skip" ${currentPolicy === 'skip' ? 'selected' : ''}>Skip missed backups</option>
                  <option value="catch_up_all" ${currentPolicy === 'catch_up_all' ? 'selected' : ''}>Replay all missed (up to 10)</option>
                </select>
              </div>
            </div>

            <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0.75rem 0.85rem;">
              <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">Next Execution Preview</div>
              <div id="snap-sched-preview" style="font-size: 12px; color: var(--accent-success); font-family: var(--font-mono);">Calculating...</div>
            </div>

            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" id="snap-sched-enabled" ${isEnabled ? 'checked' : ''} style="cursor: pointer;">
              <label for="snap-sched-enabled" style="font-size: 12px; font-weight: 600; cursor: pointer;">Enable Automated Schedule</label>
            </div>

            <div style="font-size: 11.5px; color: var(--text-muted); line-height: 1.4; border-top: 1px solid var(--border-subtle); padding-top: 0.5rem;">
              ℹ️ Backups automatically capture the SQLite database & file assets. When the 10-snapshot storage limit is reached, automated backups evict the oldest unprotected snapshot.
            </div>
          </div>

          <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              ${existing ? `
                <button type="button" class="btn btn-secondary btn-sm" onclick="deleteSnapshotSchedule('${existing.id}')" style="color: var(--accent-danger);">
                  Remove Schedule
                </button>
              ` : '<span></span>'}
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
              <button type="submit" class="btn btn-primary" style="font-weight: 600;">Save Schedule</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;

  updateSnapshotScheduleModalPreview();
}

function handleSnapshotSchedulePresetChange(preset) {
  const customGroup = document.getElementById('snap-sched-custom-group');
  const exprInput = document.getElementById('snap-sched-expr');
  if (!exprInput) return;

  if (preset === 'daily_2am') {
    exprInput.value = '0 2 * * *';
    if (customGroup) customGroup.style.display = 'none';
  } else if (preset === 'daily_midnight') {
    exprInput.value = '0 0 * * *';
    if (customGroup) customGroup.style.display = 'none';
  } else if (preset === 'weekly_sun') {
    exprInput.value = '0 3 * * 0';
    if (customGroup) customGroup.style.display = 'none';
  } else if (preset === 'hourly') {
    exprInput.value = '0 * * * *';
    if (customGroup) customGroup.style.display = 'none';
  } else {
    if (customGroup) customGroup.style.display = 'block';
  }
  updateSnapshotScheduleModalPreview();
}

let snapSchedPreviewTimer = null;
function updateSnapshotScheduleModalPreview() {
  clearTimeout(snapSchedPreviewTimer);
  snapSchedPreviewTimer = setTimeout(async () => {
    const previewEl = document.getElementById('snap-sched-preview');
    const exprInput = document.getElementById('snap-sched-expr');
    const tzInput = document.getElementById('snap-sched-tz');
    if (!previewEl || !exprInput) return;

    const expr = exprInput.value.trim();
    const tz = tzInput ? tzInput.value.trim() || 'UTC' : 'UTC';

    if (!expr || expr.split(/\s+/).length < 5) {
      previewEl.textContent = 'Enter a valid 5-field cron expression';
      previewEl.style.color = 'var(--text-muted)';
      return;
    }

    try {
      const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
      const url = slug && slug !== 'default' ? `/api/apps/${slug}/cron/preview` : '/api/cron/preview';
      const res = await api(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cronExpression: expr, timezone: tz, count: 3 }),
      });

      if (res && res.valid && Array.isArray(res.nextRuns) && res.nextRuns.length > 0) {
        previewEl.innerHTML = res.nextRuns.map((r, i) => `<div>${i + 1}. ${escapeHtml(r.zonedFormatted || r.formattedTz || '')} (${escapeHtml(r.isoUtc || r.formattedUtc || '')})</div>`).join('');
        previewEl.style.color = 'var(--accent-success)';
      } else {
        previewEl.textContent = res?.error || 'Invalid cron expression';
        previewEl.style.color = 'var(--accent-danger)';
      }
    } catch (_) {
      previewEl.textContent = 'Invalid expression or timezone';
      previewEl.style.color = 'var(--accent-danger)';
    }
  }, 300);
}

async function saveSnapshotScheduleModal(e) {
  e.preventDefault();
  const exprInput = document.getElementById('snap-sched-expr');
  const tzInput = document.getElementById('snap-sched-tz');
  const policyInput = document.getElementById('snap-sched-policy');
  const enabledInput = document.getElementById('snap-sched-enabled');

  const cronExpression = exprInput ? exprInput.value.trim() : '0 2 * * *';
  const timezone = tzInput ? tzInput.value.trim() || 'UTC' : 'UTC';
  const missedRunPolicy = policyInput ? policyInput.value : 'catch_up_once';
  const enabled = enabledInput ? enabledInput.checked : true;

  const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
  const baseUrl = slug && slug !== 'default' ? `/api/apps/${slug}/cron/schedules` : '/api/cron/schedules';

  try {
    if (state.snapshotSchedule && state.snapshotSchedule.id) {
      await api(`${baseUrl}/${state.snapshotSchedule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cronExpression,
          timezone,
          missedRunPolicy,
          enabled,
          payload: { evictOldest: true, description: 'Automated scheduled backup' },
        }),
      });
      toast('Automated backup schedule updated', 'success');
    } else {
      await api(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Automated Snapshot Backup',
          targetType: 'snapshot',
          targetId: 'snapshot_auto',
          cronExpression,
          timezone,
          missedRunPolicy,
          enabled,
          payload: { evictOldest: true, description: 'Automated scheduled backup' },
        }),
      });
      toast('Automated backup schedule created', 'success');
    }
    closeModal();
    await fetchDemoStatus();
  } catch (err) {
    toast(`Failed to save schedule: ${err.message || String(err)}`, 'error');
  }
}

async function toggleSnapshotSchedule(id, enable) {
  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const baseUrl = slug && slug !== 'default' ? `/api/apps/${slug}/cron/schedules` : '/api/cron/schedules';
    await api(`${baseUrl}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enable }),
    });
    toast(enable ? 'Automated backup schedule resumed' : 'Automated backup schedule paused', 'info');
    await fetchDemoStatus();
  } catch (err) {
    toast(`Failed to toggle schedule: ${err.message || String(err)}`, 'error');
  }
}

async function triggerSnapshotScheduleNow(id) {
  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const baseUrl = slug && slug !== 'default' ? `/api/apps/${slug}/cron/schedules` : '/api/cron/schedules';
    toast('Triggering snapshot backup...', 'info');
    await api(`${baseUrl}/${id}/trigger`, { method: 'POST' });
    toast('Snapshot backup completed successfully', 'success');
    await fetchDemoStatus();
  } catch (err) {
    toast(`Failed to run backup: ${err.message || String(err)}`, 'error');
  }
}

async function deleteSnapshotSchedule(id) {
  if (!confirm('Are you sure you want to remove the automated snapshot schedule?')) return;
  try {
    const slug = typeof getActiveAppSlug === 'function' ? getActiveAppSlug() : 'default';
    const baseUrl = slug && slug !== 'default' ? `/api/apps/${slug}/cron/schedules` : '/api/cron/schedules';
    await api(`${baseUrl}/${id}`, { method: 'DELETE' });
    toast('Automated backup schedule removed', 'info');
    closeModal();
    await fetchDemoStatus();
  } catch (err) {
    toast(`Failed to delete schedule: ${err.message || String(err)}`, 'error');
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

if (typeof window !== 'undefined') {
  window.renderScheduledBackupsCardHtml = renderScheduledBackupsCardHtml;
  window.openSnapshotScheduleModal = openSnapshotScheduleModal;
  window.handleSnapshotSchedulePresetChange = handleSnapshotSchedulePresetChange;
  window.updateSnapshotScheduleModalPreview = updateSnapshotScheduleModalPreview;
  window.saveSnapshotScheduleModal = saveSnapshotScheduleModal;
  window.toggleSnapshotSchedule = toggleSnapshotSchedule;
  window.triggerSnapshotScheduleNow = triggerSnapshotScheduleNow;
  window.deleteSnapshotSchedule = deleteSnapshotSchedule;
}
