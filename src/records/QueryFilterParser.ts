import { FilterCodec } from './FilterCodec';
import { ISqlDialect } from '../database/dialects/ISqlDialect';
import { SqliteDialect } from '../database/dialects/SqliteDialect';
import { AppError } from '../core/errors/AppError';

const defaultDialect = new SqliteDialect();

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
   * Encodes a string value into a filter literal with quotes and escaping.
   */
  public static encodeFilterString(val: string): string {
    return FilterCodec.encode(val);
  }

  /**
   * Decodes a filter string literal, unescaping backslash-escaped characters.
   */
  public static decodeFilterString(valStr: string): string {
    return FilterCodec.decode(valStr);
  }

  /**
   * Parses a sort string like "-created,title,+views" into SQL ORDER BY
   */
  public static parseSort(
    sortStr?: string,
    allowedFields?: Set<string>,
    tablePrefix?: string,
    dialect: ISqlDialect = defaultDialect
  ): string {
    const defaultPrefix = tablePrefix ? `${dialect.quoteIdentifier(tablePrefix)}.` : '';
    if (!sortStr || !sortStr.trim()) {
      return tablePrefix
        ? `ORDER BY ${defaultPrefix}${dialect.quoteIdentifier('created')} DESC`
        : 'ORDER BY created DESC';
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
          orderClauses.push(`${defaultPrefix}${dialect.quoteIdentifier(field)} ${direction}`);
        }
      }
    }

    return orderClauses.length > 0
      ? `ORDER BY ${orderClauses.join(', ')}`
      : (tablePrefix ? `ORDER BY ${defaultPrefix}${dialect.quoteIdentifier('created')} DESC` : 'ORDER BY created DESC');
  }

  /**
   * Safely converts filter string into a parameterized SQL WHERE clause
   * Example: status = 'active' && age >= 18 -> ("status" = ? AND "age" >= ?), params: ['active', 18]
   */
  public static parseFilter(
    filterStr?: string,
    allowedFields?: Set<string>,
    tablePrefix?: string,
    dialect: ISqlDialect = defaultDialect
  ): ParsedFilter {
    if (!filterStr || !filterStr.trim()) {
      return { clause: '', params: [] };
    }

    const trimmed = filterStr.trim();
    const params: any[] = [];

    const parsedSql = this.convertFilterExpression(trimmed, params, allowedFields, tablePrefix, dialect);
    return {
      clause: parsedSql ? `WHERE ${parsedSql}` : '',
      params,
    };
  }

  private static convertFilterExpression(
    expr: string,
    params: any[],
    allowedFields?: Set<string>,
    tablePrefix?: string,
    dialect: ISqlDialect = defaultDialect
  ): string {
    // 1. Split top-level ||
    const orParts = this.splitTopLevel(expr, '||');
    if (orParts.length > 1) {
      const sqlParts: string[] = [];
      for (const p of orParts) {
        const sub = p.trim();
        if (!sub) {
          throw new AppError(`Empty operand in '||' expression in filter: "${expr}"`, 400);
        }
        const res = this.convertFilterExpression(sub, params, allowedFields, tablePrefix, dialect);
        if (res) {
          sqlParts.push(res);
        }
      }
      return sqlParts.length > 1 ? `(${sqlParts.join(' OR ')})` : (sqlParts[0] || '');
    }

    // 2. Split top-level &&
    const andParts = this.splitTopLevel(expr, '&&');
    if (andParts.length > 1) {
      const sqlParts: string[] = [];
      for (const p of andParts) {
        const sub = p.trim();
        if (!sub) {
          throw new AppError(`Empty operand in '&&' expression in filter: "${expr}"`, 400);
        }
        const res = this.convertFilterExpression(sub, params, allowedFields, tablePrefix, dialect);
        if (res) {
          sqlParts.push(res);
        }
      }
      return sqlParts.length > 1 ? `(${sqlParts.join(' AND ')})` : (sqlParts[0] || '');
    }

    // 3. Parentheses unwrapping
    const trimmed = expr.trim();
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      if (this.isFullyEnclosed(trimmed)) {
        const inner = this.convertFilterExpression(trimmed.slice(1, -1).trim(), params, allowedFields, tablePrefix, dialect);
        return inner ? `(${inner})` : '';
      }
    }

    // 4. Comparison parsing
    return this.parseSingleComparison(trimmed, params, allowedFields, tablePrefix, dialect);
  }

  private static parseSingleComparison(
    str: string,
    params: any[],
    allowedFields?: Set<string>,
    tablePrefix?: string,
    dialect: ISqlDialect = defaultDialect
  ): string {
    const operators = ['!=', '>=', '<=', '=', '>', '<', '!~', '~'];
    const prefix = tablePrefix ? `${dialect.quoteIdentifier(tablePrefix)}.` : '';

    for (const op of operators) {
      const idx = this.findOperatorIndex(str, op);
      if (idx !== -1) {
        const fieldName = str.substring(0, idx).trim();
        const valueRaw = str.substring(idx + op.length).trim();

        // Support dot notation for nested JSON fields: e.g. metadata.age
        let columnExpr: string;
        if (fieldName.includes('.')) {
          const [baseField, ...subPath] = fieldName.split('.');
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(baseField) || !subPath.every((s) => /^[a-zA-Z0-9_]+$/.test(s))) {
            throw new AppError(`Invalid field name '${fieldName}' in filter expression`, 400);
          }
          if (allowedFields && !allowedFields.has(baseField) && !['id', 'created', 'updated'].includes(baseField)) {
            throw new AppError(`Invalid filter field '${fieldName}'`, 400);
          }
          columnExpr = dialect.jsonExtractTextSql(`${prefix}${dialect.quoteIdentifier(baseField)}`, subPath.join('.'));
        } else {
          // Validate field name to prevent SQL injection and invalid identifiers (e.g. 1=1)
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fieldName)) {
            throw new AppError(`Invalid field name '${fieldName}' in filter expression`, 400);
          }

          if (allowedFields && !allowedFields.has(fieldName) && !['id', 'created', 'updated'].includes(fieldName)) {
            throw new AppError(`Invalid filter field '${fieldName}'`, 400);
          }
          columnExpr = `${prefix}${dialect.quoteIdentifier(fieldName)}`;
        }

        const value = this.extractLiteralValue(valueRaw);

        switch (op) {
          case '=':
            if (value === null) return `${columnExpr} IS NULL`;
            params.push(value);
            return `${columnExpr} = ?`;
          case '!=':
            if (value === null) return `${columnExpr} IS NOT NULL`;
            params.push(value);
            return `${columnExpr} != ?`;
          case '>':
            params.push(value);
            return `${columnExpr} > ?`;
          case '>=':
            params.push(value);
            return `${columnExpr} >= ?`;
          case '<':
            params.push(value);
            return `${columnExpr} < ?`;
          case '<=':
            params.push(value);
            return `${columnExpr} <= ?`;
          case '~': {
            const escaped = String(value)
              .replace(/\\/g, '\\\\')
              .replace(/%/g, '\\%')
              .replace(/_/g, '\\_');
            params.push(`%${escaped}%`);
            return `${columnExpr} LIKE ? ESCAPE '\\'`;
          }
          case '!~': {
            const escaped = String(value)
              .replace(/\\/g, '\\\\')
              .replace(/%/g, '\\%')
              .replace(/_/g, '\\_');
            params.push(`%${escaped}%`);
            return `${columnExpr} NOT LIKE ? ESCAPE '\\'`;
          }
        }
      }
    }

    throw new AppError(`Invalid comparison in filter expression: "${str}"`, 400);
  }

  private static extractLiteralValue(valStr: string): any {
    const trimmed = valStr.trim();
    if (!trimmed) {
      throw new AppError('Missing value in comparison in filter expression', 400);
    }

    if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
      const quoteChar = trimmed[0];
      let closingIdx = -1;
      for (let i = 1; i < trimmed.length; i++) {
        if (trimmed[i] === quoteChar && !this.isCharEscaped(trimmed, i)) {
          closingIdx = i;
          break;
        }
      }

      if (closingIdx === -1) {
        throw new AppError(`Unclosed string literal in filter expression: ${trimmed}`, 400);
      }

      const tail = trimmed.slice(closingIdx + 1).trim();
      if (tail.length > 0) {
        throw new AppError(`Unexpected trailing tokens '${tail}' after literal in filter expression`, 400);
      }

      return FilterCodec.decode(trimmed.slice(0, closingIdx + 1));
    }

    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
    if (trimmed.toLowerCase() === 'null') return null;

    if (!isNaN(Number(trimmed)) && !/^\s*$/.test(trimmed)) {
      return Number(trimmed);
    }

    // Check if user provided SQL-style logical operators or unquoted identifiers
    if (/\b(AND|OR)\b/i.test(trimmed)) {
      throw new AppError(
        `Invalid filter syntax: unexpected '${trimmed}'. Use '&&' or '||' for logical operations and quote string literals.`,
        400
      );
    }

    return trimmed;
  }

  private static isCharEscaped(str: string, index: number): boolean {
    let backslashCount = 0;
    for (let i = index - 1; i >= 0 && str[i] === '\\'; i--) {
      backslashCount++;
    }
    return backslashCount % 2 === 1;
  }

  private static splitTopLevel(str: string, delimiter: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if ((char === '"' || char === "'") && !this.isCharEscaped(str, i)) {
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

    parts.push(current);
    return parts;
  }

  private static findOperatorIndex(str: string, op: string): number {
    let depth = 0;
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if ((char === '"' || char === "'") && !this.isCharEscaped(str, i)) {
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
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if ((char === '"' || char === "'") && !this.isCharEscaped(str, i)) {
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
        if (depth === 0 && i < str.length - 1) return false;
      }
    }
    return depth === 0;
  }
}
