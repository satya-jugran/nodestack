export type RuleOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | '~';
export type RuleMode = 'admin' | 'public' | 'auth' | 'custom';
export type RuleJoinOp = '&&' | '||';

export interface RuleClause {
  field: string;
  operator: RuleOperator;
  value: string;
}

export interface ParsedRule {
  mode: RuleMode;
  join: RuleJoinOp;
  clauses: RuleClause[];
  raw: string | null;
}

export interface OperatorOption {
  value: RuleOperator;
  label: string;
  description: string;
}

export const SUPPORTED_OPERATORS: OperatorOption[] = [
  { value: '=', label: '= (Equals)', description: 'Exact match' },
  { value: '!=', label: '!= (Not equals)', description: 'Different from' },
  { value: '>', label: '> (Greater than)', description: 'Numeric or date greater' },
  { value: '>=', label: '>= (Greater or equal)', description: 'Numeric or date greater or equal' },
  { value: '<', label: '< (Less than)', description: 'Numeric or date less' },
  { value: '<=', label: '<= (Less or equal)', description: 'Numeric or date less or equal' },
  { value: '~', label: '~ (Contains / Like)', description: 'Case-insensitive substring match' },
];

export const COMMON_AUTH_FIELDS = [
  { value: '@request.auth.id', label: '@request.auth.id (User ID)' },
  { value: '@request.auth.email', label: '@request.auth.email (User Email)' },
  { value: '@request.auth.role', label: '@request.auth.role (User Role)' },
  { value: '@request.auth.isAdmin', label: '@request.auth.isAdmin (Admin Flag)' },
];

export class RuleBuilder {
  /**
   * Parse an access rule string into structured clauses and metadata.
   * - null or undefined -> 'admin' (Admin only)
   * - '' or whitespace -> 'public' (Publicly accessible)
   * - '@request.auth.id != ""' or '@request.auth.id != \'\'' -> 'auth' (Logged in users only)
   * - custom expression -> 'custom' with parsed clauses
   */
  public static parse(rule: string | null | undefined): ParsedRule {
    if (rule === null || rule === undefined) {
      return {
        mode: 'admin',
        join: '&&',
        clauses: [],
        raw: null,
      };
    }

    const trimmed = rule.trim();
    if (trimmed === '' || trimmed === "''" || trimmed === '""') {
      if (trimmed === '') {
        return {
          mode: 'public',
          join: '&&',
          clauses: [],
          raw: '',
        };
      }
    }

    if (trimmed === 'null') {
      return {
        mode: 'admin',
        join: '&&',
        clauses: [],
        raw: null,
      };
    }

    // Check for Auth preset: @request.auth.id != "" or @request.auth.id != ''
    if (
      trimmed === '@request.auth.id != ""' ||
      trimmed === "@request.auth.id != ''" ||
      trimmed === '@request.auth.id != null'
    ) {
      return {
        mode: 'auth',
        join: '&&',
        clauses: [
          {
            field: '@request.auth.id',
            operator: '!=',
            value: '""',
          },
        ],
        raw: trimmed,
      };
    }

    // Try splitting by || first
    const orParts = this.splitTopLevel(trimmed, '||');
    if (orParts.length > 1) {
      const clauses: RuleClause[] = [];
      let allParsed = true;
      for (const part of orParts) {
        const clause = this.parseSingleClause(part.trim());
        if (clause) {
          clauses.push(clause);
        } else {
          allParsed = false;
          break;
        }
      }
      if (allParsed && clauses.length > 0) {
        return {
          mode: 'custom',
          join: '||',
          clauses,
          raw: trimmed,
        };
      }
    }

    // Try splitting by &&
    const andParts = this.splitTopLevel(trimmed, '&&');
    const clauses: RuleClause[] = [];
    let allParsed = true;
    for (const part of andParts) {
      const clause = this.parseSingleClause(part.trim());
      if (clause) {
        clauses.push(clause);
      } else {
        allParsed = false;
        break;
      }
    }

    if (allParsed && clauses.length > 0) {
      return {
        mode: 'custom',
        join: '&&',
        clauses,
        raw: trimmed,
      };
    }

    // If it could not be split into clean binary comparisons, preserve as custom with raw expression
    return {
      mode: 'custom',
      join: '&&',
      clauses: [
        {
          field: trimmed,
          operator: '!=',
          value: '""',
        },
      ],
      raw: trimmed,
    };
  }

  public static readonly DEFAULT_IDENTIFIER_FIELDS = [
    'id',
    'user',
    'userId',
    'user_id',
    'author',
    'authorId',
    'author_id',
    'owner',
    'ownerId',
    'owner_id',
    'creator',
    'creatorId',
    'creator_id',
    'created',
    'updated',
  ];

  /**
   * Build an access rule expression string from parsed metadata.
   */
  public static build(parsed: ParsedRule, options?: { knownFields?: string[] }): string | null {
    if (parsed.mode === 'admin') {
      return null;
    }
    if (parsed.mode === 'public') {
      return '';
    }
    if (parsed.mode === 'auth') {
      return '@request.auth.id != ""';
    }

    if (!parsed.clauses || parsed.clauses.length === 0) {
      return parsed.raw !== undefined ? parsed.raw : '';
    }

    const validClauses = parsed.clauses.filter(
      (c) => c.field && c.field.trim() !== ''
    );

    if (validClauses.length === 0) {
      return '';
    }

    const parts = validClauses.map((c) => {
      const field = c.field.trim();
      const op = c.operator || '=';
      let val = (c.value !== undefined ? c.value : '').trim();

      // Format value appropriately if not already quoted or variable
      val = this.formatValue(val, options?.knownFields);

      return `${field} ${op} ${val}`;
    });

    const joiner = ` ${parsed.join || '&&'} `;
    return parts.join(joiner);
  }

  /**
   * Format a clause value into an expression literal if needed.
   */
  public static formatValue(val: string, knownFields: string[] = []): string {
    if (!val || val === '') return '""';

    // Already quoted
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      return val;
    }

    // Numeric or boolean or null
    if (!isNaN(Number(val)) && val.trim() !== '') return val;
    if (val.toLowerCase() === 'true' || val.toLowerCase() === 'false' || val.toLowerCase() === 'null') {
      return val.toLowerCase();
    }

    // Variable references like @request.auth.id
    if (val.startsWith('@')) {
      return val;
    }

    // Record field identifiers (e.g. author, user_id, id, etc.)
    const combinedFields = new Set([
      ...this.DEFAULT_IDENTIFIER_FIELDS,
      ...knownFields,
    ]);

    if (combinedFields.has(val) || val.endsWith('_id') || val.endsWith('Id')) {
      return val;
    }

    // Text string -> quote with double quotes
    return JSON.stringify(val);
  }

  /**
   * Parse a single comparison string into a RuleClause.
   */
  public static parseSingleClause(str: string): RuleClause | null {
    let clean = str.trim();
    if (clean.startsWith('(') && clean.endsWith(')')) {
      clean = clean.slice(1, -1).trim();
    }

    const operators: RuleOperator[] = ['!=', '>=', '<=', '=', '>', '<', '~'];

    for (const op of operators) {
      const idx = this.findOperatorIndex(clean, op);
      if (idx !== -1) {
        const left = clean.substring(0, idx).trim();
        const right = clean.substring(idx + op.length).trim();
        if (left) {
          return {
            field: left,
            operator: op,
            value: right,
          };
        }
      }
    }

    // Single token or boolean expression
    if (clean) {
      return {
        field: clean,
        operator: '!=',
        value: '""',
      };
    }

    return null;
  }

  /**
   * Split string at delimiter respecting parentheses and quotes.
   */
  public static splitTopLevel(str: string, delimiter: string): string[] {
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

  /**
   * Find operator index outside quotes and parentheses.
   */
  public static findOperatorIndex(str: string, op: string): number {
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
          // Avoid matching '=' inside '!=', '<=', '>='
          if (op === '=' && i > 0 && (str[i - 1] === '!' || str[i - 1] === '<' || str[i - 1] === '>')) {
            continue;
          }
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * Validates if a rule expression is syntactically sound.
   */
  public static validate(rule: string | null | undefined): { valid: boolean; error?: string } {
    if (rule === null || rule === undefined) return { valid: true };
    const trimmed = rule.trim();
    if (trimmed === '' || trimmed === 'null') return { valid: true };

    // Check parentheses matching
    let depth = 0;
    let inQuote = false;
    let quoteChar = '';
    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      if ((char === '"' || char === "'") && (i === 0 || trimmed[i - 1] !== '\\')) {
        if (!inQuote) {
          inQuote = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuote = false;
        }
      }
      if (!inQuote) {
        if (char === '(') depth++;
        if (char === ')') depth--;
        if (depth < 0) return { valid: false, error: 'Unbalanced closing parenthesis ")" in rule' };
      }
    }
    if (depth !== 0) return { valid: false, error: 'Unclosed parenthesis "(" in rule' };
    if (inQuote) return { valid: false, error: 'Unclosed quote string in rule' };

    return { valid: true };
  }
}
