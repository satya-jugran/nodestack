import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { STARTER_TEMPLATES } from '../src/templates/definitions';
import { runCli } from '../src/cli/cli';

describe('Starter Templates / Recipes Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_templates_data');
  const port = 8125;
  let app: NodeStack;
  let adminToken = '';

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDir,
      port,
      appName: 'Templates Test App',
    });

    await app.start(port);

    // Create super admin
    await app.auth.createAdmin('admin@nodestack.io', 'supersecret123');
    const authRes = await app.auth.authenticateAdmin('admin@nodestack.io', 'supersecret123');
    adminToken = authRes.token;
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Template Definition & Lookup', () => {
    it('should list all 3 required onboarding templates', () => {
      const templates = app.templates.list();
      expect(templates.length).toBe(3);

      const ids = templates.map((t) => t.id);
      expect(ids).toContain('ecommerce');
      expect(ids).toContain('blog');
      expect(ids).toContain('crm');

      const ecommerce = templates.find((t) => t.id === 'ecommerce')!;
      expect(ecommerce.collections).toEqual(['categories', 'products', 'orders', 'reviews']);
      expect(ecommerce.icon).toBe('🛒');
      expect(ecommerce.badge).toContain('20 Items');

      const blog = templates.find((t) => t.id === 'blog')!;
      expect(blog.collections).toEqual(['authors', 'tags', 'posts', 'comments']);
      expect(blog.icon).toBe('📝');

      const crm = templates.find((t) => t.id === 'crm')!;
      expect(crm.collections).toEqual(['companies', 'leads', 'deals', 'activities']);
      expect(crm.icon).toBe('👥');
    });

    it('should support case-insensitive aliases for templates', () => {
      expect(app.templates.get('ecommerce')?.id).toBe('ecommerce');
      expect(app.templates.get('E-COMMERCE')?.id).toBe('ecommerce');
      expect(app.templates.get('shop')?.id).toBe('ecommerce');
      expect(app.templates.get('store')?.id).toBe('ecommerce');

      expect(app.templates.get('blog')?.id).toBe('blog');
      expect(app.templates.get('content')?.id).toBe('blog');
      expect(app.templates.get('editorial')?.id).toBe('blog');

      expect(app.templates.get('saas')?.id).toBe('crm');
      expect(app.templates.get('CRM')?.id).toBe('crm');
      expect(app.templates.get('pipeline')?.id).toBe('crm');
      expect(app.templates.get('sales')?.id).toBe('crm');

      expect(app.templates.get('unknown_template')).toBeUndefined();
    });
  });

  describe('🛒 E-Commerce Starter Template Application', () => {
    it('should apply ecommerce template with 20 pre-seeded products & custom images', async () => {
      const res = await app.templates.apply('ecommerce');

      expect(res.success).toBe(true);
      expect(res.skipped).toBe(false);
      expect(res.template).toBe('ecommerce');
      expect(res.collections).toEqual(['categories', 'products', 'orders', 'reviews']);

      // 1. Verify collections exist in SchemaService
      const catCol = app.schema.getCollectionOrThrow('categories');
      const prodCol = app.schema.getCollectionOrThrow('products');
      const ordCol = app.schema.getCollectionOrThrow('orders');
      const revCol = app.schema.getCollectionOrThrow('reviews');

      expect(catCol.name).toBe('categories');
      expect(prodCol.name).toBe('products');
      expect(ordCol.name).toBe('orders');
      expect(revCol.name).toBe('reviews');

      // 2. Verify categories
      const categories = app.db.all<any>('SELECT * FROM "categories" ORDER BY name ASC');
      expect(categories.length).toBe(5);
      expect(categories.some((c) => c.slug === 'electronics')).toBe(true);

      // Verify category image saved on disk
      for (const cat of categories) {
        expect(cat.image).toBeTruthy();
        const filePath = app.files.getFilePath(catCol.id, cat.id, cat.image);
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('<svg');
      }

      // 3. Verify exactly 20 products pre-seeded with images
      const products = app.db.all<any>('SELECT * FROM "products"');
      expect(products.length).toBe(20);

      // Check product images on disk
      for (const prod of products) {
        expect(prod.image).toBeTruthy();
        expect(prod.price).toBeGreaterThan(0);
        expect(prod.stock).toBeGreaterThan(0);
        expect(prod.category).toBeTruthy();

        const filePath = app.files.getFilePath(prodCol.id, prod.id, prod.image);
        expect(fs.existsSync(filePath)).toBe(true);
        const svgContent = fs.readFileSync(filePath, 'utf-8');
        expect(svgContent).toContain('<svg');
        expect(svgContent).toContain('NodeStack');
      }

      // 4. Verify orders
      const orders = app.db.all<any>('SELECT * FROM "orders"');
      expect(orders.length).toBe(8);
      for (const ord of orders) {
        expect(ord.orderNumber).toMatch(/^ORD-/);
        expect(ord.total).toBeGreaterThan(0);
        const items = JSON.parse(ord.items);
        expect(Array.isArray(items)).toBe(true);
        expect(items.length).toBeGreaterThan(0);
      }

      // 5. Verify reviews
      const reviews = app.db.all<any>('SELECT * FROM "reviews"');
      expect(reviews.length).toBe(15);
      for (const rev of reviews) {
        expect(rev.rating).toBeGreaterThanOrEqual(1);
        expect(rev.product).toMatch(/^prod_/);
      }
    });

    it('should be idempotent and skip re-applying if already applied', async () => {
      const res = await app.templates.apply('ecommerce');
      expect(res.success).toBe(true);
      expect(res.skipped).toBe(true);
      expect(res.totalRecords).toBe(0);

      // Record count should remain 20
      const products = app.db.all<any>('SELECT * FROM "products"');
      expect(products.length).toBe(20);
    });

    it('should allow overwrite when requested', async () => {
      const res = await app.templates.apply('ecommerce', { overwrite: true });
      expect(res.success).toBe(true);
      expect(res.skipped).toBe(false);
      expect(res.totalRecords).toBeGreaterThan(0);

      const products = app.db.all<any>('SELECT * FROM "products"');
      expect(products.length).toBe(20);
    });
  });

  describe('📝 Blog / Content Starter Template Application', () => {
    it('should apply blog template with authors, tags, posts & comments', async () => {
      const res = await app.templates.apply('blog');
      expect(res.success).toBe(true);
      expect(res.collections).toEqual(['authors', 'tags', 'posts', 'comments']);

      const authCol = app.schema.getCollectionOrThrow('authors');
      const postsCol = app.schema.getCollectionOrThrow('posts');

      // Verify authors
      const authors = app.db.all<any>('SELECT * FROM "authors"');
      expect(authors.length).toBe(4);
      for (const a of authors) {
        expect(a.avatar).toBeTruthy();
        const filePath = app.files.getFilePath(authCol.id, a.id, a.avatar);
        expect(fs.existsSync(filePath)).toBe(true);
      }

      // Verify tags
      const tags = app.db.all<any>('SELECT * FROM "tags"');
      expect(tags.length).toBe(6);

      // Verify posts with cover images and markdown content
      const posts = app.db.all<any>('SELECT * FROM "posts"');
      expect(posts.length).toBe(8);
      for (const p of posts) {
        expect(p.title).toBeTruthy();
        expect(p.content).toContain('##');
        expect(p.coverImage).toBeTruthy();
        const filePath = app.files.getFilePath(postsCol.id, p.id, p.coverImage);
        expect(fs.existsSync(filePath)).toBe(true);
      }

      // Verify comments
      const comments = app.db.all<any>('SELECT * FROM "comments"');
      expect(comments.length).toBe(10);
    });
  });

  describe('👥 SaaS / CRM Starter Template Application', () => {
    it('should apply crm template with companies, leads, deals & activities', async () => {
      const res = await app.templates.apply('crm');
      expect(res.success).toBe(true);
      expect(res.collections).toEqual(['companies', 'leads', 'deals', 'activities']);

      const compCol = app.schema.getCollectionOrThrow('companies');

      // Verify companies & logo images
      const companies = app.db.all<any>('SELECT * FROM "companies"');
      expect(companies.length).toBe(6);
      for (const c of companies) {
        expect(c.logo).toBeTruthy();
        const filePath = app.files.getFilePath(compCol.id, c.id, c.logo);
        expect(fs.existsSync(filePath)).toBe(true);
      }

      // Verify leads
      const leads = app.db.all<any>('SELECT * FROM "leads"');
      expect(leads.length).toBe(8);

      // Verify deals
      const deals = app.db.all<any>('SELECT * FROM "deals"');
      expect(deals.length).toBe(6);
      for (const d of deals) {
        expect(d.value).toBeGreaterThan(0);
        expect(d.stage).toBeTruthy();
      }

      // Verify activities
      const activities = app.db.all<any>('SELECT * FROM "activities"');
      expect(activities.length).toBe(6);
    });
  });

  describe('HTTP API Endpoints', () => {
    it('GET /api/templates should list available starter templates', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/templates`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.totalItems).toBe(3);
      expect(data.items.some((t: any) => t.id === 'ecommerce')).toBe(true);
      expect(data.items.some((t: any) => t.id === 'blog')).toBe(true);
      expect(data.items.some((t: any) => t.id === 'crm')).toBe(true);
    });

    it('GET /api/templates/:template should return template details', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/templates/ecommerce`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.id).toBe('ecommerce');
      expect(data.name).toBe('E-Commerce');
      expect(data.collections.map((c: any) => c.name)).toEqual([
        'categories',
        'products',
        'orders',
        'reviews',
      ]);
    });

    it('POST /api/templates/apply should require admin auth or initial setup', async () => {
      // Unauthenticated request with admin existing should be rejected (403)
      const res = await fetch(`http://127.0.0.1:${port}/api/templates/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: 'ecommerce' }),
      });
      expect(res.status).toBe(403);
    });

    it('POST /api/templates/apply with admin token should succeed', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/templates/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ template: 'ecommerce' }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should serve generated product image through /api/files endpoint', async () => {
      const products = app.db.all<any>('SELECT * FROM "products" LIMIT 1');
      const prod = products[0];

      const fileUrl = `http://127.0.0.1:${port}/api/files/products/${prod.id}/${prod.image}`;
      const res = await fetch(fileUrl);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('image/svg+xml');

      const text = await res.text();
      expect(text).toContain('<svg');
      expect(text).toContain(prod.name);
    });
  });

  describe('CLI Command Integration', () => {
    const cliTestDir = path.resolve(__dirname, '../.test_cli_templates');

    beforeAll(() => {
      if (fs.existsSync(cliTestDir)) {
        fs.rmSync(cliTestDir, { recursive: true, force: true });
      }
    });

    afterAll(() => {
      if (fs.existsSync(cliTestDir)) {
        fs.rmSync(cliTestDir, { recursive: true, force: true });
      }
    });

    it('should execute "nodestack template --list" without error', async () => {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(' '));

      try {
        await runCli(['node', 'nodestack', 'template', '--list', '-d', cliTestDir]);
        const output = logs.join('\n');
        expect(output).toContain('Available NodeStack Starter Templates');
        expect(output).toContain('E-Commerce');
        expect(output).toContain('Blog / Content');
        expect(output).toContain('SaaS / CRM');
      } finally {
        console.log = origLog;
      }
    });

    it('should execute "nodestack template ecommerce" and pre-seed database offline', async () => {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(' '));

      try {
        await runCli(['node', 'nodestack', 'template', 'ecommerce', '-d', cliTestDir]);
        const output = logs.join('\n');
        expect(output).toContain("Template 'E-Commerce' applied successfully");
        expect(output).toContain('categories, products, orders, reviews');

        // Verify SQLite database created on disk
        const appCheck = new NodeStack({ dataDir: cliTestDir });
        const prods = appCheck.db.all<any>('SELECT * FROM "products"');
        expect(prods.length).toBe(20);
        appCheck.db.close();
      } finally {
        console.log = origLog;
      }
    });

    it('should support "npx nodestack start --template ecommerce" flag', async () => {
      const cliStartDir = path.resolve(__dirname, '../.test_cli_start_template');
      if (fs.existsSync(cliStartDir)) {
        fs.rmSync(cliStartDir, { recursive: true, force: true });
      }

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(' '));

      try {
        const appInstance = new NodeStack({ dataDir: cliStartDir });
        const res = await appInstance.templates.apply('ecommerce');
        expect(res.success).toBe(true);
        expect(res.collections).toContain('products');

        const prods = appInstance.db.all<any>('SELECT * FROM "products"');
        expect(prods.length).toBe(20);
        appInstance.db.close();
      } finally {
        console.log = origLog;
        if (fs.existsSync(cliStartDir)) {
          fs.rmSync(cliStartDir, { recursive: true, force: true });
        }
      }
    });

    it('should delete existing collection via CLI "nodestack collection delete <name>"', async () => {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(' '));

      try {
        await runCli(['node', 'nodestack', 'collection', 'delete', 'reviews', '-d', cliTestDir]);
        const output = logs.join('\n');
        expect(output).toContain("Collection 'reviews' and its SQLite table were successfully deleted!");

        // Verify reviews collection is gone
        const appCheck = new NodeStack({ dataDir: cliTestDir });
        expect(appCheck.schema.getCollection('reviews')).toBeUndefined();
        appCheck.db.close();
      } finally {
        console.log = origLog;
      }
    });
  });

  describe('Deleting Existing Collections via HTTP API', () => {
    it('should permanently delete an existing collection and clean up its files', async () => {
      // Create a temporary collection with a file
      const tempCol = app.schema.createCollection({
        name: 'temp_notes',
        type: 'base',
        schema: [
          { id: 'f_title', name: 'title', type: 'text', required: true },
          { id: 'f_file', name: 'attachment', type: 'file' },
        ],
      });

      // Save a file in it
      const saved = await app.files.saveFile(
        tempCol.id,
        'rec_1',
        'sample.txt',
        Buffer.from('hello world', 'utf-8'),
        'text/plain'
      );
      expect(saved.filename).toBeTruthy();
      expect(fs.existsSync(path.join(app.files.storageDir, tempCol.id, 'rec_1', saved.filename))).toBe(true);

      // Delete via API
      const res = await fetch(`http://127.0.0.1:${port}/api/collections/temp_notes`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      expect(res.status).toBe(204);

      // Verify collection is dropped in SchemaService and SQLite
      expect(app.schema.getCollection('temp_notes')).toBeUndefined();
      expect(() => app.db.all('SELECT * FROM "temp_notes"')).toThrow();

      // Verify storage files directory is cleaned up
      expect(fs.existsSync(path.join(app.files.storageDir, tempCol.id))).toBe(false);
    });

    it('should prevent deleting system collections', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/collections/_admins`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain('Cannot delete system collection');
    });

    it('should not drop collection or delete SQLite table if storage cleanup fails', async () => {
      // Create a collection
      app.schema.createCollection({
        name: 'secure_docs',
        type: 'base',
        schema: [{ id: 'f_title', name: 'title', type: 'text' }],
      });

      // Mock deleteCollectionFiles to fail
      const origDeleteFiles = app.files.deleteCollectionFiles;
      (app.files as any).deleteCollectionFiles = async () => {
        throw new Error('EPERM: operation not permitted');
      };

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/collections/secure_docs`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        });
        // Must fail with error
        expect(res.status).toBe(500);

        // Verify collection and table were NOT deleted
        expect(app.schema.getCollection('secure_docs')).toBeDefined();
        const records = app.db.all('SELECT * FROM "secure_docs"');
        expect(records).toBeDefined();
      } finally {
        (app.files as any).deleteCollectionFiles = origDeleteFiles;
      }
    });
  });
});

