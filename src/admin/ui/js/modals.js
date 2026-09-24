// Modals & Data Import Wizard
    function closeModal() {
      document.getElementById('modal-root').innerHTML = '';
    }

    // Export Handler

    function openNewRecordModal() {
      const col = state.activeCollection;
      const modal = document.getElementById('modal-root');
      modal.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal">
            <div class="modal-header">
              <h2 class="modal-title">Create Record — ${col.name}</h2>
              <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
            </div>
            <div class="modal-body">
              ${col.type === 'auth' ? `
                <div class="form-group">
                  <label class="form-label">Email *</label>
                  <input type="email" class="form-input" id="field-email" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Password * (min 8 chars)</label>
                  <input type="password" class="form-input" id="field-password" required>
                </div>
              ` : ''}
              ${col.schema.map(f => `
                <div class="form-group">
                  <label class="form-label">${f.name} (${f.type}) ${f.required ? '*' : ''}</label>
                  ${f.type === 'file' ? `
                    <input type="file" class="form-input" id="field-${f.name}" ${f.required ? 'required' : ''}>
                  ` : f.type === 'bool' ? `
                    <select class="form-select" id="field-${f.name}">
                      <option value="false">False</option>
                      <option value="true">True</option>
                    </select>
                  ` : f.type === 'json' ? `
                    <textarea class="form-textarea" id="field-${f.name}" placeholder="{}"></textarea>
                  ` : f.type === 'number' ? `
                    <input type="number" class="form-input" id="field-${f.name}">
                  ` : `
                    <input type="text" class="form-input" id="field-${f.name}">
                  `}
                </div>
              `).join('')}
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
              <button class="btn btn-primary" onclick="submitNewRecord()">Create Record</button>
            </div>
          </div>
        </div>
      `;
    }

    async function submitNewRecord() {
      const col = state.activeCollection;
      const hasFileInput = col.schema.some(f => f.type === 'file');

      let body;
      if (hasFileInput) {
        const formData = new FormData();
        if (col.type === 'auth') {
          formData.append('email', document.getElementById('field-email').value);
          formData.append('password', document.getElementById('field-password').value);
        }

        for (const f of col.schema) {
          const el = document.getElementById(`field-${f.name}`);
          if (!el) continue;
          if (f.type === 'file') {
            if (el.files && el.files[0]) {
              formData.append(f.name, el.files[0]);
            }
          } else if (f.type === 'bool') {
            formData.append(f.name, el.value === 'true' ? 'true' : 'false');
          } else if (f.type === 'number') {
            if (el.value !== '') formData.append(f.name, el.value);
          } else {
            formData.append(f.name, el.value);
          }
        }
        body = formData;
      } else {
        const data = {};
        if (col.type === 'auth') {
          data.email = document.getElementById('field-email').value;
          data.password = document.getElementById('field-password').value;
        }

        for (const f of col.schema) {
          const el = document.getElementById(`field-${f.name}`);
          if (!el) continue;
          if (f.type === 'bool') {
            data[f.name] = el.value === 'true';
          } else if (f.type === 'number') {
            data[f.name] = el.value !== '' ? Number(el.value) : null;
          } else {
            data[f.name] = el.value;
          }
        }
        body = JSON.stringify(data);
      }

      try {
        await api(`/api/collections/${col.name}/records`, {
          method: 'POST',
          body,
        });
        toast('Record created successfully!', 'success');
        closeModal();
        loadRecords();
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    // Edit Record
    function editRecord(id) {
      const rec = state.records.find(r => r.id === id);
      if (!rec) return;

      const col = state.activeCollection;
      const modal = document.getElementById('modal-root');
      modal.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal">
            <div class="modal-header">
              <h2 class="modal-title">Edit Record — ${id}</h2>
              <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
            </div>
            <div class="modal-body">
              ${col.schema.map(f => `
                <div class="form-group">
                  <label class="form-label">${f.name} (${f.type})</label>
                  ${f.type === 'file' ? `
                    ${rec[f.name] ? `
                      <div style="margin-bottom:6px; display:flex; align-items:center; gap:8px;">
                        <span style="font-size:12px; color:var(--text-muted);">Current:</span>
                        <a href="/api/files/${col.name}/${rec.id}/${rec[f.name]}?token=${state.token}" target="_blank" style="color:#60a5fa; font-family:var(--font-mono); font-size:12px; text-decoration:underline;">
                          ${rec[f.name]}
                        </a>
                      </div>
                    ` : ''}
                    <input type="file" class="form-input" id="field-edit-${f.name}">
                    <small style="color:var(--text-muted); font-size:11px;">Select a file to replace the existing one</small>
                  ` : f.type === 'bool' ? `
                    <select class="form-select" id="field-edit-${f.name}">
                      <option value="false" ${!rec[f.name] ? 'selected' : ''}>False</option>
                      <option value="true" ${rec[f.name] ? 'selected' : ''}>True</option>
                    </select>
                  ` : f.type === 'json' ? `
                    <textarea class="form-textarea" id="field-edit-${f.name}">${typeof rec[f.name] === 'object' ? JSON.stringify(rec[f.name], null, 2) : rec[f.name] || ''}</textarea>
                  ` : f.type === 'number' ? `
                    <input type="number" class="form-input" id="field-edit-${f.name}" value="${rec[f.name] ?? ''}">
                  ` : `
                    <input type="text" class="form-input" id="field-edit-${f.name}" value="${rec[f.name] ?? ''}">
                  `}
                </div>
              `).join('')}
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
              <button class="btn btn-primary" onclick="submitEditRecord('${id}')">Save Changes</button>
            </div>
          </div>
        </div>
      `;
    }

    async function submitEditRecord(id) {
      const col = state.activeCollection;
      let hasNewFile = false;
      for (const f of col.schema) {
        if (f.type === 'file') {
          const el = document.getElementById(`field-edit-${f.name}`);
          if (el && el.files && el.files[0]) {
            hasNewFile = true;
            break;
          }
        }
      }

      let body;
      if (hasNewFile) {
        const formData = new FormData();
        for (const f of col.schema) {
          const el = document.getElementById(`field-edit-${f.name}`);
          if (!el) continue;
          if (f.type === 'file') {
            if (el.files && el.files[0]) {
              formData.append(f.name, el.files[0]);
            }
          } else if (f.type === 'bool') {
            formData.append(f.name, el.value === 'true' ? 'true' : 'false');
          } else if (f.type === 'number') {
            if (el.value !== '') formData.append(f.name, el.value);
          } else {
            formData.append(f.name, el.value);
          }
        }
        body = formData;
      } else {
        const data = {};
        for (const f of col.schema) {
          const el = document.getElementById(`field-edit-${f.name}`);
          if (!el) continue;
          if (f.type === 'file') {
            // Keep existing file
            continue;
          }
          if (f.type === 'bool') {
            data[f.name] = el.value === 'true';
          } else if (f.type === 'number') {
            data[f.name] = el.value !== '' ? Number(el.value) : null;
          } else {
            data[f.name] = el.value;
          }
        }
        body = JSON.stringify(data);
      }

      try {
        await api(`/api/collections/${col.name}/records/${id}`, {
          method: 'PATCH',
          body,
        });
        toast('Record updated successfully!', 'success');
        closeModal();
        loadRecords();
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    async function deleteRecord(id) {
      if (!confirm(`Are you sure you want to delete record '${id}'?`)) return;
      try {
        await api(`/api/collections/${state.activeCollection.name}/records/${id}`, {
          method: 'DELETE',
        });
        toast('Record deleted!', 'success');
        loadRecords();
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    // New Collection Modal
    function openNewCollectionModal() {
      const modal = document.getElementById('modal-root');
      modal.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal">
            <div class="modal-header">
              <h2 class="modal-title">Create Collection</h2>
              <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Collection Name *</label>
                <input type="text" class="form-input" id="new-col-name" placeholder="e.g. posts, products" required>
              </div>
              <div class="form-group">
                <label class="form-label">Type</label>
                <select class="form-select" id="new-col-type">
                  <option value="base">Base Collection</option>
                  <option value="auth">Auth Collection (Users, Members)</option>
                </select>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
              <button class="btn btn-primary" onclick="submitNewCollection()">Create</button>
            </div>
          </div>
        </div>
      `;
    }

    async function submitNewCollection() {
      const name = document.getElementById('new-col-name').value.trim();
      const type = document.getElementById('new-col-type').value;
      if (!name) return;

      try {
        const col = await api('/api/collections', {
          method: 'POST',
          body: JSON.stringify({
            name,
            type,
            schema: [
              { id: 'f_title', name: 'title', type: 'text', required: true },
            ],
          }),
        });

        toast(`Collection '${col.name}' created!`, 'success');
        closeModal();
        await loadCollections();
        selectCollection(col.name);
      } catch (e) {
        toast(e.message, 'error');
      }
    }


    function parseCsvClient(csvText) {
      const text = csvText.replace(/^\uFEFF/, '').trim();
      if (!text) return { headers: [], rows: [] };

      // Detect delimiter from first line
      const firstLine = text.split(/\r?\n/)[0] || '';
      let inQ = false, commas = 0, semis = 0, tabs = 0;
      for (let i = 0; i < firstLine.length; i++) {
        const c = firstLine[i];
        if (c === '"') inQ = !inQ;
        else if (!inQ) {
          if (c === ',') commas++;
          else if (c === ';') semis++;
          else if (c === '\t') tabs++;
        }
      }
      const delimiter = (tabs > commas && tabs > semis) ? '\t' : (semis > commas && semis > tabs) ? ';' : ',';

      const rows = [];
      let currentRow = [];
      let currentCell = '';
      let inQuotes = false;
      let i = 0;
      const len = text.length;

      while (i < len) {
        const char = text[i];
        if (inQuotes) {
          if (char === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              currentCell += '"';
              i += 2;
              continue;
            } else {
              inQuotes = false;
              i++;
              continue;
            }
          } else {
            currentCell += char;
            i++;
            continue;
          }
        } else {
          if (char === '"') {
            inQuotes = true;
            i++;
            continue;
          } else if (char === delimiter) {
            currentRow.push(currentCell);
            currentCell = '';
            i++;
            continue;
          } else if (char === '\r') {
            if (i + 1 < len && text[i + 1] === '\n') {
              i++;
            }
            currentRow.push(currentCell);
            currentCell = '';
            rows.push(currentRow);
            currentRow = [];
            i++;
            continue;
          } else if (char === '\n') {
            currentRow.push(currentCell);
            currentCell = '';
            rows.push(currentRow);
            currentRow = [];
            i++;
            continue;
          } else {
            currentCell += char;
            i++;
            continue;
          }
        }
      }
      currentRow.push(currentCell);
      rows.push(currentRow);

      if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
        rows.pop();
      }

      if (rows.length === 0) return { headers: [], rows: [] };
      const headers = rows[0].map(h => h.trim());
      const dataRows = [];
      for (let r = 1; r < rows.length; r++) {
        const vals = rows[r];
        if (vals.length === 1 && vals[0].trim() === '') continue;
        const rowObj = {};
        for (let c = 0; c < headers.length; c++) {
          rowObj[headers[c]] = vals[c] !== undefined ? vals[c] : '';
        }
        dataRows.push(rowObj);
      }

      return { headers, rows: dataRows };
    }

    function findBestFieldMatch(headerName, col) {
      const clean = headerName.toLowerCase().replace(/[\s\-_]/g, '');
      if (!clean) return '';

      if (col.type === 'auth') {
        if (clean === 'email' || clean === 'mail') return 'email';
        if (clean === 'password' || clean === 'pass') return 'password';
      }

      // Exact or normalized match
      for (const f of col.schema) {
        const fClean = f.name.toLowerCase().replace(/[\s\-_]/g, '');
        if (fClean === clean) return f.name;
      }

      // Common aliases
      if (clean === 'id') return 'id';
      if (clean === 'created' || clean === 'createdat') return 'created';
      if (clean === 'updated' || clean === 'updatedat') return 'updated';

      // Substring match
      for (const f of col.schema) {
        const fClean = f.name.toLowerCase().replace(/[\s\-_]/g, '');
        if (clean.includes(fClean) || fClean.includes(clean)) {
          return f.name;
        }
      }

      return '';
    }

    function downloadSampleCsv() {
      const col = state.activeCollection;
      if (!col) return;
      const headers = [];
      const sampleRow1 = [];
      const sampleRow2 = [];

      if (col.type === 'auth') {
        headers.push('email', 'password');
        sampleRow1.push('user1@example.com', 'password123');
        sampleRow2.push('user2@example.com', 'password456');
      }

      for (const f of col.schema) {
        headers.push(f.name);
        if (f.type === 'number') {
          sampleRow1.push('10');
          sampleRow2.push('25');
        } else if (f.type === 'bool') {
          sampleRow1.push('true');
          sampleRow2.push('false');
        } else if (f.type === 'email') {
          sampleRow1.push('contact1@example.com');
          sampleRow2.push('contact2@example.com');
        } else if (f.type === 'date') {
          sampleRow1.push('2026-01-15');
          sampleRow2.push('2026-02-20');
        } else if (f.type === 'select' && f.options?.values?.length) {
          sampleRow1.push(f.options.values[0]);
          sampleRow2.push(f.options.values[1] || f.options.values[0]);
        } else if (f.type === 'json') {
          sampleRow1.push('{"tag": "demo"}');
          sampleRow2.push('{"tag": "test"}');
        } else {
          sampleRow1.push(`Sample ${f.name} 1`);
          sampleRow2.push(`Sample ${f.name} 2`);
        }
      }

      const csv = [
        headers.join(','),
        sampleRow1.map(v => v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v).join(','),
        sampleRow2.map(v => v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v).join(',')
      ].join('\r\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${col.name}_sample_template.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function openImportModal() {
      const col = state.activeCollection;
      if (!col) return;

      currentImport = {
        fileName: '',
        headers: [],
        rows: [],
        mapping: {},
        continueOnError: true,
      };

      renderImportModalStep1();
    }

    function renderImportModalStep1() {
      const col = state.activeCollection;
      const modal = document.getElementById('modal-root');
      modal.innerHTML = `
        <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div>
                <h2 class="modal-title">Import CSV — ${col.name}</h2>
                <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Step 1: Upload or drag & drop CSV file</div>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
            </div>
            <div class="modal-body" style="gap:1.25rem;">
              <div class="dropzone" id="csv-dropzone" 
                   ondragover="handleDragOver(event)" 
                   ondragleave="handleDragLeave(event)" 
                   ondrop="handleFileDrop(event)"
                   onclick="document.getElementById('csv-file-picker').click()">
                <div style="width:48px; height:48px; border-radius:50%; background:rgba(59,130,246,0.1); color:#60a5fa; display:flex; align-items:center; justify-content:center; font-size:24px;">
                  📁
                </div>
                <div style="font-weight:600; font-size:14px;">Drag & drop your CSV file here, or click to browse</div>
                <div style="font-size:12px; color:var(--text-muted);">Supports .csv files, RFC 4180 format, and auto-detects delimiters (, ; \\t)</div>
                <input type="file" id="csv-file-picker" accept=".csv,text/csv" style="display:none;" onchange="handleFileSelect(event)">
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem 1rem; background:var(--bg-input); border-radius:6px; border:1px solid var(--border-subtle); font-size:12px;">
                <span style="color:var(--text-muted);">Need a sample CSV with all collection headers?</span>
                <button class="btn btn-secondary btn-sm" onclick="downloadSampleCsv()">📥 Download Sample CSV</button>
              </div>

              <div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.5rem;">
                  <label class="form-label" style="margin:0; cursor:pointer;" onclick="togglePasteArea()">
                    <span id="paste-toggle-icon">▶</span> Or paste raw CSV text
                  </label>
                </div>
                <div id="paste-csv-container" style="display:none;">
                  <textarea class="form-textarea" id="paste-csv-input" placeholder="id,title,views&#10;1,My First Post,100" style="min-height:90px;"></textarea>
                  <div style="display:flex; justify-content:flex-end; margin-top:0.5rem;">
                    <button class="btn btn-secondary btn-sm" onclick="processPastedCsv()">Parse Pasted CSV</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            </div>
          </div>
        </div>
      `;
    }

    function togglePasteArea() {
      const c = document.getElementById('paste-csv-container');
      const icon = document.getElementById('paste-toggle-icon');
      if (c.style.display === 'none') {
        c.style.display = 'block';
        icon.textContent = '▼';
      } else {
        c.style.display = 'none';
        icon.textContent = '▶';
      }
    }

    function handleDragOver(e) {
      e.preventDefault();
      const dz = document.getElementById('csv-dropzone');
      if (dz) dz.classList.add('dragover');
    }

    function handleDragLeave(e) {
      e.preventDefault();
      const dz = document.getElementById('csv-dropzone');
      if (dz) dz.classList.remove('dragover');
    }

    function handleFileDrop(e) {
      e.preventDefault();
      const dz = document.getElementById('csv-dropzone');
      if (dz) dz.classList.remove('dragover');

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        readAndProcessFile(e.dataTransfer.files[0]);
      }
    }

    function handleFileSelect(e) {
      if (e.target && e.target.files && e.target.files[0]) {
        readAndProcessFile(e.target.files[0]);
      }
    }

    function processPastedCsv() {
      const val = document.getElementById('paste-csv-input').value;
      if (!val.trim()) {
        toast('Please paste some CSV text first', 'error');
        return;
      }
      readAndProcessText(val, 'pasted_data.csv');
    }

    function readAndProcessFile(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        readAndProcessText(text, file.name);
      };
      reader.onerror = () => {
        toast('Failed to read file', 'error');
      };
      reader.readAsText(file);
    }

    function readAndProcessText(text, fileName) {
      const parsed = parseCsvClient(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        toast('CSV file is empty or could not be parsed', 'error');
        return;
      }

      const col = state.activeCollection;
      currentImport.fileName = fileName;
      currentImport.headers = parsed.headers;
      currentImport.rows = parsed.rows;
      currentImport.mapping = {};

      // Auto-map columns
      for (const h of parsed.headers) {
        currentImport.mapping[h] = findBestFieldMatch(h, col);
      }

      renderImportModalStep2();
    }

    function renderImportModalStep2() {
      const col = state.activeCollection;
      const modal = document.getElementById('modal-root');

      // Options for schema field dropdown
      const fieldOptions = [
        { value: '', label: '-- Skip Field (Do not import) --' }
      ];

      if (col.type === 'auth') {
        fieldOptions.push(
          { value: 'email', label: 'email (email) *' },
          { value: 'password', label: 'password (text)' }
        );
      }

      for (const f of col.schema) {
        fieldOptions.push({
          value: f.name,
          label: `${f.name} (${f.type})${f.required ? ' *' : ''}`
        });
      }

      fieldOptions.push(
        { value: 'id', label: 'id (system ID)' },
        { value: 'created', label: 'created (system timestamp)' },
        { value: 'updated', label: 'updated (system timestamp)' }
      );

      modal.innerHTML = `
        <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div>
                <h2 class="modal-title">Visual Column Mapping — ${col.name}</h2>
                <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
                  Step 2: Map CSV columns to collection fields (File: <span class="code-badge">${currentImport.fileName}</span> — <strong>${currentImport.rows.length}</strong> rows detected)
                </div>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
            </div>
            <div class="modal-body" style="gap:1.25rem;">
              <div class="mapping-table-container">
                <table class="mapping-table">
                  <thead>
                    <tr>
                      <th style="width:28%;">CSV Column Header</th>
                      <th style="width:32%;">Sample Values</th>
                      <th style="width:5%; text-align:center;"></th>
                      <th style="width:35%;">Collection Destination Field</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${currentImport.headers.map((h, idx) => {
                      const sampleVals = currentImport.rows.slice(0, 2).map(r => r[h]).filter(v => v !== undefined && v !== '');
                      const sampleStr = sampleVals.length > 0 ? sampleVals.join(' | ') : '<em style="color:#6b7280;">(empty)</em>';
                      const selected = currentImport.mapping[h] || '';

                      return `
                        <tr>
                          <td>
                            <span style="font-weight:600; font-size:13px;">${h}</span>
                          </td>
                          <td>
                            <span class="code-badge" title="${String(sampleStr).replace(/"/g, '&quot;')}">${sampleStr}</span>
                          </td>
                          <td style="text-align:center; color:var(--text-muted); font-size:14px;">
                            ➔
                          </td>
                          <td>
                            <select class="form-select" style="padding:0.4rem 0.6rem; font-size:12px; width:100%;" onchange="updateColumnMapping('${h.replace(/'/g, "\\'")}', this.value)">
                              ${fieldOptions.map(opt => `
                                <option value="${opt.value}" ${opt.value === selected ? 'selected' : ''}>${opt.label}</option>
                              `).join('')}
                            </select>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>

              <!-- Live Mapped Preview -->
              <div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                  <h4 style="font-size:13px; font-weight:700;">Live Mapped Preview (First 3 Rows)</h4>
                  <span style="font-size:11px; color:var(--text-muted);">Updates in real time as mappings change</span>
                </div>
                <div class="mapping-table-container" style="max-height:160px; overflow:auto;">
                  <table class="mapping-table" id="live-preview-table">
                    <!-- Injected dynamically -->
                  </table>
                </div>
              </div>

              <!-- Import Options -->
              <div style="display:flex; align-items:center; justify-content:space-between; padding:0.75rem 1rem; background:var(--bg-input); border-radius:6px; border:1px solid var(--border-subtle); font-size:12px;">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                  <input type="checkbox" id="import-continue-on-error" ${currentImport.continueOnError ? 'checked' : ''} onchange="currentImport.continueOnError = this.checked">
                  <span>Skip records with validation errors and continue importing</span>
                </label>
                <span style="color:var(--text-muted);">Ready to import: <strong>${currentImport.rows.length}</strong> records</span>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" onclick="renderImportModalStep1()">← Change File</button>
              <button class="btn btn-primary" id="btn-do-import" onclick="executeImport()">
                <span>Import ${currentImport.rows.length} Records</span>
              </button>
            </div>
          </div>
        </div>
      `;

      renderLivePreview();
    }

    function updateColumnMapping(csvHeader, targetField) {
      currentImport.mapping[csvHeader] = targetField;
      renderLivePreview();
    }

    function renderLivePreview() {
      const table = document.getElementById('live-preview-table');
      if (!table) return;

      const activeMappings = Object.entries(currentImport.mapping).filter(([_, target]) => Boolean(target));
      if (activeMappings.length === 0) {
        table.innerHTML = `<tbody><tr><td colspan="5" style="text-align:center; padding:1.5rem; color:var(--text-muted);">No fields mapped yet. Map at least one column above to preview data.</td></tr></tbody>`;
        return;
      }

      const mappedHeaders = activeMappings.map(([_, target]) => target);
      const previewRows = currentImport.rows.slice(0, 3);

      table.innerHTML = `
        <thead>
          <tr>
            ${mappedHeaders.map(h => `<th>${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${previewRows.map(row => `
            <tr>
              ${activeMappings.map(([csvH, _]) => {
                const val = row[csvH];
                if (val === undefined || val === '') return '<td style="color:#6b7280;">NULL</td>';
                return `<td>${String(val).slice(0, 40)}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      `;
    }

    async function executeImport() {
      const col = state.activeCollection;
      if (!col) return;

      const activeMappings = Object.entries(currentImport.mapping).filter(([_, target]) => Boolean(target));
      if (activeMappings.length === 0) {
        toast('Please map at least one CSV column to a collection field', 'error');
        return;
      }

      const btn = document.getElementById('btn-do-import');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Importing...</span>';
      }

      try {
        // Transform all rows using mapped columns
        const recordsToImport = [];
        for (const row of currentImport.rows) {
          const rec = {};
          let hasAnyVal = false;
          for (const [csvH, targetF] of activeMappings) {
            const rawVal = row[csvH];
            if (rawVal !== undefined && rawVal !== '') {
              hasAnyVal = true;
              rec[targetF] = rawVal;
            }
          }
          if (hasAnyVal) {
            recordsToImport.push(rec);
          }
        }

        if (recordsToImport.length === 0) {
          throw new Error('No non-empty records found to import with current mappings');
        }

        const res = await api(`/api/collections/${col.name}/import`, {
          method: 'POST',
          body: JSON.stringify({
            records: recordsToImport,
            options: {
              continueOnError: currentImport.continueOnError,
            },
          }),
        });

        renderImportResults(res);
        await loadRecords();
      } catch (e) {
        toast(e.message, 'error');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `<span>Import ${currentImport.rows.length} Records</span>`;
        }
      }
    }

    function renderImportResults(res) {
      const col = state.activeCollection;
      const modal = document.getElementById('modal-root');

      const hasErrors = res.errors && res.errors.length > 0;

      modal.innerHTML = `
        <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
          <div class="modal modal-lg">
            <div class="modal-header">
              <h2 class="modal-title">Import Finished — ${col.name}</h2>
              <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
            </div>
            <div class="modal-body" style="gap:1.25rem;">
              <div style="background:${hasErrors && res.imported === 0 ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'}; border:1px solid ${hasErrors && res.imported === 0 ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}; border-radius:8px; padding:1.25rem; display:flex; align-items:center; gap:1rem;">
                <div style="font-size:28px;">
                  ${res.imported > 0 ? '🎉' : '⚠️'}
                </div>
                <div>
                  <div style="font-weight:700; font-size:15px; color:${res.imported > 0 ? '#34d399' : '#f87171'};">
                    ${res.imported} of ${res.total} records imported successfully
                  </div>
                  <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
                    ${hasErrors ? `${res.failed} records had issues and were skipped.` : 'All records were validated and inserted into the database.'}
                  </div>
                </div>
              </div>

              ${hasErrors ? `
                <div>
                  <h4 style="font-size:13px; font-weight:700; color:#f87171; margin-bottom:0.5rem;">Errors & Skipped Rows (${res.errors.length})</h4>
                  <div class="mapping-table-container" style="max-height:220px; overflow-y:auto;">
                    <table class="mapping-table">
                      <thead>
                        <tr>
                          <th style="width:15%;">Row</th>
                          <th style="width:85%;">Error Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${res.errors.map(err => `
                          <tr>
                            <td><span class="code-badge">Row ${err.row}</span></td>
                            <td style="color:#f87171; font-family:var(--font-mono); font-size:12px;">${err.error}</td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  </div>
                </div>
              ` : ''}
            </div>
            <div class="modal-footer">
              <button class="btn btn-primary" onclick="closeModal()">Done</button>
            </div>
          </div>
        </div>
      `;

      toast(`Import finished: ${res.imported} records added to ${col.name}`, res.imported > 0 ? 'success' : 'error');
    }

    // ==========================================
    // 1-Click Generate Mock Data Modal (Faker Engine)
    // ==========================================

    let selectedMockCount = 50;

    function getFieldMockDescription(f, col) {
      const clean = f.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (f.type === 'email' || clean.includes('email') || clean.includes('mail')) {
        return 'Realistic unique emails (e.g. sarah.jenkins@example.com)';
      }
      if (f.type === 'file') {
        if (clean.includes('avatar') || clean.includes('photo') || clean.includes('profile')) {
          return 'DiceBear / Unsplash avatar images (with SVG badge fallback)';
        }
        return 'Placeholder cover/product images with SVG metadata';
      }
      if (f.type === 'select') {
        const vals = f.options?.values || ['draft', 'published', 'archived'];
        return `Random distribution across options: [${vals.slice(0, 3).join(', ')}${vals.length > 3 ? '...' : ''}]`;
      }
      if (f.type === 'relation') {
        const targetId = f.options?.collectionId || 'collection';
        const targetCol = state.collections.find(c => c.id === targetId || c.name === targetId);
        const colTitle = targetCol ? targetCol.name : targetId;
        return `Auto-links to existing '${colTitle}' records (auto-seeds if empty)`;
      }
      if (f.type === 'number') {
        if (clean.includes('price') || clean.includes('cost') || clean.includes('amount') || clean.includes('salary')) {
          return 'Realistic currency figures (e.g. $19.99, $49.00, $129.50)';
        }
        if (clean === 'age') return 'Realistic human ages (18-70)';
        if (clean.includes('rating') || clean.includes('score')) return 'Star ratings (3.5 - 5.0)';
        return 'Random realistic numeric values';
      }
      if (f.type === 'bool') {
        return 'Distributed booleans (true/false weighted for active/published)';
      }
      if (f.type === 'date') {
        return 'Realistic ISO timestamps in recent past';
      }
      if (f.type === 'json') {
        return 'Structured mock JSON (tags, settings, address)';
      }
      if (clean === 'name' || clean === 'fullname' || clean === 'author' || clean === 'customer') {
        return 'Real human full names (e.g. Sarah Jenkins, Marcus Vance)';
      }
      if (clean === 'firstname') return 'First names (e.g. Sarah, Marcus)';
      if (clean === 'lastname') return 'Last names (e.g. Jenkins, Vance)';
      if (clean.includes('company') || clean.includes('org')) return 'Company names (e.g. Acme Corp, Nexus Digital)';
      if (clean.includes('title') || clean.includes('headline')) return 'Article/Product titles';
      if (clean.includes('bio') || clean.includes('desc') || clean.includes('about')) return 'Natural sentences and bios';
      if (clean.includes('city')) return 'World cities (e.g. San Francisco, Tokyo)';
      if (clean.includes('country')) return 'Country names (e.g. United States, Japan)';
      if (clean.includes('street') || clean.includes('address')) return 'Realistic street addresses';
      if (clean.includes('phone') || clean.includes('tel')) return 'International phone numbers';
      return `Realistic synthetic ${f.name} values`;
    }

    function selectMockCount(count) {
      selectedMockCount = count;
      document.querySelectorAll('.count-pill').forEach(btn => {
        if (parseInt(btn.getAttribute('data-count')) === count) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      const input = document.getElementById('mock-custom-count');
      if (input) input.value = count;
      const submitBtn = document.getElementById('btn-submit-mock');
      if (submitBtn) {
        submitBtn.innerHTML = `<span>✨ Generate ${count} Records</span>`;
      }
    }

    function onMockCustomCountChange(val) {
      const parsed = Math.max(1, Math.min(500, parseInt(val) || 25));
      selectedMockCount = parsed;
      document.querySelectorAll('.count-pill').forEach(btn => {
        if (parseInt(btn.getAttribute('data-count')) === parsed) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      const submitBtn = document.getElementById('btn-submit-mock');
      if (submitBtn) {
        submitBtn.innerHTML = `<span>✨ Generate ${parsed} Records</span>`;
      }
    }

    function openMockDataModal() {
      const col = state.activeCollection;
      if (!col) return;

      selectedMockCount = 50;
      const modal = document.getElementById('modal-root');
      modal.innerHTML = `
        <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div style="display:flex; align-items:center; gap:0.75rem;">
                <div style="width:36px; height:36px; border-radius:8px; background:rgba(59,130,246,0.15); color:#60a5fa; display:flex; align-items:center; justify-content:center; font-size:18px;">
                  ✨
                </div>
                <div>
                  <h2 class="modal-title" style="margin:0;">Generate Mock Data — ${col.name}</h2>
                  <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Built-in Faker Engine with intelligent schema type inspection</div>
                </div>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
            </div>

            <div class="modal-body" style="gap:1.25rem;">
              <!-- Record Count Picker -->
              <div>
                <label class="form-label" style="margin-bottom:0.5rem; font-weight:600;">How many records would you like to generate?</label>
                <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                  <button type="button" class="count-pill" data-count="10" onclick="selectMockCount(10)">10 records</button>
                  <button type="button" class="count-pill" data-count="25" onclick="selectMockCount(25)">25 records</button>
                  <button type="button" class="count-pill active" data-count="50" onclick="selectMockCount(50)">50 records</button>
                  <button type="button" class="count-pill" data-count="100" onclick="selectMockCount(100)">100 records</button>
                  
                  <div style="display:flex; align-items:center; gap:6px; margin-left:auto;">
                    <span style="font-size:12px; color:var(--text-muted);">Custom:</span>
                    <input type="number" id="mock-custom-count" min="1" max="500" value="50" class="form-input" style="width:80px; padding:0.35rem 0.5rem; text-align:center;" oninput="onMockCustomCountChange(this.value)">
                  </div>
                </div>
              </div>

              <!-- Schema Field Inspection Preview -->
              <div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.5rem;">
                  <label class="form-label" style="margin:0; font-weight:600;">Schema Field Inspection</label>
                  <span style="font-size:11px; color:var(--text-muted);">${col.schema.length + (col.type === 'auth' ? 2 : 0)} fields detected</span>
                </div>
                <div class="mapping-table-container" style="max-height:220px; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:6px;">
                  <table class="mapping-table" style="width:100%; border-collapse:collapse; font-size:12px;">
                    <thead>
                      <tr style="background:var(--bg-input); text-align:left; border-bottom:1px solid var(--border-subtle);">
                        <th style="padding:8px 12px; width:25%;">Field</th>
                        <th style="padding:8px 12px; width:15%;">Type</th>
                        <th style="padding:8px 12px; width:60%;">Simulated Content</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${col.type === 'auth' ? `
                        <tr style="border-bottom:1px solid var(--border-subtle);">
                          <td style="padding:8px 12px; font-weight:600;">email</td>
                          <td style="padding:8px 12px;"><span class="badge">auth</span></td>
                          <td style="padding:8px 12px; color:var(--text-muted);">Unique realistic emails (e.g. sarah.jenkins@example.com)</td>
                        </tr>
                        <tr style="border-bottom:1px solid var(--border-subtle);">
                          <td style="padding:8px 12px; font-weight:600;">password</td>
                          <td style="padding:8px 12px;"><span class="badge">auth</span></td>
                          <td style="padding:8px 12px; color:var(--text-muted);">Secure bcrypt-hashed credentials ("NodeStack2026!")</td>
                        </tr>
                      ` : ''}
                      ${col.schema.map(f => `
                        <tr style="border-bottom:1px solid var(--border-subtle);">
                          <td style="padding:8px 12px; font-weight:600;">
                            ${f.name} ${f.required ? '<span style="color:#f87171;">*</span>' : ''}
                          </td>
                          <td style="padding:8px 12px;">
                            <span class="badge badge-${f.type}">${f.type}</span>
                          </td>
                          <td style="padding:8px 12px; color:var(--text-muted);">
                            ${getFieldMockDescription(f, col)}
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Options -->
              <div style="background:var(--bg-input); padding:0.85rem 1rem; border-radius:6px; border:1px solid var(--border-subtle); display:flex; flex-direction:column; gap:0.6rem;">
                <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                  <input type="checkbox" id="mock-download-files" checked style="cursor:pointer;">
                  <span>Auto-download realistic avatar / placeholder images (DiceBear / Unsplash)</span>
                </label>
                <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                  <input type="checkbox" id="mock-auto-seed-relations" checked style="cursor:pointer;">
                  <span>Automatically seed empty referenced collections to satisfy relations</span>
                </label>
              </div>
            </div>

            <div class="modal-footer">
              <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
              <button class="btn btn-primary" id="btn-submit-mock" onclick="submitGenerateMockData()">
                <span>✨ Generate ${selectedMockCount} Records</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }

    async function submitGenerateMockData() {
      const col = state.activeCollection;
      if (!col) return;

      const submitBtn = document.getElementById('btn-submit-mock');
      const downloadFiles = document.getElementById('mock-download-files')?.checked ?? true;
      const autoSeedRelations = document.getElementById('mock-auto-seed-relations')?.checked ?? true;

      const count = selectedMockCount || 50;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
          <div style="width:14px; height:14px; border:2px solid #ffffff; border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite;"></div>
          <span>Generating ${count} Records...</span>
        `;
      }

      try {
        const res = await api(`/api/collections/${col.name}/generate-mock`, {
          method: 'POST',
          body: JSON.stringify({
            count,
            options: {
              downloadFiles,
              autoSeedRelations,
            },
          }),
        });

        toast(`✨ Successfully generated ${res.count || count} realistic records!`, 'success');
        closeModal();
        await loadRecords();
      } catch (err) {
        toast(`Mock Generation Failed: ${err.message || String(err)}`, 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<span>✨ Generate ${count} Records</span>`;
        }
      }
    }
