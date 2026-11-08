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

export class SqliteFts5Driver implements IFtsDriver {
  constructor(private db: DatabaseService) {}

  public hasFtsIndex(collectionName: string): any {
    const tableName = getFtsTableName(collectionName);
    const row = this.db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      tableName
    );
    if (row && typeof (row as any).then === 'function') {
      return (row as any).then((r: any) => Boolean(r?.name));
    }
    return Boolean(row?.name);
  }

  public getFtsIndexColumns(collectionName: string): any {
    const tableName = getFtsTableName(collectionName);
    try {
      const rows = this.db.all<{ name: string }>(`PRAGMA table_info("${tableName}")`);
      if (rows && typeof (rows as any).then === 'function') {
        return (rows as any).then((rawRows: any[]) =>
          (rawRows || []).map((r: any) => r.name).filter((n: any) => n !== 'id')
        );
      }
      return (rows || []).map((r: any) => r.name).filter((n: any) => n !== 'id');
    } catch {
      return [];
    }
  }

  public syncCollection(col: CollectionModel): any {
    const ftsFields = getFtsFields(col);
    const ftsTable = getFtsTableName(col.name);

    if (ftsFields.length === 0) {
      if (this.hasFtsIndex(col.name)) {
        this.dropCollectionFts(col.name);
      }
      return;
    }

    const fieldNames = ftsFields.map((f) => f.name);
    const existingColumns = this.getFtsIndexColumns(col.name);

    const hasIndex = this.hasFtsIndex(col.name);
    const columnsMatch =
      hasIndex &&
      existingColumns.length === fieldNames.length &&
      existingColumns.every((colName: string, idx: number) => colName.toLowerCase() === fieldNames[idx].toLowerCase());

    if (columnsMatch) {
      this.createTriggers(col.name, ftsTable, fieldNames);
      return;
    }

    this.dropCollectionFts(col.name);
    this.createFtsTableAndTriggers(col.name, ftsTable, fieldNames);
  }

  public dropCollectionFts(collectionName: string): any {
    const ftsTable = getFtsTableName(collectionName);
    try {
      this.db.exec(`DROP TRIGGER IF EXISTS "${ftsTable}_ai";`);
      this.db.exec(`DROP TRIGGER IF EXISTS "${ftsTable}_au";`);
      this.db.exec(`DROP TRIGGER IF EXISTS "${ftsTable}_ad";`);
      this.db.exec(`DROP TABLE IF EXISTS "${ftsTable}";`);
    } catch {
      // ignore
    }
  }

  public rebuildIndex(collectionName: string): any {
    const ftsTable = getFtsTableName(collectionName);
    const existingColumns = this.getFtsIndexColumns(collectionName);
    if (existingColumns.length === 0) return;

    const quotedCols = existingColumns.map((c: any) => `"${c}"`).join(', ');
    this.db.transaction(() => {
      this.db.exec(`DELETE FROM "${ftsTable}";`);
      this.db.exec(`
        INSERT INTO "${ftsTable}" (id, ${quotedCols})
        SELECT id, ${quotedCols} FROM "${collectionName}";
      `);
    });
  }

  public buildSnippetSelect(
    ftsTable: string,
    ftsFields: SchemaField[],
    options: FtsQueryOptions = {}
  ): string {
    const tag = (options.snippetTag ? String(options.snippetTag).replace(/[^a-zA-Z0-9_-]/g, '') : '') || 'mark';
    const startTag = `<${tag}>`;
    const endTag = `</${tag}>`;
    const length = Math.max(5, Math.min(100, Number(options.snippetLength) || 15));
    const rawEllipsis =
      options.snippetEllipsis !== undefined && typeof options.snippetEllipsis === 'string'
        ? options.snippetEllipsis
        : '...';
    const ellipsis = rawEllipsis.replace(/'/g, "''");

    const selects: string[] = [
      `bm25("${ftsTable}") AS "${FTS_SCORE_ALIAS}"`,
      `snippet("${ftsTable}", -1, '${startTag}', '${endTag}', '${ellipsis}', ${length}) AS "${FTS_SNIPPET_ALIAS}"`,
    ];

    ftsFields.forEach((field, idx) => {
      const colIdx = idx + 1;
      selects.push(
        `snippet("${ftsTable}", ${colIdx}, '${startTag}', '${endTag}', '${ellipsis}', ${length}) AS "${FTS_SNIPPET_FIELD_PREFIX}${field.name}"`
      );
    });

    return selects.join(', ');
  }

  private createFtsTableAndTriggers(
    collectionName: string,
    ftsTable: string,
    fieldNames: string[]
  ): void {
    const quotedCols = fieldNames.map((c) => `"${c}"`).join(', ');

    this.db.transaction(() => {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS "${ftsTable}" USING fts5(
          id UNINDEXED,
          ${quotedCols},
          tokenize = 'porter unicode61'
        );
      `);

      this.db.exec(`
        INSERT INTO "${ftsTable}" (id, ${quotedCols})
        SELECT id, ${quotedCols} FROM "${collectionName}";
      `);

      this.createTriggers(collectionName, ftsTable, fieldNames);
    });
  }

  private createTriggers(
    collectionName: string,
    ftsTable: string,
    fieldNames: string[]
  ): void {
    const quotedCols = fieldNames.map((c) => `"${c}"`).join(', ');
    const newQuotedCols = fieldNames.map((c) => `new."${c}"`).join(', ');

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS "${ftsTable}_ai" AFTER INSERT ON "${collectionName}" BEGIN
        INSERT INTO "${ftsTable}" (id, ${quotedCols}) VALUES (new.id, ${newQuotedCols});
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS "${ftsTable}_ad" AFTER DELETE ON "${collectionName}" BEGIN
        DELETE FROM "${ftsTable}" WHERE id = old.id;
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS "${ftsTable}_au" AFTER UPDATE ON "${collectionName}" BEGIN
        DELETE FROM "${ftsTable}" WHERE id = old.id;
        INSERT INTO "${ftsTable}" (id, ${quotedCols}) VALUES (new.id, ${newQuotedCols});
      END;
    `);
  }
}
