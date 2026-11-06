import { FlowDefinition, FlowState, ChoiceRule, FlowTriggerType } from './types';
import { AppError } from '../core/errors/AppError';
import { FlowPathMapper } from './utils/FlowPathMapper';

export class FlowValidator {
  public static validate(def: FlowDefinition, contextPath: string = ''): void {
    const prefix = contextPath ? `${contextPath}: ` : '';
    if (!def || typeof def !== 'object') {
      throw new AppError(`${prefix}Flow definition is required`, 400);
    }
    if (!def.startAt || typeof def.startAt !== 'string' || !def.startAt.trim()) {
      throw new AppError(`${prefix}Flow definition must specify a startAt state`, 400);
    }
    if (!def.states || typeof def.states !== 'object' || Object.keys(def.states).length === 0) {
      throw new AppError(`${prefix}Flow definition must contain at least one state in states object`, 400);
    }
    if (!def.states[def.startAt]) {
      throw new AppError(`${prefix}startAt state '${def.startAt}' does not exist in flow states`, 400);
    }

    const stateKeys = Object.keys(def.states);

    for (const [stateName, state] of Object.entries(def.states)) {
      this.validateState(stateName, state, stateKeys, contextPath);
    }
  }

  public static validateConcurrency(maxConcurrentExecutions?: any): void {
    if (maxConcurrentExecutions === undefined || maxConcurrentExecutions === null) {
      return;
    }
    if (
      typeof maxConcurrentExecutions !== 'number' ||
      !Number.isFinite(maxConcurrentExecutions) ||
      !Number.isInteger(maxConcurrentExecutions) ||
      maxConcurrentExecutions < 1
    ) {
      throw new AppError('maxConcurrentExecutions must be an integer >= 1 or null/undefined', 400);
    }
  }

  public static validateTrigger(triggerType?: string, eventTrigger?: string | null): void {
    if (triggerType !== undefined) {
      const validTriggers: FlowTriggerType[] = ['http', 'event', 'manual'];
      if (!validTriggers.includes(triggerType as FlowTriggerType)) {
        throw new AppError(
          `Invalid triggerType '${triggerType}'. Allowed values: 'http', 'event', 'manual'`,
          400
        );
      }
    }

    if (triggerType === 'event') {
      if (!eventTrigger || typeof eventTrigger !== 'string' || !eventTrigger.trim()) {
        throw new AppError("eventTrigger is required when triggerType is 'event'", 400);
      }
      this.validateEventPattern(eventTrigger.trim());
    }
  }

  public static validateEventPattern(pattern: string): void {
    if (!pattern || typeof pattern !== 'string') {
      throw new AppError('eventTrigger must be a non-empty string', 400);
    }

    const trimmed = pattern.trim();
    if (trimmed === '*' || trimmed === '*:*') {
      return;
    }

    const parts = trimmed.split(':');
    if (parts.length !== 2) {
      throw new AppError(
        `Invalid eventTrigger '${trimmed}'. Must be in '<collection>:<action>' format (e.g. 'orders:create', 'users:*', '*:delete', or '*')`,
        400
      );
    }

    const [collection, action] = parts;

    if (!collection || (!/^[a-zA-Z0-9_-]+$/.test(collection) && collection !== '*')) {
      throw new AppError(
        `Invalid collection '${collection}' in eventTrigger '${trimmed}'. Must be a valid collection name or '*'`,
        400
      );
    }

    if (action.startsWith('before')) {
      throw new AppError(
        `Invalid action '${action}' in eventTrigger '${trimmed}'. Flows execute asynchronously and only support post-commit lifecycle actions ('create', 'update', 'delete', or '*'). For pre-commit hooks, use NodeStack Functions.`,
        400
      );
    }

    const allowedActions = [
      'create',
      'update',
      'delete',
      'afterCreate',
      'afterUpdate',
      'afterDelete',
      '*',
    ];
    if (!allowedActions.includes(action)) {
      throw new AppError(
        `Invalid action '${action}' in eventTrigger '${trimmed}'. Allowed actions: 'create', 'update', 'delete', or '*'`,
        400
      );
    }
  }

  public static validateState(name: string, state: FlowState, allKeys: string[], contextPath: string = ''): void {
    const prefix = contextPath ? `${contextPath}: ` : '';
    if (!state || typeof state !== 'object') {
      throw new AppError(`${prefix}State '${name}' is invalid`, 400);
    }
    if (!state.type) {
      throw new AppError(`${prefix}State '${name}' is missing required property 'type'`, 400);
    }

    // Validate Paths
    this.validatePath(name, 'inputPath', state.inputPath, contextPath);
    this.validatePath(name, 'resultPath', state.resultPath, contextPath);
    this.validatePath(name, 'outputPath', state.outputPath, contextPath);

    // Validate transitions
    if (state.next) {
      if (typeof state.next !== 'string' || !allKeys.includes(state.next)) {
        throw new AppError(`${prefix}State '${name}': 'next' target '${state.next}' does not exist in states`, 400);
      }
      if (state.end) {
        throw new AppError(`${prefix}State '${name}' cannot specify both 'next' and 'end: true'`, 400);
      }
    }

    switch (state.type) {
      case 'Task':
        if (!state.function || typeof state.function !== 'string' || !state.function.trim()) {
          throw new AppError(`${prefix}Task state '${name}' must specify a serverless function name`, 400);
        }
        if (state.elevated !== undefined && typeof state.elevated !== 'boolean') {
          throw new AppError(`${prefix}Task state '${name}': elevated must be a boolean (true or false)`, 400);
        }
        if (state.serviceRole !== undefined && typeof state.serviceRole !== 'boolean') {
          throw new AppError(`${prefix}Task state '${name}': serviceRole must be a boolean (true or false)`, 400);
        }
        if (!state.next && !state.end) {
          throw new AppError(`${prefix}Task state '${name}' must specify either 'next' or 'end: true'`, 400);
        }
        break;

      case 'Choice':
        if (!Array.isArray(state.choices) || state.choices.length === 0) {
          throw new AppError(`${prefix}Choice state '${name}' must have at least one choice rule in 'choices'`, 400);
        }
        state.choices.forEach((choice, idx) => {
          this.validateChoiceRule(name, idx, choice, allKeys, false, `rule #${idx + 1}`, false, contextPath);
        });
        if (state.default && !allKeys.includes(state.default)) {
          throw new AppError(`${prefix}Choice state '${name}': default fallback step '${state.default}' does not exist in states`, 400);
        }
        break;

      case 'Map':
        this.validatePath(name, 'itemsPath', state.itemsPath, contextPath);
        if (!state.itemsPath || !state.itemsPath.startsWith('$')) {
          throw new AppError(`${prefix}Map state '${name}': itemsPath must be a valid JSONPath starting with '$'`, 400);
        }
        if (state.maxConcurrency !== undefined) {
          if (typeof state.maxConcurrency !== 'number' || state.maxConcurrency < 1 || !Number.isInteger(state.maxConcurrency)) {
            throw new AppError(`${prefix}Map state '${name}': maxConcurrency must be a positive integer >= 1`, 400);
          }
        }
        if (!state.iterator || typeof state.iterator !== 'object') {
          throw new AppError(`${prefix}Map state '${name}' must specify an iterator with startAt and states`, 400);
        }
        this.validate(state.iterator as FlowDefinition, `${prefix}Map state '${name}' iterator`);
        if (!state.next && !state.end) {
          throw new AppError(`${prefix}Map state '${name}' must specify either 'next' or 'end: true'`, 400);
        }
        break;

      case 'Loop':
        if (!state.target || !allKeys.includes(state.target)) {
          throw new AppError(`${prefix}Loop state '${name}': target step '${state.target}' does not exist in states`, 400);
        }
        if (state.maxIterations !== undefined) {
          if (typeof state.maxIterations !== 'number' || state.maxIterations < 1 || !Number.isInteger(state.maxIterations)) {
            throw new AppError(`${prefix}Loop state '${name}': maxIterations must be a positive integer >= 1`, 400);
          }
        }
        if (!state.condition || typeof state.condition !== 'object') {
          throw new AppError(`${prefix}Loop state '${name}' must specify a condition choice rule`, 400);
        }
        this.validateChoiceRule(name, 0, state.condition, allKeys, true, 'condition', false, contextPath);
        if (!state.next && !state.end) {
          throw new AppError(`${prefix}Loop state '${name}' must specify either 'next' or 'end: true'`, 400);
        }
        break;

      case 'Pass':
        if (!state.next && !state.end) {
          throw new AppError(`${prefix}Pass state '${name}' must specify either 'next' or 'end: true'`, 400);
        }
        break;

      case 'Wait':
        if (state.seconds !== undefined) {
          if (typeof state.seconds !== 'number' || state.seconds < 0 || isNaN(state.seconds)) {
            throw new AppError(`${prefix}Wait state '${name}': seconds must be a non-negative number`, 400);
          }
        }
        if (!state.next && !state.end) {
          throw new AppError(`${prefix}Wait state '${name}' must specify either 'next' or 'end: true'`, 400);
        }
        break;

      case 'Succeed':
      case 'Fail':
        // Terminal states must not have next or end transitions
        if (state.next) {
          delete (state as any).next;
        }
        if (state.end) {
          delete (state as any).end;
        }
        break;

      case 'Parallel':
        if (!Array.isArray(state.branches) || state.branches.length === 0) {
          throw new AppError(`${prefix}Parallel state '${name}' must have at least one branch in 'branches'`, 400);
        }
        state.branches.forEach((branch, idx) => {
          if (!branch || typeof branch !== 'object') {
            throw new AppError(`${prefix}Parallel state '${name}': branch #${idx + 1} must be an object with startAt and states`, 400);
          }
          this.validate(branch as FlowDefinition, `${prefix}Parallel state '${name}' branch #${idx + 1}`);
        });
        if (!state.next && !state.end) {
          throw new AppError(`${prefix}Parallel state '${name}' must specify either 'next' or 'end: true'`, 400);
        }
        break;

      default:
        throw new AppError(`${prefix}State '${name}' has unsupported state type '${(state as any).type}'`, 400);
    }
  }

  private static validatePath(stateName: string, propName: string, path?: string, contextPath: string = ''): void {
    const prefix = contextPath ? `${contextPath}: ` : '';
    if (path !== undefined && path !== null) {
      if (typeof path !== 'string' || (path !== '' && !path.startsWith('$'))) {
        throw new AppError(`${prefix}State '${stateName}': ${propName} must be a valid JSONPath starting with '$'`, 400);
      }
      if (FlowPathMapper.isUnsafePath(path)) {
        throw new AppError(`${prefix}State '${stateName}': ${propName} contains forbidden segments (__proto__, constructor, prototype)`, 400);
      }
    }
  }

  public static validateChoiceRule(
    stateName: string,
    idx: number,
    rule: ChoiceRule,
    allKeys: string[],
    isLoopCondition = false,
    pathPrefix = `rule #${idx + 1}`,
    isNested = false,
    contextPath: string = ''
  ): void {
    const prefix = contextPath ? `${contextPath}: ` : '';
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new AppError(`${prefix}State '${stateName}': ${pathPrefix} is invalid (must be an object)`, 400);
    }

    if (!isLoopCondition && !isNested) {
      if (!rule.next || typeof rule.next !== 'string' || !allKeys.includes(rule.next)) {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} 'next' target '${rule.next || ''}' does not exist in flow states`,
          400
        );
      }
    }

    const comparisonOps = [
      'stringEquals',
      'numericEquals',
      'numericGreaterThan',
      'numericLessThan',
      'numericGreaterThanEquals',
      'numericLessThanEquals',
      'booleanEquals',
      'isPresent',
    ];

    const hasComparisonOp = comparisonOps.some((op) => (rule as any)[op] !== undefined);
    const hasLogicalOp = rule.and !== undefined || rule.or !== undefined || rule.not !== undefined;

    if (!hasComparisonOp && !hasLogicalOp) {
      throw new AppError(
        `${prefix}State '${stateName}': ${pathPrefix} must specify at least one comparison operator or logical operator (and/or/not)`,
        400
      );
    }

    if (hasComparisonOp) {
      if (!rule.variable || typeof rule.variable !== 'string' || !rule.variable.startsWith('$')) {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} variable must be a valid JSONPath starting with '$' (e.g. $.status)`,
          400
        );
      }
    } else if (rule.variable !== undefined) {
      if (typeof rule.variable !== 'string' || !rule.variable.startsWith('$')) {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} variable must be a valid JSONPath starting with '$' (e.g. $.status)`,
          400
        );
      }
    }

    if (rule.variable && FlowPathMapper.isUnsafePath(rule.variable)) {
      throw new AppError(
        `${prefix}State '${stateName}': ${pathPrefix} variable contains forbidden segments (__proto__, constructor, prototype)`,
        400
      );
    }

    // Strict type checks for condition operators
    if (rule.numericGreaterThan !== undefined) {
      if (typeof rule.numericGreaterThan !== 'number' || !Number.isFinite(rule.numericGreaterThan)) {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} numericGreaterThan must be a finite number, received: ${JSON.stringify(rule.numericGreaterThan)}`,
          400
        );
      }
    }
    if (rule.numericLessThan !== undefined) {
      if (typeof rule.numericLessThan !== 'number' || !Number.isFinite(rule.numericLessThan)) {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} numericLessThan must be a finite number, received: ${JSON.stringify(rule.numericLessThan)}`,
          400
        );
      }
    }
    if (rule.numericEquals !== undefined) {
      if (typeof rule.numericEquals !== 'number' || !Number.isFinite(rule.numericEquals)) {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} numericEquals must be a finite number, received: ${JSON.stringify(rule.numericEquals)}`,
          400
        );
      }
    }
    if (rule.numericGreaterThanEquals !== undefined) {
      if (typeof rule.numericGreaterThanEquals !== 'number' || !Number.isFinite(rule.numericGreaterThanEquals)) {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} numericGreaterThanEquals must be a finite number, received: ${JSON.stringify(rule.numericGreaterThanEquals)}`,
          400
        );
      }
    }
    if (rule.numericLessThanEquals !== undefined) {
      if (typeof rule.numericLessThanEquals !== 'number' || !Number.isFinite(rule.numericLessThanEquals)) {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} numericLessThanEquals must be a finite number, received: ${JSON.stringify(rule.numericLessThanEquals)}`,
          400
        );
      }
    }
    if (rule.booleanEquals !== undefined) {
      if (typeof rule.booleanEquals !== 'boolean') {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} booleanEquals must be a boolean (true or false), received: ${JSON.stringify(rule.booleanEquals)}`,
          400
        );
      }
    }
    if (rule.isPresent !== undefined) {
      if (typeof rule.isPresent !== 'boolean') {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} isPresent must be a boolean (true or false), received: ${JSON.stringify(rule.isPresent)}`,
          400
        );
      }
    }
    if (rule.stringEquals !== undefined) {
      if (typeof rule.stringEquals !== 'string') {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} stringEquals must be a string, received: ${JSON.stringify(rule.stringEquals)}`,
          400
        );
      }
    }

    // Validate nested logical rules
    if (rule.and !== undefined) {
      if (!Array.isArray(rule.and) || rule.and.length === 0) {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} 'and' must be a non-empty array of choice rules`,
          400
        );
      }
      rule.and.forEach((subRule, subIdx) => {
        this.validateChoiceRule(stateName, subIdx, subRule, allKeys, isLoopCondition, `${pathPrefix}.and[${subIdx}]`, true, contextPath);
      });
    }

    if (rule.or !== undefined) {
      if (!Array.isArray(rule.or) || rule.or.length === 0) {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} 'or' must be a non-empty array of choice rules`,
          400
        );
      }
      rule.or.forEach((subRule, subIdx) => {
        this.validateChoiceRule(stateName, subIdx, subRule, allKeys, isLoopCondition, `${pathPrefix}.or[${subIdx}]`, true, contextPath);
      });
    }

    if (rule.not !== undefined) {
      if (!rule.not || typeof rule.not !== 'object' || Array.isArray(rule.not)) {
        throw new AppError(
          `${prefix}State '${stateName}': ${pathPrefix} 'not' must be a valid choice rule object`,
          400
        );
      }
      this.validateChoiceRule(stateName, 0, rule.not, allKeys, isLoopCondition, `${pathPrefix}.not`, true, contextPath);
    }
  }

  /**
   * Recursively extracts all function names/identifiers referenced in a flow definition
   * (e.g. from top-level Task states, Map iterator states, Parallel branches, etc.)
   */
  public static extractReferencedFunctions(
    defOrStates: FlowDefinition | Record<string, FlowState> | null | undefined
  ): Set<string> {
    const referenced = new Set<string>();
    if (!defOrStates || typeof defOrStates !== 'object') {
      return referenced;
    }

    const states: Record<string, FlowState> =
      (defOrStates as FlowDefinition).states || (defOrStates as Record<string, FlowState>);
    if (!states || typeof states !== 'object') {
      return referenced;
    }

    function scanStates(stateRecord: Record<string, any>) {
      if (!stateRecord || typeof stateRecord !== 'object') return;
      for (const state of Object.values(stateRecord)) {
        if (!state || typeof state !== 'object') continue;
        if (state.type === 'Task' && typeof state.function === 'string' && state.function.trim()) {
          referenced.add(state.function.trim());
        } else if (state.type === 'Map' && state.iterator && typeof state.iterator === 'object' && state.iterator.states) {
          scanStates(state.iterator.states);
        } else if (state.type === 'Parallel' && Array.isArray(state.branches)) {
          for (const branch of state.branches) {
            if (branch && typeof branch === 'object' && branch.states) {
              scanStates(branch.states);
            }
          }
        }
      }
    }

    scanStates(states);
    return referenced;
  }
  /**
   * Recursively renames all references to a function in a flow definition
   */
  public static renameReferencedFunction(
    defOrStates: FlowDefinition | Record<string, FlowState> | null | undefined,
    oldName: string,
    newName: string
  ): boolean {
    if (!defOrStates || typeof defOrStates !== 'object') {
      return false;
    }

    const states: Record<string, FlowState> =
      (defOrStates as FlowDefinition).states || (defOrStates as Record<string, FlowState>);
    if (!states || typeof states !== 'object') {
      return false;
    }

    let modified = false;

    function mutateStates(stateRecord: Record<string, any>) {
      if (!stateRecord || typeof stateRecord !== 'object') return;
      for (const state of Object.values(stateRecord)) {
        if (!state || typeof state !== 'object') continue;
        if (state.type === 'Task' && state.function === oldName) {
          state.function = newName;
          modified = true;
        } else if (state.type === 'Map' && state.iterator && typeof state.iterator === 'object' && state.iterator.states) {
          mutateStates(state.iterator.states);
        } else if (state.type === 'Parallel' && Array.isArray(state.branches)) {
          for (const branch of state.branches) {
            if (branch && typeof branch === 'object' && branch.states) {
              mutateStates(branch.states);
            }
          }
        }
      }
    }

    mutateStates(states);
    return modified;
  }
}
