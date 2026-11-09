import { IDatabaseDriver } from '../drivers/IDatabaseDriver';
import { SystemMigrations } from '../migrations/SystemMigrations';

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

export class DatabaseMigrationService {
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

  public static async migrateAppScope(
    sourceDriver: IDatabaseDriver,
    targetDriver: IDatabaseDriver,
    onProgress?: MigrationProgressCallback,
    scopeContext?: { appIndex: number; totalApps: number; appSlug: string }
  ): Promise<{ collectionsCount: number; recordsCount: number }> {
    onProgress?.({
      phase: 'system_migrations',
      percent: 3,
      message: `Running system migrations on target schema (${scopeContext?.appSlug || 'default'})...`,
    });

    // 1. Ensure system tables exist on target
    await SystemMigrations.run(targetDriver);

    let collectionsCount = 0;
    let recordsCount = 0;

    // 2. Read collections from source
    const collections = await sourceDriver
      .prepare('SELECT * FROM _collections ORDER BY created ASC')
      .all<any>();

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

      // Save metadata in target _collections
      const exists = await targetDriver
        .prepare('SELECT id FROM _collections WHERE name = ?')
        .get(col.name);

      if (!exists) {
        await targetDriver.prepare(`
          INSERT INTO _collections (
            id, name, type, system, schema, indexes, listRule, viewRule,
            createRule, updateRule, deleteRule, options, created, updated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
          col.updated
        );
      }

      // Ensure physical collection table exists on target
      const targetColumns = await DatabaseMigrationService.ensurePhysicalCollectionTable(col, targetDriver);

      // Recreate collection indexes on target
      await DatabaseMigrationService.ensureCollectionIndexes(col, targetDriver);

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

        if (targetDriver.dialect.name === 'sqlite') {
          targetDriver.transaction((tx) => {
            for (const row of rows) {
              DatabaseMigrationService.insertOrUpdateRecord(col.name, row, tx, targetColumns);
              recordsCount++;
              tableRowsCopied++;
            }
          });
        } else {
          await targetDriver.transaction(async (tx) => {
            for (const row of rows) {
              await DatabaseMigrationService.insertOrUpdateRecord(col.name, row, tx, targetColumns);
              recordsCount++;
              tableRowsCopied++;
            }
          });
        }

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

  public static insertOrUpdateRecord(
    tableName: string,
    row: Record<string, any>,
    targetDriver: IDatabaseDriver,
    allowedColumns?: Set<string>
  ): any {
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
    return targetDriver.prepare(upsertSql).run(...values);
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

        if (targetDriver.dialect.name === 'sqlite') {
          targetDriver.transaction((tx) => {
            for (const row of rows) {
              try {
                DatabaseMigrationService.insertOrUpdateRecord(tableName, row, tx, targetColumns);
              } catch (rowErr: any) {
                console.warn(`[Migration] Could not copy row ${row[pkCol] ?? row.id} in ${tableName}: ${rowErr.message}`);
              }
            }
          });
        } else {
          await targetDriver.transaction(async (tx) => {
            for (const row of rows) {
              try {
                await DatabaseMigrationService.insertOrUpdateRecord(tableName, row, tx, targetColumns);
              } catch (rowErr: any) {
                console.warn(`[Migration] Could not copy row ${row[pkCol] ?? row.id} in ${tableName}: ${rowErr.message}`);
              }
            }
          });
        }

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
