import { ChoiceRule } from '../types';
import { FlowPathMapper } from '../utils/FlowPathMapper';

export class ChoiceEvaluator {
  public static evaluate(rule: ChoiceRule, payload: any): boolean {
    if (!rule || typeof rule !== 'object') {
      return false;
    }

    let evaluatedAny = false;
    const val = rule.variable ? FlowPathMapper.get(payload, rule.variable) : undefined;

    if (rule.isPresent !== undefined) {
      evaluatedAny = true;
      const present = val !== undefined && val !== null;
      if (present !== rule.isPresent) {
        return false;
      }
    }

    if (rule.stringEquals !== undefined) {
      evaluatedAny = true;
      if (val === undefined || val === null || String(val) !== rule.stringEquals) {
        return false;
      }
    }

    if (rule.numericEquals !== undefined) {
      evaluatedAny = true;
      const numVal = typeof val === 'number' ? val : Number(val);
      if (val === undefined || val === null || isNaN(numVal) || isNaN(rule.numericEquals) || numVal !== rule.numericEquals) {
        return false;
      }
    }

    if (rule.numericGreaterThan !== undefined) {
      evaluatedAny = true;
      const numVal = typeof val === 'number' ? val : Number(val);
      if (val === undefined || val === null || isNaN(numVal) || isNaN(rule.numericGreaterThan) || !(numVal > rule.numericGreaterThan)) {
        return false;
      }
    }

    if (rule.numericLessThan !== undefined) {
      evaluatedAny = true;
      const numVal = typeof val === 'number' ? val : Number(val);
      if (val === undefined || val === null || isNaN(numVal) || isNaN(rule.numericLessThan) || !(numVal < rule.numericLessThan)) {
        return false;
      }
    }

    if (rule.numericGreaterThanEquals !== undefined) {
      evaluatedAny = true;
      const numVal = typeof val === 'number' ? val : Number(val);
      if (val === undefined || val === null || isNaN(numVal) || isNaN(rule.numericGreaterThanEquals) || !(numVal >= rule.numericGreaterThanEquals)) {
        return false;
      }
    }

    if (rule.numericLessThanEquals !== undefined) {
      evaluatedAny = true;
      const numVal = typeof val === 'number' ? val : Number(val);
      if (val === undefined || val === null || isNaN(numVal) || isNaN(rule.numericLessThanEquals) || !(numVal <= rule.numericLessThanEquals)) {
        return false;
      }
    }

    if (rule.booleanEquals !== undefined) {
      evaluatedAny = true;
      const boolVal = typeof val === 'boolean' ? val : (val === 'true' ? true : (val === 'false' ? false : (val === undefined || val === null ? undefined : Boolean(val))));
      if (boolVal !== rule.booleanEquals) {
        return false;
      }
    }

    if (rule.and !== undefined) {
      evaluatedAny = true;
      if (!Array.isArray(rule.and) || rule.and.length === 0) {
        return false;
      }
      const allMatch = rule.and.every((subRule) => this.evaluate(subRule, payload));
      if (!allMatch) {
        return false;
      }
    }

    if (rule.or !== undefined) {
      evaluatedAny = true;
      if (!Array.isArray(rule.or) || rule.or.length === 0) {
        return false;
      }
      const anyMatch = rule.or.some((subRule) => this.evaluate(subRule, payload));
      if (!anyMatch) {
        return false;
      }
    }

    if (rule.not !== undefined) {
      evaluatedAny = true;
      if (!rule.not || typeof rule.not !== 'object' || this.evaluate(rule.not, payload)) {
        return false;
      }
    }

    if (!evaluatedAny) {
      return false;
    }

    return true;
  }

  public static findNextState(choices: ChoiceRule[], defaultBranch: string | undefined, payload: any): string | undefined {
    for (const choice of choices) {
      if (this.evaluate(choice, payload)) {
        return choice.next;
      }
    }
    return defaultBranch;
  }
}
