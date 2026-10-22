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
    return this.get('default');
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
