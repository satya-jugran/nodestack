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
  appSlug?: string;
  provider: string;
  connected: boolean;
  latencyMs: number;
  availableProviders: string[];
  config: Partial<DatabaseConfig>;
  activeSince?: string;
  snapshotsSupported?: boolean;
}

export class DatabaseConfigService {
  private encryptionKey: Buffer;
  private systemDriver: IDatabaseDriver;

  constructor(
    private config: ConfigService,
    systemDriver?: IDatabaseDriver
  ) {
    this.systemDriver = systemDriver || new NodeSqliteDriver(config.systemDbPath);
    DriverRegistry.setDefaultSqlitePaths({
      dataDir: this.config.dataDir,
      appsDir: this.config.appsDir,
      dbPath: this.config.getAppDbPath('default'),
    });
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
        app_slug TEXT NOT NULL DEFAULT 'default',
        provider TEXT NOT NULL,
        encrypted_config TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
    `);

    // Backwards-compatibility migration for older _db_configs schema
    try {
      const tableInfo = await this.systemDriver.prepare('PRAGMA table_info(_db_configs)').all<{ name: string }>();
      const rows = Array.isArray(tableInfo) ? tableInfo : [];
      if (!rows.some((c) => c.name === 'app_slug')) {
        await this.systemDriver.exec(`ALTER TABLE _db_configs ADD COLUMN app_slug TEXT NOT NULL DEFAULT 'default'`);
      }
    } catch {
      // ignore
    }
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

  public async getActiveConfig(appSlug = 'default'): Promise<DatabaseConfig> {
    await this.init();
    const cleanSlug = (appSlug || 'default').trim();
    const row = await this.systemDriver
      .prepare('SELECT * FROM _db_configs WHERE app_slug = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1')
      .get<{
        id: string;
        app_slug?: string;
        provider: string;
        encrypted_config: string;
        iv: string;
        auth_tag: string;
        updated_at: string;
      }>(cleanSlug);

    if (!row) {
      // Default to sqlite for this app
      const appDbPath = this.config.getAppDbPath(cleanSlug);
      const defaultConfig: DatabaseConfig = {
        provider: 'sqlite',
        dbPath: appDbPath,
        dataDir: this.config.dataDir,
      };
      await this.saveConfig(defaultConfig, true, cleanSlug);
      return defaultConfig;
    }

    try {
      const cfg = this.decryptConfig(row.encrypted_config, row.iv, row.auth_tag);
      return { ...cfg, id: row.id, provider: row.provider as any };
    } catch {
      // If decryption fails (e.g. secret rotated), fallback to sqlite
      return {
        provider: 'sqlite',
        dbPath: this.config.getAppDbPath(cleanSlug),
        dataDir: this.config.dataDir,
      };
    }
  }

  public async getLatestConfigForProvider(provider: string, appSlug = 'default'): Promise<DatabaseConfig | null> {
    await this.init();
    const cleanSlug = (appSlug || 'default').trim();
    let row = await this.systemDriver
      .prepare('SELECT * FROM _db_configs WHERE provider = ? AND app_slug = ? ORDER BY updated_at DESC LIMIT 1')
      .get<{
        id: string;
        provider: string;
        encrypted_config: string;
        iv: string;
        auth_tag: string;
        updated_at: string;
      }>(provider, cleanSlug);

    if (!row) {
      row = await this.systemDriver
        .prepare('SELECT * FROM _db_configs WHERE provider = ? ORDER BY updated_at DESC LIMIT 1')
        .get<{
          id: string;
          provider: string;
          encrypted_config: string;
          iv: string;
          auth_tag: string;
          updated_at: string;
        }>(provider);
    }

    if (!row) return null;
    try {
      const cfg = this.decryptConfig(row.encrypted_config, row.iv, row.auth_tag);
      return { ...cfg, id: row.id, provider: row.provider as any };
    } catch {
      return null;
    }
  }

  public async saveConfig(config: DatabaseConfig, setActive = true, appSlug = 'default'): Promise<string> {
    await this.init();
    const cleanSlug = (appSlug || 'default').trim();
    const id = config.id || `dbcfg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const { encryptedConfig, iv, authTag } = this.encryptConfig(config);

    if (setActive) {
      await this.systemDriver.prepare('UPDATE _db_configs SET is_active = 0 WHERE app_slug = ?').run(cleanSlug);
    }

    await this.systemDriver.prepare(`
      INSERT INTO _db_configs (id, app_slug, provider, encrypted_config, iv, auth_tag, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, cleanSlug, config.provider, encryptedConfig, iv, authTag, setActive ? 1 : 0, now);

    return id;
  }

  public async testConnection(targetConfig: DatabaseConfig): Promise<ConnectionTestResult> {
    if (!targetConfig || !targetConfig.provider) {
      return {
        ok: false,
        latencyMs: 0,
        error: "Missing database configuration or 'provider'",
      };
    }
    const start = Date.now();
    let tempDriver: IDatabaseDriver | null = null;
    try {
      // 1. Create primary driver without replicas to avoid redundant pool init
      const primaryOnlyConfig: DatabaseConfig = {
        ...targetConfig,
        dataDir: targetConfig.dataDir || (targetConfig.provider === 'sqlite' ? this.config.dataDir : undefined),
        appsDir: targetConfig.appsDir || (targetConfig.provider === 'sqlite' ? this.config.appsDir : undefined),
        readReplicas: undefined,
      };
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
        version: `${(targetConfig?.provider || 'unknown').toUpperCase()} (verified)`,
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

  public async getStatus(currentDriver: IDatabaseDriver, appSlug = 'default'): Promise<DatabaseStatus> {
    const cleanSlug = (appSlug || 'default').trim();
    const activeConfig = await this.getActiveConfig(cleanSlug);
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
      appSlug: cleanSlug,
      provider: activeConfig.provider,
      connected,
      latencyMs,
      availableProviders: DriverRegistry.listAvailableProviders(),
      config: this.redactConfig(activeConfig),
      snapshotsSupported: activeConfig.provider === 'sqlite',
    };
  }
}
