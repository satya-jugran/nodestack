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
  StripeService,
  s3StoragePlugin,
  S3StorageService,
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

    it('should reject duplicate plugin registrations and prevent duplicate side effects or leaked instances', () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8103 });

      const pluginA: INodeStackPlugin = {
        name: 'my-singleton-plugin',
        version: '1.0.0',
      };

      app.use(pluginA);
      expect(app.hasPlugin('my-singleton-plugin')).toBe(true);

      // Re-registering same plugin instance must throw
      expect(() => {
        app.use(pluginA);
      }).toThrow(/Plugin "my-singleton-plugin" is already registered/);

      // Registering a different plugin with same name must throw
      expect(() => {
        app.use({
          name: 'my-singleton-plugin',
          version: '2.0.0',
        });
      }).toThrow(/Plugin "my-singleton-plugin" is already registered/);

      // Registering the same function plugin twice must throw
      const fnPlugin = (ctx: NodeStackPluginContext) => {};
      app.use(fnPlugin);
      expect(() => {
        app.use(fnPlugin);
      }).toThrow(/already registered/);
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

    it('should correctly dispatch dynamic routes registered after app.start() (post-boot Fastify and 1-click enable)', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8188 });
      await app.auth.createAdmin('bootadmin@nodestack.io', 'Password123!');
      const { token } = await app.auth.authenticateAdmin('bootadmin@nodestack.io', 'Password123!');

      // Start the server so Fastify completes its boot lifecycle
      await app.start();

      // Verify unhandled route returns 404 initially
      const resInitial404 = await app.server.inject({ method: 'GET', url: '/api/postboot/user/42' });
      expect(resInitial404.statusCode).toBe(404);

      // 1. Register a custom plugin AFTER boot
      const postBootPlugin: INodeStackPlugin = {
        name: 'post-boot-plugin',
        routes: [
          {
            method: 'GET',
            path: '/api/postboot/user/:id',
            handler: async (req, reply) => {
              const id = (req.params as any)?.id;
              return reply.status(200).send({ ok: true, userId: id });
            },
          },
        ],
        register(ctx) {
          ctx.registerRoute('POST', '/api/postboot/action', async (req, reply) => {
            return reply.status(201).send({ created: true, body: req.body });
          });
        },
      };

      app.use(postBootPlugin);

      // Verify dynamic route with params is resolved
      const resDynamicGet = await app.server.inject({ method: 'GET', url: '/api/postboot/user/42' });
      expect(resDynamicGet.statusCode).toBe(200);
      expect(resDynamicGet.json()).toEqual({ ok: true, userId: '42' });

      // Verify dynamic POST route is resolved
      const resDynamicPost = await app.server.inject({
        method: 'POST',
        url: '/api/postboot/action',
        payload: { greeting: 'hello from post-boot' },
      });
      expect(resDynamicPost.statusCode).toBe(201);
      expect(resDynamicPost.json()).toEqual({ created: true, body: { greeting: 'hello from post-boot' } });

      // 2. 1-Click Enable an official plugin (stripe) while server is already booted
      const resEnable = await app.server.inject({
        method: 'POST',
        url: '/api/plugins/stripe/enable',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(resEnable.statusCode).toBe(200);
      expect(resEnable.json().success).toBe(true);

      // The stripe plugin route must respond with 200 via dynamic router (not fall through to 404)
      const resStripeStatus = await app.server.inject({ method: 'GET', url: '/api/stripe/status' });
      expect(resStripeStatus.statusCode).toBe(200);
      expect(resStripeStatus.json().currency).toBe('usd');

      // 3. Disable official plugin: route should no longer be active (returns 404)
      const resDisable = await app.server.inject({
        method: 'POST',
        url: '/api/plugins/stripe/disable',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(resDisable.statusCode).toBe(200);

      const resStripeDisabled = await app.server.inject({ method: 'GET', url: '/api/stripe/status' });
      expect(resStripeDisabled.statusCode).toBe(404);
    });

    it('should preserve full route lifecycle (preParsing, preValidation, preSerialization, onSend, onResponse, onError) and capture rawBody on runtime routes', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8189 });
      await app.start();

      let preValidationRan = false;
      let onSendRan = false;
      let onResponseRan = false;
      let onErrorRan = false;

      const lifecyclePlugin: INodeStackPlugin = {
        name: 'lifecycle-plugin',
        register(ctx) {
          ctx.registerRoute(
            'POST',
            '/api/lifecycle/test',
            async (req, reply) => {
              expect((req as any).rawBody).toBe('{"value":123}');
              return { echo: (req.body as any).value };
            },
            {
              preValidation: async (req: any, reply: any) => {
                preValidationRan = true;
              },
              preSerialization: async (req: any, reply: any, payload: any) => {
                return { ...payload, transformed: true };
              },
              onSend: async (req: any, reply: any, payload: any) => {
                onSendRan = true;
                return payload;
              },
              onResponse: async (req: any, reply: any) => {
                onResponseRan = true;
              },
            }
          );

          ctx.registerRoute(
            'GET',
            '/api/lifecycle/error',
            async () => {
              throw new Error('Boom in dynamic route');
            },
            {
              onError: async (req: any, reply: any, err: any) => {
                onErrorRan = true;
              },
            }
          );
        },
      };

      app.use(lifecyclePlugin);

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/lifecycle/test',
        headers: { 'content-type': 'application/json' },
        payload: '{"value":123}',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ echo: 123, transformed: true });
      expect(preValidationRan).toBe(true);
      expect(onSendRan).toBe(true);
      expect(onResponseRan).toBe(true);

      const resError = await app.server.inject({
        method: 'GET',
        url: '/api/lifecycle/error',
      });
      expect(resError.statusCode).toBe(500);
      expect(onErrorRan).toBe(true);
    });

    it('should allow post-startup Stripe plugin to correctly validate webhook signatures via captured rawBody', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8190 });
      await app.start();

      const webhookSecret = 'whsec_postboot_test_secret_987654321';
      const stripePlg = stripePlugin({
        secretKey: 'sk_test_mock_secret_key',
        webhookSecret,
      });

      // Register Stripe plugin AFTER server has booted
      app.use(stripePlg);

      const stripeService = new StripeService({
        secretKey: 'sk_test_mock_secret_key',
        webhookSecret,
      });

      // Raw payload containing whitespace, tabs, and indentation
      const formattedRawPayload = JSON.stringify(
        {
          id: 'evt_post_boot_test',
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: 'pi_postboot_123',
              amount: 5000,
              currency: 'usd',
            },
          },
        },
        null,
        2
      );

      // (a) Invalid signature -> 400
      const resBad = await app.server.inject({
        method: 'POST',
        url: '/api/stripe/webhook',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 't=12345,v1=bad_signature_attempt',
        },
        payload: formattedRawPayload,
      });
      expect(resBad.statusCode).toBe(400);
      expect(resBad.json().message).toContain('Invalid stripe webhook signature');

      // (b) Valid signature calculated over formattedRawPayload -> 200
      const validSig = stripeService.generateWebhookSignature(formattedRawPayload, webhookSecret);
      const resGood = await app.server.inject({
        method: 'POST',
        url: '/api/stripe/webhook',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': validSig,
        },
        payload: formattedRawPayload,
      });
      expect(resGood.statusCode).toBe(200);
      expect(resGood.json()).toEqual({ received: true, event: 'payment_intent.succeeded' });
    });

    it('should explicitly reject unsupported options (e.g. constraints) for runtime routes', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8191 });
      await app.start();

      expect(() => {
        app.use({
          name: 'invalid-options-plugin',
          register(ctx) {
            ctx.registerRoute(
              'GET',
              '/api/unsupported-options',
              async () => ({ ok: true }),
              { constraints: { version: '1.0.0' } } as any
            );
          },
        });
      }).toThrow(/Unsupported route option\(s\) \[constraints\] for runtime route/);
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

    it('should reject registering a system collection if an existing non-system collection has the same name', () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8111 });

      // Create a normal application collection (e.g. orders)
      const userCol = app.schema.createCollection({
        name: 'orders',
        type: 'base',
        schema: [{ id: 'f_total', name: 'total', type: 'number' }],
      });
      expect(userCol.system).toBe(false);

      // Attempt to register a system collection with the colliding name 'orders'
      expect(() => {
        app.schema.registerSystemCollection({
          name: 'orders',
          type: 'base',
          schema: [{ id: 'f_injected', name: 'injected_field', type: 'text' }],
        });
      }).toThrow(/Cannot register system collection 'orders': a non-system collection with this name already exists/);

      // Ensure the existing collection is untouched and non-system
      const fetched = app.schema.getCollection('orders');
      expect(fetched).toBeDefined();
      expect(fetched!.system).toBe(false);
      expect(fetched!.schema.some((f) => f.name === 'injected_field')).toBe(false);
      expect(fetched!.schema.some((f) => f.name === 'total')).toBe(true);

      // Also ensure plugin registration fails fast when a declarative collection collides with a user collection
      const collidingPlugin: INodeStackPlugin = {
        name: 'colliding-plugin',
        version: '1.0.0',
        collections: [
          {
            name: 'orders',
            type: 'base',
            schema: [{ id: 'f_bad', name: 'bad_field', type: 'text' }],
          },
        ],
      };

      expect(() => {
        app.use(collidingPlugin);
      }).toThrow(/Cannot register system collection 'orders'/);
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

      // Verify Admin UI HTML includes the in-context Plugin Tester Drawer
      expect(html).toContain('openPluginTesterDrawer');
      expect(html).toContain('plugin-drawer');
      expect(html).toContain('Test Plugin');
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

      const capturedStripeRequests: Array<{ url: string; method: string; headers: any; body: string }> = [];
      let shouldStripeFail = false;

      const mockStripeFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedStripeRequests.push({
          url,
          method: init.method,
          headers: init.headers,
          body: init.body,
        });

        if (shouldStripeFail) {
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            json: async () => ({
              error: {
                message: 'Invalid currency: xyz',
                type: 'invalid_request_error',
              },
            }),
            text: async () => '',
          };
        }

        const isLive = init.headers['Authorization']?.includes('sk_live_');
        const id = isLive ? 'cs_live_real_live_session_12345' : 'cs_test_real_test_session_12345';

        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            id,
            object: 'checkout.session',
            url: `https://checkout.stripe.com/c/pay/${id}`,
            amount_total: 4900,
            currency: 'usd',
            customer_email: 'buyer@example.com',
            status: 'open',
            livemode: isLive,
          }),
          text: async () => '',
        };
      });

      app.use(
        stripePlugin({
          secretKey: 'sk_test_mock_1234567890abcdef',
          currency: 'usd',
          fetch: mockStripeFetch as any,
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

      // 1. Test checkout session creation via Stripe API (test mode)
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
      expect(checkoutData.id).toBe('cs_test_real_test_session_12345');
      expect(checkoutData.url).toContain('https://checkout.stripe.com/c/pay/cs_test_real_test_session_12345');
      expect(checkoutData.amount).toBe(4900);
      expect(checkoutData.livemode).toBe(false);

      // Verify outbound HTTP request sent to Stripe API
      expect(capturedStripeRequests.length).toBe(1);
      expect(capturedStripeRequests[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
      expect(capturedStripeRequests[0].method).toBe('POST');
      expect(capturedStripeRequests[0].headers['Authorization']).toBe('Bearer sk_test_mock_1234567890abcdef');
      expect(capturedStripeRequests[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(capturedStripeRequests[0].body).toContain('customer_email=buyer%40example.com');
      expect(capturedStripeRequests[0].body).toContain('line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=4900');

      // 2. Verify live-mode key produces live session (cs_live_)
      const liveInstance = new StripeService({
        secretKey: 'sk_live_production_key_12345',
        fetch: mockStripeFetch as any,
      });
      expect(liveInstance.isTestMode()).toBe(false);
      const liveSession = await liveInstance.createCheckoutSession({
        email: 'vip@example.com',
        amount: 9900,
      });
      expect(liveSession.id).toMatch(/^cs_live_/);
      expect(liveSession.livemode).toBe(true);

      // 3. Verify Stripe API error response handling
      shouldStripeFail = true;
      const resError = await app.server.inject({
        method: 'POST',
        url: '/api/stripe/checkout-session',
        payload: {
          email: 'error@example.com',
          amount: 100,
        },
      });
      expect(resError.statusCode).toBe(400);
      expect(resError.json().message).toContain('Invalid currency: xyz');

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

      // 4. Verify webhookSecret signature enforcement:
      // Configure Stripe plugin with a webhookSecret
      const securedApp = new NodeStack({ dataDir: path.resolve(testDataDir, 'secured_stripe'), port: 8125 });
      const webhookSecret = 'whsec_test_secret_for_signature_verification_123';
      const securedStripePlugin = stripePlugin({
        secretKey: 'sk_test_mock_1234567890abcdef',
        webhookSecret,
        fetch: mockStripeFetch as any,
      });
      securedApp.use(securedStripePlugin);

      const securedStripeService = new StripeService({
        secretKey: 'sk_test_mock_1234567890abcdef',
        webhookSecret,
      });

      let securedWebhookReceived = false;
      securedApp.eventBus.on('stripe:webhook', () => {
        securedWebhookReceived = true;
      });

      const webhookPayloadObj = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_forged_attempt',
            amount: 7500,
            currency: 'usd',
            customer: 'cus_forged',
          },
        },
      };
      const rawPayload = JSON.stringify(webhookPayloadObj);

      // (a) Missing signature header -> 400
      const resMissingSig = await securedApp.server.inject({
        method: 'POST',
        url: '/api/stripe/webhook',
        headers: { 'content-type': 'application/json' },
        payload: rawPayload,
      });
      expect(resMissingSig.statusCode).toBe(400);
      expect(resMissingSig.json().message).toContain('Missing stripe-signature header');
      expect(securedWebhookReceived).toBe(false);

      // (b) Invalid signature -> 400
      const resBadSig = await securedApp.server.inject({
        method: 'POST',
        url: '/api/stripe/webhook',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=bad_forged_hex_signature_abcdef`,
        },
        payload: rawPayload,
      });
      expect(resBadSig.statusCode).toBe(400);
      expect(resBadSig.json().message).toContain('Invalid stripe webhook signature');
      expect(securedWebhookReceived).toBe(false);

      // Verify forged payment was NOT recorded
      const forgedPayments = await securedApp.records.getList('_stripe_payments', {
        filter: 'paymentIntentId = "pi_test_forged_attempt"',
      });
      expect(forgedPayments.items.length).toBe(0);

      // (c) Valid signature -> 200 & recorded
      const validSignature = securedStripeService.generateWebhookSignature(rawPayload, webhookSecret);
      const resValidSig = await securedApp.server.inject({
        method: 'POST',
        url: '/api/stripe/webhook',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': validSignature,
        },
        payload: rawPayload,
      });
      expect(resValidSig.statusCode).toBe(200);
      expect(resValidSig.json()).toEqual({ received: true, event: 'payment_intent.succeeded' });
      expect(securedWebhookReceived).toBe(true);

      const verifiedPayments = await securedApp.records.getList('_stripe_payments', {
        filter: 'paymentIntentId = "pi_test_forged_attempt"',
      });
      expect(verifiedPayments.items.length).toBe(1);
      expect(verifiedPayments.items[0].amount).toBe(7500);

      await securedApp.stop();
    });

    it('should report configured: false and badge UNCONFIGURED when Stripe is unconfigured', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8140 });
      app.use(stripePlugin());

      // 1. Status route returns configured: false and testMode: false
      const statusRes = await app.server.inject({ method: 'GET', url: '/api/stripe/status' });
      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json().configured).toBe(false);
      expect(statusRes.json().testMode).toBe(false);
      expect(statusRes.json().liveMode).toBe(false);

      // 2. Nav item reflects UNCONFIGURED badge and warning variant
      const navItem = app.adminUi.getNavItems().find((item) => item.id === 'stripe');
      expect(navItem).toBeDefined();
      expect(navItem?.badge).toBe('UNCONFIGURED');
      expect(navItem?.badgeVariant).toBe('warning');

      // 3. Checkout session rejected with HTTP 400 configuration error
      const checkoutRes = await app.server.inject({
        method: 'POST',
        url: '/api/stripe/checkout-session',
        payload: {
          email: 'buyer@example.com',
          amount: 4900,
        },
      });
      expect(checkoutRes.statusCode).toBe(400);
      expect(checkoutRes.json().message).toContain('Stripe Secret Key is not configured');
    });

    it('should report configured: true and badge TEST MODE in dryRun mode without secretKey', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8141 });
      app.use(stripePlugin({ dryRun: true }));

      const statusRes = await app.server.inject({ method: 'GET', url: '/api/stripe/status' });
      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json().configured).toBe(true);
      expect(statusRes.json().testMode).toBe(true);
      expect(statusRes.json().liveMode).toBe(false);

      const navItem = app.adminUi.getNavItems().find((item) => item.id === 'stripe');
      expect(navItem?.badge).toBe('TEST MODE');
      expect(navItem?.badgeVariant).toBe('warning');

      const checkoutRes = await app.server.inject({
        method: 'POST',
        url: '/api/stripe/checkout-session',
        payload: {
          email: 'buyer@example.com',
          amount: 4900,
        },
      });
      expect(checkoutRes.statusCode).toBe(201);
      expect(checkoutRes.json().id).toMatch(/^cs_test_/);
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

      // Verify SigV4 parameters in presigned upload URL
      const parsedUrl = new URL(signData.uploadUrl);
      expect(parsedUrl.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(parsedUrl.searchParams.get('X-Amz-Credential')).toContain('/us-east-1/s3/aws4_request');
      expect(parsedUrl.searchParams.get('X-Amz-Date')).toMatch(/^\d{8}T\d{6}Z$/);
      expect(parsedUrl.searchParams.get('X-Amz-Expires')).toBe('3600');
      expect(parsedUrl.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
      expect(parsedUrl.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);

      // Verify custom endpoint & forcePathStyle presigning (e.g. MinIO / LocalStack)
      const customS3 = s3StoragePlugin({
        bucket: 'minio-bucket',
        region: 'us-east-1',
        endpoint: 'http://localhost:9000',
        accessKeyId: 'MINIO_ACCESS_KEY',
        secretAccessKey: 'MINIO_SECRET_KEY',
        forcePathStyle: true,
      });
      const customPresigned = (customS3 as any).register ? undefined : null;
      const customService = new S3StorageService({
        bucket: 'minio-bucket',
        region: 'us-east-1',
        endpoint: 'http://localhost:9000',
        accessKeyId: 'MINIO_ACCESS_KEY',
        secretAccessKey: 'MINIO_SECRET_KEY',
        forcePathStyle: true,
      });
      const customSign = customService.getPresignedUploadUrl('test-doc.pdf', 'application/pdf');
      expect(customSign.uploadUrl).toContain('http://localhost:9000/minio-bucket/uploads/');
      const customParsed = new URL(customSign.uploadUrl);
      expect(customParsed.searchParams.get('X-Amz-Credential')).toContain('MINIO_ACCESS_KEY');
      expect(customParsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);

      // Verify forcePathStyle in getBucketEndpoint() & getObjectUrl()
      expect(customService.getBucketEndpoint()).toBe('http://localhost:9000/minio-bucket');
      expect(customService.getObjectUrl('test-doc.pdf')).toBe('http://localhost:9000/minio-bucket/test-doc.pdf');

      // (a) Custom endpoint with default (omitted) forcePathStyle defaults to path-style for compatibility
      const defaultMinioService = new S3StorageService({
        bucket: 'minio-bucket',
        region: 'us-east-1',
        endpoint: 'http://localhost:9000',
      });
      expect(defaultMinioService.getBucketEndpoint()).toBe('http://localhost:9000/minio-bucket');

      // (b) Custom endpoint with explicit forcePathStyle: false builds virtual-hosted URL
      const vhostService = new S3StorageService({
        bucket: 'minio-bucket',
        region: 'us-east-1',
        endpoint: 'http://localhost:9000',
        forcePathStyle: false,
      });
      expect(vhostService.getBucketEndpoint()).toBe('http://minio-bucket.localhost:9000');

      // (c) AWS provider with forcePathStyle: true builds path-style URL
      const awsPathStyleService = new S3StorageService({
        bucket: 'my-aws-bucket',
        region: 'eu-central-1',
        forcePathStyle: true,
      });
      expect(awsPathStyleService.getBucketEndpoint()).toBe('https://s3.eu-central-1.amazonaws.com/my-aws-bucket');

      // (d) AWS provider with default/false forcePathStyle builds virtual-hosted URL
      const awsVhostService = new S3StorageService({
        bucket: 'my-aws-bucket',
        region: 'eu-central-1',
      });
      expect(awsVhostService.getBucketEndpoint()).toBe('https://my-aws-bucket.s3.eu-central-1.amazonaws.com');
    });

    it('should reflect updated bucket and region consistently across status route, _s3_uploads rows, and admin UI view', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8129 });

      app.use(
        s3StoragePlugin({
          bucket: 'initial-s3-bucket',
          region: 'us-east-1',
        })
      );

      // Authenticate admin
      await app.auth.createAdmin('s3admin@nodestack.io', 'Password123!');
      const { token: adminToken } = await app.auth.authenticateAdmin('s3admin@nodestack.io', 'Password123!');

      // 1. Initial status reflects initial bucket
      let statusRes = await app.server.inject({ method: 'GET', url: '/api/s3/status' });
      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json().bucket).toBe('initial-s3-bucket');
      expect(statusRes.json().region).toBe('us-east-1');

      // Upload file under initial bucket
      let uploadRes = await app.server.inject({
        method: 'POST',
        url: '/api/s3/sign-upload-url',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { filename: 'first-file.png', mimeType: 'image/png' },
      });
      expect(uploadRes.statusCode).toBe(200);
      expect(uploadRes.json().uploadUrl).toContain('initial-s3-bucket.s3.us-east-1.amazonaws.com');

      let uploads = await app.records.getList('_s3_uploads');
      expect(uploads.items.length).toBe(1);
      expect(uploads.items[0].bucket).toBe('initial-s3-bucket');
      expect(uploads.items[0].url).toContain('initial-s3-bucket');

      // 2. Update bucket and region via Admin UI configuration update
      await app.pluginManager.updatePluginConfig('s3-storage', {
        bucket: 'production-assets-2026',
        region: 'eu-west-1',
      });

      // Status route must return new bucket and region
      statusRes = await app.server.inject({ method: 'GET', url: '/api/s3/status' });
      expect(statusRes.json().bucket).toBe('production-assets-2026');
      expect(statusRes.json().region).toBe('eu-west-1');

      // Upload file under updated bucket: presigned URL AND _s3_uploads row must both record new bucket!
      uploadRes = await app.server.inject({
        method: 'POST',
        url: '/api/s3/sign-upload-url',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { filename: 'second-file.png', mimeType: 'image/png' },
      });
      expect(uploadRes.statusCode).toBe(200);
      expect(uploadRes.json().uploadUrl).toContain('production-assets-2026.s3.eu-west-1.amazonaws.com');
      expect(uploadRes.json().bucket).toBe('production-assets-2026');

      uploads = await app.records.getList('_s3_uploads', { sort: 'created' });
      expect(uploads.items.length).toBe(2);
      expect(uploads.items[1].bucket).toBe('production-assets-2026');
      expect(uploads.items[1].url).toContain('production-assets-2026.s3.eu-west-1.amazonaws.com');

      // 3. Admin UI nav item view is updated with new bucket and region
      const navItemsRes = await app.server.inject({ method: 'GET', url: '/api/plugins' });
      const s3NavItem = navItemsRes.json().navItems.find((item: any) => item.id === 's3-storage');
      expect(s3NavItem).toBeDefined();
      expect(s3NavItem.badge).toBe('EU-WEST-1');
      expect(s3NavItem.view.description).toContain('production-assets-2026');
      expect(s3NavItem.view.description).toContain('eu-west-1');
      expect(s3NavItem.view.html).toContain('production-assets-2026');
    });

    it('should reject presigned upload URL and report unconfigured status with HTTP 400 when bucket is not configured', async () => {
      const origBucketEnv = process.env.S3_BUCKET;
      const origAwsBucketEnv = process.env.AWS_S3_BUCKET;
      delete process.env.S3_BUCKET;
      delete process.env.AWS_S3_BUCKET;

      try {
        app = new NodeStack({ dataDir: testDataDir, port: 8135 });
        app.use(s3StoragePlugin());

        // 1. Initial status returns 400 with configured: false
        const statusRes = await app.server.inject({ method: 'GET', url: '/api/s3/status' });
        expect(statusRes.statusCode).toBe(400);
        const statusBody = statusRes.json();
        expect(statusBody.configured).toBe(false);
        expect(statusBody.connected).toBe(false);
        expect(statusBody.message).toContain('not configured');

        // 2. Admin UI nav item reflects UNCONFIGURED badge and warning variant
        const navItemsRes = await app.server.inject({ method: 'GET', url: '/api/plugins' });
        const s3NavItem = navItemsRes.json().navItems.find((item: any) => item.id === 's3-storage');
        expect(s3NavItem).toBeDefined();
        expect(s3NavItem.badge).toBe('UNCONFIGURED');
        expect(s3NavItem.badgeVariant).toBe('warning');
        expect(s3NavItem.view.description).toContain('Unconfigured');

        // 3. Attempting to generate presigned upload URL returns 400 Bad Request
        await app.auth.createAdmin('s3unconfig@nodestack.io', 'Password123!');
        const { token: adminToken } = await app.auth.authenticateAdmin('s3unconfig@nodestack.io', 'Password123!');

        const signRes = await app.server.inject({
          method: 'POST',
          url: '/api/s3/sign-upload-url',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { filename: 'unconfigured-test.png', mimeType: 'image/png' },
        });
        expect(signRes.statusCode).toBe(400);
        expect(signRes.json().message).toContain('not configured');

        // 4. Update configuration with a valid bucket name enables the plugin
        await app.pluginManager.updatePluginConfig('s3-storage', {
          bucket: 'my-new-configured-bucket',
          region: 'ap-south-1',
        });

        const updatedStatusRes = await app.server.inject({ method: 'GET', url: '/api/s3/status' });
        expect(updatedStatusRes.statusCode).toBe(200);
        expect(updatedStatusRes.json().configured).toBe(true);
        expect(updatedStatusRes.json().connected).toBe(true);
        expect(updatedStatusRes.json().bucket).toBe('my-new-configured-bucket');

        const updatedSignRes = await app.server.inject({
          method: 'POST',
          url: '/api/s3/sign-upload-url',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { filename: 'success.png', mimeType: 'image/png' },
        });
        expect(updatedSignRes.statusCode).toBe(200);
        expect(updatedSignRes.json().uploadUrl).toContain('my-new-configured-bucket');
      } finally {
        if (origBucketEnv !== undefined) process.env.S3_BUCKET = origBucketEnv;
        if (origAwsBucketEnv !== undefined) process.env.AWS_S3_BUCKET = origAwsBucketEnv;
      }
    });
  });

  describe('8. Official Community Extension: Resend Email Plugin', () => {
    it('should register email logs collection and send transactional email', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8116 });

      const capturedResendRequests: Array<{ url: string; method: string; headers: any; body: any }> = [];
      let shouldFail = false;

      const mockResendFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedResendRequests.push({
          url,
          method: init.method,
          headers: init.headers,
          body: init.body ? JSON.parse(init.body) : undefined,
        });

        if (shouldFail) {
          return {
            ok: false,
            status: 422,
            statusText: 'Unprocessable Entity',
            json: async () => ({ statusCode: 422, message: 'Domain not verified on Resend' }),
            text: async () => 'Domain not verified on Resend',
          };
        }

        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ id: 're_msg_resend_12345' }),
          text: async () => '',
        };
      });

      app.use(
        resendPlugin({
          apiKey: 're_test_1234567890',
          from: 'notifications@nodestack.io',
          fetch: mockResendFetch as any,
        })
      );

      expect(app.schema.getCollection('_email_logs')).toBeDefined();

      let emailSentEvent: any = null;
      let emailFailedEvent: any = null;
      app.eventBus.on('email:sent', (data) => {
        emailSentEvent = data;
      });
      app.eventBus.on('email:failed', (data) => {
        emailFailedEvent = data;
      });

      // 1. Verify unauthenticated send request is rejected with 403
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

      // 2. Successful email send via Resend API
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
      expect(sent.id).toBe('re_msg_resend_12345');
      expect(emailSentEvent).toBeDefined();

      // Verify outbound HTTP request sent to Resend API
      expect(capturedResendRequests.length).toBe(1);
      expect(capturedResendRequests[0].url).toBe('https://api.resend.com/emails');
      expect(capturedResendRequests[0].method).toBe('POST');
      expect(capturedResendRequests[0].headers['Authorization']).toBe('Bearer re_test_1234567890');
      expect(capturedResendRequests[0].body.from).toBe('notifications@nodestack.io');
      expect(capturedResendRequests[0].body.to).toEqual(['customer@example.com']);
      expect(capturedResendRequests[0].body.subject).toBe('Welcome to NodeStack!');

      // Check database log for successful delivery
      let logs = await app.records.getList('_email_logs');
      expect(logs.items.length).toBe(1);
      expect(logs.items[0].to).toBe('customer@example.com');
      expect(logs.items[0].subject).toBe('Welcome to NodeStack!');
      expect(logs.items[0].status).toBe('delivered');
      expect(logs.items[0].messageId).toBe('re_msg_resend_12345');

      // 3. Failed email send via Resend API - should NOT emit delivery and log failure
      shouldFail = true;
      emailSentEvent = null;

      const resFail = await app.server.inject({
        method: 'POST',
        url: '/api/resend/send',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          to: 'invalid@unverified.com',
          subject: 'Failed email test',
        },
      });

      expect(resFail.statusCode).toBe(422);
      expect(emailSentEvent).toBeNull();
      expect(emailFailedEvent).toBeDefined();
      expect(emailFailedEvent.status).toBe('failed');
      expect(emailFailedEvent.error).toContain('Domain not verified');

      // Check database log contains failed record
      logs = await app.records.getList('_email_logs');
      expect(logs.items.length).toBe(2);
      const failedLog = logs.items.find((item: any) => item.to === 'invalid@unverified.com');
      expect(failedLog).toBeDefined();
      expect(failedLog.status).toBe('failed');
    });

    it('should report configured: false and reject send with HTTP 400 when Resend is unconfigured', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8138 });
      app.use(resendPlugin());

      // 1. Status route returns configured: false and hasApiKey: false
      const statusRes = await app.server.inject({ method: 'GET', url: '/api/resend/status' });
      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json().configured).toBe(false);
      expect(statusRes.json().hasApiKey).toBe(false);

      // 2. Admin UI navigation item reflects UNCONFIGURED badge and warning variant
      const navItem = app.adminUi.getNavItems().find((item) => item.id === 'resend');
      expect(navItem).toBeDefined();
      expect(navItem?.badge).toBe('UNCONFIGURED');
      expect(navItem?.badgeVariant).toBe('warning');

      // 3. POST /api/resend/send should be rejected with HTTP 400 configuration error
      await app.auth.createAdmin('resendadmin2@nodestack.io', 'Password123!');
      const { token } = await app.auth.authenticateAdmin('resendadmin2@nodestack.io', 'Password123!');

      const sendRes = await app.server.inject({
        method: 'POST',
        url: '/api/resend/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          to: 'customer@example.com',
          subject: 'Test email',
        },
      });
      expect(sendRes.statusCode).toBe(400);
      expect(sendRes.json().message).toContain('Resend API Key is not configured');
    });

    it('should report configured: true and allow dryRun mode without API key', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8139 });
      app.use(resendPlugin({ dryRun: true }));

      const statusRes = await app.server.inject({ method: 'GET', url: '/api/resend/status' });
      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json().configured).toBe(true);
      expect(statusRes.json().hasApiKey).toBe(true);

      const navItem = app.adminUi.getNavItems().find((item) => item.id === 'resend');
      expect(navItem?.badge).toBe('ACTIVE');
      expect(navItem?.badgeVariant).toBe('success');

      await app.auth.createAdmin('resenddry@nodestack.io', 'Password123!');
      const { token } = await app.auth.authenticateAdmin('resenddry@nodestack.io', 'Password123!');

      const sendRes = await app.server.inject({
        method: 'POST',
        url: '/api/resend/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          to: 'customer@example.com',
          subject: 'Dry run test email',
        },
      });
      expect(sendRes.statusCode).toBe(200);
      expect(sendRes.json().status).toBe('delivered');
    });
  });

  describe('9. Official Community Extension: Discord/Slack Webhooks Plugin', () => {
    it('should fire webhook notifications on database record mutations and perform HTTP platform requests', async () => {
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
        updateRule: '',
      });

      const capturedWebhookRequests: Array<{ url: string; method: string; headers: any; body: any }> = [];
      let shouldWebhookFail = false;

      const mockWebhookFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedWebhookRequests.push({
          url,
          method: init.method,
          headers: init.headers,
          body: init.body ? JSON.parse(init.body) : undefined,
        });

        if (shouldWebhookFail) {
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            text: async () => 'Discord upstream 500 error',
          };
        }

        // Discord typically responds with 204 No Content, Slack with 200 OK
        const status = url.includes('discord') ? 204 : 200;
        return {
          ok: true,
          status,
          statusText: status === 204 ? 'No Content' : 'OK',
          text: async () => (status === 204 ? '' : 'ok'),
        };
      });

      let dispatchedEvents: any[] = [];
      let failedEvents: any[] = [];
      app.eventBus.on('webhook:dispatched', (e) => dispatchedEvents.push(e));
      app.eventBus.on('webhook:failed', (e) => failedEvents.push(e));

      app.use(
        webhookPlugin({
          discordWebhookUrl: 'https://discord.com/api/webhooks/mock/discord-token',
          slackWebhookUrl: 'https://hooks.slack.com/services/mock/slack-token',
          collections: ['support_tickets'],
          fetch: mockWebhookFetch as any,
        })
      );

      expect(app.schema.getCollection('_webhook_logs')).toBeDefined();

      // 1. Create a ticket which triggers afterCreate hook
      const createdTicket = await app.records.create('support_tickets', {
        title: 'Server connection timeout',
        priority: 'high',
      });

      // Verify outbound HTTP requests sent to Discord and Slack
      expect(capturedWebhookRequests.length).toBe(2);

      const discordReq = capturedWebhookRequests.find((r) => r.url.includes('discord'));
      expect(discordReq).toBeDefined();
      expect(discordReq!.method).toBe('POST');
      expect(discordReq!.headers['Content-Type']).toBe('application/json');
      expect(discordReq!.body.content).toContain('Server connection timeout');
      expect(discordReq!.body.content).toContain(createdTicket.id);

      const slackReq = capturedWebhookRequests.find((r) => r.url.includes('slack'));
      expect(slackReq).toBeDefined();
      expect(slackReq!.method).toBe('POST');
      expect(slackReq!.headers['Content-Type']).toBe('application/json');
      expect(slackReq!.body.text).toContain('Server connection timeout');
      expect(slackReq!.body.text).toContain(createdTicket.id);

      // Verify webhook logs in database
      let logs = await app.records.getList('_webhook_logs');
      expect(logs.items.length).toBe(2);

      const discordLog = logs.items.find((l: any) => l.platform === 'discord');
      expect(discordLog).toBeDefined();
      expect(discordLog.collection).toBe('support_tickets');
      expect(discordLog.event).toBe('record:created');
      expect(discordLog.status).toBe('dispatched');
      expect(discordLog.statusCode).toBe(204);

      const slackLog = logs.items.find((l: any) => l.platform === 'slack');
      expect(slackLog).toBeDefined();
      expect(slackLog.collection).toBe('support_tickets');
      expect(slackLog.event).toBe('record:created');
      expect(slackLog.status).toBe('dispatched');
      expect(slackLog.statusCode).toBe(200);

      expect(dispatchedEvents.length).toBe(2);
      expect(failedEvents.length).toBe(0);

      // 2. Test status endpoint
      const statusRes = await app.server.inject({
        method: 'GET',
        url: '/api/webhooks/status',
      });
      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json()).toMatchObject({
        hasDiscord: true,
        hasSlack: true,
        dispatchedCount: 2,
        failedCount: 0,
        totalCount: 2,
      });

      // 3. Test failed webhook dispatch (HTTP 500 error from upstream)
      shouldWebhookFail = true;
      dispatchedEvents = [];
      failedEvents = [];
      capturedWebhookRequests.length = 0;

      await app.records.update('support_tickets', createdTicket.id, {
        priority: 'urgent',
      });

      // Outbound requests were attempted
      expect(capturedWebhookRequests.length).toBe(2);

      // Verify failed logs recorded in database with error and status
      logs = await app.records.getList('_webhook_logs');
      expect(logs.items.length).toBe(4);

      const failedLogs = logs.items.filter((l: any) => l.status === 'failed');
      expect(failedLogs.length).toBe(2);
      expect(failedLogs[0].statusCode).toBe(500);
      expect(failedLogs[0].error).toContain('Discord upstream 500 error');

      expect(failedEvents.length).toBe(2);
      expect(failedEvents[0].result.status).toBe('failed');
      expect(failedEvents[0].result.statusCode).toBe(500);

      // 4. Test /api/webhooks/test action endpoint authentication & dispatch
      shouldWebhookFail = false;
      capturedWebhookRequests.length = 0;

      // (a) Unauthenticated call is rejected with 403
      const resUnauth = await app.server.inject({
        method: 'POST',
        url: '/api/webhooks/test',
        payload: { platform: 'discord', message: 'Unauthorized test' },
      });
      expect(resUnauth.statusCode).toBe(403);
      expect(capturedWebhookRequests.length).toBe(0);

      // (b) Authenticated admin call succeeds and dispatches
      await app.auth.createAdmin('webhook-admin@nodestack.io', 'Password123!');
      const { token: adminToken } = await app.auth.authenticateAdmin(
        'webhook-admin@nodestack.io',
        'Password123!'
      );

      const resAuth = await app.server.inject({
        method: 'POST',
        url: '/api/webhooks/test',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { platform: 'discord', message: 'Hello from Admin' },
      });
      expect(resAuth.statusCode).toBe(200);
      expect(resAuth.json().status).toBe('dispatched');
      expect(capturedWebhookRequests.length).toBe(1);
      expect(capturedWebhookRequests[0].body.content).toBe('Hello from Admin');
    });

    it('should dynamically update active dispatch platforms and status when webhook URLs are configured at runtime', async () => {
      const origDiscordEnv = process.env.DISCORD_WEBHOOK_URL;
      const origSlackEnv = process.env.SLACK_WEBHOOK_URL;
      delete process.env.DISCORD_WEBHOOK_URL;
      delete process.env.SLACK_WEBHOOK_URL;

      try {
        app = new NodeStack({ dataDir: testDataDir, port: 8130 });

        app.schema.createCollection({
          name: 'live_tickets',
          type: 'base',
          schema: [
            { id: 'f_title', name: 'title', type: 'text', required: true },
          ],
          listRule: '',
          viewRule: '',
          createRule: '',
          updateRule: '',
        });

        const capturedRequests: Array<{ url: string; method: string; body: any }> = [];
        const mockFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
          capturedRequests.push({
            url,
            method: init.method,
            body: init.body ? JSON.parse(init.body) : undefined,
          });
          return {
            ok: true,
            status: url.includes('discord') ? 204 : 200,
            statusText: 'OK',
            text: async () => '',
          };
        });

        // 1. Initialize plugin with no initial webhook URLs
        app.use(
          webhookPlugin({
            collections: ['live_tickets'],
            fetch: mockFetch as any,
          })
        );

        // Status route reports both false and admin nav reports READY
        let statusRes = await app.server.inject({ method: 'GET', url: '/api/webhooks/status' });
        expect(statusRes.statusCode).toBe(200);
        expect(statusRes.json()).toMatchObject({
          hasDiscord: false,
          hasSlack: false,
        });

        let navRes = await app.server.inject({ method: 'GET', url: '/api/plugins' });
        let webhooksNav = navRes.json().navItems.find((n: any) => n.id === 'webhooks');
        expect(webhooksNav.badge).toBe('READY');

        // Mutation before configuration: 0 outbound requests sent
        const ticket = await app.records.create('live_tickets', { title: 'First ticket' });
        expect(capturedRequests.length).toBe(0);

        // 2. Configure Discord webhook URL via Admin UI plugin config update
        await app.pluginManager.updatePluginConfig('webhooks', {
          discordWebhookUrl: 'https://discord.com/api/webhooks/live-discord',
        });

        // Status route dynamically reflects discord enabled
        statusRes = await app.server.inject({ method: 'GET', url: '/api/webhooks/status' });
        expect(statusRes.json()).toMatchObject({
          hasDiscord: true,
          hasSlack: false,
        });

        navRes = await app.server.inject({ method: 'GET', url: '/api/plugins' });
        webhooksNav = navRes.json().navItems.find((n: any) => n.id === 'webhooks');
        expect(webhooksNav.badge).toBe('CONFIGURED');

        // Mutation after config update: Discord webhook is dispatched!
        await app.records.update('live_tickets', ticket.id, { title: 'Updated ticket title' });
        expect(capturedRequests.length).toBe(1);
        expect(capturedRequests[0].url).toBe('https://discord.com/api/webhooks/live-discord');
        expect(capturedRequests[0].body.content).toContain('Updated ticket title');

        // Verify logged in _webhook_logs
        let logs = await app.records.getList('_webhook_logs');
        expect(logs.items.length).toBe(1);
        expect(logs.items[0].platform).toBe('discord');
        expect(logs.items[0].event).toBe('record:updated');

        // 3. Add Slack webhook via config update as well
        await app.pluginManager.updatePluginConfig('webhooks', {
          slackWebhookUrl: 'https://hooks.slack.com/services/live-slack',
        });

        statusRes = await app.server.inject({ method: 'GET', url: '/api/webhooks/status' });
        expect(statusRes.json()).toMatchObject({
          hasDiscord: true,
          hasSlack: true,
        });

        capturedRequests.length = 0;
        await app.records.create('live_tickets', { title: 'Second ticket' });
        expect(capturedRequests.length).toBe(2);
        expect(capturedRequests.some((r) => r.url.includes('discord'))).toBe(true);
        expect(capturedRequests.some((r) => r.url.includes('slack'))).toBe(true);
      } finally {
        if (origDiscordEnv !== undefined) process.env.DISCORD_WEBHOOK_URL = origDiscordEnv;
        else delete process.env.DISCORD_WEBHOOK_URL;
        if (origSlackEnv !== undefined) process.env.SLACK_WEBHOOK_URL = origSlackEnv;
        else delete process.env.SLACK_WEBHOOK_URL;
      }
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

    it('should reconcile or restart background worker timer when autoProcessIntervalMs configuration changes', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8128 });

      // Start with autoProcessIntervalMs: 0 (disabled worker)
      app.use(
        algoliaPlugin({
          appId: 'ALGOLIA_APP_ID',
          apiKey: 'ALGOLIA_API_KEY',
          autoProcessIntervalMs: 0,
          collections: [],
        })
      );

      // Verify worker is initially not active
      let statusRes = await app.server.inject({ method: 'GET', url: '/api/algolia/status' });
      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json().workerActive).toBe(false);
      expect(statusRes.json().autoProcessIntervalMs).toBe(0);

      // 1. Changing 0 to a positive value dynamically starts the worker
      await app.pluginManager.updatePluginConfig('algolia', {
        autoProcessIntervalMs: 2500,
      });

      statusRes = await app.server.inject({ method: 'GET', url: '/api/algolia/status' });
      expect(statusRes.json().workerActive).toBe(true);
      expect(statusRes.json().autoProcessIntervalMs).toBe(2500);

      // 2. Updating interval restarts timer with the new interval
      await app.pluginManager.updatePluginConfig('algolia', {
        autoProcessIntervalMs: 1200,
      });

      statusRes = await app.server.inject({ method: 'GET', url: '/api/algolia/status' });
      expect(statusRes.json().workerActive).toBe(true);
      expect(statusRes.json().autoProcessIntervalMs).toBe(1200);

      // 3. Changing to 0 stops the active worker
      await app.pluginManager.updatePluginConfig('algolia', {
        autoProcessIntervalMs: 0,
      });

      statusRes = await app.server.inject({ method: 'GET', url: '/api/algolia/status' });
      expect(statusRes.json().workerActive).toBe(false);
      expect(statusRes.json().autoProcessIntervalMs).toBe(0);
    });

    it('should reject process-queue and reindex with HTTP 400 when Algolia is unconfigured', async () => {
      const origAppIdEnv = process.env.ALGOLIA_APP_ID;
      const origApiKeyEnv = process.env.ALGOLIA_API_KEY;
      delete process.env.ALGOLIA_APP_ID;
      delete process.env.ALGOLIA_API_KEY;

      try {
        app = new NodeStack({ dataDir: testDataDir, port: 8136 });
        app.use(algoliaPlugin());

        // 1. Status route reflects configured: false
        const statusRes = await app.server.inject({ method: 'GET', url: '/api/algolia/status' });
        expect(statusRes.statusCode).toBe(200);
        expect(statusRes.json().configured).toBe(false);

        // 2. Nav item reflects UNCONFIGURED badge and warning variant
        const navItemsRes = await app.server.inject({ method: 'GET', url: '/api/plugins' });
        const algoliaNavItem = navItemsRes.json().navItems.find((item: any) => item.id === 'algolia');
        expect(algoliaNavItem).toBeDefined();
        expect(algoliaNavItem.badge).toBe('UNCONFIGURED');
        expect(algoliaNavItem.badgeVariant).toBe('warning');
        expect(algoliaNavItem.view.description).toContain('Unconfigured');

        // 3. Attempting to process queue without configuration returns 400 Bad Request
        await app.auth.createAdmin('algolia-admin@nodestack.io', 'Password123!');
        const { token: adminToken } = await app.auth.authenticateAdmin(
          'algolia-admin@nodestack.io',
          'Password123!'
        );

        const processRes = await app.server.inject({
          method: 'POST',
          url: '/api/algolia/process-queue',
          headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(processRes.statusCode).toBe(400);
        expect(processRes.json().message).toContain('not configured');

        // 4. Attempting to reindex returns 400 Bad Request
        const reindexRes = await app.server.inject({
          method: 'POST',
          url: '/api/algolia/reindex',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { collection: 'products' },
        });
        expect(reindexRes.statusCode).toBe(400);
        expect(reindexRes.json().message).toContain('not configured');

        // 5. Configuring dryRun mode enables the plugin
        await app.pluginManager.updatePluginConfig('algolia', {
          dryRun: true,
          collections: ['products'],
        });

        const updatedStatusRes = await app.server.inject({ method: 'GET', url: '/api/algolia/status' });
        expect(updatedStatusRes.statusCode).toBe(200);
        expect(updatedStatusRes.json().configured).toBe(true);

        const updatedProcessRes = await app.server.inject({
          method: 'POST',
          url: '/api/algolia/process-queue',
          headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(updatedProcessRes.statusCode).toBe(200);
        expect(updatedProcessRes.json().success).toBe(true);
      } finally {
        if (origAppIdEnv !== undefined) process.env.ALGOLIA_APP_ID = origAppIdEnv;
        if (origApiKeyEnv !== undefined) process.env.ALGOLIA_API_KEY = origApiKeyEnv;
      }
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

    it('should support invoking plugin factories with zero arguments (no-options / env-only)', () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8120 });

      // Zero-options invocations must compile and execute cleanly
      app.use(workspaceStripePlugin());
      app.use(workspaceS3Plugin());
      app.use(workspaceResendPlugin());
      app.use(workspaceWebhookPlugin());
      app.use(workspaceAlgoliaPlugin());

      expect(app.hasPlugin('stripe')).toBe(true);
      expect(app.hasPlugin('s3-storage')).toBe(true);
      expect(app.hasPlugin('resend')).toBe(true);
      expect(app.hasPlugin('webhooks')).toBe(true);
      expect(app.hasPlugin('algolia')).toBe(true);
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
        expect(mainBody.innerHTML).toContain('Test Plugin');
        expect(mainBody.innerHTML).toContain('Back to Plugins');
        expect(mainBody.innerHTML).not.toContain('Developer Testing Workbench');

        // Verify top header has no redundant Test button
        const viewActions = doc.getElementById('view-actions');
        expect(viewActions.textContent).toContain('All Plugins');
        expect(viewActions.textContent).not.toContain('Test Plugin');

        // Verify custom-html plugin views also receive the unified header consistently
        win.state.pluginNavItems.push({
          id: 'custom-storage',
          title: 'Custom Storage',
          badge: 'ACTIVE',
          badgeVariant: 'success',
          view: {
            title: 'Custom Cloud Storage',
            description: 'Custom object store connection',
            html: '<div class="custom-metrics"><span>Storage Metric: 42GB</span></div>',
          },
        });
        await win.selectNav('custom-storage');
        expect(mainBody.innerHTML).toContain('Custom Cloud Storage');
        expect(mainBody.innerHTML).toContain('Custom object store connection');
        expect(mainBody.innerHTML).toContain('Test Plugin');
        expect(mainBody.innerHTML).toContain('Back to Plugins');
        expect(mainBody.innerHTML).toContain('Storage Metric: 42GB');
        expect(mainBody.innerHTML).not.toContain('Developer Testing Workbench');

        // Switch back to stripe
        await win.selectNav('stripe');

        // 3. Verify breadcrumbs
        const breadcrumbs = doc.getElementById('breadcrumb-trail');
        expect(breadcrumbs.textContent).toContain('NodeStack');
        expect(breadcrumbs.textContent).toContain('Plugins');
        expect(breadcrumbs.textContent).toContain('Stripe Payments');

        // 4. Verify Command Palette indexing
        const paletteItems = win.filterCommandPaletteItems('stripe');
        expect(paletteItems.some((item: any) => item.id === 'plugin-stripe')).toBe(true);
        expect(paletteItems.find((item: any) => item.id === 'plugin-stripe').category).toBe('Plugins');

        // 5. Verify in-context Plugin Tester Drawer opening & closing
        win.openPluginTesterDrawer('stripe');
        const drawerPanel = doc.getElementById('plugin-drawer-panel');
        expect(drawerPanel).not.toBeNull();
        expect(drawerPanel.innerHTML).toContain('Test Stripe Payments');
        expect(drawerPanel.innerHTML).toContain('Create Checkout Session');
        expect(drawerPanel.innerHTML).toContain('Simulate Incoming Webhook');

        win.closePluginTesterDrawer();
      } finally {
        dom.window.close();
      }
    }, 15000);

    it('should preserve admin session and display live error payload when a plugin test fails with 401 or 403', async () => {
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
            return { ok: true, json: async () => ({}) };
          });
        },
      });

      try {
        const win = dom.window as any;
        const doc = win.document;

        // Set authenticated admin state
        win.state.token = 'mock_valid_admin_jwt_token';
        const logoutSpy = vi.fn();
        win.logout = logoutSpy;

        // Open plugin tester drawer for stripe
        win.openPluginTesterDrawer('stripe');
        const drawerPanel = doc.getElementById('plugin-drawer-panel');
        expect(drawerPanel).not.toBeNull();

        // 1. Simulate Stripe test returning HTTP 401 Unauthorized (e.g. invalid test secret key)
        win.fetch = vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/api/stripe/checkout-session')) {
            return {
              ok: false,
              status: 401,
              json: async () => ({
                statusCode: 401,
                error: 'Unauthorized',
                message: 'Invalid Stripe API Key provided: sk_test_***',
              }),
            };
          }
          return { ok: true, json: async () => ({}) };
        });

        await win.runStripeCheckoutTest();

        // Admin session MUST remain intact!
        expect(logoutSpy).not.toHaveBeenCalled();
        expect(win.state.token).toBe('mock_valid_admin_jwt_token');

        // Output drawer should display the 401 error and the payload
        const outputEl = doc.getElementById('plugin-tester-output');
        const badgeStatus = doc.getElementById('plugin-tester-status-badge');
        expect(badgeStatus?.textContent).toBe('Status: 401 Error');
        expect(outputEl?.textContent).toContain('Invalid Stripe API Key provided');

        // 2. Simulate S3 test returning HTTP 403 Forbidden (e.g. AWS S3 AccessDenied)
        win.fetch = vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/api/s3/sign-upload-url')) {
            return {
              ok: false,
              status: 403,
              json: async () => ({
                statusCode: 403,
                error: 'Forbidden',
                message: 'AccessDenied: User is not authorized to perform: s3:PutObject',
              }),
            };
          }
          return { ok: true, json: async () => ({}) };
        });

        await win.runS3PresignedUrlTest();

        expect(logoutSpy).not.toHaveBeenCalled();
        expect(win.state.token).toBe('mock_valid_admin_jwt_token');
        expect(badgeStatus?.textContent).toBe('Status: 403 Error');
        expect(outputEl?.textContent).toContain('AccessDenied');

        // 3. Verify that genuine NodeStack admin session expiration DOES trigger logout
        win.fetch = vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/api/admins/me')) {
            return {
              ok: false,
              status: 403,
              json: async () => ({
                statusCode: 403,
                error: 'Forbidden',
                message: 'Only admins are authorized to access this resource',
              }),
            };
          }
          return { ok: true, json: async () => ({}) };
        });

        await expect(win.api('/api/admins/me')).rejects.toThrow();
        expect(logoutSpy).toHaveBeenCalled();
      } finally {
        dom.window.close();
      }
    }, 15000);

    it('should include Third-Party Services Disclaimer in LICENSE file', () => {
      const licensePath = path.resolve(__dirname, '../LICENSE');
      expect(fs.existsSync(licensePath)).toBe(true);
      const licenseContent = fs.readFileSync(licensePath, 'utf8');
      expect(licenseContent).toContain('THIRD-PARTY SERVICES & INTEGRATIONS DISCLAIMER:');
      expect(licenseContent).toContain('IN NO EVENT SHALL');
      expect(licenseContent).toContain('STRIPE, AWS S3');
    });

    it('should configure Stripe LIVE danger badge when live key is used and safeguard checkout test with confirmation', async () => {
      const livePlugin = stripePlugin({ secretKey: 'sk_live_sample_production_key_123' });
      expect(livePlugin.adminNavItems?.[0].badge).toBe('LIVE');
      expect(livePlugin.adminNavItems?.[0].badgeVariant).toBe('danger');

      const { JSDOM } = await import('jsdom');
      const { AdminUIBundler } = await import('../src/admin/AdminUIBundler');
      const uiDir = path.resolve(__dirname, '../src/admin/ui');
      const bundledHtml = AdminUIBundler.bundle(uiDir);

      const dom = new JSDOM(bundledHtml, {
        url: 'http://localhost:8090/_/',
        runScripts: 'dangerously',
      });

      try {
        const win = dom.window as any;
        const doc = win.document;

        win.state.pluginNavItems = [
          {
            id: 'stripe',
            title: 'Stripe Payments',
            badge: 'LIVE',
            badgeVariant: 'danger',
          },
        ];

        // 1. Open Stripe drawer in LIVE mode
        win.openPluginTesterDrawer('stripe');
        const drawerPanel = doc.getElementById('plugin-drawer-panel');
        expect(drawerPanel?.innerHTML).toContain('LIVE PRODUCTION MODE ACTIVE');
        expect(drawerPanel?.innerHTML).toContain('External Service Disclaimer');

        // 2. Operational safeguard: reject confirmation should abort checkout
        const fetchSpy = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({}) }));
        win.fetch = fetchSpy;
        win.confirm = vi.fn().mockReturnValue(false);

        await win.runStripeCheckoutTest();
        expect(fetchSpy).not.toHaveBeenCalledWith('/api/stripe/checkout-session', expect.anything());

        // 3. Operational safeguard: accept confirmation allows test execution
        win.confirm = vi.fn().mockReturnValue(true);
        fetchSpy.mockClear();
        fetchSpy.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'cs_live_123', status: 'open' }),
        });

        await win.runStripeCheckoutTest();
        expect(fetchSpy).toHaveBeenCalledWith('/api/stripe/checkout-session', expect.anything());
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

  describe('13. Official Extensions Hub & 1-Click Runtime Installer', () => {
    it('should expose official plugin catalog via /api/plugins and /api/plugins/available', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8131 });

      await app.auth.createAdmin('admin@nodestack.io', 'Password123!');
      const { token } = await app.auth.authenticateAdmin('admin@nodestack.io', 'Password123!');

      // Public /api/plugins includes catalog
      const resPublic = await app.server.inject({ method: 'GET', url: '/api/plugins' });
      expect(resPublic.statusCode).toBe(200);
      const data = resPublic.json();
      expect(Array.isArray(data.catalog)).toBe(true);
      expect(data.catalog.length).toBe(5);

      const stripeDef = data.catalog.find((c: any) => c.id === 'stripe');
      expect(stripeDef).toBeDefined();
      expect(stripeDef.packageName).toBe('@nodestackapp/plugin-stripe');
      expect(stripeDef.isInstalled).toBe(false);

      // Authenticated /api/plugins/available endpoint
      const resAvail = await app.server.inject({
        method: 'GET',
        url: '/api/plugins/available',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(resAvail.statusCode).toBe(200);
      expect(resAvail.json().plugins.length).toBe(5);
    });

    it('should 1-click enable official plugin at runtime, register collections & routes, and persist across restart', async () => {
      const hubDataDir = path.resolve(testDataDir, 'hub_test_instance');
      app = new NodeStack({ dataDir: hubDataDir, port: 8132 });

      await app.auth.createAdmin('hubadmin@nodestack.io', 'Password123!');
      const { token } = await app.auth.authenticateAdmin('hubadmin@nodestack.io', 'Password123!');

      // 1. Initial state: 0 plugins installed
      expect(app.hasPlugin('stripe')).toBe(false);
      expect(app.schema.getCollection('_stripe_payments')).toBeUndefined();

      // 2. 1-Click Enable Stripe extension via API
      const resEnable = await app.server.inject({
        method: 'POST',
        url: '/api/plugins/stripe/enable',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(resEnable.statusCode).toBe(200);
      expect(resEnable.json().success).toBe(true);

      // Verify plugin is now registered in NodeStack
      expect(app.hasPlugin('stripe')).toBe(true);

      // Verify system collection was registered
      expect(app.schema.getCollection('_stripe_payments')).toBeDefined();

      // Verify Admin UI navigation item is present
      const navItems = app.adminUi.getNavItems();
      expect(navItems.some((n) => n.id === 'stripe')).toBe(true);

      // Verify dynamic route was registered and responds with unconfigured state
      const resStatus = await app.server.inject({ method: 'GET', url: '/api/stripe/status' });
      expect(resStatus.statusCode).toBe(200);
      expect(resStatus.json().currency).toBe('usd');
      expect(resStatus.json().configured).toBe(false);
      expect(resStatus.json().testMode).toBe(false);
      expect(navItems.find((n) => n.id === 'stripe')?.badge).toBe('UNCONFIGURED');

      // 3. Simulate server restart: new NodeStack instance with same dataDir
      const restartedApp = new NodeStack({ dataDir: hubDataDir, port: 8133 });
      try {
        // Stripe plugin must be auto-loaded on startup without code-level app.use()!
        expect(restartedApp.hasPlugin('stripe')).toBe(true);
        expect(restartedApp.schema.getCollection('_stripe_payments')).toBeDefined();

        const restartNav = restartedApp.adminUi.getNavItems();
        expect(restartNav.some((n) => n.id === 'stripe')).toBe(true);

        const restartStatus = await restartedApp.server.inject({ method: 'GET', url: '/api/stripe/status' });
        expect(restartStatus.statusCode).toBe(200);
      } finally {
        await restartedApp.stop();
      }

      // 4. Disable plugin via API
      const resDisable = await app.server.inject({
        method: 'POST',
        url: '/api/plugins/stripe/disable',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(resDisable.statusCode).toBe(200);
      expect(resDisable.json().success).toBe(true);

      // Verify plugin was deactivated
      expect(app.hasPlugin('stripe')).toBe(false);
      expect(app.adminUi.getNavItems().some((n) => n.id === 'stripe')).toBe(false);
    });

    it('should 1-click enable Resend Transactional Email extension via /api/plugins/resend/enable', async () => {
      const resendDataDir = path.resolve(testDataDir, 'resend_hub_instance');
      app = new NodeStack({ dataDir: resendDataDir, port: 8134 });

      await app.auth.createAdmin('resendadmin@nodestack.io', 'Password123!');
      const { token } = await app.auth.authenticateAdmin('resendadmin@nodestack.io', 'Password123!');

      // 1. Initial state: resend not installed
      expect(app.hasPlugin('resend')).toBe(false);
      expect(app.schema.getCollection('_email_logs')).toBeUndefined();

      // 2. Enable resend extension via API
      const resEnable = await app.server.inject({
        method: 'POST',
        url: '/api/plugins/resend/enable',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(resEnable.statusCode).toBe(200);
      expect(resEnable.json().success).toBe(true);

      // Verify plugin is now registered
      expect(app.hasPlugin('resend')).toBe(true);
      expect(app.schema.getCollection('_email_logs')).toBeDefined();

      // Verify Admin UI navigation item is present with id 'resend'
      const navItems = app.adminUi.getNavItems();
      expect(navItems.some((n) => n.id === 'resend')).toBe(true);

      // Verify catalog reflects isInstalled: true for resend
      const resCatalog = await app.server.inject({ method: 'GET', url: '/api/plugins' });
      const catalog = resCatalog.json().catalog;
      const resendMeta = catalog.find((c: any) => c.id === 'resend');
      expect(resendMeta.isInstalled).toBe(true);

      // Verify dynamic route responds with unconfigured status initially
      const resStatus = await app.server.inject({ method: 'GET', url: '/api/resend/status' });
      expect(resStatus.statusCode).toBe(200);
      expect(resStatus.json().configured).toBe(false);
      expect(resStatus.json().hasApiKey).toBe(false);

      // Verify sending without config returns HTTP 400
      const resUnconfSend = await app.server.inject({
        method: 'POST',
        url: '/api/resend/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          to: 'customer@example.com',
          subject: 'Unconfigured test',
        },
      });
      expect(resUnconfSend.statusCode).toBe(400);
      expect(resUnconfSend.json().message).toContain('Resend API Key is not configured');

      // 3. Disable plugin
      const resDisable = await app.server.inject({
        method: 'POST',
        url: '/api/plugins/resend/disable',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(resDisable.statusCode).toBe(200);
      expect(app.hasPlugin('resend')).toBe(false);
      expect(app.adminUi.getNavItems().some((n) => n.id === 'resend')).toBe(false);
    });

    it('should unsubscribe lifecycle hooks from EventBus when plugin is disabled, preventing mutation triggers', async () => {
      const hookDataDir = path.resolve(testDataDir, 'hook_disable_instance');
      app = new NodeStack({ dataDir: hookDataDir, port: 8135 });

      await app.auth.createAdmin('hookadmin@nodestack.io', 'Password123!');
      const { token } = await app.auth.authenticateAdmin('hookadmin@nodestack.io', 'Password123!');

      // Create a test collection
      app.schema.createCollection({
        name: 'notes',
        type: 'base',
        schema: [{ id: 'f_title', name: 'title', type: 'text', required: true }],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
      });

      // 1. Register Algolia Search Sync extension targeting collection 'notes'
      app.use(
        algoliaPlugin({
          appId: 'ALGOLIA_APP_ID',
          apiKey: 'ALGOLIA_API_KEY',
          collections: ['notes'],
          dryRun: true,
        })
      );
      expect(app.hasPlugin('algolia')).toBe(true);

      // Create a note while Algolia is enabled: Algolia hook triggers and queues mutation
      const note1 = await app.records.create('notes', { title: 'First Note' });
      const queuedRows1 = app.db.all<{ id: string }>(
        'SELECT id FROM _algolia_sync_queue WHERE objectId = ?',
        [note1.id]
      );
      expect(queuedRows1.length).toBe(1);

      // 2. Disable Algolia extension via API
      const resDisable = await app.server.inject({
        method: 'POST',
        url: '/api/plugins/algolia/disable',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(resDisable.statusCode).toBe(200);
      expect(app.hasPlugin('algolia')).toBe(false);

      // Clear sync queue to verify no new operations are added
      app.db.run('DELETE FROM _algolia_sync_queue');

      // Create another note while Algolia is disabled: Hook must NOT fire!
      const note2 = await app.records.create('notes', { title: 'Second Note While Disabled' });
      const queuedRows2 = app.db.all<{ id: string }>(
        'SELECT id FROM _algolia_sync_queue WHERE objectId = ?',
        [note2.id]
      );
      expect(queuedRows2.length).toBe(0);

      // Update and delete note2: Hooks must NOT fire!
      await app.records.update('notes', note2.id, { title: 'Updated Note 2' });
      await app.records.delete('notes', note2.id);

      const queuedRowsTotal = app.db.all<{ id: string }>('SELECT id FROM _algolia_sync_queue');
      expect(queuedRowsTotal.length).toBe(0);
    });

    it('should unsubscribe and guard custom plugin hooks when plugin is removed or disabled', async () => {
      app = new NodeStack({ dataDir: testDataDir, port: 8136 });

      app.schema.createCollection({
        name: 'tasks',
        type: 'base',
        schema: [{ id: 'f_desc', name: 'desc', type: 'text', required: true }],
        listRule: '',
        viewRule: '',
        createRule: '',
      });

      let hookExecutionCount = 0;
      const customPlugin: INodeStackPlugin = {
        name: 'custom-tracker-plugin',
        register(ctx) {
          ctx.registerHook('afterCreate', () => {
            hookExecutionCount++;
          });
        },
      };

      app.use(customPlugin);

      // While active, hook fires
      await app.records.create('tasks', { desc: 'Task 1' });
      expect(hookExecutionCount).toBe(1);

      // Disable / remove plugin
      await app.pluginManager.disableOfficialPlugin('custom-tracker-plugin');

      // While disabled, hook must NOT fire
      await app.records.create('tasks', { desc: 'Task 2' });
      expect(hookExecutionCount).toBe(1);
    });
  });
});

