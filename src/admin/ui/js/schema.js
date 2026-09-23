// Schema & Fields Management
    function renderSchemaView() {
      const col = state.activeCollection;

      // Initialize rules state for this collection
      state.activeRules = {};
      for (const rk of RULE_KEYS) {
        state.activeRules[rk.key] = initRuleState(col[rk.prop]);
      }

      const actions = document.getElementById('view-actions');
      actions.innerHTML = `
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
        </div>
      `;

      renderFieldRows(col.schema);
      renderAccessRulesSection(col);
    }

    function renderFieldRows(fields) {
      const container = document.getElementById('schema-fields-container');
      container.innerHTML = fields.map((f, idx) => `
        <div style="display:flex; gap:0.75rem; align-items:center; background:var(--bg-input); padding:0.5rem 0.75rem; border-radius:6px;" data-index="${idx}">
          <input type="text" class="form-input" style="flex:2;" value="${f.name}" placeholder="Field name" onchange="updateField(${idx}, 'name', this.value)">
          <select class="form-select" style="flex:1.5;" onchange="updateField(${idx}, 'type', this.value)">
            ${['text', 'number', 'bool', 'email', 'url', 'date', 'select', 'json', 'file', 'relation'].map(t => `
              <option value="${t}" ${f.type === t ? 'selected' : ''}>${t}</option>
            `).join('')}
          </select>
          <label style="display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer;">
            <input type="checkbox" ${f.required ? 'checked' : ''} onchange="updateField(${idx}, 'required', this.checked)"> Req
          </label>
          <label style="display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer;">
            <input type="checkbox" ${f.unique ? 'checked' : ''} onchange="updateField(${idx}, 'unique', this.checked)"> Uniq
          </label>
          <button class="btn btn-danger btn-sm" onclick="removeField(${idx})">✕</button>
        </div>
      `).join('');
    }

    function addFieldToSchema() {
      state.activeCollection.schema.push({
        id: `f_${Math.random().toString(36).substring(2, 8)}`,
        name: `field_${state.activeCollection.schema.length + 1}`,
        type: 'text',
        required: false,
        unique: false,
      });
      renderFieldRows(state.activeCollection.schema);
      renderAccessRulesSection(state.activeCollection);
    }

    function updateField(idx, prop, val) {
      state.activeCollection.schema[idx][prop] = val;
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
