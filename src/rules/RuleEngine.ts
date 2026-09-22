export interface RuleEvaluationContext {
  auth?: {
    id: string;
    email?: string;
    isAdmin?: boolean;
    [key: string]: any;
  } | null;
  record?: Record<string, any>;
  data?: Record<string, any>;
  query?: Record<string, any>;
}

export class RuleEngine {
  /**
   * Evaluate an access rule against a given context.
   * - If context.auth?.isAdmin is true, always returns true.
   * - If rule is null: only admin allowed (returns false if not admin).
   * - If rule is "": publicly accessible (returns true).
   * - Otherwise: parse and evaluate the rule expression.
   */
  public evaluate(rule: string | null | undefined, context: RuleEvaluationContext): boolean {
    if (context.auth?.isAdmin) {
      return true;
    }

    if (rule === null || rule === undefined) {
      return false;
    }

    const trimmed = rule.trim();
    if (trimmed === '') {
      return true;
    }

    try {
      return this.evaluateExpression(trimmed, context);
    } catch (e) {
      console.warn(`[RuleEngine] Evaluation error for rule "${rule}":`, e);
      return false;
    }
  }

  private evaluateExpression(expr: string, context: RuleEvaluationContext): boolean {
    // 1. Split by '||' (logical OR) taking into account parenthesis depth
    const orParts = this.splitTopLevel(expr, '||');
    if (orParts.length > 1) {
      return orParts.some((part) => this.evaluateExpression(part.trim(), context));
    }

    // 2. Split by '&&' (logical AND)
    const andParts = this.splitTopLevel(expr, '&&');
    if (andParts.length > 1) {
      return andParts.every((part) => this.evaluateExpression(part.trim(), context));
    }

    // 3. Remove outer parentheses if present
    const trimmed = expr.trim();
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      if (this.isFullyEnclosed(trimmed)) {
        return this.evaluateExpression(trimmed.slice(1, -1).trim(), context);
      }
    }

    // 4. Comparison evaluation
    return this.evaluateComparison(trimmed, context);
  }

  private evaluateComparison(comparisonStr: string, context: RuleEvaluationContext): boolean {
    // Supported operators in order of precedence
    const operators = ['!=', '==', '>=', '<=', '=', '>', '<', '~'];

    for (const op of operators) {
      const idx = this.findOperatorIndex(comparisonStr, op);
      if (idx !== -1) {
        const leftExpr = comparisonStr.substring(0, idx).trim();
        const rightExpr = comparisonStr.substring(idx + op.length).trim();

        const leftVal = this.resolveValue(leftExpr, context);
        const rightVal = this.resolveValue(rightExpr, context);

        switch (op) {
          case '=':
          case '==':
            // eslint-disable-next-line eqeqeq
            return String(leftVal ?? '') == String(rightVal ?? '');
          case '!=':
            // eslint-disable-next-line eqeqeq
            return String(leftVal ?? '') != String(rightVal ?? '');
          case '>':
            return Number(leftVal) > Number(rightVal);
          case '>=':
            return Number(leftVal) >= Number(rightVal);
          case '<':
            return Number(leftVal) < Number(rightVal);
          case '<=':
            return Number(leftVal) <= Number(rightVal);
          case '~':
            return String(leftVal ?? '').toLowerCase().includes(String(rightVal ?? '').toLowerCase());
        }
      }
    }

    // If single boolean or identifier check
    const singleVal = this.resolveValue(comparisonStr, context);
    return Boolean(singleVal);
  }

  private resolveValue(token: string, context: RuleEvaluationContext): any {
    const trimmed = token.trim();

    // String literal in quotes
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }

    // Numbers
    if (!isNaN(Number(trimmed)) && trimmed !== '') {
      return Number(trimmed);
    }

    // Booleans / null
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
    if (trimmed.toLowerCase() === 'null') return null;

    // Path resolution: @request.auth.id, @request.data.title, status, etc.
    if (trimmed.startsWith('@request.auth.')) {
      const prop = trimmed.replace('@request.auth.', '');
      return context.auth ? (context.auth as any)[prop] : undefined;
    }
    if (trimmed.startsWith('@request.data.')) {
      const prop = trimmed.replace('@request.data.', '');
      return context.data ? (context.data as any)[prop] : undefined;
    }
    if (trimmed.startsWith('@request.query.')) {
      const prop = trimmed.replace('@request.query.', '');
      return context.query ? (context.query as any)[prop] : undefined;
    }

    // Field on current record
    if (context.record && Object.prototype.hasOwnProperty.call(context.record, trimmed)) {
      return context.record[trimmed];
    }

    return undefined;
  }

  private splitTopLevel(str: string, delimiter: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < str.length; i++) {
      const char = str[i];

      if ((char === '"' || char === "'") && (i === 0 || str[i - 1] !== '\\')) {
        if (!inQuote) {
          inQuote = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuote = false;
        }
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

  private findOperatorIndex(str: string, op: string): number {
    let depth = 0;
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < str.length; i++) {
      const char = str[i];

      if ((char === '"' || char === "'") && (i === 0 || str[i - 1] !== '\\')) {
        if (!inQuote) {
          inQuote = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuote = false;
        }
      }

      if (!inQuote) {
        if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (depth === 0 && str.startsWith(op, i)) {
          // ensure not part of bigger operator (e.g. '=' inside '!=')
          if (op === '=' && (str[i - 1] === '!' || str[i - 1] === '<' || str[i - 1] === '>')) {
            continue;
          }
          return i;
        }
      }
    }
    return -1;
  }

  private isFullyEnclosed(str: string): boolean {
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') depth--;
      if (depth === 0 && i < str.length - 1) return false;
    }
    return depth === 0;
  }
}
