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
import { MaintenanceGate } from '../core/maintenance/MaintenanceGate';

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
  contentHash?: string;
}

export interface DemoSnapshotStatus {
  hasSnapshot: boolean;
  snapshot: DemoSnapshotMetadata | null;
  liveStats?: {
    totalCollections: number;
    totalRecords: number;
    totalFiles: number;
    contentHash?: string;
    drift: {
      collectionsDelta: number;
      recordsDelta: number;
      filesDelta: number;
      contentChanged?: boolean;
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
  private maintenanceGate: MaintenanceGate;

  constructor(
    private config: ConfigService,
    private db: DatabaseService,
    private schemaService: SchemaService,
    private fileStorageService: FileStorageService,
    private eventBus: EventBus,
    private realtimeService: RealtimeService,
    maintenanceGate?: MaintenanceGate
  ) {
    this.maintenanceGate = maintenanceGate || new MaintenanceGate();
  }

  public getGate(): MaintenanceGate {
    return this.maintenanceGate;
  }

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
      const liveContentHash = this.computeStateHash();

      const collectionsDelta = live.totalCollections - metadata.totalCollections;
      const recordsDelta = live.totalRecords - metadata.totalRecords;
      const filesDelta = live.totalFiles - metadata.totalFiles;
      const contentChanged = Boolean(metadata.contentHash && liveContentHash !== metadata.contentHash);
      const isModified = collectionsDelta !== 0 || recordsDelta !== 0 || filesDelta !== 0 || contentChanged;

      return {
        hasSnapshot: true,
        snapshot: metadata,
        liveStats: {
          totalCollections: live.totalCollections,
          totalRecords: live.totalRecords,
          totalFiles: live.totalFiles,
          contentHash: liveContentHash,
          drift: {
            collectionsDelta,
            recordsDelta,
            filesDelta,
            contentChanged,
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

    // 5. Gather statistics and compute baseline content hash
    const live = this.calculateLiveStats();
    const storageStats = this.getDirectoryStats(this.snapshotStorageDir);
    const dbSizeBytes = fs.existsSync(this.snapshotDbPath)
      ? fs.statSync(this.snapshotDbPath).size
      : 0;
    const contentHash = this.computeStateHash();

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
      contentHash,
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

    return await this.maintenanceGate.executeExclusive(async () => {
      const startTime = Date.now();
      const metadata: DemoSnapshotMetadata = JSON.parse(
        fs.readFileSync(this.snapshotMetadataPath, 'utf-8')
      );

      // 1. Lock database and checkpoint WAL journal
      this.db.lock();
      this.db.checkpoint();

      // 2. Safely close database connection
      this.db.close();

      try {
        // 3. Overwrite live data.db with snapshot
        fs.copyFileSync(this.snapshotDbPath, this.config.dbPath);

        // 4. Remove existing WAL and SHM journal files
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

        // 5. Restore file storage
        if (fs.existsSync(this.config.storageDir)) {
          fs.rmSync(this.config.storageDir, { recursive: true, force: true });
        }
        fs.mkdirSync(this.config.storageDir, { recursive: true });

        if (fs.existsSync(this.snapshotStorageDir)) {
          fs.cpSync(this.snapshotStorageDir, this.config.storageDir, { recursive: true });
        }
      } finally {
        // 6. Guaranteed database driver reconnection and unlock
        try {
          this.db.reconnect();
        } finally {
          this.db.unlock();
        }
      }

      const durationMs = Date.now() - startTime;

      // 7. Broadcast SSE realtime event to update all open client sessions
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
    });
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

  /**
   * Computes a deterministic SHA-256 hash representing the full contents of the
   * database (collections schema, indexes, rules, records in every table, admins)
   * and uploaded files storage.
   */
  public computeStateHash(): string {
    const hash = crypto.createHash('sha256');

    // 1. Schema & Collections definition (sorted by collection name)
    const collections = this.schemaService.getAllCollections().sort((a, b) => a.name.localeCompare(b.name));
    for (const c of collections) {
      hash.update(`col:${c.id}:${c.name}:${c.type}:${c.system ? 1 : 0}`);
      hash.update(`schema:${JSON.stringify(c.schema || [])}`);
      hash.update(`indexes:${JSON.stringify(c.indexes || [])}`);
      hash.update(`rules:${c.listRule}:${c.viewRule}:${c.createRule}:${c.updateRule}:${c.deleteRule}`);
      hash.update(`options:${JSON.stringify(c.options || {})}`);
    }

    // 2. Collection records content (sorted by id within each table)
    for (const c of collections) {
      try {
        const rows = this.db.all<Record<string, any>>(`SELECT * FROM "${c.name}" ORDER BY "id" ASC`);
        hash.update(`table:${c.name}:count:${rows.length}`);
        for (const row of rows) {
          const sortedKeys = Object.keys(row).sort();
          const canonicalRow: Record<string, any> = {};
          for (const k of sortedKeys) {
            canonicalRow[k] = row[k];
          }
          hash.update(JSON.stringify(canonicalRow));
        }
      } catch {
        // Table might not exist or query failed
      }
    }

    // 3. Super Admin records
    try {
      const adminRows = this.db.all<Record<string, any>>('SELECT id, email, created, updated FROM _admins ORDER BY "id" ASC');
      hash.update(`admins:count:${adminRows.length}`);
      for (const row of adminRows) {
        hash.update(JSON.stringify(row));
      }
    } catch {
      // ignore
    }

    // 4. File storage manifest (paths, sizes, and md5 content hash sorted by relative path)
    const files = this.getFileManifest(this.config.storageDir);
    hash.update(`files:count:${files.length}`);
    for (const f of files) {
      hash.update(`${f.relPath}:${f.sizeBytes}:${f.md5}`);
    }

    return hash.digest('hex');
  }

  private getFileManifest(dirPath: string): Array<{ relPath: string; sizeBytes: number; md5: string }> {
    const list: Array<{ relPath: string; sizeBytes: number; md5: string }> = [];
    if (!fs.existsSync(dirPath)) return list;

    const walk = (current: string) => {
      try {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            try {
              const stat = fs.statSync(full);
              const relPath = path.relative(dirPath, full).replace(/\\/g, '/');
              const buf = fs.readFileSync(full);
              const md5 = crypto.createHash('md5').update(buf).digest('hex');
              list.push({ relPath, sizeBytes: stat.size, md5 });
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
    return list.sort((a, b) => a.relPath.localeCompare(b.relPath));
  }
}
