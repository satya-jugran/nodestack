import { ColumnMetadata, DatabaseProvider, ISqlDialect } from './ISqlDialect';

export function rewritePlaceholdersToNumbered(
  sql: string,
  formatter: (index: number) => string
): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let result = '';
  let paramIndex = 1;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      result += char;
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      result += char;
      if (char === '*' && next === '/') {
        result += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (inSingleQuote) {
      result += char;
      if (char === "'") {
        if (next === "'") {
          result += next;
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }

    if (inDoubleQuote) {
      result += char;
      if (char === '"') {
        if (next === '"') {
          result += next;
          i++;
        } else {
          inDoubleQuote = false;
        }
      }
      continue;
    }

    if (char === '-' && next === '-') {
      inLineComment = true;
      result += '--';
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      result += '/*';
      i++;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      result += char;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      result += char;
      continue;
    }

    if (char === '?') {
      result += formatter(paramIndex++);
      continue;
    }

    result += char;
  }

  return result;
}

export class PostgresDialect implements ISqlDialect {
  public readonly name: DatabaseProvider = 'postgres';
  public readonly supportsReturning = true;
  public readonly supportsNativeJson = true;

  public quoteIdentifier(id: string): string {
    return `"${id.replace(/"/g, '""')}"`;
  }

  public placeholder(index: number): string {
    return `$${index}`;
  }

  public rewritePlaceholders(sql: string): string {
    return rewritePlaceholdersToNumbered(sql, (idx) => `$${idx}`);
  }

  public mapFieldType(
    type: string,
    _options?: { isPrimaryKey?: boolean; isUnique?: boolean; isIndexed?: boolean }
  ): string {
    switch (type) {
      case 'number':
        return 'DOUBLE PRECISION';
      case 'bool':
        return 'BOOLEAN';
      case 'json':
        return 'JSONB';
      case 'file':
      case 'relation':
      case 'date':
      case 'email':
      case 'url':
      case 'select':
      case 'text':
      default:
        return 'TEXT';
    }
  }

  public paginationSql(
    limitPlaceholder: string,
    offsetPlaceholder: string,
    _hasOrderBy: boolean
  ): { clause: string; paramOrder: 'limit-first' | 'offset-first' } {
    return {
      clause: `LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      paramOrder: 'limit-first',
    };
  }

  public upsertSql(
    table: string,
    columns: string[],
    conflictTarget: string | string[],
    updateColumns: string[]
  ): string {
    const cols = columns.map((c) => this.quoteIdentifier(c)).join(', ');
    const vals = columns.map((_, i) => `$${i + 1}`).join(', ');
    const targets = Array.isArray(conflictTarget)
      ? conflictTarget.map((c) => this.quoteIdentifier(c)).join(', ')
      : this.quoteIdentifier(conflictTarget);
    const updates = updateColumns
      .map((c) => `${this.quoteIdentifier(c)} = EXCLUDED.${this.quoteIdentifier(c)}`)
      .join(', ');

    return `INSERT INTO ${this.quoteIdentifier(table)} (${cols}) VALUES (${vals}) ON CONFLICT (${targets}) DO UPDATE SET ${updates}`;
  }

  public tableExistsSql(): string {
    return `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?`;
  }

  public getTableColumnsSql(table: string): { sql: string; mapRow: (row: any) => ColumnMetadata } {
    return {
      sql: `SELECT column_name AS name, data_type AS type, is_nullable, column_default AS default_value
            FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = ?
            ORDER BY ordinal_position ASC`,
      mapRow: (row: any) => ({
        name: row.name,
        type: row.type || '',
        notNull: row.is_nullable === 'NO',
        defaultValue: row.default_value,
        isPrimaryKey: false, // determined from constraints if needed
      }),
    };
  }

  public createTableIfNotExists(table: string, columnsSql: string): string {
    return `CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(table)} (${columnsSql})`;
  }

  public createIndexIfNotExists(
    indexName: string,
    tableName: string,
    columnsSql: string,
    isUnique = false
  ): string {
    const unique = isUnique ? 'UNIQUE ' : '';
    return `CREATE ${unique}INDEX IF NOT EXISTS ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}(${columnsSql})`;
  }

  public dropTableIfExists(table: string): string {
    return `DROP TABLE IF EXISTS ${this.quoteIdentifier(table)} CASCADE`;
  }

  public dropIndexIfExists(indexName: string, _tableName?: string): string {
    return `DROP INDEX IF EXISTS ${this.quoteIdentifier(indexName)}`;
  }

  public renameTableSql(oldName: string, newName: string): string {
    return `ALTER TABLE ${this.quoteIdentifier(oldName)} RENAME TO ${this.quoteIdentifier(newName)}`;
  }

  public addColumnSql(table: string, columnDef: string): string {
    return `ALTER TABLE ${this.quoteIdentifier(table)} ADD COLUMN ${columnDef}`;
  }

  public dropColumnSql(table: string, columnName: string): string {
    return `ALTER TABLE ${this.quoteIdentifier(table)} DROP COLUMN IF EXISTS ${this.quoteIdentifier(columnName)}`;
  }

  public jsonExtractTextSql(column: string, jsonPath: string): string {
    const cleanPath = jsonPath.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1');
    const segments = cleanPath.split('.').filter(Boolean);
    const pathList = segments.map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
    return `(${this.quoteIdentifier(column)}::jsonb #>> ARRAY[${pathList}])`;
  }

  public substringSql(expr: string, start: number, length?: number): string {
    return length !== undefined
      ? `SUBSTRING(${expr} FROM ${start} FOR ${length})`
      : `SUBSTRING(${expr} FROM ${start})`;
  }

  public nowIsoSql(): string {
    return `to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  }

  public booleanLiteral(value: boolean): string {
    return value ? 'TRUE' : 'FALSE';
  }

  public timestampType(): string {
    return 'VARCHAR(50)';
  }

  public jsonType(): string {
    return 'JSONB';
  }

  public textType(): string {
    return 'TEXT';
  }

  public paginate(baseSql: string, limit: number, offset: number): string {
    return `${baseSql} LIMIT ${limit} OFFSET ${offset}`;
  }
}
