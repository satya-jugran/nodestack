// Schema & Fields Management
    const FIELD_TYPE_ICONS = {
      text: '🔤',
      number: '🔢',
      bool: '☑️',
      email: '📧',
      url: '🌐',
      date: '📅',
      select: '📋',
      json: '📦',
      file: '📎',
      relation: '🔗',
    };

    const FIELD_TYPES = ['text', 'number', 'bool', 'email', 'url', 'date', 'select', 'json', 'file', 'relation'];

    let draggedFieldIdx = null;

    function handleFieldDragStart(event, idx) {
      draggedFieldIdx = idx;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(idx));
      }
    }

    function handleFieldDragOver(event) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    }

    function handleFieldDrop(event, targetIdx) {
      event.preventDefault();
      const sourceIdx = draggedFieldIdx !== null ? draggedFieldIdx : parseInt(event.dataTransfer?.getData('text/plain'), 10);
      draggedFieldIdx = null;
      if (!isNaN(sourceIdx) && sourceIdx !== targetIdx) {
        moveField(sourceIdx, targetIdx);
      }
    }

    function moveField(fromIdx, toIdx) {
      const schema = state.activeCollection?.schema;
      if (!schema || fromIdx < 0 || fromIdx >= schema.length || toIdx < 0 || toIdx >= schema.length || fromIdx === toIdx) return;
      const [moved] = schema.splice(fromIdx, 1);
      schema.splice(toIdx, 0, moved);
      renderFieldRows(schema);
      renderAccessRulesSection(state.activeCollection);
    }

    function moveFieldUp(idx) {
      moveField(idx, idx - 1);
    }

    function moveFieldDown(idx) {
      moveField(idx, idx + 1);
    }

    function updateFieldOption(idx, prop, val) {
      const f = state.activeCollection?.schema?.[idx];
      if (!f) return;
      f.options = f.options || {};
      f.options[prop] = val;
    }

    function updateFieldSelectValues(idx, val) {
      const f = state.activeCollection?.schema?.[idx];
      if (!f) return;
      f.options = f.options || {};
      f.options.values = val.split(',').map(s => s.trim()).filter(Boolean);
    }

    function renderSchemaView() {
      const col = state.activeCollection;

      // Initialize rules state for this collection
      state.activeRules = {};
      for (const rk of RULE_KEYS) {
        state.activeRules[rk.key] = initRuleState(col[rk.prop]);
      }

      const actions = document.getElementById('view-actions');
      actions.innerHTML = `
        ${!col.system ? `
          <button class="btn btn-danger btn-sm" onclick="openDeleteCollectionModal('${col.name}')" title="Permanently delete this collection">
            Delete Collection
          </button>
        ` : ''}
        <button class="btn btn-primary btn-sm" onclick="saveSchemaChanges()">Save Schema</button>
      `;

      const main = document.getElementById('main-body');
      main.innerHTML = `
        <div style="max-width: 860px; display:flex; flex-direction:column; gap: 1.5rem;">
          <div class="form-group">
            <label class="form-label">Collection Name</label>
            <input type="text" class="form-input" id="schema-col-name" value="${col.name}" ${col.system ? 'disabled' : ''}>
          </div>

          <div style="border:1px solid var(--border-subtle); border-radius:8px; padding:1.25rem; background:var(--bg-card);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
              <h3 style="font-size:14px; font-weight:700;">Fields Schema</h3>
              <button class="btn btn-secondary btn-sm" onclick="addFieldToSchema()">+ Add Field</button>
            </div>
            <div id="schema-fields-container" style="display:flex; flex-direction:column; gap:0.75rem;">
              <!-- Field rows -->
            </div>
          </div>

          <div id="access-rules-container-wrapper">
            <!-- Access Rules Section -->
          </div>

          ${!col.system ? `
            <div style="border:1px solid rgba(239, 68, 68, 0.35); border-radius:8px; padding:1.25rem; background:rgba(239, 68, 68, 0.05); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
              <div>
                <h4 style="color:#ef4444; font-size:14px; font-weight:700; margin-bottom:0.25rem;">⚠️ Danger Zone</h4>
                <p style="font-size:12px; color:var(--text-muted); margin:0;">
                  Permanently delete collection <strong>${col.name}</strong>, drop the SQLite table, and delete all records and stored files.
                </p>
              </div>
              <button class="btn btn-danger btn-sm" onclick="openDeleteCollectionModal('${col.name}')">Delete Collection</button>
            </div>
          ` : ''}
        </div>
      `;

      renderFieldRows(col.schema);
      renderAccessRulesSection(col);
    }

    function renderFieldRows(fields) {
      const container = document.getElementById('schema-fields-container');
      if (!container) return;

      const collections = state.collections || [];

      container.innerHTML = fields.map((f, idx) => {
        const isRelation = f.type === 'relation';
        const isSelect = f.type === 'select';
        const icon = FIELD_TYPE_ICONS[f.type] || '🏷️';

        // Target collection configuration for relation type
        let relationConfigHtml = '';
        if (isRelation) {
          const selectedTarget = f.options?.collectionId || '';

          relationConfigHtml = `
            <div class="field-target-config field-relation-config" style="display:flex; align-items:center; gap:0.35rem; font-size:12px; color:var(--text-muted); flex:2; min-width:180px;">
              <span style="white-space:nowrap; font-weight:500;">Relates to:</span>
              <select class="form-select field-relation-select" style="flex:1; min-width:110px; font-size:12px;" onchange="updateFieldOption(${idx}, 'collectionId', this.value)">
                ${collections.map(c => `
                  <option value="${escapeHtml(c.id)}" ${selectedTarget === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>
                `).join('')}
              </select>
            </div>
          `;
        }

        // Allowed options configuration for select type
        let selectConfigHtml = '';
        if (isSelect) {
          const allowedVals = Array.isArray(f.options?.values) ? f.options.values.join(', ') : (f.options?.values || '');
          selectConfigHtml = `
            <div class="field-target-config field-select-config" style="display:flex; align-items:center; gap:0.35rem; font-size:12px; color:var(--text-muted); flex:2; min-width:180px;">
              <span style="white-space:nowrap; font-weight:500;">Allowed options:</span>
              <input type="text" class="form-input field-select-values-input" style="flex:1; min-width:120px; font-size:12px;" value="${escapeHtml(allowedVals)}" placeholder="draft, published" onchange="updateFieldSelectValues(${idx}, this.value)" title="Comma-separated allowed options">
            </div>
          `;
        }

        return `
          <div class="schema-field-row" style="display:flex; gap:0.6rem; align-items:center; background:var(--bg-input); padding:0.5rem 0.75rem; border-radius:6px; flex-wrap:wrap;" data-index="${idx}" draggable="true" ondragstart="handleFieldDragStart(event, ${idx})" ondragover="handleFieldDragOver(event)" ondrop="handleFieldDrop(event, ${idx})">
            <div class="field-reorder-group" style="display:flex; align-items:center; gap:2px;">
              <span class="field-drag-handle" title="Drag to reorder" style="cursor:grab; user-select:none; color:var(--text-muted); font-size:14px; padding:0 2px;">⋮⋮</span>
              <div class="field-reorder-buttons" style="display:flex; flex-direction:column;">
                <button type="button" class="btn-field-reorder btn-field-up" onclick="moveFieldUp(${idx})" ${idx === 0 ? 'disabled' : ''} title="Move up" style="line-height:1; padding:0 2px; font-size:9px; background:none; border:none; color:var(--text-muted); cursor:${idx === 0 ? 'default' : 'pointer'}; opacity:${idx === 0 ? 0.35 : 1};">▲</button>
                <button type="button" class="btn-field-reorder btn-field-down" onclick="moveFieldDown(${idx})" ${idx === fields.length - 1 ? 'disabled' : ''} title="Move down" style="line-height:1; padding:0 2px; font-size:9px; background:none; border:none; color:var(--text-muted); cursor:${idx === fields.length - 1 ? 'default' : 'pointer'}; opacity:${idx === fields.length - 1 ? 0.35 : 1};">▼</button>
              </div>
            </div>

            <span class="badge field-type-badge" data-type="${f.type}" style="font-size:11px; padding:2px 6px; background:rgba(255,255,255,0.06); border:1px solid var(--border-subtle); display:inline-flex; align-items:center; gap:3px;">
              <span class="field-type-icon">${icon}</span>
            </span>

            <input type="text" class="form-input field-name-input" style="flex:2; min-width:110px;" value="${escapeHtml(f.name)}" placeholder="Field name" oninput="state.activeCollection.schema[${idx}].name = this.value" onchange="updateField(${idx}, 'name', this.value)">

            <select class="form-select field-type-select" style="flex:1.5; min-width:130px;" onchange="updateField(${idx}, 'type', this.value)">
              ${FIELD_TYPES.map(t => `
                <option value="${t}" ${f.type === t ? 'selected' : ''}>${FIELD_TYPE_ICONS[t] || '🏷️'} ${t}</option>
              `).join('')}
            </select>

            ${relationConfigHtml}
            ${selectConfigHtml}

            <label style="display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer; user-select:none;">
              <input type="checkbox" ${f.required ? 'checked' : ''} onchange="updateField(${idx}, 'required', this.checked)"> Req
            </label>
            <label style="display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer; user-select:none;">
              <input type="checkbox" ${f.unique ? 'checked' : ''} onchange="updateField(${idx}, 'unique', this.checked)"> Uniq
            </label>
            <button type="button" class="btn btn-danger btn-sm" onclick="removeField(${idx})" title="Remove field">✕</button>
          </div>
        `;
      }).join('');
    }

    function addFieldToSchema() {
      state.activeCollection.schema.push({
        id: `f_${Math.random().toString(36).substring(2, 8)}`,
        name: `field_${state.activeCollection.schema.length + 1}`,
        type: 'text',
        required: false,
        unique: false,
        options: {},
      });
      renderFieldRows(state.activeCollection.schema);
      renderAccessRulesSection(state.activeCollection);
    }

    function updateField(idx, prop, val) {
      const f = state.activeCollection?.schema?.[idx];
      if (!f) return;
      f[prop] = val;

      if (prop === 'type') {
        f.options = f.options || {};
        if (val === 'relation') {
          if (!f.options.collectionId) {
            const otherCols = (state.collections || []).filter(c => c.id !== state.activeCollection?.id);
            const targetCol = otherCols.length > 0 ? otherCols[0] : state.collections?.[0];
            f.options.collectionId = targetCol ? targetCol.id : '';
          }
        } else if (val === 'select') {
          if (!f.options.values) {
            f.options.values = [];
          }
        }
        renderFieldRows(state.activeCollection.schema);
      }

      if (prop === 'name') {
        renderAccessRulesSection(state.activeCollection);
      }
    }

    function removeField(idx) {
      state.activeCollection.schema.splice(idx, 1);
      renderFieldRows(state.activeCollection.schema);
      renderAccessRulesSection(state.activeCollection);
    }

    async function saveSchemaChanges() {
      const col = state.activeCollection;
      try {
        const body = {
          name: document.getElementById('schema-col-name').value.trim(),
          schema: col.schema,
          listRule: getRuleValueToSave('list'),
          viewRule: getRuleValueToSave('view'),
          createRule: getRuleValueToSave('create'),
          updateRule: getRuleValueToSave('update'),
          deleteRule: getRuleValueToSave('delete'),
        };

        const updated = await api(`/api/collections/${col.name}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });

        toast('Schema & API rules updated successfully!', 'success');
        await loadCollections();
        selectCollection(updated.name);
      } catch (e) {
        toast(e.message, 'error');
      }
    }
