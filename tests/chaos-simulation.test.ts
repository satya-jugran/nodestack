import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { NodeStackClient, ClientResponseError, MemoryAuthStore } from '../packages/client/src';

describe('Latency & Chaos Simulation (For Testing Frontend States)', () => {
  const testDir = path.resolve(__dirname, '../.test_chaos_data');
  const port = 8299;
  let app: NodeStack;
  let client: NodeStackClient;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDir,
      port,
      appName: 'Chaos Simulation Test App',
    });

    // Create 'posts' collection for testing
    app.schema.createCollection({
      name: 'posts',
      type: 'base',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_body', name: 'body', type: 'text' },
      ],
    });

    // Seed test post
    await app.records.create('posts', {
      title: 'Hello Chaos World',
      body: 'Testing frontend spinners & error states',
    });

    await app.start(port);

    client = new NodeStackClient(`http://127.0.0.1:${port}`, {
      authStore: new MemoryAuthStore(),
    });
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('1. Latency Simulation via Query Parameters (?mock_delay)', () => {
    it('should simulate network delay and set x-simulated-delay header', async () => {
      const delayMs = 150;
      const start = Date.now();
      const res = await app.server.inject({
        method: 'GET',
        url: `/api/collections/posts/records?mock_delay=${delayMs}`,
      });
      const elapsed = Date.now() - start;

      expect(res.statusCode).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(130);
      expect(res.headers['x-simulated-delay']).toBe(String(delayMs));

      const body = JSON.parse(res.payload);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0].title).toBe('Hello Chaos World');
    });

    it('should support duration units like 150ms or 0.2s in mock_delay', async () => {
      const start = Date.now();
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records?mock_delay=0.15s',
      });
      const elapsed = Date.now() - start;

      expect(res.statusCode).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(130);
      expect(res.headers['x-simulated-delay']).toBe('150');
    });

    it('should support range delay (e.g. mock_delay=100-200) for mobile jitter', async () => {
      const start = Date.now();
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records?mock_delay=100-200',
      });
      const elapsed = Date.now() - start;

      expect(res.statusCode).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(80);
      const simulatedDelay = Number(res.headers['x-simulated-delay']);
      expect(simulatedDelay).toBeGreaterThanOrEqual(100);
      expect(simulatedDelay).toBeLessThanOrEqual(200);
    });

    it('should support camelCase mockDelay query parameter alias', async () => {
      const start = Date.now();
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records?mockDelay=120',
      });
      const elapsed = Date.now() - start;

      expect(res.statusCode).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(res.headers['x-simulated-delay']).toBe('120');
    });
  });

  describe('2. HTTP Error Simulation via Query Parameters (?mock_error)', () => {
    it('should simulate HTTP 500 error on ?mock_error=500', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records?mock_error=500',
      });

      expect(res.statusCode).toBe(500);
      expect(res.headers['x-simulated-chaos']).toBe('true');
      expect(res.headers['x-simulated-error']).toBe('500');

      const body = JSON.parse(res.payload);
      expect(body.statusCode).toBe(500);
      expect(body.chaos).toBe(true);
      expect(body.message).toContain('mock_error=500');
      expect(body.data.simulated).toBe(true);
      expect(body.data.mockError).toBe(500);
    });

    it('should simulate specific error status codes (e.g. 503, 429, 404)', async () => {
      const res503 = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records?mock_error=503',
      });
      expect(res503.statusCode).toBe(503);
      expect(JSON.parse(res503.payload).statusCode).toBe(503);

      const res429 = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records?mock_error=429',
      });
      expect(res429.statusCode).toBe(429);
      expect(JSON.parse(res429.payload).statusCode).toBe(429);
    });

    it('should support custom error messages via ?mock_error_message', async () => {
      const customMsg = 'Database connection timed out during replication';
      const res = await app.server.inject({
        method: 'GET',
        url: `/api/collections/posts/records?mock_error=500&mock_error_message=${encodeURIComponent(customMsg)}`,
      });

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.payload);
      expect(body.message).toBe(customMsg);
    });
  });

  describe('3. Random Network Drop Simulation (?mock_fail_rate)', () => {
    it('should fail 100% of the time when ?mock_fail_rate=1.0', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records?mock_fail_rate=1.0',
      });

      expect(res.statusCode).toBe(500);
      expect(res.headers['x-simulated-chaos']).toBe('true');
      expect(res.headers['x-simulated-fail-rate']).toBe('1');
    });

    it('should never fail when ?mock_fail_rate=0.0', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records?mock_fail_rate=0.0',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-simulated-chaos']).toBeUndefined();
    });

    it('should support percentage string e.g. mock_fail_rate=20%', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records?mock_fail_rate=100%',
      });

      expect(res.statusCode).toBe(500);
      expect(res.headers['x-simulated-fail-rate']).toBe('1');
    });

    it('should simulate realistic intermittent failures (~20% drops)', async () => {
      let fails = 0;
      const total = 40;

      for (let i = 0; i < total; i++) {
        const res = await app.server.inject({
          method: 'GET',
          url: '/api/collections/posts/records?mock_fail_rate=0.25',
        });
        if (res.statusCode === 500) {
          fails++;
        }
      }

      // 25% failure rate over 40 requests should have at least 1 failure and at least 1 success
      expect(fails).toBeGreaterThan(0);
      expect(fails).toBeLessThan(total);
    });

    it('should allow pairing mock_fail_rate with custom mock_error code (e.g. 503)', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records?mock_fail_rate=1.0&mock_error=503',
      });

      expect(res.statusCode).toBe(503);
      expect(res.headers['x-simulated-error']).toBe('503');
    });
  });

  describe('4. Combined Latency + Chaos Simulation', () => {
    it('should delay response first, then return error state to test loading spinner + toast', async () => {
      const delayMs = 150;
      const start = Date.now();
      const res = await app.server.inject({
        method: 'GET',
        url: `/api/collections/posts/records?mock_delay=${delayMs}&mock_error=500`,
      });
      const elapsed = Date.now() - start;

      expect(res.statusCode).toBe(500);
      expect(elapsed).toBeGreaterThanOrEqual(130);
      expect(res.headers['x-simulated-delay']).toBe(String(delayMs));
      expect(res.headers['x-simulated-chaos']).toBe('true');
      expect(res.headers['x-simulated-error']).toBe('500');

      const body = JSON.parse(res.payload);
      expect(body.chaos).toBe(true);
      expect(body.data.mockDelay).toBe(delayMs);
      expect(body.data.mockError).toBe(500);
    });
  });

  describe('5. Header-based Simulation (x-mock-delay, x-mock-error, x-mock-fail-rate)', () => {
    it('should respect x-mock-delay header', async () => {
      const start = Date.now();
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records',
        headers: {
          'x-mock-delay': '140',
        },
      });
      const elapsed = Date.now() - start;

      expect(res.statusCode).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(120);
      expect(res.headers['x-simulated-delay']).toBe('140');
    });

    it('should respect x-mock-error header', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records',
        headers: {
          'x-mock-error': '502',
        },
      });

      expect(res.statusCode).toBe(502);
      expect(res.headers['x-simulated-chaos']).toBe('true');
      expect(res.headers['x-simulated-error']).toBe('502');
    });

    it('should give query parameters precedence over headers', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records?mock_error=403',
        headers: {
          'x-mock-error': '500',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.headers['x-simulated-error']).toBe('403');
    });

    it('should NOT block CORS preflight OPTIONS requests even if simulation headers are passed', async () => {
      const res = await app.server.inject({
        method: 'OPTIONS',
        url: '/api/collections/posts/records',
        headers: {
          'x-mock-error': '500',
          'origin': 'http://localhost:3000',
          'access-control-request-method': 'GET',
        },
      });

      // OPTIONS must succeed without returning 500 error so browser CORS handshake passes
      expect(res.statusCode).not.toBe(500);
    });
  });

  describe('6. Programmatic Server Control (app.chaos)', () => {
    it('should allow dynamically enabling and disabling chaos options', async () => {
      // Enable global chaos
      app.chaos.setOptions({
        mockError: 504,
      });

      const resWithChaos = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records',
      });
      expect(resWithChaos.statusCode).toBe(504);

      // Reset
      app.chaos.reset();

      const resAfterReset = await app.server.inject({
        method: 'GET',
        url: '/api/collections/posts/records',
      });
      expect(resAfterReset.statusCode).toBe(200);
    });
  });

  describe('7. NodeStackClient SDK Integration', () => {
    it('should support query-level simulation in client.collection.getList', async () => {
      const start = Date.now();
      const list = await client.collection('posts').getList({
        mock_delay: 150,
      });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(130);
      expect(list.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle simulated errors in client as typed ClientResponseError', async () => {
      let caughtError: ClientResponseError | null = null;
      try {
        await client.collection('posts').getList({
          mock_error: 500,
        });
      } catch (err: any) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ClientResponseError);
      expect(caughtError?.status).toBe(500);
      expect(caughtError?.data?.chaos).toBe(true);
      expect(caughtError?.message).toContain('mock_error=500');
    });

    it('should support client.setChaos for app-wide frontend testing', async () => {
      // Simulate client-wide mobile latency & errors
      client.setChaos({
        delay: 120,
        errorStatus: 503,
      });

      let caughtError: ClientResponseError | null = null;
      const start = Date.now();
      try {
        await client.collection('posts').getList();
      } catch (err: any) {
        caughtError = err;
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(caughtError).toBeInstanceOf(ClientResponseError);
      expect(caughtError?.status).toBe(503);

      // Turn off chaos on client
      client.setChaos(null);
      const normalList = await client.collection('posts').getList();
      expect(normalList.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('8. Security Gating, Protected Endpoints & Production DoS Protection', () => {
    it('should NEVER allow mock_error or mock_delay to disrupt public health check (/api/health)', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/health?mock_error=500&mock_delay=2000',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('ok');
      expect(res.headers['x-simulated-chaos']).toBeUndefined();
      expect(res.headers['x-simulated-delay']).toBeUndefined();
    });

    it('should NEVER allow mock_error or mock_delay to disrupt admin auth endpoint (/api/admins/auth-with-password)', async () => {
      const res = await app.server.inject({
        method: 'POST',
        url: '/api/admins/auth-with-password?mock_error=500',
        payload: {
          email: 'nonexistent@nodestack.io',
          password: 'wrong',
        },
      });

      // Should fail with normal 400/401 auth error, NOT simulated 500 chaos error
      expect(res.statusCode).not.toBe(500);
      expect(res.headers['x-simulated-chaos']).toBeUndefined();
    });

    it('should clamp mock_delay to maxMockDelayMs limit', () => {
      // Direct unit check on middleware parseDelay
      const clamped = app.chaos.parseDelay(999999);
      expect(clamped).toBeLessThanOrEqual(15000);
    });

    it('should ignore unauthenticated chaos parameters in production mode (chaosEnabled: false)', async () => {
      const prodDir = path.resolve(__dirname, '../.test_chaos_prod_data');
      if (fs.existsSync(prodDir)) {
        fs.rmSync(prodDir, { recursive: true, force: true });
      }

      const prodApp = new NodeStack({
        dataDir: prodDir,
        dev: false,
        chaosEnabled: false,
      });

      // Seed a post
      prodApp.schema.createCollection({
        name: 'articles',
        type: 'base',
        listRule: '',
        createRule: '',
        schema: [{ id: 'f_title', name: 'title', type: 'text' }],
      });
      await prodApp.records.create('articles', { title: 'Production Article' });

      // Unauthenticated caller tries to trigger chaos
      const unauthRes = await prodApp.server.inject({
        method: 'GET',
        url: '/api/collections/articles/records?mock_error=500&mock_delay=5000',
      });

      // Must NOT fail with 500, must NOT delay, must succeed normally
      expect(unauthRes.statusCode).toBe(200);
      expect(unauthRes.headers['x-simulated-chaos']).toBeUndefined();
      expect(unauthRes.headers['x-simulated-delay']).toBeUndefined();

      // Create super admin on prodApp to test admin authorization override
      await prodApp.auth.createAdmin('admin@prod.io', 'secret123');
      const auth = await prodApp.auth.authenticateAdmin('admin@prod.io', 'secret123');

      // Authenticated admin CAN test chaos even in production mode
      const adminRes = await prodApp.server.inject({
        method: 'GET',
        url: '/api/collections/articles/records?mock_error=502',
        headers: { authorization: `Bearer ${auth.token}` },
      });

      expect(adminRes.statusCode).toBe(502);
      expect(adminRes.headers['x-simulated-chaos']).toBe('true');

      prodApp.db.close();
      if (fs.existsSync(prodDir)) {
        fs.rmSync(prodDir, { recursive: true, force: true });
      }
    });
  });
});

