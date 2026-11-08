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

  static {
    DriverRegistry.register('sqlite', (config) => {
      const filePath = config.dbPath || config.connectionString || (config.dataDir ? `${config.dataDir}/data.db` : ':memory:');
      return new NodeSqliteDriver(filePath, { baseDir: config.dataDir });
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
    const factory = DriverRegistry.factories.get(provider);
    if (!factory) {
      throw new Error(`Unsupported database provider '${config.provider}'. Available: ${DriverRegistry.listAvailableProviders().join(', ')}`);
    }
    return await factory(config);
  }
}
