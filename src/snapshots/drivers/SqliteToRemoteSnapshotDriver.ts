import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../../database/DatabaseService';
import { ISnapshotDriver } from './ISnapshotDriver';
import { NodeSqliteDriver } from '../../database/drivers/NodeSqliteDriver';
import { DatabaseMigrationService } from '../../database/migration/DatabaseMigrationService';
import { LogicalSnapshotDriver } from './LogicalSnapshotDriver';

/**
 * Driver that restores a SQLite binary snapshot (`data.db`) into a remote database (PostgreSQL / SQL Server)
 * by reading the SQLite file via NodeSqliteDriver and migrating its schema and records via DatabaseMigrationService.
 */
export class SqliteToRemoteSnapshotDriver implements ISnapshotDriver {
  constructor(private db: DatabaseService) {}

  public async captureSnapshot(_targetDir: string): Promise<{ dbSizeBytes: number }> {
    throw new Error('Capture is not supported on SqliteToRemoteSnapshotDriver.');
  }

  public async restoreSnapshot(sourceDir: string): Promise<void> {
    const snapDbPath = path.join(sourceDir, 'data.db');
    if (!fs.existsSync(snapDbPath)) {
      throw new Error(`Snapshot SQLite database file not found at ${snapDbPath}`);
    }

    const sourceDriver = new NodeSqliteDriver(snapDbPath);
    try {
      const targetDriver = this.db.getRootDriver();
      await DatabaseMigrationService.migrateAppScope(sourceDriver, targetDriver);

      // Opportunistically generate snapshot.json in sourceDir so subsequent restores are even faster
      try {
        const logicalDriver = new LogicalSnapshotDriver(this.db);
        await logicalDriver.captureSnapshot(sourceDir);
      } catch {
        // Non-fatal if JSON generation fails
      }
    } finally {
      await sourceDriver.close();
    }
  }
}
