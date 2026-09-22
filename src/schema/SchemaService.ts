import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { CollectionModel, CreateCollectionDto, UpdateCollectionDto } from './models/Collection';
import { SchemaField, FieldType } from './models/Field';
import { AppError, ConflictError, NotFoundError } from '../core/errors/AppError';

export class SchemaService {
  constructor(private db: DatabaseService) {}

  public getAllCollections(): CollectionModel[] {
    const rows = this.db.all<any>('SELECT * FROM _collections ORDER BY name ASC');
    return rows.map((r) => this.mapRowToCollection(r));
  }

  public getCollection(nameOrId: string): CollectionModel | undefined {
    const row = this.db.get<any>(
      'SELECT * FROM _collections WHERE id = ? OR name = ?',
      [nameOrId, nameOrId]
    );
    if (!row) return undefined;
    return this.mapRowToCollection(row);
  }

  public getCollectionOrThrow(nameOrId: string): CollectionModel {
    const col = this.getCollection(nameOrId);
    if (!col) {
      throw new NotFoundError(`Collection '${nameOrId}' not found`);
    }
    return col;
  }

  public createCollection(dto: CreateCollectionDto): CollectionModel {
    // Validation
    const cleanName = dto.name.trim().toLowerCase();
    if (!cleanName || !/^[a-zA-Z0-9_]+$/.test(cleanName)) {
      throw new AppError('Collection name must only contain alphanumeric characters and underscores', 400);
    }
    if (cleanName.startsWith('_')) {
      throw new AppError('Custom collection names cannot start with underscore (_)', 400);
    }

    const existing = this.getCollection(cleanName);
    if (existing) {
      throw new ConflictError(`Collection with name '${cleanName}' already exists`);
    }

    const id = dto.id || `c_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const type = dto.type || 'base';
    const schema = (dto.schema || []).map((f) => ({
      ...f,
      id: f.id || `f_${crypto.randomBytes(4).toString('hex')}`,
    }));
    const indexes = dto.indexes || [];
    const options = dto.options || {};

    return this.db.transaction(() => {
      // 1. Create SQL table
      this.createSqlTable(cleanName, type, schema);

      // 2. Insert into _collections
      this.db.prepare(`
        INSERT INTO _collections (
          id, name, type, system, schema, indexes, listRule, viewRule, createRule, updateRule, deleteRule, options, created, updated
        ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        cleanName,
        type,
        JSON.stringify(schema),
        JSON.stringify(indexes),
        dto.listRule !== undefined ? dto.listRule : null,
        dto.viewRule !== undefined ? dto.viewRule : null,
        dto.createRule !== undefined ? dto.createRule : null,
        dto.updateRule !== undefined ? dto.updateRule : null,
        dto.deleteRule !== undefined ? dto.deleteRule : null,
        JSON.stringify(options),
        now,
        now
      );

      return this.getCollectionOrThrow(id);
    });
  }

  public updateCollection(nameOrId: string, dto: UpdateCollectionDto): CollectionModel {
    const current = this.getCollectionOrThrow(nameOrId);
    if (current.system) {
      // Allow modifying rules and non-system fields on system collections like users
    }

    return this.db.transaction(() => {
      const now = new Date().toISOString();
      let targetName = current.name;

      // Handle rename
      if (dto.name && dto.name !== current.name) {
        if (current.system) {
          throw new AppError('Cannot rename system collections', 400);
        }
        const cleanNewName = dto.name.trim().toLowerCase();
        const existing = this.getCollection(cleanNewName);
        if (existing && existing.id !== current.id) {
          throw new ConflictError(`Collection '${cleanNewName}' already exists`);
        }
        this.db.exec(`ALTER TABLE "${current.name}" RENAME TO "${cleanNewName}";`);
        targetName = cleanNewName;
      }

      // Handle schema additions
      const newSchema = dto.schema !== undefined ? dto.schema : current.schema;
      if (dto.schema) {
        this.syncTableColumns(targetName, current.schema, newSchema);
      }

      const listRule = dto.listRule !== undefined ? dto.listRule : current.listRule;
      const viewRule = dto.viewRule !== undefined ? dto.viewRule : current.viewRule;
      const createRule = dto.createRule !== undefined ? dto.createRule : current.createRule;
      const updateRule = dto.updateRule !== undefined ? dto.updateRule : current.updateRule;
      const deleteRule = dto.deleteRule !== undefined ? dto.deleteRule : current.deleteRule;
      const options = dto.options !== undefined ? dto.options : current.options;
      const indexes = dto.indexes !== undefined ? dto.indexes : current.indexes;

      this.db.prepare(`
        UPDATE _collections SET
          name = ?,
          schema = ?,
          indexes = ?,
          listRule = ?,
          viewRule = ?,
          createRule = ?,
          updateRule = ?,
          deleteRule = ?,
          options = ?,
          updated = ?
        WHERE id = ?
      `).run(
        targetName,
        JSON.stringify(newSchema),
        JSON.stringify(indexes),
        listRule,
        viewRule,
        createRule,
        updateRule,
        deleteRule,
        JSON.stringify(options),
        now,
        current.id
      );

      return this.getCollectionOrThrow(current.id);
    });
  }

  public deleteCollection(nameOrId: string): void {
    const current = this.getCollectionOrThrow(nameOrId);
    if (current.system) {
      throw new AppError('Cannot delete system collection', 400);
    }

    this.db.transaction(() => {
      this.db.exec(`DROP TABLE IF EXISTS "${current.name}";`);
      this.db.prepare('DELETE FROM _collections WHERE id = ?').run(current.id);
    });
  }

  private createSqlTable(name: string, type: string, schema: SchemaField[]): void {
    const columns: string[] = ['"id" TEXT PRIMARY KEY'];

    if (type === 'auth') {
      columns.push('"email" TEXT UNIQUE NOT NULL');
      columns.push('"emailVisibility" INTEGER NOT NULL DEFAULT 0');
      columns.push('"verified" INTEGER NOT NULL DEFAULT 0');
      columns.push('"passwordHash" TEXT NOT NULL');
      columns.push('"tokenKey" TEXT NOT NULL');
    }

    for (const field of schema) {
      const colDef = this.fieldToColumnDef(field);
      columns.push(colDef);
    }

    columns.push('"created" TEXT NOT NULL');
    columns.push('"updated" TEXT NOT NULL');

    const sql = `CREATE TABLE IF NOT EXISTS "${name}" (${columns.join(', ')});`;
    this.db.exec(sql);
  }

  private syncTableColumns(tableName: string, oldSchema: SchemaField[], newSchema: SchemaField[]): void {
    const oldFieldNames = new Set(oldSchema.map((f) => f.name.toLowerCase()));
    
    // Check for new fields that need ALTER TABLE ADD COLUMN
    for (const field of newSchema) {
      if (!oldFieldNames.has(field.name.toLowerCase())) {
        const colDef = this.fieldToColumnDef(field);
        try {
          this.db.exec(`ALTER TABLE "${tableName}" ADD COLUMN ${colDef};`);
        } catch (e: any) {
          // Column might already exist
          console.warn(`Column ${field.name} warning:`, e.message);
        }
      }
    }
  }

  private fieldToColumnDef(field: SchemaField): string {
    const sqlType = this.mapFieldTypeToSqlType(field.type);
    let def = `"${field.name}" ${sqlType}`;
    if (field.required) {
      def += ' NOT NULL DEFAULT ""';
    }
    if (field.unique) {
      def += ' UNIQUE';
    }
    return def;
  }

  private mapFieldTypeToSqlType(type: FieldType): string {
    switch (type) {
      case 'number':
        return 'NUMERIC';
      case 'bool':
        return 'INTEGER';
      default:
        return 'TEXT';
    }
  }

  private mapRowToCollection(row: any): CollectionModel {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      system: Boolean(row.system),
      schema: typeof row.schema === 'string' ? JSON.parse(row.schema || '[]') : row.schema || [],
      indexes: typeof row.indexes === 'string' ? JSON.parse(row.indexes || '[]') : row.indexes || [],
      listRule: row.listRule,
      viewRule: row.viewRule,
      createRule: row.createRule,
      updateRule: row.updateRule,
      deleteRule: row.deleteRule,
      options: typeof row.options === 'string' ? JSON.parse(row.options || '{}') : row.options || {},
      created: row.created,
      updated: row.updated,
    };
  }
}
