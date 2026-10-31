// Functions Flow Designer - Add Step Modal & Reordering
// Handles Move Up/Down and the Step Type selector modal with dynamic info banner

// ==========================================
// 3. Step Reordering (Up / Down)
// ==========================================

function moveStepUp(stepName, evt) {
  if (evt) evt.stopPropagation();
  const flow = designerState.activeFlow;
  if (!flow?.definition?.states) return;

  const states = flow.definition.states;
  const keys = Object.keys(states);
  const idx = keys.indexOf(stepName);
  if (idx <= 0) return;

  const prevKey = keys[idx - 1];
  keys[idx - 1] = stepName;
  keys[idx] = prevKey;

  const newStates = {};
  keys.forEach((k) => (newStates[k] = states[k]));
  flow.definition.states = newStates;

  if (flow.definition.startAt === prevKey) {
    flow.definition.startAt = stepName;
  }

  renderFlowDesignerWorkbench(flow);
}

function moveStepDown(stepName, evt) {
  if (evt) evt.stopPropagation();
  const flow = designerState.activeFlow;
  if (!flow?.definition?.states) return;

  const states = flow.definition.states;
  const keys = Object.keys(states);
  const idx = keys.indexOf(stepName);
  if (idx < 0 || idx >= keys.length - 1) return;

  const nextKey = keys[idx + 1];
  keys[idx + 1] = stepName;
  keys[idx] = nextKey;

  const newStates = {};
  keys.forEach((k) => (newStates[k] = states[k]));
  flow.definition.states = newStates;

  if (flow.definition.startAt === stepName) {
    flow.definition.startAt = nextKey;
  }

  renderFlowDesignerWorkbench(flow);
}

// ==========================================
// 4. Modal for Adding Steps (Replaces prompt)
// ==========================================

// Dynamic Step Type Metadata & Descriptions
const STEP_TYPE_DESCRIPTIONS = {
  Task: {
    pill: 'pill-task',
    tag: 'FUNCTION EXECUTION',
    desc: 'Invokes a registered serverless QuickJS function. Maps input payload parameters and merges function output into the flow state.',
  },
  Choice: {
    pill: 'pill-choice',
    tag: 'CONDITIONAL BRANCHING',
    desc: 'Evaluates dynamic if-else condition rules (numeric, string, boolean checks) to route execution to different steps.',
  },
  Map: {
    pill: 'pill-map',
    tag: 'PARALLEL ITERATION',
    desc: 'Iterates over an array in parallel with concurrency limiting, executing a sub-flow on each item and aggregating results.',
  },
  Loop: {
    pill: 'pill-loop',
    tag: 'REPEAT CYCLE',
    desc: 'Repeats a loop cycle back to a target step while condition holds true, protected by max-iterations safety cap.',
  },
  Parallel: {
    pill: 'pill-parallel',
    tag: 'SIMULTANEOUS BRANCHES',
    desc: 'Executes multiple independent branches concurrently and joins their combined outputs into an array.',
  },
  Pass: {
    pill: 'pill-pass',
    tag: 'DATA INJECTION / TRANSFORM',
    desc: 'Passes payload through without invoking external code. Injects static JSON data or reshapes state paths.',
  },
  Wait: {
    pill: 'pill-wait',
    tag: 'EXECUTION DELAY',
    desc: 'Pauses flow execution for a specified number of seconds before transitioning to the next step.',
  },
  Succeed: {
    pill: 'pill-succeed',
    tag: 'TERMINAL SUCCESS',
    desc: 'Explicit terminal state that stops flow execution immediately and marks the run as successfully completed.',
  },
  Fail: {
    pill: 'pill-fail',
    tag: 'TERMINAL ERROR',
    desc: 'Explicit terminal state that aborts execution immediately and marks the run as failed with a custom error cause.',
  },
};

function openAddStepModal() {
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return;

  const states = designerState.activeFlow?.definition?.states || {};
  const existingKeys = Object.keys(states);
  const suggestedName = `Step_${existingKeys.length + 1}`;
  designerState.addStepSelectedType = 'Task';

  const fns = flowsState.functions || [];
  const defaultMeta = STEP_TYPE_DESCRIPTIONS.Task;

  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeAddStepModal()">
      <div class="modal" style="max-width: 520px; max-height: 85vh; display: flex; flex-direction: column;">
        <div class="modal-header">
          <h2 class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Add Flow Step
          </h2>
          <button type="button" class="btn btn-secondary btn-sm" onclick="closeAddStepModal()">✕</button>
        </div>
        <form onsubmit="handleAddStepSubmit(event)" style="display: flex; flex-direction: column; overflow: hidden; margin: 0; flex: 1;">
          <div class="modal-body" style="gap: 1.15rem; overflow-y: auto; padding: 1.5rem;">
            <div class="form-group">
              <label class="form-label" for="new-step-name">Step Name *</label>
              <input
                type="text"
                id="new-step-name"
                class="form-input"
                placeholder="e.g. ValidatePayment"
                value="${escapeHtml(suggestedName)}"
                required
                autofocus
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="new-step-type-select">Step Type</label>
              <select
                id="new-step-type-select"
                class="form-select"
                onchange="selectAddStepType(this.value)"
              >
                <option value="Task" selected>Task — Invoke Serverless Function</option>
                <option value="Choice">Choice — Branch Condition Rules (If / Else)</option>
                <option value="Map">Map — Parallel Array Iteration</option>
                <option value="Loop">Loop — Repeat Cycle with Condition Guard</option>
                <option value="Parallel">Parallel — Run Multiple Branches Concurrently</option>
                <option value="Pass">Pass — Inject / Transform Payload</option>
                <option value="Wait">Wait — Delay Execution Timer</option>
                <option value="Succeed">Succeed — Terminal Success</option>
                <option value="Fail">Fail — Terminal Error</option>
              </select>

              <!-- Dynamic description banner for selected type -->
              <div id="step-type-description" class="flow-type-info-banner">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="flow-step-type-pill ${defaultMeta.pill}" id="step-desc-pill">TASK</span>
                  <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700; letter-spacing: 0.05em;" id="step-desc-tag">${defaultMeta.tag}</span>
                </div>
                <div id="step-desc-text" style="font-size: 0.82rem; color: var(--text-main); line-height: 1.45;">
                  ${defaultMeta.desc}
                </div>
              </div>
            </div>

            <div id="add-step-task-fields" class="form-group">
              <label class="form-label" for="new-step-function">Serverless Function</label>
              <select id="new-step-function" class="form-select">
                <option value="">-- Choose Function (or configure later) --</option>
                ${fns.map(f => `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)}</option>`).join('')}
              </select>
              <span style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
                Pick a serverless function to invoke when this step runs.
              </span>
            </div>
          </div>
          <div class="modal-footer" style="padding: 1rem 1.5rem; border-top: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: flex-end; gap: 0.75rem; background: var(--bg-card); flex-shrink: 0;">
            <button type="button" class="btn btn-secondary" onclick="closeAddStepModal()">Cancel</button>
            <button type="submit" class="btn btn-primary" style="font-weight: 600;">+ Add Step to Flow</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function selectAddStepType(type) {
  designerState.addStepSelectedType = type;
  const selectEl = document.getElementById('new-step-type-select');
  if (selectEl && selectEl.value !== type) {
    selectEl.value = type;
  }

  const meta = STEP_TYPE_DESCRIPTIONS[type] || STEP_TYPE_DESCRIPTIONS.Task;
  const pillEl = document.getElementById('step-desc-pill');
  const tagEl = document.getElementById('step-desc-tag');
  const textEl = document.getElementById('step-desc-text');
  if (pillEl) {
    pillEl.className = `flow-step-type-pill ${meta.pill}`;
    pillEl.textContent = type.toUpperCase();
  }
  if (tagEl) tagEl.textContent = meta.tag;
  if (textEl) textEl.textContent = meta.desc;

  const taskFields = document.getElementById('add-step-task-fields');
  if (taskFields) {
    taskFields.style.display = type === 'Task' ? 'flex' : 'none';
  }
}

function closeAddStepModal() {
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot) modalRoot.innerHTML = '';
}

function handleAddStepSubmit(e) {
  e.preventDefault();
  const nameInput = document.getElementById('new-step-name');
  const fnInput = document.getElementById('new-step-function');
  const stepName = nameInput ? nameInput.value.trim() : '';

  if (!stepName) return;

  const states = designerState.activeFlow?.definition?.states;
  if (!states) return;

  if (states[stepName]) {
    toast(`A step with name "${stepName}" already exists in this flow.`, 'warning');
    return;
  }

  const isFirstStep = Object.keys(states).length === 0;
  const type = designerState.addStepSelectedType || 'Task';
  let newStep = { type };

  // Only the first step of an empty flow defaults to end: true.
  // Subsequent steps added to an existing flow default to end: false (open Next dropdown)
  // so the user can freely choose the next step without being locked.
  const defaultEndProp = isFirstStep ? { end: true } : {};

  if (type === 'Task') {
    newStep = {
      type: 'Task',
      function: fnInput ? fnInput.value : '',
      inputPath: '$',
      resultPath: '$',
      ...defaultEndProp,
    };
  } else if (type === 'Choice') {
    newStep = {
      type: 'Choice',
      choices: [{ variable: '$.status', stringEquals: 'active', next: '' }],
    };
  } else if (type === 'Map') {
    newStep = {
      type: 'Map',
      itemsPath: '$.items',
      maxConcurrency: 5,
      iterator: {
        startAt: 'ProcessItem',
        states: {
          ProcessItem: {
            type: 'Task',
            function: fnInput ? fnInput.value : '',
            end: true,
          },
        },
      },
      ...defaultEndProp,
    };
  } else if (type === 'Loop') {
    newStep = {
      type: 'Loop',
      target: '',
      condition: { variable: '$.counter', numericLessThan: 10, next: '' },
      maxIterations: 100,
    };
  } else if (type === 'Parallel') {
    newStep = {
      type: 'Parallel',
      branches: [
        {
          startAt: 'Branch1_Task',
          states: {
            Branch1_Task: {
              type: 'Task',
              function: fnInput ? fnInput.value : '',
              end: true,
            },
          },
        },
        {
          startAt: 'Branch2_Task',
          states: {
            Branch2_Task: {
              type: 'Task',
              function: '',
              end: true,
            },
          },
        },
      ],
      resultPath: '$.parallelResults',
      ...defaultEndProp,
    };
  } else if (type === 'Pass') {
    newStep = { type: 'Pass', result: {}, resultPath: '$', ...defaultEndProp };
  } else if (type === 'Wait') {
    newStep = { type: 'Wait', seconds: 2, ...defaultEndProp };
  } else if (type === 'Fail') {
    newStep = { type: 'Fail', error: 'CustomFailure' };
  } else if (type === 'Succeed') {
    newStep = { type: 'Succeed' };
  } else {
    newStep = { type: 'Task', function: '', ...defaultEndProp };
  }

  states[stepName] = newStep;

  // If this was the first step added, set it as startAt
  if (!designerState.activeFlow.definition.startAt) {
    designerState.activeFlow.definition.startAt = stepName;
  }

  closeAddStepModal();
  renderFlowDesignerWorkbench(designerState.activeFlow);

  // Focus the new step card
  setTimeout(() => selectStepCard(stepName), 50);
}


if (typeof window !== "undefined") {
  window.STEP_TYPE_DESCRIPTIONS = STEP_TYPE_DESCRIPTIONS;
  window.FLOW_STEP_TYPE_DESCRIPTIONS = STEP_TYPE_DESCRIPTIONS;
  window.openAddStepModal = openAddStepModal;
  window.selectAddStepType = selectAddStepType;
  window.closeAddStepModal = closeAddStepModal;
  window.handleAddStepSubmit = handleAddStepSubmit;
  window.moveStepUp = moveStepUp;
  window.moveStepDown = moveStepDown;
}
