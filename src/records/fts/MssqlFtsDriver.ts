import { DatabaseService } from '../../database/DatabaseService';
import { CollectionModel } from '../../schema/models/Collection';
import { SchemaField } from '../../schema/models/Field';
import { FtsQueryOptions, IFtsDriver } from './IFtsDriver';
import {
  FTS_SCORE_ALIAS,
  FTS_SNIPPET_ALIAS,
  FTS_SNIPPET_FIELD_PREFIX,
  getFtsFields,
  getFtsTableName,
} from '../FtsService';

export class MssqlFtsDriver implements IFtsDriver {
  constructor(private db: DatabaseService) {}

  public async hasFtsIndex(collectionName: string): Promise<boolean> {
    const tableName = getFtsTableName(collectionName);
    const row = await this.db.get<{ TABLE_NAME: string }>(
      'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = SCHEMA_NAME() AND TABLE_NAME = ?',
      tableName
    );
    return Boolean(row?.TABLE_NAME);
  }

  public async getFtsIndexColumns(collectionName: string): Promise<string[]> {
    const tableName = getFtsTableName(collectionName);
    try {
      const rows = await this.db.all<{ COLUMN_NAME: string }>(
        'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = SCHEMA_NAME() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION ASC',
        tableName
      );
      return (rows || [])
        .map((r: any) => r.COLUMN_NAME)
        .filter((n: any) => n !== 'id');
    } catch {
      return [];
    }
  }

  public async syncCollection(col: CollectionModel): Promise<void> {
    const ftsFields = getFtsFields(col);
    const ftsTable = getFtsTableName(col.name);

    if (ftsFields.length === 0) {
      if (await this.hasFtsIndex(col.name)) {
        await this.dropCollectionFts(col.name);
      }
      return;
    }

    const fieldNames = ftsFields.map((f) => f.name);
    const existingColumns = await this.getFtsIndexColumns(col.name);
    const hasIndex = await this.hasFtsIndex(col.name);

    const columnsMatch =
      hasIndex &&
      existingColumns.length === fieldNames.length &&
      existingColumns.every((colName, idx) => colName.toLowerCase() === fieldNames[idx].toLowerCase());

    if (columnsMatch) {
      return;
    }

    await this.dropCollectionFts(col.name);
    await this.createFtsTableAndTriggers(col.name, ftsTable, fieldNames);
  }

  public async dropCollectionFts(collectionName: string): Promise<void> {
    const ftsTable = getFtsTableName(collectionName);
    try {
      await this.db.exec(`
        IF OBJECT_ID('${ftsTable}_ai', 'TR') IS NOT NULL DROP TRIGGER [${ftsTable}_ai];
        IF OBJECT_ID('${ftsTable}_au', 'TR') IS NOT NULL DROP TRIGGER [${ftsTable}_au];
        IF OBJECT_ID('${ftsTable}_ad', 'TR') IS NOT NULL DROP TRIGGER [${ftsTable}_ad];
        IF OBJECT_ID('${ftsTable}', 'U') IS NOT NULL DROP TABLE [${ftsTable}];
      `);
    } catch {
      // ignore
    }
  }

  public async rebuildIndex(collectionName: string): Promise<void> {
    const ftsTable = getFtsTableName(collectionName);
    const existingColumns = await this.getFtsIndexColumns(collectionName);
    if (existingColumns.length === 0) return;

    const quotedCols = existingColumns.map((c) => `[${c}]`).join(', ');
    await this.db.transaction(async () => {
      await this.db.exec(`DELETE FROM [${ftsTable}];`);
      await this.db.exec(`
        INSERT INTO [${ftsTable}] (id, ${quotedCols})
        SELECT id, ${quotedCols} FROM [${collectionName}];
      `);
    });
  }

  public buildSnippetSelect(
    ftsTable: string,
    ftsFields: SchemaField[],
    options: FtsQueryOptions = {}
  ): string {
    const tableRef = ftsTable === 'fts' || ftsTable.startsWith('_fts_') ? '[fts]' : `[${ftsTable}]`;
    const length = Math.max(5, Math.min(100, Number(options.snippetLength) || 100));
    const firstField = ftsFields[0]?.name || 'id';

    const selects: string[] = [
      `1.0 AS [${FTS_SCORE_ALIAS}]`,
      `SUBSTRING(CAST(${tableRef}.[${firstField}] AS NVARCHAR(MAX)), 1, ${length}) AS [${FTS_SNIPPET_ALIAS}]`,
    ];

    ftsFields.forEach((field) => {
      selects.push(
        `SUBSTRING(CAST(${tableRef}.[${field.name}] AS NVARCHAR(MAX)), 1, ${length}) AS [${FTS_SNIPPET_FIELD_PREFIX}${field.name}]`
      );
    });

    return selects.join(', ');
  }

  public buildSearchPredicate(
    ftsTable: string,
    ftsFields: SchemaField[],
    searchTerm: string
  ): { clause: string; params: any[] } {
    if (!ftsFields || ftsFields.length === 0) {
      return { clause: '1=0', params: [] };
    }

    const tableRef = ftsTable === 'fts' || ftsTable.startsWith('_fts_') ? '[fts]' : `[${ftsTable}]`;
    const concatExpr = ftsFields
      .map((f) => `COALESCE(CAST(${tableRef}.[${f.name}] AS NVARCHAR(MAX)), '')`)
      .join(" + ' ' + ");

    const cleanTokens = searchTerm
      .replace(/["*^:{}()[\]]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (cleanTokens.length === 0) {
      return { clause: '1=0', params: [] };
    }

    const clauses = cleanTokens.map(() => `(${concatExpr}) LIKE ?`);
    const params = cleanTokens.map((t) => `%${t}%`);

    return {
      clause: `(${clauses.join(' AND ')})`,
      params,
    };
  }

  private async createFtsTableAndTriggers(
    collectionName: string,
    ftsTable: string,
    fieldNames: string[]
  ): Promise<void> {
    const quotedColsDef = fieldNames.map((c) => `[${c}] NVARCHAR(MAX)`).join(', ');
    const colNames = fieldNames.map((c) => `[${c}]`).join(', ');

    await this.db.transaction(async () => {
      await this.db.exec(`
        CREATE TABLE [${ftsTable}] (
          id NVARCHAR(255) PRIMARY KEY,
          ${quotedColsDef}
        );
      `);

      await this.db.exec(`
        INSERT INTO [${ftsTable}] (id, ${colNames})
        SELECT id, ${colNames} FROM [${collectionName}];
      `);

      // Triggers for real-time synchronization
      await this.db.exec(`
        CREATE TRIGGER [${ftsTable}_ai] ON [${collectionName}] AFTER INSERT AS
        BEGIN
          SET NOCOUNT ON;
          INSERT INTO [${ftsTable}] (id, ${colNames})
          SELECT id, ${colNames} FROM inserted;
        END;
      `);

      await this.db.exec(`
        CREATE TRIGGER [${ftsTable}_ad] ON [${collectionName}] AFTER DELETE AS
        BEGIN
          SET NOCOUNT ON;
          DELETE FROM [${ftsTable}] WHERE id IN (SELECT id FROM deleted);
        END;
      `);

      await this.db.exec(`
        CREATE TRIGGER [${ftsTable}_au] ON [${collectionName}] AFTER UPDATE AS
        BEGIN
          SET NOCOUNT ON;
          DELETE FROM [${ftsTable}] WHERE id IN (SELECT id FROM deleted);
          INSERT INTO [${ftsTable}] (id, ${colNames})
          SELECT id, ${colNames} FROM inserted;
        END;
      `);
    });
  }
}
