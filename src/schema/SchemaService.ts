import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { CollectionModel, CreateCollectionDto, UpdateCollectionDto } from './models/Collection';
import { SchemaField, FieldType } from './models/Field';
import { AppError, ConflictError, NotFoundError } from '../core/errors/AppError';
import { FtsService, isReservedFtsFieldName } from '../records/FtsService';

export class SchemaService {
  constructor(private db: DatabaseService, private ftsService?: FtsService) {}

  public setFtsService(ftsService: FtsService): void {
    this.ftsService = ftsService;
  }

  public getAllCollections(): CollectionModel[];
  public getAllCollections(): Promise<CollectionModel[]>;
  public getAllCollections(): any {
    const rows = this.db.all<any>('SELECT * FROM _collections ORDER BY name ASC');
    if (rows && typeof (rows as any).then === 'function') {
      return (rows as any).then((r: any[]) => (r || []).map((x: any) => this.mapRowToCollection(x)));
    }
    return (rows || []).map((r: any) => this.mapRowToCollection(r));
  }

  public getCollection(nameOrId: string): CollectionModel | undefined;
  public getCollection(nameOrId: string): Promise<CollectionModel | undefined>;
  public getCollection(nameOrId: string): any {
    const row = this.db.get<any>(
      'SELECT * FROM _collections WHERE id = ? OR name = ?',
      nameOrId,
      nameOrId
    );
    if (row && typeof (row as any).then === 'function') {
      return (row as any).then((r: any) => (!r ? undefined : this.mapRowToCollection(r)));
    }
    if (!row) return undefined;
    return this.mapRowToCollection(row);
  }

  public getCollectionOrThrow(nameOrId: string): CollectionModel;
  public getCollectionOrThrow(nameOrId: string): Promise<CollectionModel>;
  public getCollectionOrThrow(nameOrId: string): any {
    const col = this.getCollection(nameOrId);
    if (col && typeof (col as any).then === 'function') {
      return (col as any).then((c: CollectionModel | undefined) => {
        if (!c) {
          throw new NotFoundError(`Collection '${nameOrId}' not found`);
        }
        return c;
      });
    }
    if (!col) {
      throw new NotFoundError(`Collection '${nameOrId}' not found`);
    }
    return col;
  }

  public createCollection(dto: CreateCollectionDto): CollectionModel;
  public createCollection(dto: CreateCollectionDto): Promise<CollectionModel>;
  public createCollection(dto: CreateCollectionDto): any {
    const cleanName = dto.name.trim().toLowerCase();
    if (!cleanName || !/^[a-zA-Z0-9_]+$/.test(cleanName)) {
      throw new AppError('Collection name must only contain alphanumeric characters and underscores', 400);
    }
    const isSystem = Boolean(dto.system);
    if (!isSystem && cleanName.startsWith('_')) {
      throw new AppError('Custom collection names cannot start with underscore (_)', 400);
    }

    if (dto.id !== undefined && dto.id !== null && String(dto.id).trim() !== '') {
      const cleanId = String(dto.id).trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(cleanId)) {
        throw new AppError('Collection ID must only contain alphanumeric characters, underscores, and hyphens', 400);
      }
    }

    const id = (dto.id && String(dto.id).trim()) || `c_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const type = dto.type || 'base';

    if (dto.schema && Array.isArray(dto.schema)) {
      this.validateSchemaFields(dto.schema, type);
    }
    const schema = (dto.schema || []).map((f) => ({
      ...f,
      id: f.id || `f_${crypto.randomBytes(4).toString('hex')}`,
    }));
    const indexes = dto.indexes || [];
    const options = dto.options || {};

    const executeCreateSync = () => {
      return this.db.transaction(() => {
        // 1. Create SQL table
        this.createSqlTable(cleanName, type, schema);

        // 2. Insert into _collections
        this.db.prepare(`
          INSERT INTO _collections (
            id, name, type, system, schema, indexes, listRule, viewRule, createRule, updateRule, deleteRule, options, created, updated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          cleanName,
          type,
          isSystem ? 1 : 0,
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

        const created = this.getCollectionOrThrow(id);
        if (this.ftsService) {
          this.ftsService.syncCollection(created);
        }
        return created;
      });
    };

    const executeCreateAsync = async () => {
      return this.db.transaction(async () => {
        // 1. Create SQL table
        await this.createSqlTable(cleanName, type, schema);

        // 2. Insert into _collections
        await this.db.prepare(`
          INSERT INTO _collections (
            id, name, type, system, schema, indexes, listRule, viewRule, createRule, updateRule, deleteRule, options, created, updated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          cleanName,
          type,
          isSystem ? 1 : 0,
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

        const created = await this.getCollectionOrThrow(id);
        if (this.ftsService) {
          await this.ftsService.syncCollection(created);
        }
        return created;
      });
    };

    const existingRes = this.getCollection(cleanName);
    if (this.isAsyncDriver() || (existingRes && typeof (existingRes as any).then === 'function')) {
      return (async () => {
        const existing = existingRes && typeof (existingRes as any).then === 'function'
          ? await existingRes
          : existingRes;
        if (existing) {
          throw new ConflictError(`Collection with name '${cleanName}' already exists`);
        }
        return executeCreateAsync();
      })();
    }

    if (existingRes) {
      throw new ConflictError(`Collection with name '${cleanName}' already exists`);
    }

    return executeCreateSync();
  }

  public registerSystemCollection(dto: CreateCollectionDto): CollectionModel;
  public registerSystemCollection(dto: CreateCollectionDto): Promise<CollectionModel>;
  public registerSystemCollection(dto: CreateCollectionDto): any {
    const cleanName = dto.name.trim().toLowerCase();
    if (!cleanName || !/^[a-zA-Z0-9_]+$/.test(cleanName)) {
      throw new AppError('Collection name must only contain alphanumeric characters and underscores', 400);
    }

    const processExisting = (existing: CollectionModel | undefined) => {
      if (existing) {
        if (!existing.system) {
          throw new ConflictError(
            `Cannot register system collection '${cleanName}': a non-system collection with this name already exists.`
          );
        }

        const declaredFields = dto.schema || [];
        const currentSchema = existing.schema || [];
        const currentNames = new Set(currentSchema.map((f: any) => f.name.toLowerCase()));
        const fieldsToAdd: SchemaField[] = [];

        for (const field of declaredFields) {
          if (!currentNames.has(field.name.toLowerCase())) {
            fieldsToAdd.push({
              ...field,
              id: field.id || `f_${crypto.randomBytes(4).toString('hex')}`,
            });
          }
        }

        if (fieldsToAdd.length > 0) {
          const mergedSchema = [...currentSchema, ...fieldsToAdd];
          return this.updateCollection(existing.id, {
            schema: mergedSchema,
          });
        }

        return existing;
      }

      return this.createCollection({
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
        ...dto,
        name: cleanName,
        system: true,
      });
    };

    const existingRes = this.getCollection(cleanName);
    if (existingRes && typeof (existingRes as any).then === 'function') {
      return (existingRes as any).then(processExisting);
    }
    return processExisting(existingRes);
  }

  public updateCollection(nameOrId: string, dto: UpdateCollectionDto): CollectionModel;
  public updateCollection(nameOrId: string, dto: UpdateCollectionDto): Promise<CollectionModel>;
  public updateCollection(nameOrId: string, dto: UpdateCollectionDto): any {
    const currentRes = this.getCollectionOrThrow(nameOrId);
    if (this.isAsyncDriver() || (currentRes && typeof (currentRes as any).then === 'function')) {
      return (async () => {
        const current = currentRes && typeof (currentRes as any).then === 'function'
          ? await currentRes
          : currentRes;
        let targetName = current.name;
        const now = new Date().toISOString();

        let cleanNewName: string | undefined;
        if (dto.name && dto.name.trim().toLowerCase() !== current.name) {
          if (current.system) {
            throw new AppError('Cannot rename system collections', 400);
          }
          cleanNewName = dto.name.trim().toLowerCase();
          const existing = await this.getCollection(cleanNewName);
          if (existing && existing.id !== current.id) {
            throw new ConflictError(`Collection '${cleanNewName}' already exists`);
          }
        }

        const newSchema = dto.schema !== undefined ? dto.schema : current.schema;
        if (dto.schema) {
          this.validateSchemaFields(dto.schema, current.type);
        }

        const listRule = dto.listRule !== undefined ? dto.listRule : current.listRule;
        const viewRule = dto.viewRule !== undefined ? dto.viewRule : current.viewRule;
        const createRule = dto.createRule !== undefined ? dto.createRule : current.createRule;
        const updateRule = dto.updateRule !== undefined ? dto.updateRule : current.updateRule;
        const deleteRule = dto.deleteRule !== undefined ? dto.deleteRule : current.deleteRule;
        const options = dto.options !== undefined ? dto.options : current.options;
        const indexes = dto.indexes !== undefined ? dto.indexes : current.indexes;

        return this.db.transaction(async () => {
          if (cleanNewName && cleanNewName !== current.name) {
            if (this.ftsService) {
              await this.ftsService.dropCollectionFts(current.name);
            }
            await this.db.exec(this.db.dialect.renameTableSql(current.name, cleanNewName));
            targetName = cleanNewName;
          }

          if (dto.schema) {
            await this.syncTableColumns(targetName, current.schema, newSchema);
          }

          await this.db.prepare(`
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

          const updated = await this.getCollectionOrThrow(current.id);
          if (this.ftsService) {
            await this.ftsService.syncCollection(updated);
          }
          return updated;
        });
      })();
    }

    const current = currentRes as CollectionModel;
    let targetName = current.name;
    const now = new Date().toISOString();

    return this.db.transaction(() => {
      // Handle rename if provided and changed
      if (dto.name && dto.name.trim().toLowerCase() !== current.name) {
        if (current.system) {
          throw new AppError('Cannot rename system collections', 400);
        }
        const cleanNewName = dto.name.trim().toLowerCase();
        const existing = this.getCollection(cleanNewName);
        if (existing && existing.id !== current.id) {
          throw new ConflictError(`Collection '${cleanNewName}' already exists`);
        }
        if (this.ftsService) {
          this.ftsService.dropCollectionFts(current.name);
        }
        this.db.exec(this.db.dialect.renameTableSql(current.name, cleanNewName));
        targetName = cleanNewName;
      }

      // Handle schema additions
      const newSchema = dto.schema !== undefined ? dto.schema : current.schema;
      if (dto.schema) {
        this.validateSchemaFields(dto.schema, current.type);
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

      const updated = this.getCollectionOrThrow(current.id);
      if (this.ftsService) {
        this.ftsService.syncCollection(updated);
      }
      return updated;
    });
  }

  public deleteCollection(nameOrId: string): void;
  public deleteCollection(nameOrId: string): Promise<void>;
  public deleteCollection(nameOrId: string): any {
    if (nameOrId.startsWith('_')) {
      throw new AppError('Cannot delete system collection', 400);
    }

    const currentRes = this.getCollectionOrThrow(nameOrId);
    if (this.isAsyncDriver() || (currentRes && typeof (currentRes as any).then === 'function')) {
      return (async () => {
        const current = currentRes && typeof (currentRes as any).then === 'function'
          ? await currentRes
          : currentRes;
        if (current.system) {
          throw new AppError('Cannot delete system collection', 400);
        }
        return this.db.transaction(async () => {
          if (this.ftsService) {
            await this.ftsService.dropCollectionFts(current.name);
          }
          await this.db.exec(this.db.dialect.dropTableIfExists(current.name));
          await this.db.prepare('DELETE FROM _collections WHERE id = ?').run(current.id);
        });
      })();
    }

    const current = currentRes as CollectionModel;
    if (current.system) {
      throw new AppError('Cannot delete system collection', 400);
    }
    return this.db.transaction(() => {
      if (this.ftsService) {
        this.ftsService.dropCollectionFts(current.name);
      }
      this.db.exec(this.db.dialect.dropTableIfExists(current.name));
      this.db.prepare('DELETE FROM _collections WHERE id = ?').run(current.id);
    });
  }

  private validateSchemaFields(schema: SchemaField[], type?: string): void {
    const names = new Set<string>();
    const reservedNames = ['id', 'created', 'updated'];
    if (type === 'auth') {
      reservedNames.push('email', 'emailVisibility', 'verified', 'passwordHash', 'tokenKey');
    }

    for (const f of schema) {
      const clean = f.name?.trim().toLowerCase();
      if (!clean || !/^[a-zA-Z0-9_]+$/.test(clean)) {
        throw new AppError(`Field name '${f.name}' is invalid. Only letters, numbers, and underscores allowed.`, 400);
      }
      if ((f.fts === true || f.options?.fts === true) && (clean === 'rank' || clean === 'rowid')) {
        throw new ConflictError(
          `Field '${f.name}' cannot have FTS indexing enabled because it is a reserved SQLite FTS5 column name`
        );
      }
      if (reservedNames.includes(clean)) {
        throw new ConflictError(`Field name '${f.name}' collides with reserved system field`);
      }
      if (isReservedFtsFieldName(clean)) {
        throw new ConflictError(`Field name '${f.name}' is reserved for search metadata`);
      }
      if (names.has(clean)) {
        throw new AppError(`Duplicate field name '${f.name}' in collection schema`, 400);
      }
      names.add(clean);
    }
  }

  private isAsyncDriver(): boolean {
    return Boolean(this.db.dialect && this.db.dialect.name !== 'sqlite');
  }

  private createSqlTable(name: string, type: string, schema: SchemaField[]): any {
    const dialect = this.db.dialect;
    const pkType = dialect.mapFieldType('text', { isPrimaryKey: true });
    const txtType = dialect.mapFieldType('text');
    const boolType = dialect.mapFieldType('bool');
    const dateType = dialect.mapFieldType('date');

    const columns: string[] = [`${dialect.quoteIdentifier('id')} ${pkType} PRIMARY KEY`];

    if (type === 'auth') {
      const emailType = dialect.mapFieldType('email', { isUnique: true });
      columns.push(`${dialect.quoteIdentifier('email')} ${emailType} UNIQUE NOT NULL`);
      columns.push(`${dialect.quoteIdentifier('emailVisibility')} ${boolType} NOT NULL DEFAULT ${dialect.booleanLiteral(false)}`);
      columns.push(`${dialect.quoteIdentifier('verified')} ${boolType} NOT NULL DEFAULT ${dialect.booleanLiteral(false)}`);
      columns.push(`${dialect.quoteIdentifier('passwordHash')} ${txtType} NOT NULL`);
      columns.push(`${dialect.quoteIdentifier('tokenKey')} ${txtType} NOT NULL`);
    }

    for (const field of schema) {
      const colDef = this.fieldToColumnDef(field);
      columns.push(colDef);
    }

    columns.push(`${dialect.quoteIdentifier('created')} ${dateType} NOT NULL`);
    columns.push(`${dialect.quoteIdentifier('updated')} ${dateType} NOT NULL`);

    const sql = dialect.createTableIfNotExists(name, columns.join(', '));
    return this.db.exec(sql);
  }

  private syncTableColumns(tableName: string, oldSchema: SchemaField[], newSchema: SchemaField[]): any {
    const oldFieldNames = new Set(oldSchema.map((f) => f.name.toLowerCase()));
    const promises: Promise<any>[] = [];

    for (const field of newSchema) {
      if (!oldFieldNames.has(field.name.toLowerCase())) {
        const colDef = this.fieldToColumnDef(field);
        try {
          const res = this.db.exec(this.db.dialect.addColumnSql(tableName, colDef));
          if (res && typeof (res as any).then === 'function') {
            promises.push(res.catch((e: any) => console.warn(`Column ${field.name} warning:`, e.message)));
          }
        } catch (e: any) {
          console.warn(`Column ${field.name} warning:`, e.message);
        }
      }
    }

    if (promises.length > 0) {
      return Promise.all(promises);
    }
  }

  private fieldToColumnDef(field: SchemaField): string {
    const dialect = this.db.dialect;
    const sqlType = dialect.mapFieldType(field.type, { isUnique: field.unique });
    let def = `${dialect.quoteIdentifier(field.name)} ${sqlType}`;
    if (field.required) {
      def += " NOT NULL DEFAULT ''";
    }
    if (field.unique) {
      def += ' UNIQUE';
    }
    return def;
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
