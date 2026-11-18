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
  sanitizeFtsQuery,
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

  private resolveTokenizer(options?: Record<string, any>): string {
    const rawTokenizer = options?.ftsTokenizer || (options?.ftsLanguage && options.ftsLanguage !== 'english' ? 'unicode61' : 'porter unicode61');
    return String(rawTokenizer).replace(/[^a-zA-Z0-9_\s]/g, '').trim() || 'porter unicode61';
  }

  public getFtsTokenizer(collectionName: string): any {
    const tableName = getFtsTableName(collectionName);
    try {
      const row = this.db.get<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        tableName
      );
      const extract = (rawSql?: string) => {
        if (!rawSql) return null;
        const match = rawSql.match(/tokenize\s*=\s*['"]?([^'",\)]+?)['"]?(?:\s*[,)]|$)/i);
        return match ? match[1].trim() : null;
      };
      if (row && typeof (row as any).then === 'function') {
        return (row as any).then((r: any) => extract(r?.sql));
      }
      return extract(row?.sql);
    } catch {
      return null;
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
    const targetTokenizer = this.resolveTokenizer(col.options);
    const existingTokenizer = hasIndex ? this.getFtsTokenizer(col.name) : null;

    const columnsMatch =
      hasIndex &&
      existingColumns.length === fieldNames.length &&
      existingColumns.every((colName: string, idx: number) => colName.toLowerCase() === fieldNames[idx].toLowerCase());

    const tokenizerMatches = hasIndex && existingTokenizer === targetTokenizer;

    if (columnsMatch && tokenizerMatches) {
      this.createTriggers(col.name, ftsTable, fieldNames);
      this.reconcile(col.name, ftsTable, fieldNames);
      return;
    }

    this.db.transaction(() => {
      this.dropCollectionFts(col.name);
      this.createFtsTableAndTriggers(col.name, ftsTable, fieldNames, col.options);
    });
  }

  public reconcile(collectionName: string, ftsTable?: string, fieldNames?: string[]): { drifted: boolean; repaired: boolean } {
    const table = ftsTable || getFtsTableName(collectionName);
    const cols = fieldNames || (this.getFtsIndexColumns(collectionName) as string[]);
    if (!cols || cols.length === 0) return { drifted: false, repaired: false };

    try {
      const baseCountRow = this.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM "${collectionName}"`);
      const ftsCountRow = this.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM "${table}"`);
      const baseCount = Number(baseCountRow?.count || 0);
      const ftsCount = Number(ftsCountRow?.count || 0);

      if (baseCount !== ftsCount) {
        // Drift detected: perform atomic repair/rebuild
        this.rebuildIndex(collectionName);
        return { drifted: true, repaired: true };
      }

      if (baseCount > 0) {
        const colConditions = cols.map((c) => `(b."${c}" IS NOT f."${c}")`);
        const whereClause = ['f.id IS NULL', ...colConditions].join(' OR ');
        const mismatch = this.db.get(
          `SELECT 1 as mismatch FROM "${collectionName}" b LEFT JOIN "${table}" f ON b.id = f.id WHERE ${whereClause} LIMIT 1`
        );

        if (mismatch) {
          this.rebuildIndex(collectionName);
          return { drifted: true, repaired: true };
        }
      }
    } catch {
      // ignore
    }
    return { drifted: false, repaired: false };
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

  public buildSearchPredicate(
    ftsTable: string,
    ftsFields: SchemaField[],
    searchTerm: string,
    _options?: FtsQueryOptions
  ): { clause: string; params: any[] } {
    return {
      clause: `${this.db.dialect.quoteIdentifier(ftsTable)} MATCH ?`,
      params: [sanitizeFtsQuery(searchTerm)],
    };
  }

  private createFtsTableAndTriggers(
    collectionName: string,
    ftsTable: string,
    fieldNames: string[],
    options?: Record<string, any>
  ): void {
    const quotedCols = fieldNames.map((c) => `"${c}"`).join(', ');
    const safeTokenizer = this.resolveTokenizer(options);

    this.db.transaction(() => {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS "${ftsTable}" USING fts5(
          id UNINDEXED,
          ${quotedCols},
          tokenize = '${safeTokenizer}'
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
