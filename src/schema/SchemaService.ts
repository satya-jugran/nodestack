import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { CollectionModel, CollectionOptions, CreateCollectionDto, UpdateCollectionDto, ViewDialect } from './models/Collection';
import { SchemaField, FieldType } from './models/Field';
import { AppError, ConflictError, NotFoundError } from '../core/errors/AppError';
import { FtsService, isReservedFtsFieldName } from '../records/FtsService';
import { ViewQueryValidator } from './ViewQueryValidator';
import { ViewSchemaDiff, ViewSchemaInferrer } from './ViewSchemaInferrer';
import { RuleEngine } from '../rules/RuleEngine';

export class SchemaService {
  private schemaMutationQueue: Promise<void> = Promise.resolve();

  constructor(private db: DatabaseService, private ftsService?: FtsService) {}

  /**
   * Serializes async schema operations (such as file cleanup + collection drops or concurrent HTTP/CLI mutations)
   * so dependency checks and destructive filesystem/schema mutations execute under one serialized lock.
   */
  public runSerialized<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.schemaMutationQueue.then(fn, fn);
    this.schemaMutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  public setFtsService(ftsService: FtsService): void {
    this.ftsService = ftsService;
  }

  public getAllCollections(): CollectionModel[];
  public getAllCollections(): Promise<CollectionModel[]>;
  public getAllCollections(): any {
    const rootDriver = typeof (this.db as any).getRootDriver === 'function'
      ? (this.db as any).getRootDriver()
      : (this.db as any).getDriver?.();
    if (rootDriver && typeof (rootDriver as any).prepareSync === 'function') {
      const rows = (rootDriver as any).prepareSync('SELECT * FROM _collections ORDER BY name ASC').all();
      return (rows || []).map((x: any) => this.mapRowToCollection(x));
    }
    const rows = this.db.all<any>('SELECT * FROM _collections ORDER BY name ASC');
    return Promise.resolve(rows).then((r: any[]) => (r || []).map((x: any) => this.mapRowToCollection(x)));
  }

  public getCollection(nameOrId: string): CollectionModel | undefined;
  public getCollection(nameOrId: string): Promise<CollectionModel | undefined>;
  public getCollection(nameOrId: string): any {
    const rootDriver = typeof (this.db as any).getRootDriver === 'function'
      ? (this.db as any).getRootDriver()
      : (this.db as any).getDriver?.();
    if (rootDriver && typeof (rootDriver as any).prepareSync === 'function') {
      const row = (rootDriver as any).prepareSync(
        'SELECT * FROM _collections WHERE id = ? OR name = ?'
      ).get(nameOrId, nameOrId);
      if (!row) return undefined;
      return this.mapRowToCollection(row);
    }
    const row = this.db.get<any>(
      'SELECT * FROM _collections WHERE id = ? OR name = ?',
      nameOrId,
      nameOrId
    );
    return Promise.resolve(row).then((r: any) => (!r ? undefined : this.mapRowToCollection(r)));
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
    const indexes = dto.indexes || [];
    const options = dto.options || {};

    let validatedViewQuery: string | undefined;
    if (type === 'view') {
      if (indexes.length > 0) {
        throw new AppError('View collections cannot define physical indexes', 400);
      }
      if (!this.isAsyncDriver()) {
        const authCols = this.getAuthCollectionNames(this.getAllCollections());
        validatedViewQuery = this.validateViewQueriesForOptions(options, this.db.dialect?.name, cleanName, authCols);
      }
    } else if (dto.schema && Array.isArray(dto.schema)) {
      this.validateSchemaFields(dto.schema, type);
    }

    const schema = (dto.schema || []).map((f) => ({
      ...f,
      id: f.id || `f_${crypto.randomBytes(4).toString('hex')}`,
    }));

    const effectiveCreateRule = type === 'view' ? null : (dto.createRule !== undefined ? dto.createRule : null);
    const effectiveUpdateRule = type === 'view' ? null : (dto.updateRule !== undefined ? dto.updateRule : null);
    const effectiveDeleteRule = type === 'view' ? null : (dto.deleteRule !== undefined ? dto.deleteRule : null);

    const executeCreateSync = () => {
      return this.db.transactionSync(() => {
        let finalSchema = schema;
        if (type === 'view' && validatedViewQuery) {
          const existingCols = this.getAllCollections();
          this.recreateSqlViewSync(cleanName, cleanName, validatedViewQuery);
          finalSchema = ViewSchemaInferrer.infer({
            db: this.db,
            viewName: cleanName,
            selectSql: validatedViewQuery,
            existingCollections: existingCols,
            overrides: dto.schema,
          }) as SchemaField[];
        } else {
          // 1. Create SQL table
          this.createSqlTable(cleanName, type, schema);
        }

        // 2. Insert into _collections
        this.db.prepareSync(`
          INSERT INTO _collections (
            id, name, type, system, schema, indexes, listRule, viewRule, createRule, updateRule, deleteRule, options, created, updated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          cleanName,
          type,
          isSystem ? 1 : 0,
          JSON.stringify(finalSchema),
          JSON.stringify(indexes),
          dto.listRule !== undefined ? dto.listRule : null,
          dto.viewRule !== undefined ? dto.viewRule : null,
          effectiveCreateRule,
          effectiveUpdateRule,
          effectiveDeleteRule,
          JSON.stringify(options),
          now,
          now
        );

        const created = this.getCollectionOrThrow(id);
        if (this.ftsService && type !== 'view') {
          this.ftsService.syncCollection(created);
        }
        return created;
      });
    };

    const executeCreateAsync = async () => {
      return this.db.transaction(async () => {
        let finalSchema = schema;
        if (type === 'view') {
          const existingCols = await this.getAllCollections();
          const authCols = this.getAuthCollectionNames(existingCols);
          const viewSql = this.validateViewQueriesForOptions(options, this.db.dialect?.name, cleanName, authCols);
          await this.recreateSqlViewAsync(cleanName, cleanName, viewSql);
          finalSchema = await ViewSchemaInferrer.infer({
            db: this.db,
            viewName: cleanName,
            selectSql: viewSql,
            existingCollections: existingCols,
            overrides: dto.schema,
          });
        } else {
          // 1. Create SQL table
          await this.createSqlTable(cleanName, type, schema);
        }

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
          JSON.stringify(finalSchema),
          JSON.stringify(indexes),
          dto.listRule !== undefined ? dto.listRule : null,
          dto.viewRule !== undefined ? dto.viewRule : null,
          effectiveCreateRule,
          effectiveUpdateRule,
          effectiveDeleteRule,
          JSON.stringify(options),
          now,
          now
        );

        const created = await this.getCollectionOrThrow(id);
        if (this.ftsService && type !== 'view') {
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

  public findDependentViews(nameOrId: string): CollectionModel[];
  public findDependentViews(nameOrId: string): Promise<CollectionModel[]>;
  public findDependentViews(nameOrId: string): any {
    const colRes = this.getCollectionOrThrow(nameOrId);
    if (this.isAsyncDriver() || (colRes && typeof (colRes as any).then === 'function')) {
      return (async () => {
        const col = colRes && typeof (colRes as any).then === 'function' ? await colRes : colRes;
        const allCols = await this.getAllCollections();
        return this.computeDependentViews(allCols, col.name);
      })();
    }
    const col = colRes as CollectionModel;
    const allCols = this.getAllCollections();
    return this.computeDependentViews(allCols, col.name);
  }

  public assertNoViewDependents(
    nameOrId: string,
    operation: 'delete' | 'rename' | 'modify',
    options?: { force?: boolean; cascade?: boolean }
  ): void | Promise<void> {
    const force = this.resolveStrictBooleanFlag('force', options?.force);
    const cascade = this.resolveStrictBooleanFlag('cascade', options?.cascade);
    this.validateForceAndCascade(force, cascade);
    const colRes = this.getCollectionOrThrow(nameOrId);
    if (this.isAsyncDriver() || (colRes && typeof (colRes as any).then === 'function')) {
      return (async () => {
        const col = colRes && typeof (colRes as any).then === 'function' ? await colRes : colRes;
        if (force) return;
        const allCols = await this.getAllCollections();
        const dependents = this.computeDependentViews(allCols, col.name);
        if (dependents.length > 0) {
          throw this.buildViewDependencyConflict(col.name, operation, dependents);
        }
      })();
    }
    const col = colRes as CollectionModel;
    if (force) return;
    const allCols = this.getAllCollections();
    const dependents = this.computeDependentViews(allCols, col.name);
    if (dependents.length > 0) {
      throw this.buildViewDependencyConflict(col.name, operation, dependents);
    }
  }

  public updateCollection(
    nameOrId: string,
    dto: UpdateCollectionDto,
    options?: { force?: boolean; cascade?: boolean }
  ): CollectionModel;
  public updateCollection(
    nameOrId: string,
    dto: UpdateCollectionDto,
    options?: { force?: boolean; cascade?: boolean }
  ): Promise<CollectionModel>;
  public updateCollection(
    nameOrId: string,
    dto: UpdateCollectionDto,
    options?: { force?: boolean; cascade?: boolean }
  ): any {
    const force = this.resolveStrictBooleanFlag('force', options?.force, dto.force);
    const cascade = this.resolveStrictBooleanFlag('cascade', options?.cascade, dto.cascade);
    this.validateForceAndCascade(force, cascade);

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

        const isRename = Boolean(cleanNewName && cleanNewName !== current.name);
        const isViewQueryEdit =
          current.type === 'view' &&
          this.hasViewQueriesChanged(current.options?.viewQueries, dto.options?.viewQueries);
        const depOperation: 'rename' | 'modify' | null = isRename
          ? 'rename'
          : isViewQueryEdit
            ? 'modify'
            : null;

        const initialAllCols = await this.getAllCollections();
        const dependents = depOperation ? this.computeDependentViews(initialAllCols, current.name) : [];
        if (depOperation && dependents.length > 0 && !force) {
          throw this.buildViewDependencyConflict(current.name, depOperation, dependents);
        }

        let newSchema = dto.schema !== undefined ? dto.schema : current.schema;
        if (dto.schema && current.type !== 'view') {
          this.validateSchemaFields(dto.schema, current.type);
        }

        const listRule = dto.listRule !== undefined ? dto.listRule : current.listRule;
        const viewRule = dto.viewRule !== undefined ? dto.viewRule : current.viewRule;
        const createRule = current.type === 'view' ? null : (dto.createRule !== undefined ? dto.createRule : current.createRule);
        const updateRule = current.type === 'view' ? null : (dto.updateRule !== undefined ? dto.updateRule : current.updateRule);
        const deleteRule = current.type === 'view' ? null : (dto.deleteRule !== undefined ? dto.deleteRule : current.deleteRule);
        const optionsVal = dto.options !== undefined ? dto.options : current.options;
        const indexes = dto.indexes !== undefined ? dto.indexes : current.indexes;

        if (current.type === 'view' && Array.isArray(indexes) && indexes.length > 0) {
          throw new AppError('View collections cannot define physical indexes', 400);
        }

        return this.db.transaction(async () => {
          if (depOperation && dependents.length > 0 && force && cascade) {
            for (const dep of [...dependents].reverse()) {
              await this.db.exec(this.db.dialect.dropViewIfExists(dep.name));
            }
          }

          if (current.type === 'view') {
            if (cleanNewName && cleanNewName !== current.name) {
              targetName = cleanNewName;
            }
            const allCols = await this.getAllCollections();
            const authCols = this.getAuthCollectionNames(allCols);
            const viewSql = this.validateViewQueriesForOptions(optionsVal, this.db.dialect?.name, cleanNewName || current.name, authCols);
            await this.recreateSqlViewAsync(current.name, targetName, viewSql);
            newSchema = await ViewSchemaInferrer.infer({
              db: this.db,
              viewName: targetName,
              selectSql: viewSql,
              existingCollections: allCols.filter((c: CollectionModel) => c.id !== current.id),
              overrides: dto.schema,
            });
            this.assertViewRulesValid(targetName, listRule, viewRule, newSchema);
          } else {
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
            JSON.stringify(optionsVal),
            now,
            current.id
          );

          const updated = await this.getCollectionOrThrow(current.id);
          if (this.ftsService && updated.type !== 'view') {
            await this.ftsService.syncCollection(updated);
          }

          if (depOperation && dependents.length > 0 && force && cascade) {
            await this.replayDependentViewsAsync(dependents, current.name, targetName, isRename, now);
          }

          return updated;
        });
      })();
    }

    const current = currentRes as CollectionModel;
    let targetName = current.name;
    const now = new Date().toISOString();

    return this.db.transactionSync(() => {
      let cleanNewName: string | undefined;
      if (dto.name && dto.name.trim().toLowerCase() !== current.name) {
        if (current.system) {
          throw new AppError('Cannot rename system collections', 400);
        }
        cleanNewName = dto.name.trim().toLowerCase();
        const existing = this.getCollection(cleanNewName);
        if (existing && existing.id !== current.id) {
          throw new ConflictError(`Collection '${cleanNewName}' already exists`);
        }
        targetName = cleanNewName;
      }

      const isRename = Boolean(cleanNewName && cleanNewName !== current.name);
      const isViewQueryEdit =
        current.type === 'view' &&
        this.hasViewQueriesChanged(current.options?.viewQueries, dto.options?.viewQueries);
      const depOperation: 'rename' | 'modify' | null = isRename
        ? 'rename'
        : isViewQueryEdit
          ? 'modify'
          : null;

      const initialAllCols = this.getAllCollections();
      const dependents = depOperation ? this.computeDependentViews(initialAllCols, current.name) : [];
      if (depOperation && dependents.length > 0 && !force) {
        throw this.buildViewDependencyConflict(current.name, depOperation, dependents);
      }

      const listRule = dto.listRule !== undefined ? dto.listRule : current.listRule;
      const viewRule = dto.viewRule !== undefined ? dto.viewRule : current.viewRule;
      const createRule = current.type === 'view' ? null : (dto.createRule !== undefined ? dto.createRule : current.createRule);
      const updateRule = current.type === 'view' ? null : (dto.updateRule !== undefined ? dto.updateRule : current.updateRule);
      const deleteRule = current.type === 'view' ? null : (dto.deleteRule !== undefined ? dto.deleteRule : current.deleteRule);
      const optionsVal = dto.options !== undefined ? dto.options : current.options;
      const indexes = dto.indexes !== undefined ? dto.indexes : current.indexes;

      if (current.type === 'view' && Array.isArray(indexes) && indexes.length > 0) {
        throw new AppError('View collections cannot define physical indexes', 400);
      }

      if (depOperation && dependents.length > 0 && force && cascade) {
        for (const dep of [...dependents].reverse()) {
          this.db.execSync(this.db.dialect.dropViewIfExists(dep.name));
        }
      }

      let newSchema = dto.schema !== undefined ? dto.schema : current.schema;
      if (current.type === 'view') {
        const allCols = this.getAllCollections();
        const authCols = this.getAuthCollectionNames(allCols);
        const validatedViewQuery = this.validateViewQueriesForOptions(optionsVal, this.db.dialect?.name, targetName, authCols);
        this.recreateSqlViewSync(current.name, targetName, validatedViewQuery);
        newSchema = ViewSchemaInferrer.infer({
          db: this.db,
          viewName: targetName,
          selectSql: validatedViewQuery,
          existingCollections: allCols.filter((c: CollectionModel) => c.id !== current.id),
          overrides: dto.schema,
        }) as SchemaField[];
        this.assertViewRulesValid(targetName, listRule, viewRule, newSchema);
      } else {
        if (cleanNewName && cleanNewName !== current.name) {
          if (this.ftsService) {
            this.ftsService.dropCollectionFts(current.name);
          }
          this.db.execSync(this.db.dialect.renameTableSql(current.name, cleanNewName));
        }

        if (dto.schema) {
          this.validateSchemaFields(dto.schema, current.type);
          this.syncTableColumns(targetName, current.schema, newSchema);
        }
      }

      this.db.prepareSync(`
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
        JSON.stringify(optionsVal),
        now,
        current.id
      );

      const updated = this.getCollectionOrThrow(current.id);
      if (this.ftsService && updated.type !== 'view') {
        this.ftsService.syncCollection(updated);
      }

      if (depOperation && dependents.length > 0 && force && cascade) {
        this.replayDependentViewsSync(dependents, current.name, targetName, isRename, now);
      }

      return updated;
    });
  }

  public deleteCollection(
    nameOrId: string,
    options: {
      force?: boolean;
      cascade?: boolean;
      beforeDrop: (col: CollectionModel, dependents: CollectionModel[]) => Promise<void> | void;
    }
  ): Promise<void>;
  public deleteCollection(
    nameOrId: string,
    options?: { force?: boolean; cascade?: boolean }
  ): void;
  public deleteCollection(
    nameOrId: string,
    options?: { force?: boolean; cascade?: boolean }
  ): Promise<void>;
  public deleteCollection(
    nameOrId: string,
    options?: {
      force?: boolean;
      cascade?: boolean;
      beforeDrop?: (col: CollectionModel, dependents: CollectionModel[]) => Promise<void> | void;
    }
  ): any {
    if (nameOrId.startsWith('_')) {
      throw new AppError('Cannot delete system collection', 400);
    }

    const force = this.resolveStrictBooleanFlag('force', options?.force);
    const cascade = this.resolveStrictBooleanFlag('cascade', options?.cascade);
    this.validateForceAndCascade(force, cascade);

    const dropSchemaSync = (current: CollectionModel, dependents: CollectionModel[]): void => {
      this.db.transactionSync(() => {
        if (dependents.length > 0 && force && cascade) {
          for (const dep of [...dependents].reverse()) {
            this.db.execSync(this.db.dialect.dropViewIfExists(dep.name));
            this.db.prepareSync('DELETE FROM _collections WHERE id = ?').run(dep.id);
          }
        }
        if (this.ftsService && current.type !== 'view') {
          this.ftsService.dropCollectionFts(current.name);
        }
        const dropSql = current.type === 'view'
          ? this.db.dialect.dropViewIfExists(current.name)
          : this.db.dialect.dropTableIfExists(current.name);
        this.db.execSync(dropSql);
        this.db.prepareSync('DELETE FROM _collections WHERE id = ?').run(current.id);
      });
    };

    const dropSchemaAsync = async (current: CollectionModel, dependents: CollectionModel[]): Promise<void> => {
      await this.db.transaction(async () => {
        if (dependents.length > 0 && force && cascade) {
          for (const dep of [...dependents].reverse()) {
            await this.db.exec(this.db.dialect.dropViewIfExists(dep.name));
            await this.db.prepare('DELETE FROM _collections WHERE id = ?').run(dep.id);
          }
        }
        if (this.ftsService && current.type !== 'view') {
          await this.ftsService.dropCollectionFts(current.name);
        }
        const dropSql = current.type === 'view'
          ? this.db.dialect.dropViewIfExists(current.name)
          : this.db.dialect.dropTableIfExists(current.name);
        await this.db.exec(dropSql);
        await this.db.prepare('DELETE FROM _collections WHERE id = ?').run(current.id);
      });
    };

    if (options?.beforeDrop || this.isAsyncDriver()) {
      return this.runSerialized(async () => {
        const current = await Promise.resolve(this.getCollectionOrThrow(nameOrId));
        if (current.system) {
          throw new AppError('Cannot delete system collection', 400);
        }
        const allCols = await Promise.resolve(this.getAllCollections());
        const dependents = this.computeDependentViews(allCols, current.name);
        if (dependents.length > 0 && !force) {
          throw this.buildViewDependencyConflict(current.name, 'delete', dependents);
        }

        if (options?.beforeDrop) {
          await options.beforeDrop(current, dependents);
        }

        if (this.isAsyncDriver()) {
          await dropSchemaAsync(current, dependents);
        } else {
          dropSchemaSync(current, dependents);
        }
      });
    }

    const currentRes = this.getCollectionOrThrow(nameOrId);
    if (currentRes && typeof (currentRes as any).then === 'function') {
      return this.runSerialized(async () => {
        const current = await (currentRes as unknown as Promise<CollectionModel>);
        if (current.system) {
          throw new AppError('Cannot delete system collection', 400);
        }
        const allCols = await Promise.resolve(this.getAllCollections());
        const dependents = this.computeDependentViews(allCols, current.name);
        if (dependents.length > 0 && !force) {
          throw this.buildViewDependencyConflict(current.name, 'delete', dependents);
        }
        await dropSchemaAsync(current, dependents);
      });
    }

    const current = currentRes as CollectionModel;
    if (current.system) {
      throw new AppError('Cannot delete system collection', 400);
    }
    const allCols = this.getAllCollections();
    const dependents = this.computeDependentViews(allCols, current.name);
    if (dependents.length > 0 && !force) {
      throw this.buildViewDependencyConflict(current.name, 'delete', dependents);
    }
    return dropSchemaSync(current, dependents);
  }

  public async previewViewQuery(params: {
    name?: string;
    viewQueries?: Partial<Record<ViewDialect, string>>;
    dialect?: ViewDialect;
    limit?: number;
  }): Promise<{
    valid: boolean;
    staticOnly?: boolean;
    activeDialect: string;
    error?: string;
    schema: SchemaField[];
    rows: Array<Record<string, any>>;
    schemaDiff?: ViewSchemaDiff;
    ruleWarnings?: string[];
  }> {
    const dialect = this.db.dialect;
    const activeDialect = (dialect?.name || 'sqlite') as ViewDialect;
    const targetDialect = (params.dialect || activeDialect) as ViewDialect;
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 25));
    const cleanViewName = params.name ? params.name.trim().toLowerCase() : undefined;
    const rawQuery = params.viewQueries?.[targetDialect] || '';

    const existingColsForAuth = !this.isAsyncDriver()
      ? this.getAllCollections()
      : await this.getAllCollections();
    const authCols = this.getAuthCollectionNames(existingColsForAuth);

    let validatedSql: string;
    try {
      validatedSql = ViewQueryValidator.validate(rawQuery, targetDialect, cleanViewName, authCols);
    } catch (err: any) {
      return {
        valid: false,
        staticOnly: targetDialect !== activeDialect,
        activeDialect,
        error: err?.message || 'Invalid view query',
        schema: [],
        rows: [],
      };
    }

    if (targetDialect !== activeDialect) {
      return {
        valid: true,
        staticOnly: true,
        activeDialect,
        schema: [],
        rows: [],
      };
    }

    const tempViewName = `_nodestack_preview_${crypto.randomBytes(4).toString('hex')}`;
    const previewSelect = dialect.paginate(
      `SELECT * FROM ${dialect.quoteIdentifier(tempViewName)}`,
      limit,
      0
    );

    const buildDiffAndWarnings = (existingCols: CollectionModel[], inferred: SchemaField[]) => {
      if (!cleanViewName) return {};
      const existing = existingCols.find((c) => c.name === cleanViewName && c.type === 'view');
      if (!existing) return {};
      const schemaDiff = ViewSchemaInferrer.diffSchemas(existing.schema, inferred);
      const ruleWarnings = this.collectViewRuleWarnings(existing.listRule, existing.viewRule, inferred);
      return { schemaDiff, ruleWarnings };
    };

    if (!this.isAsyncDriver()) {
      try {
        const existingCols = this.getAllCollections();
        this.recreateSqlViewSync(tempViewName, tempViewName, validatedSql);
        const inferred = ViewSchemaInferrer.infer({
          db: this.db,
          viewName: tempViewName,
          selectSql: validatedSql,
          existingCollections: existingCols,
        }) as SchemaField[];
        const rows = this.db.prepareSync(previewSelect).all<Record<string, any>>() || [];
        return {
          valid: true,
          activeDialect,
          schema: inferred,
          rows,
          ...buildDiffAndWarnings(existingCols, inferred),
        };
      } catch (err: any) {
        return {
          valid: false,
          activeDialect,
          error: err?.message || 'Failed to execute view query',
          schema: [],
          rows: [],
        };
      } finally {
        try {
          this.db.execSync(dialect.dropViewIfExists(tempViewName));
        } catch {}
      }
    }

    try {
      const existingCols = await this.getAllCollections();
      await this.recreateSqlViewAsync(tempViewName, tempViewName, validatedSql);
      const inferred = await ViewSchemaInferrer.infer({
        db: this.db,
        viewName: tempViewName,
        selectSql: validatedSql,
        existingCollections: existingCols,
      });
      const rows = (await this.db.all<Record<string, any>>(previewSelect)) || [];
      return {
        valid: true,
        activeDialect,
        schema: inferred,
        rows,
        ...buildDiffAndWarnings(existingCols, inferred),
      };
    } catch (err: any) {
      return {
        valid: false,
        activeDialect,
        error: err?.message || 'Failed to execute view query',
        schema: [],
        rows: [],
      };
    } finally {
      try {
        await this.db.exec(dialect.dropViewIfExists(tempViewName));
      } catch {}
    }
  }

  private getAuthCollectionNames(collections: CollectionModel[]): Set<string> {
    const authCols = new Set<string>(['users']);
    for (const c of collections || []) {
      if (c.type === 'auth' && c.name) {
        authCols.add(c.name.toLowerCase());
      }
    }
    return authCols;
  }

  private validateViewQueriesForOptions(
    options: CollectionOptions,
    activeDialectName: string,
    viewName: string,
    authCols?: Set<string>
  ): string {
    const activeQuery = ViewQueryValidator.resolveViewQuery(options, activeDialectName);
    const validatedActive = ViewQueryValidator.validate(activeQuery, activeDialectName, viewName, authCols);

    const viewQueries = options?.viewQueries;
    if (viewQueries && typeof viewQueries === 'object') {
      for (const d of ['sqlite', 'postgres', 'mssql'] as ViewDialect[]) {
        if (d === activeDialectName) continue;
        const sql = viewQueries[d];
        if (typeof sql === 'string' && sql.trim()) {
          ViewQueryValidator.validate(sql, d, viewName, authCols);
        }
      }
    }

    return validatedActive;
  }

  private collectViewRuleWarnings(
    listRule: string | null | undefined,
    viewRule: string | null | undefined,
    newSchema: SchemaField[]
  ): string[] {
    const allowed = new Set(newSchema.map((f) => f.name));
    const warnings: string[] = [];
    for (const [label, rule] of [['listRule', listRule], ['viewRule', viewRule]] as const) {
      for (const ref of RuleEngine.extractReferencedFields(rule)) {
        if (!allowed.has(ref)) {
          warnings.push(`${label} references missing column '${ref}'`);
        }
      }
    }
    return warnings;
  }

  private assertViewRulesValid(
    viewName: string,
    listRule: string | null | undefined,
    viewRule: string | null | undefined,
    newSchema: SchemaField[]
  ): void {
    const warnings = this.collectViewRuleWarnings(listRule, viewRule, newSchema);
    if (warnings.length > 0) {
      throw new AppError(`Cannot update view '${viewName}': ${warnings.join('; ')}`, 400);
    }
  }

  private validateSchemaFields(schema: SchemaField[], type?: string): void {
    const names = new Set<string>();
    const reservedNames = new Set(['id', 'created', 'updated']);
    if (type === 'auth') {
      reservedNames.add('email');
      reservedNames.add('emailvisibility');
      reservedNames.add('verified');
      reservedNames.add('passwordhash');
      reservedNames.add('tokenkey');
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
      if (reservedNames.has(clean)) {
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

  private recreateSqlViewSync(oldName: string, targetName: string, selectSql: string): void {
    const dialect = this.db.dialect;
    const dropOld = dialect.dropViewIfExists(oldName);
    const dropTarget = oldName !== targetName ? dialect.dropViewIfExists(targetName) : null;
    const createSql = dialect.createViewSql(targetName, selectSql);
    const verifySql = `SELECT * FROM ${dialect.quoteIdentifier(targetName)} WHERE 1 = 0`;

    const rootDriver = typeof (this.db as any).getRootDriver === 'function'
      ? (this.db as any).getRootDriver()
      : (this.db as any).getDriver?.();

    if (rootDriver && typeof (rootDriver as any).execSync === 'function') {
      (rootDriver as any).execSync(dropOld);
      if (dropTarget) (rootDriver as any).execSync(dropTarget);
      (rootDriver as any).execSync(createSql);
      (rootDriver as any).prepareSync(verifySql).all();
      return;
    }

    this.db.execSync(dropOld);
    if (dropTarget) this.db.execSync(dropTarget);
    this.db.execSync(createSql);
    this.db.prepareSync(verifySql).all();
  }

  private async recreateSqlViewAsync(oldName: string, targetName: string, selectSql: string): Promise<void> {
    const dialect = this.db.dialect;
    await this.db.exec(dialect.dropViewIfExists(oldName));
    if (oldName !== targetName) {
      await this.db.exec(dialect.dropViewIfExists(targetName));
    }
    // Execute CREATE VIEW in its own batch (required by MSSQL)
    await this.db.exec(dialect.createViewSql(targetName, selectSql));
    // Force engine to resolve tables, columns, and functions at save time
    await this.db.all(`SELECT * FROM ${dialect.quoteIdentifier(targetName)} WHERE 1 = 0`);
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
    const rootDriver = typeof (this.db as any).getRootDriver === 'function'
      ? (this.db as any).getRootDriver()
      : (this.db as any).getDriver?.();
    if (rootDriver && typeof (rootDriver as any).execSync === 'function') {
      (rootDriver as any).execSync(sql);
      return;
    }
    return this.db.exec(sql);
  }

  private syncTableColumns(tableName: string, oldSchema: SchemaField[], newSchema: SchemaField[]): any {
    const oldFieldNames = new Set(oldSchema.map((f) => f.name.toLowerCase()));
    const promises: Promise<any>[] = [];

    for (const field of newSchema) {
      if (!oldFieldNames.has(field.name.toLowerCase())) {
        const colDef = this.fieldToColumnDef(field);
        try {
          const sql = this.db.dialect.addColumnSql(tableName, colDef);
          const rootDriver = typeof (this.db as any).getRootDriver === 'function'
            ? (this.db as any).getRootDriver()
            : (this.db as any).getDriver?.();
          if (rootDriver && typeof (rootDriver as any).execSync === 'function') {
            (rootDriver as any).execSync(sql);
          } else {
            const res = this.db.exec(sql);
            if (res && typeof (res as any).then === 'function') {
              promises.push(res.catch((e: any) => console.warn(`Column ${field.name} warning:`, e.message)));
            }
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
      def += ` NOT NULL DEFAULT ${this.requiredFieldDefault(field.type)}`;
    }
    if (field.unique) {
      def += ' UNIQUE';
    }
    return def;
  }

  private requiredFieldDefault(type: string): string {
    switch (type) {
      case 'number':
        return '0';
      case 'bool':
        return this.db.dialect.booleanLiteral(false);
      case 'json':
        return "'{}'";
      default:
        return "''";
    }
  }

  private resolveStrictBooleanFlag(
    name: 'force' | 'cascade',
    primary?: unknown,
    fallback?: unknown
  ): boolean {
    if (primary !== undefined && typeof primary !== 'boolean') {
      throw new AppError(`Invalid value for '${name}': expected a boolean`, 400);
    }
    if (fallback !== undefined && typeof fallback !== 'boolean') {
      throw new AppError(`Invalid value for '${name}': expected a boolean`, 400);
    }
    const effective = primary !== undefined ? primary : fallback;
    return effective === true;
  }

  private validateForceAndCascade(force?: boolean, cascade?: boolean): void {
    if (cascade && !force) {
      throw new AppError("Option 'cascade=true' requires 'force=true'", 400);
    }
  }

  private buildViewDependencyConflict(
    targetName: string,
    operation: 'delete' | 'rename' | 'modify',
    dependents: CollectionModel[]
  ): ConflictError {
    const depNames = dependents.map((d) => d.name);
    return new ConflictError(
      `Cannot ${operation} '${targetName}' because ${depNames.length} view(s) depend on it: ${depNames.join(', ')}. Pass force=true to proceed.`,
      {
        code: 'VIEW_DEPENDENCY_CONFLICT',
        operation,
        target: targetName,
        dependentViews: depNames,
        requiresForce: true,
        supportsCascade: true,
      }
    );
  }

  private hasViewQueriesChanged(
    prev?: Partial<Record<ViewDialect, string>>,
    next?: Partial<Record<ViewDialect, string>>
  ): boolean {
    if (next === undefined) return false;
    for (const d of ['sqlite', 'postgres', 'mssql'] as ViewDialect[]) {
      const prevSql = typeof prev?.[d] === 'string' ? prev[d]!.trim() : '';
      const nextSql = typeof next?.[d] === 'string' ? next[d]!.trim() : '';
      if (prevSql !== nextSql) return true;
    }
    return false;
  }

  private computeDependentViews(allCols: CollectionModel[], targetName: string): CollectionModel[] {
    const cleanTarget = targetName.trim().toLowerCase();
    const knownCollections = new Set(allCols.map((c) => c.name.toLowerCase()));
    const viewByName = new Map<string, CollectionModel>();
    const directDepsOf = new Map<string, Set<string>>();
    const parentsOf = new Map<string, Set<string>>();

    for (const col of allCols) {
      if (col.type !== 'view') continue;
      const vLower = col.name.toLowerCase();
      viewByName.set(vLower, col);
      const vParents = new Set<string>();
      const queries = col.options?.viewQueries;
      if (queries && typeof queries === 'object') {
        for (const sql of Object.values(queries)) {
          if (typeof sql !== 'string' || !sql.trim()) continue;
          for (const ref of ViewQueryValidator.extractReferencedCollections(sql, knownCollections)) {
            if (ref === vLower) continue;
            vParents.add(ref);
            if (!directDepsOf.has(ref)) directDepsOf.set(ref, new Set<string>());
            directDepsOf.get(ref)!.add(vLower);
          }
        }
      }
      parentsOf.set(vLower, vParents);
    }

    const reachable = new Set<string>();
    const bfsQueue = Array.from(directDepsOf.get(cleanTarget) || []).sort();
    for (const name of bfsQueue) {
      if (!reachable.has(name)) {
        reachable.add(name);
      }
    }
    for (let i = 0; i < bfsQueue.length; i++) {
      const cur = bfsQueue[i];
      for (const child of Array.from(directDepsOf.get(cur) || []).sort()) {
        if (!reachable.has(child)) {
          reachable.add(child);
          bfsQueue.push(child);
        }
      }
    }

    if (reachable.size === 0) return [];

    // Topological sort (parent-before-child) via Kahn's algorithm on the reachable subgraph
    const inDegree = new Map<string, number>();
    for (const node of reachable) {
      let deg = 0;
      for (const p of parentsOf.get(node) || []) {
        if (reachable.has(p)) deg++;
      }
      inDegree.set(node, deg);
    }

    const ready = Array.from(reachable)
      .filter((n) => (inDegree.get(n) || 0) === 0)
      .sort();
    const ordered: string[] = [];

    while (ready.length > 0) {
      const cur = ready.shift()!;
      ordered.push(cur);
      for (const child of Array.from(directDepsOf.get(cur) || []).sort()) {
        if (!reachable.has(child)) continue;
        const nextDeg = (inDegree.get(child) || 0) - 1;
        inDegree.set(child, nextDeg);
        if (nextDeg === 0) {
          ready.push(child);
          ready.sort();
        }
      }
    }

    if (ordered.length < reachable.size) {
      for (const node of Array.from(reachable).sort()) {
        if (!ordered.includes(node)) ordered.push(node);
      }
    }

    return ordered.map((name) => viewByName.get(name)!).filter(Boolean);
  }

  private buildRewrittenViewOptions(
    dep: CollectionModel,
    oldName: string,
    newName: string
  ): CollectionOptions {
    const nextOptions: CollectionOptions = { ...(dep.options || {}) };
    if (dep.options?.viewQueries) {
      const rewritten: Partial<Record<ViewDialect, string>> = {};
      for (const [dialectKey, sql] of Object.entries(dep.options.viewQueries)) {
        if (typeof sql === 'string' && sql.trim()) {
          rewritten[dialectKey as ViewDialect] = ViewQueryValidator.rewriteCollectionReference(
            sql,
            oldName,
            newName
          );
        }
      }
      nextOptions.viewQueries = rewritten;
    }
    return nextOptions;
  }

  private depReferencesRemoved(dep: CollectionModel, removedSet: Set<string>, known: Set<string>): boolean {
    if (removedSet.size === 0) return false;
    for (const sql of Object.values(dep.options?.viewQueries || {})) {
      if (typeof sql !== 'string' || !sql.trim()) continue;
      for (const ref of ViewQueryValidator.extractReferencedCollections(sql, known)) {
        if (removedSet.has(ref)) return true;
      }
    }
    return false;
  }

  private replayDependentViewsSync(
    dependents: CollectionModel[],
    oldTargetName: string,
    newTargetName: string,
    isRename: boolean,
    now: string
  ): void {
    const removedSet = new Set<string>();
    const initialKnown = new Set(this.getAllCollections().map((c) => c.name.toLowerCase()));
    for (const d of dependents) initialKnown.add(d.name.toLowerCase());

    for (const dep of dependents) {
      if (this.depReferencesRemoved(dep, removedSet, initialKnown)) {
        this.db.execSync(this.db.dialect.dropViewIfExists(dep.name));
        this.db.prepareSync('DELETE FROM _collections WHERE id = ?').run(dep.id);
        removedSet.add(dep.name.toLowerCase());
        continue;
      }

      const nextOptions = isRename
        ? this.buildRewrittenViewOptions(dep, oldTargetName, newTargetName)
        : { ...(dep.options || {}) };

      try {
        const allColsNow = this.getAllCollections();
        const authCols = this.getAuthCollectionNames(allColsNow);
        const viewSql = this.validateViewQueriesForOptions(
          nextOptions,
          this.db.dialect?.name,
          dep.name,
          authCols
        );
        this.recreateSqlViewSync(dep.name, dep.name, viewSql);
        const nextSchema = ViewSchemaInferrer.infer({
          db: this.db,
          viewName: dep.name,
          selectSql: viewSql,
          existingCollections: allColsNow.filter((c) => c.id !== dep.id),
        }) as SchemaField[];
        this.assertViewRulesValid(dep.name, dep.listRule, dep.viewRule, nextSchema);
        this.db
          .prepareSync('UPDATE _collections SET schema = ?, options = ?, updated = ? WHERE id = ?')
          .run(JSON.stringify(nextSchema), JSON.stringify(nextOptions), now, dep.id);
      } catch {
        this.db.execSync(this.db.dialect.dropViewIfExists(dep.name));
        this.db.prepareSync('DELETE FROM _collections WHERE id = ?').run(dep.id);
        removedSet.add(dep.name.toLowerCase());
      }
    }
  }

  private async replayDependentViewsAsync(
    dependents: CollectionModel[],
    oldTargetName: string,
    newTargetName: string,
    isRename: boolean,
    now: string
  ): Promise<void> {
    const removedSet = new Set<string>();
    const initialCols = await this.getAllCollections();
    const initialKnown = new Set(initialCols.map((c) => c.name.toLowerCase()));
    for (const d of dependents) initialKnown.add(d.name.toLowerCase());
    const usePgSavepoint = this.db.dialect?.name === 'postgres';

    for (const dep of dependents) {
      if (this.depReferencesRemoved(dep, removedSet, initialKnown)) {
        await this.db.exec(this.db.dialect.dropViewIfExists(dep.name));
        await this.db.prepare('DELETE FROM _collections WHERE id = ?').run(dep.id);
        removedSet.add(dep.name.toLowerCase());
        continue;
      }

      const nextOptions = isRename
        ? this.buildRewrittenViewOptions(dep, oldTargetName, newTargetName)
        : { ...(dep.options || {}) };

      if (usePgSavepoint) {
        await this.db.exec('SAVEPOINT nodestack_dep_replay');
      }
      try {
        const allColsNow = await this.getAllCollections();
        const authCols = this.getAuthCollectionNames(allColsNow);
        const viewSql = this.validateViewQueriesForOptions(
          nextOptions,
          this.db.dialect?.name,
          dep.name,
          authCols
        );
        await this.recreateSqlViewAsync(dep.name, dep.name, viewSql);
        const nextSchema = await ViewSchemaInferrer.infer({
          db: this.db,
          viewName: dep.name,
          selectSql: viewSql,
          existingCollections: allColsNow.filter((c) => c.id !== dep.id),
        });
        this.assertViewRulesValid(dep.name, dep.listRule, dep.viewRule, nextSchema);
        await this.db
          .prepare('UPDATE _collections SET schema = ?, options = ?, updated = ? WHERE id = ?')
          .run(JSON.stringify(nextSchema), JSON.stringify(nextOptions), now, dep.id);
        if (usePgSavepoint) {
          await this.db.exec('RELEASE SAVEPOINT nodestack_dep_replay');
        }
      } catch {
        if (usePgSavepoint) {
          await this.db.exec('ROLLBACK TO SAVEPOINT nodestack_dep_replay');
          await this.db.exec('RELEASE SAVEPOINT nodestack_dep_replay');
        }
        await this.db.exec(this.db.dialect.dropViewIfExists(dep.name));
        await this.db.prepare('DELETE FROM _collections WHERE id = ?').run(dep.id);
        removedSet.add(dep.name.toLowerCase());
      }
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
