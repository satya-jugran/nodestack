import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';
import { NodeStack } from '../src/NodeStack';
import { FakerEngine } from '../src/records/FakerEngine';
import { NodeStackClient } from '../packages/client/src/Client';
import { runCli } from '../src/cli/cli';

describe('1-Click Mock Data Generator (Faker Engine) Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_mock_data');
  const port = 8110;
  let app: NodeStack;
  let adminToken = '';
  let client: NodeStackClient;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDir,
      port,
      appName: 'Mock Data Test App',
    });

    // Create super admin
    await app.auth.createAdmin('admin@nodestack.io', 'supersecret123');
    const authRes = await app.auth.authenticateAdmin('admin@nodestack.io', 'supersecret123');
    adminToken = authRes.token;

    // 1. Create 'authors' auth collection
    app.schema.createCollection({
      name: 'authors',
      type: 'auth',
      schema: [
        { id: 'f_name', name: 'name', type: 'text', required: true },
        { id: 'f_avatar', name: 'avatar', type: 'file' },
        { id: 'f_bio', name: 'bio', type: 'text' },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });

    // 2. Create 'articles' base collection with relation to authors
    app.schema.createCollection({
      name: 'articles',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_price', name: 'price', type: 'number' },
        {
          id: 'f_status',
          name: 'status',
          type: 'select',
          options: { values: ['draft', 'published', 'archived'] },
        },
        {
          id: 'f_author',
          name: 'author',
          type: 'relation',
          options: { collectionId: 'authors' },
        },
        { id: 'f_cover', name: 'cover', type: 'file' },
        { id: 'f_tags', name: 'tags', type: 'json' },
        { id: 'f_is_featured', name: 'is_featured', type: 'bool' },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });

    // Start HTTP server for API and Client SDK tests
    await app.start();

    client = new NodeStackClient(`http://127.0.0.1:${port}`);
    await client.admins.authWithPassword('admin@nodestack.io', 'supersecret123');
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('FakerEngine Unit Tests', () => {
    it('should generate human names, emails, and prices', () => {
      const name = FakerEngine.fullName();
      expect(name).toBeTruthy();
      expect(name.split(' ').length).toBeGreaterThanOrEqual(2);

      const email = FakerEngine.email(name);
      expect(email).toMatch(/^[a-z0-9.]+@[a-z0-9.-]+\.[a-z]{2,}$/i);

      const price = FakerEngine.price(10, 200);
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThanOrEqual(10);
      expect(price).toBeLessThanOrEqual(200);
    });

    it('should generate high quality SVG avatars without any external packages', () => {
      const svgBuffer = FakerEngine.generateLocalSvgAvatar('Sarah Jenkins', 'seed_123');
      expect(Buffer.isBuffer(svgBuffer)).toBe(true);

      const svgString = svgBuffer.toString('utf-8');
      expect(svgString).toContain('<svg');
      expect(svgString).toContain('viewBox="0 0 256 256"');
      expect(svgString).toContain('linearGradient');
      expect(svgString).toContain('SJ'); // Sarah Jenkins initials
    });

    it('should generate placeholder image SVG and PNG for general file fields', () => {
      const placeholderSvg = FakerEngine.generatePlaceholderImage('Cover Article', 'seed_cover', 'svg');
      expect(placeholderSvg.filename).toContain('.svg');
      expect(placeholderSvg.mimeType).toBe('image/svg+xml');
      const content = placeholderSvg.buffer.toString('utf-8');
      expect(content).toContain('<svg');
      expect(content).toContain('Cover Article');

      const placeholderPng = FakerEngine.generatePlaceholderImage('Cover Article', 'seed_cover', 'png');
      expect(placeholderPng.filename).toContain('.png');
      expect(placeholderPng.mimeType).toBe('image/png');
      expect(placeholderPng.buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
    });

    it('should synthesize realistic values matching field semantic types', async () => {
      const context = {
        index: 0,
        total: 10,
        collectionName: 'test',
        recordId: 'r_test',
        downloadFiles: false,
      };

      // 1. Text field named name
      const nameRes = await FakerEngine.generateFieldValue(
        { id: '1', name: 'name', type: 'text' },
        context,
        {}
      );
      expect(nameRes.value.split(' ').length).toBeGreaterThanOrEqual(2);

      // 2. Select field
      const selectRes = await FakerEngine.generateFieldValue(
        { id: '2', name: 'status', type: 'select', options: { values: ['draft', 'published'] } },
        context,
        {}
      );
      expect(['draft', 'published']).toContain(selectRes.value);

      // 3. Price field
      const priceRes = await FakerEngine.generateFieldValue(
        { id: '3', name: 'price', type: 'number' },
        context,
        {}
      );
      expect(priceRes.value).toBeGreaterThan(0);

      // 4. File avatar field
      const avatarRes = await FakerEngine.generateFieldValue(
        { id: '4', name: 'avatar', type: 'file' },
        context,
        { name: 'Sarah Jenkins' }
      );
      expect(avatarRes.value).toContain('avatar_');
      expect(avatarRes.filePayload).toBeDefined();
    });
  });

  describe('MockDataService Direct Generation', () => {
    it('should generate mock records and auto-seed relation collections when empty', async () => {
      // Authors is currently empty. Generating articles should automatically seed authors!
      const result = await app.mockData.generate('articles', {
        count: 10,
        downloadFiles: false,
        autoSeedRelations: true,
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(10);
      expect(result.records.length).toBe(10);

      // Verify articles have linked author IDs
      const firstArticle = result.records[0];
      expect(firstArticle.author).toBeTruthy();
      expect(typeof firstArticle.author).toBe('string');
      expect(firstArticle.price).toBeGreaterThan(0);
      expect(['draft', 'published', 'archived']).toContain(firstArticle.status);
      expect(Array.isArray(firstArticle.tags) || typeof firstArticle.tags === 'object').toBe(true);

      // Verify authors collection was automatically seeded
      const authorsList = await app.records.getList('authors', { perPage: 50 });
      expect(authorsList.totalItems).toBeGreaterThanOrEqual(3);

      // Verify authors have valid emails and bcrypt hashed passwords
      const rawAuthor = app.db.get<any>('SELECT * FROM authors LIMIT 1');
      expect(rawAuthor.email).toContain('@');
      expect(rawAuthor.passwordHash).toBeTruthy();
      expect(bcrypt.compareSync('NodeStack2026!', rawAuthor.passwordHash)).toBe(true);
    });

    it('should store file attachments for file fields in the storage directory', async () => {
      const result = await app.mockData.generate('articles', {
        count: 2,
        downloadFiles: false,
      });

      expect(result.records.length).toBe(2);
      const article = result.records[0];
      expect(article.cover).toBeTruthy();

      // Check physical file exists on disk
      const filePath = app.files.getFilePath(
        app.schema.getCollectionOrThrow('articles').id,
        article.id,
        article.cover
      );
      expect(fs.existsSync(filePath)).toBe(true);
      const fileBuf = fs.readFileSync(filePath);
      expect(fileBuf.length).toBeGreaterThan(50);
      expect(fileBuf.subarray(1, 4).toString('ascii')).toBe('PNG');
    });

    it('should generate auth collection mock records with unique emails and verified flags', async () => {
      const result = await app.mockData.generate('authors', {
        count: 5,
        downloadFiles: false,
      });

      expect(result.count).toBe(5);
      const emails = result.records.map((r) => r.email);
      const uniqueEmails = new Set(emails);
      expect(uniqueEmails.size).toBe(5);

      for (const author of result.records) {
        expect(author.verified).toBe(true);
        expect(author.emailVisibility).toBe(true);
        expect(author.passwordHash).toBeUndefined(); // Sanitized from output
      }
    });

    it('should respect restricted mimeTypes on file fields (e.g. image/png only)', async () => {
      // Create collection with strict png/jpeg mimeTypes (like default users schema)
      app.schema.createCollection({
        name: 'profiles',
        type: 'base',
        schema: [
          { id: 'f_name', name: 'name', type: 'text' },
          {
            id: 'f_pic',
            name: 'avatar',
            type: 'file',
            options: { mimeTypes: ['image/jpeg', 'image/png'] },
          },
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
      });

      const res = await app.mockData.generate('profiles', { count: 3, downloadFiles: false });
      expect(res.count).toBe(3);
      for (const profile of res.records) {
        expect(profile.avatar).toBeTruthy();
        expect(profile.avatar).toContain('.png');

        // File should exist physically on disk
        const filePath = app.files.getFilePath(
          app.schema.getCollectionOrThrow('profiles').id,
          profile.id,
          profile.avatar
        );
        expect(fs.existsSync(filePath)).toBe(true);
        const buf = fs.readFileSync(filePath);
        expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
      }
    });

    it('should dynamically heal and serve missing mock avatar files on the fly', async () => {
      // Create a test record with a mock avatar name that has not been written to disk yet
      const author = await app.records.create('authors', {
        email: 'heal.test@nodestack.io',
        password: 'Password123!',
        name: 'Healing Test User',
        avatar: 'avatar_rec_r_710546350eb4_avatar_9.svg',
      });

      // Request file via HTTP endpoint
      const fileRes = await fetch(
        `http://127.0.0.1:${port}/api/files/authors/${author.id}/avatar_rec_r_710546350eb4_avatar_9.svg?token=${adminToken}`
      );

      // Should succeed with 200 OK and SVG content, NOT 404!
      expect(fileRes.status).toBe(200);
      expect(fileRes.headers.get('content-type')).toContain('image/svg+xml');
      const text = await fileRes.text();
      expect(text).toContain('<svg');
    });
  });

  describe('HTTP API Endpoint: POST /api/collections/:collection/generate-mock', () => {
    it('should allow authenticated admin to generate mock records', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/collections/articles/generate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          count: 15,
          options: {
            downloadFiles: false,
            autoSeedRelations: true,
          },
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.count).toBe(15);
      expect(body.collection).toBe('articles');
      expect(body.records.length).toBe(15);
    });

    it('should reject unauthenticated or non-admin requests with 401/403', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/collections/articles/generate-mock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 5 }),
      });

      expect([401, 403]).toContain(res.status);
    });
  });

  describe('CLI Command: nodestack mock <collection> [count]', () => {
    it('should generate mock records via CLI command', async () => {
      // Run CLI command
      await runCli(['node', 'nodestack', 'mock', 'articles', '12', '--dir', testDir, '--no-files']);

      // Verify articles were inserted into SQLite
      const list = await app.records.getList('articles', { perPage: 100 });
      expect(list.totalItems).toBeGreaterThanOrEqual(12);
    });

    it('should keep the public client SDK lean without administrative mock methods', () => {
      const articlesService = client.collection('articles') as any;
      expect(articlesService.generateMock).toBeUndefined();
    });
  });

  describe('Web Admin UI Bundler Verification', () => {
    it('should bundle openMockDataModal and UI components into dist/admin/ui/index.html', () => {
      const bundledHtmlPath = path.resolve(__dirname, '../dist/admin/ui/index.html');
      expect(fs.existsSync(bundledHtmlPath)).toBe(true);

      const html = fs.readFileSync(bundledHtmlPath, 'utf-8');
      expect(html).toContain('openMockDataModal');
      expect(html).toContain('Generate Mock Data');
      expect(html).toContain('count-pill');
      expect(html).toContain('getFieldMockDescription');
      expect(html).toContain('submitGenerateMockData');
    });
  });
});
