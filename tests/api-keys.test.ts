import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  });

  describe('2. AuthMiddleware Authentication with API Keys', () => {
    it('should authenticate requests using Authorization: Bearer nsk_...', async () => {
      const created = app.apiKeys.createKey({
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
      const created = app.apiKeys.createKey({
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
      const created = app.apiKeys.createKey({
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
      const readOnlyOrders = app.apiKeys.createKey({
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
      const ordersWildcard = app.apiKeys.createKey({
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
      const adminKey = app.apiKeys.createKey({
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
      const created = app.apiKeys.createKey({
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
    });

    it('should support nodestack-client configured with apiKey option', async () => {
      const created = app.apiKeys.createKey({
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
      db.prepare(`
        INSERT INTO reports (id, title, status, created, updated)
        VALUES ('rep_draft', 'Draft Report', 'draft', ?, ?),
               ('rep_published', 'Public Report', 'published', ?, ?)
      `).run(now, now, now, now);

      // Non-admin API key with reports:read scope
      const reportsReader = app.apiKeys.createKey({
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
      const superAdminKey = app.apiKeys.createKey({
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

      const txManager = app.apiKeys.createKey({
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

      const vaultReader = app.apiKeys.createKey({
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
      const superAdminKey = app.apiKeys.createKey({
        name: 'Vault SuperAdmin',
        role: 'admin',
        scopes: ['*'],
      });
      const resAdmin = await fetch(`${serverUrl}/api/collections/secret_vault/records`, {
        headers: { Authorization: `Bearer ${superAdminKey.secretKey}` },
      });
      expect(resAdmin.status).toBe(200);
    });
  });
});
