import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { SsrfGuard, SsrfGuardError } from '../src/functions/security/SsrfGuard';
import { IFunctionRuntime, RuntimeExecutionOptions } from '../src/functions/runtime/IFunctionRuntime';
import { FunctionContext, FunctionExecutionResult } from '../src/functions/types';

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
      expect(SsrfGuard.isAllowedDomain('malicious-site.com', allowed)).toBe(false);

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
          export default async function(ctx) {
            const amount = ctx.request.body.amount || 0;
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

    it('should isolate host environment and prevent access to process, fs, require', async () => {
      const fn = app.functions.createFunction({
        name: 'security-escape-attempt',
        code: `
          export default async function(ctx) {
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
          export default async function(ctx) {
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
          export default async function(ctx) {
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
          async function(ctx) {
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
          async (ctx) => ({ status: 200, body: { msg: 'from arrow fn' } })
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
          export default async function(ctx) {
            console.log("Step 1: start processing");
            ctx.log("Step 2: performing calculation", 42);
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
          export default async function(ctx) {
            return {
              status: 200,
              body: {
                apiKey: ctx.env.MY_SECRET_KEY,
                hasJwtSecret: typeof ctx.env.JWT_SECRET !== 'undefined'
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
          export default async function(ctx) {
            const list = await ctx.records.list('orders');
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
          export default async function(ctx) {
            const list = await ctx.records.list('orders');
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
          export default async function(ctx) {
            const body = ctx.request.body;
            const newOrder = await ctx.records.create('orders', {
              title: body.title,
              amount: body.amount,
              status: 'processed',
              owner: ctx.request.auth ? ctx.request.auth.id : 'anon'
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
          export default async function(ctx) {
            if (ctx.event && ctx.event.record) {
              const rec = ctx.event.record;
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
          export default async function(ctx) {
            if (ctx.event && ctx.event.record) {
              if (ctx.event.record.amount < 0) {
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
      app.functions.createFunction({
        name: 'infinite-loop-hook',
        code: `
          export default async function(ctx) {
            // Attempt to infinitely recurse by creating another order
            await ctx.records.create('orders', { title: 'Recursive Order', amount: 10 });
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
    });

    it('should enforce maxConcurrent concurrency admission limit during lifecycle hooks', async () => {
      app.functions.createFunction({
        name: 'concurrency-hook-test',
        code: `
          export default async function(ctx) {
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
          routePath, eventTrigger, timeoutMs, memoryLimitMb, allowedDomains,
          elevated, env, created, updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        corruptId,
        'corrupt-auth-fn',
        'Corrupt auth policy test',
        'export default async function() { return { status: 200, body: "should not be public" }; }',
        1,
        'admni',
        'GET',
        null,
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
        code: `export default async function(ctx) { return { status: 200, body: { echoed: ctx.request.body } }; }`,
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
        execute: vi.fn(async (code: string, ctx: FunctionContext, opts: RuntimeExecutionOptions) => {
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
        app: { id: 'default', slug: 'default' },
        records: {} as any,
        fetch: {} as any,
        env: {},
        log: () => {},
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
    });
  });
});
