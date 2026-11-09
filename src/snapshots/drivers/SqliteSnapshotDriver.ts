import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../../database/DatabaseService';
import { ISnapshotDriver } from './ISnapshotDriver';
import { LogicalSnapshotDriver } from './LogicalSnapshotDriver';

export class SqliteSnapshotDriver implements ISnapshotDriver {
  constructor(
    private db: DatabaseService,
    private dbPath: string
  ) {}

  public async captureSnapshot(targetDir: string): Promise<{ dbSizeBytes: number }> {
    await this.db.checkpoint();
    const snapDbPath = path.join(targetDir, 'data.db');
    const normalizedDbPath = snapDbPath.replace(/\\/g, '/');

    await this.db.exec(`VACUUM INTO '${normalizedDbPath}';`);

    if (!fs.existsSync(snapDbPath) || fs.statSync(snapDbPath).size === 0) {
      throw new Error('VACUUM INTO failed to generate a valid snapshot database file.');
    }

    // Also export logical snapshot JSON for seamless cross-database engine portability (Postgres / SQL Server)
    try {
      const logicalDriver = new LogicalSnapshotDriver(this.db);
      await logicalDriver.captureSnapshot(targetDir);
    } catch (e: any) {
      console.warn('[Snapshot] Warning: Failed to export cross-database logical snapshot JSON:', e.message);
    }

    return { dbSizeBytes: fs.statSync(snapDbPath).size };
  }

  public async restoreSnapshot(sourceDir: string): Promise<void> {
    const snapDbPath = path.join(sourceDir, 'data.db');
    if (!fs.existsSync(snapDbPath)) {
      throw new Error(`Snapshot database file not found at ${snapDbPath}`);
    }

    await this.db.close();

    const parentDir = path.dirname(this.dbPath);
    for (const ext of ['-wal', '-shm', '-journal']) {
      const journalFile = `${this.dbPath}${ext}`;
      if (fs.existsSync(journalFile)) {
        try {
          fs.unlinkSync(journalFile);
        } catch {}
      }
    }

    fs.copyFileSync(snapDbPath, this.dbPath);
    await this.db.reconnect();
  }
}
