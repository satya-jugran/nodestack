// Functions Flow Visual Designer & Workbench Module for NodeStack Admin UI
// Provides Visual Step Card Builder, Live Auto-Layout SVG Diagram, and Interactive Test Runner

let designerState = {
  activeFlow: null,
  activeMode: 'visual', // 'visual' | 'code'
  cmDslEditor: null,
  selectedStepName: null,
  isTestDrawerOpen: false,
  testPayload: '{\n  "order": {\n    "amount": 250,\n    "discount": 25\n  }\n}',
  latestExecution: null,
  addStepSelectedType: 'Task',
};

if (typeof window !== 'undefined') {
  window.designerState = designerState;
}

// ==========================================
// 1. Navigation & Workbench Shell
// ==========================================

async function openFlowDesigner(flowId, openTestDrawer = false, pushState = true) {
  try {
    const flow = await api(`/api/flows/${encodeURIComponent(flowId)}`);
    flowsState.currentView = 'designer';
    flowsState.activeFlowForEdit = flow;
    designerState.activeFlow = JSON.parse(JSON.stringify(flow));
    designerState.latestExecution = null;
    designerState.isTestDrawerOpen = !!openTestDrawer;

    if (pushState && typeof updateUrl === 'function') {
      const flowIdentifier = flow.name ? encodeURIComponent(flow.name) : encodeURIComponent(flow.id);
      updateUrl('/_/flows/' + flowIdentifier);
    }

    if (typeof updateBreadcrumbs === 'function') {
      updateBreadcrumbs();
    }

    if (flowsState.functions.length === 0 && typeof loadFunctionsForPicker === 'function') {
      await loadFunctionsForPicker();
    }

    renderFlowDesignerWorkbench(designerState.activeFlow);
  } catch (err) {
    toast('Failed to load flow: ' + (err.message || err), 'error');
  }
}

function closeFlowDesigner(pushState = true) {
  flowsState.currentView = 'list';
  flowsState.activeFlowForEdit = null;
  designerState.activeFlow = null;
  designerState.isTestDrawerOpen = false;

  if (pushState && typeof updateUrl === 'function') {
    const sub = (typeof flowsState !== 'undefined' && flowsState.subTab === 'executions') ? '/executions' : '';
    updateUrl('/_/flows' + sub);
  }

  if (typeof updateBreadcrumbs === 'function') {
    updateBreadcrumbs();
  }

  if (typeof renderFlowsView === 'function') {
    renderFlowsView();
  }
}

function renderTriggerConfigHtml(flow) {
  const triggerType = flow.triggerType || 'http';

  if (triggerType === 'event') {
    return `
      <input
        type="text"
        id="flow-edit-event-trigger"
        class="flow-field-input"
        placeholder="collection:action (e.g. orders:create)"
        value="${escapeHtml(flow.eventTrigger || '')}"
        style="width: 190px; padding: 0.25rem 0.5rem; font-size: 0.8rem; font-family: var(--font-mono, monospace);"
        title="Triggered automatically on database record event (e.g. orders:create, users:update, *:delete)"
        onchange="updateFlowMeta('eventTrigger', this.value)"
      />
      <span style="font-size: 0.72rem; color: var(--text-muted); cursor: help;" title="Format: &lt;collection&gt;:&lt;action&gt;&#10;Examples:&#10;• orders:create - Run when order is created&#10;• users:update - Run when user is updated&#10;• *:delete - Run when any record is deleted">ℹ️</span>
    `;
  }

  if (triggerType === 'http') {
    const endpointPath = `/api/flows/${flow.id}/execute`;
    return `
      <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.75rem; color: var(--text-muted);">
        Endpoint:
        <code
          style="font-size: 0.72rem; color: var(--accent-primary); background: var(--bg-main, #0f172a); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-subtle); cursor: pointer;"
          title="Click to copy endpoint: POST ${endpointPath}"
          onclick="navigator.clipboard?.writeText('POST ${endpointPath}'); toast('Copied endpoint: POST ${endpointPath}', 'success')"
        >
          POST ${endpointPath} 📋
        </code>
      </span>
    `;
  }

  // Manual
  return `
    <span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">
      Triggered on-demand via Run / Test Flow
    </span>
  `;
}

function handleFlowTriggerTypeChange(newType) {
  if (!designerState.activeFlow) return;
  designerState.activeFlow.triggerType = newType;
  if (newType === 'event') {
    if (!designerState.activeFlow.eventTrigger) {
      designerState.activeFlow.eventTrigger = 'orders:create';
    }
  } else {
    designerState.activeFlow.eventTrigger = null;
  }

  const configArea = document.getElementById('flow-trigger-config-area');
  if (configArea) {
    configArea.innerHTML = renderTriggerConfigHtml(designerState.activeFlow);
  }
}

function renderFlowDesignerWorkbench(flow) {
  const container = document.getElementById('page-view-flows') || document.getElementById('main-body');
  if (!container || !flow) return;

  container.innerHTML = `
    <div class="flows-container">
      <!-- Toolbar -->
      <div class="flows-designer-toolbar">
        <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm" onclick="closeFlowDesigner()">
            ← Back to Flows
          </button>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <input
              type="text"
              id="flow-edit-name"
              class="flow-field-input"
              value="${escapeHtml(flow.name)}"
              style="font-weight: 700; font-size: 1rem; width: 210px;"
              onchange="updateFlowMeta('name', this.value)"
            />
            <div style="display: flex; align-items: center; gap: 0.4rem; background: var(--bg-card); padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border-subtle);">
              <span style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em;">Trigger:</span>
              <select
                id="flow-edit-trigger-type"
                class="flow-field-select"
                style="width: 110px; padding: 0.25rem 0.5rem; font-size: 0.8rem; font-weight: 600;"
                onchange="handleFlowTriggerTypeChange(this.value)"
              >
                <option value="http" ${flow.triggerType === 'http' ? 'selected' : ''}>HTTP API</option>
                <option value="event" ${flow.triggerType === 'event' ? 'selected' : ''}>DB Event</option>
                <option value="manual" ${flow.triggerType === 'manual' ? 'selected' : ''}>Manual</option>
              </select>
              <div id="flow-trigger-config-area" style="display: flex; align-items: center; gap: 6px;">
                ${renderTriggerConfigHtml(flow)}
              </div>
            </div>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <div style="display: flex; background: var(--bg-hover-subtle); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 2px;">
            <button
              class="btn btn-sm ${designerState.activeMode === 'visual' ? 'btn-primary' : 'btn-secondary'}"
              style="border:none; padding: 4px 12px; font-weight: 600;"
              onclick="switchDesignerMode('visual')"
            >
              Visual
            </button>
            <button
              class="btn btn-sm ${designerState.activeMode === 'code' ? 'btn-primary' : 'btn-secondary'}"
              style="border:none; padding: 4px 12px; font-weight: 600;"
              onclick="switchDesignerMode('code')"
            >
              Code DSL
            </button>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="toggleTestDrawer()" title="Test Run Flow" style="font-weight: 600;">
            ▶ Test Flow
          </button>
          <button class="btn btn-primary btn-sm" onclick="saveFlowChanges()" style="font-weight: 600;">
            Save Flow
          </button>
        </div>
      </div>

      <!-- Main Designer Workspace -->
      ${designerState.activeMode === 'visual' ? renderVisualWorkspaceHtml(flow) : renderCodeDslWorkspaceHtml(flow)}

      <!-- Slide-over Test Runner Drawer -->
      <div id="flow-test-drawer" class="flow-test-drawer ${designerState.isTestDrawerOpen ? 'open' : ''}">
        ${renderTestDrawerHtml(flow)}
      </div>
    </div>
  `;

  if (designerState.activeMode === 'visual') {
    renderSvgFlowchart(flow);
  } else {
    initDslCodeMirror(flow);
  }
}

// ==========================================
// 2. Visual Builder & Step Cards Pane
// ==========================================

function renderVisualWorkspaceHtml(flow) {
  const states = flow.definition?.states || {};
  const stateKeys = Object.keys(states);
  const startAt = flow.definition?.startAt || stateKeys[0] || '';

  return `
    <div class="flows-split-pane">
      <!-- Left: Step Sequence Editor -->
      <div class="flows-steps-pane">
        <div class="flows-steps-header">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">START AT:</span>
            <select
              class="flow-field-select"
              style="width: 160px; font-weight: 600; padding: 0.35rem 0.6rem;"
              onchange="updateFlowStartAt(this.value)"
            >
              ${stateKeys.map(k => `<option value="${escapeHtml(k)}" ${k === startAt ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary btn-sm" onclick="openAddStepModal()" style="font-weight: 600; font-size: 0.8rem; padding: 0.35rem 0.85rem;">
            + Add Step
          </button>
        </div>

        <div class="flows-steps-list" id="flows-steps-list">
          ${stateKeys.length === 0 ? `
            <div style="text-align: center; padding: 3rem 1.5rem; color: var(--text-muted);">
              <p style="margin: 0 0 1rem 0;">No steps defined in this flow.</p>
              <button class="btn btn-primary btn-sm" onclick="openAddStepModal()">+ Add First Step</button>
            </div>
          ` : stateKeys.map((stepName, idx) => renderStepCardHtml(stepName, states[stepName], idx, stateKeys)).join('')}
        </div>
      </div>

      <!-- Right: Live Auto-Layout SVG Diagram -->
      <div class="flows-diagram-pane">
        <div class="flows-diagram-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">LIVE FLOW DIAGRAM</span>
            <span style="font-size: 0.7rem; color: var(--text-subtle); font-weight: 500;">(Click a node to select)</span>
          </div>
        </div>
        <div id="flow-diagram-container" class="flows-diagram-canvas-wrap"></div>
      </div>
    </div>
  `;
}

// ==========================================
// 6. Code DSL View (CodeMirror)
// ==========================================

function renderCodeDslWorkspaceHtml(flow) {
  return `
    <div style="background: var(--bg-card); border: 1px solid var(--border-default); border-radius: 10px; height: 100%; min-height: 0; flex: 1; display: flex; flex-direction: column;">
      <div style="padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">
          JSON Definition (Amazon States Language / Flow DSL)
        </span>
        <button class="btn btn-secondary btn-sm" onclick="syncDslToVisual()" style="font-weight: 600;">
          Apply Changes to Visual
        </button>
      </div>
      <div id="flow-dsl-editor-container" style="flex: 1; overflow: hidden;"></div>
    </div>
  `;
}

function initDslCodeMirror(flow) {
  const el = document.getElementById('flow-dsl-editor-container');
  if (!el || typeof CodeMirror === 'undefined') return;

  el.innerHTML = '';
  designerState.cmDslEditor = CodeMirror(el, {
    value: JSON.stringify(flow.definition || {}, null, 2),
    mode: 'application/json',
    theme: 'dracula',
    lineNumbers: true,
    tabSize: 2,
  });
}

function syncDslToVisual() {
  if (!designerState.cmDslEditor) return;
  try {
    const parsed = JSON.parse(designerState.cmDslEditor.getValue());
    const validationError = validateFlowDefinitionClient(parsed);
    if (validationError) {
      toast('DSL Validation Error: ' + validationError, 'error');
      return;
    }
    designerState.activeFlow.definition = parsed;
    switchDesignerMode('visual');
  } catch (err) {
    toast('Invalid JSON in definition: ' + err.message, 'error');
  }
}

// ==========================================
// 7. Test Runner Drawer & Execution Visualizer
// ==========================================

function renderTestDrawerHtml(flow) {
  const exec = designerState.latestExecution;

  return `
    <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; background: var(--bg-card-hover, rgba(0,0,0,0.05));">
      <h3 style="margin: 0; font-size: 1rem; color: var(--text-main); font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
        ▶ Test Flow Execution
      </h3>
      <button class="btn btn-secondary btn-sm" style="padding: 2px 8px;" onclick="toggleTestDrawer()">✕</button>
    </div>

    <div style="padding: 1.25rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1.15rem; flex: 1;">
      <div class="flow-field-row">
        <label class="flow-field-label">Initial Input Payload (JSON):</label>
        <textarea
          id="flow-test-input"
          class="flow-field-input"
          style="height: 130px; font-family: var(--font-mono, monospace); font-size: 0.8rem; resize: vertical;"
        >${escapeHtml(designerState.testPayload)}</textarea>
      </div>

      <button class="btn btn-primary" onclick="runFlowTest()" style="font-weight: 700; padding: 0.65rem 1rem;">
        ⚡ Execute Flow Now
      </button>

      ${exec ? `
        <div style="border-top: 1px solid var(--border-subtle); padding-top: 1rem; display: flex; flex-direction: column; gap: 0.85rem;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="font-weight: 800; color: ${exec.status === 'succeeded' ? 'var(--accent-success)' : 'var(--accent-danger)'}; font-size: 0.85rem; text-transform: uppercase;">
              ● ${exec.status} (${exec.durationMs}ms)
            </span>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${new Date(exec.startedAt).toLocaleTimeString()}</span>
          </div>

          <!-- Step Timeline -->
          <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted);">STEP TIMELINE:</div>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            ${(exec.stepLogs || []).map(log => `
              <div class="flow-timeline-item status-${log.status}">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <strong style="color: var(--text-main); font-size: 0.85rem;">${escapeHtml(log.step)}</strong>
                  <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">${log.durationMs}ms</span>
                </div>
                ${log.error ? `<div style="color: var(--accent-danger); font-size: 0.75rem; margin-top: 2px;">${escapeHtml(log.error)}</div>` : ''}
              </div>
            `).join('')}
          </div>

          <!-- Output Payload -->
          <div class="flow-field-row">
            <label class="flow-field-label">Final Output Payload:</label>
            <pre style="background: var(--bg-input); border: 1px solid var(--border-default); border-radius: 6px; padding: 0.75rem; font-size: 0.78rem; overflow-x: auto; max-height: 200px; margin: 0; color: var(--text-main); font-family: var(--font-mono, monospace);">${escapeHtml(JSON.stringify(exec.output, null, 2))}</pre>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function toggleTestDrawer() {
  designerState.isTestDrawerOpen = !designerState.isTestDrawerOpen;
  const drawer = document.getElementById('flow-test-drawer');
  if (drawer) {
    drawer.classList.toggle('open', designerState.isTestDrawerOpen);
  }
}

async function runFlowTest() {
  const inputEl = document.getElementById('flow-test-input');
  let parsedPayload = {};
  if (inputEl) {
    designerState.testPayload = inputEl.value;
    try {
      parsedPayload = JSON.parse(inputEl.value);
    } catch (e) {
      toast('Invalid JSON in test payload input', 'error');
      return;
    }
  }

  const flowId = designerState.activeFlow?.id;
  if (!flowId) return;

  try {
    const res = await api(`/api/flows/${flowId}/execute?wait=true`, {
      method: 'POST',
      body: JSON.stringify(parsedPayload),
    });

    designerState.latestExecution = res;
    // Update drawer content
    const drawer = document.getElementById('flow-test-drawer');
    if (drawer) {
      drawer.innerHTML = renderTestDrawerHtml(designerState.activeFlow);
    }

    // Refresh flowchart diagram to show status highlights (green / red)
    renderSvgFlowchart(designerState.activeFlow);
  } catch (err) {
    toast('Flow execution failed: ' + (err.message || err), 'error');
  }
}

// ==========================================
// 8. Flow Mutators
// ==========================================

function updateFlowMeta(key, value) {
  if (designerState.activeFlow) {
    designerState.activeFlow[key] = value;
    if (key === 'name' && typeof updateBreadcrumbs === 'function') {
      updateBreadcrumbs();
    }
  }
}

function updateFlowStartAt(val) {
  if (designerState.activeFlow?.definition) {
    designerState.activeFlow.definition.startAt = val;
    renderSvgFlowchart(designerState.activeFlow);
  }
}

function handleStepEndToggle(stepName, isEnd) {
  const step = designerState.activeFlow?.definition?.states?.[stepName];
  if (!step) return;

  const nextSelect = document.getElementById(`step-next-select-${stepName}`);
  const endCheck = document.getElementById(`step-end-check-${stepName}`);

  if (isEnd) {
    step.end = true;
    delete step.next;
    if (nextSelect) {
      nextSelect.value = '';
      nextSelect.disabled = true;
    }
  } else {
    delete step.end;
    if (nextSelect) {
      nextSelect.disabled = false;
      nextSelect.focus();
    }
  }

  if (endCheck) {
    endCheck.checked = !!step.end;
  }

  renderSvgFlowchart(designerState.activeFlow);
}

function handleStepNextChange(stepName, nextStep) {
  const step = designerState.activeFlow?.definition?.states?.[stepName];
  if (!step) return;

  const nextSelect = document.getElementById(`step-next-select-${stepName}`);
  const endCheck = document.getElementById(`step-end-check-${stepName}`);

  if (nextStep) {
    step.next = nextStep;
    delete step.end;
    if (endCheck) {
      endCheck.checked = false;
    }
  } else {
    delete step.next;
  }

  if (nextSelect) {
    nextSelect.disabled = false;
  }

  renderSvgFlowchart(designerState.activeFlow);
}

function updateStepProp(stepName, prop, val) {
  const step = designerState.activeFlow?.definition?.states?.[stepName];
  if (!step) return;

  if (prop === 'end') {
    handleStepEndToggle(stepName, !!val);
    return;
  }
  if (prop === 'next') {
    handleStepNextChange(stepName, val);
    return;
  }

  step[prop] = val;
  renderSvgFlowchart(designerState.activeFlow);
}

function updateMapIteratorFunction(stepName, fnName) {
  const step = designerState.activeFlow?.definition?.states?.[stepName];
  if (!step) return;

  step.iterator = {
    startAt: 'ProcessItem',
    states: {
      ProcessItem: {
        type: 'Task',
        function: fnName,
        end: true,
      },
    },
  };
  renderSvgFlowchart(designerState.activeFlow);
}

function addParallelBranch(stepName) {
  const step = designerState.activeFlow?.definition?.states?.[stepName];
  if (!step) return;
  if (!Array.isArray(step.branches)) step.branches = [];
  const bNum = step.branches.length + 1;
  const startKey = `Branch${bNum}_Task`;
  step.branches.push({
    startAt: startKey,
    states: {
      [startKey]: {
        type: 'Task',
        function: '',
        end: true,
      },
    },
  });
  renderFlowDesignerWorkbench(designerState.activeFlow);
}

function removeParallelBranch(stepName, branchIdx) {
  const step = designerState.activeFlow?.definition?.states?.[stepName];
  if (!step || !Array.isArray(step.branches)) return;
  if (step.branches.length <= 1) {
    toast('A Parallel step must have at least one branch.', 'warning');
    return;
  }
  step.branches.splice(branchIdx, 1);
  renderFlowDesignerWorkbench(designerState.activeFlow);
}

function updateParallelBranchFunction(stepName, branchIdx, fnName) {
  const step = designerState.activeFlow?.definition?.states?.[stepName];
  if (!step || !Array.isArray(step.branches) || !step.branches[branchIdx]) return;
  const branch = step.branches[branchIdx];
  const startKey = branch.startAt || Object.keys(branch.states || {})[0] || `Branch${branchIdx + 1}_Task`;
  branch.startAt = startKey;
  if (!branch.states) branch.states = {};
  if (!branch.states[startKey]) {
    branch.states[startKey] = {
      type: 'Task',
      function: fnName,
      end: true,
    };
  } else {
    branch.states[startKey].type = 'Task';
    branch.states[startKey].function = fnName;
    branch.states[startKey].end = true;
  }
  renderSvgFlowchart(designerState.activeFlow);
}

function updateLoopCondition(stepName, prop, val) {
  const step = designerState.activeFlow?.definition?.states?.[stepName];
  if (!step) return;
  if (!step.condition) step.condition = { variable: '$.counter', next: step.target };
  step.condition[prop] = val;
}

function updatePassResult(stepName, jsonStr) {
  const step = designerState.activeFlow?.definition?.states?.[stepName];
  if (!step) return;
  try {
    step.result = JSON.parse(jsonStr);
  } catch (e) {
    step.result = jsonStr;
  }
}

function addChoiceBranch(stepName) {
  const step = designerState.activeFlow?.definition?.states?.[stepName];
  if (!step) return;
  if (!step.choices) step.choices = [];
  step.choices.push({ variable: '$.status', stringEquals: 'approved', next: '' });
  renderFlowDesignerWorkbench(designerState.activeFlow);
}

function removeChoiceBranch(stepName, index) {
  const step = designerState.activeFlow?.definition?.states?.[stepName];
  if (!step || !step.choices) return;
  step.choices.splice(index, 1);
  renderFlowDesignerWorkbench(designerState.activeFlow);
}

function updateChoiceBranch(stepName, index, prop, val) {
  const step = designerState.activeFlow?.definition?.states?.[stepName];
  if (step?.choices?.[index]) {
    if (prop === 'variable') {
      let v = (val || '').trim();
      if (v && !v.startsWith('$')) {
        v = '$.' + v;
      }
      step.choices[index].variable = v;
    } else {
      step.choices[index][prop] = val;
    }
    renderSvgFlowchart(designerState.activeFlow);
  }
}

function updateChoiceBranchOp(stepName, index, op) {
  const branch = designerState.activeFlow?.definition?.states?.[stepName]?.choices?.[index];
  if (!branch) return;

  delete branch.stringEquals;
  delete branch.numericEquals;
  delete branch.numericGreaterThan;
  delete branch.numericLessThan;
  delete branch.numericGreaterThanEquals;
  delete branch.numericLessThanEquals;
  delete branch.booleanEquals;
  delete branch.isPresent;

  if (op === 'booleanEquals') {
    branch.booleanEquals = true;
  } else if (op === 'isPresent') {
    branch.isPresent = true;
  } else if (op === 'numericGreaterThan') {
    branch.numericGreaterThan = 0;
  } else if (op === 'numericLessThan') {
    branch.numericLessThan = 10;
  } else if (op === 'numericEquals') {
    branch.numericEquals = 0;
  } else if (op === 'numericGreaterThanEquals') {
    branch.numericGreaterThanEquals = 0;
  } else if (op === 'numericLessThanEquals') {
    branch.numericLessThanEquals = 10;
  } else {
    branch.stringEquals = '';
  }

  renderFlowDesignerWorkbench(designerState.activeFlow);
}

function updateChoiceBranchVal(stepName, index, val) {
  const branch = designerState.activeFlow?.definition?.states?.[stepName]?.choices?.[index];
  if (!branch) return;

  if (branch.booleanEquals !== undefined) {
    branch.booleanEquals = val === 'true';
  } else if (branch.isPresent !== undefined) {
    branch.isPresent = val === 'true';
  } else if (branch.numericGreaterThan !== undefined ||
             branch.numericLessThan !== undefined ||
             branch.numericEquals !== undefined ||
             branch.numericGreaterThanEquals !== undefined ||
             branch.numericLessThanEquals !== undefined) {
    const num = Number(val);
    if (isNaN(num) || String(val).trim() === '') {
      toast('Please enter a valid numeric value for number conditions.', 'warning');
      renderFlowDesignerWorkbench(designerState.activeFlow);
      return;
    }
    if (branch.numericGreaterThan !== undefined) branch.numericGreaterThan = num;
    else if (branch.numericLessThan !== undefined) branch.numericLessThan = num;
    else if (branch.numericEquals !== undefined) branch.numericEquals = num;
    else if (branch.numericGreaterThanEquals !== undefined) branch.numericGreaterThanEquals = num;
    else if (branch.numericLessThanEquals !== undefined) branch.numericLessThanEquals = num;
  } else {
    branch.stringEquals = String(val);
  }

  renderSvgFlowchart(designerState.activeFlow);
}

function deleteStep(stepName, evt) {
  if (evt) evt.stopPropagation();
  if (!confirm(`Delete step "${stepName}"?`)) return;

  const states = designerState.activeFlow.definition.states;
  delete states[stepName];

  // Clean up references across all remaining states
  Object.values(states).forEach((st) => {
    if (st.next === stepName) delete st.next;
    if (st.target === stepName) delete st.target;
    if (st.default === stepName) delete st.default;
    if (Array.isArray(st.choices)) {
      st.choices.forEach((c) => {
        if (c.next === stepName) c.next = '';
      });
    }
  });

  if (designerState.activeFlow.definition.startAt === stepName) {
    const keys = Object.keys(states);
    designerState.activeFlow.definition.startAt = keys[0] || '';
  }
  renderFlowDesignerWorkbench(designerState.activeFlow);
}

function renameStep(oldName, newName) {
  const trimmed = newName ? newName.trim() : '';
  if (!trimmed || oldName === trimmed) return;
  const states = designerState.activeFlow.definition.states;
  if (states[trimmed]) {
    toast(`A step with name "${trimmed}" already exists`, 'warning');
    renderFlowDesignerWorkbench(designerState.activeFlow);
    return;
  }

  // Preserve exact key position in states object so renamed step does not jump to the end
  const keys = Object.keys(states);
  const newStates = {};
  keys.forEach((k) => {
    if (k === oldName) {
      newStates[trimmed] = states[oldName];
    } else {
      newStates[k] = states[k];
    }
  });
  designerState.activeFlow.definition.states = newStates;

  // Synchronize references across all other states
  Object.values(newStates).forEach((st) => {
    if (st.next === oldName) st.next = trimmed;
    if (st.target === oldName) st.target = trimmed;
    if (st.default === oldName) st.default = trimmed;
    if (Array.isArray(st.choices)) {
      st.choices.forEach((c) => {
        if (c.next === oldName) c.next = trimmed;
      });
    }
  });

  if (designerState.activeFlow.definition.startAt === oldName) {
    designerState.activeFlow.definition.startAt = trimmed;
  }
  if (designerState.selectedStepName === oldName) {
    designerState.selectedStepName = trimmed;
  }

  renderFlowDesignerWorkbench(designerState.activeFlow);
}

function validateFlowDefinitionClient(def) {
  if (!def || typeof def !== 'object') return 'Flow definition is empty or invalid.';
  if (!def.startAt || typeof def.startAt !== 'string' || !def.startAt.trim()) {
    return 'Flow must have a Start Step configured.';
  }
  if (!def.states || typeof def.states !== 'object' || Object.keys(def.states).length === 0) {
    return 'Flow must contain at least one step in definition.';
  }
  if (!def.states[def.startAt]) {
    return `Start Step "${def.startAt}" does not exist in flow steps.`;
  }

  const keys = Object.keys(def.states);
  for (const [name, state] of Object.entries(def.states)) {
    if (!state || typeof state !== 'object') {
      return `Step "${name}" is invalid.`;
    }

    if (state.next && !keys.includes(state.next)) {
      return `Step "${name}" points to non-existent step "${state.next}".`;
    }

    if (state.type === 'Task') {
      if (!state.function || !state.function.trim()) {
        return `Task step "${name}" must specify a serverless function.`;
      }
      if (!state.next && !state.end) {
        return `Task step "${name}" must configure "Then Go To" or mark as "End State".`;
      }
    } else if (state.type === 'Choice') {
      if (!Array.isArray(state.choices) || state.choices.length === 0) {
        return `Choice step "${name}" must have at least one condition rule.`;
      }
      for (let i = 0; i < state.choices.length; i++) {
        const c = state.choices[i];
        if (!c.variable || !c.variable.trim() || !c.variable.startsWith('$')) {
          return `Choice step "${name}" rule #${i + 1} variable must start with '$' (e.g. $.status).`;
        }
        if (!c.next || !keys.includes(c.next)) {
          return `Choice step "${name}" rule #${i + 1} must select a valid target step.`;
        }

        const isNumeric = c.numericGreaterThan !== undefined ||
                          c.numericLessThan !== undefined ||
                          c.numericEquals !== undefined ||
                          c.numericGreaterThanEquals !== undefined ||
                          c.numericLessThanEquals !== undefined;

        if (isNumeric) {
          const num = c.numericGreaterThan ??
                      c.numericLessThan ??
                      c.numericEquals ??
                      c.numericGreaterThanEquals ??
                      c.numericLessThanEquals;
          if (typeof num !== 'number' || isNaN(num) || !Number.isFinite(num)) {
            return `Choice step "${name}" rule #${i + 1} has invalid non-numeric value: ${JSON.stringify(num)}.`;
          }
        }

        if (c.booleanEquals !== undefined && typeof c.booleanEquals !== 'boolean') {
          return `Choice step "${name}" rule #${i + 1} boolean condition must be true or false.`;
        }
      }

      if (state.default && !keys.includes(state.default)) {
        return `Choice step "${name}" default fallback step "${state.default}" does not exist.`;
      }
    } else if (state.type === 'Loop') {
      if (!state.target || !keys.includes(state.target)) {
        return `Loop step "${name}" must select a valid jump target step.`;
      }
      if (state.maxIterations !== undefined) {
        if (typeof state.maxIterations !== 'number' || state.maxIterations < 1) {
          return `Loop step "${name}" max iterations must be a positive number.`;
        }
      }
    } else if (state.type === 'Wait') {
      if (typeof state.seconds !== 'number' || isNaN(state.seconds) || state.seconds < 0) {
        return `Wait step "${name}" seconds delay must be a non-negative number.`;
      }
      if (!state.next && !state.end) {
        return `Wait step "${name}" must configure "Then Go To" or mark as "End State".`;
      }
    } else if (state.type === 'Parallel') {
      if (!Array.isArray(state.branches) || state.branches.length === 0) {
        return `Parallel step "${name}" must have at least one branch in "branches".`;
      }
      if (!state.next && !state.end) {
        return `Parallel step "${name}" must configure "Then Go To" or mark as "End State".`;
      }
    } else if (state.type === 'Pass') {
      if (!state.next && !state.end) {
        return `Pass step "${name}" must configure "Then Go To" or mark as "End State".`;
      }
    } else if (state.type === 'Succeed' || state.type === 'Fail') {
      // Terminal states must not have next or end transitions
      if (state.next) {
        delete state.next;
      }
      if (state.end) {
        delete state.end;
      }
    }
  }

  return null;
}

function selectStepCard(name) {
  designerState.selectedStepName = name;
  document.querySelectorAll('.flow-step-card').forEach((el) => el.classList.remove('active-step'));
  const card = document.getElementById(`step-card-${name}`);
  if (card) card.classList.add('active-step');
}

function selectStepFromDiagram(name) {
  selectStepCard(name);
  const card = document.getElementById(`step-card-${name}`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function switchDesignerMode(mode) {
  designerState.activeMode = mode;
  renderFlowDesignerWorkbench(designerState.activeFlow);
}

async function saveFlowChanges() {
  const flow = designerState.activeFlow;
  if (!flow || !flow.id) return;

  const validationError = validateFlowDefinitionClient(flow.definition);
  if (validationError) {
    toast('Validation Error: ' + validationError, 'error');
    return;
  }

  try {
    const updated = await api(`/api/flows/${flow.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: flow.name,
        description: flow.description,
        triggerType: flow.triggerType,
        eventTrigger: flow.triggerType === 'event' ? (flow.eventTrigger || null) : null,
        definition: flow.definition,
      }),
    });
    flowsState.activeFlowForEdit = updated;
    designerState.activeFlow = JSON.parse(JSON.stringify(updated));

    if (typeof updateUrl === 'function') {
      const flowIdentifier = updated.name ? encodeURIComponent(updated.name) : encodeURIComponent(updated.id);
      updateUrl('/_/flows/' + flowIdentifier, true);
    }

    if (typeof updateBreadcrumbs === 'function') {
      updateBreadcrumbs();
    }

    toast('Flow changes saved successfully!', 'success');
  } catch (err) {
    toast('Failed to save flow: ' + (err.message || err), 'error');
  }
}

if (typeof window !== 'undefined') {
  window.openFlowDesigner = openFlowDesigner;
  window.closeFlowDesigner = closeFlowDesigner;
  window.renderFlowDesignerWorkbench = renderFlowDesignerWorkbench;
  window.updateFlowMeta = updateFlowMeta;
  window.handleFlowTriggerTypeChange = handleFlowTriggerTypeChange;
  window.updateFlowStartAt = updateFlowStartAt;
  window.updateStepProp = updateStepProp;
  window.handleStepEndToggle = handleStepEndToggle;
  window.handleStepNextChange = handleStepNextChange;
  window.updateMapIteratorFunction = updateMapIteratorFunction;
  window.addParallelBranch = addParallelBranch;
  window.removeParallelBranch = removeParallelBranch;
  window.updateParallelBranchFunction = updateParallelBranchFunction;
  window.updateLoopCondition = updateLoopCondition;
  window.updatePassResult = updatePassResult;
  window.addChoiceBranch = addChoiceBranch;
  window.removeChoiceBranch = removeChoiceBranch;
  window.updateChoiceBranch = updateChoiceBranch;
  window.updateChoiceBranchOp = updateChoiceBranchOp;
  window.updateChoiceBranchVal = updateChoiceBranchVal;
  window.openAddStepModal = openAddStepModal;
  window.selectAddStepType = selectAddStepType;
  window.closeAddStepModal = closeAddStepModal;
  window.handleAddStepSubmit = handleAddStepSubmit;
  window.moveStepUp = moveStepUp;
  window.moveStepDown = moveStepDown;
  window.deleteStep = deleteStep;
  window.renameStep = renameStep;
  window.selectStepCard = selectStepCard;
  window.selectStepFromDiagram = selectStepFromDiagram;
  window.switchDesignerMode = switchDesignerMode;
  window.syncDslToVisual = syncDslToVisual;
  window.toggleTestDrawer = toggleTestDrawer;
  window.runFlowTest = runFlowTest;
  window.saveFlowChanges = saveFlowChanges;
}
