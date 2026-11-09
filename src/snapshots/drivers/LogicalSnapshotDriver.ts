import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../../database/DatabaseService';
import { ISnapshotDriver } from './ISnapshotDriver';
import { DatabaseMigrationService } from '../../database/migration/DatabaseMigrationService';

export class LogicalSnapshotDriver implements ISnapshotDriver {
  constructor(private db: DatabaseService) {}

  public async captureSnapshot(targetDir: string): Promise<{ dbSizeBytes: number }> {
    const dumpFile = path.join(targetDir, 'snapshot.json');
    const collections = await this.db.all<any>('SELECT * FROM _collections ORDER BY created ASC');
    const dump: Record<string, any[]> = {
      _collections: collections,
    };

    for (const col of collections) {
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
    if (Array.isArray(data._collections)) {
      for (const col of data._collections) {
        try {
          await DatabaseMigrationService.ensurePhysicalCollectionTable(col, driver);
          await DatabaseMigrationService.ensureCollectionIndexes(col, driver);
        } catch {
          // ignore
        }
      }
    }

    // 2. Clear and restore tables with dialect-aware serialization
    if (this.db.dialect.name === 'sqlite') {
      driver.transaction((tx) => {
        for (const [table, rows] of Object.entries(data)) {
          if (!Array.isArray(rows)) continue;
          try {
            tx.exec(`DELETE FROM ${this.db.dialect.quoteIdentifier(table)}`);
            if (rows.length === 0) continue;

            for (const row of rows) {
              DatabaseMigrationService.insertOrUpdateRecord(table, row, tx);
            }
          } catch {
            // ignore restore errors on secondary tables
          }
        }
      });
    } else {
      await driver.transaction(async (tx) => {
        for (const [table, rows] of Object.entries(data)) {
          if (!Array.isArray(rows)) continue;
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
      });
    }
  }
}
