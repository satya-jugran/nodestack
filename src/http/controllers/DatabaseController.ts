import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { DatabaseConfigService } from '../../database/config/DatabaseConfigService';
import { AppManager } from '../../apps/AppManager';
import { DatabaseMigrationService } from '../../database/migration/DatabaseMigrationService';
import { DriverRegistry, DatabaseConfig } from '../../database/drivers/DriverRegistry';
import { DatabaseService } from '../../database/DatabaseService';
import { MaintenanceGate } from '../../core/maintenance/MaintenanceGate';

export class DatabaseController extends BaseController {
  constructor(
    private dbConfigService: DatabaseConfigService,
    private appManager: AppManager,
    private rootDb: DatabaseService,
    private maintenanceGate?: MaintenanceGate
  ) {
    super();
  }

  public async getStatus(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const status = await this.dbConfigService.getStatus(this.rootDb.getRootDriver());
      this.ok(reply, status);
    } catch (err: any) {
      this.error(reply, err.message || 'Failed to retrieve database status', 500);
    }
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
    req: FastifyRequest<{ Body: { config: DatabaseConfig; migrateData?: boolean } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { config, migrateData = false } = req.body || {};
    if (!config || !config.provider) {
      this.error(reply, "Missing target database configuration or 'provider'", 400);
      return;
    }

    if (config.provider === 'sqlite') {
      const activeDataDir = this.appManager?.config?.dataDir || DriverRegistry.getDefaultSqlitePaths().dataDir;
      const activeAppsDir = this.appManager?.config?.appsDir || DriverRegistry.getDefaultSqlitePaths().appsDir;
      const activeDbPath = this.appManager?.config?.getAppDbPath('default') || DriverRegistry.getDefaultSqlitePaths().dbPath;

      config.dataDir = config.dataDir || activeDataDir;
      config.appsDir = config.appsDir || activeAppsDir;
      config.dbPath = config.dbPath || activeDbPath;
    }

    const executeSwitch = async () => {
      // 1. Verify connection to target database
      const testRes = await this.dbConfigService.testConnection(config);
      if (!testRes.ok) {
        throw new Error(`Target database connection test failed: ${testRes.error}`);
      }

      const oldDriver = this.rootDb.getRootDriver();
      const newDriver = await DriverRegistry.createDriver(config);

      let migrationSummary = null;
      try {
        // 2. Perform symmetric migration if requested
        if (migrateData) {
          const apps = await this.appManager.registry.getAllApps();
          const appSlugs = apps.map((a: any) => a.slug);
          migrationSummary = await DatabaseMigrationService.migrateAllApps(
            oldDriver,
            newDriver,
            appSlugs
          );
        }

        // 3. Hot-swap active drivers in runtime across all scopes
        await this.appManager.switchDriver(newDriver);

        // 4. Persist new encrypted config in control plane SQLite (_db_configs) only after hot-swap succeeds
        await this.dbConfigService.saveConfig(config, true);

        return migrationSummary;
      } catch (err) {
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

      this.ok(reply, {
        success: true,
        message: `Database switched successfully to ${config.provider}`,
        provider: config.provider,
        migration: migrationSummary,
      });
    } catch (err: any) {
      this.error(reply, err.message || 'Failed to switch database', 500);
    }
  }
}
