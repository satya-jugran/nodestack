export type DatabaseProvider = 'sqlite' | 'postgres' | 'mssql' | (string & {});

export interface ColumnMetadata {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: any;
  isPrimaryKey: boolean;
}

export interface ISqlDialect {
  readonly name: DatabaseProvider;
  readonly supportsReturning: boolean;
  readonly supportsNativeJson: boolean;

  quoteIdentifier(id: string): string;
  placeholder(index: number): string;
  rewritePlaceholders(sql: string): string;

  mapFieldType(
    type: string,
    options?: { isPrimaryKey?: boolean; isUnique?: boolean; isIndexed?: boolean }
  ): string;

  paginationSql(
    limitPlaceholder: string,
    offsetPlaceholder: string,
    hasOrderBy: boolean
  ): { clause: string; paramOrder: 'limit-first' | 'offset-first' };

  upsertSql(
    table: string,
    columns: string[],
    conflictTarget: string | string[],
    updateColumns: string[]
  ): string;

  tableExistsSql(): string;
  getTableColumnsSql(table: string): { sql: string; mapRow: (row: any) => ColumnMetadata };

  createTableIfNotExists(table: string, columnsSql: string): string;
  createIndexIfNotExists(
    indexName: string,
    tableName: string,
    columnsSql: string,
    isUnique?: boolean
  ): string;
  dropTableIfExists(table: string): string;
  dropIndexIfExists(indexName: string, tableName?: string): string;

  renameTableSql(oldName: string, newName: string): string;
  addColumnSql(table: string, columnDef: string): string;
  dropColumnSql(table: string, columnName: string): string;

  jsonExtractTextSql(column: string, jsonPath: string): string;
  substringSql(expr: string, start: number, length?: number): string;
  nowIsoSql(): string;
  booleanLiteral(value: boolean): string;

  timestampType(): string;
  jsonType(): string;
  textType(): string;
  paginate(baseSql: string, limit: number, offset: number): string;
}
