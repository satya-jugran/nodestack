import * as fs from 'fs';
import { AppRegistry } from './AppRegistry';
import { AppScope } from './AppScope';
import { AppModel, CreateAppDto, UpdateAppDto } from './models/App';
import { ConfigService } from '../core/config/ConfigService';
import { AppError, NotFoundError } from '../core/errors/AppError';
import { DatabaseService } from '../database/DatabaseService';
import { IDatabaseDriver } from '../database/drivers/IDatabaseDriver';

export type DatabaseDriverFactory = (app: AppModel, defaultDbPath: string) => IDatabaseDriver;

export class AppManager {
  private appCache: Map<string, AppScope> = new Map();
  private onScopeInitHandlers: Array<(scope: AppScope) => void> = [];
  private demoInitPromise?: Promise<AppScope | undefined>;

  constructor(
    public readonly registry: AppRegistry,
    private config: ConfigService,
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

  public findScopeByDb(db: DatabaseService): AppScope | undefined {
    for (const scope of this.getCachedScopes()) {
      if (scope.db === db || (scope.db as any)?.driver === (db as any)?.driver) {
        return scope;
      }
    }
    for (const app of this.registry.getAllApps()) {
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
      let demoApp = this.registry.getApp('ecommerce-demo');
      if (!demoApp) {
        demoApp = this.registry.createApp({
          slug: 'ecommerce-demo',
          name: 'E-Commerce Demo',
          description: 'Retail storefront showcase pre-seeded with catalog, serverless lambdas, and event-driven flows',
          icon: 'shopping-bag',
        });
      }

      const scope = this.get('ecommerce-demo');

      // Idempotently apply ecommerce template: bootstraps or repairs missing collections,
      // serverless functions, and orchestration flows even on partially initialized scopes.
      await scope.templates.apply('ecommerce', { overwrite: Boolean(options?.overwrite) });

      // Ensure baseline snapshot exists for Reset to Demo State
      if (!scope.snapshots.hasSnapshot()) {
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
        const userCol = scope.schema.getCollection('users');
        if (userCol) {
          const crypto = require('crypto');
          const passwordHash = await scope.auth.hashPassword('DemoPassword123!');
          const userExists = scope.db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', 'alex.vance@nodestack.dev');
          if (!userExists) {
            const now = new Date().toISOString();
            scope.db.run(
              `INSERT INTO users (id, email, emailVisibility, verified, passwordHash, tokenKey, name, created, updated)
               VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)`,
              [
                'usr_alex_vance',
                'alex.vance@nodestack.dev',
                passwordHash,
                crypto.randomBytes(16).toString('hex'),
                'Alex Vance',
                now,
                now,
              ]
            );
          } else {
            scope.db.run('UPDATE users SET passwordHash = ? WHERE email = ?', [passwordHash, 'alex.vance@nodestack.dev']);
          }
        }
      } catch (err: any) {
        console.warn(`[AppManager] Pre-seeding demo user note: ${err.message}`);
      }

      // Ensure cart_items collection exists for persistent shopping cart
      try {
        const hasCartCol = scope.schema.getCollection('cart_items');
        if (!hasCartCol) {
          scope.schema.createCollection({
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

  public list(): AppModel[] {
    const apps = this.registry.getAllApps();
    return apps.map((app) => {
      const scope = this.appCache.get(app.slug) || this.appCache.get(app.id);
      if (scope) {
        try {
          const collections = scope.schema.getAllCollections();
          const collectionsCount = collections.filter((c) => !c.system).length;
          let recordsCount = 0;
          for (const col of collections) {
            if (!col.system) {
              const countRow = scope.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM "${col.name}"`);
              recordsCount += countRow?.count || 0;
            }
          }
          const appDbPath = this.config.getAppDbPath(app.slug);
          const dbSizeBytes = fs.existsSync(appDbPath) ? fs.statSync(appDbPath).size : 0;
          return {
            ...app,
            stats: {
              collectionsCount,
              recordsCount,
              storageSizeBytes: 0,
              dbSizeBytes,
            },
          };
        } catch {
          return app;
        }
      }
      return app;
    });
  }

  public has(slugOrId: string): boolean {
    return Boolean(this.registry.getApp(slugOrId));
  }

  public get(slugOrId?: string): AppScope {
    const target = (slugOrId || 'default').trim();

    if (this.appCache.has(target)) {
      return this.appCache.get(target)!;
    }

    const appModel = this.registry.getApp(target);
    if (!appModel) {
      throw new NotFoundError(`Application '${target}' not found`);
    }

    // Check if cached under other key (id vs slug)
    if (this.appCache.has(appModel.slug)) {
      return this.appCache.get(appModel.slug)!;
    }
    if (this.appCache.has(appModel.id)) {
      return this.appCache.get(appModel.id)!;
    }

    const scope = AppScope.create(
      appModel,
      this.config,
      this.registry,
      this.customDriver,
      this.driverFactory
    );
    this.appCache.set(appModel.slug, scope);
    this.appCache.set(appModel.id, scope);

    // Start queue for this app scope as part of its lifecycle (including lazily opened scopes)
    void scope.queue.start().catch((err: any) => {
      console.warn(`[AppManager] Failed to start queue for app '${appModel.slug}': ${err.message}`);
    });

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
    const appModel = this.registry.createApp(dto);
    const scope = this.get(appModel.slug);
    await scope.queue.start();

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

  public update(slugOrId: string, dto: UpdateAppDto): AppModel {
    const updated = this.registry.updateApp(slugOrId, dto);
    const cached = this.appCache.get(updated.slug) || this.appCache.get(updated.id);
    if (cached) {
      (cached as any).app = updated;
    }
    return updated;
  }

  public async delete(slugOrId: string): Promise<void> {
    const target = this.registry.getAppOrThrow(slugOrId);
    if (target.isDefault || target.slug === 'default') {
      throw new AppError('Cannot delete the default application', 400);
    }

    if (target.slug === 'ecommerce-demo') {
      this.demoInitPromise = undefined;
    }

    const cached = this.appCache.get(target.slug) || this.appCache.get(target.id);
    if (cached) {
      cached.close();
      this.appCache.delete(target.slug);
      this.appCache.delete(target.id);
    }

    this.registry.deleteApp(target.id);

    const appDir = this.config.getAppDir(target.slug);
    if (fs.existsSync(appDir)) {
      try {
        fs.rmSync(appDir, { recursive: true, force: true });
      } catch {
        // ignore locked cleanup
      }
    }
  }

  public async closeAllAsync(): Promise<void> {
    const closed = new Set<AppScope>();
    for (const scope of this.appCache.values()) {
      if (!closed.has(scope)) {
        await scope.closeAsync();
        closed.add(scope);
      }
    }
    this.appCache.clear();
    this.registry.close();
  }

  public closeAll(): void {
    const closed = new Set<AppScope>();
    for (const scope of this.appCache.values()) {
      if (!closed.has(scope)) {
        scope.close();
        closed.add(scope);
      }
    }
    this.appCache.clear();
    this.registry.close();
  }
}
