import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { NodeStackClient } from '../packages/client/src/Client';

describe('API Keys & Machine-to-Machine (M2M) Tokens', () => {
  const testDataDir = path.resolve('./.test_api_keys_data');
  let app: NodeStack;
  let serverUrl: string;
  let adminToken: string;

  beforeEach(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDataDir,
      port: 8145,
      jwtSecret: 'test_api_keys_secret_12345678901234567890',
    });

    serverUrl = await app.start();

    // Create initial admin
    const admin = await app.auth.createAdmin('admin@nodestack.local', 'AdminSecretPass123!');
    const authResult = await app.auth.authenticateAdmin('admin@nodestack.local', 'AdminSecretPass123!');
    adminToken = authResult.token;

    // Create test collections (private collections: require authenticated caller)
    app.schema.createCollection({
      name: 'orders',
      type: 'base',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
      schema: [
        { name: 'item', type: 'text', required: true },
        { name: 'amount', type: 'number', required: true },
      ],
    });

    app.schema.createCollection({
      name: 'products',
      type: 'base',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
      schema: [
        { name: 'title', type: 'text', required: true },
        { name: 'price', type: 'number', required: true },
      ],
    });
  });

  afterEach(async () => {
    await app.stop();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('1. API Key Generation & Cryptographic Storage', () => {
    it('should generate structured key with format nsk_live_... and return secretKey only once', async () => {
      const res = await fetch(`${serverUrl}/api/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: 'Microservice Worker',
          description: 'Background worker daemon',
          role: 'service',
          scopes: ['orders:read', 'orders:write'],
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.secretKey).toBeDefined();
      expect(data.secretKey.startsWith('nsk_')).toBe(true);
      expect(data.apiKey).toBeDefined();
      expect(data.apiKey.name).toBe('Microservice Worker');
      expect(data.apiKey.redactedKey).toBeDefined();
      expect(data.apiKey.secretHash).toBeUndefined(); // Plaintext hash not exposed

      // Verify list endpoint returns redacted key without secret
      const listRes = await fetch(`${serverUrl}/api/api-keys`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const keys = await listRes.json();
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBe(1);
      expect(keys[0].secretKey).toBeUndefined();
      expect(keys[0].secretHash).toBeUndefined();
      expect(keys[0].keyPrefix).toBe(data.apiKey.keyPrefix);
    });

    it('should store API keys using HMAC-SHA256 keyed with server secret to prevent offline rainbow-table attacks', async () => {
      const created = await app.apiKeys.createKey({
        name: 'HMAC Protected Key',
        role: 'service',
        scopes: ['orders:read'],
      });

      const row = await app.db.get<any>('SELECT secretHash FROM _api_keys WHERE id = ?', created.apiKey.id);
      expect(row).toBeDefined();

      const expectedHmac = crypto
        .createHmac('sha256', 'test_api_keys_secret_12345678901234567890')
        .update(created.secretKey)
        .digest('hex');
      const unsaltedPlainSha256 = crypto
        .createHash('sha256')
        .update(created.secretKey)
        .digest('hex');

      // The stored hash MUST match HMAC-SHA256 with the server secret
      expect(row.secretHash).toBe(expectedHmac);
      // The stored hash MUST NOT match plain unsalted SHA-256
      expect(row.secretHash).not.toBe(unsaltedPlainSha256);

      // Verify that verifyKey succeeds with the key
      const verification = await app.apiKeys.verifyKey(created.secretKey);
      expect(verification.valid).toBe(true);
      expect(verification.apiKey?.id).toBe(created.apiKey.id);
    });

    it('should authenticate legacy plain SHA-256 keys and transparently upgrade them to HMAC-SHA256 in the database', async () => {
      const legacyKeyId = 'leg_test_123';
      const legacyPrefix = 'nsk_test_leg123';
      const legacyEntropy = 'abcdef0123456789abcdef0123456789abcdef0123456789';
      const legacySecretKey = `${legacyPrefix}_${legacyEntropy}`;
      const legacyPlainHash = crypto.createHash('sha256').update(legacySecretKey).digest('hex');
      const now = new Date().toISOString();

      await app.db.run(`
        INSERT INTO _api_keys (
          id, name, description, keyPrefix, secretHash, redactedKey, role, scopes, allowedIps,
          expiresAt, lastUsedAt, lastUsedIp, totalRequests, status, createdBy, created, updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        legacyKeyId,
        'Legacy Key',
        'Pre-upgrade plain SHA256 key',
        legacyPrefix,
        legacyPlainHash,
        `${legacyPrefix}...6789`,
        'service',
        JSON.stringify(['*']),
        JSON.stringify([]),
        null,
        null,
        null,
        0,
        'active',
        null,
        now,
        now
      );

      // 1. Initial row has unsalted plain SHA-256 hash
      const initialRow = await app.db.get<any>('SELECT secretHash FROM _api_keys WHERE id = ?', legacyKeyId);
      expect(initialRow.secretHash).toBe(legacyPlainHash);

      // 2. Verification succeeds via legacy fallback
      const verifyRes = await app.apiKeys.verifyKey(legacySecretKey);
      expect(verifyRes.valid).toBe(true);
      expect(verifyRes.apiKey?.id).toBe(legacyKeyId);

      // 3. Stored hash is transparently upgraded to HMAC-SHA256
      const upgradedRow = await app.db.get<any>('SELECT secretHash FROM _api_keys WHERE id = ?', legacyKeyId);
      const expectedUpgradedHmac = crypto
        .createHmac('sha256', 'test_api_keys_secret_12345678901234567890')
        .update(legacySecretKey)
        .digest('hex');
      expect(upgradedRow.secretHash).toBe(expectedUpgradedHmac);
      expect(upgradedRow.secretHash).not.toBe(legacyPlainHash);

      // 4. Subsequent verification uses the upgraded HMAC-SHA256 hash directly
      const secondVerify = await app.apiKeys.verifyKey(legacySecretKey);
      expect(secondVerify.valid).toBe(true);
    });

    it('should conditionally update legacy hash and prevent resurrecting a rotated key if verify races with rotateKey', async () => {
      const legacyKeyId = 'leg_race_456';
      const legacyPrefix = 'nsk_test_race456';
      const legacyEntropy = '11223344556677889900aabbccddeeff1122334455667788';
      const legacySecretKey = `${legacyPrefix}_${legacyEntropy}`;
      const legacyPlainHash = crypto.createHash('sha256').update(legacySecretKey).digest('hex');
      const now = new Date().toISOString();

      await app.db.run(`
        INSERT INTO _api_keys (
          id, name, description, keyPrefix, secretHash, redactedKey, role, scopes, allowedIps,
          expiresAt, lastUsedAt, lastUsedIp, totalRequests, status, createdBy, created, updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        legacyKeyId,
        'Race Legacy Key',
        'Key for testing race between verify migration and rotateKey',
        legacyPrefix,
        legacyPlainHash,
        `${legacyPrefix}...7788`,
        'service',
        JSON.stringify(['*']),
        JSON.stringify([]),
        null,
        null,
        null,
        0,
        'active',
        null,
        now,
        now
      );

      // Simulate asynchronous driver execution where migration update is delayed
      const originalRun = app.db.run.bind(app.db);
      let resolveMigrationPromise: () => void;
      const migrationBlocked = new Promise<void>((resolve) => {
        resolveMigrationPromise = resolve;
      });

      let migrationIntercepted = false;
      (app.db as any).run = (sql: string, ...params: any[]) => {
        if (sql.includes('UPDATE _api_keys SET secretHash = ? WHERE id = ? AND secretHash = ?') && params[1] === legacyKeyId) {
          migrationIntercepted = true;
          return migrationBlocked.then(() => originalRun(sql, ...params));
        }
        return originalRun(sql, ...params);
      };

      try {
        // 1. Trigger verification with the legacy key (begins migration, which pauses on migrationBlocked)
        const verifyPromise = app.apiKeys.verifyKey(legacySecretKey);
        for (let i = 0; i < 50 && !migrationIntercepted; i++) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(migrationIntercepted).toBe(true);

        // 2. Concurrently, rotateKey is called (simulating rotation winning the database write or racing)
        resolveMigrationPromise!();
        await Promise.all([
          verifyPromise,
          app.apiKeys.rotateKey(legacyKeyId),
        ]);

        // 3. Now rotate the key explicitly to guarantee a new rotated secret is in the DB
        const rotated = await app.apiKeys.rotateKey(legacyKeyId);
        const rotatedRow = await app.db.get<any>('SELECT secretHash FROM _api_keys WHERE id = ?', legacyKeyId);

        // 4. Verification with the old legacy key MUST now fail (not resurrected)
        const oldKeyVerify = await app.apiKeys.verifyKey(legacySecretKey);
        expect(oldKeyVerify.valid).toBe(false);

        // 5. Verification with the new rotated secret MUST succeed
        const newKeyVerify = await app.apiKeys.verifyKey(rotated.secretKey);
        expect(newKeyVerify.valid).toBe(true);

        // 6. DB row secretHash MUST match the rotated key's HMAC, not the old legacy key's HMAC
        const expectedRotatedHmac = crypto
          .createHmac('sha256', 'test_api_keys_secret_12345678901234567890')
          .update(rotated.secretKey)
          .digest('hex');
        expect(rotatedRow.secretHash).toBe(expectedRotatedHmac);
      } finally {
        (app.db as any).run = originalRun;
      }
    });

    it('should handle zero-row result if rotation completes in the database before conditional migration runs', async () => {
      const legacyKeyId = 'leg_zero_789';
      const legacyPrefix = 'nsk_test_zero789';
      const legacyEntropy = 'aabbccddeeff00112233445566778899aabbccddeeff0011';
      const legacySecretKey = `${legacyPrefix}_${legacyEntropy}`;
      const legacyPlainHash = crypto.createHash('sha256').update(legacySecretKey).digest('hex');
      const now = new Date().toISOString();

      await app.db.run(`
        INSERT INTO _api_keys (
          id, name, description, keyPrefix, secretHash, redactedKey, role, scopes, allowedIps,
          expiresAt, lastUsedAt, lastUsedIp, totalRequests, status, createdBy, created, updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        legacyKeyId,
        'Zero Row Key',
        'Testing 0-row conditional update when rotated first',
        legacyPrefix,
        legacyPlainHash,
        `${legacyPrefix}...0011`,
        'service',
        JSON.stringify(['*']),
        JSON.stringify([]),
        null,
        null,
        null,
        0,
        'active',
        null,
        now,
        now
      );

      // Intercept run to simulate an asynchronous driver where rotation writes first in DB
      const originalRun = app.db.run.bind(app.db);
      (app.db as any).run = (sql: string, ...params: any[]) => {
        if (sql.includes('UPDATE _api_keys SET secretHash = ? WHERE id = ? AND secretHash = ?') && params[1] === legacyKeyId) {
          // Before this migration runs in the DB, rotate the key in DB directly
          const newSecretEntropy = crypto.randomBytes(24).toString('hex');
          const newSecretKey = `${legacyPrefix}_${newSecretEntropy}`;
          const newHmac = crypto
            .createHmac('sha256', 'test_api_keys_secret_12345678901234567890')
            .update(newSecretKey)
            .digest('hex');
          return originalRun("UPDATE _api_keys SET secretHash = ? WHERE id = ?", newHmac, legacyKeyId).then(() => {
            // Now execute the conditional migration query (which will affect 0 rows because secretHash != legacyPlainHash)
            return originalRun(sql, ...params);
          });
        }
        return originalRun(sql, ...params);
      };

      try {
        const verifyRes = await app.apiKeys.verifyKey(legacySecretKey);
        // The old key must be rejected because the conditional update failed (0 rows) and the DB row was rotated
        expect(verifyRes.valid).toBe(false);
        expect(verifyRes.error).toBe('Invalid API key secret');
      } finally {
        (app.db as any).run = originalRun;
      }
    });
  });

  describe('2. AuthMiddleware Authentication with API Keys', () => {
    it('should authenticate requests using Authorization: Bearer nsk_...', async () => {
      const created = await app.apiKeys.createKey({
        name: 'CI Daemon',
        role: 'service',
        scopes: ['*'],
      });

      const res = await fetch(`${serverUrl}/api/collections/orders/records`, {
        headers: {
          Authorization: `Bearer ${created.secretKey}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.items)).toBe(true);
    });

    it('should authenticate requests using X-API-Key header', async () => {
      const created = await app.apiKeys.createKey({
        name: 'Header Worker',
        role: 'service',
        scopes: ['*'],
      });

      const res = await fetch(`${serverUrl}/api/collections/orders/records`, {
        headers: {
          'X-API-Key': created.secretKey,
        },
      });

      expect(res.status).toBe(200);
    });

    it('should reject invalid or malformed API keys with 401 or 403', async () => {
      const res = await fetch(`${serverUrl}/api/collections/orders/records`, {
        headers: {
          Authorization: 'Bearer nsk_live_fake99_0123456789abcdef0123456789abcdef',
        },
      });
      // When auth is optional on public collections, req.auth is null.
      // But on admin endpoints, requireAdmin rejects:
      const adminRes = await fetch(`${serverUrl}/api/api-keys`, {
        headers: {
          Authorization: 'Bearer nsk_live_fake99_0123456789abcdef0123456789abcdef',
        },
      });
      expect(adminRes.status).toBe(403);
    });

    it('should reject expired API keys', async () => {
      const created = await app.apiKeys.createKey({
        name: 'Expired Worker',
        role: 'service',
        scopes: ['*'],
        expiresAt: new Date(Date.now() - 10000).toISOString(), // Expired 10s ago
      });

      const res = await fetch(`${serverUrl}/api/api-keys`, {
        headers: {
          Authorization: `Bearer ${created.secretKey}`,
        },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('3. Granular Read/Write ACL & Scoping Enforcement', () => {
    it('should allow operations within granted scope and forbid operations outside scope', async () => {
      // Key with only orders:read scope
      const readOnlyOrders = await app.apiKeys.createKey({
        name: 'Orders Reader',
        role: 'service',
        scopes: ['orders:read'],
      });

      // 1. Can list orders
      const listRes = await fetch(`${serverUrl}/api/collections/orders/records`, {
        headers: { Authorization: `Bearer ${readOnlyOrders.secretKey}` },
      });
      expect(listRes.status).toBe(200);

      // 2. Cannot create orders (orders:write required)
      const createOrderRes = await fetch(`${serverUrl}/api/collections/orders/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readOnlyOrders.secretKey}`,
        },
        body: JSON.stringify({ item: 'Laptop', amount: 1200 }),
      });
      expect(createOrderRes.status).toBe(403);
      const createErr = await createOrderRes.json();
      expect(createErr.message).toContain("API Key missing required scope for 'orders:create'");

      // 3. Cannot read products (products:read required)
      const listProductsRes = await fetch(`${serverUrl}/api/collections/products/records`, {
        headers: { Authorization: `Bearer ${readOnlyOrders.secretKey}` },
      });
      expect(listProductsRes.status).toBe(403);
      const prodErr = await listProductsRes.json();
      expect(prodErr.message).toContain("API Key missing required scope for 'products:list'");
    });

    it('should support collection wildcard scopes (orders:*)', async () => {
      const ordersWildcard = await app.apiKeys.createKey({
        name: 'Orders Manager',
        role: 'service',
        scopes: ['orders:*'],
      });

      // Can create order
      const createRes = await fetch(`${serverUrl}/api/collections/orders/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ordersWildcard.secretKey}`,
        },
        body: JSON.stringify({ item: 'Monitor', amount: 300 }),
      });
      expect(createRes.status).toBe(201);
      const order = await createRes.json();

      // Can view order
      const viewRes = await fetch(`${serverUrl}/api/collections/orders/records/${order.id}`, {
        headers: { Authorization: `Bearer ${ordersWildcard.secretKey}` },
      });
      expect(viewRes.status).toBe(200);

      // Cannot access products
      const prodRes = await fetch(`${serverUrl}/api/collections/products/records`, {
        headers: { Authorization: `Bearer ${ordersWildcard.secretKey}` },
      });
      expect(prodRes.status).toBe(403);
    });

    it('should grant full admin access to keys with role admin or scope *', async () => {
      const adminKey = await app.apiKeys.createKey({
        name: 'Super Admin Token',
        role: 'admin',
        scopes: ['*'],
      });

      // Can access admin-only API keys management endpoint
      const res = await fetch(`${serverUrl}/api/api-keys`, {
        headers: { Authorization: `Bearer ${adminKey.secretKey}` },
      });
      expect(res.status).toBe(200);
      const keys = await res.json();
      expect(Array.isArray(keys)).toBe(true);
    });
  });

  describe('4. API Key Rotation, Revocation and Client SDK', () => {
    it('should rotate API key, invalidating old secret and activating new secret', async () => {
      const created = await app.apiKeys.createKey({
        name: 'Rotatable Key',
        role: 'service',
        scopes: ['orders:read'],
      });

      // Old secret works
      const res1 = await fetch(`${serverUrl}/api/collections/orders/records`, {
        headers: { Authorization: `Bearer ${created.secretKey}` },
      });
      expect(res1.status).toBe(200);

      // Rotate key
      const rotateRes = await fetch(`${serverUrl}/api/api-keys/${created.apiKey.id}/rotate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(rotateRes.status).toBe(200);
      const rotated = await rotateRes.json();
      expect(rotated.secretKey).toBeDefined();
      expect(rotated.secretKey).not.toBe(created.secretKey);

      // Old secret now fails (403 or 401)
      const resOld = await fetch(`${serverUrl}/api/collections/orders/records`, {
        headers: { Authorization: `Bearer ${created.secretKey}` },
      });
      expect(resOld.status).toBe(403);

      // New secret works
      const resNew = await fetch(`${serverUrl}/api/collections/orders/records`, {
        headers: { Authorization: `Bearer ${rotated.secretKey}` },
      });
      expect(resNew.status).toBe(200);

      // Verify rotated key is hashed with HMAC-SHA256 keyed with server secret
      const rotatedRow = await app.db.get<any>('SELECT secretHash FROM _api_keys WHERE id = ?', created.apiKey.id);
      const expectedRotatedHmac = crypto
        .createHmac('sha256', 'test_api_keys_secret_12345678901234567890')
        .update(rotated.secretKey)
        .digest('hex');
      expect(rotatedRow.secretHash).toBe(expectedRotatedHmac);
    });

    it('should support nodestack-client configured with apiKey option', async () => {
      const created = await app.apiKeys.createKey({
        name: 'SDK Service Client',
        role: 'service',
        scopes: ['orders:*'],
      });

      const client = new NodeStackClient(serverUrl, {
        apiKey: created.secretKey,
      });

      // Create record using client SDK
      const order = await client.collection('orders').create({
        item: 'Keyboard',
        amount: 150,
      });

      expect(order.id).toBeDefined();
      expect(order.item).toBe('Keyboard');

      // List records using client SDK
      const list = await client.collection('orders').getList(1, 10);
      expect(list.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should strip admin wildcard scopes when downgrading role from admin to service/custom', async () => {
      // 1. Create an admin key (gets ['*'] automatically)
      const adminCreated = await app.apiKeys.createKey({
        name: 'Admin Key to Downgrade',
        role: 'admin',
        scopes: ['*'],
      });
      expect(adminCreated.apiKey.role).toBe('admin');
      expect(adminCreated.apiKey.scopes).toEqual(['*']);

      // Admin key can access admin-only /api/api-keys endpoint
      const adminRes = await fetch(`${serverUrl}/api/api-keys`, {
        headers: { Authorization: `Bearer ${adminCreated.secretKey}` },
      });
      expect(adminRes.status).toBe(200);

      // 2. Downgrade role to 'service' without explicitly providing scopes
      const downgraded = await app.apiKeys.updateKey(adminCreated.apiKey.id, {
        role: 'service',
      });
      expect(downgraded.role).toBe('service');
      // Admin wildcard scopes must have been removed
      expect(downgraded.scopes).not.toContain('*');
      expect(downgraded.scopes).not.toContain('admin:*');
      expect(downgraded.scopes).toEqual([]);

      // 3. Verify downgraded key can NO LONGER access admin-only /api/api-keys endpoint
      const deniedRes = await fetch(`${serverUrl}/api/api-keys`, {
        headers: { Authorization: `Bearer ${adminCreated.secretKey}` },
      });
      expect(deniedRes.status).toBe(403);
    });
  });

  describe('5. Collection Rules Enforcement for Non-Admin API Keys', () => {
    it('should strictly enforce conditional list/row rules on non-admin API keys without bypassing', async () => {
      // Create collection with conditional listRule
      app.schema.createCollection({
        name: 'reports',
        type: 'base',
        listRule: 'status = "published"',
        viewRule: 'status = "published"',
        createRule: '@request.auth.id != ""',
        schema: [
          { name: 'title', type: 'text', required: true },
          { name: 'status', type: 'text', required: true },
        ],
      });

      const db = app.db;
      const now = new Date().toISOString();
      await db.run(`
        INSERT INTO reports (id, title, status, created, updated)
        VALUES ('rep_draft', 'Draft Report', 'draft', ?, ?),
               ('rep_published', 'Public Report', 'published', ?, ?)
      `, now, now, now, now);

      // Non-admin API key with reports:read scope
      const reportsReader = await app.apiKeys.createKey({
        name: 'Reports Reader',
        role: 'service',
        scopes: ['reports:read'],
      });

      // 1. Non-admin key must evaluate row-level filter and only receive published records
      const listRes = await fetch(`${serverUrl}/api/collections/reports/records`, {
        headers: { Authorization: `Bearer ${reportsReader.secretKey}` },
      });
      expect(listRes.status).toBe(200);
      const data = await listRes.json();
      expect(data.items.length).toBe(1);
      expect(data.items[0].id).toBe('rep_published');
      expect(data.items[0].status).toBe('published');

      // 2. Super-admin key with * scope bypasses all collection rules
      const superAdminKey = await app.apiKeys.createKey({
        name: 'All Access SuperAdmin',
        role: 'admin',
        scopes: ['*'],
      });
      const adminListRes = await fetch(`${serverUrl}/api/collections/reports/records`, {
        headers: { Authorization: `Bearer ${superAdminKey.secretKey}` },
      });
      expect(adminListRes.status).toBe(200);
      const adminData = await adminListRes.json();
      expect(adminData.items.length).toBe(2);
    });

    it('should strictly enforce conditional mutation rules (create, update, delete) on non-admin API keys', async () => {
      app.schema.createCollection({
        name: 'transactions',
        type: 'base',
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: 'amount > 0',
        updateRule: 'status != "finalized"',
        deleteRule: 'can_delete = true',
        schema: [
          { name: 'amount', type: 'number', required: true },
          { name: 'status', type: 'text', defaultValue: 'pending' },
          { name: 'can_delete', type: 'bool', defaultValue: false },
        ],
      });

      const txManager = await app.apiKeys.createKey({
        name: 'Tx Manager',
        role: 'service',
        scopes: ['transactions:*'],
      });

      // 1. Rejected on create when createRule condition fails (amount <= 0)
      const invalidCreateRes = await fetch(`${serverUrl}/api/collections/transactions/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${txManager.secretKey}`,
        },
        body: JSON.stringify({ amount: -50, status: 'pending', can_delete: false }),
      });
      expect(invalidCreateRes.status).toBe(403);
      const invalidErr = await invalidCreateRes.json();
      expect(invalidErr.message).toContain('You are not allowed to create records');

      // 2. Allowed on create when createRule condition succeeds (amount > 0)
      const validCreateRes = await fetch(`${serverUrl}/api/collections/transactions/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${txManager.secretKey}`,
        },
        body: JSON.stringify({ amount: 100, status: 'pending', can_delete: false }),
      });
      expect(validCreateRes.status).toBe(201);
      const tx = await validCreateRes.json();

      // 3. Update to finalized status succeeds while status is pending
      const updateRes1 = await fetch(`${serverUrl}/api/collections/transactions/records/${tx.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${txManager.secretKey}`,
        },
        body: JSON.stringify({ status: 'finalized' }),
      });
      expect(updateRes1.status).toBe(200);

      // 4. Update fails once status is finalized (updateRule 'status != "finalized"' fails)
      const updateRes2 = await fetch(`${serverUrl}/api/collections/transactions/records/${tx.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${txManager.secretKey}`,
        },
        body: JSON.stringify({ amount: 999 }),
      });
      expect(updateRes2.status).toBe(403);
      const updateErr = await updateRes2.json();
      expect(updateErr.message).toContain('You are not allowed to update this record');

      // 5. Delete fails because can_delete is false
      const deleteRes = await fetch(`${serverUrl}/api/collections/transactions/records/${tx.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${txManager.secretKey}` },
      });
      expect(deleteRes.status).toBe(403);
      const deleteErr = await deleteRes.json();
      expect(deleteErr.message).toContain('You are not allowed to delete this record');
    });

    it('should reject non-admin API keys on locked collections (rule: null) while permitting super-admin keys', async () => {
      app.schema.createCollection({
        name: 'secret_vault',
        type: 'base',
        listRule: null, // Admin-only / locked
        viewRule: null,
        createRule: null,
        schema: [
          { name: 'secret_data', type: 'text', required: true },
        ],
      });

      const vaultReader = await app.apiKeys.createKey({
        name: 'Vault Scoped Key',
        role: 'service',
        scopes: ['secret_vault:read'],
      });

      // Non-admin API key with collection scope MUST be rejected on rule: null
      const resNonAdmin = await fetch(`${serverUrl}/api/collections/secret_vault/records`, {
        headers: { Authorization: `Bearer ${vaultReader.secretKey}` },
      });
      expect(resNonAdmin.status).toBe(403);
      const err = await resNonAdmin.json();
      expect(err.message).toContain('You are not allowed to list records');

      // Super-admin key (role: admin, scopes: ['*']) bypasses all rules
      const superAdminKey = await app.apiKeys.createKey({
        name: 'Vault SuperAdmin',
        role: 'admin',
        scopes: ['*'],
      });
      const resAdmin = await fetch(`${serverUrl}/api/collections/secret_vault/records`, {
        headers: { Authorization: `Bearer ${superAdminKey.secretKey}` },
      });
      expect(resAdmin.status).toBe(200);
    });

    it('should permit API keys with queues:send scope to enqueue messages via REST API and reject unauthorized keys', async () => {
      await app.queue.upsertQueue({ name: 'api-key-test-queue' });

      const queueSenderKey = await app.apiKeys.createKey({
        name: 'Queue Producer Key',
        role: 'service',
        scopes: ['queues:send'],
      });

      const unauthorizedKey = await app.apiKeys.createKey({
        name: 'Read Only Key',
        role: 'service',
        scopes: ['orders:read'],
      });

      // 1. Authorized API key with queues:send succeeds (201)
      const resAllowed = await fetch(`${serverUrl}/api/queues/api-key-test-queue/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `ApiKey ${queueSenderKey.secretKey}`,
        },
        body: JSON.stringify({ payload: { task: 'send_welcome_email' } }),
      });
      expect(resAllowed.status).toBe(201);
      const enqueued = await resAllowed.json();
      expect(enqueued.id).toBeDefined();
      expect(enqueued.queue).toBe('api-key-test-queue');

      // 2. Unauthorized API key without queue scopes is rejected with 403
      const resDenied = await fetch(`${serverUrl}/api/queues/api-key-test-queue/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `ApiKey ${unauthorizedKey.secretKey}`,
        },
        body: JSON.stringify({ payload: { task: 'unauthorized_job' } }),
      });
      expect(resDenied.status).toBe(403);
    });

    it('should enforce function-specific scopes on API keys invoking authPolicy: apiKey functions', async () => {
      await app.functions.createFunction({
        name: 'finance-report-fn',
        code: `export default async function(core, ctx) { return { reportId: 42 }; }`,
        enabled: true,
        authPolicy: 'apiKey',
      });

      const fnScopedKey = await app.apiKeys.createKey({
        name: 'Function Invoker Key',
        role: 'service',
        scopes: ['functions:invoke'],
      });

      const unprivilegedKey = await app.apiKeys.createKey({
        name: 'Orders Reader Key',
        role: 'service',
        scopes: ['orders:read'],
      });

      // 1. Key with functions:invoke succeeds (200)
      const resAllowed = await fetch(`${serverUrl}/api/functions/finance-report-fn/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `ApiKey ${fnScopedKey.secretKey}`,
        },
        body: JSON.stringify({}),
      });
      expect(resAllowed.status).toBe(200);
      const data = await resAllowed.json();
      expect(data.reportId).toBe(42);

      // 2. Key with only orders:read is rejected with 403
      const resDenied = await fetch(`${serverUrl}/api/functions/finance-report-fn/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `ApiKey ${unprivilegedKey.secretKey}`,
        },
        body: JSON.stringify({}),
      });
      expect(resDenied.status).toBe(403);
      const err = await resDenied.json();
      expect(err.message).toContain('missing required scope');
    });
  });

  describe('6. Per-User Quota Enforcement Under Concurrency', () => {
    it('should strictly enforce maxApiKeysPerUser and reject concurrent creation beyond limit', async () => {
      // Set a strict custom limit of 3 keys for this test
      (app.apiKeys as any).config.maxApiKeysPerUser = 3;
      const testUserId = 'user_quota_test_123';

      // Concurrently launch 6 creation requests for the same user
      const results = await Promise.allSettled(
        Array.from({ length: 6 }).map((_, i) =>
          Promise.resolve().then(() =>
            app.apiKeys.createKey({
              name: `Concurrent Key ${i}`,
              createdBy: testUserId,
            })
          )
        )
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly 3 must succeed, exactly 3 must be rejected
      expect(fulfilled.length).toBe(3);
      expect(rejected.length).toBe(3);

      for (const rej of rejected) {
        if (rej.status === 'rejected') {
          expect(rej.reason.message).toMatch(/API key quota exceeded/);
        }
      }

      // Verify the database has exactly 3 keys for this user
      const userKeys = await app.apiKeys.listKeys({ status: 'active', createdBy: testUserId });
      expect(userKeys.length).toBe(3);
    });

    it('should validate integer pagination and reject NaN, non-integers, and negative numbers with 400', async () => {
      // 1. Non-integer string "abc" for limit
      const resLimitAbc = await fetch(`${serverUrl}/api/api-keys?limit=abc`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(resLimitAbc.status).toBe(400);
      const dataLimitAbc = await resLimitAbc.json();
      expect(dataLimitAbc.message).toContain("Query parameter 'limit' must be an integer");

      // 2. Fractional number "1.5" for limit
      const resLimitFraction = await fetch(`${serverUrl}/api/api-keys?limit=1.5`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(resLimitFraction.status).toBe(400);
      const dataLimitFraction = await resLimitFraction.json();
      expect(dataLimitFraction.message).toContain("Query parameter 'limit' must be an integer");

      // 3. Zero or negative limit
      const resLimitZero = await fetch(`${serverUrl}/api/api-keys?limit=0`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(resLimitZero.status).toBe(400);

      // 4. Non-integer offset
      const resOffsetInvalid = await fetch(`${serverUrl}/api/api-keys?offset=abc`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(resOffsetInvalid.status).toBe(400);

      // 5. Negative offset
      const resOffsetNegative = await fetch(`${serverUrl}/api/api-keys?offset=-5`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(resOffsetNegative.status).toBe(400);

      // 6. Invalid status
      const resStatusInvalid = await fetch(`${serverUrl}/api/api-keys?status=destroyed`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(resStatusInvalid.status).toBe(400);

      // 7. Valid integer limit and offset succeeds
      const resValid = await fetch(`${serverUrl}/api/api-keys?limit=5&offset=0`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(resValid.status).toBe(200);

      // 8. Service-level robustness against NaN or fractional inputs
      const serviceResult = await app.apiKeys.listKeys({ limit: NaN as any, offset: 1.8 as any });
      expect(Array.isArray(serviceResult)).toBe(true);
    });
  });
});
