import { ValidationError } from '../core/errors/AppError';
import { CollectionOptions, ViewDialect } from './models/Collection';

const FORBIDDEN_KEYWORDS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'REPLACE',
  'MERGE',
  'ATTACH',
  'DETACH',
  'PRAGMA',
  'VACUUM',
  'EXEC',
  'EXECUTE',
  'GRANT',
  'REVOKE',
  'CALL',
  'COPY',
  'LOAD',
  'OUTFILE',
  'DUMPFILE',
]);

const RESTRICTED_SYSTEM_TABLES = new Set([
  '_admins',
  '_api_keys',
  '_db_configs',
  '_plugin_settings',
  '_external_auths',
  '_cron_schedules',
  '_cron_runs',
]);

const RESTRICTED_AUTH_COLUMNS = new Set([
  'passwordhash',
  'password_hash',
  'tokenkey',
  'token_key',
  'totpsecret',
  'totp_secret',
  'twofactorsecret',
  'two_factor_secret',
  'backupcodes',
  'backup_codes',
  'recoverycodes',
  'recovery_codes',
  'resettoken',
  'reset_token',
  'verificationtoken',
  'verification_token',
  'securityanswers',
  'security_answers',
]);

export class ViewQueryValidator {
  /**
   * Resolves the effective SQL query for the active dialect from options.viewQueries.
   */
  public static resolveViewQuery(options?: CollectionOptions, dialectName?: string): string {
    if (!options || typeof options !== 'object') {
      return '';
    }
    const dialectKey = (dialectName || 'sqlite').toLowerCase() as ViewDialect;
    const sql = options.viewQueries?.[dialectKey];
    return typeof sql === 'string' ? sql : '';
  }

  /**
   * Validates and normalizes a declarative SQL SELECT query for a specific dialect.
   * Returns the normalized SQL (without trailing semicolon).
   */
  public static validate(rawQuery: string, dialectName: string = 'sqlite', viewName?: string): string {
    if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
      throw new ValidationError(`View collections require a non-empty options.viewQueries.${dialectName} SELECT statement`);
    }

    const trimmed = rawQuery.trim().replace(/;\s*$/, '').trim();
    if (!trimmed) {
      throw new ValidationError('View query cannot be empty');
    }

    const stripped = this.stripCommentsAndLiterals(trimmed);

    if (stripped.includes(';')) {
      throw new ValidationError('View query must be a single SQL SELECT statement (multiple statements are not allowed)');
    }

    const leadingMatch = stripped.trimStart().match(/^([a-zA-Z_]+)/);
    const leadingKeyword = leadingMatch ? leadingMatch[1].toUpperCase() : '';
    if (leadingKeyword !== 'SELECT' && leadingKeyword !== 'WITH') {
      throw new ValidationError('View query must start with SELECT or WITH');
    }

    // Check forbidden keywords outside string literals and comments
    const tokens = stripped.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
    for (const token of tokens) {
      const upper = token.toUpperCase();
      if (FORBIDDEN_KEYWORDS.has(upper)) {
        throw new ValidationError(`View query contains forbidden keyword '${upper}'`);
      }
      if (RESTRICTED_AUTH_COLUMNS.has(token.toLowerCase())) {
        throw new ValidationError(`View query cannot reference restricted column '${token}'`);
      }
    }

    if (/\bFOR\s+(UPDATE|SHARE|KEY\s+SHARE|NO\s+KEY\s+UPDATE)\b/i.test(stripped)) {
      throw new ValidationError('View query cannot contain row-locking clauses (FOR UPDATE / FOR SHARE)');
    }

    // Check FROM / JOIN table references for restricted system tables and self-reference
    const cleanViewName = viewName ? viewName.trim().toLowerCase() : undefined;
    const tableRefRegex = /\b(?:FROM|JOIN)\s+(?:"([^"]+)"|\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*))/gi;
    let match: RegExpExecArray | null;
    while ((match = tableRefRegex.exec(this.stripCommentsAndStringLiteralsOnly(trimmed))) !== null) {
      const tableName = (match[1] || match[2] || match[3] || '').trim().toLowerCase();
      if (!tableName) continue;
      if (RESTRICTED_SYSTEM_TABLES.has(tableName)) {
        throw new ValidationError(`View query cannot reference restricted system table '${tableName}'`);
      }
      if (cleanViewName && tableName === cleanViewName) {
        throw new ValidationError(`View query cannot reference itself ('${cleanViewName}')`);
      }
    }

    // MSSQL forbids top-level ORDER BY in CREATE VIEW unless TOP or OFFSET ... FETCH is present
    if (dialectName === 'mssql' && this.hasBareTopLevelOrderBy(stripped)) {
      throw new ValidationError(
        'MSSQL views do not allow a top-level ORDER BY clause without TOP or OFFSET/FETCH. Remove ORDER BY from the MSSQL query and use ?sort=... on queries instead.'
      );
    }

    this.assertDialectCompatibleSyntax(stripped, dialectName);

    return trimmed;
  }

  private static assertDialectCompatibleSyntax(strippedSql: string, dialectName: string): void {
    const dialect = (dialectName || 'sqlite').toLowerCase();

    if (dialect === 'sqlite') {
      if (/\bCONVERT\s*\(\s*VARCHAR/i.test(strippedSql) || /\bTRY_CAST\s*\(/i.test(strippedSql) || /\bSYSUTCDATETIME\s*\(/i.test(strippedSql) || /\bSELECT\s+TOP\s+\d+\b/i.test(strippedSql)) {
        throw new ValidationError(
          'Detected SQL Server (MSSQL) syntax in the SQLite query. Use SQLite syntax here and place MSSQL-specific SQL under the SQL Server tab.'
        );
      }
      if (/::\s*(?:jsonb|json|timestamptz|timestamp|text|int|integer|bigint|numeric|boolean|bool)\b/i.test(strippedSql) || /\bto_char\s*\(/i.test(strippedSql)) {
        throw new ValidationError(
          'Detected PostgreSQL syntax in the SQLite query. Use SQLite syntax here and place PostgreSQL-specific SQL under the PostgreSQL tab.'
        );
      }
    } else if (dialect === 'postgres') {
      if (/\bstrftime\s*\(/i.test(strippedSql)) {
        throw new ValidationError(
          'Detected SQLite strftime() in the PostgreSQL query. Use PostgreSQL to_char() or date_trunc() instead.'
        );
      }
      if (/\bCONVERT\s*\(\s*VARCHAR/i.test(strippedSql) || /\bSYSUTCDATETIME\s*\(/i.test(strippedSql) || /\bSELECT\s+TOP\s+\d+\b/i.test(strippedSql)) {
        throw new ValidationError(
          'Detected SQL Server (MSSQL) syntax in the PostgreSQL query. Use PostgreSQL syntax instead.'
        );
      }
    } else if (dialect === 'mssql') {
      if (/\bstrftime\s*\(/i.test(strippedSql)) {
        throw new ValidationError(
          'Detected SQLite strftime() in the SQL Server query. Use MSSQL CONVERT() or FORMAT() instead.'
        );
      }
      if (/::\s*(?:jsonb|json|timestamptz|timestamp|text|int|integer|bigint|numeric|boolean|bool)\b/i.test(strippedSql) || /\bto_char\s*\(/i.test(strippedSql)) {
        throw new ValidationError(
          'Detected PostgreSQL syntax in the SQL Server query. Use MSSQL CAST()/CONVERT() instead.'
        );
      }
    }
  }

  private static stripCommentsAndLiterals(sql: string): string {
    return this.scanSql(sql, true);
  }

  private static stripCommentsAndStringLiteralsOnly(sql: string): string {
    return this.scanSql(sql, false);
  }

  private static scanSql(sql: string, stripQuotedIdentifiers: boolean): string {
    let out = '';
    let inSingle = false;
    let inDouble = false;
    let inBracket = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i];
      const next = sql[i + 1];

      if (inLineComment) {
        if (ch === '\n') {
          inLineComment = false;
          out += '\n';
        } else {
          out += ' ';
        }
        continue;
      }

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          out += '  ';
          i++;
        } else {
          out += ' ';
        }
        continue;
      }

      if (inSingle) {
        if (ch === "'" && next === "'") {
          out += '  ';
          i++;
        } else if (ch === "'") {
          inSingle = false;
          out += ' ';
        } else {
          out += ' ';
        }
        continue;
      }

      if (inDouble) {
        if (ch === '"' && next === '"') {
          out += stripQuotedIdentifiers ? '  ' : '""';
          i++;
        } else if (ch === '"') {
          inDouble = false;
          out += stripQuotedIdentifiers ? ' ' : '"';
        } else {
          out += stripQuotedIdentifiers ? ' ' : ch;
        }
        continue;
      }

      if (inBracket) {
        if (ch === ']' && next === ']') {
          out += stripQuotedIdentifiers ? '  ' : ']]';
          i++;
        } else if (ch === ']') {
          inBracket = false;
          out += stripQuotedIdentifiers ? ' ' : ']';
        } else {
          out += stripQuotedIdentifiers ? ' ' : ch;
        }
        continue;
      }

      if (ch === '-' && next === '-') {
        inLineComment = true;
        out += '  ';
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        out += '  ';
        i++;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        out += ' ';
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        out += stripQuotedIdentifiers ? ' ' : '"';
        continue;
      }
      if (ch === '[') {
        inBracket = true;
        out += stripQuotedIdentifiers ? ' ' : '[';
        continue;
      }

      out += ch;
    }

    return out;
  }

  private static hasBareTopLevelOrderBy(strippedSql: string): boolean {
    let depth = 0;
    let topLevel = '';
    for (let i = 0; i < strippedSql.length; i++) {
      const ch = strippedSql[i];
      if (ch === '(') {
        depth++;
        topLevel += ' ';
      } else if (ch === ')') {
        if (depth > 0) depth--;
        topLevel += ' ';
      } else if (depth === 0) {
        topLevel += ch;
      } else {
        topLevel += ' ';
      }
    }

    if (!/\bORDER\s+BY\b/i.test(topLevel)) {
      return false;
    }
    if (/\bTOP\s*\(?/i.test(topLevel) || /\bOFFSET\b[\s\S]*\bFETCH\b/i.test(topLevel)) {
      return false;
    }
    return true;
  }
}
