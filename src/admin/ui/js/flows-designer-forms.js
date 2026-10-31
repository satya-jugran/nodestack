// Functions Flow Designer - Step Cards & Form Fields
// Generates step cards and form controls for Task, Choice, Map, Loop, Parallel, Pass, Wait, Fail, Succeed

function getStepName(el) {
  return el ? (el.getAttribute('data-step-name') || el.closest('[data-step-name]')?.getAttribute('data-step-name') || '') : '';
}

function renderStepCardHtml(name, state, index, allKeys) {
  const type = state.type || 'Pass';
  const pillClass = `pill-${type.toLowerCase()}`;
  const isSelected = designerState.selectedStepName === name;
  const executionStep = designerState.latestExecution?.stepLogs?.find(l => l.step === name);
  const statusClass = executionStep ? `step-status-${executionStep.status}` : '';

  return `
    <div
      class="flow-step-card ${isSelected ? 'active-step' : ''} ${statusClass}"
      id="step-card-${escapeHtml(name)}"
      data-step-name="${escapeHtml(name)}"
      onclick="selectStepCard(getStepName(this))"
    >
      <!-- Header -->
      <div class="flow-step-card-header">
        <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1;">
          <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 800; min-width: 22px;">#${index + 1}</span>
          <input
            type="text"
            class="flow-field-input"
            value="${escapeHtml(name)}"
            style="font-weight: 700; font-size: 0.9rem; padding: 3px 8px; width: 160px;"
            onchange="renameStep(getStepName(this), this.value)"
          />
          <span class="flow-step-type-pill ${pillClass}">${type}</span>
        </div>

        <div style="display: flex; align-items: center; gap: 4px;">
          <!-- Move Up / Down Buttons -->
          <button
            class="flow-step-reorder-btn"
            title="Move Step Up"
            onclick="moveStepUp(getStepName(this), event)"
            ${index === 0 ? 'disabled' : ''}
          >
            ▲
          </button>
          <button
            class="flow-step-reorder-btn"
            title="Move Step Down"
            onclick="moveStepDown(getStepName(this), event)"
            ${index === allKeys.length - 1 ? 'disabled' : ''}
          >
            ▼
          </button>

          ${executionStep ? `
            <span style="font-size: 0.72rem; font-weight: 700; color: ${executionStep.status === 'succeeded' ? 'var(--accent-success)' : 'var(--accent-danger)'}; padding: 0 4px;">
              ${executionStep.durationMs}ms
            </span>
          ` : ''}

          <button
            class="btn btn-secondary btn-sm"
            style="padding: 2px 7px; font-size: 0.75rem; color: var(--text-muted);"
            onclick="deleteStep(getStepName(this), event)"
            title="Delete Step"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Specific Form Fields based on Type -->
      ${renderStateFormFields(name, state, allKeys)}

      <!-- Transition Target (Next / End) -->
      ${type !== 'Choice' && type !== 'Succeed' && type !== 'Fail' ? `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; border-top: 1px solid var(--border-subtle); padding-top: 0.65rem; margin-top: 0.25rem; font-size: 0.8rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1;">
            <span style="color: var(--text-muted); font-weight: 600;">➔ Then Go To:</span>
            <select
              id="step-next-select-${escapeHtml(name)}"
              class="flow-field-select flow-next-select"
              style="flex: 1;"
              ${state.end ? 'disabled' : ''}
              onchange="handleStepNextChange(getStepName(this), this.value)"
            >
              <option value="">-- Choose Next Step --</option>
              ${allKeys.filter(k => k !== name).map(k => `<option value="${escapeHtml(k)}" ${state.next === k ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('')}
            </select>
          </div>
          <label style="display: flex; align-items: center; gap: 6px; color: var(--text-muted); cursor: pointer; font-weight: 600;">
            <input
              id="step-end-check-${escapeHtml(name)}"
              type="checkbox"
              ${state.end ? 'checked' : ''}
              onchange="handleStepEndToggle(getStepName(this), this.checked)"
            />
            End State
          </label>
        </div>
      ` : ''}
    </div>
  `;
}

function renderStateFormFields(name, state, allKeys) {
  const type = state.type || 'Pass';

  switch (type) {
    case 'Task':
      const fns = flowsState.functions || [];
      return `
        <div class="flow-field-row">
          <label class="flow-field-label">Invoke Serverless Function:</label>
          <select
            class="flow-field-select"
            onchange="updateStepProp(getStepName(this), 'function', this.value)"
          >
            <option value="">-- Select Registered Function --</option>
            ${fns.map(f => `<option value="${escapeHtml(f.name)}" ${state.function === f.name ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
          </select>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div class="flow-field-row">
            <label class="flow-field-label">Input Path (Payload subset):</label>
            <input
              type="text"
              class="flow-field-input"
              placeholder="$ (entire payload)"
              value="${escapeHtml(state.inputPath || '$')}"
              onchange="updateStepProp(getStepName(this), 'inputPath', this.value)"
            />
          </div>
          <div class="flow-field-row">
            <label class="flow-field-label">Result Path (Write to):</label>
            <input
              type="text"
              class="flow-field-input"
              placeholder="$.result"
              value="${escapeHtml(state.resultPath || '$')}"
              onchange="updateStepProp(getStepName(this), 'resultPath', this.value)"
            />
          </div>
        </div>
      `;

    case 'Choice':
      const choices = state.choices || [];
      return `
        <div class="flow-field-row">
          <label class="flow-field-label">Choice Branches (If-Else Conditions):</label>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            ${choices.map((c, i) => `
              <div class="flow-choice-rule-card">
                <input
                  type="text"
                  class="flow-field-input"
                  style="flex: 2; padding: 0.35rem 0.5rem;"
                  placeholder="$.variable"
                  value="${escapeHtml(c.variable || '')}"
                  onchange="updateChoiceBranch(getStepName(this), ${i}, 'variable', this.value)"
                />
                <select
                  class="flow-field-select"
                  style="flex: 1.6; padding: 0.35rem 0.5rem;"
                  onchange="updateChoiceBranchOp(getStepName(this), ${i}, this.value)"
                >
                  <option value="stringEquals" ${c.stringEquals !== undefined ? 'selected' : ''}>== string</option>
                  <option value="numericEquals" ${c.numericEquals !== undefined ? 'selected' : ''}>== number</option>
                  <option value="numericGreaterThan" ${c.numericGreaterThan !== undefined ? 'selected' : ''}>&gt; number</option>
                  <option value="numericLessThan" ${c.numericLessThan !== undefined ? 'selected' : ''}>&lt; number</option>
                  <option value="numericGreaterThanEquals" ${c.numericGreaterThanEquals !== undefined ? 'selected' : ''}>&gt;= number</option>
                  <option value="numericLessThanEquals" ${c.numericLessThanEquals !== undefined ? 'selected' : ''}>&lt;= number</option>
                  <option value="booleanEquals" ${c.booleanEquals !== undefined ? 'selected' : ''}>== boolean</option>
                  <option value="isPresent" ${c.isPresent !== undefined ? 'selected' : ''}>is defined</option>
                </select>
                ${renderChoiceValueInput(name, i, c)}
                <span style="color: var(--text-muted); font-weight: 700;">➔</span>
                <select
                  class="flow-field-select"
                  style="flex: 2; padding: 0.35rem 0.5rem;"
                  onchange="updateChoiceBranch(getStepName(this), ${i}, 'next', this.value)"
                >
                  <option value="">Next...</option>
                  ${allKeys.filter(k => k !== name).map(k => `<option value="${escapeHtml(k)}" ${c.next === k ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('')}
                </select>
                <button class="btn btn-secondary btn-sm" style="padding: 2px 6px;" onclick="removeChoiceBranch(getStepName(this), ${i})">✕</button>
              </div>
            `).join('')}
            <button class="btn btn-secondary btn-sm" style="font-size: 0.75rem; align-self: flex-start; font-weight: 600;" onclick="addChoiceBranch(getStepName(this))">
              + Add Condition
            </button>
          </div>
        </div>
        <div class="flow-field-row" style="margin-top: 0.35rem;">
          <label class="flow-field-label">Default Fallback Step:</label>
          <select
            class="flow-field-select"
            onchange="updateStepProp(getStepName(this), 'default', this.value)"
          >
            <option value="">-- No Default (Fail if no match) --</option>
            ${allKeys.filter(k => k !== name).map(k => `<option value="${escapeHtml(k)}" ${state.default === k ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('')}
          </select>
        </div>
      `;

    case 'Map':
      const mapFns = flowsState.functions || [];
      const iteratorStart = state.iterator?.startAt || 'ProcessItem';
      const iteratorState = state.iterator?.states?.[iteratorStart] || {};
      return `
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 0.75rem;">
          <div class="flow-field-row">
            <label class="flow-field-label">Array Path (Items):</label>
            <input
              type="text"
              class="flow-field-input"
              placeholder="$.items"
              value="${escapeHtml(state.itemsPath || '$.items')}"
              onchange="updateStepProp(getStepName(this), 'itemsPath', this.value)"
            />
          </div>
          <div class="flow-field-row">
            <label class="flow-field-label">Concurrency:</label>
            <input
              type="number"
              class="flow-field-input"
              value="${state.maxConcurrency || 5}"
              min="1"
              max="20"
              onchange="updateStepProp(getStepName(this), 'maxConcurrency', parseInt(this.value, 10))"
            />
          </div>
        </div>
        <div class="flow-field-row">
          <label class="flow-field-label">Item Processing Function:</label>
          <select
            class="flow-field-select"
            onchange="updateMapIteratorFunction(getStepName(this), this.value)"
          >
            <option value="">-- Select Function --</option>
            ${mapFns.map(f => `<option value="${escapeHtml(f.name)}" ${iteratorState.function === f.name ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
          </select>
        </div>
        <div class="flow-field-row">
          <label class="flow-field-label">Result Path (Write array to):</label>
          <input
            type="text"
            class="flow-field-input"
            placeholder="$.mappedResults"
            value="${escapeHtml(state.resultPath || '$')}"
            onchange="updateStepProp(getStepName(this), 'resultPath', this.value)"
          />
        </div>
      `;

    case 'Loop':
      return `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div class="flow-field-row">
            <label class="flow-field-label">Loop Target Step:</label>
            <select
              class="flow-field-select"
              onchange="updateStepProp(getStepName(this), 'target', this.value)"
            >
              <option value="">-- Jump To --</option>
              ${allKeys.filter(k => k !== name).map(k => `<option value="${escapeHtml(k)}" ${state.target === k ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('')}
            </select>
          </div>
          <div class="flow-field-row">
            <label class="flow-field-label">Max Iterations Cap:</label>
            <input
              type="number"
              class="flow-field-input"
              value="${state.maxIterations || 100}"
              onchange="updateStepProp(getStepName(this), 'maxIterations', parseInt(this.value, 10))"
            />
          </div>
        </div>
        <div class="flow-field-row">
          <label class="flow-field-label">Repeat While Condition:</label>
          <div style="display: flex; gap: 6px;">
            <input
              type="text"
              class="flow-field-input"
              placeholder="$.counter"
              value="${escapeHtml(state.condition?.variable || '')}"
              onchange="updateLoopCondition(getStepName(this), 'variable', this.value)"
            />
            <input
              type="number"
              class="flow-field-input"
              style="width: 100px;"
              placeholder="< 10"
              value="${state.condition?.numericLessThan ?? ''}"
              onchange="updateLoopCondition(getStepName(this), 'numericLessThan', parseFloat(this.value))"
            />
          </div>
        </div>
      `;

    case 'Parallel':
      const parallelFns = flowsState.functions || [];
      const branches = Array.isArray(state.branches) ? state.branches : [];
      return `
        <div class="flow-field-row">
          <label class="flow-field-label">Result Path (Write aggregated array of results to):</label>
          <input
            type="text"
            class="flow-field-input"
            placeholder="$.parallelResults"
            value="${escapeHtml(state.resultPath || '$.parallelResults')}"
            onchange="updateStepProp(getStepName(this), 'resultPath', this.value)"
          />
        </div>

        <div class="flow-field-row" style="margin-top: 0.35rem;">
          <label class="flow-field-label">Parallel Branches (Run Concurrently):</label>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            ${branches.map((b, bIdx) => {
              const startKey = b.startAt || Object.keys(b.states || {})[0] || `Branch${bIdx + 1}_Task`;
              const branchTask = b.states?.[startKey] || {};
              const branchFn = branchTask.function || '';
              return `
                <div class="flow-choice-rule-card" style="align-items: center; gap: 0.65rem;">
                  <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); min-width: 65px;">
                    Branch #${bIdx + 1}:
                  </span>
                  <select
                    class="flow-field-select"
                    style="flex: 1; padding: 0.35rem 0.5rem;"
                    onchange="updateParallelBranchFunction(getStepName(this), ${bIdx}, this.value)"
                  >
                    <option value="">-- Choose Function --</option>
                    ${parallelFns.map(f => `<option value="${escapeHtml(f.name)}" ${branchFn === f.name ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
                  </select>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    style="padding: 2px 7px; font-size: 0.75rem; color: var(--text-muted);"
                    onclick="removeParallelBranch(getStepName(this), ${bIdx})"
                    title="Delete Branch"
                    ${branches.length <= 1 ? 'disabled' : ''}
                  >
                    ✕
                  </button>
                </div>
              `;
            }).join('')}
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              style="font-size: 0.75rem; align-self: flex-start; font-weight: 600; margin-top: 2px;"
              onclick="addParallelBranch(getStepName(this))"
            >
              + Add Parallel Branch
            </button>
          </div>
        </div>
      `;

    case 'Pass':
      const jsonRes = state.result !== undefined ? JSON.stringify(state.result) : '{}';
      return `
        <div class="flow-field-row">
          <label class="flow-field-label">Inject Static Result JSON:</label>
          <input
            type="text"
            class="flow-field-input"
            value="${escapeHtml(jsonRes)}"
            onchange="updatePassResult(getStepName(this), this.value)"
          />
        </div>
        <div class="flow-field-row">
          <label class="flow-field-label">Result Path (Write to):</label>
          <input
            type="text"
            class="flow-field-input"
            placeholder="$.data"
            value="${escapeHtml(state.resultPath || '$')}"
            onchange="updateStepProp(getStepName(this), 'resultPath', this.value)"
          />
        </div>
      `;

    case 'Wait':
      return `
        <div class="flow-field-row">
          <label class="flow-field-label">Delay (Seconds):</label>
          <input
            type="number"
            class="flow-field-input"
            min="1"
            max="60"
            value="${state.seconds || 1}"
            onchange="updateStepProp(getStepName(this), 'seconds', parseInt(this.value, 10))"
          />
        </div>
      `;

    case 'Fail':
      return `
        <div class="flow-field-row">
          <label class="flow-field-label">Error Reason / Cause:</label>
          <input
            type="text"
            class="flow-field-input"
            placeholder="OrderValidationFailed"
            value="${escapeHtml(state.error || state.cause || '')}"
            onchange="updateStepProp(getStepName(this), 'error', this.value)"
          />
        </div>
      `;

    default:
      return '';
  }
}

function renderChoiceValueInput(stepName, index, rule) {
  if (rule.booleanEquals !== undefined) {
    return `
      <select
        class="flow-field-select"
        style="flex: 1.4; padding: 0.35rem 0.5rem;"
        onchange="updateChoiceBranchVal(getStepName(this), ${index}, this.value)"
      >
        <option value="true" ${rule.booleanEquals === true ? 'selected' : ''}>true</option>
        <option value="false" ${rule.booleanEquals === false ? 'selected' : ''}>false</option>
      </select>
    `;
  }

  if (rule.isPresent !== undefined) {
    return `
      <select
        class="flow-field-select"
        style="flex: 1.4; padding: 0.35rem 0.5rem;"
        onchange="updateChoiceBranchVal(getStepName(this), ${index}, this.value)"
      >
        <option value="true" ${rule.isPresent !== false ? 'selected' : ''}>is defined</option>
        <option value="false" ${rule.isPresent === false ? 'selected' : ''}>null/undefined</option>
      </select>
    `;
  }

  const isNumeric = rule.numericGreaterThan !== undefined ||
                    rule.numericLessThan !== undefined ||
                    rule.numericEquals !== undefined ||
                    rule.numericGreaterThanEquals !== undefined ||
                    rule.numericLessThanEquals !== undefined;

  if (isNumeric) {
    const numVal = rule.numericGreaterThan ??
                   rule.numericLessThan ??
                   rule.numericEquals ??
                   rule.numericGreaterThanEquals ??
                   rule.numericLessThanEquals ?? 0;
    return `
      <input
        type="number"
        step="any"
        class="flow-field-input"
        style="flex: 1.4; padding: 0.35rem 0.5rem;"
        placeholder="0"
        value="${escapeHtml(String(numVal))}"
        onchange="updateChoiceBranchVal(getStepName(this), ${index}, this.value)"
      />
    `;
  }

  // String value
  return `
    <input
      type="text"
      class="flow-field-input"
      style="flex: 1.4; padding: 0.35rem 0.5rem;"
      placeholder="string value"
      value="${escapeHtml(rule.stringEquals || '')}"
      onchange="updateChoiceBranchVal(getStepName(this), ${index}, this.value)"
    />
  `;
}


if (typeof window !== "undefined") {
  window.getStepName = getStepName;
  window.renderStepCardHtml = renderStepCardHtml;
  window.renderStateFormFields = renderStateFormFields;
  window.renderChoiceValueInput = renderChoiceValueInput;
}
