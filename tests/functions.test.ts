import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { SsrfGuard, SsrfGuardError } from '../src/functions/security/SsrfGuard';
import { IFunctionRuntime, RuntimeExecutionOptions } from '../src/functions/runtime/IFunctionRuntime';
import { FunctionHostServices, FunctionExecutionResult } from '../src/functions/types';

describe('Embedded Serverless Functions ("NodeStack Functions")', () => {
  const testDir = path.resolve(__dirname, '../.test_functions_nodestack_data');
  let app: NodeStack;
  let adminToken = '';
  let userToken = '';
  let userId = '';

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDir,
      port: 8199,
    });

    await app.start();

    // 1. Create superuser
    const admin = await app.auth.createAdmin('admin@nodestack.io', 'AdminPassword123!');
    const adminAuth = await app.auth.authenticateAdmin('admin@nodestack.io', 'AdminPassword123!');
    adminToken = adminAuth.token;

    // 2. Create sample collection 'orders'
    app.schema.createCollection({
      name: 'orders',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_amount', name: 'amount', type: 'number', required: true },
        { id: 'f_status', name: 'status', type: 'text', required: false },
        { id: 'f_owner', name: 'owner', type: 'text', required: false },
      ],
      // Row-level rule: only owner or admin can read
      listRule: 'owner = @request.auth.id',
      viewRule: 'owner = @request.auth.id',
      createRule: '',
      updateRule: 'owner = @request.auth.id',
      deleteRule: 'owner = @request.auth.id',
    });

    // 3. Create regular user
    const userRes = await app.records.create('users', {
      email: 'buyer@nodestack.io',
      password: 'BuyerPassword123!',
    });
    userId = userRes.id;
    const userAuth = await app.auth.authenticateRecord('users', 'buyer@nodestack.io', 'BuyerPassword123!');
    userToken = userAuth.token;
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ==========================================
  // 1. Anti-SSRF Network Firewall
  // ==========================================
  describe('1. Anti-SSRF Security Guardrails (SsrfGuard)', () => {
    it('should block requests to private IP ranges and loopback', async () => {
      await expect(SsrfGuard.validateUrl('http://127.0.0.1:8090/secret')).rejects.toThrow(
        /Direct access to private or metadata IP/
      );
      await expect(SsrfGuard.validateUrl('http://localhost:3000/')).rejects.toThrow(
        /Host 'localhost' is prohibited/
      );
      await expect(SsrfGuard.validateUrl('http://10.0.0.1/')).rejects.toThrow(
        /Direct access to private or metadata IP/
      );
      await expect(SsrfGuard.validateUrl('http://192.168.1.1/admin')).rejects.toThrow(
        /Direct access to private or metadata IP/
      );
    });

    it('should block requests to cloud metadata endpoints (169.254.169.254)', async () => {
      await expect(
        SsrfGuard.validateUrl('http://169.254.169.254/latest/meta-data/')
      ).rejects.toThrow(/Direct access to private or metadata IP/);
    });

    it('should enforce domain allowlists if configured', async () => {
      const allowed = ['api.stripe.com', '*.github.com'];

      expect(SsrfGuard.isAllowedDomain('api.stripe.com', allowed)).toBe(true);
      expect(SsrfGuard.isAllowedDomain('raw.github.com', allowed)).toBe(true);
      expect(SsrfGuard.isAllowedDomain('github.com', allowed)).toBe(true);
      expect(SsrfGuard.isAllowedDomain('evilgithub.com', allowed)).toBe(false);
      expect(SsrfGuard.isAllowedDomain('not-github.com', allowed)).toBe(false);
      expect(SsrfGuard.isAllowedDomain('malicious-site.com', allowed)).toBe(false);

      await expect(
        SsrfGuard.validateUrl('https://evilgithub.com/api', allowed)
      ).rejects.toThrow(/is not in the allowed domains whitelist/);

      await expect(
        SsrfGuard.validateUrl('https://malicious-site.com/api', allowed)
      ).rejects.toThrow(/is not in the allowed domains whitelist/);
    });

    it('should reject non-HTTP protocols (file:, ftp:, gopher:)', async () => {
      await expect(SsrfGuard.validateUrl('file:///etc/passwd')).rejects.toThrow(
        /Forbidden protocol 'file:'/
      );
    });

    it('should normalize and block bracketed IPv6 literals (loopback, link-local, mapped)', async () => {
      await expect(SsrfGuard.validateUrl('http://[::1]/secret')).rejects.toThrow(
        /Direct access to private or metadata IP/
      );
      await expect(SsrfGuard.validateUrl('http://[::ffff:127.0.0.1]:8080/')).rejects.toThrow(
        /Direct access to private or metadata IP/
      );
      await expect(SsrfGuard.validateUrl('http://[fe80::1]/')).rejects.toThrow(
        /Direct access to private or metadata IP/
      );
    });

    it('should block the full IPv6 Unique Local Address range (fc00::/7 including fd00::/8)', async () => {
      await expect(SsrfGuard.validateUrl('http://[fc00::1]/admin')).rejects.toThrow(
        /Direct access to private or metadata IP/
      );
      await expect(SsrfGuard.validateUrl('http://[fd00::1]/admin')).rejects.toThrow(
        /Direct access to private or metadata IP/
      );
      await expect(SsrfGuard.validateUrl('http://[fd12:3456:789a::1]/config')).rejects.toThrow(
        /Direct access to private or metadata IP/
      );
    });

    it('should pin resolved address and reject SSRF attempts in createGuardedFetch', async () => {
      const guardedFetch = SsrfGuard.createGuardedFetch();

      // Direct private IPv4 and bracketed IPv6
      await expect(guardedFetch('http://127.0.0.1:8080/')).rejects.toThrow(
        /Direct access to private or metadata IP/
      );
      await expect(guardedFetch('http://[::1]:8080/')).rejects.toThrow(
        /Direct access to private or metadata IP/
      );
      await expect(guardedFetch('http://[fd00::1]:8080/')).rejects.toThrow(
        /Direct access to private or metadata IP/
      );
    });
  });

  // ==========================================
  // 2. Execution Sandbox & Isolation
  // ==========================================
  describe('2. Sandboxed Execution & Isolation (QuickJS-Wasm)', () => {
    it('should execute basic function and return status, body, and custom headers', async () => {
      const fn = app.functions.createFunction({
        name: 'calculate-tax',
        code: `
          export default async function(core, context) {
            const amount = context.request.body.amount || 0;
            const tax = amount * 0.2;
            return {
              status: 200,
              headers: { 'x-tax-rate': '20%' },
              body: { amount: amount, tax: tax, total: amount + tax }
            };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/functions/calculate-tax/invoke',
        payload: { amount: 100 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-tax-rate']).toBe('20%');
      const body = res.json();
      expect(body.amount).toBe(100);
      expect(body.tax).toBe(20);
      expect(body.total).toBe(120);
    });

    it('should execute function created without code using the default (core, context) fallback handler', async () => {
      // Create a function with no code passed
      const fn = app.functions.createFunction({
        name: 'default-fallback-fn',
        enabled: true,
        authPolicy: 'public',
        methods: ['POST', 'GET'],
      });

      expect(fn.code).toContain('export default async function(core, context)');
      expect(fn.code).toContain('context.app.slug');

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/functions/default-fallback-fn/invoke',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.message).toBe('Hello from default');
    });

    it('should support backward compatibility for legacy 1-arg function(ctx) handlers', async () => {
      app.functions.createFunction({
        name: 'legacy-ctx-fn',
        code: `
          export default async function(ctx) {
            return {
              status: 200,
              body: {
                appSlug: ctx.app.slug,
                fromBody: ctx.request.body.name,
              }
            };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
      });

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/functions/legacy-ctx-fn/invoke',
        payload: { name: 'LegacyUser' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.appSlug).toBe('default');
      expect(body.fromBody).toBe('LegacyUser');
    });

    it('should isolate host environment and prevent access to process, fs, require', async () => {
      const fn = app.functions.createFunction({
        name: 'security-escape-attempt',
        code: `
          export default async function(core, context) {
            const results = {};
            results.hasProcess = typeof process !== 'undefined';
            results.hasRequire = typeof require !== 'undefined';
            results.hasBuffer = typeof Buffer !== 'undefined';
            try {
              results.protoEscape = ({}).constructor.constructor("return process")();
            } catch(e) {
              results.protoEscape = 'blocked';
            }
            return { status: 200, body: results };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/functions/security-escape-attempt/invoke',
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.hasProcess).toBe(false);
      expect(data.hasRequire).toBe(false);
      expect(data.hasBuffer).toBe(false);
      expect(data.protoEscape).toBe('blocked');
    });

    it('should enforce CPU execution timeout without locking the event loop', async () => {
      const fn = app.functions.createFunction({
        name: 'infinite-loop',
        code: `
          export default async function(core, context) {
            while (true) {}
            return { status: 200, body: 'never reached' };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 300, // Short 300ms timeout
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const start = Date.now();
      const res = await app.server.inject({
        method: 'POST',
        url: '/api/functions/infinite-loop/invoke',
      });
      const duration = Date.now() - start;

      expect(res.statusCode).toBe(504);
      expect(res.json().message).toContain('timed out');
      expect(duration).toBeLessThan(2000); // Interrupted promptly
    });

    it('should abort and return 504 when function is suspended on an unresolved promise', async () => {
      app.functions.createFunction({
        name: 'suspended-promise',
        code: `
          export default async function(core, context) {
            await new Promise(() => {});
            return { status: 200, body: 'never reached' };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 300,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const start = Date.now();
      const res = await app.server.inject({
        method: 'POST',
        url: '/api/functions/suspended-promise/invoke',
      });
      const duration = Date.now() - start;

      expect(res.statusCode).toBe(504);
      expect(res.json().message).toContain('timed out');
      expect(duration).toBeLessThan(2000);
    });

    it('should support anonymous async functions and arrow functions', async () => {
      // 1. Anonymous async function
      app.functions.createFunction({
        name: 'anon-async-fn',
        code: `
          // leading comment
          async function(core, context) {
            return { status: 200, body: { msg: 'from anon async' } };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['GET'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const res1 = await app.server.inject({
        method: 'GET',
        url: '/api/functions/anon-async-fn/invoke',
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json().msg).toBe('from anon async');

      // 2. Arrow function
      app.functions.createFunction({
        name: 'arrow-fn',
        code: `
          /* block comment */
          async (core, context) => ({ status: 200, body: { msg: 'from arrow fn' } })
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['GET'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const res2 = await app.server.inject({
        method: 'GET',
        url: '/api/functions/arrow-fn/invoke',
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().msg).toBe('from arrow fn');
    });

    it('should capture console.log and ctx.log in execution logs', async () => {
      const fn = app.functions.createFunction({
        name: 'logging-fn',
        code: `
          export default async function(core, context) {
            console.log("Step 1: start processing");
            core.observability.log("Step 2: performing calculation", 42);
            return { status: 200, body: { done: true } };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/functions/logging-fn/invoke',
      });
      expect(res.statusCode).toBe(200);

      // Verify logs table
      const logsRes = await app.server.inject({
        method: 'GET',
        url: `/api/functions/${fn.id}/logs`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(logsRes.statusCode).toBe(200);
      const logsData = logsRes.json();
      expect(logsData.items.length).toBeGreaterThan(0);
      const latestLog = logsData.items[0];
      expect(latestLog.logs).toContain('Step 1: start processing');
      expect(latestLog.logs).toContain('Step 2: performing calculation 42');
      expect(latestLog.status).toBe('success');
    });

    it('should inject scoped env secrets into ctx.env without exposing process.env', async () => {
      const fn = app.functions.createFunction({
        name: 'secret-reader',
        code: `
          export default async function(core, context) {
            return {
              status: 200,
              body: {
                apiKey: context.env.MY_SECRET_KEY,
                hasJwtSecret: typeof context.env.JWT_SECRET !== 'undefined'
              }
            };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['GET', 'POST'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: { MY_SECRET_KEY: 'sk_live_123456789' },
      });

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/functions/secret-reader/invoke',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.apiKey).toBe('sk_live_123456789');
      expect(body.hasJwtSecret).toBe(false);
    });
  });

  // ==========================================
  // 3. Database Scoping & Least Privilege
  // ==========================================
  describe('3. Database Scoping & Least Privilege (ctx.records)', () => {
    it('should enforce RuleEngine access rules for standard functions', async () => {
      // Create order owned by 'buyer'
      const order = await app.records.create('orders', {
        title: 'Laptop Order',
        amount: 1200,
        status: 'pending',
        owner: userId,
      });

      // Function that tries to list orders using ctx.records
      const fn = app.functions.createFunction({
        name: 'list-my-orders',
        code: `
          export default async function(core, context) {
            const list = await core.sdk.collection('orders').list();
            return { status: 200, body: list };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['GET'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false, // Standard (respects caller permissions)
        env: {},
      });

      // 1. Unauthenticated request -> listRule (@request.auth.id = owner) returns empty
      const anonRes = await app.server.inject({
        method: 'GET',
        url: '/api/functions/list-my-orders/invoke',
      });
      expect(anonRes.statusCode).toBe(200);
      expect(anonRes.json().items.length).toBe(0);

      // 2. Authenticated as 'buyer' -> matches listRule, returns order
      const authRes = await app.server.inject({
        method: 'GET',
        url: '/api/functions/list-my-orders/invoke',
        headers: { Authorization: `Bearer ${userToken}` },
      });
      expect(authRes.statusCode).toBe(200);
      const authItems = authRes.json().items;
      expect(authItems.length).toBeGreaterThan(0);
      expect(authItems[0].owner).toBe(userId);
    });

    it('should bypass rules only when elevated flag is true (Service Role)', async () => {
      const fn = app.functions.createFunction({
        name: 'admin-count-orders',
        code: `
          export default async function(core, context) {
            const list = await core.sdk.collection('orders').list();
            return { status: 200, body: { total: list.totalItems } };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['GET'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: true, // Elevated service role
        env: {},
      });

      // Even unauthenticated caller gets total because function runs elevated
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/functions/admin-count-orders/invoke',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBeGreaterThan(0);
    });

    it('should support record mutations via ctx.records.create and update', async () => {
      const fn = app.functions.createFunction({
        name: 'create-order-function',
        code: `
          export default async function(core, context) {
            const body = context.request.body;
            const newOrder = await core.sdk.collection('orders').create({
              title: body.title,
              amount: body.amount,
              status: 'processed',
              owner: context.request.auth ? context.request.auth.id : 'anon'
            });
            return { status: 201, body: newOrder };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/functions/create-order-function/invoke',
        payload: { title: 'Headphones', amount: 150 },
      });

      expect(res.statusCode).toBe(201);
      const created = res.json();
      expect(created.title).toBe('Headphones');
      expect(created.amount).toBe(150);
      expect(created.status).toBe('processed');
    });
  });

  // ==========================================
  // 4. Lifecycle Event Hooks Dispatcher
  // ==========================================
  describe('4. Lifecycle Event Hooks (beforeCreate / afterUpdate)', () => {
    it('should execute function beforeCreate hook and mutate incoming data', async () => {
      app.functions.createFunction({
        name: 'order-slugifier',
        code: `
          export default async function(core, context) {
            if (context.event && context.event.record) {
              const rec = context.event.record;
              rec.status = 'auto-validated';
              return { status: 200, body: { record: rec } };
            }
            return { status: 200 };
          }
        `,
        enabled: true,
        authPolicy: 'admin',
        methods: ['*'],
        eventTrigger: 'orders:beforeCreate',
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const created = await app.records.create('orders', {
        title: 'Smartwatch',
        amount: 299,
        status: 'raw',
      });

      expect(created.status).toBe('auto-validated');
    });

    it('should cancel record creation when beforeCreate returns cancel: true', async () => {
      app.functions.createFunction({
        name: 'order-guard-price',
        code: `
          export default async function(core, context) {
            if (context.event && context.event.record) {
              if (context.event.record.amount < 0) {
                return { status: 200, body: { cancel: true, reason: 'Amount cannot be negative' } };
              }
            }
            return { status: 200 };
          }
        `,
        enabled: true,
        authPolicy: 'admin',
        methods: ['*'],
        eventTrigger: 'orders:beforeCreate',
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      await expect(
        app.records.create('orders', {
          title: 'Negative Order',
          amount: -50,
        })
      ).rejects.toThrow('Amount cannot be negative');
    });

    it('should prevent infinite circular recursion when a hook triggers matching mutations', async () => {
      const loopFn = app.functions.createFunction({
        name: 'infinite-loop-hook',
        code: `
          export default async function(core, context) {
            // Attempt to infinitely recurse by creating another order
            await core.sdk.collection('orders').create({ title: 'Recursive Order', amount: 10 });
            return { status: 200 };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['*'],
        eventTrigger: 'orders:beforeCreate',
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: true,
        env: {},
      });

      await expect(
        app.records.create('orders', {
          title: 'Initial Order',
          amount: 50,
        })
      ).rejects.toThrow(/Circular recursion detected|Maximum function recursion depth/);
      app.functions.deleteFunction(loopFn.id);
    });

    it('should enforce maxConcurrent concurrency admission limit during lifecycle hooks', async () => {
      const concFn = app.functions.createFunction({
        name: 'concurrency-hook-test',
        code: `
          export default async function(core, context) {
            return { status: 200 };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['*'],
        eventTrigger: 'orders:beforeCreate',
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      // Temporarily saturate active executions up to maxConcurrent
      const max = (app.functions as any).maxConcurrent;
      (app.functions as any).activeExecutions = max;

      try {
        await expect(
          app.records.create('orders', {
            title: 'Throttled Order',
            amount: 100,
          })
        ).rejects.toThrow(/Serverless function concurrency limit reached/);
      } finally {
        (app.functions as any).activeExecutions = 0;
        app.functions.deleteFunction(concFn.id);
      }
    });

    it('should wake queue workers on completion of record event hook execution', async () => {
      const wakeSpy = vi.spyOn(app.queue, 'wakeAllWorkers');

      const hookFn = app.functions.createFunction({
        name: 'wake-worker-hook-test',
        code: `
          export default async function(core, context) {
            return { status: 200 };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['*'],
        eventTrigger: 'orders:beforeCreate',
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      try {
        await app.records.create('orders', {
          title: 'Wake Worker Order',
          amount: 50,
        });

        expect(wakeSpy).toHaveBeenCalled();
      } finally {
        wakeSpy.mockRestore();
        app.functions.deleteFunction(hookFn.id);
      }
    });
  });

  // ==========================================
  // 5. Auth Policy & Admin CRUD API
  // ==========================================
  describe('5. Auth Policy Enforcement & Admin API', () => {
    it('should validate and reject invalid authPolicy during createFunction and updateFunction', async () => {
      // 1. Direct service createFunction validation
      expect(() => {
        app.functions.createFunction({
          name: 'invalid-auth-fn',
          code: `export default async function() { return { status: 200 }; }`,
          enabled: true,
          authPolicy: 'admni' as any,
          methods: ['GET'],
          timeoutMs: 1000,
          memoryLimitMb: 32,
          allowedDomains: [],
          elevated: false,
          env: {},
        });
      }).toThrow(/Invalid auth policy 'admni'/);

      // 2. HTTP POST /api/functions validation
      const postRes = await app.server.inject({
        method: 'POST',
        url: '/api/functions',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'typo-auth-fn',
          code: `export default async function() { return { status: 200 }; }`,
          authPolicy: 'adminOrInitial',
        },
      });
      expect(postRes.statusCode).toBe(422);
      expect(postRes.json().message).toContain("Invalid auth policy 'adminOrInitial'");

      // 3. Create valid function, then reject invalid updateFunction
      const validFn = app.functions.createFunction({
        name: 'valid-to-update-fn',
        code: `export default async function() { return { status: 200 }; }`,
        enabled: true,
        authPolicy: 'admin',
        methods: ['GET'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      expect(() => {
        app.functions.updateFunction(validFn.id, { authPolicy: 'unknownPolicy' as any });
      }).toThrow(/Invalid auth policy 'unknownPolicy'/);

      const patchRes = await app.server.inject({
        method: 'PATCH',
        url: `/api/functions/${validFn.id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { authPolicy: 'superadmin' },
      });
      expect(patchRes.statusCode).toBe(422);
      expect(patchRes.json().message).toContain("Invalid auth policy 'superadmin'");
    });

    it('should reject invocation with 403 when database contains an unsupported authPolicy', async () => {
      // Directly insert a function with corrupt/unsupported authPolicy into DB
      const corruptId = 'fn_corrupt_auth';
      app.db.prepare(`
        INSERT INTO _functions (
          id, name, description, code, enabled, authPolicy, methods,
          eventTrigger, timeoutMs, memoryLimitMb, allowedDomains,
          elevated, env, created, updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        corruptId,
        'corrupt-auth-fn',
        'Corrupt auth policy test',
        'export default async function() { return { status: 200, body: "should not be public" }; }',
        1,
        'admni',
        'GET',
        null,
        1000,
        32,
        '[]',
        0,
        '{}',
        new Date().toISOString(),
        new Date().toISOString()
      );

      // Invoke should be rejected with 403 instead of falling into default public access
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/functions/corrupt-auth-fn/invoke',
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain("Unsupported auth policy 'admni'");
    });

    it('should reject unauthenticated call when authPolicy is "admin"', async () => {
      app.functions.createFunction({
        name: 'admin-only-fn',
        code: `export default async function() { return { status: 200, body: "admin secret" }; }`,
        enabled: true,
        authPolicy: 'admin',
        methods: ['GET'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      // Anonymous -> 403
      const anonRes = await app.server.inject({
        method: 'GET',
        url: '/api/functions/admin-only-fn/invoke',
      });
      expect(anonRes.statusCode).toBe(403);

      // Admin -> 200
      const adminRes = await app.server.inject({
        method: 'GET',
        url: '/api/functions/admin-only-fn/invoke',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(adminRes.statusCode).toBe(200);
      expect(adminRes.body).toBe('admin secret');
    });

    it('should support live testing via POST /api/functions/:id/test', async () => {
      const fn = app.functions.createFunction({
        name: 'echo-test',
        code: `export default async function(core, context) { return { status: 200, body: { echoed: context.request.body } }; }`,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const res = await app.server.inject({
        method: 'POST',
        url: `/api/functions/${fn.id}/test`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { body: { ping: 'pong' } },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.status).toBe('success');
      expect(data.body.echoed.ping).toBe('pong');
    });

    it('should report functions stats via GET /api/functions/stats', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/functions/stats',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const stats = res.json();
      expect(stats.totalFunctions).toBeGreaterThan(0);
      expect(stats.activeFunctions).toBeGreaterThan(0);
      expect(stats.totalExecutions).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // 6. Pluggable Runtime Boundary (Replaceability)
  // ==========================================
  describe('6. Pluggable Runtime Boundary (IFunctionRuntime)', () => {
    it('should allow replacing the runtime engine dynamically', async () => {
      const runner = app.functions.getRunner();

      // Create a mock replacement runtime implementing IFunctionRuntime
      const mockCustomRuntime: IFunctionRuntime = {
        name: 'Mock-Custom-Runtime',
        version: '1.0.0',
        init: vi.fn(async () => {}),
        execute: vi.fn(async (code: string, hostServices: FunctionHostServices, opts: RuntimeExecutionOptions) => {
          return {
            status: 'success',
            statusCode: 200,
            body: { engine: 'Mock-Custom-Runtime', processedCodeLength: code.length },
            headers: { 'x-runtime': 'mock-v1' },
            durationMs: 1,
            logs: ['Executed in mock runtime'],
          };
        }),
        dispose: vi.fn(async () => {}),
      };

      // Swap the runtime
      const originalRuntime = (runner as any).runtime;
      runner.setRuntime(mockCustomRuntime);

      expect(runner.getRuntimeInfo().name).toBe('Mock-Custom-Runtime');

      // Test execution through the swapped runtime
      const testRes = await runner.execute('const x = 1;', {
        sdk: { records: {} as any, queue: {} as any },
        network: { fetch: {} as any },
        observability: { log: () => {}, metric: () => {} },
        context: {
          app: { id: 'default', slug: 'default' },
          env: {},
        },
      });

      expect(testRes.status).toBe('success');
      expect(testRes.body.engine).toBe('Mock-Custom-Runtime');
      expect(testRes.headers?.['x-runtime']).toBe('mock-v1');
      expect(mockCustomRuntime.execute).toHaveBeenCalled();

      // Restore original runtime
      runner.setRuntime(originalRuntime);
      expect(runner.getRuntimeInfo().name).toBe('QuickJS-Wasm');
    });
  });

  // ==========================================
  // 7. Admin UI Bundling & DOM Elements
  // ==========================================
  describe('7. Admin UI Bundling & DOM Elements', () => {
    it('should bundle functions.js and update sidebar-functions-count badge when functions stats are loaded', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const { JSDOM } = await import('jsdom');

      const bundledHtmlPath = path.resolve('dist/admin/ui/index.html');
      const html = fs.readFileSync(bundledHtmlPath, 'utf8');

      expect(html).toContain('id="sidebar-functions-count"');
      expect(html).toContain('id="page-view-functions"');
      expect(html).toContain('loadFunctionStats');

      const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'http://localhost:8090/_/',
        beforeParse(window: any) {
          window.fetch = vi.fn().mockImplementation(async () => ({
            ok: true,
            json: async () => ({ hasAdmins: true }),
          }));
        },
      });
      const win = dom.window as any;
      const doc = win.document;

      const badge = doc.getElementById('sidebar-functions-count');
      expect(badge).not.toBeNull();
      expect(badge.style.display).toBe('none');

      // Mock api to return 2 functions for stats
      win.api = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/functions/stats')) {
          return {
            totalFunctions: 2,
            activeFunctions: 2,
            totalExecutions: 5,
            successExecutions: 5,
            failedExecutions: 0,
            successRate: '100%',
          };
        }
        if (url.includes('/functions')) {
          return [{ id: 'fn_1', name: 'fn1' }, { id: 'fn_2', name: 'fn2' }];
        }
        return {};
      });

      // Call loadFunctionStats
      await win.loadFunctionStats();
      expect(badge.textContent).toBe('2');
      expect(badge.style.display).toBe('inline-block');
    }, 15000);

    it('should render dedicated Function Create Page with full-width CodeMirror and Context Reference', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const { JSDOM } = await import('jsdom');

      const bundledHtmlPath = path.resolve('dist/admin/ui/index.html');
      const html = fs.readFileSync(bundledHtmlPath, 'utf8');

      const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'http://localhost:8090/_/functions',
      });
      const win = dom.window as any;
      const doc = win.document;

      // Open create function page (dedicated workbench view)
      await win.openCreateFunctionModal();

      expect(win.functionsState.currentView).toBe('editor');
      expect(win.functionsState.activeFunctionForEdit.isNew).toBe(true);

      const pageContainer = doc.getElementById('page-view-functions');
      expect(pageContainer?.innerHTML).toContain('✨ New Function');
      expect(pageContainer?.innerHTML).toContain('Create Function');

      // Verify editable function name header
      const nameInput = doc.getElementById('fn-editor-name-header') as HTMLInputElement;
      expect(nameInput).not.toBeNull();
      win.syncEditorFunctionName('calculate-vat');
      expect(nameInput.value).toBe('calculate-vat');

      const preview = doc.getElementById('fn-editor-endpoint-preview');
      expect(preview?.textContent).toContain('/api/functions/calculate-vat/invoke');

      // Verify Context Reference panel & category filtering
      const eventFilterBtn = doc.querySelector('.ctx-cat-btn[data-cat="event"]') as HTMLButtonElement;
      expect(eventFilterBtn).not.toBeNull();
      eventFilterBtn.click();

      const eventItems = doc.querySelectorAll('.ctx-item[data-cat="event"]');
      const requestItems = doc.querySelectorAll('.ctx-item[data-cat="request"]');
      expect(eventItems[0].style.display).toBe('flex');
      expect(requestItems[0].style.display).toBe('none');

      // Test snippet insertion into code editor
      const codeEditor = doc.getElementById('fn-editor-code') as HTMLTextAreaElement;
      expect(codeEditor).not.toBeNull();
      win.insertFunctionSnippet('const testItem = await core.sdk.collection("orders").get("ord_123");\n');
      expect(codeEditor.value).toContain('await core.sdk.collection("orders").get("ord_123")');

      // Test toggle reference collapse/expand
      expect(win.functionsState.isCtxRefExpanded).toBe(false);
      const content = doc.getElementById('workbench-ctx-content');
      expect(content?.style.display).toBe('none');

      win.toggleWorkbenchCtxRef();
      expect(win.functionsState.isCtxRefExpanded).toBe(true);
      expect(content?.style.display).toBe('flex');

      win.toggleWorkbenchCtxRef();
      expect(win.functionsState.isCtxRefExpanded).toBe(false);
      expect(content?.style.display).toBe('none');

      // Test Runner tab in draft mode shows unlock prompt
      win.switchFunctionEditorTab('test');
      expect(doc.getElementById('fn-editor-pane-test')?.innerHTML).toContain('Function Not Yet Created');

      // Logs tab in draft mode shows no logs prompt
      win.switchFunctionEditorTab('logs');
      expect(doc.getElementById('fn-editor-pane-logs')?.innerHTML).toContain('No Logs Available');
    });

    it('should render dedicated Function Editor Workbench page with tabs, editor, and live sandbox runner', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const { JSDOM } = await import('jsdom');

      const bundledHtmlPath = path.resolve('dist/admin/ui/index.html');
      const html = fs.readFileSync(bundledHtmlPath, 'utf8');

      const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'http://localhost:8090/_/functions',
      });
      const win = dom.window as any;
      const doc = win.document;

      // Seed a test function in state
      const mockFn = {
        id: 'fn_workbench_test',
        name: 'calculate-shipping',
        description: 'Calculate shipping cost by weight and zone',
        code: 'export default async function(core, context) {\n  return { status: 200, body: { fee: 15 } };\n}',
        enabled: true,
        authPolicy: 'public',
        methods: ['GET', 'POST'],
        eventTrigger: 'orders:beforeCreate',
        timeoutMs: 2500,
        memoryLimitMb: 64,
        allowedDomains: ['shipping.carrier.com'],
        elevated: false,
        env: { SHIP_API_KEY: 'test_key_123' },
      };
      win.functionsState.functions = [mockFn];

      // Open dedicated editor page
      await win.openFunctionEditor('fn_workbench_test', false);

      expect(win.functionsState.currentView).toBe('editor');
      expect(win.functionsState.activeFunctionForEdit.id).toBe('fn_workbench_test');

      const pageContainer = doc.getElementById('page-view-functions');
      expect(pageContainer?.innerHTML).toContain('calculate-shipping');
      expect(pageContainer?.innerHTML).toContain('ANY /api/functions/calculate-shipping/invoke');
      expect(pageContainer?.innerHTML).toContain('orders:beforeCreate');

      // Verify 4 Workbench Tabs exist
      const tabCode = doc.getElementById('editor-tab-btn-code');
      const tabTest = doc.getElementById('editor-tab-btn-test');
      const tabConfig = doc.getElementById('editor-tab-btn-config');
      const tabLogs = doc.getElementById('editor-tab-btn-logs');
      expect(tabCode).not.toBeNull();
      expect(tabTest).not.toBeNull();
      expect(tabConfig).not.toBeNull();
      expect(tabLogs).not.toBeNull();

      // Verify Code Editor is full-width and Context Reference is collapsed by default
      const codeEditor = doc.getElementById('fn-editor-code') as HTMLTextAreaElement;
      expect(codeEditor).not.toBeNull();
      expect(codeEditor.value).toContain('fee: 15');
      expect((doc.getElementById('fn-editor-name') as HTMLInputElement).value).toBe('calculate-shipping');

      // Verify CodeMirror is initialized with TypeScript/JavaScript mode and active theme
      expect(typeof win.CodeMirror).toBe('function');
      expect(win.functionsState.cmEditor).not.toBeNull();
      expect(win.functionsState.cmEditor.getOption('mode')).toEqual({ name: 'javascript', typescript: true });
      expect(win.functionsState.cmEditor.getOption('lineNumbers')).toBe(true);

      // Verify syntax highlighting tokenization (e.g. export, default, async, function, ctx)
      const lineTokens = win.functionsState.cmEditor.getLineTokens(0);
      expect(lineTokens.some((t: any) => t.type === 'keyword' && t.string === 'export')).toBe(true);
      expect(lineTokens.some((t: any) => t.type === 'keyword' && t.string === 'default')).toBe(true);
      expect(lineTokens.some((t: any) => t.type === 'def' && (t.string === 'core' || t.string === 'context'))).toBe(true);

      // Verify CodeMirror Light & Dark Theme dynamic switching
      win.setTheme('light');
      expect(win.functionsState.cmEditor.getOption('theme')).toBe('eclipse');

      win.setTheme('dark');
      expect(win.functionsState.cmEditor.getOption('theme')).toBe('dracula');

      // Verify vertically collapsible Context Reference is collapsed by default
      expect(win.functionsState.isCtxRefExpanded).toBe(false);
      const ctxContent = doc.getElementById('workbench-ctx-content');
      expect(ctxContent).not.toBeNull();
      expect(ctxContent?.style.display).toBe('none');

      // Expand Context Reference vertically
      win.toggleWorkbenchCtxRef();
      expect(win.functionsState.isCtxRefExpanded).toBe(true);
      expect(ctxContent?.style.display).toBe('flex');

      // Test snippet insertion directly into dedicated editor textarea
      win.insertFunctionSnippet('const weight = context.request.body.weight || 1;\n');
      expect(codeEditor.value).toContain('context.request.body.weight');

      // Test real-time context search
      win.filterCtxSearch('body');
      const bodyItem = doc.querySelector('.ctx-item[data-cat="request"]') as HTMLElement;
      expect(bodyItem).not.toBeNull();
      expect(bodyItem.style.display).not.toBe('none');

      // Collapse Context Reference again
      win.toggleWorkbenchCtxRef();
      expect(win.functionsState.isCtxRefExpanded).toBe(false);
      expect(ctxContent?.style.display).toBe('none');

      // Switch to Test Runner Tab
      win.switchFunctionEditorTab('test');
      expect(win.functionsState.editorTab).toBe('test');
      const testPane = doc.getElementById('fn-editor-pane-test');
      const codePane = doc.getElementById('fn-editor-pane-code');
      expect(testPane?.style.display).toBe('grid');
      expect(codePane?.style.display).toBe('none');

      const testBodyArea = doc.getElementById('editor-test-body') as HTMLTextAreaElement;
      expect(testBodyArea).not.toBeNull();

      // Switch to Configuration Tab
      win.switchFunctionEditorTab('config');
      expect(win.functionsState.editorTab).toBe('config');
      const configPane = doc.getElementById('fn-editor-pane-config');
      expect(configPane?.style.display).toBe('grid');
      const timeoutInput = doc.getElementById('fn-editor-timeout') as HTMLInputElement;
      expect(timeoutInput.value).toBe('2500');

      // Switch to Logs Tab
      win.switchFunctionEditorTab('logs');
      expect(win.functionsState.editorTab).toBe('logs');
      const logsPane = doc.getElementById('fn-editor-pane-logs');
      expect(logsPane?.style.display).toBe('flex');

      // Render logs in workbench logs tab and verify timestamp & Inspect payload modal
      const mockLog = {
        id: 'fnlog_test123',
        functionId: 'fn_workbench_test',
        functionName: 'calculate-shipping',
        trigger: 'http',
        status: 'success',
        statusCode: 200,
        durationMs: 28,
        requestPayload: JSON.stringify({ weight: 5, zone: 'EU' }),
        responsePayload: JSON.stringify({ fee: 15 }),
        logs: 'Invoked calculate-shipping\nCalculated zone rate: 15',
        actorId: 'adm_123',
        timestamp: '2026-10-27T16:20:00.000Z',
      };

      win.renderFunctionEditorLogsTable([mockLog]);
      win.functionsState.editorLogs = [mockLog];

      const logsContainer = doc.getElementById('fn-editor-logs-container');
      expect(logsContainer?.innerHTML).toContain('200 OK');
      expect(logsContainer?.innerHTML).toContain('28ms');
      expect(logsContainer?.innerHTML).not.toContain('<td>-</td>');

      // Click Inspect button / viewLogPayload
      await win.viewLogPayload('fnlog_test123');
      const modalRoot = doc.getElementById('modal-root');
      expect(modalRoot?.innerHTML).toContain('Execution Payload Inspector');
      expect(modalRoot?.innerHTML).toContain('Invoked calculate-shipping');
      expect(modalRoot?.innerHTML).toContain('"weight": 5');
      expect(modalRoot?.innerHTML).toContain('"fee": 15');

      // Close modal
      const closeBtn = modalRoot?.querySelector('.modal-dialog button.btn-secondary') as HTMLButtonElement;
      closeBtn?.click();
      expect(modalRoot?.querySelector('.modal-backdrop')).toBeNull();

      // Close editor and return to functions list view
      win.closeFunctionEditor(false);
      expect(win.functionsState.currentView).toBe('list');
      expect(win.functionsState.activeFunctionForEdit).toBeNull();
    });

    it('should provide core.sdk, core.network, core.observability and enforce clean break on context', async () => {
      const fn = app.functions.createFunction({
        name: 'kernel-verification-fn',
        code: `
          export default async function(core, context) {
            // 1. Verify core structure
            const hasCoreSdk = typeof core.sdk === 'object';
            const hasCollection = typeof core.sdk.collection === 'function';
            const hasQueue = typeof core.sdk.queue === 'function';
            const hasNetwork = typeof core.network?.http?.fetch === 'function';
            const hasObs = typeof core.observability?.log === 'function' && typeof core.observability?.metric === 'function';
            const version = core.version;

            // 2. Strict clean break verification: context must NOT have records, queue, or core
            const ctxRecords = context.records;
            const ctxQueue = context.queue;
            const ctxCore = context.core;

            // 3. Test core.observability.metric
            core.observability.metric('test_metric', 42, { tag: 'unit' });

            // 4. Test core.sdk.collection operations
            const created = await core.sdk.collection('orders').create({
              title: 'Kernel Order',
              amount: 88,
              status: 'valid'
            });

            const fetched = await core.sdk.collection('orders').get(created.id);

            return {
              status: 200,
              body: {
                hasCoreSdk,
                hasCollection,
                hasQueue,
                hasNetwork,
                hasObs,
                version,
                ctxRecordsUndefined: typeof ctxRecords === 'undefined',
                hasCtxQueue: typeof ctxQueue === 'function',
                ctxCoreUndefined: typeof ctxCore === 'undefined',
                fetchedAmount: fetched.amount
              }
            };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: true,
        env: {},
      });

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/functions/kernel-verification-fn/invoke',
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.hasCoreSdk).toBe(true);
      expect(data.hasCollection).toBe(true);
      expect(data.hasQueue).toBe(true);
      expect(data.hasNetwork).toBe(true);
      expect(data.hasObs).toBe(true);
      expect(data.version).toBe('2.3.0');
      expect(data.ctxRecordsUndefined).toBe(true);
      expect(data.hasCtxQueue).toBe(true);
      expect(data.ctxCoreUndefined).toBe(true);
      expect(data.fetchedAmount).toBe(88);
    });
  });

  describe('8. Syntax Flexibility, Lifecycle Safety & Cross-System Referential Integrity', () => {
    it('should execute top-level named function declarations without export default', async () => {
      const createRes = await app.server.inject({
        method: 'POST',
        url: '/api/functions',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'named-declaration-fn',
          code: `
            async function handler(core, ctx) {
              return { success: true, message: 'Executed via named function declaration' };
            }
          `,
          enabled: true,
          authPolicy: 'public',
          methods: ['GET', 'POST'],
        },
      });
      expect(createRes.statusCode).toBe(201);

      const invokeRes = await app.server.inject({
        method: 'POST',
        url: '/api/functions/named-declaration-fn/invoke',
        payload: {},
      });
      expect(invokeRes.statusCode).toBe(200);
      expect(invokeRes.json()).toEqual({ success: true, message: 'Executed via named function declaration' });
    });

    it('should safely evaluate payloads containing U+2028 and U+2029 line/paragraph separators', async () => {
      const createRes = await app.server.inject({
        method: 'POST',
        url: '/api/functions',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'unicode-separator-fn',
          code: `
            export default async function(core, ctx) {
              return { echo: ctx.request.body.text };
            }
          `,
          enabled: true,
          authPolicy: 'public',
          methods: ['POST'],
        },
      });
      expect(createRes.statusCode).toBe(201);

      const invokeRes = await app.server.inject({
        method: 'POST',
        url: '/api/functions/unicode-separator-fn/invoke',
        payload: { text: "line 1\u2028line 2\u2029paragraph 2" },
      });
      expect(invokeRes.statusCode).toBe(200);
      expect(invokeRes.json().echo).toContain('line 1');
      expect(invokeRes.json().echo).toContain('line 2');
    });

    it('should automatically synchronize referenced Task states in flows when a function is renamed', async () => {
      // 1. Create a function
      const fn = app.functions.createFunction({
        name: 'flow-target-rename-initial',
        code: 'export default async function(core, ctx) { return { ok: true }; }',
        enabled: true,
        authPolicy: 'public',
      });

      // 2. Create a flow referencing this function
      const flow = app.flows.createFlow({
        name: 'DependentFlowRenameTest',
        definition: {
          startAt: 'TaskStep',
          states: {
            TaskStep: {
              type: 'Task',
              function: 'flow-target-rename-initial',
              end: true,
            },
          },
        },
      });

      // 3. Rename the function
      app.functions.updateFunction(fn.id, {
        name: 'flow-target-renamed-final',
      });

      // 4. Verify the flow definition in DB now references the new function name
      const reloadedFlow = app.flows.getFlowById(flow.id);
      expect(reloadedFlow).toBeDefined();
      expect((reloadedFlow!.definition.states.TaskStep as any).function).toBe('flow-target-renamed-final');
    });

    it('should abort record creation with 504 Gateway Timeout when a beforeCreate hook times out', async () => {
      // Create test collection
      app.schema.createCollection({
        name: 'timeout_test_orders',
        type: 'base',
        schema: [
          { name: 'item', type: 'text' },
        ],
        createRule: '',
        listRule: '',
      });

      // Create a beforeCreate function hook that hangs/times out
      app.functions.createFunction({
        name: 'hanging-before-hook',
        code: `
          export default async function(core, ctx) {
            await new Promise(() => {});
            return { ok: true };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        timeoutMs: 150,
        eventTrigger: 'timeout_test_orders:beforeCreate',
      });

      // Attempt creating record in collection - must reject with 504 and NOT write record
      let caughtErr: any;
      try {
        await app.records.create('timeout_test_orders', { item: 'Widget A' }, { isAdmin: true, id: 'admin' });
      } catch (err: any) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr.statusCode).toBe(504);
      expect(caughtErr.message).toContain("timed out");

      // Verify no records were saved in collection
      const list = await app.records.getList('timeout_test_orders');
      expect(list.totalItems).toBe(0);
    });

    it('should respect simulated custom or unauthenticated auth contexts in function test runner', async () => {
      // Create a function that reflects back ctx.auth
      const fn = app.functions.createFunction({
        name: 'auth-inspector-fn',
        code: `
          export default async function(core, ctx) {
            return {
              auth: ctx.auth
            };
          }
        `,
        enabled: true,
        authPolicy: 'public',
      });

      // Test with custom simulated auth passed via testFunction
      const testRes = await app.functions.testFunction(
        fn.id,
        {
          auth: { id: 'simulated_user_99', role: 'customer' },
        },
        { id: 'admin_caller', isAdmin: true }
      );
      expect(testRes.status).toBe('success');
      expect(testRes.body.auth).toEqual({ id: 'simulated_user_99', role: 'customer' });

      // Test with explicit null auth (public test)
      const testNullRes = await app.functions.testFunction(
        fn.id,
        {
          auth: null,
        },
        { id: 'admin_caller', isAdmin: true }
      );
      expect(testNullRes.status).toBe('success');
      expect(testNullRes.body.auth).toBeNull();
    });

    it('should preserve full authenticated actor for normal executions while allowing mock auth overrides in testFunction', async () => {
      // 1. Create an admin-only collection (listRule: null)
      app.schema.createCollection({
        name: 'secret_vault',
        type: 'base',
        schema: [{ name: 'secretKey', type: 'text' }],
        listRule: null,
        viewRule: null,
      });

      // Insert record as admin
      await app.records.create('secret_vault', { secretKey: 'TOP_SECRET_42' }, { isAdmin: true, id: 'admin' });

      // Create a function that queries the admin-only collection
      const vaultFn = app.functions.createFunction({
        name: 'vault-reader-fn',
        code: `
          export default async function(core, ctx) {
            const list = await core.sdk.collection('secret_vault').list();
            return {
              totalItems: list.totalItems,
              items: list.items,
            };
          }
        `,
        enabled: true,
        authPolicy: 'public',
      });

      // 2. Normal execution invoked with admin actor must preserve isAdmin rule bypass
      const adminExec = await app.functions.executeFunction(vaultFn.id, undefined, {
        id: 'admin_user',
        isAdmin: true,
      });
      expect(adminExec.status).toBe('success');
      expect(adminExec.body.totalItems).toBe(1);

      // 3. Normal execution invoked with API key missing required scope must be rejected
      const apiKeyExec = await app.functions.executeFunction(vaultFn.id, undefined, {
        id: 'api_key_user',
        isApiKey: true,
        scopes: ['other_collection:read'],
      });
      expect(apiKeyExec.status).toBe('error');
      expect(apiKeyExec.error).toContain('API Key missing required scope');

      // 4. In testFunction: explicit mock auth with null (public) must override admin actor and reject admin-only list
      const mockPublicTest = await app.functions.testFunction(
        vaultFn.id,
        { auth: null },
        { id: 'admin_user', isAdmin: true }
      );
      expect(mockPublicTest.status).toBe('error');
      expect(mockPublicTest.error).toContain('not allowed to list records');

      // 5. In testFunction without mock auth: calling admin actor is preserved and list succeeds
      const adminTest = await app.functions.testFunction(
        vaultFn.id,
        {},
        { id: 'admin_user', isAdmin: true }
      );
      expect(adminTest.status).toBe('success');
      expect(adminTest.body.totalItems).toBe(1);
    });

  });

});
