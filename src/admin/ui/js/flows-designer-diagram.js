// Functions Flow Designer - Live Auto-Layout SVG Diagram Generator
// Renders real-time SVG flowchart with collision-free bezier curves, decision diamonds, and terminal endpoints

// ==========================================
// 5. Live Auto-Layout SVG Diagram Generator
// ==========================================

function renderSvgFlowchart(flow) {
  const container = document.getElementById('flow-diagram-container');
  if (!container || !flow) return;

  const states = flow.definition?.states || {};
  const stateKeys = Object.keys(states);
  if (stateKeys.length === 0) {
    container.innerHTML = `<span style="color: var(--text-muted); font-size: 0.85rem;">No states in flow.</span>`;
    return;
  }

  const startAt = flow.definition?.startAt || stateKeys[0];

  // Compute node coordinates vertically
  const nodeWidth = 200;
  const nodeHeight = 54;
  const verticalGap = 65;
  const startY = 24;
  const centerX = 260;

  let currentY = startY;
  const positions = {};

  // Start Node
  positions['__START__'] = { x: centerX, y: currentY, width: 96, height: 32, type: 'Start' };
  currentY += 32 + verticalGap;

  // Lay out states sequentially / branching
  stateKeys.forEach((key) => {
    const isChoice = states[key].type === 'Choice';
    const width = isChoice ? 170 : nodeWidth;
    const height = isChoice ? 80 : nodeHeight;
    positions[key] = {
      x: centerX,
      y: currentY,
      width,
      height,
      type: states[key].type || 'Pass',
      isChoice,
    };
    currentY += height + verticalGap;
  });

  // End Node
  positions['__END__'] = { x: centerX, y: currentY, width: 96, height: 32, type: 'End' };
  const totalSvgHeight = currentY + 40;
  const totalSvgWidth = centerX * 2;

  // Build SVG
  let svg = `
    <svg
      viewBox="0 0 ${totalSvgWidth} ${totalSvgHeight}"
      preserveAspectRatio="xMidYMin meet"
      style="width: 100%; max-width: 520px; height: ${totalSvgHeight}px; flex-shrink: 0;"
      onclick="handleDiagramNodeClick(event)"
    >
      <defs>
        <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--text-muted, #64748b)" />
        </marker>
        <marker id="flow-arrow-yes" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
        </marker>
        <marker id="flow-arrow-no" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#94a3b8" />
        </marker>
        <marker id="flow-arrow-choice" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
        </marker>
        <marker id="flow-arrow-default" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#94a3b8" />
        </marker>
        <marker id="flow-arrow-loop" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
        </marker>
      </defs>
  `;

  // Draw Arrow from __START__ to startAt
  const startTarget = positions[startAt];
  if (startTarget) {
    svg += drawArrow(positions['__START__'], startTarget);
  }

  // Draw transition arrows between states
  let leftEndCurveCount = 0;
  stateKeys.forEach((key, keyIdx) => {
    const src = positions[key];
    const state = states[key];

    if (state.type === 'Choice') {
      const choices = state.choices || [];
      const defaultTargetKey = state.default;
      const defaultPos = defaultTargetKey ? positions[defaultTargetKey] : null;

      // Group condition rules by target step to smartly combine rules targeting the same step
      const targetRulesMap = new Map();
      choices.forEach((c, idx) => {
        if (!c.next || !positions[c.next]) return;
        const targetKey = c.next;
        if (!targetRulesMap.has(targetKey)) {
          targetRulesMap.set(targetKey, []);
        }
        targetRulesMap.get(targetKey).push(getChoiceRuleLabel(c, idx));
      });

      const uniqueTargets = Array.from(targetRulesMap.keys());
      const immediateNextKey = stateKeys[keyIdx + 1];
      const defaultIsImmediateNext = defaultPos && defaultTargetKey === immediateNextKey;

      let rightCurveCount = 0;
      let rightLoopCount = 0;

      // Draw grouped condition rules per target (stacked neatly without overlapping)
      uniqueTargets.forEach((targetKey, uIdx) => {
        const targetPos = positions[targetKey];
        const rules = targetRulesMap.get(targetKey);
        const isTargetDown = targetPos.y > src.y;

        if (isTargetDown) {
          if (!defaultIsImmediateNext && targetKey === immediateNextKey) {
            svg += drawStraightBranchArrow(src, targetPos, rules, '#f59e0b', 'url(#flow-arrow-choice)');
          } else {
            rightCurveCount++;
            svg += drawCurveBranchArrow(src, targetPos, rules, '#f59e0b', 'right', 'url(#flow-arrow-choice)', rightCurveCount);
          }
        } else {
          if (uIdx === 0) {
            svg += drawLoopBranchArrow(src, targetPos, rules, '#f59e0b', 'left', 'url(#flow-arrow-choice)');
          } else {
            rightLoopCount++;
            svg += drawLoopBranchArrow(src, targetPos, rules, '#f59e0b', 'right', 'url(#flow-arrow-choice)', rightLoopCount);
          }
        }
      });

      // Draw default fallback branch
      if (defaultPos) {
        const isDefaultDown = defaultPos.y > src.y;
        if (isDefaultDown) {
          if (defaultTargetKey === immediateNextKey) {
            svg += drawStraightBranchArrow(src, defaultPos, 'ELSE', '#94a3b8', 'url(#flow-arrow-default)');
          } else {
            rightCurveCount++;
            svg += drawCurveBranchArrow(src, defaultPos, 'ELSE', '#94a3b8', 'right', 'url(#flow-arrow-default)', rightCurveCount);
          }
        } else {
          const firstTargetLoopsLeft = uniqueTargets.length > 0 && positions[uniqueTargets[0]] && positions[uniqueTargets[0]].y <= src.y;
          const side = firstTargetLoopsLeft ? 'right' : 'left';
          svg += drawLoopBranchArrow(src, defaultPos, 'ELSE', '#94a3b8', side, 'url(#flow-arrow-default)');
        }
      }
    } else if (state.type === 'Loop' && state.target && positions[state.target]) {
      svg += drawLoopBranchArrow(src, positions[state.target], 'LOOP', '#38bdf8', 'left', 'url(#flow-arrow-loop)');
      if (state.next && positions[state.next]) {
        svg += drawArrow(src, positions[state.next]);
      }
    } else if (state.type === 'Succeed' || state.type === 'Fail' || state.end) {
      // Terminal transitions to __END__
      // Sanitize: terminal states must never keep a next reference
      if (state.type === 'Succeed' || state.type === 'Fail') {
        delete state.next;
        delete state.end;
      }
      const isSucceed = state.type === 'Succeed';
      const isFail = state.type === 'Fail';
      const arrowColor = isSucceed ? '#10b981' : isFail ? '#ef4444' : 'var(--text-muted, #64748b)';
      const arrowMarker = isSucceed ? 'url(#flow-arrow-yes)' : isFail ? 'url(#flow-arrow-no)' : 'url(#flow-arrow)';
      const isLastState = keyIdx === stateKeys.length - 1;

      if (isLastState) {
        svg += drawArrow(src, positions['__END__'], arrowColor, '', arrowMarker);
      } else {
        leftEndCurveCount++;
        svg += drawCurveBranchArrow(src, positions['__END__'], '', arrowColor, 'left', arrowMarker, leftEndCurveCount);
      }
    } else if (state.next && positions[state.next]) {
      const isImmediateNext = state.next === stateKeys[keyIdx + 1];
      if (isImmediateNext) {
        svg += drawArrow(src, positions[state.next]);
      } else {
        svg += drawCurveBranchArrow(src, positions[state.next], '', 'var(--text-muted, #64748b)', 'right', 'url(#flow-arrow)', 1);
      }
    }
  });

  // Draw Nodes
  Object.keys(positions).forEach((key) => {
    const p = positions[key];
    const isSpecial = key === '__START__' || key === '__END__';
    const isSelected = designerState.selectedStepName === key;
    const executionStep = designerState.latestExecution?.stepLogs?.find((l) => l.step === key);

    let borderColor = 'var(--border-default, #334155)';
    let bgColor = 'var(--bg-card, #1e293b)';
    let textColor = 'var(--text-main, #f8fafc)';

    if (executionStep) {
      if (executionStep.status === 'succeeded') {
        borderColor = 'var(--accent-success, #10b981)';
        bgColor = 'rgba(16, 185, 129, 0.12)';
      } else {
        borderColor = 'var(--accent-danger, #ef4444)';
        bgColor = 'rgba(239, 68, 68, 0.12)';
      }
    } else if (isSelected) {
      borderColor = 'var(--accent-primary, #3b82f6)';
    }

    if (isSpecial) {
      svg += `
        <g class="flow-svg-node">
          <rect x="${p.x - p.width / 2}" y="${p.y}" width="${p.width}" height="${p.height}" rx="16" fill="var(--bg-input, #0f172a)" stroke="var(--border-default, #64748b)" stroke-width="2"/>
          <text x="${p.x}" y="${p.y + p.height / 2 + 4}" text-anchor="middle" fill="var(--text-muted, #94a3b8)" font-size="11" font-weight="800">
            ${key === '__START__' ? 'START' : 'END'}
          </text>
        </g>
      `;
    } else if (p.isChoice) {
      const cx = p.x;
      const cy = p.y + p.height / 2;
      const hw = p.width / 2;
      const hh = p.height / 2;

      svg += `
        <g class="flow-svg-node" data-step="${escapeHtml(key)}" onclick="selectStepFromDiagram(this.getAttribute('data-step'))" role="button" tabindex="0" style="cursor: pointer;">
          <polygon
            points="${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}"
            fill="${bgColor}"
            stroke="${borderColor}"
            stroke-width="${isSelected ? '2.5' : '1.5'}"
            stroke-linejoin="round"
          />
          <text x="${cx}" y="${cy - 3}" text-anchor="middle" fill="${textColor}" font-size="12" font-weight="700">
            ${escapeHtml(key.length > 16 ? key.substring(0, 14) + '...' : key)}
          </text>
          <text x="${cx}" y="${cy + 13}" text-anchor="middle" fill="var(--text-muted, #94a3b8)" font-size="10" font-weight="600">
            Choice ${executionStep ? `(${executionStep.durationMs}ms)` : ''}
          </text>
        </g>
      `;
    } else {
      const isTerminal = p.type === 'Succeed' || p.type === 'Fail';
      const terminalBorder = p.type === 'Succeed' ? 'var(--accent-success, #10b981)' : 'var(--accent-danger, #ef4444)';
      const nodeBorder = isTerminal && !executionStep && !isSelected ? terminalBorder : borderColor;
      const nodeBg = isTerminal && !executionStep ? (p.type === 'Succeed' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)') : bgColor;

      svg += `
        <g class="flow-svg-node" data-step="${escapeHtml(key)}" onclick="selectStepFromDiagram(this.getAttribute('data-step'))" role="button" tabindex="0" style="cursor: pointer;">
          <rect x="${p.x - p.width / 2}" y="${p.y}" width="${p.width}" height="${p.height}" rx="10" fill="${nodeBg}" stroke="${nodeBorder}" stroke-width="${isSelected ? '2.5' : '1.5'}"/>
          <text x="${p.x - p.width / 2 + 16}" y="${p.y + 25}" fill="${textColor}" font-size="12" font-weight="700">
            ${escapeHtml(key.length > 20 ? key.substring(0, 18) + '...' : key)}
          </text>
          <text x="${p.x - p.width / 2 + 16}" y="${p.y + 42}" fill="${isTerminal ? (p.type === 'Succeed' ? 'var(--accent-success, #10b981)' : 'var(--accent-danger, #ef4444)') : 'var(--text-muted, #94a3b8)'}" font-size="11" font-weight="600">
            ${p.type === 'Parallel' ? `Parallel (${states[key]?.branches?.length || 0} branches)` : (isTerminal ? `${p.type} (Terminal)` : p.type)} ${executionStep ? `(${executionStep.durationMs}ms)` : ''}
          </text>
        </g>
      `;
    }
  });

  svg += `</svg>`;
  container.innerHTML = svg;
}

function getChoiceRuleLabel(c, idx) {
  if (!c) return `Rule ${idx + 1}`;
  const rawVar = c.variable || '';
  const varName = rawVar.replace(/^\$\.?/, '') || 'var';
  if (c.stringEquals !== undefined) {
    return `${varName} == "${c.stringEquals}"`;
  }
  if (c.numericEquals !== undefined) {
    return `${varName} == ${c.numericEquals}`;
  }
  if (c.numericGreaterThan !== undefined) {
    return `${varName} > ${c.numericGreaterThan}`;
  }
  if (c.numericLessThan !== undefined) {
    return `${varName} < ${c.numericLessThan}`;
  }
  if (c.numericGreaterThanEquals !== undefined) {
    return `${varName} >= ${c.numericGreaterThanEquals}`;
  }
  if (c.numericLessThanEquals !== undefined) {
    return `${varName} <= ${c.numericLessThanEquals}`;
  }
  if (c.booleanEquals !== undefined) {
    return `${varName} == ${c.booleanEquals}`;
  }
  if (c.isPresent !== undefined) {
    return `${varName} is ${c.isPresent ? 'defined' : 'null'}`;
  }
  return c.variable || `Rule ${idx + 1}`;
}

function drawArrow(src, dest, color = 'var(--text-muted, #64748b)', label = '', marker = 'url(#flow-arrow)') {
  if (dest.y <= src.y) {
    return drawLoopBranchArrow(src, dest, label, color, 'left', marker);
  }

  const x1 = src.x;
  const y1 = src.y + src.height;
  const x2 = dest.x;
  const y2 = dest.y;

  return `
    <g>
      <path
        d="M ${x1} ${y1} C ${x1} ${y1 + 25}, ${x2} ${y2 - 25}, ${x2} ${y2}"
        fill="none"
        stroke="${color}"
        stroke-width="1.8"
        marker-end="${marker}"
      />
      ${label ? `<text x="${x1 + 8}" y="${y1 + 20}" fill="${color}" font-size="10" font-weight="600">${escapeHtml(label)}</text>` : ''}
    </g>
  `;
}

function truncateRuleText(text, max = 22) {
  if (!text) return '';
  return text.length > max ? text.substring(0, max - 2) + '…' : text;
}

function renderRuleLabelsSvg(labels, x, y, color = '#f59e0b', textAnchor = 'start', stackDirection = 'up') {
  if (!labels) return '';
  const rawLines = Array.isArray(labels) ? labels : [labels];
  const lines = rawLines.map(l => truncateRuleText(l, 22));
  if (lines.length === 0) return '';

  const startY = stackDirection === 'up' ? y - ((lines.length - 1) * 14) : y;

  return `
    <text
      x="${x}"
      y="${startY}"
      fill="${color}"
      font-size="10.5"
      font-weight="700"
      letter-spacing="0.02em"
      text-anchor="${textAnchor}"
      paint-order="stroke fill"
      stroke="var(--bg-card, #ffffff)"
      stroke-width="3px"
      stroke-linejoin="round"
    >
      ${lines.map((l, i) => `
        <tspan x="${x}" dy="${i === 0 ? 0 : 14}">
          ${escapeHtml(i === 0 ? l : 'or ' + l)}
        </tspan>
      `).join('')}
    </text>
  `;
}

function drawStraightBranchArrow(src, dest, labels, color = '#10b981', marker = 'url(#flow-arrow)') {
  const x1 = src.x;
  const y1 = src.y + src.height;
  const x2 = dest.x;
  const y2 = dest.y;

  return `
    <g>
      <path
        d="M ${x1} ${y1} C ${x1} ${y1 + 25}, ${x2} ${y2 - 25}, ${x2} ${y2}"
        fill="none"
        stroke="${color}"
        stroke-width="1.8"
        marker-end="${marker}"
      />
      ${renderRuleLabelsSvg(labels, x1 + 8, y1 + 18, color, 'start', 'down')}
    </g>
  `;
}

function drawLoopBranchArrow(src, dest, labels, color = '#94a3b8', side = 'left', marker = 'url(#flow-arrow)', offsetMultiplier = 1) {
  const isLeft = side === 'left';
  const baseOffset = isLeft ? -75 : 75;
  const loopOffset = baseOffset * offsetMultiplier;
  const x1 = isLeft ? (src.x - src.width / 2) : (src.x + src.width / 2);
  const y1 = src.y + src.height / 2;
  const x2 = isLeft ? (dest.x - dest.width / 2) : (dest.x + dest.width / 2);
  const y2 = dest.y + dest.height / 2;

  const labelX = isLeft ? (x1 - 10) : (x1 + 10);
  const labelY = y1 - 6 + (offsetMultiplier - 1) * 32;

  return `
    <g>
      <path
        d="M ${x1} ${y1} C ${x1 + loopOffset} ${y1}, ${x2 + loopOffset} ${y2}, ${x2} ${y2}"
        fill="none"
        stroke="${color}"
        stroke-width="1.8"
        stroke-dasharray="4,4"
        marker-end="${marker}"
      />
      ${renderRuleLabelsSvg(labels, labelX, labelY, color, isLeft ? 'end' : 'start', 'up')}
    </g>
  `;
}

function drawCurveBranchArrow(src, dest, labels, color = '#94a3b8', side = 'right', marker = 'url(#flow-arrow)', offsetMultiplier = 1) {
  const isLeft = side === 'left';
  const baseOffset = isLeft ? -65 : 65;
  const offset = baseOffset + (offsetMultiplier - 1) * 20 * (isLeft ? -1 : 1);
  const x1 = isLeft ? (src.x - src.width / 2) : (src.x + src.width / 2);
  const y1 = src.y + src.height / 2;
  const x2 = isLeft ? (dest.x - dest.width / 2) : (dest.x + dest.width / 2);
  const y2 = dest.y + dest.height / 2;

  const labelX = isLeft ? (x1 - 10) : (x1 + 10);
  const labelY = isLeft ? (y1 - 6 + (offsetMultiplier - 1) * 32) : (y1 + 14 + (offsetMultiplier - 1) * 44);

  return `
    <g>
      <path
        d="M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 + offset} ${y2}, ${x2} ${y2}"
        fill="none"
        stroke="${color}"
        stroke-width="1.8"
        stroke-dasharray="4,4"
        marker-end="${marker}"
      />
      ${renderRuleLabelsSvg(labels, labelX, labelY, color, isLeft ? 'end' : 'start', isLeft ? 'up' : 'down')}
    </g>
  `;
}


function handleDiagramNodeClick(evt) {
  const node = evt?.target?.closest?.('.flow-svg-node');
  if (node) {
    const step = node.getAttribute('data-step');
    if (step && typeof selectStepFromDiagram === 'function') {
      selectStepFromDiagram(step);
    }
  }
}

if (typeof window !== "undefined") {
  window.renderSvgFlowchart = renderSvgFlowchart;
  window.handleDiagramNodeClick = handleDiagramNodeClick;
  window.getChoiceRuleLabel = getChoiceRuleLabel;
  window.drawArrow = drawArrow;
  window.truncateRuleText = truncateRuleText;
  window.renderRuleLabelsSvg = renderRuleLabelsSvg;
  window.drawStraightBranchArrow = drawStraightBranchArrow;
  window.drawLoopBranchArrow = drawLoopBranchArrow;
  window.drawCurveBranchArrow = drawCurveBranchArrow;
}
