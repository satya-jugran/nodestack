import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../../database/DatabaseService';
import { ISnapshotDriver } from './ISnapshotDriver';
import { DatabaseMigrationService } from '../../database/migration/DatabaseMigrationService';
import { ViewQueryValidator } from '../../schema/ViewQueryValidator';

export class LogicalSnapshotDriver implements ISnapshotDriver {
  constructor(private db: DatabaseService) {}

  public async captureSnapshot(targetDir: string): Promise<{ dbSizeBytes: number }> {
    const dumpFile = path.join(targetDir, 'snapshot.json');
    const collections = await this.db.all<any>('SELECT * FROM _collections ORDER BY created ASC');
    const dump: Record<string, any[]> = {
      _collections: collections,
    };

    for (const col of collections) {
      if (col.type === 'view') continue;
      try {
        const rows = await this.db.all<any>(`SELECT * FROM ${this.db.dialect.quoteIdentifier(col.name)}`);
        dump[col.name] = rows;
      } catch {
        dump[col.name] = [];
      }
    }

    // Capture standard system tables
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

    for (const table of systemTables) {
      try {
        const rows = await this.db.all<any>(`SELECT * FROM ${this.db.dialect.quoteIdentifier(table)}`);
        dump[table] = rows;
      } catch {
        // table might not exist
      }
    }

    const jsonStr = JSON.stringify(dump, null, 2);
    fs.writeFileSync(dumpFile, jsonStr, 'utf-8');

    return { dbSizeBytes: Buffer.byteLength(jsonStr, 'utf-8') };
  }

  public async restoreSnapshot(sourceDir: string): Promise<void> {
    const dumpFile = path.join(sourceDir, 'snapshot.json');
    if (!fs.existsSync(dumpFile)) {
      throw new Error(`Snapshot JSON file not found at ${dumpFile}`);
    }

    const data: Record<string, any[]> = JSON.parse(fs.readFileSync(dumpFile, 'utf-8'));
    const driver = this.db.getRootDriver();

    // 1. If _collections exists in data, ensure physical collection tables and indexes exist on the target
    const viewCols: any[] = [];
    if (Array.isArray(data._collections)) {
      for (const col of data._collections) {
        if (col.type === 'view') {
          viewCols.push(col);
          continue;
        }
        try {
          await DatabaseMigrationService.ensurePhysicalCollectionTable(col, driver);
          await DatabaseMigrationService.ensureCollectionIndexes(col, driver);
        } catch {
          // ignore
        }
      }
    }

    const viewNames = new Set(viewCols.map((v: any) => v.name));

    // 2. Clear and restore tables and views inside a single transaction
    const authColNames = new Set<string>(['users']);
    if (Array.isArray(data._collections)) {
      for (const c of data._collections) {
        if (c.type === 'auth' && c.name) authColNames.add(String(c.name).toLowerCase());
      }
    }

    await driver.transaction(async (tx) => {
      for (const [table, rows] of Object.entries(data)) {
        if (!Array.isArray(rows) || viewNames.has(table)) continue;
        try {
          await tx.exec(`DELETE FROM ${this.db.dialect.quoteIdentifier(table)}`);
          if (rows.length === 0) continue;

          for (const row of rows) {
            await DatabaseMigrationService.insertOrUpdateRecord(table, row, tx);
          }
        } catch {
          // ignore restore errors on secondary tables
        }
      }

      // 3. Recreate SQL views inside the same transaction so failures roll back _collections & data
      if (viewCols.length > 0) {
        let pendingViews = [...viewCols];
        let maxPasses = pendingViews.length + 1;
        let lastErr: any;

        while (pendingViews.length > 0 && maxPasses-- > 0) {
          const nextPending: any[] = [];
          for (const col of pendingViews) {
            const opts = typeof col.options === 'string' ? JSON.parse(col.options || '{}') : (col.options || {});
            const viewQuery = ViewQueryValidator.resolveViewQuery(opts, this.db.dialect.name);
            if (!viewQuery || !viewQuery.trim()) {
              throw new Error(`View '${col.name}' has no SQL query defined for dialect '${this.db.dialect.name}'`);
            }
            const validatedSql = ViewQueryValidator.validate(viewQuery, this.db.dialect.name, col.name, authColNames);
            try {
              await tx.exec(this.db.dialect.dropViewIfExists(col.name));
              await tx.exec(this.db.dialect.createViewSql(col.name, validatedSql));
              await tx.prepare(`SELECT * FROM ${this.db.dialect.quoteIdentifier(col.name)} WHERE 1 = 0`).all();
            } catch (err: any) {
              lastErr = err;
              nextPending.push(col);
            }
          }

          if (nextPending.length > 0 && (nextPending.length === pendingViews.length || maxPasses === 0)) {
            throw lastErr || new Error('Failed to restore view collections from snapshot');
          }
          pendingViews = nextPending;
        }
      }
    });
  }
}
