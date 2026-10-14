import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  NodeStack,
  INodeStackPlugin,
  NodeStackPluginContext,
  TOKENS,
  AdminUIService,
  stripePlugin,
  s3StoragePlugin,
  resendPlugin,
  webhookPlugin,
  algoliaPlugin,
} from '../src';
import { stripePlugin as workspaceStripePlugin } from '../packages/plugins/stripe/src';
import { s3StoragePlugin as workspaceS3Plugin } from '../packages/plugins/s3/src';
import { resendPlugin as workspaceResendPlugin } from '../packages/plugins/resend/src';
import { webhookPlugin as workspaceWebhookPlugin } from '../packages/plugins/webhooks/src';
import { algoliaPlugin as workspaceAlgoliaPlugin } from '../packages/plugins/algolia/src';

describe('Formal Plugin Architecture (nodestack.use(plugin))', () => {
  const testDataDir = path.resolve(__dirname, '../.test_plugins_data');
  let app: NodeStack;

  beforeEach(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    if (app) {
      await app.stop();
    }
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('1. Core Plugin Lifecycle & Chaining (app.use)', () => {
    it('should support fluent method chaining with app.use(pluginA).use(pluginB)', () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8101 });

      const pluginA: INodeStackPlugin = {
        name: 'plugin-a',
        version: '1.0.0',
      };
      const pluginB: INodeStackPlugin = {
        name: 'plugin-b',
        version: '1.0.0',
      };

      const returned = app.use(pluginA).use(pluginB);

      expect(returned).toBe(app);
      expect(app.hasPlugin('plugin-a')).toBe(true);
      expect(app.hasPlugin('plugin-b')).toBe(true);
      expect(app.getPlugin('plugin-a')?.name).toBe('plugin-a');
      expect(app.pluginManager.getAllPlugins().length).toBe(2);
    });

    it('should support function-based plugins app.use(ctx => ...)', () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8102 });

      let initialized = false;
      app.use(function customFunctionPlugin(ctx: NodeStackPluginContext) {
        initialized = true;
        ctx.registerRoute('GET', '/api/fn-plugin-test', async (_req, reply) => {
          return reply.send({ success: true });
        });
      });

      expect(initialized).toBe(true);
      expect(app.hasPlugin('customFunctionPlugin')).toBe(true);
    });

    it('should validate plugin dependencies and throw informative error if dependency is missing', () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8103 });

      const pluginWithDep: INodeStackPlugin = {
        name: 'dependent-plugin',
        dependencies: ['non-existent-base-plugin'],
      };

      expect(() => {
        app.use(pluginWithDep);
      }).toThrow(/requires dependent plugin "non-existent-base-plugin"/);
    });

    it('should execute asynchronous plugin init before app.start() serves traffic', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8104 });

      let asyncStepDone = false;
      const asyncPlugin: INodeStackPlugin = {
        name: 'async-init-plugin',
        async init(_ctx) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          asyncStepDone = true;
        },
      };

      app.use(asyncPlugin);
      expect(asyncStepDone).toBe(false);

      await app.initPlugins();
      expect(asyncStepDone).toBe(true);
    });

    it('should execute plugin onDestroy when app.stop() is invoked', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8105 });

      let destroyed = false;
      const cleanupPlugin: INodeStackPlugin = {
        name: 'cleanup-plugin',
        onDestroy() {
          destroyed = true;
        },
      };

      app.use(cleanupPlugin);
      expect(destroyed).toBe(false);

      await app.stop();
      expect(destroyed).toBe(true);
    });
  });

  describe('2. Custom Route Registration via Plugins', () => {
    it('should register custom HTTP routes via context.registerRoute', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8106 });

      const routePlugin: INodeStackPlugin = {
        name: 'route-test-plugin',
        register(ctx) {
          ctx.registerRoute('GET', '/api/test/hello', async (_req, reply) => {
            return reply.send({ greeting: 'Hello from NodeStack Plugin!' });
          });

          ctx.registerRoute('POST', '/api/test/echo', async (req, reply) => {
            const body = req.body as any;
            return reply.status(201).send({ received: body });
          });
        }
      };

      app.use(routePlugin);

      const resGet = await app.server.inject({
        method: 'GET',
        url: '/api/test/hello',
      });
      expect(resGet.statusCode).toBe(200);
      expect(resGet.json()).toEqual({ greeting: 'Hello from NodeStack Plugin!' });

      const resPost = await app.server.inject({
        method: 'POST',
        url: '/api/test/echo',
        payload: { message: 'NodeStack Rocks' },
      });
      expect(resPost.statusCode).toBe(201);
      expect(resPost.json()).toEqual({ received: { message: 'NodeStack Rocks' } });
    });

    it('should support declarative routes in plugin definition', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8107 });

      const declarativeRoutePlugin: INodeStackPlugin = {
        name: 'declarative-route-plugin',
        routes: [
          {
            method: 'GET',
            path: '/api/declarative-ping',
            handler: async (_req, reply) => reply.send({ ping: 'pong' }),
          },
        ],
      };

      app.use(declarativeRoutePlugin);

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/declarative-ping',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ping: 'pong' });
    });

    it('should support route authentication policies ({ auth: "admin" }, { auth: "user" }, and context.auth helpers)', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8107 });

      // Create an admin
      await app.auth.createAdmin('admin@nodestack.io', 'Password123!');
      const { token: adminToken } = await app.auth.authenticateAdmin('admin@nodestack.io', 'Password123!');

      // Create a regular user
      const user = await app.records.create('users', {
        email: 'user@nodestack.io',
        password: 'Password123!',
      });
      const userAuth = await app.auth.authenticateRecord('users', 'user@nodestack.io', 'Password123!');
      const userToken = userAuth.token;

      const authRoutePlugin: INodeStackPlugin = {
        name: 'auth-route-plugin',
        routes: [
          {
            method: 'GET',
            path: '/api/test/admin-only-declarative',
            auth: 'admin',
            handler: async (_req, reply) => reply.send({ secret: 'admin-data' }),
          },
        ],
        register(ctx) {
          ctx.registerRoute('POST', '/api/test/admin-only', async (_req, reply) => {
            return reply.send({ ok: true, adminSecret: 42 });
          }, { auth: 'admin' });

          ctx.registerRoute('GET', '/api/test/user-only', async (req, reply) => {
            return reply.send({ ok: true, userId: (req as any).auth?.id });
          }, { auth: 'user' });

          ctx.registerRoute('GET', '/api/test/context-prehandler', async (_req, reply) => {
            return reply.send({ ok: true });
          }, { preHandler: ctx.auth.requireAdmin() });
        },
      };

      app.use(authRoutePlugin);

      // 1. Admin route rejects unauthenticated request
      const resUnauth = await app.server.inject({ method: 'POST', url: '/api/test/admin-only' });
      expect(resUnauth.statusCode).toBe(403);

      // 2. Admin route rejects regular user request
      const resUserOnAdmin = await app.server.inject({
        method: 'POST',
        url: '/api/test/admin-only',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(resUserOnAdmin.statusCode).toBe(403);

      // 3. Admin route accepts admin token
      const resAdminSuccess = await app.server.inject({
        method: 'POST',
        url: '/api/test/admin-only',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(resAdminSuccess.statusCode).toBe(200);
      expect(resAdminSuccess.json()).toEqual({ ok: true, adminSecret: 42 });

      // 4. Declarative admin route works
      const resDeclUnauth = await app.server.inject({ method: 'GET', url: '/api/test/admin-only-declarative' });
      expect(resDeclUnauth.statusCode).toBe(403);

      const resDeclSuccess = await app.server.inject({
        method: 'GET',
        url: '/api/test/admin-only-declarative',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(resDeclSuccess.statusCode).toBe(200);
      expect(resDeclSuccess.json()).toEqual({ secret: 'admin-data' });

      // 5. User route rejects unauthenticated request
      const resUserUnauth = await app.server.inject({ method: 'GET', url: '/api/test/user-only' });
      expect(resUserUnauth.statusCode).toBe(401);

      // 6. User route accepts user token
      const resUserSuccess = await app.server.inject({
        method: 'GET',
        url: '/api/test/user-only',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(resUserSuccess.statusCode).toBe(200);
      expect(resUserSuccess.json().userId).toBe(user.id);

      // 7. Context prehandler helper works
      const resHelperUnauth = await app.server.inject({ method: 'GET', url: '/api/test/context-prehandler' });
      expect(resHelperUnauth.statusCode).toBe(403);

      const resHelperSuccess = await app.server.inject({
        method: 'GET',
        url: '/api/test/context-prehandler',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(resHelperSuccess.statusCode).toBe(200);
    });
  });

  describe('3. Lifecycle Hooks Registration via Plugins', () => {
    it('should intercept record operations via context.registerHook', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8108 });

      // Create a test collection
      app.schema.createCollection({
        name: 'articles',
        type: 'base',
        schema: [
          { id: 'f_title', name: 'title', type: 'text', required: true },
          { id: 'f_slug', name: 'slug', type: 'text', required: false },
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
      });

      let afterCreateFired = false;
      const hookPlugin: INodeStackPlugin = {
        name: 'slug-generator-plugin',
        register(ctx) {
          // Mutate record before create
          ctx.registerHook('beforeCreate', async (e: any) => {
            if (e.collection === 'articles') {
              e.record.slug = (e.record.title || '').toLowerCase().replace(/\s+/g, '-');
            }
          });

          // Trigger side effect after create
          ctx.registerHook('afterCreate', async (e: any) => {
            if (e.collection === 'articles') {
              afterCreateFired = true;
            }
          });
        },
      };

      app.use(hookPlugin);

      const record = await app.records.create('articles', {
        title: 'Building Modern Extensible Backends',
      });

      expect(record.title).toBe('Building Modern Extensible Backends');
      expect(record.slug).toBe('building-modern-extensible-backends');
      expect(afterCreateFired).toBe(true);
    });

    it('should trigger onBeforeServe and onAfterServe hooks during server startup', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8109 });

      let beforeServeCalled = false;
      let afterServeCalled = false;

      const serveHookPlugin: INodeStackPlugin = {
        name: 'serve-hook-plugin',
        onBeforeServe(ctx) {
          expect(ctx.server).toBeDefined();
          beforeServeCalled = true;
        },
        onAfterServe(ctx) {
          expect(ctx.server).toBeDefined();
          afterServeCalled = true;
        },
      };

      app.use(serveHookPlugin);

      await app.start(8109);

      expect(beforeServeCalled).toBe(true);
      expect(afterServeCalled).toBe(true);
    });
  });

  describe('4. System Collections Registration via Plugins', () => {
    it('should register protected system collections and create SQLite tables', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8110 });

      const collectionPlugin: INodeStackPlugin = {
        name: 'system-collection-plugin',
        register(ctx) {
          ctx.registerSystemCollection({
            name: '_plugin_audit_events',
            type: 'base',
            schema: [
              { id: 'f_action', name: 'action', type: 'text', required: true },
              { id: 'f_actor', name: 'actor', type: 'text', required: true },
            ],
          });
        },
      };

      app.use(collectionPlugin);

      const col = app.schema.getCollection('_plugin_audit_events');
      expect(col).toBeDefined();
      expect(col?.system).toBe(true);
      expect(col?.name).toBe('_plugin_audit_events');

      // Should insert records into system collection
      const rec = await app.records.create('_plugin_audit_events', {
        action: 'PLUGIN_MOUNTED',
        actor: 'system',
      });
      expect(rec.id).toBeDefined();
      expect(rec.action).toBe('PLUGIN_MOUNTED');

      // Attempting to delete system collection should be blocked
      expect(() => {
        app.schema.deleteCollection('_plugin_audit_events');
      }).toThrow(/Cannot delete system collection/);
    });

    it('should be idempotent when registering system collections across multiple calls', () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8111 });

      const col1 = app.schema.registerSystemCollection({
        name: '_idempotent_test',
        schema: [{ id: 'f1', name: 'col1', type: 'text' }],
      });

      // Second registration should succeed gracefully and return existing or synced
      const col2 = app.schema.registerSystemCollection({
        name: '_idempotent_test',
        schema: [
          { id: 'f1', name: 'col1', type: 'text' },
          { id: 'f2', name: 'col2', type: 'text' },
        ],
      });

      expect(col1.id).toBe(col2.id);
      expect(col2.system).toBe(true);
    });
  });

  describe('5. Admin UI Navigation Items & Container TOKENS Integration', () => {
    it('should register Admin UI navigation items and expose them via /api/plugins and /api/admin/nav-items', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8112 });

      const uiPlugin: INodeStackPlugin = {
        name: 'metrics-dashboard',
        version: '1.2.0',
        description: 'Advanced telemetry dashboard',
        adminNavItems: [
          {
            id: 'telemetry-dashboard',
            title: 'Live Telemetry',
            badge: 'PRO',
            badgeVariant: 'warning',
            view: {
              title: 'Live Telemetry Stream',
              description: 'Realtime CPU, memory and event loop lag telemetry',
            },
          },
        ],
      };

      app.use(uiPlugin);

      // Verify AdminUIService internal registry
      const navItems = app.adminUi.getNavItems();
      expect(navItems.some((n) => n.id === 'telemetry-dashboard')).toBe(true);

      // Verify HTTP API endpoints
      const resNav = await app.server.inject({
        method: 'GET',
        url: '/api/admin/nav-items',
      });
      expect(resNav.statusCode).toBe(200);
      const navData = resNav.json();
      expect(navData.items.some((i: any) => i.id === 'telemetry-dashboard')).toBe(true);

      const resPlugins = await app.server.inject({
        method: 'GET',
        url: '/api/plugins',
      });
      expect(resPlugins.statusCode).toBe(200);
      const pluginData = resPlugins.json();
      expect(pluginData.plugins.some((p: any) => p.name === 'metrics-dashboard')).toBe(true);
      expect(pluginData.navItems.some((n: any) => n.id === 'telemetry-dashboard')).toBe(true);

      // Verify Admin UI HTML contains script injection
      const html = app.adminUi.getHtml();
      expect(html).toContain('window.__NODESTACK_NAV_ITEMS__');
      expect(html).toContain('telemetry-dashboard');
    });

    it('should allow plugins to access container, retrieve services, and bind new services', () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8113 });

      const customServiceToken = Symbol('CustomTelemetryService');
      class CustomTelemetryService {
        public getStatus() {
          return 'ALL_SYSTEMS_GO';
        }
      }

      const diPlugin: INodeStackPlugin = {
        name: 'di-plugin',
        register(ctx) {
          // Verify existing core services are accessible via Container & TOKENS
          const db = ctx.getService(ctx.tokens.DatabaseService);
          const config = ctx.getService(ctx.tokens.ConfigService);
          expect(db).toBe(app.db);
          expect(config).toBe(app.config);

          // Bind custom service into Container
          ctx.bindService(customServiceToken, new CustomTelemetryService());
        },
      };

      app.use(diPlugin);

      const resolved = app.container.get<CustomTelemetryService>(customServiceToken);
      expect(resolved).toBeDefined();
      expect(resolved.getStatus()).toBe('ALL_SYSTEMS_GO');
    });
  });

  describe('6. Official Community Extension: Stripe Plugin', () => {
    it('should register Stripe collections, webhook handler, and checkout session endpoint', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8114 });

      app.use(
        stripePlugin({
          secretKey: 'sk_test_mock_1234567890abcdef',
          currency: 'usd',
        })
      );

      // Verify collections were created
      expect(app.schema.getCollection('_stripe_customers')).toBeDefined();
      expect(app.schema.getCollection('_stripe_payments')).toBeDefined();

      // Test status route
      const resStatus = await app.server.inject({
        method: 'GET',
        url: '/api/stripe/status',
      });
      expect(resStatus.statusCode).toBe(200);
      expect(resStatus.json()).toMatchObject({
        enabled: true,
        testMode: true,
        currency: 'usd',
        customersCollection: '_stripe_customers',
      });

      // Test checkout session creation
      const resCheckout = await app.server.inject({
        method: 'POST',
        url: '/api/stripe/checkout-session',
        payload: {
          email: 'buyer@example.com',
          amount: 4900,
        },
      });
      expect(resCheckout.statusCode).toBe(201);
      const checkoutData = resCheckout.json();
      expect(checkoutData.id).toMatch(/^cs_test_/);
      expect(checkoutData.url).toContain('https://checkout.stripe.com/pay/');

      // Test Stripe webhook endpoint
      let webhookEventReceived: any = null;
      app.eventBus.on('stripe:webhook', (data) => {
        webhookEventReceived = data;
      });

      const resWebhook = await app.server.inject({
        method: 'POST',
        url: '/api/stripe/webhook',
        payload: {
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: 'pi_test_987654321',
              amount: 4900,
              currency: 'usd',
              customer: 'cus_12345',
            },
          },
        },
      });
      expect(resWebhook.statusCode).toBe(200);
      expect(resWebhook.json()).toEqual({ received: true, event: 'payment_intent.succeeded' });
      expect(webhookEventReceived).toBeDefined();
      expect(webhookEventReceived.type).toBe('payment_intent.succeeded');

      // Verify payment was recorded in _stripe_payments
      const payments = await app.records.getList('_stripe_payments', {
        filter: 'paymentIntentId = "pi_test_987654321"',
      });
      expect(payments.items.length).toBe(1);
      expect(payments.items[0].amount).toBe(4900);
      expect(payments.items[0].status).toBe('succeeded');
    });
  });

  describe('7. Official Community Extension: S3 Cloud Storage Plugin', () => {
    it('should register S3 uploads collection, status route, and presigned upload URL generator', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8115 });

      app.use(
        s3StoragePlugin({
          bucket: 'nodestack-assets-bucket',
          region: 'us-east-1',
        })
      );

      // Verify collection created
      expect(app.schema.getCollection('_s3_uploads')).toBeDefined();

      // Test status route
      const resStatus = await app.server.inject({
        method: 'GET',
        url: '/api/s3/status',
      });
      expect(resStatus.statusCode).toBe(200);
      expect(resStatus.json()).toMatchObject({
        bucket: 'nodestack-assets-bucket',
        region: 'us-east-1',
        connected: true,
      });

      // Verify unauthenticated request is rejected with 403
      const resUnauth = await app.server.inject({
        method: 'POST',
        url: '/api/s3/sign-upload-url',
        payload: { filename: 'avatar.png' },
      });
      expect(resUnauth.statusCode).toBe(403);

      // Authenticate admin
      await app.auth.createAdmin('admin@nodestack.io', 'Password123!');
      const { token: adminToken } = await app.auth.authenticateAdmin('admin@nodestack.io', 'Password123!');

      // Test presigned URL generation with admin auth
      const resSign = await app.server.inject({
        method: 'POST',
        url: '/api/s3/sign-upload-url',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          filename: 'avatar.png',
          mimeType: 'image/png',
        },
      });
      expect(resSign.statusCode).toBe(200);
      const signData = resSign.json();
      expect(signData.uploadUrl).toContain('nodestack-assets-bucket.s3.us-east-1.amazonaws.com');
      expect(signData.key).toContain('avatar');
      expect(signData.bucket).toBe('nodestack-assets-bucket');

      // Verify record tracked in _s3_uploads
      const uploads = await app.records.getList('_s3_uploads');
      expect(uploads.items.length).toBe(1);
      expect(uploads.items[0].bucket).toBe('nodestack-assets-bucket');
    });
  });

  describe('8. Official Community Extension: Resend Email Plugin', () => {
    it('should register email logs collection and send transactional email', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8116 });

      app.use(
        resendPlugin({
          apiKey: 're_test_1234567890',
          from: 'notifications@nodestack.io',
        })
      );

      expect(app.schema.getCollection('_email_logs')).toBeDefined();

      let emailSentEvent: any = null;
      app.eventBus.on('email:sent', (data) => {
        emailSentEvent = data;
      });

      // Verify unauthenticated send request is rejected with 403
      const resUnauth = await app.server.inject({
        method: 'POST',
        url: '/api/resend/send',
        payload: {
          to: 'customer@example.com',
          subject: 'Welcome to NodeStack!',
        },
      });
      expect(resUnauth.statusCode).toBe(403);

      // Authenticate admin
      await app.auth.createAdmin('admin@nodestack.io', 'Password123!');
      const { token: adminToken } = await app.auth.authenticateAdmin('admin@nodestack.io', 'Password123!');

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/resend/send',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          to: 'customer@example.com',
          subject: 'Welcome to NodeStack!',
        },
      });

      expect(res.statusCode).toBe(200);
      const sent = res.json();
      expect(sent.to).toBe('customer@example.com');
      expect(sent.from).toBe('notifications@nodestack.io');
      expect(sent.status).toBe('delivered');
      expect(emailSentEvent).toBeDefined();

      // Check database log
      const logs = await app.records.getList('_email_logs');
      expect(logs.items.length).toBe(1);
      expect(logs.items[0].to).toBe('customer@example.com');
      expect(logs.items[0].subject).toBe('Welcome to NodeStack!');
    });
  });

  describe('9. Official Community Extension: Discord/Slack Webhooks Plugin', () => {
    it('should fire webhook notifications on database record mutations', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8117 });

      app.schema.createCollection({
        name: 'support_tickets',
        type: 'base',
        schema: [
          { id: 'f_title', name: 'title', type: 'text', required: true },
          { id: 'f_priority', name: 'priority', type: 'text', required: true },
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
      });

      app.use(
        webhookPlugin({
          discordWebhookUrl: 'https://discord.com/api/webhooks/mock/123',
          collections: ['support_tickets'],
        })
      );

      expect(app.schema.getCollection('_webhook_logs')).toBeDefined();

      // Create a ticket which should trigger the afterCreate hook
      await app.records.create('support_tickets', {
        title: 'Server connection timeout',
        priority: 'high',
      });

      // Verify webhook log created
      const logs = await app.records.getList('_webhook_logs');
      expect(logs.items.length).toBe(1);
      expect(logs.items[0].platform).toBe('discord');
      expect(logs.items[0].collection).toBe('support_tickets');
      expect(logs.items[0].event).toBe('record:created');
    });
  });

  describe('10. Official Community Extension: Algolia Search Sync Plugin', () => {
    it('should queue search index mutations on record changes', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8118 });

      app.schema.createCollection({
        name: 'products',
        type: 'base',
        schema: [
          { id: 'f_name', name: 'name', type: 'text', required: true },
          { id: 'f_price', name: 'price', type: 'number', required: true },
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
      });

      const capturedRequests: Array<{ url: string; method: string; headers: any; body: any }> = [];
      const mockFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedRequests.push({
          url,
          method: init.method,
          headers: init.headers,
          body: init.body ? JSON.parse(init.body) : undefined,
        });
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ taskID: 98765, objectID: 'mock' }),
          text: async () => '',
        };
      });

      app.use(
        algoliaPlugin({
          appId: 'ALGOLIA_APP_ID',
          apiKey: 'ALGOLIA_API_KEY',
          collections: ['products'],
          fetch: mockFetch as any,
        })
      );

      expect(app.schema.getCollection('_algolia_sync_queue')).toBeDefined();

      const product = await app.records.create('products', {
        name: 'Mechanical Keyboard RGB',
        price: 129,
      });

      // 1. Verify mutation hook called Algolia client with apiKey and payload
      expect(capturedRequests.length).toBe(1);
      expect(capturedRequests[0].url).toContain('ALGOLIA_APP_ID-dsn.algolia.net/1/indexes/nodestack_products');
      expect(capturedRequests[0].method).toBe('PUT');
      expect(capturedRequests[0].headers['X-Algolia-Application-Id']).toBe('ALGOLIA_APP_ID');
      expect(capturedRequests[0].headers['X-Algolia-API-Key']).toBe('ALGOLIA_API_KEY');
      expect(capturedRequests[0].body.name).toBe('Mechanical Keyboard RGB');
      expect(capturedRequests[0].body.objectID).toBe(product.id);

      // 2. Verify durable queue record created and marked synced
      const queue = await app.records.getList('_algolia_sync_queue');
      expect(queue.items.length).toBe(1);
      expect(queue.items[0].collection).toBe('products');
      expect(queue.items[0].objectId).toBe(product.id);
      expect(queue.items[0].operation).toBe('save');
      expect(queue.items[0].status).toBe('synced');
      expect(queue.items[0].taskId).toBe('98765');

      // 3. Verify unauthenticated reindex request is rejected with 403
      const resUnauth = await app.server.inject({
        method: 'POST',
        url: '/api/algolia/reindex',
        payload: { collection: 'products' },
      });
      expect(resUnauth.statusCode).toBe(403);

      // Authenticate admin
      await app.auth.createAdmin('admin@nodestack.io', 'Password123!');
      const { token: adminToken } = await app.auth.authenticateAdmin('admin@nodestack.io', 'Password123!');

      // 4. Test reindex endpoint with admin auth - verifies batch submission to Algolia
      const resReindex = await app.server.inject({
        method: 'POST',
        url: '/api/algolia/reindex',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { collection: 'products' },
      });
      expect(resReindex.statusCode).toBe(200);
      expect(resReindex.json().recordsQueued).toBe(1);
      expect(resReindex.json().recordsSynced).toBe(1);

      // Verify Algolia batch endpoint was invoked
      expect(capturedRequests.length).toBe(2);
      expect(capturedRequests[1].url).toContain('ALGOLIA_APP_ID-dsn.algolia.net/1/indexes/nodestack_products/batch');
      expect(capturedRequests[1].method).toBe('POST');
      expect(capturedRequests[1].headers['X-Algolia-API-Key']).toBe('ALGOLIA_API_KEY');
      expect(capturedRequests[1].body.requests[0].action).toBe('updateObject');
      expect(capturedRequests[1].body.requests[0].body.name).toBe('Mechanical Keyboard RGB');

      // 5. Test durable queue consumer / process-queue endpoint
      const resProcess = await app.server.inject({
        method: 'POST',
        url: '/api/algolia/process-queue',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(resProcess.statusCode).toBe(200);
      expect(resProcess.json().success).toBe(true);
    });
  });

  describe('11. Workspace Package Exports under packages/plugins/* (s3, stripe, resend, etc.)', () => {
    it('should allow importing plugins from packages/plugins/s3 and sibling packages', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8119 });

      // Using imports from packages/plugins/s3 and packages/plugins/*
      app.use(workspaceStripePlugin({ secretKey: 'sk_test_workspace_stripe' }));
      app.use(workspaceS3Plugin({ bucket: 'workspace-s3-bucket', region: 'eu-west-1' }));
      app.use(workspaceResendPlugin({ apiKey: 're_test_workspace' }));
      app.use(workspaceWebhookPlugin({ discordWebhookUrl: 'https://discord.mock' }));
      app.use(workspaceAlgoliaPlugin({ appId: 'MOCK_ID', apiKey: 'MOCK_KEY', collections: [] }));

      expect(app.hasPlugin('stripe')).toBe(true);
      expect(app.hasPlugin('s3-storage')).toBe(true);
      expect(app.hasPlugin('resend')).toBe(true);
      expect(app.hasPlugin('webhooks')).toBe(true);
      expect(app.hasPlugin('algolia')).toBe(true);

      const stripeStatus = await app.server.inject({ method: 'GET', url: '/api/stripe/status' });
      expect(stripeStatus.statusCode).toBe(200);
      expect(stripeStatus.json().testMode).toBe(true);

      const s3Status = await app.server.inject({ method: 'GET', url: '/api/s3/status' });
      expect(s3Status.statusCode).toBe(200);
      expect(s3Status.json().region).toBe('eu-west-1');
      expect(s3Status.json().bucket).toBe('workspace-s3-bucket');

      const resendStatus = await app.server.inject({ method: 'GET', url: '/api/resend/status' });
      expect(resendStatus.statusCode).toBe(200);
      expect(resendStatus.json().configured).toBe(true);
    });
  });

  describe('12. Admin UI DOM Interactions & Navigation for Plugins', () => {
    it('should render plugin navigation items in sidebar and mount custom plugin views', async () => {
      const { JSDOM } = await import('jsdom');
      const { AdminUIBundler } = await import('../src/admin/AdminUIBundler');
      const uiDir = path.resolve(__dirname, '../src/admin/ui');
      const bundledHtml = AdminUIBundler.bundle(uiDir);

      const dom = new JSDOM(bundledHtml, {
        url: 'http://localhost:8090/_/',
        runScripts: 'dangerously',
        beforeParse(window: any) {
          window.fetch = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('/api/admins/has-admins')) {
              return { ok: true, json: async () => ({ hasAdmins: true }) };
            }
            if (url.includes('/api/plugins')) {
              return {
                ok: true,
                json: async () => ({
                  plugins: [{ name: 'stripe', version: '1.0.0' }],
                  navItems: [
                    {
                      id: 'stripe',
                      title: 'Stripe Payments',
                      badge: 'TEST MODE',
                      badgeVariant: 'warning',
                      view: {
                        title: 'Stripe Payments Extension',
                        description: 'Manage test payments',
                      },
                    },
                  ],
                }),
              };
            }
            return { ok: true, json: async () => ({ items: [] }) };
          });
        },
      });

      try {
        const win = dom.window as any;
        const doc = win.document;

        // Simulate registered plugin items in window state
        win.state.pluginNavItems = [
          {
            id: 'stripe',
            title: 'Stripe Payments',
            badge: 'TEST MODE',
            badgeVariant: 'warning',
            view: {
              title: 'Stripe Payments Extension',
              description: 'Manage test payments and webhooks',
            },
          },
        ];

        // 1. Render plugin navigation items
        win.renderPluginNavItems();

        const pluginsGroup = doc.getElementById('sidebar-plugins-group');
        expect(pluginsGroup).not.toBeNull();
        expect(pluginsGroup.style.display).toBe('flex');

        const stripeNavItem = doc.getElementById('nav-stripe');
        expect(stripeNavItem).not.toBeNull();
        expect(stripeNavItem.textContent).toContain('Stripe Payments');
        expect(stripeNavItem.textContent).toContain('TEST MODE');

        // 2. Select plugin navigation item
        await win.selectNav('stripe');

        expect(win.state.activeNav).toBe('stripe');
        expect(stripeNavItem.classList.contains('active')).toBe(true);

        const titleEl = doc.getElementById('view-title');
        expect(titleEl.textContent).toBe('Stripe Payments');

        const badgeEl = doc.getElementById('view-badge');
        expect(badgeEl.textContent).toBe('TEST MODE');
        expect(badgeEl.style.display).toBe('inline-block');

        const mainBody = doc.getElementById('main-body');
        expect(mainBody.innerHTML).toContain('Stripe Payments Extension');
        expect(mainBody.innerHTML).toContain('Plugin ID');
        expect(mainBody.innerHTML).toContain('stripe');

        // 3. Verify breadcrumbs
        const breadcrumbs = doc.getElementById('breadcrumb-trail');
        expect(breadcrumbs.textContent).toContain('Dashboard');
        expect(breadcrumbs.textContent).toContain('Plugins');
        expect(breadcrumbs.textContent).toContain('Stripe Payments');

        // 4. Verify Command Palette indexing
        const paletteItems = win.filterCommandPaletteItems('stripe');
        expect(paletteItems.some((item: any) => item.id === 'plugin-stripe')).toBe(true);
        expect(paletteItems.find((item: any) => item.id === 'plugin-stripe').category).toBe('Plugins');
      } finally {
        dom.window.close();
      }
    });

    it('should safely serialize plugin data and prevent </script> tag breakouts and XSS in getHtml()', () => {
      const adminUi = new AdminUIService();
      adminUi.registerPluginMeta({
        name: 'malicious-plugin',
        description: '</script><script>alert("xss")</script>',
      });
      adminUi.registerNavItem({
        id: 'exploit',
        title: '<img src=x onerror=alert(1)> & "quotes"',
      });

      const html = adminUi.getHtml();
      // Ensure raw </script> is never present inside the injected JSON payload
      expect(html).not.toContain('</script><script>alert("xss")</script>');
      expect(html).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(\\"xss\\")\\u003c/script\\u003e');
      expect(html).toContain('\\u0026');

      // Test serializeForScript helper directly
      const serialized = AdminUIService.serializeForScript({
        desc: '</script><script>alert(1)</script>',
        icon: '<svg>&</svg>',
      });
      expect(serialized).not.toContain('</script>');
      expect(serialized).not.toContain('<svg>');
      expect(serialized).toContain('\\u003c/script\\u003e');
      expect(serialized).toContain('\\u0026');
    });
  });
});
