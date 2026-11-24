import * as fs from 'fs';
import { AppRegistry } from './AppRegistry';
import { AppScope } from './AppScope';
import { AppModel, CreateAppDto, UpdateAppDto } from './models/App';
import { ConfigService } from '../core/config/ConfigService';
import { AppError, NotFoundError } from '../core/errors/AppError';
import { DatabaseService } from '../database/DatabaseService';
import { IDatabaseDriver } from '../database/drivers/IDatabaseDriver';
import { NodeSqliteDriver } from '../database/drivers/NodeSqliteDriver';
import { getStoreManagerEmail, getStoreManagerRule } from '../templates/definitions';

export type DatabaseDriverFactory = (app: AppModel, defaultDbPath: string) => IDatabaseDriver;

export class AppManager {
  private appCache: Map<string, AppScope> = new Map();
  private onScopeInitHandlers: Array<(scope: AppScope) => void> = [];
  private demoInitPromise?: Promise<AppScope | undefined>;

  constructor(
    public readonly registry: AppRegistry,
    public readonly config: ConfigService,
    private customDriver?: IDatabaseDriver,
    private driverFactory?: DatabaseDriverFactory
  ) {}

  public onScopeInit(handler: (scope: AppScope) => void): void {
    this.onScopeInitHandlers.push(handler);
    for (const scope of this.getCachedScopes()) {
      try {
        handler(scope);
      } catch (err: any) {
        console.warn(`[AppManager] onScopeInit handler error: ${err.message}`);
      }
    }
  }

  public getCachedScopes(): AppScope[] {
    return Array.from(new Set(this.appCache.values()));
  }

  public async switchAppDriver(appSlug: string, newDriver?: IDatabaseDriver): Promise<void> {
    const targetSlug = (appSlug || 'default').trim();
    const scope = await this.getAsync(targetSlug);
    let appDriver: IDatabaseDriver;

    if (newDriver) {
      if (newDriver.dialect.name === 'sqlite' && (newDriver as any).getPath?.() !== ':memory:') {
        const appDbPath = this.config.getAppDbPath(targetSlug);
        if (targetSlug === 'default' && (newDriver as any).getPath?.() === appDbPath) {
          appDriver = newDriver;
        } else {
          appDriver = await newDriver.withSchema(targetSlug);
        }
      } else {
        appDriver = await newDriver.withSchema(targetSlug);
      }
    } else {
      const appDbPath = this.config.getAppDbPath(targetSlug);
      appDriver = new NodeSqliteDriver(appDbPath, {
        baseDir: this.config.appsDir,
      });
    }

    await scope.db.switchDriver(appDriver);
    await scope.init(true);
  }

  public async switchDriver(newDriver?: IDatabaseDriver, appSlug?: string): Promise<void> {
    if (appSlug) {
      return this.switchAppDriver(appSlug, newDriver);
    }
    const oldRootDriver = this.customDriver;
    try {
      this.customDriver = newDriver;
      for (const scope of this.getCachedScopes()) {
        if (newDriver) {
          let appDriver: IDatabaseDriver;
          if (newDriver.dialect.name === 'sqlite' && (newDriver as any).getPath?.() !== ':memory:') {
            const appDbPath = this.config.getAppDbPath(scope.app.slug);
            if (scope.app.slug === 'default' && (newDriver as any).getPath?.() === appDbPath) {
              appDriver = newDriver;
            } else {
              appDriver = await newDriver.withSchema(scope.app.slug);
            }
          } else {
            appDriver = await newDriver.withSchema(scope.app.slug);
          }
          await scope.db.switchDriver(appDriver);
        } else {
          const appDbPath = this.config.getAppDbPath(scope.app.slug);
          const sqliteDriver = new NodeSqliteDriver(appDbPath, {
            baseDir: this.config.appsDir,
          });
          await scope.db.switchDriver(sqliteDriver);
        }
        await scope.init(true);
      }
      if (oldRootDriver && oldRootDriver !== newDriver) {
        try {
          await oldRootDriver.close();
        } catch {
          // ignore
        }
      }
    } catch (err) {
      this.customDriver = oldRootDriver;
      throw err;
    }
  }

  public findScopeByDb(db: DatabaseService): AppScope | undefined {
    for (const scope of this.getCachedScopes()) {
      if (scope.db === db || (scope.db as any)?.driver === (db as any)?.driver) {
        return scope;
      }
    }
    for (const app of this.registry.getAllAppsSync()) {
      try {
        const scope = this.get(app.slug);
        if (scope.db === db || (scope.db as any)?.driver === (db as any)?.driver) {
          return scope;
        }
      } catch {}
    }
    return undefined;
  }

  public init(): AppScope {
    // Ensure default application scope is initialized
    const defaultScope = this.get('default');
    return defaultScope;
  }

  public async ensureDemoAppInitialized(
    force = false,
    options?: { overwrite?: boolean }
  ): Promise<AppScope | undefined> {
    if (this.demoInitPromise && !force && !options?.overwrite) {
      return this.demoInitPromise;
    }
    this.demoInitPromise = this.doEnsureDemoAppInitialized(options);
    return this.demoInitPromise;
  }

  private async doEnsureDemoAppInitialized(options?: { overwrite?: boolean }): Promise<AppScope | undefined> {
    try {
      let demoApp = await this.registry.getApp('ecommerce-demo');
      if (!demoApp) {
        demoApp = await this.registry.createApp({
          slug: 'ecommerce-demo',
          name: 'E-Commerce Demo',
          description: 'Retail storefront showcase pre-seeded with catalog, serverless lambdas, and event-driven flows',
          icon: 'shopping-bag',
        });
      }

      const scope = await this.getAsync('ecommerce-demo');

      // Idempotently apply ecommerce template: bootstraps or repairs missing collections,
      // serverless functions, and orchestration flows even on partially initialized scopes.
      await scope.templates.apply('ecommerce', { overwrite: Boolean(options?.overwrite) });

      // Ensure baseline snapshot exists for Reset to Demo State
      if (scope.snapshots.listSnapshots().length === 0) {
        try {
          await scope.snapshots.createSnapshot({
            name: 'ecommerce-demo-baseline',
            description: 'Baseline state for ecommerce-demo storefront and lambdas',
          });
        } catch (snapErr: any) {
          console.warn(`[AppManager] Creating baseline snapshot note: ${snapErr.message}`);
        }
      }

      // Pre-seed or synchronize demo customer account for instant 1-click login
      try {
        const userCol = await scope.schema.getCollection('users');
        if (userCol) {
          const crypto = require('crypto');
          const passwordHash = await scope.auth.hashPassword('DemoPassword123!');
          const userExists = await scope.db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', 'alex.vance@nodestack.dev');
          if (!userExists) {
            const now = new Date().toISOString();
            await scope.db.run(
              `INSERT INTO users (id, email, emailVisibility, verified, passwordHash, tokenKey, name, created, updated)
               VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)`,
              'usr_alex_vance',
              'alex.vance@nodestack.dev',
              passwordHash,
              crypto.randomBytes(16).toString('hex'),
              'Alex Vance',
              now,
              now
            );
          } else {
            await scope.db.run('UPDATE users SET passwordHash = ? WHERE email = ?', passwordHash, 'alex.vance@nodestack.dev');
          }

          // Server-side provisioning for Store Manager account with server secret (never shipped to browser)
          const managerEmail = getStoreManagerEmail();
          const managerPassword = process.env.STORE_MANAGER_PASSWORD || 'StoreManagerSecret2026!';
          const managerHash = await scope.auth.hashPassword(managerPassword);
          const managerExists = await scope.db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', managerEmail);
          const managerNow = new Date().toISOString();
          if (!managerExists) {
            await scope.db.run(
              `INSERT INTO users (id, email, emailVisibility, verified, passwordHash, tokenKey, name, created, updated)
               VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)`,
              'usr_store_manager',
              managerEmail,
              managerHash,
              crypto.randomBytes(16).toString('hex'),
              'Store Manager',
              managerNow,
              managerNow
            );
          } else {
            await scope.db.run('UPDATE users SET passwordHash = ? WHERE email = ?', managerHash, managerEmail);
          }

          // Ensure categories and products collection rules match configured managerEmail
          const managerRule = getStoreManagerRule();
          for (const colName of ['categories', 'products']) {
            const col = await scope.schema.getCollection(colName);
            if (col && (col.createRule !== managerRule || col.updateRule !== managerRule || col.deleteRule !== managerRule)) {
              await scope.schema.updateCollection(col.id, {
                createRule: managerRule,
                updateRule: managerRule,
                deleteRule: managerRule,
              });
            }
          }
        }
      } catch (err: any) {
        console.warn(`[AppManager] Pre-seeding demo users note: ${err.message}`);
      }

      // Ensure cart_items collection exists for persistent shopping cart
      try {
        const hasCartCol = await scope.schema.getCollection('cart_items');
        if (!hasCartCol) {
          await scope.schema.createCollection({
            name: 'cart_items',
            type: 'base',
            listRule: '@request.auth.id != "" && user = @request.auth.id',
            viewRule: '@request.auth.id != "" && user = @request.auth.id',
            createRule: '@request.auth.id != "" && user = @request.auth.id',
            updateRule: '@request.auth.id != "" && user = @request.auth.id',
            deleteRule: '@request.auth.id != "" && user = @request.auth.id',
            schema: [
              {
                id: 'f_cart_user',
                name: 'user',
                type: 'relation',
                required: true,
                options: { collectionId: 'users' },
              },
              {
                id: 'f_cart_prod',
                name: 'product',
                type: 'relation',
                required: true,
                options: { collectionId: 'products' },
              },
              {
                id: 'f_cart_qty',
                name: 'quantity',
                type: 'number',
                required: true,
              },
            ],
          });
        }
      } catch (err: any) {
        console.warn(`[AppManager] cart_items collection note: ${err.message}`);
      }

      return scope;
    } catch (err: any) {
      console.warn(`[AppManager] ensureDemoAppInitialized warning: ${err.message}`);
      return undefined;
    }
  }

  public async list(): Promise<AppModel[]> {
    const apps = await this.registry.getAllApps();
    const result: AppModel[] = [];

    for (const app of apps) {
      const scope = this.appCache.get(app.slug) || this.appCache.get(app.id);
      if (scope) {
        try {
          const collections = await scope.schema.getAllCollections();
          const cols = collections || [];
          const collectionsCount = cols.filter((c: any) => !c.system).length;
          let recordsCount = 0;
          for (const col of cols) {
            if (!col.system) {
              const countRow = await scope.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${scope.db.dialect.quoteIdentifier(col.name)}`);
              recordsCount += Number(countRow?.count || 0);
            }
          }
          let dbSizeBytes = 0;
          if (scope.db.dialect?.name === 'postgres') {
            try {
              const targetSchema = (scope.db as any).getSchemaName?.() || 
                (typeof (scope.db.getDriver?.() as any)?.getSchemaName === 'function' ? (scope.db.getDriver() as any).getSchemaName() : (app.slug === 'default' ? 'public' : `app_${app.slug}`));
              const sizeRow = await scope.db.get<{ size: number | string }>(
                `SELECT COALESCE(SUM(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))), 0) as size ` +
                `FROM pg_tables WHERE schemaname = current_schema() OR schemaname = '${targetSchema.replace(/'/g, "''")}'`
              );
              if (sizeRow?.size !== undefined && sizeRow.size !== null) {
                dbSizeBytes = Number(sizeRow.size);
              }
            } catch {}
          } else if (scope.db.dialect?.name === 'mssql') {
            try {
              const targetSchema = (scope.db as any).getSchemaName?.() || 
                (typeof (scope.db.getDriver?.() as any)?.getSchemaName === 'function' ? (scope.db.getDriver() as any).getSchemaName() : (app.slug === 'default' ? 'dbo' : `app_${app.slug}`));
              const sizeRow = await scope.db.get<{ size: number | string }>(
                `SELECT COALESCE(SUM(a.total_pages) * 8 * 1024, 0) as size ` +
                `FROM sys.tables t ` +
                `JOIN sys.schemas s ON t.schema_id = s.schema_id ` +
                `JOIN sys.indexes i ON t.object_id = i.object_id ` +
                `JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id ` +
                `JOIN sys.allocation_units a ON p.partition_id = a.container_id ` +
                `WHERE s.name = '${targetSchema.replace(/'/g, "''")}' OR s.name = SCHEMA_NAME()`
              );
              if (sizeRow?.size !== undefined && sizeRow.size !== null) {
                dbSizeBytes = Number(sizeRow.size);
              }
            } catch {}
          } else {
            const appDbPath = this.config.getAppDbPath(app.slug);
            dbSizeBytes = fs.existsSync(appDbPath) ? fs.statSync(appDbPath).size : 0;
          }
          result.push({
            ...app,
            stats: {
              collectionsCount,
              recordsCount,
              storageSizeBytes: 0,
              dbSizeBytes,
            },
          });
        } catch {
          result.push(app);
        }
      } else {
        result.push(app);
      }
    }

    return result;
  }

  public has(slugOrId: string): boolean {
    return this.appCache.has(slugOrId) || Boolean(this.registry.getAppSync(slugOrId));
  }

  public async hasAsync(slugOrId: string): Promise<boolean> {
    if (this.appCache.has(slugOrId)) return true;
    const app = await this.registry.getApp(slugOrId);
    return Boolean(app);
  }

  public get(slugOrId?: string): AppScope {
    const target = (slugOrId || 'default').trim();

    if (this.appCache.has(target)) {
      return this.appCache.get(target)!;
    }

    let appModel = this.registry.getAppSync(target);
    if (!appModel) {
      if (target === 'default' || target === 'app_default') {
        appModel = this.registry.getDefaultAppModel();
      } else {
        throw new NotFoundError(`Application '${target}' not found`);
      }
    }

    return this.createAndCacheScope(appModel);
  }

  public async getAsync(slugOrId?: string): Promise<AppScope> {
    const target = (slugOrId || 'default').trim();

    let scope = this.appCache.get(target);
    if (!scope) {
      let appModel = await this.registry.getApp(target);

      if (!appModel) {
        if (target === 'default' || target === 'app_default') {
          appModel = this.registry.getDefaultAppModel();
        } else {
          throw new NotFoundError(`Application '${target}' not found`);
        }
      }

      scope = this.createAndCacheScope(appModel);
    }

    // Await initialization before exposing the scope to callers
    await scope.ensureInitialized();
    return scope;
  }

  private createAndCacheScope(appModel: AppModel): AppScope {
    // Check if cached under other key (id vs slug)
    if (this.appCache.has(appModel.slug)) {
      return this.appCache.get(appModel.slug)!;
    }
    if (this.appCache.has(appModel.id)) {
      return this.appCache.get(appModel.id)!;
    }

    // Non-default applications start on SQLite by default unless driverFactory explicitly overrides
    const driverToUse = (appModel.slug === 'default' || appModel.isDefault) ? this.customDriver : undefined;
    const scope = AppScope.create(
      appModel,
      this.config,
      this.registry,
      driverToUse,
      this.driverFactory
    );
    this.appCache.set(appModel.slug, scope);
    this.appCache.set(appModel.id, scope);

    // Start queue and cron only after scope initialization (database open, schema, migrations) completes
    void scope.ensureInitialized().then(async () => {
      await scope.queue.start();
      await scope.cron.start();
    }).catch((err: any) => {
      console.warn(`[AppManager] Failed to start background services for app '${appModel.slug}': ${err?.message || err}`);
    });

    if (appModel.slug === 'default' || appModel.isDefault) {
      const propagateToTenants = (filter: any) => {
        for (const otherScope of this.getCachedScopes()) {
          if (otherScope !== scope) {
            otherScope.realtime.revokeClientsByIdentity({
              ...filter,
              onlySuperAdmin: true,
            });
          }
        }
      };
      scope.auth.onSessionRevoked(propagateToTenants);
      scope.apiKeys.onKeyRevoked(propagateToTenants);
    }

    for (const handler of this.onScopeInitHandlers) {
      try {
        handler(scope);
      } catch (err: any) {
        console.warn(`[AppManager] onScopeInit handler error: ${err.message}`);
      }
    }

    return scope;
  }

  public async create(dto: CreateAppDto): Promise<AppScope> {
    const appModel = await this.registry.createApp(dto);
    const scope = await this.getAsync(appModel.slug);
    await scope.queue.start();
    await scope.cron.start();

    if (dto.template && dto.template.trim()) {
      try {
        await scope.templates.apply(dto.template.trim());
      } catch (err: any) {
        // Template application is best-effort on creation
        console.warn(`Template '${dto.template}' failed to apply: ${err.message}`);
      }
    }

    return scope;
  }

  public async update(slugOrId: string, dto: UpdateAppDto): Promise<AppModel> {
    const updated = await this.registry.updateApp(slugOrId, dto);
    const cached = this.appCache.get(updated.slug) || this.appCache.get(updated.id);
    if (cached) {
      (cached as any).app = updated;
    }
    return updated;
  }

  public async delete(slugOrId: string): Promise<void> {
    const target = await this.registry.getAppOrThrow(slugOrId);
    if (target.isDefault || target.slug === 'default') {
      throw new AppError('Cannot delete the default application', 400);
    }

    if (target.slug === 'ecommerce-demo') {
      this.demoInitPromise = undefined;
    }

    const cached = this.appCache.get(target.slug) || this.appCache.get(target.id);
    if (cached) {
      await cached.closeAsync();
      this.appCache.delete(target.slug);
      this.appCache.delete(target.id);
    }

    await this.registry.deleteApp(target.id);

    const appDir = this.config.getAppDir(target.slug);
    if (fs.existsSync(appDir)) {
      try {
        fs.rmSync(appDir, { recursive: true, force: true });
      } catch {
        // ignore locked cleanup
      }
    }
  }

  public getLoadedScopes(): AppScope[] {
    return Array.from(new Set(this.appCache.values()));
  }

  public async closeAllAsync(): Promise<void> {
    const closed = new Set<AppScope>();
    for (const scope of this.appCache.values()) {
      if (!closed.has(scope)) {
        await scope.closeAsync();
        closed.add(scope);
      }
    }
    if (this.customDriver) {
      try {
        await this.customDriver.close();
      } catch {}
    }
    this.appCache.clear();
    await this.registry.close();
  }
}
