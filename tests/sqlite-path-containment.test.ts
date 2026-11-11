import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../src/core/config/ConfigService';
import { DatabaseConfigService } from '../src/database/config/DatabaseConfigService';
import { DriverRegistry, DatabaseConfig } from '../src/database/drivers/DriverRegistry';
import { NodeSqliteDriver } from '../src/database/drivers/NodeSqliteDriver';
import { NodeStack } from '../src/NodeStack';

describe('SQLite Database Path Containment & Arbitrary File Creation Prevention', () => {
  const testDir = path.resolve(__dirname, '../.test_sqlite_containment_data');
  const externalDir = path.resolve(__dirname, '../.test_sqlite_external_data');

  beforeEach(() => {
    DriverRegistry.resetDefaultSqlitePaths();
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
    if (fs.existsSync(externalDir)) {
      try {
        fs.rmSync(externalDir, { recursive: true, force: true });
      } catch {}
    }
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(externalDir, { recursive: true });
  });

  afterEach(() => {
    DriverRegistry.resetDefaultSqlitePaths();
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
    if (fs.existsSync(externalDir)) {
      try {
        fs.rmSync(externalDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('1. DriverRegistry.validateSqlitePath Unit Tests', () => {
    it('should allow explicit :memory: database without directory checks', () => {
      const res = DriverRegistry.validateSqlitePath(':memory:', testDir);
      expect(res).toBe(':memory:');
    });

    it('should allow legitimate file paths within dataDir', () => {
      const legitimatePath = path.join(testDir, 'custom.db');
      const res = DriverRegistry.validateSqlitePath(legitimatePath, testDir);
      expect(res).toBe(legitimatePath);
    });

    it('should allow legitimate file paths within appsDir', () => {
      const appsDir = path.join(testDir, 'apps');
      const legitimateAppPath = path.join(appsDir, 'tenant_1', 'data.db');
      const res = DriverRegistry.validateSqlitePath(legitimateAppPath, testDir, appsDir);
      expect(res).toBe(legitimateAppPath);
    });

    it('should resolve and allow relative paths inside dataDir', () => {
      const res = DriverRegistry.validateSqlitePath('local.db', testDir);
      expect(res).toBe(path.resolve(testDir, 'local.db'));
    });

    it('should reject path traversal attempts (e.g. ../outside.db)', () => {
      const traversalPath = path.join(testDir, '..', 'traversal_attack.db');
      expect(() => {
        DriverRegistry.validateSqlitePath(traversalPath, testDir);
      }).toThrow(/must be confined to the data directory or apps directory/);

      expect(() => {
        DriverRegistry.validateSqlitePath('../../outside.db', testDir);
      }).toThrow(/must be confined to the data directory or apps directory/);
    });

    it('should reject absolute paths outside dataDir and appsDir', () => {
      const externalPath = path.join(externalDir, 'pwned.db');
      expect(() => {
        DriverRegistry.validateSqlitePath(externalPath, testDir);
      }).toThrow(/must be confined to the data directory or apps directory/);
    });

    it('should reject prefix match bypass attempts (e.g. dataDir_evil/file.db)', () => {
      const prefixBypassDir = `${testDir}_evil`;
      const evilPath = path.join(prefixBypassDir, 'attack.db');
      expect(() => {
        DriverRegistry.validateSqlitePath(evilPath, testDir);
      }).toThrow(/must be confined to the data directory or apps directory/);
    });
  });

  describe('2. DriverRegistry.createDriver Containment', () => {
    it('should reject createDriver with external dbPath and never create the file', async () => {
      const targetDb = path.join(externalDir, 'driver_create_attack.db');
      expect(fs.existsSync(targetDb)).toBe(false);

      DriverRegistry.setDefaultSqlitePaths({ dataDir: testDir });

      await expect(
        DriverRegistry.createDriver({
          provider: 'sqlite',
          dbPath: targetDb,
        })
      ).rejects.toThrow(/must be confined to the data directory or apps directory/);

      // Verify no file was created on disk
      expect(fs.existsSync(targetDb)).toBe(false);
    });

    it('should reject createDriver with external connectionString', async () => {
      const targetDb = path.join(externalDir, 'cs_attack.db');
      DriverRegistry.setDefaultSqlitePaths({ dataDir: testDir });

      await expect(
        DriverRegistry.createDriver({
          provider: 'sqlite',
          connectionString: targetDb,
        })
      ).rejects.toThrow(/must be confined to the data directory or apps directory/);

      expect(fs.existsSync(targetDb)).toBe(false);
    });

    it('should reject createDriver when config.dataDir attempts to escape defaultDataDir', async () => {
      DriverRegistry.setDefaultSqlitePaths({ dataDir: testDir });

      await expect(
        DriverRegistry.createDriver({
          provider: 'sqlite',
          dataDir: externalDir,
          dbPath: path.join(externalDir, 'bypass.db'),
        })
      ).rejects.toThrow();

      expect(fs.existsSync(path.join(externalDir, 'bypass.db'))).toBe(false);
    });
  });

  describe('3. DatabaseConfigService.testConnection Containment', () => {
    it('should refuse to test connection with dbPath outside dataDir and never touch the filesystem', async () => {
      const config = new ConfigService({ dataDir: testDir });
      const service = new DatabaseConfigService(config);
      await service.init();

      const evilPath = path.join(externalDir, 'test_conn_evil.db');
      expect(fs.existsSync(evilPath)).toBe(false);

      const result = await service.testConnection({
        provider: 'sqlite',
        dbPath: evilPath,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/must be confined to the data directory or apps directory/);
      expect(fs.existsSync(evilPath)).toBe(false);
    });

    it('should refuse to test connection with path traversal in connectionString', async () => {
      const config = new ConfigService({ dataDir: testDir });
      const service = new DatabaseConfigService(config);
      await service.init();

      const evilFile = path.resolve(testDir, '../evil_cs_test.db');
      expect(fs.existsSync(evilFile)).toBe(false);

      const result = await service.testConnection({
        provider: 'sqlite',
        connectionString: '../evil_cs_test.db',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/must be confined to the data directory or apps directory/);
      expect(fs.existsSync(evilFile)).toBe(false);
    });

    it('should refuse to test readReplicas with external sqlite paths and not create replica files', async () => {
      const config = new ConfigService({ dataDir: testDir });
      const service = new DatabaseConfigService(config);
      await service.init();

      const evilReplica = path.join(externalDir, 'replica_evil.db');
      expect(fs.existsSync(evilReplica)).toBe(false);

      const result = await service.testConnection({
        provider: 'sqlite',
        dbPath: ':memory:',
        readReplicas: [evilReplica],
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/One or more read replicas failed connection test/);
      expect(fs.existsSync(evilReplica)).toBe(false);
    });

    it('should succeed for legitimate in-memory and dataDir SQLite connections', async () => {
      const config = new ConfigService({ dataDir: testDir });
      const service = new DatabaseConfigService(config);
      await service.init();

      const resultMemory = await service.testConnection({
        provider: 'sqlite',
        dbPath: ':memory:',
      });
      expect(resultMemory.ok).toBe(true);

      const resultInside = await service.testConnection({
        provider: 'sqlite',
        dbPath: path.join(testDir, 'allowed_test.db'),
      });
      expect(resultInside.ok).toBe(true);
    });
  });

  describe('4. HTTP Endpoints (/api/system/database/test & /switch) Containment', () => {
    it('POST /api/system/database/test should reject arbitrary dbPath and prevent file creation', async () => {
      const app = new NodeStack({ dataDir: testDir });
      await app.auth.createAdmin('admin@containment.test', 'Password123!');
      const { token: adminToken } = await app.auth.authenticateAdmin('admin@containment.test', 'Password123!');

      const evilFile = path.join(externalDir, 'http_attack.db');
      expect(fs.existsSync(evilFile)).toBe(false);

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/system/database/test',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          provider: 'sqlite',
          dbPath: evilFile,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.ok).toBe(false);
      expect(json.error).toMatch(/must be confined to the data directory or apps directory/);
      expect(fs.existsSync(evilFile)).toBe(false);

      await app.close();
    });

    it('POST /api/system/database/test should reject relative traversal dbPath', async () => {
      const app = new NodeStack({ dataDir: testDir });
      await app.auth.createAdmin('admin@containment.test', 'Password123!');
      const { token: adminToken } = await app.auth.authenticateAdmin('admin@containment.test', 'Password123!');

      const evilFile = path.resolve(testDir, '../traversal_via_http.db');
      expect(fs.existsSync(evilFile)).toBe(false);

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/system/database/test',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          provider: 'sqlite',
          connectionString: '../traversal_via_http.db',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.ok).toBe(false);
      expect(json.error).toMatch(/must be confined to the data directory or apps directory/);
      expect(fs.existsSync(evilFile)).toBe(false);

      await app.close();
    });

    it('POST /api/system/database/switch should reject arbitrary dbPath with 400 Bad Request', async () => {
      const app = new NodeStack({ dataDir: testDir });
      await app.auth.createAdmin('admin@containment.test', 'Password123!');
      const { token: adminToken } = await app.auth.authenticateAdmin('admin@containment.test', 'Password123!');

      const evilSwitchFile = path.join(externalDir, 'http_switch_attack.db');
      expect(fs.existsSync(evilSwitchFile)).toBe(false);

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/system/database/switch',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          config: {
            provider: 'sqlite',
            dbPath: evilSwitchFile,
          },
          migrateData: false,
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.message || json.error).toMatch(/must be confined to the data directory or apps directory/);
      expect(fs.existsSync(evilSwitchFile)).toBe(false);

      await app.close();
    });

    it('POST /api/system/database/switch should succeed for valid :memory: switch', async () => {
      const app = new NodeStack({ dataDir: testDir });
      await app.auth.createAdmin('admin@containment.test', 'Password123!');
      const { token: adminToken } = await app.auth.authenticateAdmin('admin@containment.test', 'Password123!');

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

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);

      await app.close();
    });
  });
});
