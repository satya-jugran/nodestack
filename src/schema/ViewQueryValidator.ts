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

export const RESTRICTED_AUTH_COLUMNS = new Set([
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
  public static validate(
    rawQuery: string,
    dialectName: string = 'sqlite',
    viewName?: string,
    authCollections?: Set<string>
  ): string {
    if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
      throw new ValidationError(`View collections require a non-empty options.viewQueries.${dialectName} SELECT statement`);
    }

    const trimmed = rawQuery.trim().replace(/;\s*$/, '').trim();
    if (!trimmed) {
      throw new ValidationError('View query cannot be empty');
    }

    const stripped = this.stripCommentsAndLiterals(trimmed);
    const noStringSql = this.stripCommentsAndStringLiteralsOnly(trimmed);

    if (stripped.includes(';')) {
      throw new ValidationError('View query must be a single SQL SELECT statement (multiple statements are not allowed)');
    }

    const leadingMatch = stripped.trimStart().match(/^([a-zA-Z_]+)/);
    const leadingKeyword = leadingMatch ? leadingMatch[1].toUpperCase() : '';
    if (leadingKeyword !== 'SELECT' && leadingKeyword !== 'WITH') {
      throw new ValidationError('View query must start with SELECT or WITH');
    }

    // Check forbidden keywords outside string literals, quoted identifiers, and comments
    const tokens = stripped.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
    for (const token of tokens) {
      const upper = token.toUpperCase();
      if (FORBIDDEN_KEYWORDS.has(upper)) {
        throw new ValidationError(`View query contains forbidden keyword '${upper}'`);
      }
    }

    // Check restricted auth columns across both unquoted and quoted ("...", [...]) identifiers
    const identRegex = /"((?:[^"]|"")+)"|\[((?:[^\]]|\]\])+)\]|([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let identMatch: RegExpExecArray | null;
    while ((identMatch = identRegex.exec(noStringSql)) !== null) {
      const ident = identMatch[1] !== undefined
        ? identMatch[1].replace(/""/g, '"')
        : identMatch[2] !== undefined
          ? identMatch[2].replace(/\]\]/g, ']')
          : identMatch[3];
      if (ident && RESTRICTED_AUTH_COLUMNS.has(ident.toLowerCase())) {
        throw new ValidationError(`View query cannot reference restricted column '${ident}'`);
      }
    }

    if (/\bFOR\s+(UPDATE|SHARE|KEY\s+SHARE|NO\s+KEY\s+UPDATE)\b/i.test(stripped)) {
      throw new ValidationError('View query cannot contain row-locking clauses (FOR UPDATE / FOR SHARE)');
    }

    // Check FROM / JOIN table references (including schema/catalog-qualified names like main._admins, dbo._admins)
    const cleanViewName = viewName ? viewName.trim().toLowerCase() : undefined;
    const authNames = new Set<string>(['users']);
    if (authCollections) {
      for (const a of authCollections) {
        if (a) authNames.add(a.trim().toLowerCase());
      }
    }
    const referencedAuthAliases = new Map<string, string>();
    for (const ref of ViewQueryValidator.extractTableReferences(noStringSql)) {
      const tableName = ref.tableName;
      if (RESTRICTED_SYSTEM_TABLES.has(tableName)) {
        throw new ValidationError(`View query cannot reference restricted system table '${tableName}'`);
      }
      if (cleanViewName && tableName === cleanViewName) {
        throw new ValidationError(`View query cannot reference itself ('${cleanViewName}')`);
      }
      if (authNames.has(tableName)) {
        referencedAuthAliases.set(tableName, tableName);
        if (ref.alias) {
          referencedAuthAliases.set(ref.alias, tableName);
        }
      }
    }

    if (referencedAuthAliases.size > 0) {
      this.assertNoAuthWildcardProjection(noStringSql, referencedAuthAliases);
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

  /**
   * Extracts referenced tables (resolving schema/catalog-qualified names such as main._admins or [dbo].[users]
   * to their final object name) and optional aliases from FROM and JOIN clauses.
   */
  public static extractTableReferences(noStringSql: string): Array<{ tableName: string; alias?: string }> {
    const refs: Array<{ tableName: string; alias?: string }> = [];
    const sqlKeywords = new Set([
      'WHERE', 'ON', 'USING', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL', 'NATURAL',
      'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'FETCH', 'UNION', 'EXCEPT', 'INTERSECT', 'SET',
      'AS', 'VALUES', 'WITH', 'INTO', 'FOR',
    ]);
    const identPart = '(?:"(?:[^"]|"")+"|\\[(?:[^\\]]|\\]\\])+\\]|[a-zA-Z_][a-zA-Z0-9_]*)';
    const qualifiedIdent = `(${identPart}(?:\\s*\\.\\s*${identPart})*)`;
    const tableItemRegex = new RegExp(`^\\s*${qualifiedIdent}(?:\\s+(?:AS\\s+)?(${identPart}))?`, 'i');
    const clauseKeywordRegex = /\b(?:FROM|JOIN)\b/gi;

    const unquoteIdent = (raw: string): string => {
      const t = raw.trim();
      if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
        return t.slice(1, -1).replace(/""/g, '"').toLowerCase();
      }
      if (t.startsWith('[') && t.endsWith(']') && t.length >= 2) {
        return t.slice(1, -1).replace(/\]\]/g, ']').toLowerCase();
      }
      return t.toLowerCase();
    };

    const extractLastPart = (qualified: string): string => {
      const partRe = new RegExp(identPart, 'g');
      let last = '';
      let pm: RegExpExecArray | null;
      while ((pm = partRe.exec(qualified)) !== null) {
        last = unquoteIdent(pm[0]);
      }
      return last;
    };

    let cm: RegExpExecArray | null;
    while ((cm = clauseKeywordRegex.exec(noStringSql)) !== null) {
      let cursor = cm.index + cm[0].length;
      const isFrom = cm[0].toUpperCase() === 'FROM';

      while (cursor < noStringSql.length) {
        const slice = noStringSql.slice(cursor);
        const ws = slice.match(/^\s*/)?.[0] || '';
        cursor += ws.length;
        const rest = noStringSql.slice(cursor);
        if (!rest || rest.startsWith('(') || rest.startsWith(')')) break;

        const m = tableItemRegex.exec(rest);
        if (!m) break;

        const firstWord = m[1].trim().split(/[\s.]+/)[0].toUpperCase();
        if (sqlKeywords.has(firstWord)) break;

        const tableName = extractLastPart(m[1]);
        let alias: string | undefined;
        let consumed = m[1].length;
        if (m[2]) {
          const cand = unquoteIdent(m[2]);
          if (!sqlKeywords.has(cand.toUpperCase())) {
            alias = cand;
            consumed = m[0].length;
          }
        }

        if (tableName) {
          refs.push({ tableName, ...(alias ? { alias } : {}) });
        }

        cursor += consumed;
        if (!isFrom) break;

        const afterMatch = noStringSql.slice(cursor).match(/^\s*,/);
        if (!afterMatch) break;
        cursor += afterMatch[0].length;
      }
    }

    return refs;
  }

  private static assertNoAuthWildcardProjection(
    noStringSql: string,
    referencedAuthAliases: Map<string, string>
  ): void {
    // Strip COUNT(*) / COUNT(ALL *) so aggregate counts do not trigger wildcard rejection
    const withoutCountStar = noStringSql.replace(/\bCOUNT\s*\(\s*(?:ALL\s+)?\*\s*\)/gi, 'COUNT(1)');

    // Check qualified wildcards: alias.* or "alias".* or [alias].*
    const qualifiedWildcardRe = /(?:(?:"([^"]+)"|\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))\s*\.\s*\*/g;
    let qm: RegExpExecArray | null;
    while ((qm = qualifiedWildcardRe.exec(withoutCountStar)) !== null) {
      const qualifier = (qm[1] || qm[2] || qm[3] || '').trim().toLowerCase();
      const authTable = referencedAuthAliases.get(qualifier);
      if (authTable) {
        throw new ValidationError(
          `View query cannot use wildcard '${qualifier}.*' on auth collection '${authTable}'. Select explicit non-sensitive columns instead.`
        );
      }
    }

    // Check bare SELECT * (or SELECT ..., * ...) in any SELECT projection clause
    const selectClauseRe = /\bSELECT\s+(?:DISTINCT\s+|ALL\s+)?(?:TOP\s+\d+\s+)?([\s\S]*?)\bFROM\b/gi;
    let sm: RegExpExecArray | null;
    while ((sm = selectClauseRe.exec(withoutCountStar)) !== null) {
      const clause = sm[1];
      // Remove any remaining safe qualified wildcards (e.g. orders.*) before checking bare *
      const strippedQualified = clause.replace(/(?:"[^"]+"|\[[^\]]+\]|[a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*\*/g, '');
      // Split by top-level commas and check if any projection item is bare *
      let depth = 0;
      let item = '';
      const checkItem = (rawItem: string) => {
        if (/^\*$/.test(rawItem.trim())) {
          throw new ValidationError(
            'View query cannot use wildcard SELECT * when querying an auth collection. Select explicit non-sensitive columns instead.'
          );
        }
      };
      for (let i = 0; i < strippedQualified.length; i++) {
        const ch = strippedQualified[i];
        if (ch === '(') depth++;
        else if (ch === ')' && depth > 0) depth--;
        else if (ch === ',' && depth === 0) {
          checkItem(item);
          item = '';
          continue;
        }
        item += ch;
      }
      checkItem(item);
    }
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
