import { ColumnMetadata, DatabaseProvider, ISqlDialect } from './ISqlDialect';

export class SqliteDialect implements ISqlDialect {
  public readonly name: DatabaseProvider = 'sqlite';
  public readonly supportsReturning = true;
  public readonly supportsNativeJson = false;

  public quoteIdentifier(id: string): string {
    return `"${id.replace(/"/g, '""')}"`;
  }

  public placeholder(_index: number): string {
    return '?';
  }

  public rewritePlaceholders(sql: string): string {
    return sql;
  }

  public mapFieldType(
    type: string,
    _options?: { isPrimaryKey?: boolean; isUnique?: boolean; isIndexed?: boolean }
  ): string {
    switch (type) {
      case 'number':
        return 'REAL';
      case 'bool':
        return 'INTEGER';
      case 'json':
      case 'file':
      case 'relation':
        return 'TEXT';
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
    const vals = columns.map(() => '?').join(', ');
    const targets = Array.isArray(conflictTarget)
      ? conflictTarget.map((c) => this.quoteIdentifier(c)).join(', ')
      : this.quoteIdentifier(conflictTarget);
    const updates = updateColumns
      .map((c) => `${this.quoteIdentifier(c)} = excluded.${this.quoteIdentifier(c)}`)
      .join(', ');

    return `INSERT INTO ${this.quoteIdentifier(table)} (${cols}) VALUES (${vals}) ON CONFLICT (${targets}) DO UPDATE SET ${updates}`;
  }

  public tableExistsSql(): string {
    return `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`;
  }

  public getTableColumnsSql(table: string): { sql: string; mapRow: (row: any) => ColumnMetadata } {
    return {
      sql: `PRAGMA table_info(${this.quoteIdentifier(table)})`,
      mapRow: (row: any) => ({
        name: row.name,
        type: row.type || '',
        notNull: Boolean(row.notnull),
        defaultValue: row.dflt_value,
        isPrimaryKey: Boolean(row.pk),
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
    return `DROP TABLE IF EXISTS ${this.quoteIdentifier(table)}`;
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
    return `ALTER TABLE ${this.quoteIdentifier(table)} DROP COLUMN ${this.quoteIdentifier(columnName)}`;
  }

  public jsonExtractTextSql(column: string, jsonPath: string): string {
    const normalizedPath = jsonPath.startsWith('$.') ? jsonPath : `$.${jsonPath}`;
    const colExpr = column.includes('"') || column.includes('.') ? column : this.quoteIdentifier(column);
    return `json_extract(${colExpr}, '${normalizedPath}')`;
  }

  public substringSql(expr: string, start: number, length?: number): string {
    return length !== undefined
      ? `substr(${expr}, ${start}, ${length})`
      : `substr(${expr}, ${start})`;
  }

  public nowIsoSql(): string {
    return `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
  }

  public booleanLiteral(value: boolean): string {
    return value ? '1' : '0';
  }

  public timestampType(): string {
    return 'TEXT';
  }

  public jsonType(): string {
    return 'TEXT';
  }

  public textType(): string {
    return 'TEXT';
  }

  public paginate(baseSql: string, limit: number, offset: number): string {
    return `${baseSql} LIMIT ${limit} OFFSET ${offset}`;
  }
}
