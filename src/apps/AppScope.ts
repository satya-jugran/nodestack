import * as fs from 'fs';
import * as path from 'path';
import { AppModel } from './models/App';
import { ConfigService } from '../core/config/ConfigService';
import { DatabaseService } from '../database/DatabaseService';
import { MaintenanceGate } from '../core/maintenance/MaintenanceGate';
import { EventBus } from '../core/events/EventBus';
import { FtsService } from '../records/FtsService';
import { SchemaService } from '../schema/SchemaService';
import { TypeGenerator } from '../schema/TypeGenerator';
import { OpenApiGenerator } from '../schema/OpenApiGenerator';
import { RuleEngine } from '../rules/RuleEngine';
import { AuthService } from '../auth/AuthService';
import { ApiKeyService } from '../auth/ApiKeyService';
import { FileStorageService } from '../files/FileStorageService';
import { RealtimeService } from '../realtime/RealtimeService';
import { LogService } from '../logger/LogService';
import { RecordService } from '../records/RecordService';
import { MockDataService } from '../records/MockDataService';
import { TemplateService } from '../templates/TemplateService';
import { DemoService } from '../demo/DemoService';
import { SnapshotService } from '../snapshots/SnapshotService';
import { AnalyticsService } from '../analytics/AnalyticsService';
import { AuditLogService } from '../audit/AuditLogService';
import { WebhookService } from '../webhooks/WebhookService';
import { AppRegistry } from './AppRegistry';
import { IDatabaseDriver } from '../database/drivers/IDatabaseDriver';

export class AppScope {
  public readonly app: AppModel;
  public readonly config: ConfigService;
  public readonly maintenanceGate: MaintenanceGate;
  public readonly eventBus: EventBus;
  public readonly db: DatabaseService;
  public readonly fts: FtsService;
  public readonly schema: SchemaService;
  public readonly typegen: TypeGenerator;
  public readonly openapi: OpenApiGenerator;
  public readonly ruleEngine: RuleEngine;
  public readonly auth: AuthService;
  public readonly apiKeys: ApiKeyService;
  public readonly files: FileStorageService;
  public readonly realtime: RealtimeService;
  public readonly logs: LogService;
  public readonly records: RecordService;
  public readonly mockData: MockDataService;
  public readonly templates: TemplateService;
  public readonly snapshots: SnapshotService;
  public readonly demo: DemoService;
  public readonly analytics: AnalyticsService;
  public readonly auditLogs: AuditLogService;
  public readonly webhooks: WebhookService;

  constructor(
    app: AppModel,
    config: ConfigService,
    db: DatabaseService,
    registry?: AppRegistry
  ) {
    this.app = app;
    this.config = config;
    this.db = db;
    this.db.init();

    this.maintenanceGate = new MaintenanceGate();
    this.eventBus = new EventBus();

    this.fts = new FtsService(this.db);
    this.schema = new SchemaService(this.db, this.fts);
    this.fts.syncAll(this.schema.getAllCollections());

    this.typegen = new TypeGenerator(this.schema);
    const openApiTitle = app.slug === 'default'
      ? `${config?.appName || 'NodeStack'} API`
      : `${app.name} API`;
    this.openapi = new OpenApiGenerator(this.schema, {
      title: openApiTitle,
      appSlug: app.slug,
      appName: app.name,
    });

    this.ruleEngine = new RuleEngine();
    this.auth = new AuthService(this.db, this.config, this.schema, registry);
    this.apiKeys = new ApiKeyService(this.db, this.config);

    const appStorageDir = config.getAppStorageDir(app.slug);
    if (!fs.existsSync(appStorageDir)) {
      fs.mkdirSync(appStorageDir, { recursive: true });
    }
    this.files = new FileStorageService(this.config, appStorageDir);

    this.realtime = new RealtimeService(this.ruleEngine, this.schema);
    this.logs = new LogService(this.db);

    this.records = new RecordService(
      this.db,
      this.schema,
      this.ruleEngine,
      this.eventBus,
      this.realtime,
      this.files,
      this.fts
    );

    this.mockData = new MockDataService(
      this.db,
      this.schema,
      this.files,
      this.eventBus,
      this.realtime
    );

    this.templates = new TemplateService(
      this.db,
      this.schema,
      this.files,
      this.eventBus,
      this.realtime
    );

    const isDefaultApp = Boolean(app.isDefault || app.slug === 'default');
    const appDbPath = config.getAppDbPath(app.slug);
    const appSnapshotDir = config.getAppSnapshotDir(app.slug);
    this.snapshots = new SnapshotService(
      this.config,
      this.db,
      this.schema,
      this.files,
      this.eventBus,
      this.realtime,
      this.maintenanceGate,
      {
        dbPath: appDbPath,
        storageDir: appStorageDir,
        snapshotsDir: appSnapshotDir,
        legacySnapshotDir: isDefaultApp ? path.join(this.config.dataDir, '.demo_snapshot') : undefined,
      }
    );

    this.demo = this.snapshots as unknown as DemoService;
    this.analytics = new AnalyticsService(this.db, this.config, this.schema, this.realtime, {
      dbPath: appDbPath,
    });
    this.auditLogs = new AuditLogService(this.db);
    this.webhooks = new WebhookService(this.db, this.eventBus);

    // Wire up audit logs listeners for this app
    this.eventBus.onRecordAfterCreate(async (ctx) => {
      await this.auditLogs.handleRecordEvent('create', ctx);
    });
    this.eventBus.onRecordAfterUpdate(async (ctx) => {
      await this.auditLogs.handleRecordEvent('update', ctx);
    });
    this.eventBus.onRecordAfterDelete(async (ctx) => {
      await this.auditLogs.handleRecordEvent('delete', ctx);
    });

    // Wire up webhooks listeners for this app
    this.eventBus.onRecordAfterCreate(async (ctx) => {
      await this.webhooks.handleRecordEvent('create', ctx);
    });
    this.eventBus.onRecordAfterUpdate(async (ctx) => {
      await this.webhooks.handleRecordEvent('update', ctx);
    });
    this.eventBus.onRecordAfterDelete(async (ctx) => {
      await this.webhooks.handleRecordEvent('delete', ctx);
    });
  }

  public static create(
    app: AppModel,
    config: ConfigService,
    registry?: AppRegistry,
    customDriver?: IDatabaseDriver,
    driverFactory?: (app: AppModel, defaultDbPath: string) => IDatabaseDriver
  ): AppScope {
    const appDir = config.getAppDir(app.slug);
    if (!fs.existsSync(appDir)) {
      fs.mkdirSync(appDir, { recursive: true });
    }

    const appDbPath = config.getAppDbPath(app.slug);

    let db: DatabaseService;
    const factoryDriver = driverFactory ? driverFactory(app, appDbPath) : undefined;
    if (factoryDriver) {
      db = new DatabaseService(config, factoryDriver, appDbPath);
    } else if (app.slug === 'default' && customDriver) {
      db = new DatabaseService(config, customDriver, appDbPath);
    } else {
      if (app.slug === 'default') {
        AppScope.migrateLegacyDefault(config, registry);
      }
      db = new DatabaseService(config, undefined, appDbPath);
    }

    return new AppScope(app, config, db, registry);
  }

  private static migrateLegacyDefault(config: ConfigService, registry?: AppRegistry): void {
    const legacyDbPath = config.dbPath;
    const defaultDbPath = config.getAppDbPath('default');
    const marker = path.join(config.appsDir, '.legacy_migrated');

    if (fs.existsSync(marker) || !fs.existsSync(legacyDbPath)) {
      return;
    }

    try {
      if (!fs.existsSync(defaultDbPath)) {
        fs.copyFileSync(legacyDbPath, defaultDbPath);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(defaultDbPath);
        db.exec(`ATTACH DATABASE '${legacyDbPath.replace(/'/g, "''")}' AS legacy;`);
        const legacyTables = db.prepare(`
          SELECT name, type, sql FROM legacy.sqlite_master
          WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_fts_%'
        `).all() as any[];

        db.exec('BEGIN TRANSACTION;');
        for (const table of legacyTables) {
          const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(table.name);
          if (!exists && table.sql) {
            db.exec(table.sql);
          }
          try {
            db.exec(`INSERT OR REPLACE INTO main."${table.name}" SELECT * FROM legacy."${table.name}";`);
          } catch {}
        }
        db.exec('COMMIT;');
        db.close();
      }

      // Copy legacy storage files
      const legacyStorage = config.storageDir;
      const defaultStorage = config.getAppStorageDir('default');
      if (fs.existsSync(legacyStorage) && legacyStorage !== defaultStorage) {
        fs.cpSync(legacyStorage, defaultStorage, { recursive: true, force: false });
      }

      // Sync admins from legacy into system.db if registry provided
      if (registry) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { DatabaseSync } = require('node:sqlite');
          const dataDb = new DatabaseSync(defaultDbPath);
          const legacyAdmins = dataDb.prepare('SELECT * FROM _admins').all() as any[];
          dataDb.close();
          const sysDriver = registry.getDriver();
          for (const admin of legacyAdmins) {
            const existing = sysDriver.prepare('SELECT id FROM _admins WHERE email = ?').get(admin.email);
            if (!existing) {
              sysDriver.prepare(`
                INSERT INTO _admins (id, email, passwordHash, tokenKey, avatar, created, updated)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(admin.id, admin.email, admin.passwordHash, admin.tokenKey, admin.avatar || null, admin.created, admin.updated);
            } else {
              sysDriver.prepare(`
                UPDATE _admins SET passwordHash = ?, tokenKey = ? WHERE email = ?
              `).run(admin.passwordHash, admin.tokenKey, admin.email);
            }
          }
        } catch {}
      }

      fs.writeFileSync(marker, new Date().toISOString(), 'utf-8');
    } catch (err: any) {
      console.warn(`[AppScope] Legacy migration warning: ${err.message}`);
    }
  }

  private _isClosed = false;
  private onCloseHandlers: Array<() => void> = [];

  public get isClosed(): boolean {
    return this._isClosed;
  }

  public onClose(handler: () => void): () => void {
    this.onCloseHandlers.push(handler);
    return () => {
      this.onCloseHandlers = this.onCloseHandlers.filter((h) => h !== handler);
    };
  }

  public close(): void {
    if (this._isClosed) return;
    this._isClosed = true;

    // 0. Notify onClose handlers
    for (const handler of this.onCloseHandlers) {
      try {
        handler();
      } catch {
        // ignore
      }
    }
    this.onCloseHandlers = [];

    // 1. Dispose RealtimeService (clears heartbeat interval and disconnects all SSE clients)
    try {
      this.realtime.dispose();
    } catch {
      // ignore
    }

    try {
      this.apiKeys.dispose();
    } catch {
      // ignore
    }

    // 2. Clear all hook handlers on EventBus
    try {
      this.eventBus.clear();
    } catch {
      // ignore
    }

    // 3. Reset MaintenanceGate to drain and clear queue timers
    try {
      this.maintenanceGate.reset();
    } catch {
      // ignore
    }

    // 4. Checkpoint and close database driver
    try {
      this.db.checkpoint();
      this.db.close();
    } catch {
      // ignore
    }
  }
}
