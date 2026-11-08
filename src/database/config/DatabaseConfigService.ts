import * as crypto from 'crypto';
import { IDatabaseDriver } from '../drivers/IDatabaseDriver';
import { DatabaseConfig, DriverRegistry } from '../drivers/DriverRegistry';
import { ConfigService } from '../../core/config/ConfigService';
import { NodeSqliteDriver } from '../drivers/NodeSqliteDriver';

export interface ReplicaTestResult {
  url: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  version?: string;
  error?: string;
  replicas?: ReplicaTestResult[];
}

export interface DatabaseStatus {
  provider: string;
  connected: boolean;
  latencyMs: number;
  availableProviders: string[];
  config: Partial<DatabaseConfig>;
  activeSince?: string;
}

export class DatabaseConfigService {
  private encryptionKey: Buffer;
  private systemDriver: IDatabaseDriver;

  constructor(
    private config: ConfigService,
    systemDriver?: IDatabaseDriver
  ) {
    this.systemDriver = systemDriver || new NodeSqliteDriver(config.systemDbPath);
    // Derive a stable 32-byte key from jwtSecret / instance secret
    this.encryptionKey = crypto.scryptSync(
      this.config.jwtSecret || 'nodestack-fallback-secret-seed',
      'nodestack-db-config-salt',
      32
    );
  }

  public async init(): Promise<void> {
    await this.systemDriver.exec(`
      CREATE TABLE IF NOT EXISTS _db_configs (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        encrypted_config TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
    `);
  }

  public encryptConfig(plainConfig: DatabaseConfig): { encryptedConfig: string; iv: string; authTag: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const text = JSON.stringify(plainConfig);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return {
      encryptedConfig: encrypted,
      iv: iv.toString('hex'),
      authTag,
    };
  }

  public decryptConfig(encryptedHex: string, ivHex: string, authTagHex: string): DatabaseConfig {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }

  public redactConnectionString(str: string): string {
    if (!str || typeof str !== 'string') return str;
    // 1. URI format: protocol://user:pass@host
    let redacted = str.replace(/(:\/\/[^:]+:)[^@]+(@)/g, '$1••••••••$2');
    // 2. ADO.NET format: Password=... or Pwd=...
    redacted = redacted.replace(/((?:Password|Pwd)\s*=\s*)([^;]+)/gi, '$1••••••••');
    return redacted;
  }

  public redactConfig(config: DatabaseConfig): Partial<DatabaseConfig> {
    const copy: any = { ...config };
    if (copy.password) {
      copy.password = '••••••••';
    }
    if (copy.connectionString) {
      copy.connectionString = this.redactConnectionString(copy.connectionString);
    }
    if (Array.isArray(copy.readReplicas)) {
      copy.readReplicas = copy.readReplicas.map((uri: string) =>
        this.redactConnectionString(uri)
      );
    }
    return copy;
  }

  public async getActiveConfig(): Promise<DatabaseConfig> {
    await this.init();
    const row = await this.systemDriver
      .prepare('SELECT * FROM _db_configs WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1')
      .get<{
        id: string;
        provider: string;
        encrypted_config: string;
        iv: string;
        auth_tag: string;
        updated_at: string;
      }>();

    if (!row) {
      // Default to sqlite
      const defaultConfig: DatabaseConfig = {
        provider: 'sqlite',
        dbPath: this.config.dbPath,
        dataDir: this.config.dataDir,
      };
      await this.saveConfig(defaultConfig, true);
      return defaultConfig;
    }

    try {
      const cfg = this.decryptConfig(row.encrypted_config, row.iv, row.auth_tag);
      return { ...cfg, id: row.id, provider: row.provider as any };
    } catch {
      // If decryption fails (e.g. secret rotated), fallback to sqlite
      return {
        provider: 'sqlite',
        dbPath: this.config.dbPath,
        dataDir: this.config.dataDir,
      };
    }
  }

  public async saveConfig(config: DatabaseConfig, setActive = true): Promise<string> {
    await this.init();
    const id = config.id || `dbcfg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const { encryptedConfig, iv, authTag } = this.encryptConfig(config);

    if (setActive) {
      await this.systemDriver.exec('UPDATE _db_configs SET is_active = 0');
    }

    await this.systemDriver.prepare(`
      INSERT INTO _db_configs (id, provider, encrypted_config, iv, auth_tag, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, config.provider, encryptedConfig, iv, authTag, setActive ? 1 : 0, now);

    return id;
  }

  public async testConnection(targetConfig: DatabaseConfig): Promise<ConnectionTestResult> {
    const start = Date.now();
    let tempDriver: IDatabaseDriver | null = null;
    try {
      // 1. Create primary driver without replicas to avoid redundant pool init
      const primaryOnlyConfig: DatabaseConfig = { ...targetConfig, readReplicas: undefined };
      tempDriver = await DriverRegistry.createDriver(primaryOnlyConfig);
      const pingOk = await tempDriver.ping();
      if (!pingOk) {
        throw new Error('Database ping failed');
      }

      // Check schema/table creation privilege with a temporary test table
      const testTable = `_nd_test_${Date.now().toString(36)}`;
      await tempDriver.exec(`CREATE TABLE ${testTable} (id VARCHAR(50) PRIMARY KEY)`);
      await tempDriver.exec(`DROP TABLE ${testTable}`);

      let replicaResults: ReplicaTestResult[] = [];
      if (Array.isArray(targetConfig.readReplicas) && targetConfig.readReplicas.length > 0) {
        const replicaPromises = targetConfig.readReplicas
          .map((r) => r.trim())
          .filter((r) => Boolean(r))
          .map(async (replicaUri) => {
            const rStart = Date.now();
            const maskedUrl = this.redactConnectionString(replicaUri);
            let rDriver: IDatabaseDriver | null = null;
            try {
              const rConfig: DatabaseConfig = {
                provider: targetConfig.provider,
                connectionString: replicaUri,
                dbPath: targetConfig.provider === 'sqlite' ? replicaUri : undefined,
                ssl: targetConfig.ssl,
                options: targetConfig.options,
              };
              rDriver = await DriverRegistry.createDriver(rConfig);
              const rPing = await rDriver.ping();
              if (!rPing) throw new Error('Replica ping returned false');
              return {
                url: maskedUrl,
                ok: true,
                latencyMs: Date.now() - rStart,
              };
            } catch (rErr: any) {
              return {
                url: maskedUrl,
                ok: false,
                latencyMs: Date.now() - rStart,
                error: rErr.message || String(rErr),
              };
            } finally {
              if (rDriver) {
                try {
                  await rDriver.close();
                } catch {}
              }
            }
          });

        replicaResults = await Promise.all(replicaPromises);
      }

      const allReplicasOk = replicaResults.length === 0 || replicaResults.every((r) => r.ok);
      const latencyMs = Date.now() - start;

      return {
        ok: allReplicasOk,
        latencyMs,
        version: `${targetConfig.provider.toUpperCase()} (verified)`,
        error: allReplicasOk
          ? undefined
          : `One or more read replicas failed connection test: ${replicaResults
              .filter((r) => !r.ok)
              .map((r) => r.error)
              .join('; ')}`,
        replicas: replicaResults.length > 0 ? replicaResults : undefined,
      };
    } catch (err: any) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err.message || String(err),
      };
    } finally {
      if (tempDriver) {
        try {
          await tempDriver.close();
        } catch {}
      }
    }
  }

  public async getStatus(currentDriver: IDatabaseDriver): Promise<DatabaseStatus> {
    const activeConfig = await this.getActiveConfig();
    const start = Date.now();
    let connected = false;
    let latencyMs = 0;

    try {
      connected = await currentDriver.ping();
      latencyMs = Date.now() - start;
    } catch {
      connected = false;
    }

    return {
      provider: activeConfig.provider,
      connected,
      latencyMs,
      availableProviders: DriverRegistry.listAvailableProviders(),
      config: this.redactConfig(activeConfig),
    };
  }
}
