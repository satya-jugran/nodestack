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

export class PostgresFtsDriver implements IFtsDriver {
  constructor(private db: DatabaseService) {}

  public async hasFtsIndex(collectionName: string): Promise<boolean> {
    const tableName = getFtsTableName(collectionName);
    const row = await this.db.get<{ table_name: string }>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?',
      tableName
    );
    return Boolean(row?.table_name);
  }

  public async getFtsIndexColumns(collectionName: string): Promise<string[]> {
    const tableName = getFtsTableName(collectionName);
    try {
      const rows = await this.db.all<{ column_name: string }>(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position ASC',
        tableName
      );
      return (rows || [])
        .map((r: any) => r.column_name)
        .filter((n: any) => n !== 'id' && n !== 'search_vector');
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
      await this.db.exec(`DROP TRIGGER IF EXISTS "${ftsTable}_trg" ON "${collectionName}";`);
      await this.db.exec(`DROP FUNCTION IF EXISTS "${ftsTable}_sync"();`);
      await this.db.exec(`DROP TABLE IF EXISTS "${ftsTable}" CASCADE;`);
    } catch {
      // ignore
    }
  }

  public async rebuildIndex(collectionName: string): Promise<void> {
    const ftsTable = getFtsTableName(collectionName);
    const existingColumns = await this.getFtsIndexColumns(collectionName);
    if (existingColumns.length === 0) return;

    const quotedCols = existingColumns.map((c) => `"${c}"`).join(', ');
    const vectorExpr = existingColumns
      .map((c) => `coalesce("${c}", '')`)
      .join(" || ' ' || ");

    await this.db.transaction(async () => {
      await this.db.exec(`DELETE FROM "${ftsTable}";`);
      await this.db.exec(`
        INSERT INTO "${ftsTable}" (id, search_vector, ${quotedCols})
        SELECT id, to_tsvector('simple', ${vectorExpr}), ${quotedCols} FROM "${collectionName}";
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

    const selects: string[] = [
      `ts_rank("${ftsTable}".search_vector, plainto_tsquery('simple', :fts_query)) AS "${FTS_SCORE_ALIAS}"`,
      `ts_headline('simple', "${ftsTable}"."${ftsFields[0]?.name || 'id'}", plainto_tsquery('simple', :fts_query), 'StartSel=${startTag}, StopSel=${endTag}') AS "${FTS_SNIPPET_ALIAS}"`,
    ];

    ftsFields.forEach((field) => {
      selects.push(
        `ts_headline('simple', coalesce("${ftsTable}"."${field.name}", ''), plainto_tsquery('simple', :fts_query), 'StartSel=${startTag}, StopSel=${endTag}') AS "${FTS_SNIPPET_FIELD_PREFIX}${field.name}"`
      );
    });

    return selects.join(', ');
  }

  private async createFtsTableAndTriggers(
    collectionName: string,
    ftsTable: string,
    fieldNames: string[]
  ): Promise<void> {
    const quotedCols = fieldNames.map((c) => `"${c}" TEXT`).join(', ');
    const vectorExpr = fieldNames
      .map((c) => `coalesce("${c}", '')`)
      .join(" || ' ' || ");

    await this.db.transaction(async () => {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS "${ftsTable}" (
          id TEXT PRIMARY KEY,
          search_vector tsvector,
          ${quotedCols}
        );
        CREATE INDEX IF NOT EXISTS "idx_${ftsTable}_vec" ON "${ftsTable}" USING GIN(search_vector);
      `);

      const colNames = fieldNames.map((c) => `"${c}"`).join(', ');
      await this.db.exec(`
        INSERT INTO "${ftsTable}" (id, search_vector, ${colNames})
        SELECT id, to_tsvector('simple', ${vectorExpr}), ${colNames} FROM "${collectionName}";
      `);

      // Trigger function
      const fnName = `"${ftsTable}_sync"`;
      await this.db.exec(`
        CREATE OR REPLACE FUNCTION ${fnName}() RETURNS trigger AS $$
        BEGIN
          IF (TG_OP = 'DELETE') THEN
            DELETE FROM "${ftsTable}" WHERE id = OLD.id;
            RETURN OLD;
          ELSIF (TG_OP = 'UPDATE') THEN
            DELETE FROM "${ftsTable}" WHERE id = OLD.id;
            INSERT INTO "${ftsTable}" (id, search_vector, ${colNames})
            VALUES (NEW.id, to_tsvector('simple', ${fieldNames.map((c) => `coalesce(NEW."${c}", '')`).join(" || ' ' || ")}), ${fieldNames.map((c) => `NEW."${c}"`).join(', ')});
            RETURN NEW;
          ELSIF (TG_OP = 'INSERT') THEN
            INSERT INTO "${ftsTable}" (id, search_vector, ${colNames})
            VALUES (NEW.id, to_tsvector('simple', ${fieldNames.map((c) => `coalesce(NEW."${c}", '')`).join(" || ' ' || ")}), ${fieldNames.map((c) => `NEW."${c}"`).join(', ')});
            RETURN NEW;
          END IF;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER "${ftsTable}_trg"
        AFTER INSERT OR UPDATE OR DELETE ON "${collectionName}"
        FOR EACH ROW EXECUTE FUNCTION ${fnName}();
      `);
    });
  }
}
