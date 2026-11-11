import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { DatabaseConfigService } from '../../database/config/DatabaseConfigService';
import { AppManager } from '../../apps/AppManager';
import { DatabaseMigrationService, MigrationProgress } from '../../database/migration/DatabaseMigrationService';
import { DriverRegistry, DatabaseConfig } from '../../database/drivers/DriverRegistry';
import { DatabaseService } from '../../database/DatabaseService';
import { MaintenanceGate } from '../../core/maintenance/MaintenanceGate';

export class DatabaseController extends BaseController {
  private activeMigrationProgress: MigrationProgress | null = null;

  constructor(
    private dbConfigService: DatabaseConfigService,
    private appManager: AppManager,
    private rootDb: DatabaseService,
    private maintenanceGate?: MaintenanceGate
  ) {
    super();
  }

  private resolveAppSlug(req: any): string {
    const fromBody = req.body?.appSlug;
    const fromHeader = req.headers?.['x-nodestack-app'];
    const fromQuery = req.query?.app || req.query?.appSlug;
    const fromScope = req.appScope?.app?.slug;
    const resolved = (fromBody || fromHeader || fromQuery || fromScope || 'default').trim();
    return resolved || 'default';
  }

  public async getStatus(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const appSlug = this.resolveAppSlug(req);
      const scope = await this.appManager.getAsync(appSlug);
      const driver = scope.db.getRootDriver();
      const status = await this.dbConfigService.getStatus(driver, appSlug);
      this.ok(reply, status);
    } catch (err: any) {
      this.error(reply, err.message || 'Failed to retrieve database status', 500);
    }
  }

  public async getMigrationProgress(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    this.ok(reply, this.activeMigrationProgress || { active: false, percent: 0, message: 'Idle' });
  }

  public async testConnection(
    req: FastifyRequest<{ Body: DatabaseConfig }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      if (!req.body || !req.body.provider) {
        this.error(reply, "Missing target database configuration or 'provider'", 400);
        return;
      }
      const result = await this.dbConfigService.testConnection(req.body);
      this.ok(reply, result);
    } catch (err: any) {
      this.error(reply, err.message || 'Connection test failed', 400);
    }
  }

  public async switchDatabase(
    req: FastifyRequest<{ Body: { config: DatabaseConfig; migrateData?: boolean; confirmText?: string; appSlug?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { config, migrateData = false, confirmText, appSlug: bodySlug } = req.body || {};
    if (!config || !config.provider) {
      this.error(reply, "Missing target database configuration or 'provider'", 400);
      return;
    }

    const appSlug = (bodySlug || this.resolveAppSlug(req)).trim();

    // Mandatory user consent check when migrating data
    if (migrateData) {
      if (!confirmText || confirmText.trim().toLowerCase() !== 'migrate') {
        this.error(
          reply,
          "Confirmation required: Please type 'migrate' to confirm database migration and proceed.",
          400
        );
        return;
      }
    }

    if (config.provider === 'sqlite') {
      const activeDataDir = this.appManager?.config?.dataDir || DriverRegistry.getDefaultSqlitePaths().dataDir;
      const activeAppsDir = this.appManager?.config?.appsDir || DriverRegistry.getDefaultSqlitePaths().appsDir;
      const activeDbPath = this.appManager?.config?.getAppDbPath(appSlug) || DriverRegistry.getDefaultSqlitePaths().dbPath;

      config.dataDir = activeDataDir || config.dataDir;
      config.appsDir = activeAppsDir || config.appsDir;
      config.dbPath = config.dbPath || activeDbPath;

      const rawPath = config.connectionString || config.dbPath;
      if (rawPath && rawPath !== ':memory:' && activeDataDir) {
        try {
          DriverRegistry.validateSqlitePath(rawPath, activeDataDir, activeAppsDir);
        } catch (err: any) {
          this.error(reply, err.message, 400);
          return;
        }
      }
    }

    this.activeMigrationProgress = {
      phase: 'starting',
      percent: 1,
      message: `Initializing cutover to ${config.provider.toUpperCase()} for application '${appSlug}'...`,
    };

    let scope: any;
    try {
      if (typeof this.appManager.getAsync === 'function') {
        scope = await this.appManager.getAsync(appSlug);
      } else if (typeof this.appManager.get === 'function') {
        scope = this.appManager.get(appSlug);
      }
    } catch {
      // App scope may not exist in mock environments
    }

    const executeSwitch = async () => {
      // 1. Verify connection to target database
      this.activeMigrationProgress = {
        phase: 'starting',
        percent: 2,
        message: `Testing connection to ${config.provider.toUpperCase()}...`,
      };
      const testRes = await this.dbConfigService.testConnection(config);
      if (!testRes.ok) {
        throw new Error(`Target database connection test failed: ${testRes.error}`);
      }

      const oldDriver = scope?.db ? scope.db.getRootDriver() : this.rootDb.getRootDriver();
      const newDriver = await DriverRegistry.createDriver(config);

      let migrationSummary = null;
      try {
        // 2. Perform symmetric migration for this single app scope if requested
        if (migrateData) {
          const targetAppDriver = await newDriver.withSchema(appSlug);
          try {
            migrationSummary = await DatabaseMigrationService.migrateAppScope(
              oldDriver,
              targetAppDriver,
              (progress) => {
                this.activeMigrationProgress = { ...progress };
              },
              { appIndex: 0, totalApps: 1, appSlug }
            );
          } finally {
            if (targetAppDriver && targetAppDriver !== newDriver) {
              try {
                await targetAppDriver.close();
              } catch {}
            }
          }
        }

        this.activeMigrationProgress = {
          phase: 'verifying',
          percent: 96,
          message: `Hot-swapping active driver for application '${appSlug}'...`,
        };

        // 3. Hot-swap active driver for this application scope
        if (typeof this.appManager.switchAppDriver === 'function') {
          await this.appManager.switchAppDriver(appSlug, newDriver);
        } else if (typeof this.appManager.switchDriver === 'function') {
          await this.appManager.switchDriver(newDriver, appSlug);
        }

        this.activeMigrationProgress = {
          phase: 'verifying',
          percent: 98,
          message: 'Saving updated database engine configuration...',
        };

        // 4. Persist new encrypted config for appSlug in control plane SQLite (_db_configs) only after hot-swap succeeds
        await this.dbConfigService.saveConfig(config, true, appSlug);

        this.activeMigrationProgress = {
          phase: 'completed',
          percent: 100,
          message: `Application '${appSlug}' database switched successfully to ${config.provider.toUpperCase()}`,
        };

        return migrationSummary;
      } catch (err: any) {
        this.activeMigrationProgress = {
          phase: 'failed',
          percent: 0,
          message: err?.message || 'Database migration failed',
        };
        try {
          await newDriver.close();
        } catch {
          // ignore
        }
        throw err;
      }
    };

    try {
      let migrationSummary: any;
      if (this.maintenanceGate) {
        migrationSummary = await this.maintenanceGate.executeExclusive(executeSwitch);
      } else {
        migrationSummary = await executeSwitch();
      }

      // 5. Post-migration snapshot reset & baseline creation for this application (after exclusive gate released)
      if (scope?.snapshots) {
        try {
          await scope.snapshots.clearAllSnapshots();
          if (config.provider === 'sqlite') {
            await scope.snapshots.createSnapshot({
              name: 'Post-Migration Baseline',
              description: `Automatic baseline snapshot created after migrating '${appSlug}' to SQLite.`,
            });
          }
        } catch (snapErr: any) {
          console.warn(`[DatabaseController] Post-migration snapshot note for '${appSlug}': ${snapErr.message}`);
        }
      }

      this.ok(reply, {
        success: true,
        message: `Database switched successfully to ${config.provider} for application '${appSlug}'`,
        provider: config.provider,
        appSlug,
        migration: migrationSummary,
      });
    } catch (err: any) {
      if (this.activeMigrationProgress?.phase !== 'failed') {
        this.activeMigrationProgress = {
          phase: 'failed',
          percent: 0,
          message: err.message || 'Failed to switch database',
        };
      }
      this.error(reply, err.message || 'Failed to switch database', 500);
    }
  }
}
