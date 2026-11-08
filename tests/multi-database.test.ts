import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../src/core/config/ConfigService';
import { DatabaseService } from '../src/database/DatabaseService';
import { DatabaseConfigService } from '../src/database/config/DatabaseConfigService';
import { DriverRegistry, DatabaseConfig } from '../src/database/drivers/DriverRegistry';
import { DatabaseMigrationService } from '../src/database/migration/DatabaseMigrationService';
import { SystemMigrations } from '../src/database/migrations/SystemMigrations';
import { NodeSqliteDriver } from '../src/database/drivers/NodeSqliteDriver';
import { PostgresDriver } from '../src/database/drivers/PostgresDriver';
import { MssqlDriver } from '../src/database/drivers/MssqlDriver';
import { PostgresDialect } from '../src/database/dialects/PostgresDialect';
import { FtsService } from '../src/records/FtsService';
import { NodeStack } from '../src/NodeStack';
import { AppManager } from '../src/apps/AppManager';
import { AppRegistry } from '../src/apps/AppRegistry';
import { DatabaseController } from '../src/http/controllers/DatabaseController';
import { AdminUIBundler } from '../src/admin/AdminUIBundler';
import { AuthService } from '../src/auth/AuthService';
import { AuthMiddleware } from '../src/http/middleware/AuthMiddleware';
import { UnauthorizedError, NotFoundError } from '../src/core/errors/AppError';
import { MssqlDialect } from '../src/database/dialects/MssqlDialect';
import { MssqlFtsDriver } from '../src/records/fts/MssqlFtsDriver';
import { RecordService } from '../src/records/RecordService';
import { SchemaField } from '../src/schema/models/Field';
import { SchemaService } from '../src/schema/SchemaService';
import { LogicalSnapshotDriver } from '../src/snapshots/drivers/LogicalSnapshotDriver';
import { AnalyticsService } from '../src/analytics/AnalyticsService';
import { LogService } from '../src/logger/LogService';

describe('Multi-Database Architecture & Configuration Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_multi_db_data');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // ============================================================
  // 1. DatabaseConfigService & AES-256-GCM Encryption Tests
  // ============================================================
  describe('DatabaseConfigService & Encryption', () => {
    it('should encrypt and decrypt database credentials symmetrically using AES-256-GCM', () => {
      const config = new ConfigService({ dataDir: testDir, jwtSecret: 'super-secret-key-12345' });
      const service = new DatabaseConfigService(config);

      const plainConfig: DatabaseConfig = {
        provider: 'postgres',
        host: 'localhost',
        port: 5432,
        user: 'postgres_admin',
        password: 'TopSecretPassword!',
        database: 'production_db',
        connectionString: 'postgresql://postgres_admin:TopSecretPassword!@localhost:5432/production_db',
      };

      const encrypted = service.encryptConfig(plainConfig);
      expect(encrypted.encryptedConfig).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.encryptedConfig).not.toContain('TopSecretPassword!');

      const decrypted = service.decryptConfig(encrypted.encryptedConfig, encrypted.iv, encrypted.authTag);
      expect(decrypted.provider).toBe('postgres');
      expect(decrypted.password).toBe('TopSecretPassword!');
      expect(decrypted.database).toBe('production_db');
    });

    it('should redact sensitive passwords and connection strings for safe public API exposure', () => {
      const config = new ConfigService({ dataDir: testDir });
      const service = new DatabaseConfigService(config);

      const rawConfig: DatabaseConfig = {
        provider: 'postgres',
        host: 'db.example.com',
        user: 'app_user',
        password: 'sensitive_db_password',
        connectionString: 'postgres://app_user:sensitive_db_password@db.example.com:5432/nodestack',
        readReplicas: [
          'postgres://app_user:replica_secret1@replica1.example.com:5432/nodestack',
          'postgres://app_user:replica_secret2@replica2.example.com:5432/nodestack',
        ],
      };

      const redacted = service.redactConfig(rawConfig);
      expect(redacted.password).toBe('••••••••');
      expect(redacted.connectionString).toBe('postgres://app_user:••••••••@db.example.com:5432/nodestack');
      expect(redacted.host).toBe('db.example.com');
      expect(redacted.readReplicas).toBeDefined();
      expect(redacted.readReplicas![0]).toBe('postgres://app_user:••••••••@replica1.example.com:5432/nodestack');
      expect(redacted.readReplicas![1]).toBe('postgres://app_user:••••••••@replica2.example.com:5432/nodestack');
    });

    it('should initialize _db_configs table and return default SQLite config if none is active', async () => {
      const config = new ConfigService({ dataDir: testDir });
      const systemDriver = new NodeSqliteDriver(':memory:');
      const service = new DatabaseConfigService(config, systemDriver);

      const activeConfig = await service.getActiveConfig();
      expect(activeConfig.provider).toBe('sqlite');
      expect(activeConfig.dbPath).toBe(config.dbPath);

      // Verify that saving another configuration sets it as active
      const pgConfig: DatabaseConfig = {
        provider: 'postgres',
        host: '127.0.0.1',
        port: 5432,
        user: 'admin',
        password: 'pwd',
        database: 'mydb',
      };

      await service.saveConfig(pgConfig, true);
      const updatedActive = await service.getActiveConfig();
      expect(updatedActive.provider).toBe('postgres');
      expect(updatedActive.host).toBe('127.0.0.1');
      expect(updatedActive.password).toBe('pwd');

      await systemDriver.close();
    });
  });

  // ============================================================
  // 2. DriverRegistry Tests
  // ============================================================
  describe('DriverRegistry', () => {
    it('should list all supported database providers symmetrically', () => {
      const providers = DriverRegistry.listAvailableProviders();
      expect(providers).toContain('sqlite');
      expect(providers).toContain('postgres');
      expect(providers).toContain('mssql');
    });

    it('should create and ping SQLite driver seamlessly', async () => {
      const driver = await DriverRegistry.createDriver({
        provider: 'sqlite',
        dbPath: ':memory:',
      });

      expect(driver).toBeDefined();
      expect(driver.isOpen()).toBe(true);
      expect(await driver.ping()).toBe(true);
      expect(driver.dialect.quoteIdentifier('users')).toBe('"users"');

      await driver.close();
    });

    it('should route SELECT queries to read replicas and mutations to primary pool in PostgresDriver', async () => {
      const primaryQueries: string[] = [];
      const replicaQueries: string[] = [];

      const mockPrimaryPool: any = {
        query: async (sql: string, params?: any[]) => {
          primaryQueries.push(sql);
          return { rows: [{ id: 1, name: 'primary' }], rowCount: 1 };
        },
        connect: async () => ({
          query: async (sql: string, params?: any[]) => {
            if (sql.startsWith('SET search_path') || sql.startsWith('DISCARD')) {
              return { rows: [] };
            }
            return mockPrimaryPool.query(sql, params);
          },
          release: () => {},
        }),
        end: async () => {},
      };

      const mockReplicaPool: any = {
        query: async (sql: string, params?: any[]) => {
          replicaQueries.push(sql);
          return { rows: [{ id: 1, name: 'replica' }], rowCount: 1 };
        },
        connect: async () => ({
          query: async (sql: string, params?: any[]) => {
            if (sql.startsWith('SET search_path') || sql.startsWith('DISCARD')) {
              return { rows: [] };
            }
            return mockReplicaPool.query(sql, params);
          },
          release: () => {},
        }),
        end: async () => {},
      };

      const driver = new PostgresDriver({
        pool: mockPrimaryPool,
        replicaPools: [mockReplicaPool],
      });

      // 1. SELECT query should route to replica
      const selectRes = await driver.prepare('SELECT * FROM users WHERE id = ?').all(1);
      expect(selectRes[0].name).toBe('replica');
      expect(replicaQueries.length).toBe(1);
      expect(primaryQueries.length).toBe(0);

      // 2. INSERT query should route to primary
      await driver.prepare('INSERT INTO users (name) VALUES (?)').run('Alice');
      expect(primaryQueries.length).toBe(1);
      expect(replicaQueries.length).toBe(1);

      // 3. Fallback: if replica query drops, falls back to primary automatically
      mockReplicaPool.query = async () => {
        throw new Error('replica connection dropped');
      };
      const fallbackRes = await driver.prepare('SELECT * FROM users WHERE id = ?').all(1);
      expect(fallbackRes[0].name).toBe('primary');
      expect(primaryQueries.length).toBe(2);

      await driver.close();
    });
  });

  // ============================================================
  // 3. Symmetric DatabaseMigrationService Tests
  // ============================================================
  describe('DatabaseMigrationService', () => {
    it('should perform symmetric schema and data migration between two databases', async () => {
      const sourceDriver = new NodeSqliteDriver(':memory:');
      const targetDriver = new NodeSqliteDriver(':memory:');

      // 1. Setup source database with collections and records
      await sourceDriver.exec(`
        CREATE TABLE _collections (
          id TEXT PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          type TEXT NOT NULL,
          schema TEXT NOT NULL,
          system INTEGER NOT NULL DEFAULT 0,
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
      `);

      const now = new Date().toISOString();
      await sourceDriver.prepare(`
        INSERT INTO _collections (id, name, type, schema, system, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('col_articles', 'articles', 'base', JSON.stringify([
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_views', name: 'views', type: 'number', required: false },
      ]), 0, now, now);

      await sourceDriver.exec(`
        CREATE TABLE articles (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          views INTEGER,
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
      `);

      await sourceDriver.prepare(`
        INSERT INTO articles (id, title, views, created, updated)
        VALUES (?, ?, ?, ?, ?)
      `).run('art_1', 'Hello NodeStack', 42, now, now);

      await sourceDriver.prepare(`
        INSERT INTO articles (id, title, views, created, updated)
        VALUES (?, ?, ?, ?, ?)
      `).run('art_2', 'Multi-Database Architecture', 100, now, now);

      // 2. Perform migration
      const res = await DatabaseMigrationService.migrateAppScope(sourceDriver, targetDriver);
      expect(res.collectionsCount).toBe(1);
      expect(res.recordsCount).toBe(2);

      // 3. Verify target database has matching collections and records
      const targetCols = await targetDriver.prepare('SELECT * FROM _collections').all<any>();
      const userCol = targetCols.find((c: any) => c.name === 'articles');
      expect(userCol).toBeDefined();
      expect(userCol.name).toBe('articles');

      const targetRecords = await targetDriver.prepare('SELECT * FROM articles ORDER BY id ASC').all<any>();
      expect(targetRecords).toHaveLength(2);
      expect(targetRecords[0].title).toBe('Hello NodeStack');
      expect(Number(targetRecords[0].views)).toBe(42);
      expect(targetRecords[1].title).toBe('Multi-Database Architecture');
      expect(Number(targetRecords[1].views)).toBe(100);

      await sourceDriver.close();
      await targetDriver.close();
    });
  });

  // ============================================================
  // 4. HTTP Admin Endpoints & DatabaseController Integration
  // ============================================================
  describe('DatabaseController HTTP Integration', () => {
    it('should expose /api/system/database/status and return active SQLite provider status', async () => {
      const app = new NodeStack({ dataDir: testDir });

      await app.auth.createAdmin('admin@nodestack.dev', 'password123');
      const { token: adminToken } = await app.auth.authenticateAdmin('admin@nodestack.dev', 'password123');

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/system/database/status',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.provider).toBe('sqlite');
      expect(json.connected).toBe(true);
      expect(json.availableProviders).toContain('sqlite');
      expect(json.availableProviders).toContain('postgres');
      expect(json.availableProviders).toContain('mssql');

      app.close();
    });

    it('should test connections via /api/system/database/test including read replicas', async () => {
      const app = new NodeStack({ dataDir: testDir });

      await app.auth.createAdmin('admin@nodestack.dev', 'password123');
      const { token: adminToken } = await app.auth.authenticateAdmin('admin@nodestack.dev', 'password123');

      // 1. Valid test with primary and valid replicas
      const res = await app.server.inject({
        method: 'POST',
        url: '/api/system/database/test',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          provider: 'sqlite',
          dbPath: ':memory:',
          readReplicas: [':memory:'],
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.ok).toBe(true);
      expect(json.replicas).toBeDefined();
      expect(json.replicas.length).toBe(1);
      expect(json.replicas[0].ok).toBe(true);

      // 2. Test with an unreachable / invalid replica URL
      const failRes = await app.server.inject({
        method: 'POST',
        url: '/api/system/database/test',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          provider: 'sqlite',
          dbPath: ':memory:',
          readReplicas: ['Z:\\nonexistent_invalid_drive\\db.sqlite'],
        },
      });

      expect(failRes.statusCode).toBe(200);
      const failJson = JSON.parse(failRes.payload);
      expect(failJson.ok).toBe(false);
      expect(failJson.replicas).toBeDefined();
      expect(failJson.replicas[0].ok).toBe(false);
      expect(failJson.error).toContain('One or more read replicas failed connection test');

      app.close();
    });
  });
  // ============================================================
  // 5. Admin UI Integration & Bundler Tests
  // ============================================================
  describe("Admin UI Database Integration", () => {
    it("should bundle database.js and include database controls in Admin UI", () => {
      const uiDir = path.resolve(__dirname, "../src/admin/ui");
      const html = AdminUIBundler.bundle(uiDir);

      expect(html).toContain("btn-database-switcher");
      expect(html).toContain("topbar-database-label");
      expect(html).toContain("sidebar-database-link");
      expect(html).toContain("sidebar-database-badge");
      expect(html).toContain("Database Engine Configuration");
      expect(html).toContain("openDatabaseModal");
      expect(html).toContain("executeDatabaseSwitch");
      expect(html).toContain("nav-database");
      expect(html).toContain("db-field-replicas");
      expect(html).toContain("Read Replicas (Optional — HA Multi-Cluster)");
    });
  });

  // ============================================================
  // 6. Review Assessment Remediation Unit Tests (Items 1-12)
  // ============================================================
  describe('Review Assessment Remediation Unit Tests (Items 1-12)', () => {
    // Finding 1: PostgreSQL Connection Pool search_path Pollution
    it('Finding 1: should set search_path on checkout and reset to public before connection release in PostgresDriver', async () => {
      const executedCommands: string[] = [];
      let released = false;

      const mockConn = {
        query: async (sql: string) => {
          executedCommands.push(sql);
          return { rows: [{ id: 1 }] };
        },
        release: () => {
          released = true;
        },
      };

      const mockPool = {
        connect: async () => mockConn,
        query: async (sql: string) => mockConn.query(sql),
        end: async () => {},
      };

      const driver = new PostgresDriver({
        pool: mockPool,
        schemaName: 'app_tenant_alpha',
      });

      await driver.prepare('SELECT * FROM users').all();

      // Check search_path isolation lifecycle
      expect(executedCommands).toContain('SET search_path TO "app_tenant_alpha", public');
      expect(executedCommands).toContain('DISCARD TEMP; SET search_path TO public;');
      expect(released).toBe(true);

      await driver.close();
    });

    // Finding 2: Multi-Tenant Schema Naming & MSSQL Schema Isolation
    it('Finding 2: should normalize schema naming and qualify MSSQL tables with [schemaName]', async () => {
      const mockPool = {
        query: async () => ({ rows: [] }),
        end: async () => {},
      };

      const pgDriver = new PostgresDriver({ pool: mockPool });
      const defaultPg = await pgDriver.withSchema('default');
      expect(defaultPg.getSchemaName()).toBe('public');

      const tenantPg = await pgDriver.withSchema('ecommerce-store');
      expect(tenantPg.getSchemaName()).toBe('app_ecommerce_store');

      const mssqlExecuted: string[] = [];
      const mockMssqlPool = {
        request: () => ({
          input: () => {},
          query: async (sql: string) => {
            mssqlExecuted.push(sql);
            return { recordset: [] };
          },
        }),
        close: async () => {},
      };

      const mssqlDriver = new MssqlDriver({
        connectionPool: mockMssqlPool,
        schemaName: 'app_beta',
      });

      expect(mssqlDriver.getSchemaName()).toBe('app_beta');

      await mssqlDriver.prepare('SELECT id, name FROM users WHERE id = @p1').all(1);
      expect(mssqlExecuted[0]).toContain('[app_beta].[users]');

      await mssqlDriver.prepare('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = SCHEMA_NAME()').all();
      expect(mssqlExecuted[1]).toContain("TABLE_SCHEMA = 'app_beta'");
    });

    // Finding 3: FtsService Hot-Swap Driver Refresh
    it('Finding 3: should refresh IFtsDriver dynamically when database dialect changes', () => {
      const config = new ConfigService();
      const dbService = new DatabaseService(config);

      const fts = new FtsService(dbService);
      expect(fts.getFtsDriver().constructor.name).toBe('SqliteFts5Driver');

      // Emulate hot-swap to postgres dialect
      Object.defineProperty(dbService, 'dialect', {
        get: () => ({ name: 'postgres' }),
        configurable: true,
      });

      expect(fts.getFtsDriver().constructor.name).toBe('PostgresFtsDriver');
    });

    // Finding 4: Async Function Support in DatabaseService.transaction()
    it('Finding 4: should permit async transaction callbacks on async drivers and only reject on SQLite', async () => {
      const config = new ConfigService();
      const sqliteDb = new DatabaseService(config);

      // 1. SQLite rejects async callbacks
      expect(() => {
        sqliteDb.transaction(async () => {
          return 1;
        });
      }).toThrow('Asynchronous functions cannot be used with synchronous transaction()');

      // 2. Async driver (PostgreSQL) allows async callbacks
      const mockPgDriver: any = {
        dialect: { name: 'postgres' },
        isOpen: () => true,
        transaction: async (cb: any) => {
          return await cb(mockPgDriver);
        },
      };

      const pgDb = new DatabaseService(config, mockPgDriver);
      const res = await pgDb.transaction(async () => {
        return 42;
      });
      expect(res).toBe(42);
    });

    // Finding 6: MSSQL ADO.NET Password Redaction
    it('Finding 6: should redact passwords in both URI and ADO.NET connection strings', () => {
      const config = new ConfigService();
      const service = new DatabaseConfigService(config);

      // ADO.NET formats
      const ado1 = 'Server=localhost;Database=mydb;User Id=sa;Password=Secret123!;Encrypt=true';
      expect(service.redactConnectionString(ado1)).toBe(
        'Server=localhost;Database=mydb;User Id=sa;Password=••••••••;Encrypt=true'
      );

      const ado2 = 'Server=127.0.0.1,1433;Database=test;User Id=app;Pwd=SuperSecretPassword;';
      expect(service.redactConnectionString(ado2)).toBe(
        'Server=127.0.0.1,1433;Database=test;User Id=app;Pwd=••••••••;'
      );

      // URI format
      const uri = 'postgresql://admin:super_secret_pg_pass@pg.cluster.internal:5432/production';
      expect(service.redactConnectionString(uri)).toBe(
        'postgresql://admin:••••••••@pg.cluster.internal:5432/production'
      );
    });

    // Finding 7: Mutating CTE & Row Locking Routing in Read-Write Classifier
    it('Finding 7: should route mutating CTEs and row locking clauses to primary, not read replica', async () => {
      const primaryQueries: string[] = [];
      const replicaQueries: string[] = [];

      const mockConn = (poolName: string, queries: string[]) => ({
        query: async (sql: string) => {
          if (sql.startsWith('SET search_path') || sql.startsWith('DISCARD')) return { rows: [] };
          queries.push(sql);
          return { rows: [{ id: 1, name: poolName }] };
        },
        release: () => {},
      });

      const mockPrimaryPool = {
        connect: async () => mockConn('primary', primaryQueries),
        query: async (sql: string) => {
          primaryQueries.push(sql);
          return { rows: [{ id: 1, name: 'primary' }] };
        },
        end: async () => {},
      };

      const mockReplicaPool = {
        connect: async () => mockConn('replica', replicaQueries),
        query: async (sql: string) => {
          replicaQueries.push(sql);
          return { rows: [{ id: 1, name: 'replica' }] };
        },
        end: async () => {},
      };

      const driver = new PostgresDriver({
        pool: mockPrimaryPool,
        replicaPools: [mockReplicaPool],
      });

      // 1. Mutating CTE should route to primary
      const cteSql = 'WITH updated AS (UPDATE users SET name = $1 RETURNING *) SELECT * FROM updated';
      await driver.prepare(cteSql).all('Alice');
      expect(primaryQueries).toContain(cteSql);
      expect(replicaQueries.length).toBe(0);

      // 2. SELECT ... FOR UPDATE should route to primary
      const lockSql = 'SELECT * FROM accounts WHERE id = $1 FOR UPDATE';
      await driver.prepare(lockSql).all(1);
      expect(primaryQueries).toContain(lockSql);
      expect(replicaQueries.length).toBe(0);

      // 3. Regular read should route to replica
      const readSql = 'SELECT * FROM accounts WHERE id = $1';
      await driver.prepare(readSql).all(1);
      expect(replicaQueries).toContain(readSql);

      await driver.close();
    });

    // Finding 9: DriverRegistry Respects options.trustServerCertificate
    it('Finding 9: should forward trustServerCertificate and encrypt options in DriverRegistry', async () => {
      let createdOptions: any = null;
      DriverRegistry.register('mock-mssql', (config) => {
        createdOptions = {
          trustServerCertificate: config.options?.trustServerCertificate !== undefined
            ? Boolean(config.options.trustServerCertificate)
            : true,
          encrypt: config.options?.encrypt !== undefined
            ? Boolean(config.options.encrypt)
            : (typeof config.ssl === 'boolean' ? config.ssl : true),
        };
        return { dialect: { name: 'mssql' } } as any;
      });

      await DriverRegistry.createDriver({
        provider: 'mock-mssql',
        options: { trustServerCertificate: false, encrypt: false },
      });

      expect(createdOptions).toEqual({
        trustServerCertificate: false,
        encrypt: false,
      });

      const mssqlDriver = new MssqlDriver({
        connectionPool: { close: async () => {} },
        options: { trustServerCertificate: false },
      });
      expect(mssqlDriver.dialect.name).toBe('mssql');
    });

    // Finding 11: CLI Active Database Driver Loading
    it('Finding 11: should expose loadActiveDatabaseDriver on NodeStack instance', async () => {
      const app = new NodeStack({ dataDir: testDir });
      expect(typeof app.loadActiveDatabaseDriver).toBe('function');
      await expect(app.loadActiveDatabaseDriver()).resolves.toBeUndefined();
      app.close();
    });

    // Finding 5: MaintenanceGate Lock during Switch
    it('Finding 5: should execute switchDatabase within MaintenanceGate.executeExclusive', async () => {
      let exclusiveCalled = false;
      const mockMaintenanceGate: any = {
        executeExclusive: async (fn: any) => {
          exclusiveCalled = true;
          return await fn();
        },
      };

      const mockDbConfigService: any = {
        testConnection: async () => ({ ok: true }),
        saveConfig: async () => 'cfg_123',
      };

      const mockRootDriver: any = {
        close: async () => {},
        dialect: { name: 'sqlite' },
      };

      const mockRootDb: any = {
        getRootDriver: () => mockRootDriver,
      };

      const mockAppManager: any = {
        registry: { getAllApps: async () => [] },
        switchDriver: async () => {},
      };

      const controller = new DatabaseController(
        mockDbConfigService,
        mockAppManager,
        mockRootDb,
        mockMaintenanceGate
      );

      let replyData: any = null;
      const mockReply: any = {
        status: () => mockReply,
        code: () => mockReply,
        send: (d: any) => { replyData = d; },
      };

      await controller.switchDatabase(
        { body: { config: { provider: 'sqlite', dbPath: ':memory:' }, migrateData: false } } as any,
        mockReply
      );

      expect(exclusiveCalled).toBe(true);
      expect(replyData?.success).toBe(true);
    });

    // Finding 8: Post-migration count verification failure
    it('Finding 8: should throw on record count mismatch during migration verification', async () => {
      const source = new NodeSqliteDriver(':memory:');
      const target = new NodeSqliteDriver(':memory:');

      await SystemMigrations.run(source);
      await SystemMigrations.run(target);

      await source.exec(`CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT, created TEXT, updated TEXT)`);
      const now = new Date().toISOString();
      const postSchema = JSON.stringify([
        { id: 'f_title', name: 'title', type: 'text', required: false, unique: false },
      ]);
      await source.prepare(`
        INSERT INTO _collections (id, name, type, system, schema, indexes, options, created, updated)
        VALUES ('col_posts', 'posts', 'base', 0, ?, '[]', '{}', ?, ?)
      `).run(postSchema, now, now);

      await source.prepare(`INSERT INTO posts (id, title, created, updated) VALUES ('p1', 'Post 1', ?, ?)`).run(now, now);
      await source.prepare(`INSERT INTO posts (id, title, created, updated) VALUES ('p2', 'Post 2', ?, ?)`).run(now, now);

      // Monkey-patch target to simulate record count mismatch
      const originalPrepare = target.prepare.bind(target);
      target.prepare = (sql: string) => {
        if (sql.includes('SELECT COUNT(*) AS total FROM "posts"')) {
          return {
            get: async () => ({ total: 1 }), // Return 1 instead of 2
          } as any;
        }
        return originalPrepare(sql);
      };

      await expect(
        DatabaseMigrationService.migrateAppScope(source, target)
      ).rejects.toThrow("Migration verification failed for collection 'posts': count mismatch (source: 2, target: 1)");

      await source.close();
      await target.close();
    });

    // Finding 12: Concurrent replica testing & strip replicas from primary test driver
    it('Finding 12: should strip readReplicas when testing primary driver and test replicas concurrently', async () => {
      const config = new ConfigService();
      const service = new DatabaseConfigService(config);

      let primaryHadReplicas = true;
      DriverRegistry.register('test-finding-12', (cfg) => {
        if (!cfg.connectionString?.includes('replica')) {
          primaryHadReplicas = Array.isArray(cfg.readReplicas) && cfg.readReplicas.length > 0;
        }
        return {
          ping: async () => true,
          exec: async () => {},
          close: async () => {},
          dialect: { name: 'sqlite' },
        } as any;
      });

      const res = await service.testConnection({
        provider: 'test-finding-12',
        readReplicas: ['test://replica1', 'test://replica2'],
      });

      expect(res.ok).toBe(true);
      expect(primaryHadReplicas).toBe(false);
      expect(res.replicas?.length).toBe(2);
      expect(res.replicas?.[0].ok).toBe(true);
      expect(res.replicas?.[1].ok).toBe(true);
    });
  });

  // ============================================================
  // 7. Round 2 Review Edge Case Tests
  // ============================================================
  describe('Round 2 Review Edge Case Tests', () => {
    // 1. _params table migration without id column
    it('Round 2 Item 1: should migrate _params key-value table using key as primary key without error', async () => {
      const source = new NodeSqliteDriver(':memory:');
      const target = new NodeSqliteDriver(':memory:');

      await SystemMigrations.run(source);
      await SystemMigrations.run(target);

      // Insert custom system params into source
      await source.prepare('INSERT INTO _params (key, value) VALUES (?, ?)').run('app_title', 'My Custom Title');
      await source.prepare('INSERT INTO _params (key, value) VALUES (?, ?)').run('app_color', '#ff5500');

      // Migrate
      await DatabaseMigrationService.migrateAppScope(source, target);

      // Verify records on target
      const titleRow = await target.prepare('SELECT value FROM _params WHERE key = ?').get<any>('app_title');
      const colorRow = await target.prepare('SELECT value FROM _params WHERE key = ?').get<any>('app_color');
      expect(titleRow?.value).toBe('My Custom Title');
      expect(colorRow?.value).toBe('#ff5500');

      await source.close();
      await target.close();
    });

    // 2. 5-second self-drain delay exemption on /database/switch
    it('Round 2 Item 2: should exempt POST /api/system/database/switch from MaintenanceGate blocking', async () => {
      const app = new NodeStack({ dataDir: testDir });
      await app.auth.createAdmin('admin@nodestack.dev', 'password123');
      const { token: adminToken } = await app.auth.authenticateAdmin('admin@nodestack.dev', 'password123');

      // Emulate switch request and verify it responds well under the 5000ms drainTimeoutMs
      const start = Date.now();
      const res = await app.server.inject({
        method: 'POST',
        url: '/api/system/database/switch',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          config: {
            provider: 'sqlite',
            dbPath: ':memory:',
          },
          migrateData: false,
        },
      });

      const elapsed = Date.now() - start;
      expect(res.statusCode).toBe(200);
      expect(elapsed).toBeLessThan(3000);

      app.close();
    });

    // 3. Shared pool closure on driver switch or shutdown
    it('Round 2 Item 3: should close previous root customDriver on switchDriver and during closeAllAsync', async () => {
      let root1Closed = false;
      let root2Closed = false;

      const mockRoot1: any = {
        withSchema: async () => ({
          close: async () => {},
          dialect: { name: 'postgres' },
        }),
        close: async () => {
          root1Closed = true;
        },
      };

      const mockRoot2: any = {
        withSchema: async () => ({
          close: async () => {},
          dialect: { name: 'postgres' },
        }),
        close: async () => {
          root2Closed = true;
        },
      };

      const config = new ConfigService();
      const registry = new AppRegistry(config);
      const appManager = new AppManager(registry, config, mockRoot1);

      // Switch to mockRoot2 -> mockRoot1 should be closed
      await appManager.switchDriver(mockRoot2);
      expect(root1Closed).toBe(true);
      expect(root2Closed).toBe(false);

      // Close all -> mockRoot2 should be closed
      await appManager.closeAllAsync();
      expect(root2Closed).toBe(true);
    });

    // 4. MssqlDriver qualifySql rewrites OBJECT_ID('table') to [app_<slug>].[table]
    it('Round 2 Item 4: should qualify OBJECT_ID table arguments with tenant schema', () => {
      const mockPool = { close: async () => {} };
      const driver = new MssqlDriver({
        connectionPool: mockPool,
        schemaName: 'app_ecommerce',
      });

      const ddl1 = "IF OBJECT_ID('orders', 'U') IS NOT NULL DROP TABLE orders";
      const qualified1 = driver.qualifySql(ddl1);
      expect(qualified1).toContain("OBJECT_ID('[app_ecommerce].[orders]', 'U')");
      expect(qualified1).toContain("DROP TABLE [app_ecommerce].[orders]");

      const ddl2 = "IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_orders_status' AND object_id = OBJECT_ID('orders'))";
      const qualified2 = driver.qualifySql(ddl2);
      expect(qualified2).toContain("OBJECT_ID('[app_ecommerce].[orders]')");

      // Should not alter if already qualified
      const ddl3 = "IF OBJECT_ID('[app_ecommerce].[orders]') IS NOT NULL";
      expect(driver.qualifySql(ddl3)).toBe(ddl3);
    });

    // 5. SQLite target withSchema('default') and switchDriver resolve to dataDir/apps/default/data.db
    it('Review finding: should resolve SQLite target withSchema and switchDriver to dataDir/apps/<slug>/data.db', async () => {
      const sqliteTestDir = path.join(testDir, 'sqlite_switch_test');
      const config = new ConfigService({ dataDir: sqliteTestDir });
      const registry = new AppRegistry(config);
      await registry.init();

      // Register a tenant app
      await registry.createApp({
        slug: 'store',
        name: 'Store App',
      });

      const appManager = new AppManager(registry, config);
      const defaultScope = appManager.get('default');
      const storeScope = appManager.get('store');

      expect((defaultScope.db.getRootDriver() as any).getPath()).toBe(config.getAppDbPath('default'));
      expect((storeScope.db.getRootDriver() as any).getPath()).toBe(config.getAppDbPath('store'));

      // Create a SQLite target driver via DriverRegistry passing dataDir
      const targetDriver = await DriverRegistry.createDriver({
        provider: 'sqlite',
        dataDir: sqliteTestDir,
      }) as NodeSqliteDriver;

      expect(targetDriver.getPath()).toBe(config.getAppDbPath('default'));

      // Verify withSchema creates drivers under dataDir/apps/
      const defaultFromSchema = await targetDriver.withSchema('default') as NodeSqliteDriver;
      expect(defaultFromSchema.getPath()).toBe(config.getAppDbPath('default'));
      expect(defaultFromSchema.getPath()).not.toBe(path.join(sqliteTestDir, 'default', 'data.db'));

      const storeFromSchema = await targetDriver.withSchema('store') as NodeSqliteDriver;
      expect(storeFromSchema.getPath()).toBe(config.getAppDbPath('store'));
      expect(storeFromSchema.getPath()).not.toBe(path.join(sqliteTestDir, 'store', 'data.db'));

      await defaultFromSchema.close();
      await storeFromSchema.close();

      // Perform switchDriver with the targetDriver
      await appManager.switchDriver(targetDriver);

      expect((defaultScope.db.getRootDriver() as any).getPath()).toBe(config.getAppDbPath('default'));
      expect((storeScope.db.getRootDriver() as any).getPath()).toBe(config.getAppDbPath('store'));

      // Ensure no stray dataDir/default/data.db was created
      expect(fs.existsSync(path.join(sqliteTestDir, 'default', 'data.db'))).toBe(false);

      await appManager.closeAllAsync();
    });

    // 6. Non-SQLite custom driver resolution for default and tenant apps via get / getAsync
    it('Review finding: should resolve default app and tenant apps when custom async driver is supplied without SQLite sync error', async () => {
      const mockRows: any[] = [
        {
          id: 'app_tenant_x',
          name: 'Tenant X',
          slug: 'tenant-x',
          description: '',
          icon: 'box',
          isDefault: 0,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        },
      ];

      const mockAsyncDriver: any = {
        dialect: new PostgresDialect(),
        prepare: (sql: string) => ({
          get: async (idOrSlug: string) => {
            if (idOrSlug === 'default' || idOrSlug === 'app_default') {
              return {
                id: 'app_default',
                name: 'Default App',
                slug: 'default',
                description: '',
                icon: 'zap',
                isDefault: 1,
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
              };
            }
            return mockRows.find((r) => r.id === idOrSlug || r.slug === idOrSlug);
          },
          all: async () => mockRows,
          run: async () => ({ changes: 0, lastInsertRowid: 0 }),
        }),
        exec: async () => {},
        transaction: async (fn: any) => fn(mockAsyncDriver),
        withSchema: async (s: string) => mockAsyncDriver,
        ping: async () => true,
        close: async () => {},
        isOpen: () => true,
      };

      const config = new ConfigService();
      const registry = new AppRegistry(config, mockAsyncDriver);
      const appManager = new AppManager(registry, config, mockAsyncDriver);

      // 1. Synchronous get('default') must not throw "Application 'default' not found"
      expect(() => appManager.get('default')).not.toThrow();
      const defaultScope = appManager.get('default');
      expect(defaultScope.app.slug).toBe('default');

      // 2. Asynchronous getAsync for tenant app must resolve via registry.getApp()
      const tenantScope = await appManager.getAsync('tenant-x');
      expect(tenantScope).toBeDefined();
      expect(tenantScope.app.slug).toBe('tenant-x');

      // 3. Subsequent synchronous get finds it in appCache
      expect(appManager.get('tenant-x')).toBe(tenantScope);

      // 4. NodeStack construction with customDriver keeps control plane on SQLite while data plane uses customDriver
      const stack = new NodeStack({ customDriver: mockAsyncDriver });
      expect(stack.defaultApp).toBeDefined();
      expect(stack.registry.getDriver() instanceof NodeSqliteDriver).toBe(true);
      expect(stack.defaultApp.db.getRootDriver()).toBe(mockAsyncDriver);
    });

    // 7. AppScope async initialization tracking & error surfacing
    it('Review finding: should track and await AppScope async initialization and surface errors without swallowing', async () => {
      const config = new ConfigService();
      const registry = new AppRegistry(config);
      await registry.init();

      // Successful scope initialization
      const appManager = new AppManager(registry, config);
      const defaultScope = appManager.get('default');
      expect(defaultScope.ensureInitialized).toBeDefined();
      await expect(defaultScope.ensureInitialized()).resolves.toBeUndefined();

      // Scope with failing database initialization
      const failingDbService: any = {
        init: async () => {
          throw new Error('Remote connection timeout during migration');
        },
        getRootDriver: () => null,
        dialect: { quoteIdentifier: (i: string) => `"${i}"` },
      };

      const failingApp = {
        id: 'app_failing',
        name: 'Failing App',
        slug: 'failing',
        description: '',
        icon: 'box',
        isDefault: false,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };

      const failingScope = new (defaultScope.constructor as any)(
        failingApp,
        config,
        failingDbService,
        registry
      );

      // ensureInitialized must NOT swallow the error
      await expect(failingScope.ensureInitialized()).rejects.toThrow('Remote connection timeout during migration');
    });

    // 8. DatabaseService.reconnect() preserves active remote driver instead of reverting to SQLite
    it('Review finding: reconnect() preserves and recreates active remote driver type instead of reverting to SQLite', async () => {
      const config = new ConfigService({ dataDir: testDir });
      const mockConn = {
        query: async (sql: string) => {
          if (sql.includes('SELECT 1')) {
            return { rows: [{ ok: 1 }] };
          }
          return { rows: [] };
        },
        release: () => {},
      };
      const mockPool = {
        connect: async () => mockConn,
        query: async (sql: string) => {
          if (sql.includes('SELECT 1')) {
            return { rows: [{ ok: 1 }] };
          }
          return { rows: [] };
        },
        end: async () => {},
      };

      const pgDriver = new PostgresDriver({ pool: mockPool, schemaName: 'public' });
      const db = new DatabaseService(config, pgDriver);

      expect(db.getRootDriver()).toBe(pgDriver);
      expect(db.dialect.name).toBe('postgres');

      // 1. Calling reconnect() on a healthy, open Postgres driver preserves the active driver instance
      await db.reconnect();
      expect(db.getRootDriver()).toBe(pgDriver);
      expect(db.dialect.name).toBe('postgres');
      expect(db.isOpen()).toBe(true);

      // 2. Calling reconnect() after driver is closed recreates it via clone() rather than reverting to SQLite
      await pgDriver.close();
      expect(db.isOpen()).toBe(false);

      await db.reconnect();
      expect(db.getRootDriver() instanceof PostgresDriver).toBe(true);
      expect(db.getRootDriver().dialect.name).toBe('postgres');
      expect(db.isOpen()).toBe(true);

      // 3. Passing an explicit customDriver replaces it
      const newCustomPool = {
        connect: async () => mockConn,
        query: async () => ({ rows: [{ ok: 1 }] }),
        end: async () => {},
      };
      const newPgDriver = new PostgresDriver({ pool: newCustomPool, schemaName: 'app_custom' });
      await db.reconnect(newPgDriver);
      expect(db.getRootDriver()).toBe(newPgDriver);
      expect(db.dialect.name).toBe('postgres');

      // 4. Test SnapshotService restoreSnapshot keeps remote driver intact
      const freshPgDriver = new PostgresDriver({ pool: mockPool, schemaName: 'public' });
      const registry = new AppRegistry(config);
      await registry.init();
      const appManager = new AppManager(registry, config, freshPgDriver);
      const defaultScope = await appManager.getAsync('default');
      expect(defaultScope.db.getRootDriver() instanceof PostgresDriver).toBe(true);

      // Setup a minimal snapshot directory with snapshot.json and metadata.json
      const snapshotsDir = defaultScope.snapshots.snapshotsDir;
      const snapDir = path.join(snapshotsDir, 'snap-test');
      fs.mkdirSync(snapDir, { recursive: true });
      fs.writeFileSync(
        path.join(snapDir, 'snapshot.json'),
        JSON.stringify({ _collections: [] }),
        'utf-8'
      );
      fs.writeFileSync(
        path.join(snapDir, 'metadata.json'),
        JSON.stringify({
          id: 'snap-test',
          name: 'Test Snapshot',
          description: '',
          tags: [],
          isProtected: false,
          createdAt: new Date().toISOString(),
          dbSizeBytes: 100,
          storageSizeBytes: 0,
        }),
        'utf-8'
      );
      fs.writeFileSync(
        path.join(snapshotsDir, 'manifest.json'),
        JSON.stringify({
          activeSnapshotId: null,
          snapshots: [
            {
              id: 'snap-test',
              name: 'Test Snapshot',
              description: '',
              tags: [],
              isProtected: false,
              createdAt: new Date().toISOString(),
              dbSizeBytes: 100,
              storageSizeBytes: 0,
            },
          ],
        }),
        'utf-8'
      );

      // Restore snapshot
      await defaultScope.snapshots.restoreSnapshot('snap-test');

      // Verify db driver on defaultScope is STILL PostgresDriver, NOT NodeSqliteDriver!
      expect(defaultScope.db.getRootDriver() instanceof PostgresDriver).toBe(true);
      expect(defaultScope.db.dialect.name).toBe('postgres');
    });

    // 9. PostgresDialect quotes and preserves camelCase column definitions
    it('Review finding: should quote camelCase column definitions in PostgresDialect to prevent lowercase folding', () => {
      const dialect = new PostgresDialect();

      // 1. Verify createTableIfNotExists quotes camelCase columns from unquoted migration input
      const collectionsDdl = dialect.createTableIfNotExists('_collections', `
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL DEFAULT 'base',
        system BOOLEAN NOT NULL DEFAULT FALSE,
        schema TEXT NOT NULL DEFAULT '[]',
        indexes TEXT NOT NULL DEFAULT '[]',
        listRule TEXT,
        viewRule TEXT,
        createRule TEXT,
        updateRule TEXT,
        deleteRule TEXT,
        options TEXT NOT NULL DEFAULT '{}',
        created TEXT NOT NULL,
        updated TEXT NOT NULL
      `);

      expect(collectionsDdl).toContain('"listRule" TEXT');
      expect(collectionsDdl).toContain('"viewRule" TEXT');
      expect(collectionsDdl).toContain('"createRule" TEXT');
      expect(collectionsDdl).toContain('"updateRule" TEXT');
      expect(collectionsDdl).toContain('"deleteRule" TEXT');
      expect(collectionsDdl).toContain('"options" TEXT NOT NULL DEFAULT \'{}\'');
      expect(collectionsDdl).toContain('CREATE TABLE IF NOT EXISTS "_collections"');

      // 2. Verify _admins & users camelCase auth columns (passwordHash, tokenKey, emailVisibility)
      const adminsDdl = dialect.createTableIfNotExists('_admins', `
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL,
        tokenKey TEXT NOT NULL,
        avatar TEXT,
        created TEXT NOT NULL,
        updated TEXT NOT NULL
      `);
      expect(adminsDdl).toContain('"passwordHash" TEXT NOT NULL');
      expect(adminsDdl).toContain('"tokenKey" TEXT NOT NULL');

      const usersDdl = dialect.createTableIfNotExists('users', `
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        emailVisibility BOOLEAN NOT NULL DEFAULT FALSE,
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        passwordHash TEXT NOT NULL,
        tokenKey TEXT NOT NULL,
        name TEXT,
        avatar TEXT,
        created TEXT NOT NULL,
        updated TEXT NOT NULL
      `);
      expect(usersDdl).toContain('"emailVisibility" BOOLEAN NOT NULL DEFAULT FALSE');
      expect(usersDdl).toContain('"passwordHash" TEXT NOT NULL');
      expect(usersDdl).toContain('"tokenKey" TEXT NOT NULL');

      // 3. Verify table-level constraints with camelCase columns
      const extAuthDdl = dialect.createTableIfNotExists('_external_auths', `
        id TEXT PRIMARY KEY,
        collection TEXT NOT NULL,
        recordId TEXT NOT NULL,
        provider TEXT NOT NULL,
        providerUserId TEXT NOT NULL,
        UNIQUE(collection, provider, providerUserId)
      `);
      expect(extAuthDdl).toContain('"recordId" TEXT NOT NULL');
      expect(extAuthDdl).toContain('"providerUserId" TEXT NOT NULL');
      expect(extAuthDdl).toContain('UNIQUE ("collection", "provider", "providerUserId")');

      // 4. Verify createIndexIfNotExists quotes camelCase index columns
      const indexSql = dialect.createIndexIfNotExists(
        'idx_webhook_del_wh',
        '_webhook_deliveries',
        'webhookId, created DESC'
      );
      expect(indexSql).toContain('ON "_webhook_deliveries"("webhookId", "created" DESC)');

      // 5. Verify rewritePlaceholders automatically quotes unquoted camelCase identifiers in queries
      const insertSql = dialect.rewritePlaceholders(
        'INSERT INTO _admins (id, email, passwordHash, tokenKey) VALUES (?, ?, ?, ?)'
      );
      expect(insertSql).toBe('INSERT INTO _admins (id, email, "passwordHash", "tokenKey") VALUES ($1, $2, $3, $4)');

      const updateSql = dialect.rewritePlaceholders(
        'UPDATE _collections SET listRule = ?, viewRule = ? WHERE id = ?'
      );
      expect(updateSql).toBe('UPDATE _collections SET "listRule" = $1, "viewRule" = $2 WHERE id = $3');
    });

    // 10. DriverRegistry preserves existing SQLite dbPath/dataDir for provider-only config
    it('Review finding: DriverRegistry preserves existing SQLite dbPath and dataDir when target config omits them instead of falling back to :memory:', async () => {
      const sqliteDir = path.join(testDir, 'preserve_sqlite_test');
      const expectedDbPath = path.join(sqliteDir, 'apps', 'default', 'data.db');

      DriverRegistry.setDefaultSqlitePaths({
        dataDir: sqliteDir,
        appsDir: path.join(sqliteDir, 'apps'),
        dbPath: expectedDbPath,
      });

      // 1. Calling createDriver with provider-only config ({ provider: 'sqlite' }) preserves configured paths
      const targetConfig: DatabaseConfig = { provider: 'sqlite' };
      const driver = await DriverRegistry.createDriver(targetConfig) as NodeSqliteDriver;

      expect(driver).toBeDefined();
      expect(driver.getPath()).toBe(expectedDbPath);
      expect(driver.getPath()).not.toBe(':memory:');
      expect(targetConfig.dataDir).toBe(sqliteDir);
      expect(targetConfig.dbPath).toBe(expectedDbPath);
      await driver.close();

      // 2. Explicit :memory: request is still respected
      const memoryConfig: DatabaseConfig = { provider: 'sqlite', dbPath: ':memory:' };
      const memoryDriver = await DriverRegistry.createDriver(memoryConfig) as NodeSqliteDriver;
      expect(memoryDriver.getPath()).toBe(':memory:');
      await memoryDriver.close();

      // 3. DatabaseController switchDatabase with provider-only SQLite config preserves default paths
      const configService = new ConfigService({ dataDir: sqliteDir });
      const registry = new AppRegistry(configService);
      await registry.init();
      const appManager = new AppManager(registry, configService);
      const defaultScope = await appManager.getAsync('default');
      const dbConfigService = new DatabaseConfigService(configService);
      await dbConfigService.init();
      const controller = new DatabaseController(dbConfigService, appManager, defaultScope.db);

      let savedConfig: any = null;
      dbConfigService.saveConfig = async (cfg: any) => {
        savedConfig = cfg;
        return 'cfg_123';
      };

      let sentBody: any = null;
      const reply: any = {
        statusCode: 200,
        status: (code: number) => {
          reply.statusCode = code;
          return reply;
        },
        code: (code: number) => {
          reply.statusCode = code;
          return reply;
        },
        send: (b: any) => {
          sentBody = b;
          return reply;
        },
        header: () => reply,
      };

      await controller.switchDatabase(
        { body: { config: { provider: 'sqlite' }, migrateData: false } } as any,
        reply
      );

      expect(savedConfig).toBeDefined();
      expect(savedConfig.provider).toBe('sqlite');
      expect(savedConfig.dbPath).toBe(configService.getAppDbPath('default'));
      expect(savedConfig.dataDir).toBe(sqliteDir);
      expect(savedConfig.dbPath).not.toBe(':memory:');

      await appManager.closeAllAsync();
    });

    // 11. DatabaseMigrationService clears target table on zero-row source to prevent retaining stale data
    it('Review finding: DatabaseMigrationService clears target table on zero-row source to prevent retaining stale data', async () => {
      const sourceDriver = new NodeSqliteDriver(':memory:');
      const targetDriver = new NodeSqliteDriver(':memory:');

      await SystemMigrations.run(sourceDriver);
      await SystemMigrations.run(targetDriver);

      const now = new Date().toISOString();

      // Insert stale rows into previously-used target database system tables
      await targetDriver.prepare(`
        INSERT INTO _webhooks (id, name, url, event, collection, action, method, headers, secret, enabled, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('whk_stale', 'Stale Webhook', 'https://example.com/stale', 'create', '*', '*', 'POST', '{}', 'sec123', 1, now, now);

      await targetDriver.prepare('INSERT INTO _params (key, value) VALUES (?, ?)').run('stale_key', 'stale_val');

      // Verify source is empty for these tables
      const sourceWebhooksCount = await sourceDriver.prepare('SELECT COUNT(*) AS total FROM _webhooks').get<{ total: number }>();
      expect(Number(sourceWebhooksCount?.total)).toBe(0);

      // Verify target has stale data before migration
      const targetWebhooksBefore = await targetDriver.prepare('SELECT COUNT(*) AS total FROM _webhooks').get<{ total: number }>();
      expect(Number(targetWebhooksBefore?.total)).toBe(1);
      const targetParamsBefore = await targetDriver.prepare('SELECT COUNT(*) AS total FROM _params').get<{ total: number }>();
      expect(Number(targetParamsBefore?.total)).toBe(1);

      // Run migration
      await DatabaseMigrationService.migrateAppScope(sourceDriver, targetDriver);

      // Target tables must be cleared
      const targetWebhooksAfter = await targetDriver.prepare('SELECT COUNT(*) AS total FROM _webhooks').get<{ total: number }>();
      expect(Number(targetWebhooksAfter?.total)).toBe(0);
      const targetParamsAfter = await targetDriver.prepare('SELECT COUNT(*) AS total FROM _params').get<{ total: number }>();
      expect(Number(targetParamsAfter?.total)).toBe(0);

      await sourceDriver.close();
      await targetDriver.close();
    });

    // 12. DatabaseController.switchDatabase does not mark configuration active if switchDriver fails
    it('Review finding: DatabaseController.switchDatabase does not mark configuration active if switchDriver fails', async () => {
      const sqliteDir = path.join(testDir, 'switch_fail_test');
      const configService = new ConfigService({ dataDir: sqliteDir });
      const dbConfigService = new DatabaseConfigService(configService);
      await dbConfigService.init();

      // Ensure initial active config is sqlite
      const initialActive = await dbConfigService.getActiveConfig();
      expect(initialActive.provider).toBe('sqlite');

      const mockRootDriver: any = {
        close: async () => {},
        dialect: { name: 'sqlite' },
      };
      const mockRootDb: any = {
        getRootDriver: () => mockRootDriver,
      };

      // Mock appManager whose switchDriver intentionally throws an error
      const mockAppManager: any = {
        config: configService,
        registry: { getAllApps: async () => [] },
        switchDriver: async () => {
          throw new Error('Simulated runtime hot-swap switchDriver failure');
        },
      };

      const controller = new DatabaseController(
        dbConfigService,
        mockAppManager,
        mockRootDb
      );

      let sentStatus = 0;
      let sentBody: any = null;
      const mockReply: any = {
        status: (code: number) => {
          sentStatus = code;
          return mockReply;
        },
        code: (code: number) => {
          sentStatus = code;
          return mockReply;
        },
        send: (b: any) => {
          sentBody = b;
          return mockReply;
        },
      };

      // Attempt to switch to an in-memory database where switchDriver fails
      await controller.switchDatabase(
        { body: { config: { provider: 'sqlite', dbPath: ':memory:' }, migrateData: false } } as any,
        mockReply
      );

      // Verify that the HTTP handler returned an error
      expect(sentStatus).toBe(500);
      expect(sentBody?.message).toContain('Simulated runtime hot-swap switchDriver failure');

      // Verify that _db_configs was NOT updated to mark the failed provider active
      const activeAfterFail = await dbConfigService.getActiveConfig();
      expect(activeAfterFail.provider).toBe('sqlite');
      expect(activeAfterFail.dbPath).not.toBe(':memory:');
    });

    // 13. AuthService.verifyToken awaits Promise-valued schema and database reads on non-SQLite drivers
    it('Review finding: AuthService.verifyToken awaits Promise-valued schema and database reads on non-SQLite drivers', async () => {
      const config = new ConfigService({ dataDir: testDir, jwtSecret: 'test-secret-key-12345' });

      // Mock database service with async Promise returns for PostgreSQL/MSSQL
      const mockDb: any = {
        dialect: { quoteIdentifier: (col: string) => `"${col}"` },
        get: async (sql: string, ...params: any[]) => {
          if (sql.includes('FROM "users"')) {
            const id = params[0];
            if (id === 'usr_valid') {
              return { id: 'usr_valid', tokenKey: 'valid_user_tk' };
            }
          }
          if (sql.includes('FROM _admins')) {
            const id = params[0];
            if (id === 'adm_valid') {
              return { id: 'adm_valid', email: 'admin@nodestack.dev', tokenKey: 'valid_admin_tk' };
            }
          }
          return undefined;
        },
      };

      // Mock schema service with async Promise returns
      const mockSchemaService: any = {
        getCollection: async (nameOrId: string) => {
          if (nameOrId === 'users' || nameOrId === 'col_users') {
            return { id: 'col_users', name: 'users', type: 'auth' };
          }
          return undefined;
        },
      };

      const authService = new AuthService(mockDb, config, mockSchemaService);

      // 1. Verify valid user token on async driver
      const userToken = authService.generateToken({
        id: 'usr_valid',
        email: 'user@example.com',
        collection: 'users',
        tokenKey: 'valid_user_tk',
      });

      const userClaims = await authService.verifyToken(userToken);
      expect(userClaims).toBeDefined();
      expect(userClaims.id).toBe('usr_valid');
      expect(userClaims.collection).toBe('users');

      // 2. Verify AuthMiddleware sets req.auth asynchronously
      const middleware = new AuthMiddleware(authService);
      const req: any = {
        headers: { authorization: `Bearer ${userToken}` },
      };
      await middleware.handle(req);
      expect(req.auth).toBeDefined();
      expect(req.auth.id).toBe('usr_valid');
      expect(req.auth.email).toBe('user@example.com');

      // 3. Verify valid admin token on async driver
      const adminToken = authService.generateToken({
        id: 'adm_valid',
        email: 'admin@nodestack.dev',
        collection: '_admins',
        tokenKey: 'valid_admin_tk',
        isAdmin: true,
      });

      const adminClaims = await authService.verifyToken(adminToken);
      expect(adminClaims).toBeDefined();
      expect(adminClaims.id).toBe('adm_valid');
      expect(adminClaims.isAdmin).toBe(true);

      const adminReq: any = {
        headers: { authorization: `Bearer ${adminToken}` },
      };
      await middleware.handle(adminReq);
      expect(adminReq.auth).toBeDefined();
      expect(adminReq.auth.isAdmin).toBe(true);

      // 4. Verify revoked / mismatched tokenKey is rejected on async driver
      const revokedToken = authService.generateToken({
        id: 'usr_valid',
        email: 'user@example.com',
        collection: 'users',
        tokenKey: 'rotated_old_tk',
      });

      await expect(authService.verifyToken(revokedToken)).rejects.toThrow(UnauthorizedError);

      const revokedReq: any = {
        headers: { authorization: `Bearer ${revokedToken}` },
      };
      await middleware.handle(revokedReq);
      expect(revokedReq.auth).toBeNull();
    });

    // 14. MssqlFtsDriver builds concrete search predicate filtering across mirror table columns
    it('Review finding: MssqlFtsDriver builds concrete search predicate filtering across mirror table columns', async () => {
      const mockMssqlDb: any = {
        dialect: new MssqlDialect(),
        get: async () => undefined,
        all: async () => [],
        exec: async () => {},
        transaction: async (cb: any) => cb(mockMssqlDb),
      };

      const mssqlFts = new MssqlFtsDriver(mockMssqlDb);
      const fields: SchemaField[] = [
        { id: 'f1', name: 'title', type: 'text', required: false, unique: false },
        { id: 'f2', name: 'content', type: 'text', required: false, unique: false },
      ];

      // 1. Single-token search predicate
      const singleRes = mssqlFts.buildSearchPredicate('_fts_articles', fields, 'hello');
      expect(singleRes.clause).toBe(
        "((COALESCE(CAST([fts].[title] AS NVARCHAR(MAX)), '') + ' ' + COALESCE(CAST([fts].[content] AS NVARCHAR(MAX)), '')) LIKE ?)"
      );
      expect(singleRes.params).toEqual(['%hello%']);

      // 2. Multi-token search predicate generates AND-joined LIKE clauses
      const multiRes = mssqlFts.buildSearchPredicate('_fts_articles', fields, 'hello world');
      expect(multiRes.clause).toBe(
        "((COALESCE(CAST([fts].[title] AS NVARCHAR(MAX)), '') + ' ' + COALESCE(CAST([fts].[content] AS NVARCHAR(MAX)), '')) LIKE ? AND (COALESCE(CAST([fts].[title] AS NVARCHAR(MAX)), '') + ' ' + COALESCE(CAST([fts].[content] AS NVARCHAR(MAX)), '')) LIKE ?)"
      );
      expect(multiRes.params).toEqual(['%hello%', '%world%']);

      // 3. Search predicate for table without fts alias qualifies with bracketed table name
      const customTableRes = mssqlFts.buildSearchPredicate('articles', fields, 'test');
      expect(customTableRes.clause).toContain('[articles].[title]');

      // 4. Empty or punctuation-only query returns 1=0 predicate
      const emptyRes = mssqlFts.buildSearchPredicate('_fts_articles', fields, '   " * ^ "  ');
      expect(emptyRes.clause).toBe('1=0');
      expect(emptyRes.params).toEqual([]);

      // 5. Empty fields array returns 1=0 predicate
      const noFieldsRes = mssqlFts.buildSearchPredicate('_fts_articles', [], 'hello');
      expect(noFieldsRes.clause).toBe('1=0');
      expect(noFieldsRes.params).toEqual([]);

      // 6. Snippet select qualifies with [fts] and respects options.snippetLength
      const snippetSelect = mssqlFts.buildSnippetSelect('_fts_articles', fields, { snippetLength: 50 });
      expect(snippetSelect).toContain('SUBSTRING(CAST([fts].[title] AS NVARCHAR(MAX)), 1, 50)');
      expect(snippetSelect).toContain('SUBSTRING(CAST([fts].[content] AS NVARCHAR(MAX)), 1, 50)');

      // 7. RecordService.getList delegates to MssqlFtsDriver search predicate instead of 1=1
      let executedQuerySql = '';
      let executedQueryParams: any[] = [];
      const mockRecordDb: any = {
        dialect: new MssqlDialect(),
        get: async (sql: string, ...params: any[]) => {
          if (sql.includes('SELECT COUNT(*)')) {
            return { count: 1 };
          }
          return undefined;
        },
        all: async (sql: string, ...params: any[]) => {
          executedQuerySql = sql;
          executedQueryParams = params;
          return [
            {
              id: 'art_1',
              title: 'Hello SQL Server',
              content: 'Full text search content',
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
            },
          ];
        },
      };

      const mockSchemaService: any = {
        getCollectionOrThrow: async () => ({
          id: 'col_articles',
          name: 'articles',
          type: 'base',
          listRule: '',
          schema: fields,
          indexes: [],
        }),
      };

      const ftsService = new FtsService(mockRecordDb);
      // Spy/mock hasFtsIndex to return true
      (ftsService.getFtsDriver() as any).hasFtsIndex = async () => true;

      const recordService = new RecordService(
        mockRecordDb,
        mockSchemaService,
        undefined,
        undefined,
        undefined,
        undefined,
        ftsService
      );

      const listResult = await recordService.getList('articles', { search: 'hello' });
      expect(listResult.items.length).toBe(1);
      expect(listResult.items[0].id).toBe('art_1');

      // Crucial verification: WHERE clause MUST NOT contain '1=1', must contain the MSSQL LIKE predicate
      expect(executedQuerySql).not.toContain('1=1');
      expect(executedQuerySql).toContain('COALESCE(CAST([fts].[title] AS NVARCHAR(MAX))');
      expect(executedQuerySql).toContain('LIKE ?');
      expect(executedQueryParams).toContain('%hello%');
    });

    // 15. SchemaService schema read and write operations await driver operations on non-SQLite drivers
    it('Review finding: SchemaService read and write methods properly await Promise-valued operations on non-SQLite drivers', async () => {
      const collectionsStore: any[] = [
        {
          id: 'col_posts',
          name: 'posts',
          type: 'base',
          system: 0,
          schema: JSON.stringify([{ id: 'f_title', name: 'title', type: 'text', required: true }]),
          indexes: '[]',
          listRule: '',
          viewRule: '',
          createRule: '',
          updateRule: '',
          deleteRule: '',
          options: '{}',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        },
      ];

      const executedQueries: string[] = [];

      const mockAsyncDb: any = {
        dialect: new PostgresDialect(),
        all: async (sql: string) => {
          executedQueries.push(sql);
          if (sql.includes('FROM _collections')) {
            return collectionsStore;
          }
          return [];
        },
        get: async (sql: string, ...params: any[]) => {
          executedQueries.push(sql);
          if (sql.includes('FROM _collections WHERE id = ? OR name = ?')) {
            const [idOrName] = params;
            return collectionsStore.find((c) => c.id === idOrName || c.name === idOrName);
          }
          return undefined;
        },
        exec: async (sql: string) => {
          executedQueries.push(sql);
        },
        prepare: (sql: string) => ({
          run: async (...params: any[]) => {
            executedQueries.push(sql);
            if (sql.includes('INSERT INTO _collections')) {
              const [id, name, type, system, schema, indexes, listRule, viewRule, createRule, updateRule, deleteRule, options, created, updated] = params;
              collectionsStore.push({
                id,
                name,
                type,
                system,
                schema,
                indexes,
                listRule,
                viewRule,
                createRule,
                updateRule,
                deleteRule,
                options,
                created,
                updated,
              });
            } else if (sql.includes('UPDATE _collections SET')) {
              const [name, schema, indexes, listRule, viewRule, createRule, updateRule, deleteRule, options, updated, id] = params;
              const idx = collectionsStore.findIndex((c) => c.id === id);
              if (idx !== -1) {
                collectionsStore[idx] = {
                  ...collectionsStore[idx],
                  name,
                  schema,
                  indexes,
                  listRule,
                  viewRule,
                  createRule,
                  updateRule,
                  deleteRule,
                  options,
                  updated,
                };
              }
            } else if (sql.includes('DELETE FROM _collections WHERE id = ?')) {
              const [id] = params;
              const idx = collectionsStore.findIndex((c) => c.id === id);
              if (idx !== -1) {
                collectionsStore.splice(idx, 1);
              }
            }
            return { changes: 1, lastInsertRowid: 1 };
          },
        }),
        transaction: async (cb: any) => {
          return await cb(mockAsyncDb);
        },
      };

      const schemaService = new SchemaService(mockAsyncDb);

      // 1. getAllCollections awaits Promise from db.all() and does not throw .map is not a function
      const allCols = await schemaService.getAllCollections();
      expect(Array.isArray(allCols)).toBe(true);
      expect(allCols.length).toBe(1);
      expect(allCols[0].name).toBe('posts');
      expect(allCols[0].schema[0].name).toBe('title');

      // 2. getCollection awaits Promise from db.get() and passes resolved row to mapRowToCollection
      const postCol = await schemaService.getCollection('posts');
      expect(postCol).toBeDefined();
      expect(postCol?.id).toBe('col_posts');
      expect(postCol?.name).toBe('posts');

      const nonExistentCol = await schemaService.getCollection('non_existent');
      expect(nonExistentCol).toBeUndefined();

      // 3. getCollectionOrThrow throws NotFoundError when not found instead of returning Promise<undefined>
      await expect(schemaService.getCollectionOrThrow('non_existent')).rejects.toThrow(NotFoundError);
      const postColOrThrow = await schemaService.getCollectionOrThrow('posts');
      expect(postColOrThrow.id).toBe('col_posts');

      // 4. createCollection does not throw premature ConflictError from truthy Promise, awaits async tx
      const createdCol = await schemaService.createCollection({
        name: 'comments',
        type: 'base',
        schema: [
          { id: 'f_body', name: 'body', type: 'text', required: true },
        ],
      });
      expect(createdCol).toBeDefined();
      expect(createdCol.name).toBe('comments');
      expect(createdCol.schema.length).toBe(1);
      expect(createdCol.schema[0].name).toBe('body');

      // 5. updateCollection awaits async tx and updates collection
      const updatedCol = await schemaService.updateCollection('comments', {
        schema: [
          { id: 'f_body', name: 'body', type: 'text', required: true },
          { id: 'f_author', name: 'author', type: 'text', required: false },
        ],
      });
      expect(updatedCol.schema.length).toBe(2);

      // 6. deleteCollection awaits async tx and drops collection
      await schemaService.deleteCollection('comments');
      const deletedCheck = await schemaService.getCollection('comments');
      expect(deletedCheck).toBeUndefined();
    });

    // 16. LogicalSnapshotDriver includes _flow_executions in system-table list
    it('Review finding: LogicalSnapshotDriver includes _flow_executions in system-table list for capture and restore', async () => {
      const snapTargetDir = path.join(testDir, 'logical_snap_test');
      fs.mkdirSync(snapTargetDir, { recursive: true });

      const mockFlowExecutions = [
        {
          id: 'exec_123',
          flowId: 'flow_signup',
          status: 'completed',
          currentStepIndex: 2,
          stepResults: '{}',
          context: '{}',
          error: null,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      ];

      const queriesExecuted: string[] = [];
      const mockDriver: any = {
        dialect: new PostgresDialect(),
        transaction: async (cb: any) => cb(mockDriver),
        exec: async (sql: string) => { queriesExecuted.push(sql); },
        prepare: (sql: string) => ({
          run: async (...params: any[]) => {
            queriesExecuted.push(sql);
            return { changes: 1 };
          },
        }),
      };

      const mockDb: any = {
        dialect: new PostgresDialect(),
        getRootDriver: () => mockDriver,
        all: async (sql: string) => {
          if (sql.includes('FROM _collections')) {
            return [];
          }
          if (sql.includes('FROM "_flow_executions"')) {
            return mockFlowExecutions;
          }
          return [];
        },
      };

      const driver = new LogicalSnapshotDriver(mockDb);

      // 1. Capture snapshot writes _flow_executions to snapshot.json
      await driver.captureSnapshot(snapTargetDir);
      const snapJsonPath = path.join(snapTargetDir, 'snapshot.json');
      expect(fs.existsSync(snapJsonPath)).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(snapJsonPath, 'utf-8'));
      expect(parsed._flow_executions).toBeDefined();
      expect(Array.isArray(parsed._flow_executions)).toBe(true);
      expect(parsed._flow_executions.length).toBe(1);
      expect(parsed._flow_executions[0].id).toBe('exec_123');

      // 2. Restore snapshot reads _flow_executions and restores them
      await driver.restoreSnapshot(snapTargetDir);
      expect(queriesExecuted.some((q) => q.includes('DELETE FROM "_flow_executions"'))).toBe(true);
      expect(queriesExecuted.some((q) => q.includes('INSERT INTO "_flow_executions"'))).toBe(true);

      // 3. Restoring an empty snapshot table executes DELETE to clear rows added after capture
      const emptySnapDir = path.join(testDir, 'empty_snap_test');
      fs.mkdirSync(emptySnapDir, { recursive: true });
      fs.writeFileSync(
        path.join(emptySnapDir, 'snapshot.json'),
        JSON.stringify({ _webhooks: [] }),
        'utf-8'
      );
      queriesExecuted.length = 0;
      await driver.restoreSnapshot(emptySnapDir);
      expect(queriesExecuted.some((q) => q.includes('DELETE FROM "_webhooks"'))).toBe(true);
      expect(queriesExecuted.some((q) => q.includes('INSERT INTO "_webhooks"'))).toBe(false);
    });

    it('Round 2 Item 6: should return async branch for getDatabaseMetrics and avoid duplicated breakdown on async databases', async () => {
      const fakeDb: any = {
        dialect: new PostgresDialect(),
        isOpen: () => true,
        get: async (sql: string) => {
          if (sql.includes('"posts"')) return { count: 42 };
          if (sql.includes('"users"')) return { count: 10 };
          return { count: 0 };
        },
      };
      const fakeSchema: any = {
        getAllCollections: async () => [
          { name: 'posts', type: 'base' },
          { name: 'users', type: 'auth' },
        ],
      };
      const fakeConfig: any = { dbPath: path.join(testDir, 'fake.db') };
      const fakeRealtime: any = { getConnectedClientsCount: () => 0 };

      const analytics = new AnalyticsService(
        fakeDb as any,
        fakeConfig as any,
        fakeSchema as any,
        fakeRealtime as any
      );

      const metricsPromise = analytics.getDatabaseMetrics();
      expect(metricsPromise && typeof metricsPromise.then === 'function').toBe(true);

      const metrics = await metricsPromise;
      expect(metrics.totalRecords).toBe(52);
      expect(metrics.collectionsBreakdown).toEqual([
        { collection: 'posts', type: 'base', count: 42 },
        { collection: 'users', type: 'auth', count: 10 },
      ]);
      expect(metrics.collectionsBreakdown.length).toBe(2);
    });

    it('Round 2 Item 7: should chain pruneLogs after async flushRes in LogService.clearLogs', async () => {
      const order: string[] = [];
      let resolveFlush: () => void;
      const flushPromise = new Promise<void>((resolve) => {
        resolveFlush = resolve;
      });

      const fakeDb: any = {
        dialect: new PostgresDialect(),
        isOpen: () => true,
        transaction: async (fn: any) => {
          order.push('flush_started');
          await flushPromise;
          order.push('flush_committed');
          return;
        },
        prepare: () => ({
          run: async () => {
            order.push('delete_executed');
            return { changes: 5 };
          },
        }),
      };

      const logService = new LogService(fakeDb as any, { bufferSize: 100, flushIntervalMs: 60000 });
      logService.logRequest({
        method: 'GET',
        url: '/test',
        status: 200,
        duration: 10,
        ip: '127.0.0.1',
      }, { skipConsole: true });

      const clearPromise = logService.clearLogs(7);
      expect(clearPromise && typeof clearPromise.then === 'function').toBe(true);

      // Verify that delete has not executed yet because flush is still pending
      expect(order).toEqual(['flush_started']);

      // Now resolve the flush
      resolveFlush!();
      const changes = await clearPromise;

      expect(changes).toBe(5);
      expect(order).toEqual(['flush_started', 'flush_committed', 'delete_executed']);

      logService.dispose();
    });
  });
});
