import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';

describe('NodeStack End-to-End System Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_nodestack_data');
  let app: NodeStack;
  let adminToken = '';

  beforeAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    app = new NodeStack({
      dataDir: testDir,
      port: 8099,
    });

    // Custom developer route registered at startup
    app.router.get('/api/custom-ping', async () => {
      return { message: 'pong', timestamp: Date.now() };
    });
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should initialize and report no admins on fresh instance', () => {
    expect(app.auth.hasAdmins()).toBe(false);
  });

  it('should create initial admin and authenticate', async () => {
    const admin = await app.auth.createAdmin('admin@nodestack.io', 'supersecret123');
    expect(admin.email).toBe('admin@nodestack.io');
    expect(app.auth.hasAdmins()).toBe(true);

    const authRes = await app.auth.authenticateAdmin('admin@nodestack.io', 'supersecret123');
    expect(authRes.token).toBeDefined();
    expect(authRes.record.email).toBe('admin@nodestack.io');
    adminToken = authRes.token;

    // Verify token
    const claims = app.auth.verifyToken(authRes.token);
    expect(claims.isAdmin).toBe(true);
    expect(claims.email).toBe('admin@nodestack.io');
  });

  it('should create a new collection via SchemaService', () => {
    const col = app.schema.createCollection({
      name: 'posts',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_views', name: 'views', type: 'number', defaultValue: 0 },
        { id: 'f_published', name: 'published', type: 'bool', defaultValue: false },
      ],
      listRule: '', // public
      viewRule: '', // public
      createRule: '', // public
      updateRule: '', // public
      deleteRule: '', // public
    });

    expect(col.name).toBe('posts');
    expect(col.schema.length).toBe(3);

    // Verify table exists in SQLite
    const retrieved = app.schema.getCollection('posts');
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(col.id);
  });

  it('should execute custom TypeScript lifecycle hooks onRecordBeforeCreate', async () => {
    let hookExecuted = false;

    app.onRecordBeforeCreate('posts', async (e) => {
      hookExecuted = true;
      // Enrich record in hook
      e.record.title = `[HOOK] ${e.record.title}`;
    });

    const record = await app.records.create('posts', {
      title: 'First TypeScript NodeStack Post',
      views: 10,
      published: true,
    });

    expect(hookExecuted).toBe(true);
    expect(record.title).toBe('[HOOK] First TypeScript NodeStack Post');
    expect(record.views).toBe(10);
    expect(record.published).toBe(true);
    expect(record.id).toBeDefined();
  });

  it('should query records with pagination and filtering', async () => {
    // Insert more records
    await app.records.create('posts', { title: 'Second Post', views: 50, published: false });
    await app.records.create('posts', { title: 'Third Post', views: 100, published: true });

    // List all
    const all = await app.records.getList('posts', { perPage: 10 });
    expect(all.totalItems).toBe(3);

    // Filter published only
    const published = await app.records.getList('posts', {
      filter: 'published = true',
    });
    expect(published.totalItems).toBe(2);

    // Filter by views > 20
    const highViews = await app.records.getList('posts', {
      filter: 'views > 20',
      sort: '-views',
    });
    expect(highViews.totalItems).toBe(2);
    expect(highViews.items[0].views).toBe(100);
  });

  it('should update and delete records', async () => {
    const created = await app.records.create('posts', {
      title: 'Post to delete',
      views: 0,
    });

    const updated = await app.records.update('posts', created.id, {
      title: 'Updated title',
      views: 5,
    });
    expect(updated.title).toBe('Updated title');
    expect(updated.views).toBe(5);

    await app.records.delete('posts', created.id);

    await expect(app.records.getOne('posts', created.id)).rejects.toThrow();
  });

  it('should delete records via HTTP DELETE endpoint without body', async () => {
    const created = await app.records.create('posts', {
      title: 'HTTP delete post',
      views: 0,
    });

    const res = await app.server.app.inject({
      method: 'DELETE',
      url: `/api/collections/posts/records/${created.id}`,
    });

    expect(res.statusCode).toBe(204);
    await expect(app.records.getOne('posts', created.id)).rejects.toThrow();
  });

  it('should allow custom developer routes via app.router', async () => {
    const res = await app.server.app.inject({
      method: 'GET',
      url: '/api/custom-ping',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.message).toBe('pong');
  });

  it('should handle auth collections (users) with password hashing and auth', async () => {
    // Create user in default 'users' collection
    const user = await app.records.create('users', {
      email: 'alice@example.com',
      password: 'password1234',
      name: 'Alice Cooper',
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('alice@example.com');
    // Ensure sensitive fields are not leaked
    expect(user.passwordHash).toBeUndefined();
    expect(user.tokenKey).toBeUndefined();

    // Authenticate user
    const loginRes = await app.auth.authenticateRecord('users', 'alice@example.com', 'password1234');
    expect(loginRes.token).toBeDefined();
    expect(loginRes.record.name).toBe('Alice Cooper');

    // Wrong password should fail
    await expect(
      app.auth.authenticateRecord('users', 'alice@example.com', 'wrongpassword')
    ).rejects.toThrow();
  });

  it('should serve health check and log requests', async () => {
    const res = await app.server.app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.status).toBe('ok');

    // Verify request was logged in _logs table
    const logsRes = await app.server.app.inject({
      method: 'GET',
      url: '/api/logs',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(logsRes.statusCode).toBe(200);
    const logsData = JSON.parse(logsRes.payload);
    expect(logsData.items.length).toBeGreaterThan(0);
    expect(logsData.items.some((l: any) => l.url === '/api/health')).toBe(true);
  });

  it('should serve embedded Admin UI HTML at /_/', async () => {
    const res = await app.server.app.inject({
      method: 'GET',
      url: '/_/',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('NodeStack — Admin Dashboard');
  });

  it('should serve SVG favicon and brand icon at /icon.svg and /_/icon.svg', async () => {
    const res1 = await app.server.app.inject({
      method: 'GET',
      url: '/icon.svg',
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.headers['content-type']).toContain('image/svg+xml');
    expect(res1.payload).toContain('<svg');

    const res2 = await app.server.app.inject({
      method: 'GET',
      url: '/_/icon.svg',
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.headers['content-type']).toContain('image/svg+xml');
    expect(res2.payload).toContain('<svg');
  });
});
