import { FlowDefinition, FlowState, ChoiceRule } from './types';
import { AppError } from '../core/errors/AppError';

export class FlowValidator {
  public static validate(def: FlowDefinition): void {
    if (!def) {
      throw new AppError('Flow definition is required', 400);
    }
    if (!def.startAt || typeof def.startAt !== 'string' || !def.startAt.trim()) {
      throw new AppError('Flow definition must specify a startAt state', 400);
    }
    if (!def.states || typeof def.states !== 'object' || Object.keys(def.states).length === 0) {
      throw new AppError('Flow definition must contain at least one state in states object', 400);
    }
    if (!def.states[def.startAt]) {
      throw new AppError(`startAt state '${def.startAt}' does not exist in flow states`, 400);
    }

    const stateKeys = Object.keys(def.states);

    for (const [stateName, state] of Object.entries(def.states)) {
      this.validateState(stateName, state, stateKeys);
    }
  }

  public static validateState(name: string, state: FlowState, allKeys: string[]): void {
    if (!state || typeof state !== 'object') {
      throw new AppError(`State '${name}' is invalid`, 400);
    }
    if (!state.type) {
      throw new AppError(`State '${name}' is missing required property 'type'`, 400);
    }

    // Validate Paths
    this.validatePath(name, 'inputPath', state.inputPath);
    this.validatePath(name, 'resultPath', state.resultPath);
    this.validatePath(name, 'outputPath', state.outputPath);

    // Validate transitions
    if (state.next) {
      if (typeof state.next !== 'string' || !allKeys.includes(state.next)) {
        throw new AppError(`State '${name}': 'next' target '${state.next}' does not exist in states`, 400);
      }
      if (state.end) {
        throw new AppError(`State '${name}' cannot specify both 'next' and 'end: true'`, 400);
      }
    }

    switch (state.type) {
      case 'Task':
        if (!state.function || typeof state.function !== 'string' || !state.function.trim()) {
          throw new AppError(`Task state '${name}' must specify a serverless function name`, 400);
        }
        if (state.elevated !== undefined && typeof state.elevated !== 'boolean') {
          throw new AppError(`Task state '${name}': elevated must be a boolean (true or false)`, 400);
        }
        if (state.serviceRole !== undefined && typeof state.serviceRole !== 'boolean') {
          throw new AppError(`Task state '${name}': serviceRole must be a boolean (true or false)`, 400);
        }
        if (!state.next && !state.end) {
          throw new AppError(`Task state '${name}' must specify either 'next' or 'end: true'`, 400);
        }
        break;

      case 'Choice':
        if (!Array.isArray(state.choices) || state.choices.length === 0) {
          throw new AppError(`Choice state '${name}' must have at least one choice rule in 'choices'`, 400);
        }
        state.choices.forEach((choice, idx) => {
          this.validateChoiceRule(name, idx, choice, allKeys);
        });
        if (state.default && !allKeys.includes(state.default)) {
          throw new AppError(`Choice state '${name}': default fallback step '${state.default}' does not exist in states`, 400);
        }
        break;

      case 'Map':
        if (!state.itemsPath || !state.itemsPath.startsWith('$')) {
          throw new AppError(`Map state '${name}': itemsPath must be a valid JSONPath starting with '$'`, 400);
        }
        if (state.maxConcurrency !== undefined) {
          if (typeof state.maxConcurrency !== 'number' || state.maxConcurrency < 1 || !Number.isInteger(state.maxConcurrency)) {
            throw new AppError(`Map state '${name}': maxConcurrency must be a positive integer >= 1`, 400);
          }
        }
        if (!state.iterator || !state.iterator.startAt || !state.iterator.states) {
          throw new AppError(`Map state '${name}' must specify an iterator with startAt and states`, 400);
        }
        break;

      case 'Loop':
        if (!state.target || !allKeys.includes(state.target)) {
          throw new AppError(`Loop state '${name}': target step '${state.target}' does not exist in states`, 400);
        }
        if (state.maxIterations !== undefined) {
          if (typeof state.maxIterations !== 'number' || state.maxIterations < 1 || !Number.isInteger(state.maxIterations)) {
            throw new AppError(`Loop state '${name}': maxIterations must be a positive integer >= 1`, 400);
          }
        }
        if (state.condition) {
          this.validateChoiceRule(name, 0, state.condition, allKeys, true);
        }
        break;

      case 'Pass':
        if (!state.next && !state.end) {
          throw new AppError(`Pass state '${name}' must specify either 'next' or 'end: true'`, 400);
        }
        break;

      case 'Wait':
        if (state.seconds !== undefined) {
          if (typeof state.seconds !== 'number' || state.seconds < 0 || isNaN(state.seconds)) {
            throw new AppError(`Wait state '${name}': seconds must be a non-negative number`, 400);
          }
        }
        if (!state.next && !state.end) {
          throw new AppError(`Wait state '${name}' must specify either 'next' or 'end: true'`, 400);
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
          throw new AppError(`Parallel state '${name}' must have at least one branch in 'branches'`, 400);
        }
        break;

      default:
        throw new AppError(`State '${name}' has unsupported state type '${(state as any).type}'`, 400);
    }
  }

  private static validatePath(stateName: string, propName: string, path?: string): void {
    if (path !== undefined && path !== null) {
      if (typeof path !== 'string' || (path !== '' && !path.startsWith('$'))) {
        throw new AppError(`State '${stateName}': ${propName} must be a valid JSONPath starting with '$'`, 400);
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
    isNested = false
  ): void {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new AppError(`State '${stateName}': ${pathPrefix} is invalid (must be an object)`, 400);
    }

    if (!isLoopCondition && !isNested) {
      if (!rule.next || typeof rule.next !== 'string' || !allKeys.includes(rule.next)) {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} 'next' target '${rule.next || ''}' does not exist in flow states`,
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
        `State '${stateName}': ${pathPrefix} must specify at least one comparison operator or logical operator (and/or/not)`,
        400
      );
    }

    if (hasComparisonOp) {
      if (!rule.variable || typeof rule.variable !== 'string' || !rule.variable.startsWith('$')) {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} variable must be a valid JSONPath starting with '$' (e.g. $.status)`,
          400
        );
      }
    } else if (rule.variable !== undefined) {
      if (typeof rule.variable !== 'string' || !rule.variable.startsWith('$')) {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} variable must be a valid JSONPath starting with '$' (e.g. $.status)`,
          400
        );
      }
    }

    // Strict type checks for condition operators
    if (rule.numericGreaterThan !== undefined) {
      if (typeof rule.numericGreaterThan !== 'number' || !Number.isFinite(rule.numericGreaterThan)) {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} numericGreaterThan must be a finite number, received: ${JSON.stringify(rule.numericGreaterThan)}`,
          400
        );
      }
    }
    if (rule.numericLessThan !== undefined) {
      if (typeof rule.numericLessThan !== 'number' || !Number.isFinite(rule.numericLessThan)) {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} numericLessThan must be a finite number, received: ${JSON.stringify(rule.numericLessThan)}`,
          400
        );
      }
    }
    if (rule.numericEquals !== undefined) {
      if (typeof rule.numericEquals !== 'number' || !Number.isFinite(rule.numericEquals)) {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} numericEquals must be a finite number, received: ${JSON.stringify(rule.numericEquals)}`,
          400
        );
      }
    }
    if (rule.numericGreaterThanEquals !== undefined) {
      if (typeof rule.numericGreaterThanEquals !== 'number' || !Number.isFinite(rule.numericGreaterThanEquals)) {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} numericGreaterThanEquals must be a finite number, received: ${JSON.stringify(rule.numericGreaterThanEquals)}`,
          400
        );
      }
    }
    if (rule.numericLessThanEquals !== undefined) {
      if (typeof rule.numericLessThanEquals !== 'number' || !Number.isFinite(rule.numericLessThanEquals)) {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} numericLessThanEquals must be a finite number, received: ${JSON.stringify(rule.numericLessThanEquals)}`,
          400
        );
      }
    }
    if (rule.booleanEquals !== undefined) {
      if (typeof rule.booleanEquals !== 'boolean') {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} booleanEquals must be a boolean (true or false), received: ${JSON.stringify(rule.booleanEquals)}`,
          400
        );
      }
    }
    if (rule.isPresent !== undefined) {
      if (typeof rule.isPresent !== 'boolean') {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} isPresent must be a boolean (true or false), received: ${JSON.stringify(rule.isPresent)}`,
          400
        );
      }
    }
    if (rule.stringEquals !== undefined) {
      if (typeof rule.stringEquals !== 'string') {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} stringEquals must be a string, received: ${JSON.stringify(rule.stringEquals)}`,
          400
        );
      }
    }

    // Validate nested logical rules
    if (rule.and !== undefined) {
      if (!Array.isArray(rule.and) || rule.and.length === 0) {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} 'and' must be a non-empty array of choice rules`,
          400
        );
      }
      rule.and.forEach((subRule, subIdx) => {
        this.validateChoiceRule(stateName, subIdx, subRule, allKeys, isLoopCondition, `${pathPrefix}.and[${subIdx}]`, true);
      });
    }

    if (rule.or !== undefined) {
      if (!Array.isArray(rule.or) || rule.or.length === 0) {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} 'or' must be a non-empty array of choice rules`,
          400
        );
      }
      rule.or.forEach((subRule, subIdx) => {
        this.validateChoiceRule(stateName, subIdx, subRule, allKeys, isLoopCondition, `${pathPrefix}.or[${subIdx}]`, true);
      });
    }

    if (rule.not !== undefined) {
      if (!rule.not || typeof rule.not !== 'object' || Array.isArray(rule.not)) {
        throw new AppError(
          `State '${stateName}': ${pathPrefix} 'not' must be a valid choice rule object`,
          400
        );
      }
      this.validateChoiceRule(stateName, 0, rule.not, allKeys, isLoopCondition, `${pathPrefix}.not`, true);
    }
  }
}
