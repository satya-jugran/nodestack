// Records Data Grid & Export
    function renderRecordsView() {
      const actions = document.getElementById('view-actions');
      actions.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <div class="dropdown-wrapper">
            <button class="btn btn-secondary btn-sm" onclick="toggleExportMenu(event)" title="Export collection records">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Export</span>
              <span style="font-size:10px; margin-left:1px; opacity:0.7;">▾</span>
            </button>
            <div id="export-dropdown-menu" style="display:none; position:absolute; right:0; top:calc(100% + 4px); background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:6px; box-shadow:0 10px 25px rgba(0,0,0,0.5); min-width:150px; z-index:100; padding:4px 0;">
              <button class="dropdown-menu-item" onclick="exportData('csv')">
                <span style="color:#60a5fa; font-weight:bold;">CSV</span> Export as CSV
              </button>
              <button class="dropdown-menu-item" onclick="exportData('json')">
                <span style="color:#34d399; font-weight:bold;">{ }</span> Export as JSON
              </button>
            </div>
          </div>

          <button class="btn btn-secondary btn-sm" onclick="openImportModal()" title="Drag & drop CSV import with visual column mapping">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>Import CSV</span>
          </button>

          <button class="btn btn-primary btn-sm" onclick="openNewRecordModal()">
            <span>+ New Record</span>
          </button>
        </div>
      `;

      const main = document.getElementById('main-body');
      main.innerHTML = `
        <div class="controls-bar">
          <div class="search-input-box">
            <span class="search-icon">🔍</span>
            <input type="text" class="search-input" placeholder="Search records..." id="records-search" oninput="handleSearch(this.value)">
          </div>
          <div style="font-size:12px; color:var(--text-muted);" id="pagination-label">Loading records...</div>
        </div>
        <div class="table-container">
          <table id="records-table">
            <thead><tr id="table-head"></tr></thead>
            <tbody id="table-body"><tr><td colspan="10" style="text-align:center;padding:2rem;">Loading...</td></tr></tbody>
          </table>
        </div>
      `;
    }

    async function loadRecords() {
      if (!state.activeCollection) return;
      try {
        const queryParams = new URLSearchParams({
          page: state.recordsPage.toString(),
          perPage: state.recordsPerPage.toString(),
        });
        if (state.recordsFilter) {
          queryParams.set('filter', state.recordsFilter);
        }

        const res = await api(`/api/collections/${state.activeCollection.name}/records?${queryParams}`);
        state.records = res.items || [];
        state.recordsTotal = res.totalItems || 0;

        renderRecordsTable();
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    function renderRecordsTable() {
      const col = state.activeCollection;
      const thContainer = document.getElementById('table-head');
      const tbContainer = document.getElementById('table-body');
      const paginationLabel = document.getElementById('pagination-label');

      if (!thContainer || !tbContainer) return;

      paginationLabel.textContent = `Showing ${state.records.length} of ${state.recordsTotal} records`;

      // Columns
      const fields = col.schema.map(f => f.name);
      thContainer.innerHTML = `
        <th>ID</th>
        ${fields.map(f => `<th>${f}</th>`).join('')}
        <th>Created</th>
        <th>Actions</th>
      `;

      if (state.records.length === 0) {
        tbContainer.innerHTML = `<tr><td colspan="${fields.length + 3}" style="text-align:center;padding:3rem;color:var(--text-muted);">No records found in this collection.</td></tr>`;
        return;
      }

      tbContainer.innerHTML = state.records.map(rec => `
        <tr>
          <td><span class="id-pill">${rec.id}</span></td>
          ${fields.map(f => {
            const schemaField = col.schema.find(sf => sf.name === f);
            const val = rec[f];
            if (val === null || val === undefined || val === '') return '<td style="color:#6b7280;">NULL</td>';
            if (schemaField && schemaField.type === 'file') {
              const filename = String(val);
              const fileUrl = `/api/files/${col.name}/${rec.id}/${filename}?token=${state.token}`;
              const isImg = /\.(jpe?g|png|gif|webp|svg)$/i.test(filename);
              if (isImg) {
                return `<td><a href="${fileUrl}" target="_blank" style="display:inline-flex; align-items:center; gap:6px; color:#60a5fa; text-decoration:none;"><img src="${fileUrl}" style="width:24px; height:24px; object-fit:cover; border-radius:4px; border:1px solid var(--border-subtle);"/> <span style="font-family:var(--font-mono); font-size:12px;">${filename}</span></a></td>`;
              }
              return `<td><a href="${fileUrl}" target="_blank" style="color:#60a5fa; text-decoration:underline; font-family:var(--font-mono); font-size:12px;">📎 ${filename}</a></td>`;
            }
            if (typeof val === 'boolean') return `<td><span class="badge ${val ? 'badge-get' : 'badge-delete'}">${val}</span></td>`;
            if (typeof val === 'object') return `<td><code>${JSON.stringify(val).slice(0, 30)}...</code></td>`;
            return `<td>${String(val)}</td>`;
          }).join('')}
          <td style="color:var(--text-muted);font-size:12px;">${new Date(rec.created).toLocaleString()}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="editRecord('${rec.id}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteRecord('${rec.id}')">Delete</button>
          </td>
        </tr>
      `).join('');
    }

    function handleSearch(val) {
      if (!val.trim()) {
        state.recordsFilter = '';
      } else {
        // Search first text field
        const firstTextField = state.activeCollection?.schema.find(f => f.type === 'text');
        if (firstTextField) {
          state.recordsFilter = `${firstTextField.name} ~ '${val.trim()}'`;
        }
      }
      loadRecords();
    }

    // ==========================================
    // Visual Access Rule Builder

    function toggleExportMenu(e) {
      if (e) e.stopPropagation();
      const menu = document.getElementById('export-dropdown-menu');
      if (menu) {
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
      }
    }

    window.addEventListener('click', (e) => {
      const menu = document.getElementById('export-dropdown-menu');
      if (menu && !e.target.closest('.dropdown-wrapper')) {
        menu.style.display = 'none';
      }
    });

    async function exportData(format) {
      const menu = document.getElementById('export-dropdown-menu');
      if (menu) menu.style.display = 'none';

      const col = state.activeCollection;
      if (!col) return;

      try {
        toast(`Exporting ${col.name} as ${format.toUpperCase()}...`, 'info');
        let url = `/api/collections/${col.name}/export?format=${format}`;
        if (state.recordsFilter) {
          url += `&filter=${encodeURIComponent(state.recordsFilter)}`;
        }

        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${state.token}`
          }
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Export failed');
        }

        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;

        const disposition = res.headers.get('content-disposition');
        let filename = `${col.name}_${new Date().toISOString().slice(0, 10)}.${format}`;
        if (disposition && disposition.includes('filename="')) {
          filename = disposition.split('filename="')[1].split('"')[0];
        } else if (disposition && disposition.includes('filename=')) {
          filename = disposition.split('filename=')[1].trim();
        }

        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);

        toast(`Exported ${filename} successfully!`, 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    // CSV Import State & Logic
    let currentImport = {
      fileName: '',
      headers: [],
      rows: [],
      mapping: {},
      continueOnError: true,
    };
