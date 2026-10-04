import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { ConfigService } from '../core/config/ConfigService';
import { SchemaService } from '../schema/SchemaService';
import { FileStorageService } from '../files/FileStorageService';
import { EventBus } from '../core/events/EventBus';
import { RealtimeService } from '../realtime/RealtimeService';
import { NotFoundError } from '../core/errors/AppError';

export interface DemoSnapshotOptions {
  name?: string;
  description?: string;
}

export interface DemoCollectionSummary {
  name: string;
  type: string;
  recordsCount: number;
  schemaFieldsCount: number;
}

export interface DemoSnapshotMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  collections: DemoCollectionSummary[];
  totalCollections: number;
  totalRecords: number;
  totalFiles: number;
  storageSizeBytes: number;
  dbSizeBytes: number;
}

export interface DemoSnapshotStatus {
  hasSnapshot: boolean;
  snapshot: DemoSnapshotMetadata | null;
  liveStats?: {
    totalCollections: number;
    totalRecords: number;
    totalFiles: number;
    drift: {
      collectionsDelta: number;
      recordsDelta: number;
      filesDelta: number;
      isModified: boolean;
    };
  };
}

export interface DemoResetResult {
  success: boolean;
  message: string;
  durationMs: number;
  snapshot: DemoSnapshotMetadata;
  restoredAt: string;
}

export class DemoService {
  constructor(
    private config: ConfigService,
    private db: DatabaseService,
    private schemaService: SchemaService,
    private fileStorageService: FileStorageService,
    private eventBus: EventBus,
    private realtimeService: RealtimeService
  ) {}

  public get snapshotDir(): string {
    return path.join(this.config.dataDir, '.demo_snapshot');
  }

  public get snapshotDbPath(): string {
    return path.join(this.snapshotDir, 'data.db');
  }

  public get snapshotMetadataPath(): string {
    return path.join(this.snapshotDir, 'metadata.json');
  }

  public get snapshotStorageDir(): string {
    return path.join(this.snapshotDir, 'storage');
  }

  /**
   * Returns true if a valid demo snapshot currently exists on disk.
   */
  public hasSnapshot(): boolean {
    return fs.existsSync(this.snapshotDbPath) && fs.existsSync(this.snapshotMetadataPath);
  }

  /**
   * Retrieves status and live drift of the database against the frozen demo state.
   */
  public getStatus(): DemoSnapshotStatus {
    if (!this.hasSnapshot()) {
      return {
        hasSnapshot: false,
        snapshot: null,
      };
    }

    try {
      const metadata: DemoSnapshotMetadata = JSON.parse(
        fs.readFileSync(this.snapshotMetadataPath, 'utf-8')
      );
      const live = this.calculateLiveStats();

      const collectionsDelta = live.totalCollections - metadata.totalCollections;
      const recordsDelta = live.totalRecords - metadata.totalRecords;
      const filesDelta = live.totalFiles - metadata.totalFiles;
      const isModified = collectionsDelta !== 0 || recordsDelta !== 0 || filesDelta !== 0;

      return {
        hasSnapshot: true,
        snapshot: metadata,
        liveStats: {
          totalCollections: live.totalCollections,
          totalRecords: live.totalRecords,
          totalFiles: live.totalFiles,
          drift: {
            collectionsDelta,
            recordsDelta,
            filesDelta,
            isModified,
          },
        },
      };
    } catch {
      return {
        hasSnapshot: false,
        snapshot: null,
      };
    }
  }

  /**
   * Freezes current state (database, uploaded files, and metadata) as the demo baseline.
   */
  public async snapshot(options: DemoSnapshotOptions = {}): Promise<DemoSnapshotMetadata> {
    const dir = this.snapshotDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 1. Flush SQLite WAL to disk so data.db has all latest changes
    this.db.checkpoint();

    // 2. Remove old snapshot DB if it exists (VACUUM INTO fails if file already exists)
    if (fs.existsSync(this.snapshotDbPath)) {
      fs.unlinkSync(this.snapshotDbPath);
    }

    // 3. Compact & snapshot SQLite database transactional state
    const normalizedDbPath = this.snapshotDbPath.replace(/\\/g, '/');
    this.db.exec(`VACUUM INTO '${normalizedDbPath}';`);

    // 4. Snapshot uploaded files storage
    if (fs.existsSync(this.snapshotStorageDir)) {
      fs.rmSync(this.snapshotStorageDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.snapshotStorageDir, { recursive: true });

    if (fs.existsSync(this.config.storageDir)) {
      fs.cpSync(this.config.storageDir, this.snapshotStorageDir, { recursive: true });
    }

    // 5. Gather statistics
    const live = this.calculateLiveStats();
    const storageStats = this.getDirectoryStats(this.snapshotStorageDir);
    const dbSizeBytes = fs.existsSync(this.snapshotDbPath)
      ? fs.statSync(this.snapshotDbPath).size
      : 0;

    const metadata: DemoSnapshotMetadata = {
      id: `snap_${crypto.randomBytes(6).toString('hex')}`,
      name: options.name?.trim() || 'Initial Clean State',
      description:
        options.description?.trim() ||
        'Pristine demo baseline state frozen for live client presentations and investor pitches.',
      createdAt: new Date().toISOString(),
      collections: live.collections,
      totalCollections: live.totalCollections,
      totalRecords: live.totalRecords,
      totalFiles: storageStats.count,
      storageSizeBytes: storageStats.sizeBytes,
      dbSizeBytes,
    };

    fs.writeFileSync(
      this.snapshotMetadataPath,
      JSON.stringify(metadata, null, 2),
      'utf-8'
    );

    this.eventBus.emit('demo:snapshot', metadata);

    return metadata;
  }

  /**
   * Restores the exact frozen demo state before the next presentation.
   */
  public async reset(): Promise<DemoResetResult> {
    if (!this.hasSnapshot()) {
      throw new NotFoundError(
        'No demo snapshot found. Please click "Snapshot Demo State" or run "nodestack demo snapshot" to freeze a clean baseline first.'
      );
    }

    const startTime = Date.now();
    const metadata: DemoSnapshotMetadata = JSON.parse(
      fs.readFileSync(this.snapshotMetadataPath, 'utf-8')
    );

    // 1. Safely close database connection
    try {
      this.db.getDriver().close();
    } catch {
      // ignore
    }

    // 2. Overwrite live data.db with snapshot
    fs.copyFileSync(this.snapshotDbPath, this.config.dbPath);

    // 3. Remove existing WAL and SHM journal files
    const walPath = `${this.config.dbPath}-wal`;
    if (fs.existsSync(walPath)) {
      try {
        fs.unlinkSync(walPath);
      } catch {
        // ignore
      }
    }

    const shmPath = `${this.config.dbPath}-shm`;
    if (fs.existsSync(shmPath)) {
      try {
        fs.unlinkSync(shmPath);
      } catch {
        // ignore
      }
    }

    // 4. Reconnect SQLite database driver
    this.db.reconnect();

    // 5. Restore file storage
    if (fs.existsSync(this.config.storageDir)) {
      fs.rmSync(this.config.storageDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.config.storageDir, { recursive: true });

    if (fs.existsSync(this.snapshotStorageDir)) {
      fs.cpSync(this.snapshotStorageDir, this.config.storageDir, { recursive: true });
    }

    const durationMs = Date.now() - startTime;

    // 6. Broadcast SSE realtime event to update all open client sessions
    this.realtimeService.broadcastSystemEvent('DEMO_RESET', {
      timestamp: new Date().toISOString(),
      snapshot: metadata,
      durationMs,
    });

    this.eventBus.emit('demo:reset', { metadata, durationMs });

    return {
      success: true,
      message: `Successfully restored clean demo state '${metadata.name}' in ${durationMs}ms.`,
      durationMs,
      snapshot: metadata,
      restoredAt: new Date().toISOString(),
    };
  }

  /**
   * Deletes the frozen demo snapshot.
   */
  public async clearSnapshot(): Promise<void> {
    if (fs.existsSync(this.snapshotDir)) {
      fs.rmSync(this.snapshotDir, { recursive: true, force: true });
    }
    this.eventBus.emit('demo:clear', { timestamp: new Date().toISOString() });
  }

  /**
   * Helper to compute live records, collections, and storage files.
   */
  private calculateLiveStats(): {
    totalCollections: number;
    totalRecords: number;
    totalFiles: number;
    collections: DemoCollectionSummary[];
  } {
    const collections = this.schemaService.getAllCollections();
    let totalRecords = 0;
    const colDetails: DemoCollectionSummary[] = [];

    for (const c of collections) {
      let count = 0;
      try {
        const row = this.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM "${c.name}"`);
        count = row ? row.count : 0;
      } catch {
        // table might not exist
      }
      totalRecords += count;
      colDetails.push({
        name: c.name,
        type: c.type,
        recordsCount: count,
        schemaFieldsCount: c.schema ? c.schema.length : 0,
      });
    }

    // Count admins
    try {
      const adminRow = this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM _admins');
      if (adminRow?.count) {
        totalRecords += adminRow.count;
      }
    } catch {
      // ignore
    }

    const filesStat = this.getDirectoryStats(this.config.storageDir);

    return {
      totalCollections: collections.length,
      totalRecords,
      totalFiles: filesStat.count,
      collections: colDetails,
    };
  }

  /**
   * Helper to recursively scan file count and size in a directory.
   */
  private getDirectoryStats(dirPath: string): { count: number; sizeBytes: number } {
    let count = 0;
    let sizeBytes = 0;
    if (!fs.existsSync(dirPath)) return { count, sizeBytes };

    const walk = (current: string) => {
      try {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            count++;
            try {
              sizeBytes += fs.statSync(full).size;
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }
    };

    walk(dirPath);
    return { count, sizeBytes };
  }
}
