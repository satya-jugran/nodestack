export interface ParsedFilter {
  clause: string;
  params: any[];
}

export interface ParsedSort {
  field: string;
  direction: 'ASC' | 'DESC';
}

export class QueryFilterParser {
  /**
   * Parses a sort string like "-created,title,+views" into SQL ORDER BY
   */
  public static parseSort(sortStr?: string, allowedFields?: Set<string>): string {
    if (!sortStr || !sortStr.trim()) {
      return 'ORDER BY created DESC';
    }

    const parts = sortStr.split(',').map((s) => s.trim()).filter(Boolean);
    const orderClauses: string[] = [];

    for (const part of parts) {
      let direction: 'ASC' | 'DESC' = 'ASC';
      let field = part;

      if (part.startsWith('-')) {
        direction = 'DESC';
        field = part.substring(1).trim();
      } else if (part.startsWith('+')) {
        direction = 'ASC';
        field = part.substring(1).trim();
      }

      // Sanitize field name: only alphanumeric and underscores allowed
      if (/^[a-zA-Z0-9_]+$/.test(field)) {
        if (!allowedFields || allowedFields.has(field) || ['id', 'created', 'updated'].includes(field)) {
          orderClauses.push(`"${field}" ${direction}`);
        }
      }
    }

    return orderClauses.length > 0 ? `ORDER BY ${orderClauses.join(', ')}` : 'ORDER BY created DESC';
  }

  /**
   * Safely converts filter string into a parameterized SQL WHERE clause
   * Example: status = 'active' && age >= 18 -> ("status" = ? AND "age" >= ?), params: ['active', 18]
   */
  public static parseFilter(filterStr?: string, allowedFields?: Set<string>): ParsedFilter {
    if (!filterStr || !filterStr.trim()) {
      return { clause: '', params: [] };
    }

    const trimmed = filterStr.trim();
    const params: any[] = [];

    const parsedSql = this.convertFilterExpression(trimmed, params, allowedFields);
    return {
      clause: parsedSql ? `WHERE ${parsedSql}` : '',
      params,
    };
  }

  private static convertFilterExpression(
    expr: string,
    params: any[],
    allowedFields?: Set<string>
  ): string {
    // 1. Split top-level ||
    const orParts = this.splitTopLevel(expr, '||');
    if (orParts.length > 1) {
      const sqlParts = orParts
        .map((p) => this.convertFilterExpression(p.trim(), params, allowedFields))
        .filter(Boolean);
      return sqlParts.length ? `(${sqlParts.join(' OR ')})` : '';
    }

    // 2. Split top-level &&
    const andParts = this.splitTopLevel(expr, '&&');
    if (andParts.length > 1) {
      const sqlParts = andParts
        .map((p) => this.convertFilterExpression(p.trim(), params, allowedFields))
        .filter(Boolean);
      return sqlParts.length ? `(${sqlParts.join(' AND ')})` : '';
    }

    // 3. Parentheses unwrapping
    const trimmed = expr.trim();
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      if (this.isFullyEnclosed(trimmed)) {
        return `(${this.convertFilterExpression(trimmed.slice(1, -1).trim(), params, allowedFields)})`;
      }
    }

    // 4. Comparison parsing
    return this.parseSingleComparison(trimmed, params, allowedFields);
  }

  private static parseSingleComparison(
    str: string,
    params: any[],
    allowedFields?: Set<string>
  ): string {
    const operators = ['!=', '>=', '<=', '=', '>', '<', '!~', '~'];

    for (const op of operators) {
      const idx = this.findOperatorIndex(str, op);
      if (idx !== -1) {
        const fieldName = str.substring(0, idx).trim();
        const valueRaw = str.substring(idx + op.length).trim();

        // Validate field name to prevent SQL injection
        if (!/^[a-zA-Z0-9_]+$/.test(fieldName)) {
          return '';
        }

        if (allowedFields && !allowedFields.has(fieldName) && !['id', 'created', 'updated'].includes(fieldName)) {
          return '';
        }

        const value = this.extractLiteralValue(valueRaw);

        switch (op) {
          case '=':
            if (value === null) return `"${fieldName}" IS NULL`;
            params.push(value);
            return `"${fieldName}" = ?`;
          case '!=':
            if (value === null) return `"${fieldName}" IS NOT NULL`;
            params.push(value);
            return `"${fieldName}" != ?`;
          case '>':
            params.push(value);
            return `"${fieldName}" > ?`;
          case '>=':
            params.push(value);
            return `"${fieldName}" >= ?`;
          case '<':
            params.push(value);
            return `"${fieldName}" < ?`;
          case '<=':
            params.push(value);
            return `"${fieldName}" <= ?`;
          case '~':
            params.push(`%${value}%`);
            return `"${fieldName}" LIKE ?`;
          case '!~':
            params.push(`%${value}%`);
            return `"${fieldName}" NOT LIKE ?`;
        }
      }
    }

    return '';
  }

  private static extractLiteralValue(valStr: string): any {
    const trimmed = valStr.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    if (trimmed.toLowerCase() === 'true') return 1;
    if (trimmed.toLowerCase() === 'false') return 0;
    if (trimmed.toLowerCase() === 'null') return null;
    if (!isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed);
    return trimmed;
  }

  private static splitTopLevel(str: string, delimiter: string): string[] {
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

  private static findOperatorIndex(str: string, op: string): number {
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
          if (op === '=' && (str[i - 1] === '!' || str[i - 1] === '<' || str[i - 1] === '>')) {
            continue;
          }
          if (op === '~' && str[i - 1] === '!') {
            continue;
          }
          return i;
        }
      }
    }
    return -1;
  }

  private static isFullyEnclosed(str: string): boolean {
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') depth--;
      if (depth === 0 && i < str.length - 1) return false;
    }
    return depth === 0;
  }
}
