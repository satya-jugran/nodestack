import { DatabaseService } from '../database/DatabaseService';
import { CollectionModel } from '../schema/models/Collection';
import { SchemaField } from '../schema/models/Field';

export interface FtsQueryOptions {
  snippetTag?: string;
  snippetLength?: number;
  snippetEllipsis?: string;
}

export const FTS_SCORE_ALIAS = '__fts_score';
export const FTS_SNIPPET_ALIAS = '__fts_snippet';
export const FTS_SNIPPET_FIELD_PREFIX = '__fts_snippet_';
export const RESERVED_FTS_FIELDS = ['_score', '_snippet', '_snippets'] as const;

/**
 * Checks whether a field name collides with full-text search metadata or internal aliases.
 * Reserved names include _score, _snippet, _snippets, and any field starting with _snippet_ or __fts_.
 */
export function isReservedFtsFieldName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const lower = name.toLowerCase().trim();
  if (lower === '_score' || lower === '_snippet' || lower === '_snippets') {
    return true;
  }
  if (lower.startsWith('_snippet_') || lower.startsWith('__fts_')) {
    return true;
  }
  return false;
}

export function isFtsField(field: SchemaField): boolean {
  const lower = (field.name || '').toLowerCase().trim();
  // SQLite FTS5 explicitly reserves 'rank' and 'rowid' as virtual table column names
  if (lower === 'rank' || lower === 'rowid' || isReservedFtsFieldName(field.name)) {
    return false;
  }
  if (field.fts === true || field.options?.fts === true) {
    return true;
  }
  if (field.fts === false || field.options?.fts === false) {
    return false;
  }
  return field.type === 'text';
}

export function getFtsFields(col: CollectionModel): SchemaField[] {
  if (!col || !Array.isArray(col.schema)) return [];
  return col.schema.filter(isFtsField);
}

export function getFtsTableName(collectionName: string): string {
  const clean = collectionName.trim().toLowerCase();
  return `_fts_${clean}`;
}

/**
 * Safely sanitizes raw user search input into a valid SQLite FTS5 MATCH expression.
 * Handles phrases, prefix searches, special punctuation, and avoids syntax errors.
 */
export function sanitizeFtsQuery(query: string): string {
  if (!query || typeof query !== 'string') return '';

  // In URL queries, '+' is often used for space: search=typescript+backend
  const normalized = query.replace(/\+/g, ' ').trim();
  if (!normalized) return '';

  const regex = /"([^"]+)"|(\S+)/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalized)) !== null) {
    if (match[1]) {
      // Quoted phrase
      const phrase = match[1].trim();
      if (phrase) {
        const cleanPhrase = phrase.replace(/"/g, '""');
        tokens.push(`"${cleanPhrase}"`);
      }
    } else if (match[2]) {
      let word = match[2].trim();
      const isPrefix = word.endsWith('*') && word.length > 1;
      if (isPrefix) {
        word = word.slice(0, -1);
      }
      // Strip characters that break FTS5 tokenization or operators
      const cleanWord = word.replace(/["*^:{}()[\]]/g, '').trim();
      if (cleanWord) {
        tokens.push(isPrefix ? `"${cleanWord}"*` : `"${cleanWord}"`);
      }
    }
  }

  return tokens.join(' ');
}

export class FtsService {
  constructor(private db: DatabaseService) {}

  public isFtsField(field: SchemaField): boolean {
    return isFtsField(field);
  }

  public getFtsFields(col: CollectionModel): SchemaField[] {
    return getFtsFields(col);
  }

  public getFtsTableName(collectionName: string): string {
    return getFtsTableName(collectionName);
  }

  public hasFtsIndex(collectionName: string): boolean {
    const tableName = getFtsTableName(collectionName);
    const row = this.db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName]
    );
    return Boolean(row?.name);
  }

  public getFtsIndexColumns(collectionName: string): string[] {
    const tableName = getFtsTableName(collectionName);
    try {
      const rows = this.db.all<{ name: string }>(`PRAGMA table_info("${tableName}")`);
      return (rows || []).map((r) => r.name).filter((n) => n !== 'id');
    } catch {
      return [];
    }
  }

  /**
   * Synchronizes FTS5 virtual table and real-time triggers for a collection.
   * Creates the table & triggers if not present; populates existing data; updates if columns changed.
   */
  public syncCollection(col: CollectionModel): void {
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

    // If table exists, check if columns match
    const columnsMatch =
      this.hasFtsIndex(col.name) &&
      existingColumns.length === fieldNames.length &&
      existingColumns.every((colName, idx) => colName.toLowerCase() === fieldNames[idx].toLowerCase());

    if (columnsMatch) {
      // Ensure triggers exist
      this.createTriggers(col.name, ftsTable, fieldNames);
      return;
    }

    // Otherwise drop and recreate cleanly
    this.dropCollectionFts(col.name);
    this.createFtsTableAndTriggers(col.name, ftsTable, fieldNames);
  }

  /**
   * Syncs FTS virtual tables and triggers across all collections.
   */
  public syncAll(collections: CollectionModel[]): void {
    for (const col of collections) {
      try {
        this.syncCollection(col);
      } catch (err: any) {
        console.warn(`[FTS] Could not sync collection '${col.name}':`, err.message);
      }
    }
  }

  /**
   * Drops FTS5 virtual table and triggers for a collection.
   */
  public dropCollectionFts(collectionName: string): void {
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

  /**
   * Rebuilds the FTS index from scratch by re-indexing base table rows.
   */
  public rebuildIndex(collectionName: string): void {
    const ftsTable = getFtsTableName(collectionName);
    const existingColumns = this.getFtsIndexColumns(collectionName);
    if (existingColumns.length === 0) return;

    const quotedCols = existingColumns.map((c) => `"${c}"`).join(', ');
    this.db.transaction(() => {
      this.db.exec(`DELETE FROM "${ftsTable}";`);
      this.db.exec(`
        INSERT INTO "${ftsTable}" (id, ${quotedCols})
        SELECT id, ${quotedCols} FROM "${collectionName}";
      `);
    });
  }

  public sanitizeQuery(query: string): string {
    return sanitizeFtsQuery(query);
  }

  /**
   * Builds the SELECT expressions for BM25 score and highlighted snippets.
   */
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
    // Escape single quotes to prevent SQL syntax errors and injection
    const ellipsis = rawEllipsis.replace(/'/g, "''");

    const selects: string[] = [
      `bm25("${ftsTable}") AS "${FTS_SCORE_ALIAS}"`,
      `snippet("${ftsTable}", -1, '${startTag}', '${endTag}', '${ellipsis}', ${length}) AS "${FTS_SNIPPET_ALIAS}"`,
    ];

    ftsFields.forEach((field, idx) => {
      // Column 0 in FTS table is 'id', so fields start at index 1
      const colIdx = idx + 1;
      selects.push(
        `snippet("${ftsTable}", ${colIdx}, '${startTag}', '${endTag}', '${ellipsis}', ${length}) AS "${FTS_SNIPPET_FIELD_PREFIX}${field.name}"`
      );
    });

    return selects.join(', ');
  }

  /**
   * Post-processes raw DB result rows to format _score, _snippet, and _snippets map.
   */
  public attachSnippetsAndScore(rows: any[], ftsFields: SchemaField[]): void {
    for (const row of rows) {
      if (!row) continue;
      if (row[FTS_SCORE_ALIAS] !== undefined) {
        row._score = Number(row[FTS_SCORE_ALIAS]);
        delete row[FTS_SCORE_ALIAS];
      } else if (row._score !== undefined) {
        row._score = Number(row._score);
      }

      if (row[FTS_SNIPPET_ALIAS] !== undefined) {
        row._snippet = row[FTS_SNIPPET_ALIAS];
        delete row[FTS_SNIPPET_ALIAS];
      }

      const snippets: Record<string, string> = {};
      for (const field of ftsFields) {
        const namespacedKey = `${FTS_SNIPPET_FIELD_PREFIX}${field.name}`;
        const legacyKey = `_snippet_${field.name}`;
        if (row[namespacedKey] !== undefined) {
          snippets[field.name] = row[namespacedKey];
          delete row[namespacedKey];
        } else if (row[legacyKey] !== undefined) {
          snippets[field.name] = row[legacyKey];
          delete row[legacyKey];
        }
      }
      row._snippets = snippets;
    }
  }

  private createFtsTableAndTriggers(
    collectionName: string,
    ftsTable: string,
    fieldNames: string[]
  ): void {
    const quotedFields = fieldNames.map((f) => `"${f}"`).join(', ');

    // 1. Create FTS5 virtual table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS "${ftsTable}" USING fts5(
        id UNINDEXED,
        ${quotedFields},
        tokenize = 'porter unicode61'
      );
    `);

    // 2. Populate existing records if any
    try {
      this.db.exec(`
        INSERT INTO "${ftsTable}" (id, ${quotedFields})
        SELECT id, ${quotedFields} FROM "${collectionName}";
      `);
    } catch {
      // Ignore if table is empty
    }

    // 3. Create real-time sync triggers
    this.createTriggers(collectionName, ftsTable, fieldNames);
  }

  private createTriggers(
    collectionName: string,
    ftsTable: string,
    fieldNames: string[]
  ): void {
    const quotedCols = fieldNames.map((f) => `"${f}"`).join(', ');
    const newQuotedCols = fieldNames.map((f) => `new."${f}"`).join(', ');

    // Drop triggers first to ensure fresh definitions
    try {
      this.db.exec(`DROP TRIGGER IF EXISTS "${ftsTable}_ai";`);
      this.db.exec(`DROP TRIGGER IF EXISTS "${ftsTable}_au";`);
      this.db.exec(`DROP TRIGGER IF EXISTS "${ftsTable}_ad";`);
    } catch {
      // ignore
    }

    // AFTER INSERT
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS "${ftsTable}_ai" AFTER INSERT ON "${collectionName}" BEGIN
        INSERT INTO "${ftsTable}" (id, ${quotedCols}) VALUES (new.id, ${newQuotedCols});
      END;
    `);

    // AFTER UPDATE
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS "${ftsTable}_au" AFTER UPDATE ON "${collectionName}" BEGIN
        DELETE FROM "${ftsTable}" WHERE id = old.id;
        INSERT INTO "${ftsTable}" (id, ${quotedCols}) VALUES (new.id, ${newQuotedCols});
      END;
    `);

    // AFTER DELETE
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS "${ftsTable}_ad" AFTER DELETE ON "${collectionName}" BEGIN
        DELETE FROM "${ftsTable}" WHERE id = old.id;
      END;
    `);
  }
}
