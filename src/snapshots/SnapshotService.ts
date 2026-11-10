import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { ConfigService } from '../core/config/ConfigService';
import { SchemaService } from '../schema/SchemaService';
import { FileStorageService } from '../files/FileStorageService';
import { EventBus } from '../core/events/EventBus';
import { RealtimeService } from '../realtime/RealtimeService';
import { AppError, NotFoundError, ConflictError } from '../core/errors/AppError';
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
import { ISnapshotDriver } from './drivers/ISnapshotDriver';
import { SqliteSnapshotDriver } from './drivers/SqliteSnapshotDriver';
import { LogicalSnapshotDriver } from './drivers/LogicalSnapshotDriver';
import { SqliteToRemoteSnapshotDriver } from './drivers/SqliteToRemoteSnapshotDriver';

interface SnapshotsManifest {
  activeSnapshotId: string | null;
  snapshots: SnapshotMetadata[];
}

export class SnapshotService {
  private maintenanceGate: MaintenanceGate;
  public readonly maxSnapshots: number = MAX_SNAPSHOTS;

  public isSupported(): boolean {
    return this.db.dialect.name === 'sqlite';
  }

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

  private getCaptureDriver(): ISnapshotDriver {
    if (this.db.dialect.name === 'sqlite') {
      return new SqliteSnapshotDriver(this.db, this.dbPath);
    }
    return new LogicalSnapshotDriver(this.db);
  }

  private getRestoreDriver(snapDir: string): ISnapshotDriver {
    const hasSqliteDb = fs.existsSync(path.join(snapDir, 'data.db'));
    const hasLogicalJson = fs.existsSync(path.join(snapDir, 'snapshot.json'));

    if (this.db.dialect.name === 'sqlite') {
      if (hasSqliteDb) {
        return new SqliteSnapshotDriver(this.db, this.dbPath);
      }
      if (hasLogicalJson) {
        return new LogicalSnapshotDriver(this.db);
      }
      throw new NotFoundError(`Snapshot at '${snapDir}' does not contain 'data.db' or 'snapshot.json'.`);
    } else {
      if (hasLogicalJson) {
        return new LogicalSnapshotDriver(this.db);
      }
      if (hasSqliteDb) {
        return new SqliteToRemoteSnapshotDriver(this.db);
      }
      throw new NotFoundError(`Snapshot at '${snapDir}' does not contain 'snapshot.json' or 'data.db'.`);
    }
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
    if (!this.customPaths || (!this.customPaths.snapshotsDir && !this.customPaths.snapshotDir)) {
      return path.join(this.config.dataDir, '.demo_snapshot');
    }
    return undefined;
  }

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
      // ignore
    }
  }

  public hasSnapshot(): boolean {
    return this.listSnapshots().length > 0;
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

        if (fs.existsSync(metaPath)) {
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
            // ignore
          }
        }
      }
    } catch {
      return [];
    }

    const cleanedManifestSnapshots: SnapshotMetadata[] = manifest.snapshots
      .filter((s) => validIds.has(s.id))
      .map((s) => ({
        ...s,
        isActive: s.id === manifest.activeSnapshotId,
      }));

    for (const snap of diskSnapshots) {
      if (!cleanedManifestSnapshots.some((m) => m.id === snap.id)) {
        cleanedManifestSnapshots.push(snap);
      }
    }

    cleanedManifestSnapshots.sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return timeA - timeB;
    });

    return cleanedManifestSnapshots;
  }

  public getSnapshot(id: string): SnapshotMetadata | null {
    return this.listSnapshots().find((s) => s.id === id) || null;
  }

  public getActiveOrLatestSnapshot(): SnapshotMetadata | undefined {
    const snapshots = this.listSnapshots();
    if (snapshots.length === 0) return undefined;
    const manifest = this.readManifest();
    if (manifest.activeSnapshotId) {
      const active = snapshots.find((s) => s.id === manifest.activeSnapshotId);
      if (active) return active;
    }
    return snapshots[snapshots.length - 1];
  }

  public async createSnapshot(options: SnapshotCreateOptions = {}): Promise<SnapshotMetadata> {
    if (!this.isSupported()) {
      throw new AppError(
        `Snapshots are only supported for applications running on SQLite. This application is currently running on ${this.db.dialect.name.toUpperCase()}.`,
        400
      );
    }
    return await this.maintenanceGate.executeExclusive(async () => {
      const currentSnapshots = this.listSnapshots();

      if (options.name) {
        const duplicate = currentSnapshots.find(
          (s) => s.name.toLowerCase() === options.name!.trim().toLowerCase()
        );
        if (duplicate) {
          throw new ConflictError(
            `A snapshot named '${options.name.trim()}' already exists. Please choose a different name.`
          );
        }
      }

      let toEvict: SnapshotMetadata[] = [];
      if (currentSnapshots.length >= this.maxSnapshots) {
        if (!options.evictOldest) {
          throw new ConflictError(
            `Snapshot limit of ${this.maxSnapshots} reached. Pass evictOldest: true to automatically evict the oldest snapshot.`,
            {
              code: 'SNAPSHOT_LIMIT_REACHED',
              limit: this.maxSnapshots,
              oldestSnapshot: currentSnapshots[0],
            }
          );
        }
        const oldest = currentSnapshots[0];
        if (oldest.isProtected) {
          throw new ConflictError(
            `Snapshot limit reached (${this.maxSnapshots}) and oldest snapshot '${oldest.name}' is protected.`
          );
        }
        const evictCount = currentSnapshots.length - this.maxSnapshots + 1;
        toEvict = currentSnapshots.slice(0, evictCount);
      }

      await this.db.checkpoint();

      const id = `snap_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const snapDir = path.join(this.snapshotsDir, id);
      fs.mkdirSync(snapDir, { recursive: true });

      try {
        const { dbSizeBytes } = await this.getCaptureDriver().captureSnapshot(snapDir);

        const snapStorageDir = path.join(snapDir, 'storage');
        fs.mkdirSync(snapStorageDir, { recursive: true });
        if (fs.existsSync(this.storageDir)) {
          fs.cpSync(this.storageDir, snapStorageDir, { recursive: true });
        }

        const live = await this.calculateLiveStats();
        const storageStats = this.getDirectoryStats(snapStorageDir);
        const contentHash = await this.computeStateHash();

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

        this.eventBus.emit('snapshot:create', metadata);
        this.realtimeService.broadcastSystemEvent('SNAPSHOT_CREATE', { metadata });

        return metadata;
      } catch (err) {
        if (fs.existsSync(snapDir)) {
          try {
            fs.rmSync(snapDir, { recursive: true, force: true });
          } catch {}
        }
        throw err;
      }
    });
  }

  public async restoreSnapshot(id?: string): Promise<SnapshotRestoreResult> {
    if (!this.isSupported()) {
      throw new AppError(
        `Snapshots are only supported for applications running on SQLite. This application is currently running on ${this.db.dialect.name.toUpperCase()}.`,
        400
      );
    }
    const snapshots = this.listSnapshots();
    if (snapshots.length === 0) {
      throw new NotFoundError(
        'No snapshot found. Please create a snapshot first before attempting to restore.'
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
    const snapStorageDir = path.join(snapDir, 'storage');

    return await this.maintenanceGate.executeExclusive(async () => {
      const startTime = Date.now();

      this.db.lock();
      await this.db.checkpoint();

      try {
        await this.getRestoreDriver(snapDir).restoreSnapshot(snapDir);

        if (fs.existsSync(this.storageDir)) {
          fs.rmSync(this.storageDir, { recursive: true, force: true });
        }
        fs.mkdirSync(this.storageDir, { recursive: true });

        if (fs.existsSync(snapStorageDir)) {
          fs.cpSync(snapStorageDir, this.storageDir, { recursive: true });
        }
      } finally {
        try {
          // For non-SQLite drivers (LogicalSnapshotDriver), the database connection remains active
          // and was not replaced on disk. Only reconnect if the driver is SQLite or connection was closed.
          if (this.db.dialect.name === 'sqlite' || !this.db.isOpen()) {
            await this.db.reconnect();
          }
        } finally {
          this.db.unlock();
        }
      }

      const durationMs = Date.now() - startTime;

      this.saveManifest({
        activeSnapshotId: target.id,
        snapshots: this.listSnapshots(),
      });

      this.realtimeService.broadcastSystemEvent('SNAPSHOT_RESTORE', {
        timestamp: new Date().toISOString(),
        snapshot: target,
        durationMs,
      });

      await this.eventBus.emit('snapshot:restore', { metadata: target, durationMs });

      return {
        success: true,
        message: `Successfully restored state '${target.name}' in ${durationMs}ms.`,
        durationMs,
        snapshot: target,
        restoredAt: new Date().toISOString(),
      };
    });
  }

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

      if (this.legacySnapshotDir && fs.existsSync(this.legacySnapshotDir)) {
        try {
          fs.rmSync(this.legacySnapshotDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }

      this.eventBus.emit('snapshot:clear', { timestamp: new Date().toISOString() });
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

  public async getStatus(targetSnapshotId?: string): Promise<SnapshotStatus> {
    const isSupported = this.isSupported();
    const provider = this.db.dialect.name;

    if (!isSupported) {
      return {
        hasSnapshot: false,
        total: 0,
        maxLimit: this.maxSnapshots,
        snapshots: [],
        activeSnapshot: null,
        snapshot: null,
        supported: false,
        provider,
      };
    }

    const snapshots = this.listSnapshots();
    if (snapshots.length === 0) {
      return {
        hasSnapshot: false,
        total: 0,
        maxLimit: this.maxSnapshots,
        snapshots: [],
        activeSnapshot: null,
        snapshot: null,
        supported: true,
        provider,
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
      const live = await this.calculateLiveStats();
      const liveContentHash = await this.computeStateHash();

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
        supported: true,
        provider,
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
        supported: true,
        provider,
      };
    }
  }

  private async calculateLiveStats(): Promise<{
    totalCollections: number;
    totalRecords: number;
    totalFiles: number;
    collections: SnapshotCollectionSummary[];
  }> {
    const collections = await this.schemaService.getAllCollections();
    let totalRecords = 0;
    const colDetails: SnapshotCollectionSummary[] = [];

    for (const c of collections) {
      let count = 0;
      try {
        const row = await this.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${this.db.dialect.quoteIdentifier(c.name)}`);
        count = row ? Number(row.count) : 0;
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

    try {
      const adminRow = await this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM _admins');
      if (adminRow?.count) {
        totalRecords += Number(adminRow.count);
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

  public async computeStateHash(): Promise<string> {
    const hash = crypto.createHash('sha256');

    const collections = (await this.schemaService.getAllCollections()).sort((a: any, b: any) => a.name.localeCompare(b.name));
    for (const c of collections) {
      hash.update(`col:${c.id}:${c.name}:${c.type}:${c.system ? 1 : 0}`);
      hash.update(`schema:${JSON.stringify(c.schema || [])}`);
      hash.update(`indexes:${JSON.stringify(c.indexes || [])}`);
      hash.update(`rules:${c.listRule}:${c.viewRule}:${c.createRule}:${c.updateRule}:${c.deleteRule}`);
      hash.update(`options:${JSON.stringify(c.options || {})}`);
    }

    for (const c of collections) {
      try {
        const rows = await this.db.all<Record<string, any>>(`SELECT * FROM ${this.db.dialect.quoteIdentifier(c.name)} ORDER BY "id" ASC`);
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
        // ignore
      }
    }

    try {
      const adminRows = await this.db.all<Record<string, any>>(
        'SELECT id, email, created, updated FROM _admins ORDER BY "id" ASC'
      );
      hash.update(`admins:count:${adminRows.length}`);
      for (const row of adminRows) {
        hash.update(JSON.stringify(row));
      }
    } catch {
      // ignore
    }

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
    return list;
  }
}
