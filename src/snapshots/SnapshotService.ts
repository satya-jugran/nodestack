import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { ConfigService } from '../core/config/ConfigService';
import { SchemaService } from '../schema/SchemaService';
import { FileStorageService } from '../files/FileStorageService';
import { EventBus } from '../core/events/EventBus';
import { RealtimeService } from '../realtime/RealtimeService';
import { NotFoundError, ConflictError } from '../core/errors/AppError';
import { MaintenanceGate } from '../core/maintenance/MaintenanceGate';
import {
  SnapshotCollectionSummary,
  SnapshotMetadata,
  SnapshotStatus,
  SnapshotRestoreResult,
  SnapshotCreateOptions,
  SnapshotServicePaths,
  MAX_SNAPSHOTS,
} from './types';

interface SnapshotsManifest {
  activeSnapshotId: string | null;
  snapshots: SnapshotMetadata[];
}

export class SnapshotService {
  private maintenanceGate: MaintenanceGate;
  public readonly maxSnapshots: number = MAX_SNAPSHOTS;

  constructor(
    private config: ConfigService,
    private db: DatabaseService,
    private schemaService: SchemaService,
    private fileStorageService: FileStorageService,
    private eventBus: EventBus,
    private realtimeService: RealtimeService,
    maintenanceGate?: MaintenanceGate,
    private customPaths?: SnapshotServicePaths
  ) {
    this.maintenanceGate = maintenanceGate || new MaintenanceGate();
    this.ensureMigratedLegacySnapshot();
  }

  public getGate(): MaintenanceGate {
    return this.maintenanceGate;
  }

  public get dbPath(): string {
    return this.customPaths?.dbPath || this.config.dbPath;
  }

  public get storageDir(): string {
    return this.customPaths?.storageDir || this.fileStorageService.storageDir || this.config.storageDir;
  }

  public get snapshotsDir(): string {
    return this.customPaths?.snapshotsDir || this.customPaths?.snapshotDir || path.join(this.config.dataDir, '.snapshots');
  }

  private get manifestPath(): string {
    return path.join(this.snapshotsDir, 'manifest.json');
  }

  private get legacySnapshotDir(): string | undefined {
    if (this.customPaths && 'legacySnapshotDir' in this.customPaths) {
      return this.customPaths.legacySnapshotDir;
    }
    if (this.customPaths && this.customPaths.snapshotDir) {
      return this.customPaths.snapshotDir;
    }
    // Only default to global .demo_snapshot if this is the standalone/root service (not scoped with custom paths)
    if (!this.customPaths || (!this.customPaths.snapshotsDir && !this.customPaths.snapshotDir)) {
      return path.join(this.config.dataDir, '.demo_snapshot');
    }
    return undefined;
  }

  // ==========================================
  // Backward compatibility getters for DemoService
  // ==========================================
  public get snapshotDir(): string {
    const active = this.getActiveOrLatestSnapshot();
    if (active) {
      return path.join(this.snapshotsDir, active.id);
    }
    return this.snapshotsDir;
  }

  public get snapshotDbPath(): string {
    const active = this.getActiveOrLatestSnapshot();
    if (active) {
      return path.join(this.snapshotsDir, active.id, 'data.db');
    }
    return path.join(this.snapshotsDir, 'latest_fallback_data.db');
  }

  public get snapshotMetadataPath(): string {
    const active = this.getActiveOrLatestSnapshot();
    if (active) {
      return path.join(this.snapshotsDir, active.id, 'metadata.json');
    }
    return path.join(this.snapshotsDir, 'latest_fallback_metadata.json');
  }

  public get snapshotStorageDir(): string {
    const active = this.getActiveOrLatestSnapshot();
    if (active) {
      return path.join(this.snapshotsDir, active.id, 'storage');
    }
    return path.join(this.snapshotsDir, 'latest_fallback_storage');
  }

  /**
   * Automatically migrates legacy .demo_snapshot if it exists and no generic snapshots exist yet.
   */
  private ensureMigratedLegacySnapshot(): void {
    try {
      if (!this.legacySnapshotDir || !fs.existsSync(this.legacySnapshotDir)) return;

      const legacyDb = path.join(this.legacySnapshotDir, 'data.db');
      const legacyMeta = path.join(this.legacySnapshotDir, 'metadata.json');
      if (!fs.existsSync(legacyDb) || !fs.existsSync(legacyMeta)) return;

      if (!fs.existsSync(this.snapshotsDir)) {
        fs.mkdirSync(this.snapshotsDir, { recursive: true });
      }

      const existing = this.listSnapshots();
      if (existing.length > 0) return;

      let meta: any = {};
      try {
        meta = JSON.parse(fs.readFileSync(legacyMeta, 'utf-8'));
      } catch {
        meta = {};
      }

      const id = meta.id || `snap_${Date.now()}_legacy`;
      const targetDir = path.join(this.snapshotsDir, id);
      fs.mkdirSync(targetDir, { recursive: true });

      fs.copyFileSync(legacyDb, path.join(targetDir, 'data.db'));
      const legacyStorage = path.join(this.legacySnapshotDir, 'storage');
      const targetStorage = path.join(targetDir, 'storage');
      fs.mkdirSync(targetStorage, { recursive: true });
      if (fs.existsSync(legacyStorage)) {
        fs.cpSync(legacyStorage, targetStorage, { recursive: true });
      }

      const migratedMetadata: SnapshotMetadata = {
        id,
        name: meta.name || 'Initial Clean State',
        description: meta.description || 'Pristine demo baseline state',
        createdAt: meta.createdAt || new Date().toISOString(),
        collections: meta.collections || [],
        totalCollections: meta.totalCollections || 0,
        totalRecords: meta.totalRecords || 0,
        totalFiles: meta.totalFiles || 0,
        storageSizeBytes: meta.storageSizeBytes || 0,
        dbSizeBytes: meta.dbSizeBytes || 0,
        contentHash: meta.contentHash,
        isActive: true,
      };

      fs.writeFileSync(
        path.join(targetDir, 'metadata.json'),
        JSON.stringify(migratedMetadata, null, 2),
        'utf-8'
      );

      this.saveManifest({
        activeSnapshotId: id,
        snapshots: [migratedMetadata],
      });
    } catch {
      // ignore migration failures gracefully
    }
  }

  private readManifest(): SnapshotsManifest {
    if (!fs.existsSync(this.manifestPath)) {
      return { activeSnapshotId: null, snapshots: [] };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
      return {
        activeSnapshotId: parsed.activeSnapshotId || null,
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      };
    } catch {
      return { activeSnapshotId: null, snapshots: [] };
    }
  }

  private saveManifest(manifest: SnapshotsManifest): void {
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  /**
   * Returns all snapshots sorted chronologically by createdAt (oldest first).
   */
  public listSnapshots(): SnapshotMetadata[] {
    if (!fs.existsSync(this.snapshotsDir)) {
      return [];
    }

    const manifest = this.readManifest();
    const diskSnapshots: SnapshotMetadata[] = [];
    const validIds = new Set<string>();

    try {
      const entries = fs.readdirSync(this.snapshotsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const snapDir = path.join(this.snapshotsDir, entry.name);
        const metaPath = path.join(snapDir, 'metadata.json');
        const dbPath = path.join(snapDir, 'data.db');

        if (fs.existsSync(metaPath) && fs.existsSync(dbPath)) {
          try {
            const meta: SnapshotMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            if (meta.id) {
              diskSnapshots.push({
                ...meta,
                isActive: meta.id === manifest.activeSnapshotId,
              });
              validIds.add(meta.id);
            }
          } catch {
            // ignore corrupt metadata
          }
        }
      }
    } catch {
      return [];
    }

    // Sort chronologically (oldest first)
    diskSnapshots.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Update manifest if count or active id differs
    if (
      manifest.snapshots.length !== diskSnapshots.length ||
      (manifest.activeSnapshotId && !validIds.has(manifest.activeSnapshotId))
    ) {
      const newActiveId = validIds.has(manifest.activeSnapshotId || '')
        ? manifest.activeSnapshotId
        : diskSnapshots[diskSnapshots.length - 1]?.id || null;

      this.saveManifest({
        activeSnapshotId: newActiveId,
        snapshots: diskSnapshots,
      });
    }

    return diskSnapshots;
  }

  public getSnapshot(id: string): SnapshotMetadata | null {
    const snapshots = this.listSnapshots();
    return snapshots.find((s) => s.id === id) || null;
  }

  public getLatestSnapshot(): SnapshotMetadata | null {
    const snapshots = this.listSnapshots();
    return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  }

  public getActiveOrLatestSnapshot(): SnapshotMetadata | null {
    const snapshots = this.listSnapshots();
    if (snapshots.length === 0) return null;

    const manifest = this.readManifest();
    if (manifest.activeSnapshotId) {
      const active = snapshots.find((s) => s.id === manifest.activeSnapshotId);
      if (active) return active;
    }
    return snapshots[snapshots.length - 1];
  }

  public hasSnapshot(): boolean {
    return this.listSnapshots().length > 0;
  }

  /**
   * Creates a new snapshot.
   * If snapshot count >= maxSnapshots (10), requires evictOldest: true to remove the oldest.
   */
  public async createSnapshot(options: SnapshotCreateOptions = {}): Promise<SnapshotMetadata> {
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }

    return await this.maintenanceGate.executeExclusive(async () => {
      const currentSnapshots = this.listSnapshots();
      let toEvict: SnapshotMetadata[] = [];

      if (currentSnapshots.length >= this.maxSnapshots) {
        if (!options.evictOldest) {
          const oldest = currentSnapshots[0];
          const error = new ConflictError(
            `Snapshot limit of ${this.maxSnapshots} reached. Creating a new snapshot will delete the oldest snapshot '${oldest.name}'. Please confirm eviction to proceed.`,
            {
              code: 'SNAPSHOT_LIMIT_REACHED',
              limit: this.maxSnapshots,
              oldestSnapshot: oldest,
            }
          );
          throw error;
        }

        // Calculate snapshot(s) to evict once new snapshot succeeds
        const evictCount = currentSnapshots.length - this.maxSnapshots + 1;
        toEvict = currentSnapshots.slice(0, evictCount);
      }

      // 1. Flush SQLite WAL to disk
      this.db.checkpoint();

      // 2. Prepare new snapshot directory
      const id = `snap_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const snapDir = path.join(this.snapshotsDir, id);
      fs.mkdirSync(snapDir, { recursive: true });

      try {
        // 3. Compact & snapshot SQLite database transactional state
        const snapDbPath = path.join(snapDir, 'data.db');
        const normalizedDbPath = snapDbPath.replace(/\\/g, '/');
        this.db.exec(`VACUUM INTO '${normalizedDbPath}';`);

        if (!fs.existsSync(snapDbPath) || fs.statSync(snapDbPath).size === 0) {
          throw new Error('VACUUM INTO failed to generate a valid snapshot database file.');
        }

        // 4. Snapshot uploaded files storage
        const snapStorageDir = path.join(snapDir, 'storage');
        fs.mkdirSync(snapStorageDir, { recursive: true });
        if (fs.existsSync(this.storageDir)) {
          fs.cpSync(this.storageDir, snapStorageDir, { recursive: true });
        }

        // 5. Compute metadata & statistics
        const live = this.calculateLiveStats();
        const storageStats = this.getDirectoryStats(snapStorageDir);
        const dbSizeBytes = fs.statSync(snapDbPath).size;
        const contentHash = this.computeStateHash();

        const metadata: SnapshotMetadata = {
          id,
          name: options.name?.trim() || `Snapshot #${currentSnapshots.length + 1}`,
          description: options.description?.trim() || 'Application state snapshot',
          createdAt: new Date().toISOString(),
          collections: live.collections,
          totalCollections: live.totalCollections,
          totalRecords: live.totalRecords,
          totalFiles: storageStats.count,
          storageSizeBytes: storageStats.sizeBytes,
          dbSizeBytes,
          contentHash,
          isActive: true,
        };

        fs.writeFileSync(
          path.join(snapDir, 'metadata.json'),
          JSON.stringify(metadata, null, 2),
          'utf-8'
        );

        // 6. Only now evict oldest snapshot(s) after new snapshot is captured & validated
        if (toEvict.length > 0) {
          for (const snap of toEvict) {
            this.removeSnapshotFiles(snap.id);
          }
        }

        const evictedIds = new Set(toEvict.map((s) => s.id));
        const updatedSnapshots = [
          ...this.listSnapshots().filter((s) => !evictedIds.has(s.id) && s.id !== id),
          metadata,
        ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        this.saveManifest({
          activeSnapshotId: id,
          snapshots: updatedSnapshots,
        });

        // 7. Emit events
        this.eventBus.emit('snapshot:create', metadata);
        this.eventBus.emit('demo:snapshot', metadata);
        this.realtimeService.broadcastSystemEvent('SNAPSHOT_CREATE', { metadata });

        return metadata;
      } catch (err) {
        // Rollback new snapshot files on failure so oldest snapshots remain safe
        if (fs.existsSync(snapDir)) {
          try {
            fs.rmSync(snapDir, { recursive: true, force: true });
          } catch {}
        }
        throw err;
      }
    });
  }

  /**
   * Restores application state from a specific snapshot (or active/latest snapshot).
   * Note: Future snapshots are NOT deleted; all snapshots remain intact.
   */
  public async restoreSnapshot(id?: string): Promise<SnapshotRestoreResult> {
    const snapshots = this.listSnapshots();
    if (snapshots.length === 0) {
      throw new NotFoundError(
        'No demo snapshot found. Please create a snapshot first before attempting to restore.'
      );
    }

    let target: SnapshotMetadata | undefined;
    if (id) {
      target = snapshots.find((s) => s.id === id);
      if (!target) {
        throw new NotFoundError(`Snapshot with ID '${id}' was not found.`);
      }
    } else {
      target = this.getActiveOrLatestSnapshot() || snapshots[snapshots.length - 1];
    }

    const snapDir = path.join(this.snapshotsDir, target.id);
    const snapDbPath = path.join(snapDir, 'data.db');
    const snapStorageDir = path.join(snapDir, 'storage');

    if (!fs.existsSync(snapDbPath)) {
      throw new NotFoundError(`Snapshot database file not found for '${target.name}' (${target.id}).`);
    }

    return await this.maintenanceGate.executeExclusive(async () => {
      const startTime = Date.now();

      // 1. Lock database and checkpoint WAL journal
      this.db.lock();
      this.db.checkpoint();

      // 2. Safely close database connection
      this.db.close();

      try {
        // 3. Overwrite live data.db with snapshot
        fs.copyFileSync(snapDbPath, this.dbPath);

        // 4. Remove existing WAL and SHM journal files
        const walPath = `${this.dbPath}-wal`;
        if (fs.existsSync(walPath)) {
          try {
            fs.unlinkSync(walPath);
          } catch {
            // ignore
          }
        }

        const shmPath = `${this.dbPath}-shm`;
        if (fs.existsSync(shmPath)) {
          try {
            fs.unlinkSync(shmPath);
          } catch {
            // ignore
          }
        }

        // 5. Restore file storage
        if (fs.existsSync(this.storageDir)) {
          fs.rmSync(this.storageDir, { recursive: true, force: true });
        }
        fs.mkdirSync(this.storageDir, { recursive: true });

        if (fs.existsSync(snapStorageDir)) {
          fs.cpSync(snapStorageDir, this.storageDir, { recursive: true });
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

      // Update active snapshot ID in manifest without deleting any snapshots!
      this.saveManifest({
        activeSnapshotId: target.id,
        snapshots: this.listSnapshots(),
      });

      // 7. Broadcast SSE realtime events
      this.realtimeService.broadcastSystemEvent('SNAPSHOT_RESTORE', {
        timestamp: new Date().toISOString(),
        snapshot: target,
        durationMs,
      });

      this.realtimeService.broadcastSystemEvent('DEMO_RESET', {
        timestamp: new Date().toISOString(),
        snapshot: target,
        durationMs,
      });

      this.eventBus.emit('snapshot:restore', { metadata: target, durationMs });
      this.eventBus.emit('demo:reset', { metadata: target, durationMs });

      return {
        success: true,
        message: `Successfully restored state '${target.name}' in ${durationMs}ms.`,
        durationMs,
        snapshot: target,
        restoredAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Deletes a specific snapshot by ID.
   */
  public async deleteSnapshot(id: string): Promise<void> {
    return await this.maintenanceGate.executeExclusive(async () => {
      const target = this.getSnapshot(id);
      if (!target) {
        throw new NotFoundError(`Snapshot with ID '${id}' was not found.`);
      }

      this.removeSnapshotFiles(id);

      const remaining = this.listSnapshots();
      const manifest = this.readManifest();
      let newActiveId = manifest.activeSnapshotId;
      if (newActiveId === id) {
        newActiveId = remaining[remaining.length - 1]?.id || null;
      }

      this.saveManifest({
        activeSnapshotId: newActiveId,
        snapshots: remaining,
      });

      this.eventBus.emit('snapshot:delete', { id, timestamp: new Date().toISOString() });
      this.realtimeService.broadcastSystemEvent('SNAPSHOT_DELETE', { id });
    });
  }

  /**
   * Deletes all snapshots.
   */
  public async clearAllSnapshots(): Promise<void> {
    return await this.maintenanceGate.executeExclusive(async () => {
      if (fs.existsSync(this.snapshotsDir)) {
        try {
          const entries = fs.readdirSync(this.snapshotsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              fs.rmSync(path.join(this.snapshotsDir, entry.name), { recursive: true, force: true });
            }
          }
        } catch {
          // ignore
        }
        this.saveManifest({ activeSnapshotId: null, snapshots: [] });
      }

      // Also clear legacy .demo_snapshot if it exists and is scoped for this service
      if (this.legacySnapshotDir && fs.existsSync(this.legacySnapshotDir)) {
        try {
          fs.rmSync(this.legacySnapshotDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }

      this.eventBus.emit('snapshot:clear', { timestamp: new Date().toISOString() });
      this.eventBus.emit('demo:clear', { timestamp: new Date().toISOString() });
      this.realtimeService.broadcastSystemEvent('SNAPSHOT_CLEAR', {});
    });
  }

  private removeSnapshotFiles(id: string): void {
    const snapDir = path.join(this.snapshotsDir, id);
    if (fs.existsSync(snapDir)) {
      try {
        fs.rmSync(snapDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  /**
   * Retrieves status and live drift against a specific snapshot or the active/latest baseline.
   */
  public getStatus(targetSnapshotId?: string): SnapshotStatus {
    const snapshots = this.listSnapshots();
    if (snapshots.length === 0) {
      return {
        hasSnapshot: false,
        total: 0,
        maxLimit: this.maxSnapshots,
        snapshots: [],
        activeSnapshot: null,
        snapshot: null,
      };
    }

    let target: SnapshotMetadata | undefined;
    if (targetSnapshotId) {
      target = snapshots.find((s) => s.id === targetSnapshotId);
    }
    if (!target) {
      target = this.getActiveOrLatestSnapshot() || snapshots[snapshots.length - 1];
    }

    try {
      const live = this.calculateLiveStats();
      const liveContentHash = this.computeStateHash();

      const collectionsDelta = live.totalCollections - target.totalCollections;
      const recordsDelta = live.totalRecords - target.totalRecords;
      const filesDelta = live.totalFiles - target.totalFiles;
      const contentChanged = Boolean(target.contentHash && liveContentHash !== target.contentHash);
      const isModified = collectionsDelta !== 0 || recordsDelta !== 0 || filesDelta !== 0 || contentChanged;

      return {
        hasSnapshot: true,
        total: snapshots.length,
        maxLimit: this.maxSnapshots,
        snapshots,
        activeSnapshot: target,
        snapshot: target,
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
        hasSnapshot: true,
        total: snapshots.length,
        maxLimit: this.maxSnapshots,
        snapshots,
        activeSnapshot: target,
        snapshot: target,
      };
    }
  }

  // ==========================================
  // DemoService Backwards Compatibility Aliases
  // ==========================================
  public async snapshot(options: SnapshotCreateOptions = {}): Promise<SnapshotMetadata> {
    return this.createSnapshot({ ...options, evictOldest: true });
  }

  public async reset(): Promise<SnapshotRestoreResult> {
    return this.restoreSnapshot();
  }

  public async clearSnapshot(): Promise<void> {
    return this.clearAllSnapshots();
  }

  // ==========================================
  // Statistics & Content Hash Calculation
  // ==========================================
  private calculateLiveStats(): {
    totalCollections: number;
    totalRecords: number;
    totalFiles: number;
    collections: SnapshotCollectionSummary[];
  } {
    const collections = this.schemaService.getAllCollections();
    let totalRecords = 0;
    const colDetails: SnapshotCollectionSummary[] = [];

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

    // Count super admins
    try {
      const adminRow = this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM _admins');
      if (adminRow?.count) {
        totalRecords += adminRow.count;
      }
    } catch {
      // ignore
    }

    const filesStat = this.getDirectoryStats(this.storageDir);

    return {
      totalCollections: collections.length,
      totalRecords,
      totalFiles: filesStat.count,
      collections: colDetails,
    };
  }

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
      const adminRows = this.db.all<Record<string, any>>(
        'SELECT id, email, created, updated FROM _admins ORDER BY "id" ASC'
      );
      hash.update(`admins:count:${adminRows.length}`);
      for (const row of adminRows) {
        hash.update(JSON.stringify(row));
      }
    } catch {
      // ignore
    }

    // 4. File storage manifest
    const files = this.getFileManifest(this.storageDir);
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
