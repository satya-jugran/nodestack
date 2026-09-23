// Visual Access Rule Builder
    const RULE_KEYS = [
      { key: 'list', prop: 'listRule', title: 'List Rule', desc: 'List & search collection records' },
      { key: 'view', prop: 'viewRule', title: 'View Rule', desc: 'Fetch single record by ID' },
      { key: 'create', prop: 'createRule', title: 'Create Rule', desc: 'Insert new record into collection' },
      { key: 'update', prop: 'updateRule', title: 'Update Rule', desc: 'Modify existing record fields' },
      { key: 'delete', prop: 'deleteRule', title: 'Delete Rule', desc: 'Permanently remove a record' },
    ];


    function initRuleState(ruleVal) {
      if (ruleVal === null || ruleVal === undefined || ruleVal === 'null') {
        return {
          mode: 'admin',
          editorMode: 'visual',
          join: '&&',
          clauses: [],
          raw: 'null',
        };
      }

      const trimmed = String(ruleVal).trim();
      if (trimmed === '' || trimmed === '""' || trimmed === "''") {
        if (trimmed === '') {
          return {
            mode: 'public',
            editorMode: 'visual',
            join: '&&',
            clauses: [],
            raw: '',
          };
        }
      }

      if (trimmed === '@request.auth.id != ""' || trimmed === "@request.auth.id != ''" || trimmed === '@request.auth.id != null') {
        return {
          mode: 'auth',
          editorMode: 'visual',
          join: '&&',
          clauses: [{ field: '@request.auth.id', operator: '!=', value: '""' }],
          raw: '@request.auth.id != ""',
        };
      }

      const parsed = parseClientRuleExpression(trimmed);
      return {
        mode: 'custom',
        editorMode: parsed.canBeVisual ? 'visual' : 'raw',
        join: parsed.join || '&&',
        clauses: parsed.clauses.length > 0 ? parsed.clauses : [{ field: '@request.auth.id', operator: '!=', value: '""' }],
        raw: trimmed,
      };
    }

    function parseClientRuleExpression(expr) {
      if (!expr || expr.trim() === '') {
        return { canBeVisual: true, join: '&&', clauses: [] };
      }
      const trimmed = expr.trim();

      // Check OR
      const orParts = splitTopLevelClient(trimmed, '||');
      if (orParts.length > 1) {
        const clauses = [];
        let ok = true;
        for (const p of orParts) {
          const c = parseSingleClauseClient(p);
          if (c) clauses.push(c);
          else { ok = false; break; }
        }
        if (ok && clauses.length > 0) {
          return { canBeVisual: true, join: '||', clauses };
        }
      }

      // Check AND
      const andParts = splitTopLevelClient(trimmed, '&&');
      const clauses = [];
      let ok = true;
      for (const p of andParts) {
        const c = parseSingleClauseClient(p);
        if (c) clauses.push(c);
        else { ok = false; break; }
      }
      if (ok && clauses.length > 0) {
        return { canBeVisual: true, join: '&&', clauses };
      }

      // Single clause
      const single = parseSingleClauseClient(trimmed);
      if (single) {
        return { canBeVisual: true, join: '&&', clauses: [single] };
      }

      return { canBeVisual: false, join: '&&', clauses: [] };
    }

    function parseSingleClauseClient(str) {
      let clean = str.trim();
      if (clean.startsWith('(') && clean.endsWith(')')) {
        clean = clean.slice(1, -1).trim();
      }

      const operators = ['!=', '>=', '<=', '=', '>', '<', '~'];
      for (const op of operators) {
        const idx = findOperatorIndexClient(clean, op);
        if (idx !== -1) {
          const left = clean.substring(0, idx).trim();
          const right = clean.substring(idx + op.length).trim();
          if (left) {
            return { field: left, operator: op, value: right };
          }
        }
      }

      if (clean) {
        return { field: clean, operator: '!=', value: '""' };
      }
      return null;
    }

    function splitTopLevelClient(str, delimiter) {
      const parts = [];
      let current = '';
      let depth = 0;
      let inQuote = false;
      let quoteChar = '';

      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if ((char === '"' || char === "'") && (i === 0 || str[i - 1] !== '\\')) {
          if (!inQuote) { inQuote = true; quoteChar = char; }
          else if (char === quoteChar) { inQuote = false; }
        }
        if (!inQuote) {
          if (char === '(') depth++;
          else if (char === ')') depth--;
          else if (depth === 0 && str.startsWith(delimiter, i)) {
            parts.push(current);
            current = '';
            i += delimiter.length - 1;
            continue;
          }
        }
        current += char;
      }
      if (current) parts.push(current);
      return parts;
    }

    function findOperatorIndexClient(str, op) {
      let depth = 0;
      let inQuote = false;
      let quoteChar = '';
      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if ((char === '"' || char === "'") && (i === 0 || str[i - 1] !== '\\')) {
          if (!inQuote) { inQuote = true; quoteChar = char; }
          else if (char === quoteChar) { inQuote = false; }
        }
        if (!inQuote) {
          if (char === '(') depth++;
          else if (char === ')') depth--;
          else if (depth === 0 && str.startsWith(op, i)) {
            if (op === '=' && i > 0 && (str[i - 1] === '!' || str[i - 1] === '<' || str[i - 1] === '>')) {
              continue;
            }
            return i;
          }
        }
      }
      return -1;
    }

    function formatClauseValClient(val, knownFields = []) {
      if (val === undefined || val === null || val === '') return '""';
      const trimmed = String(val).trim();
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed;
      }
      if (!isNaN(Number(trimmed)) && trimmed !== '') return trimmed;
      if (trimmed.toLowerCase() === 'true' || trimmed.toLowerCase() === 'false' || trimmed.toLowerCase() === 'null') {
        return trimmed.toLowerCase();
      }
      if (trimmed.startsWith('@')) return trimmed;

      const defaultIdentifiers = ['id', 'user', 'userId', 'user_id', 'author', 'authorId', 'author_id', 'owner', 'ownerId', 'created', 'updated'];
      const combined = new Set([...defaultIdentifiers, ...knownFields]);
      if (combined.has(trimmed) || trimmed.endsWith('_id') || trimmed.endsWith('Id')) {
        return trimmed;
      }
      return JSON.stringify(trimmed);
    }

    function buildRuleFromClausesClient(clauses, joinOp, knownFields = []) {
      const valid = (clauses || []).filter(c => c && c.field && c.field.trim() !== '');
      if (valid.length === 0) return '';
      return valid.map(c => {
        const f = c.field.trim();
        const op = c.operator || '=';
        const v = formatClauseValClient(c.value, knownFields);
        return `${f} ${op} ${v}`;
      }).join(` ${joinOp || '&&'} `);
    }

    function getEvaluatedRule(ruleKey) {
      const r = state.activeRules[ruleKey];
      if (!r) return null;
      if (r.mode === 'admin') return null;
      if (r.mode === 'public') return '';
      if (r.mode === 'auth') return '@request.auth.id != ""';
      if (r.editorMode === 'visual') {
        const knownFields = (state.activeCollection?.schema || []).map(f => f.name);
        return buildRuleFromClausesClient(r.clauses, r.join, knownFields);
      }
      return r.raw !== undefined ? r.raw.trim() : '';
    }

    function getRuleValueToSave(ruleKey) {
      const r = state.activeRules[ruleKey];
      if (!r) {
        const input = document.getElementById(`rule-${ruleKey}`);
        if (!input) return null;
        const val = input.value.trim();
        return val === 'null' ? null : val;
      }
      const evalVal = getEvaluatedRule(ruleKey);
      if (evalVal === 'null') return null;
      return evalVal;
    }

    function syncHiddenRuleInput(ruleKey) {
      const input = document.getElementById(`rule-${ruleKey}`);
      if (input) {
        const val = getEvaluatedRule(ruleKey);
        input.value = val === null ? 'null' : val;
      }
    }

    function renderAccessRulesSection(col) {
      const container = document.getElementById('access-rules-container-wrapper');
      if (!container) return;

      container.innerHTML = `
        <div style="border:1px solid var(--border-subtle); border-radius:8px; padding:1.25rem; background:var(--bg-card);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.15rem; flex-wrap:wrap; gap:0.6rem;">
            <div>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <h3 style="font-size:14px; font-weight:700;">API Access Rules</h3>
                <span class="badge badge-post">Visual Builder</span>
              </div>
              <p style="font-size:12px; color:var(--text-muted); margin-top:2px;">
                Define granular access controls using visual dropdowns (Field, Operator, Value) or raw expressions.
              </p>
            </div>
            <div style="display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap;">
              <span style="font-size:11px; color:var(--text-muted); margin-right:4px;">Set All:</span>
              <button type="button" class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 7px;" onclick="setAllRulesPreset('admin')" title="Lock all actions to Admin only">🔒 Admin</button>
              <button type="button" class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 7px;" onclick="setAllRulesPreset('auth')" title="Allow only authenticated users for all actions">👤 Auth</button>
              <button type="button" class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 7px;" onclick="setAllRulesPreset('public')" title="Make all actions public">🌐 Public</button>
            </div>
          </div>

          <div class="rules-container" id="rules-card-list">
            ${RULE_KEYS.map(rk => renderRuleCardHtml(rk.key, rk.title, rk.desc, col)).join('')}
          </div>
        </div>
      `;
    }

    function renderRuleCardHtml(key, title, desc, col) {
      const r = state.activeRules[key];
      if (!r) return '';
      const currentVal = getEvaluatedRule(key);

      let badgeHtml = '';
      if (r.mode === 'admin') badgeHtml = '<span class="badge" style="background:rgba(239,68,68,0.18); color:#fca5a5;">🔒 Admin Only</span>';
      else if (r.mode === 'public') badgeHtml = '<span class="badge" style="background:rgba(16,185,129,0.18); color:#6ee7b7;">🌐 Public</span>';
      else if (r.mode === 'auth') badgeHtml = '<span class="badge" style="background:rgba(59,130,246,0.18); color:#93c5fd;">👤 Auth Users</span>';
      else badgeHtml = '<span class="badge" style="background:rgba(245,158,11,0.18); color:#fbbf24;">⚡ Custom Rule</span>';

      return `
        <div class="rule-card" id="rule-card-${key}">
          <div class="rule-card-header">
            <div class="rule-info">
              <div>
                <span class="rule-title">${title}</span>
                <span class="rule-desc" style="margin-left:6px;">(${desc})</span>
              </div>
              ${badgeHtml}
            </div>

            <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
              <div class="rule-presets">
                <button type="button" class="rule-preset-btn ${r.mode === 'admin' ? 'active-admin' : ''}" onclick="setRulePreset('${key}', 'admin')">🔒 Admin</button>
                <button type="button" class="rule-preset-btn ${r.mode === 'public' ? 'active-public' : ''}" onclick="setRulePreset('${key}', 'public')">🌐 Public</button>
                <button type="button" class="rule-preset-btn ${r.mode === 'auth' ? 'active-auth' : ''}" onclick="setRulePreset('${key}', 'auth')">👤 Auth</button>
                <button type="button" class="rule-preset-btn ${r.mode === 'custom' ? 'active-custom' : ''}" onclick="setRulePreset('${key}', 'custom')">⚙️ Custom</button>
              </div>

              ${r.mode === 'custom' ? `
                <div class="rule-mode-toggle">
                  <button type="button" class="${r.editorMode === 'visual' ? 'active' : ''}" onclick="setRuleEditorMode('${key}', 'visual')">✦ Visual</button>
                  <button type="button" class="${r.editorMode === 'raw' ? 'active' : ''}" onclick="setRuleEditorMode('${key}', 'raw')">⌨ Raw</button>
                </div>
              ` : ''}

              <button type="button" class="btn btn-secondary btn-sm" style="padding:2px 7px; font-size:11px;" onclick="copyRuleToAll('${key}')" title="Copy this rule to all other endpoints">Copy to all</button>
            </div>
          </div>

          ${renderRuleBodyContent(key, r, col)}

          <input type="hidden" id="rule-${key}" value="${currentVal === null ? 'null' : escapeHtml(currentVal)}">
        </div>
      `;
    }

    function renderRuleBodyContent(key, r, col) {
      if (r.mode === 'admin') {
        return `
          <div class="rule-status-banner admin">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            <div><strong>Admin Only:</strong> Blocked for normal API users. Only system administrators can perform this action (<code>rule = null</code>).</div>
          </div>
        `;
      }

      if (r.mode === 'public') {
        return `
          <div class="rule-status-banner public">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            <div><strong>Publicly Accessible:</strong> Anyone, including anonymous unauthenticated visitors, can perform this action (<code>rule = ""</code>).</div>
          </div>
        `;
      }

      if (r.mode === 'auth') {
        return `
          <div class="rule-status-banner auth">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            <div><strong>Authenticated Users Only:</strong> Requires a valid bearer authentication token (<code>@request.auth.id != ""</code>).</div>
          </div>
        `;
      }

      // Custom rule
      const currentVal = getEvaluatedRule(key);
      const isVisual = r.editorMode === 'visual';

      if (isVisual) {
        return `
          <div class="rule-visual-editor">
            ${(r.clauses || []).map((clause, idx) => {
              const fieldData = getFieldOptionsHtml(clause.field, col);
              const datalistId = `val-suggestions-${key}-${idx}`;
              return `
                ${idx > 0 ? `
                  <div class="rule-join-bar">
                    <span>Logic between conditions:</span>
                    <button type="button" class="rule-join-pill" onclick="toggleRuleJoin('${key}')" title="Click to toggle between AND and OR">
                      ${r.join === '||' ? 'OR (||)' : 'AND (&&)'}
                    </button>
                  </div>
                ` : ''}

                <div class="rule-condition-row">
                  <div>
                    <select class="form-select" style="width:100%;" onchange="onRuleFieldSelectChange('${key}', ${idx}, this.value)">
                      ${fieldData.html}
                    </select>
                    ${fieldData.isCustom ? `
                      <input type="text" class="form-input" style="font-family:var(--font-mono); font-size:12px; margin-top:4px;" value="${escapeHtml(clause.field)}" placeholder="e.g. @request.headers.x-role" oninput="onCustomFieldInput('${key}', ${idx}, this.value)">
                    ` : ''}
                  </div>

                  <select class="form-select" onchange="onRuleOperatorChange('${key}', ${idx}, this.value)">
                    <option value="=" ${clause.operator === '=' ? 'selected' : ''}>= (Equals)</option>
                    <option value="!=" ${clause.operator === '!=' ? 'selected' : ''}>!= (Not equal)</option>
                    <option value=">" ${clause.operator === '>' ? 'selected' : ''}>> (Greater than)</option>
                    <option value=">=" ${clause.operator === '>=' ? 'selected' : ''}>>= (Greater or equal)</option>
                    <option value="<" ${clause.operator === '<' ? 'selected' : ''}>< (Less than)</option>
                    <option value="<=" ${clause.operator === '<=' ? 'selected' : ''}><= (Less or equal)</option>
                    <option value="~" ${clause.operator === '~' ? 'selected' : ''}>~ (Contains / Like)</option>
                  </select>

                  <div>
                    <input type="text" class="form-input" style="width:100%; font-family:var(--font-mono); font-size:12.5px;" list="${datalistId}" value="${escapeHtml(clause.value)}" placeholder='e.g. "" or "active" or user' oninput="onRuleValueChange('${key}', ${idx}, this.value)">
                    ${getValueSuggestionsDatalist(datalistId, col)}
                  </div>

                  <button type="button" class="btn btn-secondary btn-sm" style="color:var(--accent-danger); padding:4px 8px;" onclick="removeRuleCondition('${key}', ${idx})" title="Remove condition">✕</button>
                </div>
              `;
            }).join('')}

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.35rem; flex-wrap:wrap; gap:0.5rem;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="addRuleCondition('${key}')">+ Add Condition</button>
              <div class="rule-preview-box" style="margin-top:0;">
                <span>Live Rule:</span>
                <code class="rule-preview-code" id="preview-${key}">${escapeHtml(currentVal || '(empty)')}</code>
              </div>
            </div>
          </div>
        `;
      } else {
        // Raw editor mode
        const schemaFieldNames = (col.schema || []).map(f => f.name);
        return `
          <div class="rule-raw-editor">
            <input type="text" class="rule-raw-input" id="raw-input-${key}" value="${escapeHtml(r.raw || '')}" placeholder="e.g. @request.auth.id != '' && status = 'published'" oninput="onRawRuleInput('${key}', this.value)">

            <div class="rule-chips-bar">
              <span style="font-size:11px; color:var(--text-muted);">Insert tokens:</span>
              <span class="rule-chip" onclick="insertVariableIntoRaw('${key}', '@request.auth.id')">@request.auth.id</span>
              <span class="rule-chip" onclick="insertVariableIntoRaw('${key}', '@request.auth.email')">@request.auth.email</span>
              <span class="rule-chip" onclick="insertVariableIntoRaw('${key}', 'id')">id</span>
              ${schemaFieldNames.map(fn => `<span class="rule-chip" onclick="insertVariableIntoRaw('${key}', '${fn}')">${fn}</span>`).join('')}
              <span class="rule-chip" onclick="insertVariableIntoRaw('${key}', '!= \"\"')">!= ""</span>
              <span class="rule-chip" onclick="insertVariableIntoRaw('${key}', ' && ')">&&</span>
              <span class="rule-chip" onclick="insertVariableIntoRaw('${key}', ' || ')">||</span>
            </div>

            <div class="rule-preview-box">
              <span>Evaluated Rule:</span>
              <code class="rule-preview-code" id="preview-${key}">${escapeHtml(currentVal || '(empty)')}</code>
            </div>
          </div>
        `;
      }
    }

    function getFieldOptionsHtml(currentField, col) {
      const authFields = [
        { val: '@request.auth.id', label: '@request.auth.id (User ID)' },
        { val: '@request.auth.email', label: '@request.auth.email (User Email)' },
        { val: '@request.auth.role', label: '@request.auth.role (User Role)' },
        { val: '@request.auth.isAdmin', label: '@request.auth.isAdmin (Admin Flag)' },
      ];

      const systemFields = [
        { val: 'id', label: 'id (Record ID)' },
        { val: 'created', label: 'created (Created Timestamp)' },
        { val: 'updated', label: 'updated (Updated Timestamp)' },
      ];

      const schemaFields = (col.schema || []).map(f => ({
        val: f.name,
        label: `${f.name} (${f.type})`,
      }));

      const dataFields = (col.schema || []).map(f => ({
        val: `@request.data.${f.name}`,
        label: `@request.data.${f.name} (Submitted payload)`,
      }));

      let isCustom = true;
      const allKnownVals = [
        ...authFields.map(x => x.val),
        ...systemFields.map(x => x.val),
        ...schemaFields.map(x => x.val),
        ...dataFields.map(x => x.val),
      ];
      if (allKnownVals.includes(currentField)) {
        isCustom = false;
      }

      let html = '';
      html += `<optgroup label="Authentication (@request.auth)">`;
      for (const f of authFields) {
        html += `<option value="${f.val}" ${currentField === f.val ? 'selected' : ''}>${f.label}</option>`;
      }
      html += `</optgroup>`;

      html += `<optgroup label="Record Fields">`;
      for (const f of systemFields) {
        html += `<option value="${f.val}" ${currentField === f.val ? 'selected' : ''}>${f.label}</option>`;
      }
      for (const f of schemaFields) {
        html += `<option value="${f.val}" ${currentField === f.val ? 'selected' : ''}>${f.label}</option>`;
      }
      html += `</optgroup>`;

      if (dataFields.length > 0) {
        html += `<optgroup label="Request Data (@request.data)">`;
        for (const f of dataFields) {
          html += `<option value="${f.val}" ${currentField === f.val ? 'selected' : ''}>${f.label}</option>`;
        }
        html += `</optgroup>`;
      }

      html += `<optgroup label="Custom">`;
      html += `<option value="__custom__" ${isCustom ? 'selected' : ''}>Custom field path...</option>`;
      html += `</optgroup>`;

      return { html, isCustom };
    }

    function getValueSuggestionsDatalist(datalistId, col) {
      let opts = `
        <option value='""'>"" (Empty string)</option>
        <option value="true">true (Boolean)</option>
        <option value="false">false (Boolean)</option>
        <option value="null">null</option>
        <option value="@request.auth.id">@request.auth.id (Current user ID)</option>
        <option value="@request.auth.email">@request.auth.email (Current user email)</option>
        <option value="id">id (Record ID)</option>
      `;
      for (const f of (col.schema || [])) {
        opts += `<option value="${f.name}">${f.name} (Field)</option>`;
      }
      opts += `
        <option value='"active"'>"active"</option>
        <option value='"published"'>"published"</option>
        <option value='"draft"'>"draft"</option>
      `;
      return `<datalist id="${datalistId}">${opts}</datalist>`;
    }

    function updateRuleCardDOM(ruleKey) {
      const col = state.activeCollection;
      const card = document.getElementById(`rule-card-${ruleKey}`);
      if (!card) {
        renderAccessRulesSection(col);
        return;
      }
      const rk = RULE_KEYS.find(k => k.key === ruleKey);
      if (!rk) return;

      const temp = document.createElement('div');
      temp.innerHTML = renderRuleCardHtml(rk.key, rk.title, rk.desc, col);
      if (temp.firstElementChild) {
        card.replaceWith(temp.firstElementChild);
      }
      syncHiddenRuleInput(ruleKey);
    }

    function setRulePreset(ruleKey, preset) {
      const r = state.activeRules[ruleKey];
      if (!r) return;

      if (preset === 'admin') {
        r.mode = 'admin';
        r.raw = 'null';
        r.clauses = [];
      } else if (preset === 'public') {
        r.mode = 'public';
        r.raw = '';
        r.clauses = [];
      } else if (preset === 'auth') {
        r.mode = 'auth';
        r.raw = '@request.auth.id != ""';
        r.clauses = [{ field: '@request.auth.id', operator: '!=', value: '""' }];
      } else if (preset === 'custom') {
        r.mode = 'custom';
        if (!r.clauses || r.clauses.length === 0) {
          r.clauses = [{ field: '@request.auth.id', operator: '!=', value: '""' }];
        }
        const knownFields = (state.activeCollection?.schema || []).map(f => f.name);
        r.raw = buildRuleFromClausesClient(r.clauses, r.join, knownFields);
      }

      updateRuleCardDOM(ruleKey);
    }

    function setAllRulesPreset(preset) {
      for (const rk of RULE_KEYS) {
        setRulePreset(rk.key, preset);
      }
      toast(`All access rules set to ${preset.toUpperCase()}`, 'success');
    }

    function setRuleEditorMode(ruleKey, mode) {
      const r = state.activeRules[ruleKey];
      if (!r) return;

      if (mode === 'visual') {
        // Parse from current raw expression
        const parsed = parseClientRuleExpression(r.raw || '');
        if (parsed.clauses.length > 0) {
          r.clauses = parsed.clauses;
          r.join = parsed.join;
        } else if (!r.clauses || r.clauses.length === 0) {
          r.clauses = [{ field: '@request.auth.id', operator: '!=', value: '""' }];
        }
      } else {
        // Ensure raw is synced
        r.raw = getEvaluatedRule(ruleKey) || '';
      }

      r.editorMode = mode;
      updateRuleCardDOM(ruleKey);
    }

    function addRuleCondition(ruleKey) {
      const r = state.activeRules[ruleKey];
      if (!r) return;
      if (!r.clauses) r.clauses = [];

      const col = state.activeCollection;
      const firstField = (col?.schema && col.schema.length > 0) ? col.schema[0].name : 'id';

      r.clauses.push({
        field: '@request.auth.id',
        operator: '=',
        value: firstField,
      });

      const knownFields = (col?.schema || []).map(f => f.name);
      r.raw = buildRuleFromClausesClient(r.clauses, r.join, knownFields);
      updateRuleCardDOM(ruleKey);
    }

    function removeRuleCondition(ruleKey, index) {
      const r = state.activeRules[ruleKey];
      if (!r || !r.clauses) return;

      r.clauses.splice(index, 1);
      if (r.clauses.length === 0) {
        r.clauses = [{ field: '@request.auth.id', operator: '!=', value: '""' }];
      }

      const knownFields = (state.activeCollection?.schema || []).map(f => f.name);
      r.raw = buildRuleFromClausesClient(r.clauses, r.join, knownFields);
      updateRuleCardDOM(ruleKey);
    }

    function onRuleFieldSelectChange(ruleKey, index, val) {
      const r = state.activeRules[ruleKey];
      if (!r || !r.clauses || !r.clauses[index]) return;

      if (val === '__custom__') {
        r.clauses[index].field = '';
      } else {
        r.clauses[index].field = val;
      }

      const knownFields = (state.activeCollection?.schema || []).map(f => f.name);
      r.raw = buildRuleFromClausesClient(r.clauses, r.join, knownFields);
      updateRuleCardDOM(ruleKey);
    }

    function onCustomFieldInput(ruleKey, index, val) {
      const r = state.activeRules[ruleKey];
      if (!r || !r.clauses || !r.clauses[index]) return;

      r.clauses[index].field = val;
      const knownFields = (state.activeCollection?.schema || []).map(f => f.name);
      r.raw = buildRuleFromClausesClient(r.clauses, r.join, knownFields);

      const previewEl = document.getElementById(`preview-${ruleKey}`);
      if (previewEl) previewEl.textContent = getEvaluatedRule(ruleKey) || '(empty)';
      syncHiddenRuleInput(ruleKey);
    }

    function onRuleOperatorChange(ruleKey, index, val) {
      const r = state.activeRules[ruleKey];
      if (!r || !r.clauses || !r.clauses[index]) return;

      r.clauses[index].operator = val;
      const knownFields = (state.activeCollection?.schema || []).map(f => f.name);
      r.raw = buildRuleFromClausesClient(r.clauses, r.join, knownFields);

      const previewEl = document.getElementById(`preview-${ruleKey}`);
      if (previewEl) previewEl.textContent = getEvaluatedRule(ruleKey) || '(empty)';
      syncHiddenRuleInput(ruleKey);
    }

    function onRuleValueChange(ruleKey, index, val) {
      const r = state.activeRules[ruleKey];
      if (!r || !r.clauses || !r.clauses[index]) return;

      r.clauses[index].value = val;
      const knownFields = (state.activeCollection?.schema || []).map(f => f.name);
      r.raw = buildRuleFromClausesClient(r.clauses, r.join, knownFields);

      const previewEl = document.getElementById(`preview-${ruleKey}`);
      if (previewEl) previewEl.textContent = getEvaluatedRule(ruleKey) || '(empty)';
      syncHiddenRuleInput(ruleKey);
    }

    function toggleRuleJoin(ruleKey) {
      const r = state.activeRules[ruleKey];
      if (!r) return;

      r.join = r.join === '||' ? '&&' : '||';
      const knownFields = (state.activeCollection?.schema || []).map(f => f.name);
      r.raw = buildRuleFromClausesClient(r.clauses, r.join, knownFields);
      updateRuleCardDOM(ruleKey);
    }

    function onRawRuleInput(ruleKey, val) {
      const r = state.activeRules[ruleKey];
      if (!r) return;

      r.raw = val;
      const previewEl = document.getElementById(`preview-${ruleKey}`);
      if (previewEl) previewEl.textContent = val.trim() || '(empty)';
      syncHiddenRuleInput(ruleKey);
    }

    function insertVariableIntoRaw(ruleKey, varName) {
      const r = state.activeRules[ruleKey];
      if (!r) return;

      const input = document.getElementById(`raw-input-${ruleKey}`);
      if (input) {
        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        const current = input.value;
        const next = current.substring(0, start) + varName + current.substring(end);
        input.value = next;
        input.focus();
        input.selectionStart = input.selectionEnd = start + varName.length;
        onRawRuleInput(ruleKey, next);
      } else {
        const current = (r.raw || '');
        const next = current ? `${current} ${varName}` : varName;
        onRawRuleInput(ruleKey, next);
        updateRuleCardDOM(ruleKey);
      }
    }

    function copyRuleToAll(sourceKey) {
      const src = state.activeRules[sourceKey];
      if (!src) return;

      for (const rk of RULE_KEYS) {
        if (rk.key !== sourceKey) {
          state.activeRules[rk.key] = {
            mode: src.mode,
            editorMode: src.editorMode,
            join: src.join,
            clauses: JSON.parse(JSON.stringify(src.clauses || [])),
            raw: src.raw,
          };
        }
      }

      renderAccessRulesSection(state.activeCollection);
      toast(`Rule copied from ${sourceKey.toUpperCase()} to all CRUD actions!`, 'success');
    }
