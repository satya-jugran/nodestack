import { ColumnMetadata, DatabaseProvider, ISqlDialect } from './ISqlDialect';
import { rewritePlaceholdersToNumbered } from './PostgresDialect';

export class MssqlDialect implements ISqlDialect {
  public readonly name: DatabaseProvider = 'mssql';
  public readonly supportsReturning = false; // uses OUTPUT
  public readonly supportsNativeJson = false; // stored as NVARCHAR(MAX) with JSON_VALUE

  public quoteIdentifier(id: string): string {
    return `[${id.replace(/\]/g, ']]')}]`;
  }

  public placeholder(index: number): string {
    return `@p${index}`;
  }

  public rewritePlaceholders(sql: string): string {
    return rewritePlaceholdersToNumbered(sql, (idx) => `@p${idx}`);
  }

  public mapFieldType(
    type: string,
    options?: { isPrimaryKey?: boolean; isUnique?: boolean; isIndexed?: boolean }
  ): string {
    const isConstrained = options?.isPrimaryKey || options?.isUnique || options?.isIndexed;
    switch (type) {
      case 'number':
        return 'FLOAT';
      case 'bool':
        return 'BIT';
      case 'json':
      case 'file':
        return 'NVARCHAR(MAX)';
      case 'relation':
        return isConstrained ? 'NVARCHAR(255)' : 'NVARCHAR(MAX)';
      case 'date':
      case 'email':
      case 'url':
      case 'select':
      case 'text':
      default:
        return isConstrained ? 'NVARCHAR(255)' : 'NVARCHAR(MAX)';
    }
  }

  public paginationSql(
    limitPlaceholder: string,
    offsetPlaceholder: string,
    hasOrderBy: boolean
  ): { clause: string; paramOrder: 'limit-first' | 'offset-first' } {
    const orderClause = hasOrderBy ? '' : 'ORDER BY (SELECT NULL) ';
    return {
      clause: `${orderClause}OFFSET ${offsetPlaceholder} ROWS FETCH NEXT ${limitPlaceholder} ROWS ONLY`,
      paramOrder: 'offset-first',
    };
  }

  public upsertSql(
    table: string,
    columns: string[],
    conflictTarget: string | string[],
    updateColumns: string[]
  ): string {
    const targets = Array.isArray(conflictTarget) ? conflictTarget : [conflictTarget];
    const matchConditions = targets
      .map((t) => `target.${this.quoteIdentifier(t)} = source.${this.quoteIdentifier(t)}`)
      .join(' AND ');

    const cols = columns.map((c) => this.quoteIdentifier(c)).join(', ');
    const sourceCols = columns.map((c) => `source.${this.quoteIdentifier(c)}`).join(', ');
    const dummyVals = columns.map((_, i) => `@p${i + 1}`).join(', ');

    const updates = updateColumns
      .map((c) => `target.${this.quoteIdentifier(c)} = source.${this.quoteIdentifier(c)}`)
      .join(', ');

    return `MERGE INTO ${this.quoteIdentifier(table)} AS target ` +
      `USING (VALUES (${dummyVals})) AS source (${cols}) ` +
      `ON ${matchConditions} ` +
      (updateColumns.length > 0 ? `WHEN MATCHED THEN UPDATE SET ${updates} ` : '') +
      `WHEN NOT MATCHED THEN INSERT (${cols}) VALUES (${sourceCols});`;
  }

  public tableExistsSql(): string {
    return `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = SCHEMA_NAME() AND TABLE_NAME = ?`;
  }

  public getTableColumnsSql(table: string): { sql: string; mapRow: (row: any) => ColumnMetadata } {
    return {
      sql: `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE, COLUMN_DEFAULT AS default_value
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = SCHEMA_NAME() AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION ASC`,
      mapRow: (row: any) => ({
        name: row.name,
        type: row.type || '',
        notNull: row.IS_NULLABLE === 'NO',
        defaultValue: row.default_value,
        isPrimaryKey: false,
      }),
    };
  }

  public createTableIfNotExists(table: string, columnsSql: string): string {
    return `IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE t.name = '${table.replace(/'/g, "''")}' AND s.name = SCHEMA_NAME())
            CREATE TABLE ${this.quoteIdentifier(table)} (${columnsSql})`;
  }

  public createIndexIfNotExists(
    indexName: string,
    tableName: string,
    columnsSql: string,
    isUnique = false
  ): string {
    const unique = isUnique ? 'UNIQUE ' : '';
    return `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = '${indexName.replace(/'/g, "''")}' AND object_id = OBJECT_ID('${tableName.replace(/'/g, "''")}'))
            CREATE ${unique}INDEX ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}(${columnsSql})`;
  }

  public dropTableIfExists(table: string): string {
    return `IF OBJECT_ID('${table.replace(/'/g, "''")}', 'U') IS NOT NULL DROP TABLE ${this.quoteIdentifier(table)}`;
  }

  public dropIndexIfExists(indexName: string, tableName?: string): string {
    if (!tableName) {
      return `IF EXISTS (SELECT * FROM sys.indexes WHERE name = '${indexName.replace(/'/g, "''")}') DROP INDEX ${this.quoteIdentifier(indexName)}`;
    }
    return `IF EXISTS (SELECT * FROM sys.indexes WHERE name = '${indexName.replace(/'/g, "''")}' AND object_id = OBJECT_ID('${tableName.replace(/'/g, "''")}')) DROP INDEX ${this.quoteIdentifier(indexName)} ON ${this.quoteIdentifier(tableName)}`;
  }

  public renameTableSql(oldName: string, newName: string): string {
    return `EXEC sp_rename '${oldName.replace(/'/g, "''")}', '${newName.replace(/'/g, "''")}'`;
  }

  public addColumnSql(table: string, columnDef: string): string {
    return `ALTER TABLE ${this.quoteIdentifier(table)} ADD ${columnDef}`;
  }

  public dropColumnSql(table: string, columnName: string): string {
    return `ALTER TABLE ${this.quoteIdentifier(table)} DROP COLUMN ${this.quoteIdentifier(columnName)}`;
  }

  public jsonExtractTextSql(column: string, jsonPath: string): string {
    const normalizedPath = jsonPath.startsWith('$.') ? jsonPath : `$.${jsonPath}`;
    return `JSON_VALUE(${this.quoteIdentifier(column)}, '${normalizedPath}')`;
  }

  public substringSql(expr: string, start: number, length?: number): string {
    return length !== undefined
      ? `SUBSTRING(${expr}, ${start}, ${length})`
      : `SUBSTRING(${expr}, ${start}, 8000)`;
  }

  public nowIsoSql(): string {
    return `CONVERT(VARCHAR(30), SYSUTCDATETIME(), 127)`;
  }

  public booleanLiteral(value: boolean): string {
    return value ? '1' : '0';
  }

  public timestampType(): string {
    return 'NVARCHAR(50)';
  }

  public jsonType(): string {
    return 'NVARCHAR(MAX)';
  }

  public textType(): string {
    return 'NVARCHAR(MAX)';
  }

  public paginate(baseSql: string, limit: number, offset: number): string {
    if (/order\s+by/i.test(baseSql)) {
      return `${baseSql} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    }
    return `${baseSql} ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  }
}
