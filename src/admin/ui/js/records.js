// Records Data Grid & Export
    function getSearchableFields(col) {
      if (!col) return [];
      const fields = [];
      if (col.type === 'auth') {
        fields.push({ name: 'email', type: 'email' });
      }
      for (const f of col.schema) {
        if (['text', 'email', 'url', 'select'].includes(f.type)) {
          if (!fields.some(existing => existing.name === f.name)) {
            fields.push(f);
          }
        }
      }
      return fields;
    }

    function buildSearchFilter(term, field, col) {
      if (!term || !term.trim()) return '';
      const trimmed = term.trim();
      const encoded = encodeFilterString(trimmed);
      const searchable = getSearchableFields(col);

      if (field && field !== '_all') {
        return `${field} ~ ${encoded}`;
      }

      if (searchable.length === 0) {
        return `id ~ ${encoded}`;
      }

      // By default, search across all text/email/url fields using an || condition
      return searchable.map(f => `${f.name} ~ ${encoded}`).join(' || ');
    }

    let searchDebounceTimer = null;

    function handleSearch(val) {
      state.recordsSearchTerm = val;
      updateSearchActiveIndicator();
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        executeSearch();
      }, 250);
    }

    function handleSearchFieldChange(field) {
      state.recordsSearchField = field;
      executeSearch();
    }

    function executeSearch() {
      state.recordsPage = 1;
      state.recordsFilter = buildSearchFilter(state.recordsSearchTerm, state.recordsSearchField, state.activeCollection);
      loadRecords();
    }

    function clearSearch() {
      state.recordsSearchTerm = '';
      const searchInput = document.getElementById('records-search');
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      executeSearch();
      updateSearchActiveIndicator();
    }

    function updateSearchActiveIndicator() {
      const compBox = document.getElementById('search-composite-box');
      const clearBtn = document.getElementById('search-clear-btn');
      const indicator = document.getElementById('search-active-indicator');
      const term = (state.recordsSearchTerm || '').trim();
      const isSearching = term.length > 0;

      if (compBox) {
        if (isSearching) compBox.classList.add('is-active');
        else compBox.classList.remove('is-active');
      }

      if (clearBtn) {
        clearBtn.style.display = isSearching ? 'block' : 'none';
      }

      if (indicator) {
        if (isSearching) {
          let fieldLabel = 'All text fields';
          if (state.recordsSearchField !== '_all') {
            fieldLabel = state.recordsSearchField;
          }
          indicator.innerHTML = `
            <span class="search-active-dot"></span>
            <span>Filtering by <strong>${escapeHtml(fieldLabel)}</strong>: "${escapeHtml(term.length > 20 ? term.slice(0, 20) + '...' : term)}"</span>
            <button class="search-clear-badge-btn" onclick="clearSearch()" title="Clear filter">✕</button>
          `;
          indicator.style.display = 'inline-flex';
        } else {
          indicator.style.display = 'none';
        }
      }
    }

    function getCurrentSort() {
      const s = state.recordsSort || '-created';
      if (s.startsWith('-')) {
        return { field: s.substring(1), dir: 'desc' };
      }
      if (s.startsWith('+')) {
        return { field: s.substring(1), dir: 'asc' };
      }
      return { field: s, dir: 'asc' };
    }

    function toggleSort(field) {
      const current = getCurrentSort();
      let newDir = 'asc';
      if (current.field === field) {
        newDir = current.dir === 'asc' ? 'desc' : 'asc';
      } else {
        newDir = field === 'created' ? 'desc' : 'asc';
      }
      state.recordsSort = (newDir === 'desc' ? '-' : '') + field;
      state.recordsPage = 1;
      loadRecords();
    }

    function changeRecordsPage(newPage) {
      const totalPages = Math.max(1, Math.ceil(state.recordsTotal / state.recordsPerPage));
      if (newPage < 1 || newPage > totalPages || newPage === state.recordsPage) return;
      state.recordsPage = newPage;
      loadRecords();
    }

    function goToRecordsPage(val) {
      const totalPages = Math.max(1, Math.ceil(state.recordsTotal / state.recordsPerPage));
      let num = parseInt(val, 10);
      if (isNaN(num)) {
        const input = document.getElementById('page-jump-input');
        if (input) input.value = state.recordsPage;
        return;
      }
      if (num < 1) num = 1;
      if (num > totalPages) num = totalPages;
      if (num !== state.recordsPage) {
        state.recordsPage = num;
        loadRecords();
      } else {
        const input = document.getElementById('page-jump-input');
        if (input) input.value = state.recordsPage;
      }
    }

    function changeRecordsPerPage(val) {
      const num = parseInt(val, 10);
      if (num && num !== state.recordsPerPage) {
        state.recordsPerPage = num;
        state.recordsPage = 1;
        loadRecords();
      }
    }

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

          <button class="btn btn-secondary btn-sm" onclick="openMockDataModal()" title="1-Click Generate Mock Data (Built-in Faker Engine)" style="border-color: rgba(96, 165, 250, 0.4); color: #93c5fd;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            <span>Generate Mock Data</span>
          </button>

          <button class="btn btn-primary btn-sm" onclick="openNewRecordModal()">
            <span>+ New Record</span>
          </button>
        </div>
      `;

      const col = state.activeCollection;
      const searchableFields = getSearchableFields(col);

      const main = document.getElementById('main-body');
      main.innerHTML = `
        <div class="controls-bar">
          <div style="display:flex; align-items:center; gap:0.75rem; flex:1; max-width:640px;">
            <div class="search-bar-composite" id="search-composite-box">
              <select id="records-search-field" class="search-field-select" onchange="handleSearchFieldChange(this.value)" title="Choose column to search">
                <option value="_all" ${state.recordsSearchField === '_all' ? 'selected' : ''}>All Text Fields (${searchableFields.length}) ▾</option>
                ${searchableFields.map(f => {
                  const safeName = escapeHtml(f.name);
                  const safeType = escapeHtml(f.type);
                  return `<option value="${safeName}" ${state.recordsSearchField === f.name ? 'selected' : ''}>${safeName} (${safeType})</option>`;
                }).join('')}
                <option value="id" ${state.recordsSearchField === 'id' ? 'selected' : ''}>id (system)</option>
              </select>
              <div class="search-input-wrapper">
                <span class="search-icon">🔍</span>
                <input type="text" class="search-input" placeholder="Search records..." id="records-search" value="${escapeHtml(state.recordsSearchTerm)}" oninput="handleSearch(this.value)">
                <button id="search-clear-btn" class="search-clear-btn" onclick="clearSearch()" style="display:${state.recordsSearchTerm ? 'block' : 'none'};" title="Clear search">✕</button>
              </div>
            </div>
            <div id="search-active-indicator" class="search-active-badge" style="display:none;"></div>
          </div>
          <div style="font-size:12px; color:var(--text-muted);" id="pagination-label">Loading records...</div>
        </div>

        <div class="table-container">
          <table id="records-table">
            <thead><tr id="table-head"></tr></thead>
            <tbody id="table-body"><tr><td colspan="10" style="text-align:center;padding:2rem;">Loading...</td></tr></tbody>
          </table>
        </div>

        <div class="pagination-footer" id="records-pagination">
          <!-- Injected by updatePaginationControls() -->
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
        if (state.recordsSort) {
          queryParams.set('sort', state.recordsSort);
        }

        const res = await api(`/api/collections/${state.activeCollection.name}/records?${queryParams}`);
        const totalItems = res.totalItems || 0;
        const totalPages = Math.max(1, res.totalPages || Math.ceil(totalItems / state.recordsPerPage));

        // If deleting the final item on the last page reduces totalPages, the API returns
        // an empty out-of-range page but recordsPage remains unchanged. Clamp and reload when
        // the response shows that the current page no longer exists.
        if (state.recordsPage > totalPages) {
          state.recordsPage = totalPages;
          return loadRecords();
        }

        state.records = res.items || [];
        state.recordsTotal = totalItems;
        state.recordsTotalPages = totalPages;

        renderRecordsTable();
        updatePaginationControls();
        updateSearchActiveIndicator();

        // If drawer is currently open, refresh its data if record exists
        if (state.selectedRecordId) {
          const updatedRec = state.records.find(r => r.id === state.selectedRecordId);
          if (updatedRec) {
            renderDrawerContent(updatedRec);
          }
        }
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    function getRecordFileUrl(colName, recId, filename) {
      const encCol = encodeURIComponent(colName || '');
      const encId = encodeURIComponent(recId || '');
      const encFile = encodeURIComponent(filename || '').replace(/'/g, '%27');
      const encToken = encodeURIComponent(state.token || '');
      return `/api/files/${encCol}/${encId}/${encFile}?token=${encToken}`;
    }

    function isImageFile(filename) {
      return /\.(jpe?g|png|gif|webp|svg)$/i.test(filename);
    }

    function handleHeaderSort(el) {
      if (!el) return;
      const col = el.getAttribute('data-column') || el.closest('[data-column]')?.getAttribute('data-column');
      if (col) {
        toggleSort(col);
      }
    }

    function renderSortableTh(columnName, displayName) {
      const current = getCurrentSort();
      const isActive = current.field === columnName;
      const arrow = isActive ? (current.dir === 'asc' ? '↑' : '↓') : '<span class="sort-icon-ghost">↕</span>';
      const activeClass = isActive ? `sort-active sort-${escapeHtml(current.dir)}` : '';
      const safeCol = escapeHtml(columnName);
      const safeDisplay = escapeHtml(displayName);
      const nextOrder = isActive ? (current.dir === 'asc' ? 'Descending next' : 'Ascending next') : 'Ascending';
      const safeTitle = escapeHtml(`Sort by ${displayName} (${nextOrder})`);
      const ariaSort = isActive ? (current.dir === 'asc' ? 'ascending' : 'descending') : 'none';

      return `
        <th scope="col" class="th-sortable ${activeClass}" data-column="${safeCol}" aria-sort="${ariaSort}">
          <button type="button" class="th-sort-btn" data-column="${safeCol}" onclick="handleHeaderSort(this)" title="${safeTitle}" aria-label="${safeTitle}">
            <span>${safeDisplay}</span>
            <span class="sort-icon" aria-hidden="true">${arrow}</span>
          </button>
        </th>
      `;
    }

    function renderRecordsTable() {
      const col = state.activeCollection;
      const thContainer = document.getElementById('table-head');
      const tbContainer = document.getElementById('table-body');

      if (!thContainer || !tbContainer) return;

      // Columns to display
      const displayFields = [];
      if (col.type === 'auth' && !col.schema.some(f => f.name === 'email')) {
        displayFields.push('email');
      }
      displayFields.push(...col.schema.map(f => f.name));

      thContainer.innerHTML = `
        ${renderSortableTh('id', 'ID')}
        ${displayFields.map(f => renderSortableTh(f, f)).join('')}
        ${renderSortableTh('created', 'Created')}
        <th style="cursor:default;">Actions</th>
      `;

      if (state.records.length === 0) {
        if (state.recordsFilter) {
          tbContainer.innerHTML = `
            <tr>
              <td colspan="${displayFields.length + 3}" style="text-align:center;padding:3.5rem 1rem;">
                <div style="display:flex; flex-direction:column; align-items:center; gap:0.75rem;">
                  <div style="width:44px; height:44px; border-radius:50%; background:rgba(59,130,246,0.12); color:#60a5fa; display:flex; align-items:center; justify-content:center; font-size:20px;">
                    🔍
                  </div>
                  <div style="font-weight:600; font-size:15px; color:var(--text-main);">No matching records found</div>
                  <div style="font-size:13px; color:var(--text-muted); max-width:380px; line-height:1.4;">
                    No records match the current search filter in '${col.name}'. Try a different term or search across all text fields.
                  </div>
                  <div style="margin-top:0.5rem;">
                    <button class="btn btn-secondary btn-sm" onclick="clearSearch()">
                      <span>Clear Search Filter</span>
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          `;
        } else {
          tbContainer.innerHTML = `
            <tr>
              <td colspan="${displayFields.length + 3}" style="text-align:center;padding:3.5rem 1rem;">
                <div style="display:flex; flex-direction:column; align-items:center; gap:0.75rem;">
                  <div style="width:44px; height:44px; border-radius:50%; background:rgba(59,130,246,0.12); color:#60a5fa; display:flex; align-items:center; justify-content:center; font-size:20px;">
                    ✨
                  </div>
                  <div style="font-weight:600; font-size:15px; color:var(--text-main);">No records in '${col.name}' yet</div>
                  <div style="font-size:13px; color:var(--text-muted); max-width:380px; line-height:1.4;">
                    Populate your collection in seconds with realistic human names, emails, prices, avatars, and linked relations.
                  </div>
                  <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                    <button class="btn btn-primary btn-sm" onclick="openMockDataModal()">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                      <span>Generate Mock Data</span>
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="openNewRecordModal()">
                      <span>+ New Record</span>
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          `;
        }
        return;
      }

      tbContainer.innerHTML = state.records.map(rec => {
        const safeRecId = escapeHtml(rec.id);
        return `
        <tr class="record-row ${state.selectedRecordId === rec.id ? 'row-selected' : ''}" data-id="${safeRecId}" tabindex="0" role="button" aria-label="Record ${safeRecId}, press Enter to view details" onclick="handleRecordRowClick(this)" onkeydown="handleRecordRowKeyDown(event, this)">
          <td><span class="id-pill">${safeRecId}</span></td>
          ${displayFields.map(f => {
            const schemaField = col.schema.find(sf => sf.name === f);
            const val = rec[f];
            if (val === null || val === undefined || val === '') return '<td style="color:#6b7280; font-style:italic;">NULL</td>';
            if (schemaField && schemaField.type === 'file') {
              const filename = String(val);
              const fileUrl = getRecordFileUrl(col.name, rec.id, filename);
              const safeUrl = escapeHtml(fileUrl);
              const isImg = isImageFile(filename);
              if (isImg) {
                return `<td><a href="${safeUrl}" target="_blank" onclick="event.stopPropagation()" style="display:inline-flex; align-items:center; gap:6px; color:#60a5fa; text-decoration:none;"><img src="${safeUrl}" style="width:24px; height:24px; object-fit:cover; border-radius:4px; border:1px solid var(--border-subtle);"/> <span style="font-family:var(--font-mono); font-size:12px;">${escapeHtml(filename)}</span></a></td>`;
              }
              return `<td><a href="${safeUrl}" target="_blank" onclick="event.stopPropagation()" style="color:#60a5fa; text-decoration:underline; font-family:var(--font-mono); font-size:12px;">📎 ${escapeHtml(filename)}</a></td>`;
            }
            if (typeof val === 'boolean') return `<td><span class="badge ${val ? 'badge-get' : 'badge-delete'}">${val ? 'TRUE' : 'FALSE'}</span></td>`;
            if (typeof val === 'object') return `<td><code>${escapeHtml(JSON.stringify(val).slice(0, 30))}...</code></td>`;
            return `<td>${escapeHtml(String(val))}</td>`;
          }).join('')}
          <td style="color:var(--text-muted);font-size:12px;">${new Date(rec.created).toLocaleString()}</td>
          <td>
            <div style="display:flex; align-items:center; gap:4px;">
              <button class="btn btn-secondary btn-sm" data-id="${safeRecId}" onclick="handleTableEditRecord(event, this)" title="Edit record">Edit</button>
              <button class="btn btn-danger btn-sm" data-id="${safeRecId}" onclick="handleTableDeleteRecord(event, this)" title="Delete record">Delete</button>
            </div>
          </td>
        </tr>
      `;
      }).join('');
    }

    function updatePaginationControls() {
      const paginationLabel = document.getElementById('pagination-label');
      const footer = document.getElementById('records-pagination');
      if (!footer) return;

      const total = state.recordsTotal;
      const perPage = state.recordsPerPage;
      const page = state.recordsPage;
      const totalPages = Math.max(1, Math.ceil(total / perPage));

      const start = total === 0 ? 0 : Math.min((page - 1) * perPage + 1, total);
      const end = Math.min(page * perPage, total);

      if (paginationLabel) {
        paginationLabel.textContent = total === 0 ? 'Showing 0 records' : `Showing ${start}–${end} of ${total} records`;
      }

      footer.innerHTML = `
        <div class="pagination-left">
          <span class="pagination-label-text">
            ${total === 0 ? '0 records' : `Showing <strong>${start}–${end}</strong> of <strong>${total}</strong> records`}
          </span>
          <div class="per-page-selector">
            <span>Rows per page:</span>
            <select id="records-per-page" class="per-page-select" onchange="changeRecordsPerPage(this.value)" title="Number of rows per page">
              <option value="25" ${perPage === 25 ? 'selected' : ''}>25</option>
              <option value="50" ${perPage === 50 ? 'selected' : ''}>50</option>
              <option value="100" ${perPage === 100 ? 'selected' : ''}>100</option>
            </select>
          </div>
        </div>
        <div class="pagination-nav">
          <button class="btn btn-secondary btn-sm" id="btn-page-prev" onclick="changeRecordsPage(${page - 1})" ${page <= 1 ? 'disabled' : ''} title="Previous page">
            « Prev
          </button>
          <div class="page-counter-box">
            <span>Page</span>
            <input type="number" id="page-jump-input" min="1" max="${totalPages}" value="${page}" class="page-jump-input" onchange="goToRecordsPage(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault(); goToRecordsPage(this.value);}" title="Jump to page">
            <span>of <span id="page-total-count">${totalPages}</span></span>
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-page-next" onclick="changeRecordsPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''} title="Next page">
            Next »
          </button>
        </div>
      `;
    }

    // ==========================================
    // Slide-Over Record Detail Drawer
    // ==========================================

    let drawerTriggerElement = null;

    function handleRecordRowClick(trEl) {
      if (!trEl) return;
      const id = trEl.getAttribute('data-id');
      if (id) {
        openRecordDrawer(id, trEl);
      }
    }

    function handleRecordRowKeyDown(e, trEl) {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target && e.target.closest && e.target.closest('button, a, input, select, textarea')) {
          return;
        }
        e.preventDefault();
        handleRecordRowClick(trEl);
      }
    }

    function openRecordDrawer(id, triggerEl) {
      const rec = state.records.find(r => r.id === id);
      if (!rec) return;

      state.selectedRecordId = id;

      // Store trigger element for focus restoration upon closing
      if (triggerEl && typeof triggerEl.focus === 'function') {
        drawerTriggerElement = triggerEl;
      } else if (document.activeElement && typeof document.activeElement.focus === 'function' && document.activeElement !== document.body) {
        drawerTriggerElement = document.activeElement;
      } else {
        drawerTriggerElement = document.querySelector(`#records-table tr.record-row[data-id="${id}"]`);
      }

      // Update row selection style
      document.querySelectorAll('#records-table tr.record-row').forEach(tr => {
        tr.classList.remove('row-selected');
      });
      const activeTr = document.querySelector(`#records-table tr.record-row[data-id="${id}"]`);
      if (activeTr) activeTr.classList.add('row-selected');

      renderDrawer(rec);
    }

    function renderDrawer(rec) {
      let root = document.getElementById('drawer-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'drawer-root';
        document.body.appendChild(root);
      }

      root.innerHTML = `
        <div id="record-drawer-backdrop" class="drawer-backdrop" onclick="closeRecordDrawer()" aria-hidden="true"></div>
        <aside id="record-drawer-panel" class="record-drawer" role="dialog" aria-modal="true" aria-labelledby="record-drawer-title" tabindex="-1">
          <!-- Dynamic Content -->
        </aside>
      `;

      renderDrawerContent(rec);

      // Trigger slide-over animation smoothly and move focus into drawer
      const triggerDrawerOpen = () => {
        const backdrop = document.getElementById('record-drawer-backdrop');
        const panel = document.getElementById('record-drawer-panel');
        if (backdrop) backdrop.classList.add('open');
        if (panel) {
          panel.classList.add('open');
          focusDrawerOnOpen();
        }
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(triggerDrawerOpen);
      } else {
        triggerDrawerOpen();
      }
      setTimeout(() => {
        focusDrawerOnOpen();
      }, 50);

      // Escape key and Tab focus trap listener
      window.removeEventListener('keydown', handleDrawerKeyDown);
      window.addEventListener('keydown', handleDrawerKeyDown);
    }

    function focusDrawerOnOpen() {
      const panel = document.getElementById('record-drawer-panel');
      if (!panel) return;
      const closeBtn = document.getElementById('drawer-close-btn');
      if (closeBtn && typeof closeBtn.focus === 'function') {
        closeBtn.focus();
      } else if (typeof panel.focus === 'function') {
        panel.focus();
      }
    }

    function handleDrawerKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRecordDrawer();
        return;
      }

      if (e.key === 'Tab') {
        const panel = document.getElementById('record-drawer-panel');
        if (!panel) return;

        const focusableElements = panel.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const focusable = Array.from(focusableElements).filter(el => {
          return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0 || el.style.display !== 'none';
        });

        if (focusable.length === 0) {
          e.preventDefault();
          if (typeof panel.focus === 'function') panel.focus();
          return;
        }

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !panel.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !panel.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    }

    function closeRecordDrawer() {
      state.selectedRecordId = null;
      document.querySelectorAll('#records-table tr.record-row').forEach(tr => {
        tr.classList.remove('row-selected');
      });

      const backdrop = document.getElementById('record-drawer-backdrop');
      const panel = document.getElementById('record-drawer-panel');
      if (backdrop) backdrop.classList.remove('open');
      if (panel) panel.classList.remove('open');

      window.removeEventListener('keydown', handleDrawerKeyDown);

      // Restore focus to the trigger element that opened the drawer
      if (drawerTriggerElement && typeof drawerTriggerElement.focus === 'function' && document.body.contains(drawerTriggerElement)) {
        try {
          drawerTriggerElement.focus();
        } catch (_) {}
      }
      drawerTriggerElement = null;

      setTimeout(() => {
        const root = document.getElementById('drawer-root');
        if (root && !state.selectedRecordId) {
          root.innerHTML = '';
        }
      }, 300);
    }

    function renderDrawerContent(rec) {
      const panel = document.getElementById('record-drawer-panel');
      if (!panel) return;

      const col = state.activeCollection;
      if (!col) return;

      const safeRecId = escapeHtml(rec.id);

      panel.innerHTML = `
        <!-- Drawer Header -->
        <div class="drawer-header">
          <div class="drawer-title-area">
            <span style="font-size:18px;" aria-hidden="true">📄</span>
            <h2 id="record-drawer-title" class="drawer-title" style="margin:0; font-size:1.05rem;">Record Details</h2>
            <span class="badge badge-post">${escapeHtml(col.name)}</span>
            <span class="id-pill" title="Record ID">${safeRecId}</span>
          </div>
          <button class="btn btn-secondary btn-sm" id="drawer-close-btn" onclick="closeRecordDrawer()" title="Close drawer (Esc)" aria-label="Close drawer">✕</button>
        </div>

        <!-- Quick Actions Bar -->
        <div class="drawer-quick-actions">
          <button class="btn btn-secondary btn-sm" data-id="${safeRecId}" onclick="handleDrawerCopyId(this)" title="Copy Record ID to clipboard">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy ID</span>
          </button>
          <button class="btn btn-primary btn-sm" data-id="${safeRecId}" onclick="handleDrawerEditRecord(this)" title="Edit this record">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            <span>Edit Record</span>
          </button>
          <button class="btn btn-secondary btn-sm" data-id="${safeRecId}" onclick="handleDrawerCopyJson(this)" title="Copy full record JSON">
            <span style="color:#34d399; font-weight:bold; font-size:11px;">{ }</span>
            <span>Copy JSON</span>
          </button>
          <button class="btn btn-danger btn-sm" data-id="${safeRecId}" onclick="handleDrawerDeleteRecord(this)" title="Delete record" style="margin-left:auto;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            <span>Delete</span>
          </button>
        </div>

        <!-- Drawer Body -->
        <div class="drawer-body">
          <!-- System Metadata Section -->
          <div>
            <div class="drawer-section-title">System Metadata</div>
            <div class="drawer-card">
              <div class="drawer-field-item">
                <div class="drawer-field-header">
                  <span class="drawer-field-name">id</span>
                  <span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-muted);">system</span>
                </div>
                <div class="drawer-field-value" style="display:flex; align-items:center; justify-content:space-between;">
                  <span class="id-pill">${safeRecId}</span>
                  <button class="btn btn-secondary btn-sm" style="padding:2px 6px; font-size:11px;" data-id="${safeRecId}" onclick="handleDrawerCopyId(this)">Copy</button>
                </div>
              </div>

              <div class="drawer-field-item">
                <div class="drawer-field-header">
                  <span class="drawer-field-name">created</span>
                  <span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-muted);">datetime</span>
                </div>
                <div class="drawer-field-value" style="font-size:12px; color:var(--text-muted);">
                  ${new Date(rec.created).toLocaleString()} <span style="font-family:var(--font-mono); opacity:0.7;">(${escapeHtml(rec.created)})</span>
                </div>
              </div>

              ${rec.updated ? `
                <div class="drawer-field-item">
                  <div class="drawer-field-header">
                    <span class="drawer-field-name">updated</span>
                    <span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-muted);">datetime</span>
                  </div>
                  <div class="drawer-field-value" style="font-size:12px; color:var(--text-muted);">
                    ${new Date(rec.updated).toLocaleString()} <span style="font-family:var(--font-mono); opacity:0.7;">(${escapeHtml(rec.updated)})</span>
                  </div>
                </div>
              ` : ''}

              ${col.type === 'auth' ? `
                <div class="drawer-field-item">
                  <div class="drawer-field-header">
                    <span class="drawer-field-name">email</span>
                    <span class="badge badge-get">auth</span>
                  </div>
                  <div class="drawer-field-value" style="display:flex; align-items:center; justify-content:space-between;">
                    <span style="font-family:var(--font-mono); color:#93c5fd;">${escapeHtml(rec.email || '—')}</span>
                    <button class="btn btn-secondary btn-sm" style="padding:2px 6px; font-size:11px;" data-email="${escapeHtml(rec.email || '')}" onclick="handleDrawerCopyEmail(this)">Copy</button>
                  </div>
                </div>
                <div class="drawer-field-item">
                  <div class="drawer-field-header">
                    <span class="drawer-field-name">verified</span>
                    <span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-muted);">auth</span>
                  </div>
                  <div class="drawer-field-value">
                    <span class="badge ${rec.verified ? 'badge-get' : 'badge-delete'}">${rec.verified ? 'Verified' : 'Unverified'}</span>
                  </div>
                </div>
                <div class="drawer-field-item">
                  <div class="drawer-field-header">
                    <span class="drawer-field-name">emailVisibility</span>
                    <span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-muted);">auth</span>
                  </div>
                  <div class="drawer-field-value">
                    <span class="badge ${rec.emailVisibility ? 'badge-get' : 'badge-delete'}">${rec.emailVisibility ? 'Public' : 'Hidden'}</span>
                  </div>
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Collection Fields Section -->
          <div>
            <div class="drawer-section-title">Schema Fields (${col.schema.length})</div>
            <div class="drawer-card">
              ${col.schema.length === 0 ? `
                <div style="color:var(--text-muted); font-size:13px; text-align:center; padding:1rem;">No custom schema fields defined.</div>
              ` : col.schema.map(f => {
                const val = rec[f.name];
                return `
                  <div class="drawer-field-item">
                    <div class="drawer-field-header">
                      <span class="drawer-field-name">${escapeHtml(f.name)}</span>
                      <span class="badge badge-post">${escapeHtml(f.type)}</span>
                    </div>
                    <div class="drawer-field-value">
                      ${renderDrawerFieldValue(col, rec, f, val)}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      `;
    }

    function renderDrawerFieldValue(col, rec, field, val) {
      if (val === null || val === undefined || val === '') {
        return '<span style="color:#6b7280; font-style:italic;">NULL</span>';
      }

      if (field.type === 'file') {
        const filename = String(val);
        const fileUrl = getRecordFileUrl(col.name, rec.id, filename);
        const safeUrl = escapeHtml(fileUrl);
        const isImg = isImageFile(filename);
        if (isImg) {
          return `
            <div class="drawer-media-box">
              <a href="${safeUrl}" target="_blank" title="Click to view full image">
                <img src="${safeUrl}" class="drawer-media-img" alt="${escapeHtml(filename)}" />
              </a>
              <div style="display:flex; flex-direction:column; gap:4px; overflow:hidden;">
                <a href="${safeUrl}" target="_blank" style="color:#60a5fa; font-family:var(--font-mono); font-size:12px; text-decoration:none; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                  📎 ${escapeHtml(filename)}
                </a>
                <span style="font-size:11px; color:var(--text-muted);">Media Image • Click thumbnail to inspect</span>
              </div>
            </div>
          `;
        }
        return `
          <div class="drawer-media-box">
            <span style="font-size:24px;">📄</span>
            <div style="display:flex; flex-direction:column; gap:4px; overflow:hidden;">
              <a href="${safeUrl}" target="_blank" style="color:#60a5fa; font-family:var(--font-mono); font-size:12px; text-decoration:none; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                📎 ${escapeHtml(filename)}
              </a>
              <span style="font-size:11px; color:var(--text-muted);">File Attachment • Click to download</span>
            </div>
          </div>
        `;
      }

      if (field.type === 'json' || (typeof val === 'object' && val !== null)) {
        const jsonFormatted = JSON.stringify(val, null, 2);
        const keysCount = typeof val === 'object' && val !== null ? Object.keys(val).length : 0;
        const safeRecId = escapeHtml(rec.id);
        const safeFieldName = escapeHtml(field.name);
        return `
          <div class="drawer-json-container">
            <div class="drawer-json-bar">
              <span>JSON Object (${keysCount} ${keysCount === 1 ? 'key' : 'keys'})</span>
              <button class="btn btn-secondary btn-sm" style="padding:2px 7px; font-size:11px;" data-id="${safeRecId}" data-field="${safeFieldName}" onclick="handleDrawerCopyJsonField(this)">Copy JSON</button>
            </div>
            <pre class="drawer-json-pre"><code>${escapeHtml(jsonFormatted)}</code></pre>
          </div>
        `;
      }

      if (typeof val === 'boolean' || field.type === 'bool') {
        return `<span class="badge ${val ? 'badge-get' : 'badge-delete'}">${val ? 'TRUE' : 'FALSE'}</span>`;
      }

      if (typeof val === 'number' || field.type === 'number') {
        return `<span style="font-family:var(--font-mono); font-weight:600; color:#93c5fd;">${val}</span>`;
      }

      // Plain text or long text: display full inspection with copy button
      const safeRecId = escapeHtml(rec.id);
      const safeFieldName = escapeHtml(field.name);
      return `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <div style="white-space:pre-wrap; word-break:break-word; font-size:13px; color:var(--text-main); flex:1; line-height:1.5;">${escapeHtml(String(val))}</div>
          <button class="btn btn-secondary btn-sm" style="padding:2px 6px; font-size:11px; flex-shrink:0;" data-id="${safeRecId}" data-field="${safeFieldName}" onclick="handleDrawerCopyFieldValue(this)" title="Copy text value">Copy</button>
        </div>
      `;
    }

    function drawerDeleteRecord(id) {
      deleteRecord(id);
    }

    function handleTableEditRecord(e, btnEl) {
      if (e) e.stopPropagation();
      if (!btnEl) return;
      const id = btnEl.getAttribute('data-id');
      if (id) editRecord(id);
    }

    function handleTableDeleteRecord(e, btnEl) {
      if (e) e.stopPropagation();
      if (!btnEl) return;
      const id = btnEl.getAttribute('data-id');
      if (id) deleteRecord(id);
    }

    function handleDrawerCopyId(btnEl) {
      if (!btnEl) return;
      const id = btnEl.getAttribute('data-id');
      if (id) copyToClipboard(id, btnEl, 'Copied ID!');
    }

    function handleDrawerEditRecord(btnEl) {
      if (!btnEl) return;
      const id = btnEl.getAttribute('data-id');
      if (id) editRecord(id);
    }

    function handleDrawerCopyJson(btnEl) {
      if (!btnEl) return;
      const id = btnEl.getAttribute('data-id');
      if (id) copyRecordJson(id, btnEl);
    }

    function handleDrawerDeleteRecord(btnEl) {
      if (!btnEl) return;
      const id = btnEl.getAttribute('data-id');
      if (id) drawerDeleteRecord(id);
    }

    function handleDrawerCopyEmail(btnEl) {
      if (!btnEl) return;
      const email = btnEl.getAttribute('data-email');
      copyToClipboard(email || '', btnEl, 'Copied email!');
    }

    function handleDrawerCopyJsonField(btnEl) {
      if (!btnEl) return;
      const id = btnEl.getAttribute('data-id');
      const fieldName = btnEl.getAttribute('data-field');
      if (id && fieldName) copyJsonField(id, fieldName, btnEl);
    }

    function handleDrawerCopyFieldValue(btnEl) {
      if (!btnEl) return;
      const id = btnEl.getAttribute('data-id');
      const fieldName = btnEl.getAttribute('data-field');
      if (id && fieldName) copyFieldValue(id, fieldName, btnEl);
    }

    function copyRecordJson(id, btnEl) {
      const rec = state.records.find(r => r.id === id);
      if (!rec) return;
      const jsonStr = JSON.stringify(rec, null, 2);
      copyToClipboard(jsonStr, btnEl, 'Record JSON copied!');
    }

    function copyJsonField(id, fieldName, btnEl) {
      const rec = state.records.find(r => r.id === id);
      if (!rec) return;
      const val = rec[fieldName];
      const jsonStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
      copyToClipboard(jsonStr, btnEl, `Copied ${fieldName} JSON!`);
    }

    function copyFieldValue(id, fieldName, btnEl) {
      const rec = state.records.find(r => r.id === id);
      if (!rec) return;
      const val = rec[fieldName];
      copyToClipboard(String(val ?? ''), btnEl, `Copied ${fieldName}!`);
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
