import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { NodeStackClient, ClientResponseError, MemoryAuthStore } from '../packages/client/src';

describe('NodeStackClient End-to-End Integration Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_client_e2e_data');
  const port = 8199;
  let server: NodeStack;
  let client: NodeStackClient;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    server = new NodeStack({
      dataDir: testDir,
      port,
      appName: 'Client E2E Test App',
    });

    await server.start(port);

    // Initialize client using MemoryAuthStore for Node test environment
    client = new NodeStackClient(`http://127.0.0.1:${port}`, {
      authStore: new MemoryAuthStore(),
    });
  });

  afterAll(async () => {
    await server.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should query health and settings endpoints', async () => {
    const health = await client.health();
    expect(health.status).toBe('ok');

    const settings = await client.settings();
    expect(settings.appName).toBe('Client E2E Test App');
  });

  it('should detect no admins on fresh instance and create initial superuser', async () => {
    const hasAdmins = await client.admins.hasAdmins();
    expect(hasAdmins).toBe(false);

    const authRes = await client.admins.createInitial('superadmin@nodestack.io', 'supersecret123');
    expect(authRes.token).toBeDefined();
    expect(authRes.admin.email).toBe('superadmin@nodestack.io');

    // Verify authStore auto-persistence and validity
    expect(client.authStore.isValid).toBe(true);
    expect(client.authStore.token).toBe(authRes.token);
    expect(client.authStore.model?.email).toBe('superadmin@nodestack.io');

    const hasAdminsNow = await client.admins.hasAdmins();
    expect(hasAdminsNow).toBe(true);

    const me = await client.admins.getMe();
    expect(me.email).toBe('superadmin@nodestack.io');
  });

  it('should create a collection schema using CollectionService', async () => {
    const col = await client.collections.create({
      name: 'products',
      type: 'base',
      schema: [
        { id: 'f_name', name: 'name', type: 'text', required: true },
        { id: 'f_price', name: 'price', type: 'number', defaultValue: 0 },
        { id: 'f_category', name: 'category', type: 'text' },
        { id: 'f_inStock', name: 'inStock', type: 'bool', defaultValue: true },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });

    expect(col.name).toBe('products');
    expect(col.schema.length).toBe(4);

    const list = await client.collections.getList();
    expect(list.some((c) => c.name === 'products')).toBe(true);
  });

  it('should perform RecordService CRUD operations', async () => {
    const productsService = client.collection('products');

    // 1. Create records
    const item1 = await productsService.create({
      name: 'Wireless Keyboard',
      price: 49.99,
      category: 'Electronics',
      inStock: true,
    });
    expect(item1.id).toBeDefined();
    expect(item1.name).toBe('Wireless Keyboard');
    expect(item1.price).toBe(49.99);

    const item2 = await productsService.create({
      name: 'Ergonomic Mouse',
      price: 29.99,
      category: 'Electronics',
      inStock: true,
    });

    const item3 = await productsService.create({
      name: 'Coffee Mug',
      price: 12.5,
      category: 'Kitchenware',
      inStock: false,
    });

    // 2. Get list with pagination
    const listRes = await productsService.getList(1, 2);
    expect(listRes.page).toBe(1);
    expect(listRes.perPage).toBe(2);
    expect(listRes.totalItems).toBe(3);
    expect(listRes.totalPages).toBe(2);
    expect(listRes.items.length).toBe(2);

    // 3. Get full list across all pages
    const fullList = await productsService.getFullList({ batch: 2 });
    expect(fullList.length).toBe(3);

    // 4. Query with filter and sort
    const filtered = await productsService.getList(1, 10, {
      filter: "category = 'Electronics' && price > 30",
    });
    expect(filtered.totalItems).toBe(1);
    expect(filtered.items[0].name).toBe('Wireless Keyboard');

    // 5. Get first list item helper
    const firstMatch = await productsService.getFirstListItem("category = 'Kitchenware'");
    expect(firstMatch.name).toBe('Coffee Mug');

    // 6. Get single record by ID
    const single = await productsService.getOne(item1.id);
    expect(single.id).toBe(item1.id);
    expect(single.name).toBe('Wireless Keyboard');

    // 7. Update record
    const updated = await productsService.update(item1.id, {
      price: 39.99,
    });
    expect(updated.price).toBe(39.99);

    // 8. Delete record
    const deleted = await productsService.delete(item3.id);
    expect(deleted).toBe(true);

    const remaining = await productsService.getList();
    expect(remaining.totalItems).toBe(2);
  });

  it('should throw ClientResponseError with 404 for non-existent records', async () => {
    const productsService = client.collection('products');

    try {
      await productsService.getOne('non_existent_id');
      expect.fail('Expected request to fail with 404');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ClientResponseError);
      expect(err.status).toBe(404);
    }
  });

  it('should support auth collection authentication and user session management', async () => {
    // 1. Create a user record in the built-in 'users' auth collection
    const usersService = client.collection('users');
    const createdUser = await usersService.create({
      email: 'member@nodestack.io',
      password: 'password1234',
      name: 'Test Member',
    });
    expect(createdUser.id).toBeDefined();

    // 2. Separate client for the end-user (independent authStore)
    const userClient = new NodeStackClient(`http://127.0.0.1:${port}`, {
      authStore: new MemoryAuthStore(),
    });

    expect(userClient.authStore.isValid).toBe(false);

    // 3. Authenticate with password
    const authResult = await userClient
      .collection('users')
      .authWithPassword('member@nodestack.io', 'password1234');

    expect(authResult.token).toBeDefined();
    expect(authResult.record.email).toBe('member@nodestack.io');

    expect(userClient.authStore.isValid).toBe(true);
    expect(userClient.authStore.token).toBe(authResult.token);
    expect(userClient.authStore.model?.email).toBe('member@nodestack.io');

    // 4. Clear user session
    userClient.authStore.clear();
    expect(userClient.authStore.isValid).toBe(false);
    expect(userClient.authStore.token).toBe('');
  });

  it('should build file URLs using FileService', () => {
    const url = client.files.getUrl(
      { id: 'prod_99', collection: 'products' },
      'image.webp',
      { download: true, token: true }
    );

    expect(url).toContain('/api/files/products/prod_99/image.webp');
    expect(url).toContain('download=1');
    expect(url).toContain('token=');
  });

  it('should export records to CSV and JSON formats', async () => {
    const productsService = client.collection('products');

    const csvData = await productsService.export('csv');
    expect(typeof csvData).toBe('string');
    expect(csvData).toContain('name');
    expect(csvData).toContain('Wireless Keyboard');

    const jsonData = await productsService.export('json');
    const parsed = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });
});
