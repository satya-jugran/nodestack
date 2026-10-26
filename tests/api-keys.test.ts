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

    // Create test collections (private collections: rules = null)
    app.schema.createCollection({
      name: 'orders',
      type: 'base',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      schema: [
        { name: 'item', type: 'text', required: true },
        { name: 'amount', type: 'number', required: true },
      ],
    });

    app.schema.createCollection({
      name: 'products',
      type: 'base',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
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
});
