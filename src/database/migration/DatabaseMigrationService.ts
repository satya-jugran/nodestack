import * as path from 'path';
import { IDatabaseDriver } from '../drivers/IDatabaseDriver';
import { SystemMigrations } from '../migrations/SystemMigrations';
import { ViewQueryValidator } from '../../schema/ViewQueryValidator';
import { ViewSchemaInferrer } from '../../schema/ViewSchemaInferrer';

export interface MigrationSummary {
  appsCount: number;
  collectionsCount: number;
  recordsCount: number;
  elapsedMs: number;
}

export interface MigrationProgress {
  phase: 'starting' | 'system_migrations' | 'collections' | 'records' | 'system_tables' | 'verifying' | 'completed' | 'failed';
  currentTable?: string;
  tableIndex?: number;
  totalTables?: number;
  rowsCopiedInTable?: number;
  totalRowsInTable?: number;
  totalRowsCopied?: number;
  totalRowsOverall?: number;
  percent?: number;
  message: string;
}

export type MigrationProgressCallback = (progress: MigrationProgress) => void;

export interface Migration {
  id: string;
  name?: string;
  up: (driver: IDatabaseDriver) => Promise<void> | void;
  down?: (driver: IDatabaseDriver) => Promise<void> | void;
}

export class DatabaseMigrationService {
  private static migrationMutex: Promise<void> = Promise.resolve();

  private static async acquireMigrationLock(): Promise<() => void> {
    let release: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentLock = DatabaseMigrationService.migrationMutex;
    DatabaseMigrationService.migrationMutex = currentLock.then(() => nextLock).catch(() => nextLock);
    await currentLock;
    return release!;
  }

  /**
   * Executes an async transaction on SQLite while keeping NodeSqliteDriver's internal
   * transactionDepth in sync. This ensures that any nested driver.transaction() calls
   * inside migration.up() use savepoints (sp_1) instead of issuing a second BEGIN IMMEDIATE.
   */
  public static async executeSqliteTransaction<T>(
    driver: IDatabaseDriver,
    fn: (txDriver: IDatabaseDriver) => Promise<T> | T
  ): Promise<T> {
    const sqliteDriver = driver as any;
    const currentDepth = typeof sqliteDriver.transactionDepth === 'number' ? sqliteDriver.transactionDepth : 0;
    const isTopLevel = currentDepth === 0;
    const savepoint = `sp_mig_${currentDepth}`;

    if (isTopLevel) {
      await driver.exec('BEGIN IMMEDIATE;');
    } else {
      await driver.exec(`SAVEPOINT ${savepoint};`);
    }

    if ('transactionDepth' in sqliteDriver) {
      sqliteDriver.transactionDepth++;
    }

    try {
      const result = await fn(driver);
      if (isTopLevel) {
        await driver.exec('COMMIT;');
      } else {
        await driver.exec(`RELEASE SAVEPOINT ${savepoint};`);
      }
      return result;
    } catch (err) {
      try {
        if (isTopLevel) {
          await driver.exec('ROLLBACK;');
        } else {
          await driver.exec(`ROLLBACK TO SAVEPOINT ${savepoint};`);
          await driver.exec(`RELEASE SAVEPOINT ${savepoint};`);
        }
      } catch {}
      throw err;
    } finally {
      if ('transactionDepth' in sqliteDriver) {
        sqliteDriver.transactionDepth--;
      }
    }
  }

  /**
   * Ensures the _migrations tracking table exists.
   */
  public static async ensureMigrationsTable(driver: IDatabaseDriver): Promise<void> {
    const dialect = driver.dialect;
    const pk = dialect.mapFieldType('text', { isPrimaryKey: true });
    const txt = dialect.mapFieldType('text');
    const date = dialect.mapFieldType('date');
    const sql = dialect.createTableIfNotExists(
      '_migrations',
      `id ${pk} PRIMARY KEY, name ${txt} NOT NULL, appliedAt ${date} NOT NULL`
    );
    await driver.exec(sql);
  }

  /**
   * Returns a list of migration IDs that have already been applied and recorded.
   */
  public static async getAppliedMigrations(driver: IDatabaseDriver): Promise<string[]> {
    await DatabaseMigrationService.ensureMigrationsTable(driver);
    try {
      const rows = await driver
        .prepare('SELECT id FROM _migrations ORDER BY appliedAt ASC')
        .all<{ id: string }>();
      const list = rows && typeof (rows as any).then === 'function' ? await rows : rows;
      if (Array.isArray(list)) {
        return list.map((r: any) => r.id);
      }
    } catch {
      // Table might not exist or empty
    }
    return [];
  }

  /**
   * Wraps each migration.up() + recording INSERT in an atomic BEGIN/COMMIT transaction with ROLLBACK on failure.
   * If migration.up() succeeds but the recording INSERT fails (or if migration.up() fails),
   * the transaction rolls back so the schema is not altered without being recorded.
   */
  public static async runMigration(
    driver: IDatabaseDriver,
    migration: Migration
  ): Promise<boolean> {
    const releaseLock = await DatabaseMigrationService.acquireMigrationLock();
    try {
      await DatabaseMigrationService.ensureMigrationsTable(driver);

      const insertSql = `INSERT INTO _migrations (id, name, appliedAt) VALUES (?, ?, ?)`;
      const migrationName = migration.name || migration.id;
      const now = new Date().toISOString();

      if (driver.dialect.name === 'sqlite') {
        return await DatabaseMigrationService.executeSqliteTransaction(driver, async () => {
          const existing = await driver
            .prepare('SELECT id FROM _migrations WHERE id = ?')
            .get<{ id: string }>(migration.id);
          const existingRow = existing && typeof (existing as any).then === 'function' ? await existing : existing;
          if (existingRow) {
            return false; // Already applied
          }

          await migration.up(driver);
          await driver.prepare(insertSql).run(migration.id, migrationName, now);
          return true;
        });
      } else if (typeof driver.transaction === 'function') {
        return await driver.transaction(async (txDriver) => {
          const tx = txDriver || driver;

          if (driver.dialect.name === 'postgres') {
            try {
              await tx.exec('LOCK TABLE _migrations IN SHARE ROW EXCLUSIVE MODE;');
            } catch {
              // ignore if not supported in mock
            }
          }

          const existing = await tx
            .prepare('SELECT id FROM _migrations WHERE id = ?')
            .get<{ id: string }>(migration.id);
          const existingRow = existing && typeof (existing as any).then === 'function' ? await existing : existing;
          if (existingRow) {
            return false; // Already applied
          }

          await migration.up(tx);
          await tx.prepare(insertSql).run(migration.id, migrationName, now);
          return true;
        });
      } else {
        await driver.exec('BEGIN;');
        try {
          const existing = await driver
            .prepare('SELECT id FROM _migrations WHERE id = ?')
            .get<{ id: string }>(migration.id);
          const existingRow = existing && typeof (existing as any).then === 'function' ? await existing : existing;
          if (existingRow) {
            await driver.exec('COMMIT;');
            return false; // Already applied
          }

          await migration.up(driver);
          await driver.prepare(insertSql).run(migration.id, migrationName, now);
          await driver.exec('COMMIT;');
          return true;
        } catch (err) {
          try {
            await driver.exec('ROLLBACK;');
          } catch {}
          throw err;
        }
      }
    } finally {
      releaseLock();
    }
  }

  /**
   * Alias for runMigration to support standard naming conventions.
   */
  public static async applyMigration(
    driver: IDatabaseDriver,
    migration: Migration
  ): Promise<boolean> {
    return DatabaseMigrationService.runMigration(driver, migration);
  }

  /**
   * Runs an array of migrations sequentially, wrapping each migration and its recording INSERT
   * in an atomic transaction with ROLLBACK on failure.
   */
  public static async runMigrations(
    driver: IDatabaseDriver,
    migrations: Migration[]
  ): Promise<string[]> {
    const applied: string[] = [];
    for (const migration of migrations) {
      const wasApplied = await DatabaseMigrationService.runMigration(driver, migration);
      if (wasApplied) {
        applied.push(migration.id);
      }
    }
    return applied;
  }

  /**
   * Rolls back a migration by executing migration.down() and deleting its record within a transaction.
   */
  public static async rollbackMigration(
    driver: IDatabaseDriver,
    migration: Migration
  ): Promise<boolean> {
    if (!migration.down) {
      throw new Error(`Migration '${migration.id}' does not implement down()`);
    }

    const releaseLock = await DatabaseMigrationService.acquireMigrationLock();
    try {
      await DatabaseMigrationService.ensureMigrationsTable(driver);

      const deleteSql = `DELETE FROM _migrations WHERE id = ?`;

      if (driver.dialect.name === 'sqlite') {
        return await DatabaseMigrationService.executeSqliteTransaction(driver, async () => {
          const existing = await driver
            .prepare('SELECT id FROM _migrations WHERE id = ?')
            .get<{ id: string }>(migration.id);
          const existingRow = existing && typeof (existing as any).then === 'function' ? await existing : existing;
          if (!existingRow) {
            return false; // Not applied
          }

          await migration.down!(driver);
          await driver.prepare(deleteSql).run(migration.id);
          return true;
        });
      } else if (typeof driver.transaction === 'function') {
        return await driver.transaction(async (txDriver) => {
          const tx = txDriver || driver;

          if (driver.dialect.name === 'postgres') {
            try {
              await tx.exec('LOCK TABLE _migrations IN SHARE ROW EXCLUSIVE MODE;');
            } catch {
              // ignore if not supported in mock
            }
          }

          const existing = await tx
            .prepare('SELECT id FROM _migrations WHERE id = ?')
            .get<{ id: string }>(migration.id);
          const existingRow = existing && typeof (existing as any).then === 'function' ? await existing : existing;
          if (!existingRow) {
            return false; // Not applied
          }

          await migration.down!(tx);
          await tx.prepare(deleteSql).run(migration.id);
          return true;
        });
      } else {
        await driver.exec('BEGIN;');
        try {
          const existing = await driver
            .prepare('SELECT id FROM _migrations WHERE id = ?')
            .get<{ id: string }>(migration.id);
          const existingRow = existing && typeof (existing as any).then === 'function' ? await existing : existing;
          if (!existingRow) {
            await driver.exec('COMMIT;');
            return false; // Not applied
          }

          await migration.down!(driver);
          await driver.prepare(deleteSql).run(migration.id);
          await driver.exec('COMMIT;');
          return true;
        } catch (err) {
          try {
            await driver.exec('ROLLBACK;');
          } catch {}
          throw err;
        }
      }
    } finally {
      releaseLock();
    }
  }
  public static async migrateAllApps(
    sourceRootDriver: IDatabaseDriver,
    targetRootDriver: IDatabaseDriver,
    appSlugs: string[] = ['default'],
    onProgress?: MigrationProgressCallback
  ): Promise<MigrationSummary> {
    const start = Date.now();
    let totalCollections = 0;
    let totalRecords = 0;

    onProgress?.({
      phase: 'starting',
      percent: 0,
      message: `Starting migration for ${appSlugs.length} app(s)...`,
      totalRowsCopied: 0,
      totalRowsOverall: 0,
    });

    for (let i = 0; i < appSlugs.length; i++) {
      const slug = appSlugs[i];
      let sourceAppDriver: IDatabaseDriver | null = null;
      let targetAppDriver: IDatabaseDriver | null = null;
      try {
        sourceAppDriver = await sourceRootDriver.withSchema(slug);
        targetAppDriver = await targetRootDriver.withSchema(slug);

        const res = await DatabaseMigrationService.migrateAppScope(
          sourceAppDriver,
          targetAppDriver,
          onProgress,
          { appIndex: i, totalApps: appSlugs.length, appSlug: slug }
        );
        totalCollections += res.collectionsCount;
        totalRecords += res.recordsCount;
      } finally {
        if (sourceAppDriver && sourceAppDriver !== sourceRootDriver) {
          try {
            await sourceAppDriver.close();
          } catch {}
        }
        if (targetAppDriver && targetAppDriver !== targetRootDriver) {
          try {
            await targetAppDriver.close();
          } catch {}
        }
      }
    }

    onProgress?.({
      phase: 'completed',
      percent: 100,
      message: `Migration completed: ${totalRecords} records across ${totalCollections} collections migrated.`,
      totalRowsCopied: totalRecords,
      totalRowsOverall: totalRecords,
    });

    return {
      appsCount: appSlugs.length,
      collectionsCount: totalCollections,
      recordsCount: totalRecords,
      elapsedMs: Date.now() - start,
    };
  }

  public static isSameDriver(source: IDatabaseDriver, target: IDatabaseDriver): boolean {
    if (source === target) return true;
    if (source.dialect.name === 'sqlite' && target.dialect.name === 'sqlite') {
      const srcPath = (source as any).getPath?.() || (source as any).filePath;
      const tgtPath = (target as any).getPath?.() || (target as any).filePath;
      if (srcPath && tgtPath && srcPath !== ':memory:' && tgtPath !== ':memory:') {
        return path.resolve(srcPath).toLowerCase() === path.resolve(tgtPath).toLowerCase();
      }
    }
    return false;
  }

  public static async migrateAppScope(
    sourceDriver: IDatabaseDriver,
    targetDriver: IDatabaseDriver,
    onProgress?: MigrationProgressCallback,
    scopeContext?: { appIndex: number; totalApps: number; appSlug: string }
  ): Promise<{ collectionsCount: number; recordsCount: number }> {
    if (DatabaseMigrationService.isSameDriver(sourceDriver, targetDriver)) {
      throw new Error('Cannot migrate database to itself: source and target point to the same database.');
    }

    onProgress?.({
      phase: 'system_migrations',
      percent: 3,
      message: `Running system migrations on target schema (${scopeContext?.appSlug || 'default'})...`,
    });

    // 1. Ensure system tables exist on target
    await SystemMigrations.run(targetDriver);

    let collectionsCount = 0;
    let recordsCount = 0;

    // 2. Read collections from source (partition physical tables before SQL views)
    const allCollections = await sourceDriver
      .prepare('SELECT * FROM _collections ORDER BY created ASC')
      .all<any>();
    const collections = allCollections.filter((c: any) => c.type !== 'view');
    const viewCollections = allCollections.filter((c: any) => c.type === 'view');

    const systemTables = [
      '_admins',
      '_params',
      '_webhooks',
      '_webhook_deliveries',
      '_external_auths',
      '_api_keys',
      '_audit_logs',
      '_logs',
      '_functions',
      '_function_logs',
      '_flows',
      '_flow_executions',
      '_queues',
      '_queue_messages',
      '_plugin_settings',
      '_cron_schedules',
      '_cron_runs',
    ];

    const totalTables = collections.length + systemTables.length;
    let currentTableIdx = 0;

    // Pre-calculate approximate row counts for smooth, accurate progress calculation
    let totalRowsOverall = 0;
    const tableCounts = new Map<string, number>();

    for (const col of collections) {
      try {
        const countRes = await sourceDriver
          .prepare(`SELECT COUNT(*) AS total FROM ${sourceDriver.dialect.quoteIdentifier(col.name)}`)
          .get<{ total: number | string }>();
        const count = Number(countRes?.total || 0);
        tableCounts.set(col.name, count);
        totalRowsOverall += count;
      } catch {
        tableCounts.set(col.name, 0);
      }
    }

    for (const table of systemTables) {
      try {
        const countRes = await sourceDriver
          .prepare(`SELECT COUNT(*) AS total FROM ${sourceDriver.dialect.quoteIdentifier(table)}`)
          .get<{ total: number | string }>();
        const count = Number(countRes?.total || 0);
        tableCounts.set(table, count);
        totalRowsOverall += count;
      } catch {
        tableCounts.set(table, 0);
      }
    }

    const calculatePercent = (copied: number, tableIdx: number): number => {
      if (totalRowsOverall > 0) {
        return Math.min(95, Math.max(5, Math.round(5 + (copied / totalRowsOverall) * 90)));
      }
      if (totalTables > 0) {
        return Math.min(95, Math.max(5, Math.round(5 + (tableIdx / totalTables) * 90)));
      }
      return 50;
    };

    for (const col of collections) {
      currentTableIdx++;
      collectionsCount++;

      const tableTotalRows = tableCounts.get(col.name) || 0;
      onProgress?.({
        phase: 'collections',
        currentTable: col.name,
        tableIndex: currentTableIdx,
        totalTables,
        rowsCopiedInTable: 0,
        totalRowsInTable: tableTotalRows,
        totalRowsCopied: recordsCount,
        totalRowsOverall,
        percent: calculatePercent(recordsCount, currentTableIdx),
        message: `Setting up collection '${col.name}' (${currentTableIdx}/${totalTables})...`,
      });

      // Save metadata in target _collections and ensure table within transaction
      let targetColumns: Set<string>;

      const insertCollectionSql = `
        INSERT INTO _collections (
          id, name, type, system, schema, indexes, listRule, viewRule,
          createRule, updateRule, deleteRule, options, created, updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const insertParams = [
        col.id,
        col.name,
        col.type,
        col.system ? 1 : 0,
        typeof col.schema === 'string' ? col.schema : JSON.stringify(col.schema || []),
        typeof col.indexes === 'string' ? col.indexes : JSON.stringify(col.indexes || []),
        col.listRule,
        col.viewRule,
        col.createRule,
        col.updateRule,
        col.deleteRule,
        typeof col.options === 'string' ? col.options : JSON.stringify(col.options || {}),
        col.created,
        col.updated,
      ];

      if (targetDriver.dialect.name === 'sqlite') {
        targetColumns = await DatabaseMigrationService.executeSqliteTransaction(targetDriver, async () => {
          const exists = await targetDriver
            .prepare('SELECT id FROM _collections WHERE name = ?')
            .get(col.name);

          const cols = await DatabaseMigrationService.ensurePhysicalCollectionTable(col, targetDriver);
          await DatabaseMigrationService.ensureCollectionIndexes(col, targetDriver);

          if (!exists) {
            await targetDriver.prepare(insertCollectionSql).run(...insertParams);
          }
          return cols;
        });
      } else if (typeof targetDriver.transaction === 'function') {
        targetColumns = await targetDriver.transaction(async (tx) => {
          const exists = await tx
            .prepare('SELECT id FROM _collections WHERE name = ?')
            .get(col.name);

          const cols = await DatabaseMigrationService.ensurePhysicalCollectionTable(col, tx);
          await DatabaseMigrationService.ensureCollectionIndexes(col, tx);

          if (!exists) {
            await tx.prepare(insertCollectionSql).run(...insertParams);
          }
          return cols;
        });
      } else {
        await targetDriver.exec('BEGIN;');
        try {
          const exists = await targetDriver
            .prepare('SELECT id FROM _collections WHERE name = ?')
            .get(col.name);

          targetColumns = await DatabaseMigrationService.ensurePhysicalCollectionTable(col, targetDriver);
          await DatabaseMigrationService.ensureCollectionIndexes(col, targetDriver);

          if (!exists) {
            await targetDriver.prepare(insertCollectionSql).run(...insertParams);
          }
          await targetDriver.exec('COMMIT;');
        } catch (colErr) {
          try {
            await targetDriver.exec('ROLLBACK;');
          } catch {}
          throw colErr;
        }
      }

      // Clear any pre-existing records on target collection to avoid duplicate or unique key collisions
      try {
        await targetDriver.exec(`DELETE FROM ${targetDriver.dialect.quoteIdentifier(col.name)}`);
      } catch {}

      // Copy records with deterministic pagination & batched transactions
      const total = tableTotalRows;
      const chunkSize = 500;
      let offset = 0;
      let tableRowsCopied = 0;

      while (offset < total) {
        const pag = sourceDriver.dialect.paginationSql('?', '?', true);
        const rowsSql = `SELECT * FROM ${sourceDriver.dialect.quoteIdentifier(col.name)} ORDER BY ${sourceDriver.dialect.quoteIdentifier('id')} ASC ${pag.clause}`;
        const params = pag.paramOrder === 'limit-first' ? [chunkSize, offset] : [offset, chunkSize];
        const rows = await sourceDriver.prepare(rowsSql).all<any>(...params);

        if (!rows || rows.length === 0) break;

        await targetDriver.transaction(async (tx) => {
          for (const row of rows) {
            await DatabaseMigrationService.insertOrUpdateRecord(col.name, row, tx, targetColumns);
            recordsCount++;
            tableRowsCopied++;
          }
        });

        offset += rows.length;

        onProgress?.({
          phase: 'records',
          currentTable: col.name,
          tableIndex: currentTableIdx,
          totalTables,
          rowsCopiedInTable: tableRowsCopied,
          totalRowsInTable: total,
          totalRowsCopied: recordsCount,
          totalRowsOverall,
          percent: calculatePercent(recordsCount, currentTableIdx),
          message: `Migrating collection '${col.name}': ${tableRowsCopied}/${total} records copied...`,
        });
      }

      // Post-migration count verification
      const targetCountRes = await targetDriver
        .prepare(`SELECT COUNT(*) AS total FROM ${targetDriver.dialect.quoteIdentifier(col.name)}`)
        .get<{ total: number | string }>();
      const targetTotal = Number(targetCountRes?.total || 0);

      if (targetTotal !== total) {
        throw new Error(
          `Migration verification failed for collection '${col.name}': count mismatch (source: ${total}, target: ${targetTotal})`
        );
      }
    }

    // 2.5 Migrate SQL view collections inside a single atomic transaction (with execution & schema-drift verification)
    if (viewCollections.length > 0) {
      const migrateViewsInTx = async (txDriver: IDatabaseDriver) => {
        const rawExistingCols = await txDriver.prepare('SELECT * FROM _collections').all<any>();
        const knownCols = (rawExistingCols || []).map((c: any) => ({
          ...c,
          schema: typeof c.schema === 'string' ? JSON.parse(c.schema || '[]') : (c.schema || []),
          indexes: typeof c.indexes === 'string' ? JSON.parse(c.indexes || '[]') : (c.indexes || []),
          options: typeof c.options === 'string' ? JSON.parse(c.options || '{}') : (c.options || {}),
        }));

        const dbAdapter: any = {
          dialect: txDriver.dialect,
          getRootDriver: () => txDriver,
          all: <T = any>(sql: string, ...params: any[]) => txDriver.prepare(sql).all<T>(...params),
        };

        let pendingViews = [...viewCollections];
        let maxPasses = pendingViews.length + 1;
        let lastErr: any;

        while (pendingViews.length > 0 && maxPasses-- > 0) {
          const nextPending: any[] = [];
          for (const col of pendingViews) {
            const opts = typeof col.options === 'string' ? JSON.parse(col.options || '{}') : (col.options || {});
            const viewQuery = ViewQueryValidator.resolveViewQuery(opts, txDriver.dialect.name);
            if (!viewQuery || !viewQuery.trim()) {
              throw new Error(`View '${col.name}' has no SQL query defined for target dialect '${txDriver.dialect.name}'`);
            }
            const validatedSql = ViewQueryValidator.validate(viewQuery, txDriver.dialect.name, col.name);

            try {
              await txDriver.exec(txDriver.dialect.dropViewIfExists(col.name));
              await txDriver.exec(txDriver.dialect.createViewSql(col.name, validatedSql));
              await txDriver.prepare(`SELECT * FROM ${txDriver.dialect.quoteIdentifier(col.name)} WHERE 1 = 0`).all();

              const targetInferred = await ViewSchemaInferrer.infer({
                db: dbAdapter,
                viewName: col.name,
                selectSql: validatedSql,
                existingCollections: knownCols,
              });
              const sourceSchema = typeof col.schema === 'string' ? JSON.parse(col.schema || '[]') : (col.schema || []);
              ViewSchemaInferrer.assertNoSchemaDrift(sourceSchema, targetInferred, col.name);

              const exists = await txDriver
                .prepare('SELECT id FROM _collections WHERE name = ?')
                .get(col.name);

              if (!exists) {
                await txDriver.prepare(`
                  INSERT INTO _collections (
                    id, name, type, system, schema, indexes, listRule, viewRule,
                    createRule, updateRule, deleteRule, options, created, updated
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                  col.id,
                  col.name,
                  col.type,
                  col.system ? 1 : 0,
                  JSON.stringify(targetInferred),
                  typeof col.indexes === 'string' ? col.indexes : JSON.stringify(col.indexes || []),
                  col.listRule,
                  col.viewRule,
                  null,
                  null,
                  null,
                  typeof col.options === 'string' ? col.options : JSON.stringify(col.options || {}),
                  col.created,
                  col.updated
                );
              }
              knownCols.push({ ...col, schema: targetInferred, options: opts });
              collectionsCount++;
            } catch (err: any) {
              lastErr = err;
              if (err?.statusCode === 400 && /Schema drift detected/i.test(err?.message || '')) {
                throw err;
              }
              nextPending.push(col);
            }
          }

          if (nextPending.length > 0 && (nextPending.length === pendingViews.length || maxPasses === 0)) {
            throw lastErr || new Error('Failed to migrate view collections');
          }
          pendingViews = nextPending;
        }
      };

      if (targetDriver.dialect.name === 'sqlite') {
        await DatabaseMigrationService.executeSqliteTransaction(targetDriver, () => migrateViewsInTx(targetDriver));
      } else if (typeof targetDriver.transaction === 'function') {
        await targetDriver.transaction(migrateViewsInTx);
      } else {
        await targetDriver.exec('BEGIN;');
        try {
          await migrateViewsInTx(targetDriver);
          await targetDriver.exec('COMMIT;');
        } catch (err) {
          try { await targetDriver.exec('ROLLBACK;'); } catch {}
          throw err;
        }
      }
    }

    // 3. Migrate standard system tables (admins, webhooks, audit logs, api keys, etc.)
    for (const table of systemTables) {
      currentTableIdx++;
      const sysCount = tableCounts.get(table) || 0;

      onProgress?.({
        phase: 'system_tables',
        currentTable: table,
        tableIndex: currentTableIdx,
        totalTables,
        rowsCopiedInTable: 0,
        totalRowsInTable: sysCount,
        totalRowsCopied: recordsCount,
        totalRowsOverall,
        percent: calculatePercent(recordsCount, currentTableIdx),
        message: `Migrating system table '${table}' (${currentTableIdx}/${totalTables})...`,
      });

      let sysRowsCopied = 0;
      await DatabaseMigrationService.copyTableIfSourceExists(
        table,
        sourceDriver,
        targetDriver,
        (chunkCount) => {
          recordsCount += chunkCount;
          sysRowsCopied += chunkCount;
          onProgress?.({
            phase: 'system_tables',
            currentTable: table,
            tableIndex: currentTableIdx,
            totalTables,
            rowsCopiedInTable: sysRowsCopied,
            totalRowsInTable: sysCount,
            totalRowsCopied: recordsCount,
            totalRowsOverall,
            percent: calculatePercent(recordsCount, currentTableIdx),
            message: `Migrating system table '${table}': ${sysRowsCopied}/${sysCount} records copied...`,
          });
        }
      );
    }

    return { collectionsCount, recordsCount };
  }

  public static async ensurePhysicalCollectionTable(
    col: any,
    targetDriver: IDatabaseDriver
  ): Promise<Set<string>> {
    const dialect = targetDriver.dialect;
    const fields: any[] = typeof col.schema === 'string' ? JSON.parse(col.schema || '[]') : col.schema || [];

    const columnDefs: string[] = [
      `${dialect.quoteIdentifier('id')} ${dialect.mapFieldType('text', { isPrimaryKey: true })} PRIMARY KEY`,
    ];

    if (col.type === 'auth') {
      columnDefs.push(
        `${dialect.quoteIdentifier('email')} ${dialect.mapFieldType('email', { isUnique: true })} UNIQUE NOT NULL`,
        `${dialect.quoteIdentifier('emailVisibility')} ${dialect.mapFieldType('bool')} NOT NULL DEFAULT ${dialect.booleanLiteral(false)}`,
        `${dialect.quoteIdentifier('verified')} ${dialect.mapFieldType('bool')} NOT NULL DEFAULT ${dialect.booleanLiteral(false)}`,
        `${dialect.quoteIdentifier('passwordHash')} ${dialect.mapFieldType('text')} NOT NULL`,
        `${dialect.quoteIdentifier('tokenKey')} ${dialect.mapFieldType('text')} NOT NULL`
      );
    }

    for (const f of fields) {
      if (['id', 'email', 'emailVisibility', 'verified', 'passwordHash', 'tokenKey', 'created', 'updated'].includes(f.name)) {
        continue;
      }
      const colType = dialect.mapFieldType(f.type, { isUnique: f.unique });
      const nullability = f.required ? 'NOT NULL' : '';
      const unique = f.unique ? 'UNIQUE' : '';
      columnDefs.push(`${dialect.quoteIdentifier(f.name)} ${colType} ${nullability} ${unique}`.trim());
    }

    columnDefs.push(
      `${dialect.quoteIdentifier('created')} ${dialect.mapFieldType('date')} NOT NULL`,
      `${dialect.quoteIdentifier('updated')} ${dialect.mapFieldType('date')} NOT NULL`
    );

    const createSql = dialect.createTableIfNotExists(col.name, columnDefs.join(', '));
    await targetDriver.exec(createSql);

    const existingCols = await DatabaseMigrationService.getTargetTableColumns(col.name, targetDriver);
    if (existingCols.size > 0) {
      for (const f of fields) {
        if (!existingCols.has(f.name)) {
          const colType = dialect.mapFieldType(f.type, { isUnique: f.unique });
          const def = `${dialect.quoteIdentifier(f.name)} ${colType}`;
          try {
            await targetDriver.exec(dialect.addColumnSql(col.name, def));
            existingCols.add(f.name);
          } catch {
            // column might already exist
          }
        }
      }
      return existingCols;
    }

    const definedCols = new Set<string>(['id', 'created', 'updated']);
    if (col.type === 'auth') {
      definedCols.add('email');
      definedCols.add('emailVisibility');
      definedCols.add('verified');
      definedCols.add('passwordHash');
      definedCols.add('tokenKey');
    }
    for (const f of fields) {
      definedCols.add(f.name);
    }
    return definedCols;
  }

  public static async ensureCollectionIndexes(
    col: any,
    targetDriver: IDatabaseDriver
  ): Promise<void> {
    const rawIndexes = typeof col.indexes === 'string'
      ? JSON.parse(col.indexes || '[]')
      : (col.indexes || []);
    if (!Array.isArray(rawIndexes) || rawIndexes.length === 0) return;

    const dialect = targetDriver.dialect;
    for (const idxDef of rawIndexes) {
      if (typeof idxDef !== 'string') continue;
      const trimmed = idxDef.trim();
      if (!trimmed) continue;

      try {
        if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(trimmed)) {
          let sql = trimmed;
          if (dialect.name === 'sqlite' || dialect.name === 'postgres') {
            if (!sql.toUpperCase().includes('IF NOT EXISTS')) {
              sql = sql.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, 'CREATE $1INDEX IF NOT EXISTS ');
            }
          }
          await targetDriver.exec(sql);
        } else {
          const cols = trimmed.split(',').map((c) => c.trim()).filter(Boolean);
          if (cols.length > 0) {
            const indexName = `idx_${col.name}_${cols.join('_').replace(/[^a-zA-Z0-9_]/g, '')}`.slice(0, 60);
            const quotedCols = cols.map((c) => dialect.quoteIdentifier(c)).join(', ');
            const quotedTable = dialect.quoteIdentifier(col.name);
            if (dialect.name === 'mssql') {
              await targetDriver.exec(`
                IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = '${indexName}')
                CREATE INDEX ${dialect.quoteIdentifier(indexName)} ON ${quotedTable} (${quotedCols});
              `);
            } else {
              await targetDriver.exec(`
                CREATE INDEX IF NOT EXISTS ${dialect.quoteIdentifier(indexName)} ON ${quotedTable} (${quotedCols});
              `);
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Migration] Could not create index '${trimmed}' on ${col.name}: ${err.message}`);
      }
    }
  }

  public static async getTargetTableColumns(
    tableName: string,
    targetDriver: IDatabaseDriver
  ): Promise<Set<string>> {
    try {
      const { sql, mapRow } = targetDriver.dialect.getTableColumnsSql(tableName);
      const params = sql.includes('?') ? [tableName] : [];
      const res = targetDriver.prepare(sql).all(...params);
      const rows = res && typeof (res as any).then === 'function' ? await res : res;
      if (Array.isArray(rows) && rows.length > 0) {
        return new Set(rows.map(mapRow).map((c) => c.name));
      }
    } catch {
      // ignore
    }
    return new Set();
  }

  public static getPrimaryKeyColumn(tableName: string): string {
    if (tableName === '_params') return 'key';
    if (tableName === '_queues') return 'name';
    if (tableName === '_plugin_settings') return 'pluginName';
    return 'id';
  }

  public static async insertOrUpdateRecord(
    tableName: string,
    row: Record<string, any>,
    targetDriver: IDatabaseDriver,
    allowedColumns?: Set<string>
  ): Promise<any> {
    const dialect = targetDriver.dialect;
    const allCols = Object.keys(row);
    const columns = allowedColumns && allowedColumns.size > 0
      ? allCols.filter((col) => allowedColumns.has(col))
      : allCols;
    if (columns.length === 0) return;

    const values = columns.map((col) => {
      const val = row[col];
      if (val === undefined || val === null) return null;
      if (typeof val === 'boolean') {
        return dialect.name === 'postgres' ? val : (val ? 1 : 0);
      }
      if (typeof val === 'object' && !(val instanceof Buffer) && !(val instanceof Uint8Array) && !(val instanceof Date)) {
        return JSON.stringify(val);
      }
      return val;
    });

    const pkCol = DatabaseMigrationService.getPrimaryKeyColumn(tableName);
    const updateCols = columns.filter((c) => c !== pkCol);
    const upsertSql = dialect.upsertSql(tableName, columns, pkCol, updateCols);
    return await targetDriver.prepare(upsertSql).run(...values);
  }

  private static async copyTableIfSourceExists(
    tableName: string,
    sourceDriver: IDatabaseDriver,
    targetDriver: IDatabaseDriver,
    onChunkCopied?: (rowsCount: number) => void
  ): Promise<void> {
    try {
      const countRes = await sourceDriver
        .prepare(`SELECT COUNT(*) AS total FROM ${sourceDriver.dialect.quoteIdentifier(tableName)}`)
        .get<{ total: number | string }>();
      const total = Number(countRes?.total || 0);
      if (total === 0) {
        try {
          await targetDriver.exec(`DELETE FROM ${targetDriver.dialect.quoteIdentifier(tableName)}`);
        } catch {
          // Table doesn't exist on target; harmless
        }
        return;
      }

      const pkCol = DatabaseMigrationService.getPrimaryKeyColumn(tableName);
      const targetColumns = await DatabaseMigrationService.getTargetTableColumns(tableName, targetDriver);
      if (targetColumns.size === 0) {
        console.warn(`[Migration] Target table ${tableName} does not exist or has no columns; skipping.`);
        return;
      }

      // Truncate/clear target table first so records from source are imported cleanly without unique key or ID collisions
      try {
        await targetDriver.exec(`DELETE FROM ${targetDriver.dialect.quoteIdentifier(tableName)}`);
      } catch {}

      const chunkSize = 500;
      let offset = 0;

      while (offset < total) {
        const pag = sourceDriver.dialect.paginationSql('?', '?', true);
        const rowsSql = `SELECT * FROM ${sourceDriver.dialect.quoteIdentifier(tableName)} ORDER BY ${sourceDriver.dialect.quoteIdentifier(pkCol)} ASC ${pag.clause}`;
        const params = pag.paramOrder === 'limit-first' ? [chunkSize, offset] : [offset, chunkSize];
        const rows = await sourceDriver.prepare(rowsSql).all<any>(...params);

        if (!rows || rows.length === 0) break;

        await targetDriver.transaction(async (tx) => {
          for (const row of rows) {
            try {
              await DatabaseMigrationService.insertOrUpdateRecord(tableName, row, tx, targetColumns);
            } catch (rowErr: any) {
              console.warn(`[Migration] Could not copy row ${row[pkCol] ?? row.id} in ${tableName}: ${rowErr.message}`);
            }
          }
        });

        offset += rows.length;
        if (onChunkCopied) {
          onChunkCopied(rows.length);
        }
      }
    } catch {
      // Table doesn't exist on source; harmless
    }
  }
}
