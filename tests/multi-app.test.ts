import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import http from 'http';
import { NodeStack } from '../src/NodeStack';
import { NodeSqliteDriver } from '../src/database/drivers/NodeSqliteDriver';
import {
  NodeStackClient,
  MemoryAuthStore,
} from '../packages/client/src';

describe('Multi-Application & MVP Support Integration Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_multi_app_data');
  const port = 8215;
  let server: NodeStack;
  let client: NodeStackClient;

  // Mock webhook receiver server
  let webhookServer: http.Server;
  let webhookReceivedEvents: any[] = [];
  const webhookPort = 9185;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    // Start webhook receiver
    await new Promise<void>((resolve) => {
      webhookServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            webhookReceivedEvents.push(JSON.parse(body));
          } catch {
            webhookReceivedEvents.push(body);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'received' }));
        });
      });
      webhookServer.listen(webhookPort, () => resolve());
    });

    server = new NodeStack({
      dataDir: testDir,
      port,
      appName: 'Multi-App Test Instance',
    });

    await server.start(port);

    client = new NodeStackClient(`http://127.0.0.1:${port}`, {
      authStore: new MemoryAuthStore(),
    });

    // Create superadmin
    await client.admins.createInitial('superadmin@nodestack.io', 'superpassword123');
  });

  afterAll(async () => {
    await server.stop();
    if (webhookServer) {
      await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
    }
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Windows file lock fallback
      }
    }
  });

  describe('1. Default Application & App Lifecycle', () => {
    it('should have the default application pre-seeded out of the box', async () => {
      const apps = await client.apps.getList();
      expect(apps.length).toBeGreaterThanOrEqual(1);

      const defaultApp = apps.find((a) => a.slug === 'default');
      expect(defaultApp).toBeDefined();
      expect(defaultApp?.isDefault).toBe(true);

      // Verify physical directory layout
      const defaultDir = path.join(testDir, 'apps', 'default');
      expect(fs.existsSync(defaultDir)).toBe(true);
      expect(fs.existsSync(path.join(defaultDir, 'data.db'))).toBe(true);
      expect(fs.existsSync(path.join(defaultDir, 'storage'))).toBe(true);
    });

    it('should create new applications with isolated databases and storage', async () => {
      const shopApp = await client.apps.create({
        name: 'E-Commerce MVP',
        slug: 'ecommerce',
        description: 'Online store application',
      });

      expect(shopApp.id).toBeDefined();
      expect(shopApp.slug).toBe('ecommerce');
      expect(shopApp.name).toBe('E-Commerce MVP');
      expect(shopApp.isDefault).toBe(false);

      const blogApp = await client.apps.create({
        name: 'Company Blog',
        slug: 'blog',
        description: 'Publishing platform',
      });

      expect(blogApp.slug).toBe('blog');

      // Verify directories created
      expect(fs.existsSync(path.join(testDir, 'apps', 'ecommerce', 'data.db'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'apps', 'blog', 'data.db'))).toBe(true);

      const allApps = await client.apps.getList();
      expect(allApps.map((a) => a.slug)).toContain('default');
      expect(allApps.map((a) => a.slug)).toContain('ecommerce');
      expect(allApps.map((a) => a.slug)).toContain('blog');
    });

    it('should update application metadata', async () => {
      const updated = await client.apps.update('ecommerce', {
        name: 'Super E-Commerce MVP',
        description: 'Updated store description',
      });

      expect(updated.name).toBe('Super E-Commerce MVP');
      expect(updated.description).toBe('Updated store description');

      const fetched = await client.apps.getOne('ecommerce');
      expect(fetched.name).toBe('Super E-Commerce MVP');
    });

    it('should prevent creating an app with duplicate slug', async () => {
      await expect(
        client.apps.create({
          name: 'Another E-Commerce',
          slug: 'ecommerce',
        })
      ).rejects.toThrow();
    });

    it('should prevent deleting the default application', async () => {
      await expect(client.apps.delete('default')).rejects.toThrow();
    });
  });

  describe('2. Schema & Collection Isolation', () => {
    it('should create isolated collections across different applications', async () => {
      const shopClient = client.app('ecommerce');
      const blogClient = client.app('blog');

      // Create 'products' in ecommerce app
      const shopCol = await shopClient.collections.create({
        name: 'products',
        schema: [
          { name: 'title', type: 'text', required: true },
          { name: 'price', type: 'number', required: true },
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
      });
      expect(shopCol.name).toBe('products');

      // Create 'articles' in blog app
      const blogCol = await blogClient.collections.create({
        name: 'articles',
        schema: [
          { name: 'headline', type: 'text', required: true },
          { name: 'body', type: 'text' },
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
      });
      expect(blogCol.name).toBe('articles');

      // Create 'products' in blog app with a completely DIFFERENT schema
      const blogProductsCol = await blogClient.collections.create({
        name: 'products',
        schema: [
          { name: 'sku', type: 'text', required: true },
          { name: 'stock', type: 'number' },
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
      });
      expect(blogProductsCol.name).toBe('products');

      // Verify collection list isolation
      const shopCols = await shopClient.collections.getList();
      const shopNames = shopCols.map((c) => c.name);
      expect(shopNames).toContain('products');
      expect(shopNames).not.toContain('articles');

      const blogCols = await blogClient.collections.getList();
      const blogNames = blogCols.map((c) => c.name);
      expect(blogNames).toContain('products');
      expect(blogNames).toContain('articles');
    });

    it('should isolate data records between applications with same collection name', async () => {
      const shopClient = client.app('ecommerce');
      const blogClient = client.app('blog');

      // Insert record into ecommerce products
      const p1 = await shopClient.collection('products').create({
        title: 'Wireless Headphones',
        price: 199.99,
      });
      expect(p1.id).toBeDefined();

      // Insert record into blog products (different schema!)
      const p2 = await blogClient.collection('products').create({
        sku: 'ELEC-9921',
        stock: 45,
      });
      expect(p2.id).toBeDefined();

      // Verify ecommerce products only contain shop records
      const shopItems = await shopClient.collection('products').getFullList();
      expect(shopItems.length).toBe(1);
      expect(shopItems[0].title).toBe('Wireless Headphones');
      expect(shopItems[0].price).toBe(199.99);
      expect((shopItems[0] as any).sku).toBeUndefined();

      // Verify blog products only contain blog records
      const blogItems = await blogClient.collection('products').getFullList();
      expect(blogItems.length).toBe(1);
      expect((blogItems[0] as any).sku).toBe('ELEC-9921');
      expect((blogItems[0] as any).stock).toBe(45);
      expect((blogItems[0] as any).title).toBeUndefined();

      // Verify cross-access 404 for collections that do not exist in an app
      await expect(shopClient.collection('articles').getFullList()).rejects.toThrow();
    });
  });

  describe('3. Application-Scoped Snapshot & Demo Mode Isolation', () => {
    it('should freeze and reset only the targeted application without affecting other apps', async () => {
      const shopClient = client.app('ecommerce');
      const blogClient = client.app('blog');

      // Freeze demo state on shop app
      await shopClient.demo.snapshot({ name: 'shop-baseline' });

      // Mutate shop app: add another product
      await shopClient.collection('products').create({
        title: 'Mechanical Keyboard',
        price: 129.5,
      });

      // Mutate blog app: add an article and another product
      await blogClient.collection('articles').create({
        headline: 'Announcing NodeStack Multi-App Support',
        body: 'Full database-per-app isolation is now live!',
      });
      await blogClient.collection('products').create({
        sku: 'KEYB-0012',
        stock: 12,
      });

      // Before reset:
      // Shop should have 2 products
      const shopBefore = await shopClient.collection('products').getFullList();
      expect(shopBefore.length).toBe(2);

      // Blog should have 2 products and 1 article
      const blogBefore = await blogClient.collection('products').getFullList();
      expect(blogBefore.length).toBe(2);
      const blogArticlesBefore = await blogClient.collection('articles').getFullList();
      expect(blogArticlesBefore.length).toBe(1);

      // Reset ONLY shop app
      await shopClient.demo.reset();

      // After reset:
      // Shop should be restored to 1 product
      const shopAfter = await shopClient.collection('products').getFullList();
      expect(shopAfter.length).toBe(1);
      expect(shopAfter[0].title).toBe('Wireless Headphones');

      // Blog MUST remain completely untouched!
      const blogAfter = await blogClient.collection('products').getFullList();
      expect(blogAfter.length).toBe(2);
      const blogArticlesAfter = await blogClient.collection('articles').getFullList();
      expect(blogArticlesAfter.length).toBe(1);
    });
  });

  describe('4. Application-Scoped Webhooks & Event Isolation', () => {
    it('should strictly isolate webhook triggers to the application where they are registered', async () => {
      webhookReceivedEvents = [];
      const shopClient = client.app('ecommerce');
      const blogClient = client.app('blog');

      // Register webhook on shop app only
      const webhook = await shopClient.webhooks.create({
        name: 'Shop Products Webhook',
        url: `http://127.0.0.1:${webhookPort}/webhook-receiver`,
        events: ['products.created'],
        enabled: true,
      });
      expect(webhook.id).toBeDefined();

      // Trigger record creation on blog app
      await blogClient.collection('products').create({
        sku: 'TRIGGER-TEST',
        stock: 5,
      });

      // Allow async webhook dispatcher a brief moment
      await new Promise((resolve) => setTimeout(resolve, 200));

      // The shop webhook receiver MUST NOT have received anything from blog app mutation
      expect(webhookReceivedEvents.length).toBe(0);

      // Trigger record creation on shop app
      await shopClient.collection('products').create({
        title: 'Triggered Gaming Mouse',
        price: 59.99,
      });

      // Allow async webhook dispatcher to process
      await new Promise((resolve) => setTimeout(resolve, 300));

      // The shop webhook receiver MUST have received the shop event
      expect(webhookReceivedEvents.length).toBe(1);
      expect(webhookReceivedEvents[0].event).toBe('products.created');
      expect(webhookReceivedEvents[0].record.title).toBe('Triggered Gaming Mouse');
    });
  });

  describe('5. App Resolution Routing Mechanisms', () => {
    it('should resolve application via HTTP header x-nodestack-app', async () => {
      const res = await client.send<{ items: any[] }>('/api/collections/products/records', {
        headers: {
          'x-nodestack-app': 'ecommerce',
        },
      });
      expect(res.items.length).toBeGreaterThan(0);
      expect(res.items[0].title).toBeDefined();
    });

    it('should resolve application via path prefix /api/apps/:appId/...', async () => {
      const res = await client.send<{ items: any[] }>('/api/apps/blog/collections/articles/records');
      expect(res.items.length).toBe(1);
      expect(res.items[0].headline).toBe('Announcing NodeStack Multi-App Support');
    });

    it('should resolve application via query parameter ?app=', async () => {
      const res = await client.send<{ items: any[] }>('/api/collections/articles/records', {
        query: { app: 'blog' },
      });
      expect(res.items.length).toBe(1);
      expect(res.items[0].headline).toBe('Announcing NodeStack Multi-App Support');
    });

    it('should fallback to default app when no app is specified', async () => {
      // Create a collection in default app
      await client.collections.create({
        name: 'default_settings',
        schema: [{ name: 'key', type: 'text' }],
        listRule: '',
      });

      // Calling without headers/prefix routes to default
      const cols = await client.collections.getList();
      expect(cols.map((c) => c.name)).toContain('default_settings');
      expect(cols.map((c) => c.name)).not.toContain('articles');
    });
  });

  describe('6. Application Teardown & Deletion', () => {
    it('should delete an application and clean up its resources', async () => {
      // Create a temporary app to delete
      await client.apps.create({
        name: 'Temporary Sandbox',
        slug: 'sandbox',
      });

      expect(fs.existsSync(path.join(testDir, 'apps', 'sandbox'))).toBe(true);

      const delRes = await client.apps.delete('sandbox');
      expect(delRes).toBe(true);

      // Verify removed from list
      const apps = await client.apps.getList();
      expect(apps.find((a) => a.slug === 'sandbox')).toBeUndefined();

      // Subsequent access to sandbox should 404
      await expect(client.app('sandbox').collections.getList()).rejects.toThrow();
    });
  });

  describe('7. Application-Scoped OpenAPI Documentation & System Table Exclusion', () => {
    it('should exclude internal system tables (prefixed with _) from OpenAPI specs', async () => {
      // Fetch default app OpenAPI spec
      const spec = await client.send<any>('/api/openapi.json');
      const tagNames = (spec.tags || []).map((t: any) => t.name);

      // Verify no internal system tables starting with '_' are included in OpenAPI tags or paths
      const systemTags = tagNames.filter((name: string) => name.startsWith('_'));
      expect(systemTags).toEqual([]);

      for (const p of Object.keys(spec.paths || {})) {
        expect(p).not.toMatch(/\/api\/collections\/_[^\/]+/);
      }
    });

    it('should serve application-scoped OpenAPI spec via query parameter and header', async () => {
      // 1. Fetch Blog OpenAPI spec via ?app=blog
      const blogSpec = await client.send<any>('/api/openapi.json', {
        query: { app: 'blog' },
      });
      expect(blogSpec.openapi).toBe('3.0.3');
      const blogTags = (blogSpec.tags || []).map((t: any) => t.name);
      expect(blogTags).toContain('articles');
      expect(blogTags).not.toContain('default_settings');

      // 2. Fetch Ecommerce OpenAPI spec via header x-nodestack-app: ecommerce
      const ecomSpec = await client.send<any>('/api/openapi.json', {
        headers: { 'x-nodestack-app': 'ecommerce' },
      });
      const ecomTags = (ecomSpec.tags || []).map((t: any) => t.name);
      expect(ecomTags).toContain('products');
      expect(ecomTags).not.toContain('articles');
      expect(ecomTags).not.toContain('default_settings');

      // 3. Fetch Default app OpenAPI spec
      const defaultSpec = await client.send<any>('/api/openapi.json');
      const defaultTags = (defaultSpec.tags || []).map((t: any) => t.name);
      expect(defaultTags).toContain('default_settings');
      expect(defaultTags).not.toContain('articles');

      // 4. Fetch via /api/apps/:appId/openapi.json route
      const directBlogSpec = await client.send<any>('/api/apps/blog/openapi.json');
      expect((directBlogSpec.tags || []).map((t: any) => t.name)).toContain('articles');
      expect(directBlogSpec.paths['/api/apps/blog/collections/articles/records']).toBeDefined();
      expect(defaultSpec.paths['/api/collections/default_settings/records']).toBeDefined();
    });

    it('should serve application-scoped interactive docs viewer at /_/docs?app=:appId', async () => {
      const res = await fetch(`http://127.0.0.1:8215/_/docs?app=blog`);
      expect(res.status).toBe(200);
      const html = await res.text();

      // Scalar / Swagger should point to the app-scoped openapi.json
      expect(html).toContain('data-url="/api/openapi.json?app=blog"');
      // Should render the App switcher control
      expect(html).toContain('id="docs-app-select"');
      expect(html).toContain('value="blog"');
    });

    it('should serve application-scoped analytics and database breakdown for active app', async () => {
      // 1. Metrics for Blog app (has 1 articles record created earlier in test suite, plus blog-scoped products)
      const blogMetrics = await client.send<any>('/api/metrics', {
        headers: { 'x-nodestack-app': 'blog' },
      });
      expect(blogMetrics.database).toBeDefined();
      const blogCols = blogMetrics.database.collectionsBreakdown.map((c: any) => c.collection);
      expect(blogCols).toContain('articles');
      expect(blogCols).toContain('products');
      expect(blogCols).not.toContain('default_settings');
      const articleItem = blogMetrics.database.collectionsBreakdown.find((c: any) => c.collection === 'articles');
      expect(articleItem.count).toBeGreaterThanOrEqual(1);

      // 2. Metrics for Ecommerce app (has products record created earlier in test suite, but NOT articles)
      const ecomMetrics = await client.send<any>('/api/metrics', {
        headers: { 'x-nodestack-app': 'ecommerce' },
      });
      const ecomCols = ecomMetrics.database.collectionsBreakdown.map((c: any) => c.collection);
      expect(ecomCols).toContain('products');
      expect(ecomCols).not.toContain('articles');
      expect(ecomCols).not.toContain('default_settings');

      // 3. Direct route /api/apps/:appId/metrics
      const directMetrics = await client.send<any>('/api/apps/blog/metrics');
      const directCols = directMetrics.database.collectionsBreakdown.map((c: any) => c.collection);
      expect(directCols).toContain('articles');

      // 4. Verify 24h traffic metrics and logs are scoped to the active application
      expect(blogMetrics.traffic24h).toBeDefined();
      expect(blogMetrics.traffic24h.totalRequests).toBeGreaterThanOrEqual(1);

      const blogLogs = await client.send<any>('/api/apps/blog/logs');
      expect(blogLogs.items).toBeDefined();
      expect(blogLogs.totalItems).toBeGreaterThanOrEqual(1);
    });
  });

  describe('8. Application-Scoped Plugins & Settings Isolation', () => {
    it('should isolate plugin settings and enabled status between applications', async () => {
      // 1. Enable and configure stripe in 'ecommerce' app
      await client.send<any>('/api/plugins/stripe/enable', {
        method: 'POST',
        headers: { 'x-nodestack-app': 'ecommerce' },
      });

      await client.send<any>('/api/plugins/stripe/config', {
        method: 'PUT',
        headers: { 'x-nodestack-app': 'ecommerce' },
        body: {
          currency: 'eur',
          dryRun: true,
        },
      });

      // 2. Fetch stripe config in ecommerce app
      const ecomConfig = await client.send<any>('/api/plugins/stripe/config', {
        headers: { 'x-nodestack-app': 'ecommerce' },
      });
      const ecomCurrencyField = ecomConfig.fields.find((f: any) => f.name === 'currency');
      expect(ecomCurrencyField?.value).toBe('eur');
      expect(ecomCurrencyField?.source).toBe('db');
      const ecomDryRunField = ecomConfig.fields.find((f: any) => f.name === 'dryRun');
      expect(ecomDryRunField?.value).toBe(true);

      // 3. Fetch stripe config in blog app - it should NOT have ecommerce config!
      const blogConfig = await client.send<any>('/api/plugins/stripe/config', {
        headers: { 'x-nodestack-app': 'blog' },
      });
      const blogCurrencyField = blogConfig.fields.find((f: any) => f.name === 'currency');
      expect(blogCurrencyField?.value).toBe('usd');
      expect(blogCurrencyField?.source).toBe('default');
      const blogDryRunField = blogConfig.fields.find((f: any) => f.name === 'dryRun');
      expect(blogDryRunField?.value).toBe(false);

      // 4. Fetch available catalog per app - ecommerce has stripe enabled, blog does not
      const ecomCatalog = await client.send<any>('/api/plugins/available', {
        headers: { 'x-nodestack-app': 'ecommerce' },
      });
      const ecomStripe = ecomCatalog.plugins.find((p: any) => p.name === 'stripe');
      expect(ecomStripe?.isInstalled).toBe(true);

      const blogCatalog = await client.send<any>('/api/plugins/available', {
        headers: { 'x-nodestack-app': 'blog' },
      });
      const blogStripe = blogCatalog.plugins.find((p: any) => p.name === 'stripe');
      expect(blogStripe?.isInstalled).toBe(false);
    });

    it('should strictly isolate plugin runtime status and admin nav items across apps without cross-contamination', async () => {
      // 1. Enable S3 storage for ecommerce app and set custom bucket
      await client.send('/api/plugins/s3-storage/enable', {
        method: 'POST',
        headers: { 'x-nodestack-app': 'ecommerce' },
      });
      await client.send('/api/plugins/s3-storage/config', {
        method: 'PUT',
        headers: { 'x-nodestack-app': 'ecommerce' },
        body: {
          bucket: 'ecommerce-production-bucket',
          region: 'eu-central-1',
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
      });

      // 2. Also enable S3 storage for blog app with default bucket (or unconfigured)
      await client.send('/api/plugins/s3-storage/enable', {
        method: 'POST',
        headers: { 'x-nodestack-app': 'blog' },
      });

      // 3. Query /api/s3/status for ecommerce
      const ecomS3Status = await client.send<any>('/api/s3/status', {
        headers: { 'x-nodestack-app': 'ecommerce' },
      });
      expect(ecomS3Status.bucket).toBe('ecommerce-production-bucket');
      expect(ecomS3Status.region).toBe('eu-central-1');

      // 4. Query /api/s3/status for blog app - must NOT leak ecommerce's bucket (it should return 400 Not Configured!)
      let blogError: any;
      try {
        await client.send('/api/s3/status', {
          headers: { 'x-nodestack-app': 'blog' },
        });
      } catch (err: any) {
        blogError = err;
      }
      expect(blogError).toBeDefined();
      expect(blogError.status).toBe(400);
      expect(blogError.message).toContain('not configured');

      // 5. Query scoped admin nav items for ecommerce and blog
      const ecomNavRes = await client.send<{ items: any[] }>('/api/apps/ecommerce/admin/nav-items');
      const ecomS3Nav = ecomNavRes.items.find((item: any) => item.id === 's3-storage');
      expect(ecomS3Nav).toBeDefined();
      expect(ecomS3Nav.view?.description).toContain('ecommerce-production-bucket');
      expect(ecomS3Nav.badge).toBe('EU-CENTRAL-1');

      const blogNavRes = await client.send<{ items: any[] }>('/api/apps/blog/admin/nav-items');
      const blogS3Nav = blogNavRes.items.find((item: any) => item.id === 's3-storage');
      expect(blogS3Nav).toBeDefined();
      expect(blogS3Nav.badge).toBe('UNCONFIGURED');
      expect(blogS3Nav.view?.description).not.toContain('ecommerce-production-bucket');
    });

    it('should provision declarative collections and system tables into the target app database when plugin is enabled', async () => {
      const ecomScope = server.apps.get('ecommerce');
      const blogScope = server.apps.get('blog');
      const defaultScope = server.apps.get('default');

      // 1. Stripe was enabled for ecommerce in the previous test
      // ecommerce scope schema MUST contain _stripe_payments and _stripe_customers
      expect(ecomScope.schema.getCollection('_stripe_payments')).toBeDefined();
      expect(ecomScope.schema.getCollection('_stripe_customers')).toBeDefined();

      // 2. Direct SQLite check: tables MUST exist in ecommerce database
      const ecomTable = ecomScope.db.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
        ['_stripe_payments']
      );
      expect(ecomTable?.name).toBe('_stripe_payments');

      // 3. blog and default apps MUST NOT have _stripe_payments tables or schema definitions
      expect(blogScope.schema.getCollection('_stripe_payments')).toBeUndefined();
      expect(defaultScope.schema.getCollection('_stripe_payments')).toBeUndefined();

      const blogTable = blogScope.db.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
        ['_stripe_payments']
      );
      expect(blogTable).toBeUndefined();

      const defaultTable = defaultScope.db.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
        ['_stripe_payments']
      );
      expect(defaultTable).toBeUndefined();

      // 4. Records can be created in the scoped collection on ecommerce
      const record = await ecomScope.records.create('_stripe_payments', {
        paymentIntentId: 'pi_test_multi_app_123',
        amount: 4999,
        currency: 'eur',
        status: 'succeeded',
      });
      expect(record.id).toBeDefined();
      expect(record.paymentIntentId).toBe('pi_test_multi_app_123');

      // Record exists in ecommerce db
      const fetched = await ecomScope.records.getOne('_stripe_payments', record.id);
      expect(fetched.amount).toBe(4999);

      // S3 Storage was also enabled for ecommerce
      expect(ecomScope.schema.getCollection('_s3_uploads')).toBeDefined();
      const ecomS3Table = ecomScope.db.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
        ['_s3_uploads']
      );
      expect(ecomS3Table?.name).toBe('_s3_uploads');

      // 5. Test restart auto-provisioning: fresh NodeStack instance using same testDir
      const restartInstance = new NodeStack({
        dataDir: testDir,
        port: port + 50,
      });
      try {
        const restartedEcom = restartInstance.apps.get('ecommerce');
        expect(restartedEcom.schema.getCollection('_stripe_payments')).toBeDefined();
        expect(restartedEcom.schema.getCollection('_s3_uploads')).toBeDefined();

        const restartedBlog = restartInstance.apps.get('blog');
        expect(restartedBlog.schema.getCollection('_stripe_payments')).toBeUndefined();
      } finally {
        await restartInstance.stop();
      }
    });
  });

  describe('9. Custom Database Driver & Driver Factory Isolation', () => {
    let customTestDir: string;

    beforeEach(() => {
      customTestDir = path.resolve(__dirname, `../.test_custom_driver_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
      fs.mkdirSync(customTestDir, { recursive: true });
    });

    afterEach(() => {
      try {
        if (fs.existsSync(customTestDir)) {
          fs.rmSync(customTestDir, { recursive: true, force: true });
        }
      } catch {}
    });

    it('should restrict a single customDriver instance to default app and isolate newly created apps in their own db', async () => {
      const customDbFile = path.join(customTestDir, 'custom_default.db');
      const customDefaultDriver = new NodeSqliteDriver(customDbFile);

      const stack = new NodeStack({
        dataDir: customTestDir,
        appName: 'Custom Driver Stack',
        customDriver: customDefaultDriver,
      });

      // 1. Default app uses customDefaultDriver
      expect(stack.defaultApp.db.getDriver()).toBe(customDefaultDriver);

      // 2. Create a new app 'store'
      const storeScope = await stack.apps.create({
        name: 'Store App',
        slug: 'store',
      });

      // 3. Verify 'store' DOES NOT share the customDefaultDriver
      expect(storeScope.db.getDriver()).not.toBe(customDefaultDriver);

      // 4. Create collection 'items' in default app
      stack.defaultApp.schema.createCollection({
        name: 'items',
        type: 'base',
        schema: [{ id: 'f1', name: 'title', type: 'text', required: true }],
        createRule: '',
        listRule: '',
      });
      await stack.defaultApp.records.create('items', { title: 'Default Item' });

      // 5. Create collection 'items' in store app with different data
      storeScope.schema.createCollection({
        name: 'items',
        type: 'base',
        schema: [{ id: 'f1', name: 'title', type: 'text', required: true }],
        createRule: '',
        listRule: '',
      });
      await storeScope.records.create('items', { title: 'Store Item' });

      // 6. Verify records are isolated
      const defaultItems = await stack.defaultApp.records.getList('items');
      expect(defaultItems.items.length).toBe(1);
      expect(defaultItems.items[0].title).toBe('Default Item');

      const storeItems = await storeScope.records.getList('items');
      expect(storeItems.items.length).toBe(1);
      expect(storeItems.items[0].title).toBe('Store Item');

      stack.apps.closeAll();
      customDefaultDriver.close();
    });

    it('should support driverFactory to provide distinct custom drivers per application', async () => {
      const factoryDrivers: Record<string, NodeSqliteDriver> = {};

      const stack = new NodeStack({
        dataDir: customTestDir,
        appName: 'Driver Factory Stack',
        driverFactory: (app, defaultDbPath) => {
          const appDbFile = path.join(customTestDir, `factory_${app.slug}.db`);
          const driver = new NodeSqliteDriver(appDbFile);
          factoryDrivers[app.slug] = driver;
          return driver;
        },
      });

      expect(factoryDrivers['default']).toBeDefined();
      expect(stack.defaultApp.db.getDriver()).toBe(factoryDrivers['default']);

      // Create app 'micro'
      const microScope = await stack.apps.create({
        name: 'Micro App',
        slug: 'micro',
      });

      expect(factoryDrivers['micro']).toBeDefined();
      expect(microScope.db.getDriver()).toBe(factoryDrivers['micro']);
      expect(microScope.db.getDriver()).not.toBe(stack.defaultApp.db.getDriver());

      stack.apps.closeAll();
      for (const d of Object.values(factoryDrivers)) {
        try {
          d.close();
        } catch {}
      }
    });
  });
});
