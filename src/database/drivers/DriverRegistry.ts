import * as path from 'path';
import { IDatabaseDriver } from './IDatabaseDriver';
import { NodeSqliteDriver } from './NodeSqliteDriver';
import { PostgresDriver } from './PostgresDriver';
import { MssqlDriver } from './MssqlDriver';

export interface DatabaseConfig {
  id?: string;
  provider: 'sqlite' | 'postgres' | 'mssql' | (string & {});
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | Record<string, any>;
  dataDir?: string;
  appsDir?: string;
  dbPath?: string;
  readReplicas?: string[];
  options?: Record<string, any>;
  pool?: {
    max?: number;
    min?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  };
}

export type DriverFactory = (config: DatabaseConfig) => IDatabaseDriver | Promise<IDatabaseDriver>;

export class DriverRegistry {
  private static factories = new Map<string, DriverFactory>();
  private static defaultDataDir?: string;
  private static defaultAppsDir?: string;
  private static defaultDbPath?: string;

  public static setDefaultSqlitePaths(paths: { dataDir?: string; appsDir?: string; dbPath?: string }): void {
    if (paths.dataDir) DriverRegistry.defaultDataDir = paths.dataDir;
    if (paths.appsDir) DriverRegistry.defaultAppsDir = paths.appsDir;
    if (paths.dbPath) DriverRegistry.defaultDbPath = paths.dbPath;
  }

  public static getDefaultSqlitePaths(): { dataDir?: string; appsDir?: string; dbPath?: string } {
    return {
      dataDir: DriverRegistry.defaultDataDir,
      appsDir: DriverRegistry.defaultAppsDir,
      dbPath: DriverRegistry.defaultDbPath,
    };
  }

  public static resetDefaultSqlitePaths(): void {
    DriverRegistry.defaultDataDir = undefined;
    DriverRegistry.defaultAppsDir = undefined;
    DriverRegistry.defaultDbPath = undefined;
  }

  public static isPathContained(targetPath: string, allowedDir: string): boolean {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedAllowed = path.resolve(allowedDir);

    const isWindows = process.platform === 'win32';
    const targetNorm = isWindows ? resolvedTarget.toLowerCase() : resolvedTarget;
    const allowedNorm = isWindows ? resolvedAllowed.toLowerCase() : resolvedAllowed;

    if (targetNorm === allowedNorm) {
      return true;
    }

    const prefix = allowedNorm.endsWith(path.sep) ? allowedNorm : allowedNorm + path.sep;
    if (!targetNorm.startsWith(prefix)) {
      return false;
    }

    const rel = path.relative(resolvedAllowed, resolvedTarget);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  public static validateSqlitePath(filePath: string, dataDir?: string, appsDir?: string): string {
    if (!filePath || filePath === ':memory:') {
      return filePath || ':memory:';
    }

    const canonicalDataDir = path.resolve(
      dataDir || DriverRegistry.defaultDataDir || process.env.NODESTACK_DATA_DIR || process.env.NODEBASE_DATA_DIR || './nodestack_data'
    );
    const canonicalAppsDir = path.resolve(
      appsDir || DriverRegistry.defaultAppsDir || path.join(canonicalDataDir, 'apps')
    );

    const resolvedFilePath = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(canonicalDataDir, filePath);

    const targetDir = path.dirname(resolvedFilePath);

    const isWindows = process.platform === 'win32';
    const targetDirNorm = isWindows ? targetDir.toLowerCase() : targetDir;
    const dataDirNorm = isWindows ? canonicalDataDir.toLowerCase() : canonicalDataDir;
    const appsDirNorm = isWindows ? canonicalAppsDir.toLowerCase() : canonicalAppsDir;

    const dataPrefix = dataDirNorm.endsWith(path.sep) ? dataDirNorm : dataDirNorm + path.sep;
    const appsPrefix = appsDirNorm.endsWith(path.sep) ? appsDirNorm : appsDirNorm + path.sep;

    const startsWithData = targetDirNorm === dataDirNorm || targetDirNorm.startsWith(dataPrefix);
    const startsWithApps = targetDirNorm === appsDirNorm || targetDirNorm.startsWith(appsPrefix);

    const relData = path.relative(canonicalDataDir, targetDir);
    const relApps = path.relative(canonicalAppsDir, targetDir);
    const noTraversalData = !relData.startsWith('..') && !path.isAbsolute(relData);
    const noTraversalApps = !relApps.startsWith('..') && !path.isAbsolute(relApps);

    const isContained = (startsWithData && noTraversalData) || (startsWithApps && noTraversalApps);

    if (!isContained) {
      throw new Error(
        `SQLite database file path must be confined to the data directory or apps directory. Path '${filePath}' is outside allowed directories.`
      );
    }

    return resolvedFilePath;
  }

  static {
    DriverRegistry.register('sqlite', (config) => {
      const isExplicitMemory = config.dbPath === ':memory:' || config.connectionString === ':memory:';
      let filePath = config.connectionString;
      let appsDir = config.appsDir;
      let dataDir = config.dataDir;

      if (!isExplicitMemory) {
        if (config.dataDir) {
          if (DriverRegistry.defaultDataDir && !DriverRegistry.isPathContained(config.dataDir, DriverRegistry.defaultDataDir)) {
            throw new Error(
              `SQLite database dataDir must be confined to the configured data directory. Path '${config.dataDir}' is outside allowed directory.`
            );
          }
          dataDir = config.dataDir;
          appsDir = config.appsDir || path.join(dataDir, 'apps');
        } else if (DriverRegistry.defaultDataDir) {
          dataDir = DriverRegistry.defaultDataDir;
          appsDir = appsDir || DriverRegistry.defaultAppsDir || path.join(dataDir, 'apps');
        } else {
          dataDir = process.env.NODESTACK_DATA_DIR || process.env.NODEBASE_DATA_DIR || path.resolve('./nodestack_data');
          appsDir = appsDir || path.join(dataDir, 'apps');
        }

        const canonicalDataDir = path.resolve(dataDir);
        const canonicalAppsDir = path.resolve(appsDir);

        if (!filePath) {
          if (config.dbPath) {
            filePath = config.dbPath;
          } else if (config.appsDir) {
            filePath = path.join(canonicalAppsDir, 'default', 'data.db');
          } else if (!config.dataDir && DriverRegistry.defaultDbPath) {
            filePath = DriverRegistry.defaultDbPath;
          } else {
            filePath = path.join(canonicalAppsDir, 'default', 'data.db');
          }
        }

        filePath = DriverRegistry.validateSqlitePath(filePath, canonicalDataDir, canonicalAppsDir);
        dataDir = canonicalDataDir;
        appsDir = canonicalAppsDir;
      } else {
        filePath = filePath || config.dbPath || ':memory:';
      }

      return new NodeSqliteDriver(filePath || ':memory:', { baseDir: appsDir });
    });

    DriverRegistry.register('postgres', (config) => {
      if (config.connectionString) {
        return new PostgresDriver({
          connectionString: config.connectionString,
          ssl: config.ssl,
          readReplicas: config.readReplicas,
          ...config.pool,
        });
      }
      return new PostgresDriver({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        ssl: config.ssl,
        readReplicas: config.readReplicas,
        ...config.pool,
      });
    });

    DriverRegistry.register('mssql', (config) => {
      const trustServerCert = config.options?.trustServerCertificate !== undefined
        ? Boolean(config.options.trustServerCertificate)
        : true;
      const encrypt = config.options?.encrypt !== undefined
        ? Boolean(config.options.encrypt)
        : (typeof config.ssl === 'boolean' ? config.ssl : true);

      if (config.connectionString) {
        return new MssqlDriver({
          connectionString: config.connectionString,
          readReplicas: config.readReplicas,
          pool: config.pool,
          options: {
            encrypt,
            trustServerCertificate: trustServerCert,
            ...config.options,
          },
        });
      }
      return new MssqlDriver({
        server: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        options: {
          encrypt,
          trustServerCertificate: trustServerCert,
          ...config.options,
        },
        readReplicas: config.readReplicas,
        pool: config.pool,
      });
    });
  }

  public static register(provider: string, factory: DriverFactory): void {
    DriverRegistry.factories.set(provider.toLowerCase(), factory);
  }

  public static has(provider: string): boolean {
    return DriverRegistry.factories.has(provider.toLowerCase());
  }

  public static listAvailableProviders(): string[] {
    return Array.from(DriverRegistry.factories.keys());
  }

  public static async createDriver(config: DatabaseConfig): Promise<IDatabaseDriver> {
    const provider = (config.provider || 'sqlite').toLowerCase();
    if (provider === 'sqlite') {
      const isExplicitMemory = config.dbPath === ':memory:' || config.connectionString === ':memory:';
      if (!isExplicitMemory) {
        if (config.dataDir) {
          if (DriverRegistry.defaultDataDir && !DriverRegistry.isPathContained(config.dataDir, DriverRegistry.defaultDataDir)) {
            throw new Error(
              `SQLite database dataDir must be confined to the configured data directory. Path '${config.dataDir}' is outside allowed directory.`
            );
          }
          config.appsDir = config.appsDir || path.join(config.dataDir, 'apps');
          config.dbPath = config.dbPath || path.join(config.appsDir, 'default', 'data.db');
        } else {
          const defaultDataDir = DriverRegistry.defaultDataDir || process.env.NODESTACK_DATA_DIR || process.env.NODEBASE_DATA_DIR || path.resolve('./nodestack_data');
          config.dataDir = defaultDataDir;
          config.appsDir = config.appsDir || DriverRegistry.defaultAppsDir || (config.dataDir ? path.join(config.dataDir, 'apps') : undefined);
          config.dbPath = config.dbPath || (config.appsDir ? path.join(config.appsDir, 'default', 'data.db') : undefined) || DriverRegistry.defaultDbPath;
        }

        const canonicalDataDir = path.resolve(config.dataDir);
        const canonicalAppsDir = path.resolve(config.appsDir || path.join(canonicalDataDir, 'apps'));

        config.dataDir = canonicalDataDir;
        config.appsDir = canonicalAppsDir;

        const rawPath = config.connectionString || config.dbPath || path.join(canonicalAppsDir, 'default', 'data.db');
        const validatedPath = DriverRegistry.validateSqlitePath(rawPath, canonicalDataDir, canonicalAppsDir);
        if (config.connectionString) {
          config.connectionString = validatedPath;
        }
        config.dbPath = validatedPath;
      }
    }

    const factory = DriverRegistry.factories.get(provider);
    if (!factory) {
      throw new Error(`Unsupported database provider '${config.provider}'. Available: ${DriverRegistry.listAvailableProviders().join(', ')}`);
    }
    return await factory(config);
  }
}
