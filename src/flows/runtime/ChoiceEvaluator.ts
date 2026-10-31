import { ChoiceRule } from '../types';
import { FlowPathMapper } from '../utils/FlowPathMapper';

export class ChoiceEvaluator {
  public static evaluate(rule: ChoiceRule, payload: any): boolean {
    const val = FlowPathMapper.get(payload, rule.variable);

    if (rule.isPresent !== undefined) {
      const present = val !== undefined && val !== null;
      if (present !== rule.isPresent) {
        return false;
      }
    }

    if (rule.stringEquals !== undefined && String(val) !== rule.stringEquals) {
      return false;
    }

    if (rule.numericEquals !== undefined) {
      const numVal = typeof val === 'number' ? val : Number(val);
      if (isNaN(numVal) || isNaN(rule.numericEquals) || numVal !== rule.numericEquals) {
        return false;
      }
    }

    if (rule.numericGreaterThan !== undefined) {
      const numVal = typeof val === 'number' ? val : Number(val);
      if (isNaN(numVal) || isNaN(rule.numericGreaterThan) || !(numVal > rule.numericGreaterThan)) {
        return false;
      }
    }

    if (rule.numericLessThan !== undefined) {
      const numVal = typeof val === 'number' ? val : Number(val);
      if (isNaN(numVal) || isNaN(rule.numericLessThan) || !(numVal < rule.numericLessThan)) {
        return false;
      }
    }

    if (rule.numericGreaterThanEquals !== undefined) {
      const numVal = typeof val === 'number' ? val : Number(val);
      if (isNaN(numVal) || isNaN(rule.numericGreaterThanEquals) || !(numVal >= rule.numericGreaterThanEquals)) {
        return false;
      }
    }

    if (rule.numericLessThanEquals !== undefined) {
      const numVal = typeof val === 'number' ? val : Number(val);
      if (isNaN(numVal) || isNaN(rule.numericLessThanEquals) || !(numVal <= rule.numericLessThanEquals)) {
        return false;
      }
    }

    if (rule.booleanEquals !== undefined) {
      const boolVal = typeof val === 'boolean' ? val : (val === 'true' ? true : (val === 'false' ? false : Boolean(val)));
      if (boolVal !== rule.booleanEquals) {
        return false;
      }
    }

    if (rule.and && rule.and.length > 0) {
      const allMatch = rule.and.every((subRule) => this.evaluate(subRule, payload));
      if (!allMatch) {
        return false;
      }
    }

    if (rule.or && rule.or.length > 0) {
      const anyMatch = rule.or.some((subRule) => this.evaluate(subRule, payload));
      if (!anyMatch) {
        return false;
      }
    }

    if (rule.not) {
      if (this.evaluate(rule.not, payload)) {
        return false;
      }
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
