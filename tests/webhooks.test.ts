import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { JSDOM } from 'jsdom';
import { NodeStack } from '../src/NodeStack';
import { WebhookService } from '../src/webhooks/WebhookService';
import { AdminUIBundler } from '../src/admin/AdminUIBundler';
import { webhookPlugin } from '../src/plugins/webhooks';

describe('Webhooks Manager — Outbound Webhooks & Delivery Logs', () => {
  const testDir = path.resolve(__dirname, '../.test_webhooks_nodestack_data');
  let app: NodeStack;
  let adminToken = '';
  let capturedOutboundRequests: Array<{ url: string; options: any; body: any }> = [];

  const mockFetch = vi.fn(async (url: string, options: any) => {
    // Mirror WHATWG Fetch: reject body on GET and HEAD
    if ((options.method === 'GET' || options.method === 'HEAD') && options.body !== undefined) {
      throw new TypeError('Request with GET/HEAD method cannot have body');
    }

    let bodyObj = null;
    try {
      bodyObj = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    } catch {
      bodyObj = options.body;
    }
    capturedOutboundRequests.push({ url, options, body: bodyObj });

    // If target URL contains 'fail-endpoint', simulate 500 error
    if (url.includes('fail-endpoint')) {
      return {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ error: 'Endpoint crashed' }),
      } as any;
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ received: true, id: 'ext_123' }),
    } as any;
  });

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDir,
      port: 8098,
    });

    // Provide mock fetch for testing outbound HTTP calls
    app.webhooks.setFetch(mockFetch as any);

    // Create admin account
    await app.auth.createAdmin('webhook_admin@nodestack.io', 'supersecret123');
    const authRes = await app.auth.authenticateAdmin('webhook_admin@nodestack.io', 'supersecret123');
    adminToken = authRes.token;

    // Create 'posts' and 'orders' collections
    app.schema.createCollection({
      name: 'posts',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_content', name: 'content', type: 'text', required: false },
        { id: 'f_status', name: 'status', type: 'select', options: { values: ['draft', 'published'] } },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });

    app.schema.createCollection({
      name: 'orders',
      type: 'base',
      schema: [
        { id: 'f_item', name: 'item', type: 'text', required: true },
        { id: 'f_amount', name: 'amount', type: 'number', required: true },
        { id: 'f_status', name: 'status', type: 'select', options: { values: ['pending', 'completed', 'canceled'] } },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ==========================================
  // 1. Pure Unit Tests: Signatures & Matching
  // ==========================================
  describe('1. WebhookService Signature & Event Matching Logic', () => {
    const secret = 'whsec_test_secret_12345';
    const payload = {
      event: 'post.created',
      collection: 'posts',
      action: 'created',
      record: { id: 'p_1', title: 'Hello World' },
    };

    it('should compute valid HMAC-SHA256 signature', () => {
      const sig = WebhookService.computeSignature(payload, secret);
      expect(typeof sig).toBe('string');
      expect(sig).toHaveLength(64); // 256-bit hex string

      // Verify independently with Node's crypto
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload), 'utf8')
        .digest('hex');
      expect(sig).toBe(expected);
    });

    it('should verify signature with raw hex, sha256= prefix, and reject invalid signatures', () => {
      const sig = WebhookService.computeSignature(payload, secret);

      // (a) Exact hex
      expect(WebhookService.verifySignature(payload, sig, secret)).toBe(true);

      // (b) With sha256= prefix
      expect(WebhookService.verifySignature(payload, `sha256=${sig}`, secret)).toBe(true);

      // (c) With sha256: prefix
      expect(WebhookService.verifySignature(payload, `sha256:${sig}`, secret)).toBe(true);

      // (d) Tampered payload
      const tampered = { ...payload, action: 'deleted' };
      expect(WebhookService.verifySignature(tampered, sig, secret)).toBe(false);

      // (e) Wrong secret
      expect(WebhookService.verifySignature(payload, sig, 'wrong_secret')).toBe(false);

      // (f) Empty header
      expect(WebhookService.verifySignature(payload, '', secret)).toBe(false);
    });

    it('should correctly match collection + event patterns (post.created, order.updated)', () => {
      const service = app.webhooks;

      // 1. Specific collection & specific event: post.created
      const postWebhook = { collection: 'posts', event: 'post.created', action: 'created', enabled: true };
      expect(service.matchesEvent(postWebhook, 'posts', 'created')).toBe(true);
      expect(service.matchesEvent(postWebhook, 'post', 'created')).toBe(true); // singular
      expect(service.matchesEvent(postWebhook, 'posts', 'updated')).toBe(false);
      expect(service.matchesEvent(postWebhook, 'orders', 'created')).toBe(false);

      // 2. Specific collection & specific event: order.updated
      const orderWebhook = { collection: 'orders', event: 'order.updated', action: 'updated', enabled: true };
      expect(service.matchesEvent(orderWebhook, 'orders', 'updated')).toBe(true);
      expect(service.matchesEvent(orderWebhook, 'order', 'updated')).toBe(true);
      expect(service.matchesEvent(orderWebhook, 'orders', 'created')).toBe(false);

      // 3. Wildcard collection & wildcard event: *.*
      const wildcardWebhook = { collection: '*', event: '*', action: '*', enabled: true };
      expect(service.matchesEvent(wildcardWebhook, 'posts', 'created')).toBe(true);
      expect(service.matchesEvent(wildcardWebhook, 'orders', 'updated')).toBe(true);
      expect(service.matchesEvent(wildcardWebhook, 'anything', 'deleted')).toBe(true);

      // 4. Singular / present-tense forms (create, update, delete, post.create, order.update)
      const createWebhook = { collection: 'posts', event: 'create', action: 'create', enabled: true };
      expect(service.matchesEvent(createWebhook, 'posts', 'created')).toBe(true);
      expect(service.matchesEvent(createWebhook, 'post', 'created')).toBe(true);
      expect(service.matchesEvent(createWebhook, 'posts', 'updated')).toBe(false);

      const postCreateWebhook = { collection: 'posts', event: 'post.create', action: 'create', enabled: true };
      expect(service.matchesEvent(postCreateWebhook, 'posts', 'created')).toBe(true);

      const updateWebhook = { collection: 'orders', event: 'update', action: 'update', enabled: true };
      expect(service.matchesEvent(updateWebhook, 'orders', 'updated')).toBe(true);

      const orderUpdateWebhook = { collection: 'orders', event: 'order.update', action: 'update', enabled: true };
      expect(service.matchesEvent(orderUpdateWebhook, 'orders', 'updated')).toBe(true);

      const deleteWebhook = { collection: 'posts', event: 'delete', action: 'delete', enabled: true };
      expect(service.matchesEvent(deleteWebhook, 'posts', 'deleted')).toBe(true);

      const postDeleteWebhook = { collection: 'posts', event: 'post.delete', action: 'delete', enabled: true };
      expect(service.matchesEvent(postDeleteWebhook, 'posts', 'deleted')).toBe(true);

      // 5. Webhook with event: '*' and specific action constraint (e.g. action: 'updated')
      const actionConstrainedWebhook = { collection: '*', event: '*', action: 'updated', enabled: true };
      expect(service.matchesEvent(actionConstrainedWebhook, 'posts', 'updated')).toBe(true);
      expect(service.matchesEvent(actionConstrainedWebhook, 'posts', 'created')).toBe(false); // must NOT match created!
      expect(service.matchesEvent(actionConstrainedWebhook, 'posts', 'deleted')).toBe(false); // must NOT match deleted!

      const actionCreateConstrained = { collection: 'posts', event: '*', action: 'create', enabled: true };
      expect(service.matchesEvent(actionCreateConstrained, 'posts', 'created')).toBe(true);
      expect(service.matchesEvent(actionCreateConstrained, 'posts', 'updated')).toBe(false);

      // 6. Disabled webhook should never match
      const disabledWebhook = { ...postWebhook, enabled: false };
      expect(service.matchesEvent(disabledWebhook, 'posts', 'created')).toBe(false);
    });
  });

  // ==========================================
  // 2. REST API: Webhook Configuration CRUD
  // ==========================================
  describe('2. Webhooks Configuration REST API (/api/webhooks)', () => {
    let createdWebhookId = '';

    it('should reject unauthenticated requests with 401 or 403', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/webhooks',
      });
      expect([401, 403]).toContain(res.statusCode);
    });

    it('should create a new outbound webhook with collection + event + headers + secret', async () => {
      const res = await app.server.inject({
        method: 'POST',
        url: '/api/webhooks',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          name: 'Post Created Webhook',
          url: 'https://example-webhook-listener.com/events',
          collection: 'posts',
          event: 'post.created',
          headers: {
            'X-Custom-Auth': 'Bearer test-token-123',
            'X-Source-App': 'NodeStack-Dev',
          },
          secret: 'whsec_secret_alpha_987',
          enabled: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const wh = res.json();
      expect(wh.id).toBeDefined();
      expect(wh.name).toBe('Post Created Webhook');
      expect(wh.url).toBe('https://example-webhook-listener.com/events');
      expect(wh.collection).toBe('posts');
      expect(wh.event).toBe('created');
      expect(wh.headers['X-Custom-Auth']).toBe('Bearer test-token-123');
      expect(wh.secret).toBe('whsec_secret_alpha_987');
      expect(wh.enabled).toBe(true);

      createdWebhookId = wh.id;
    });

    it('should list configured webhooks via GET /api/webhooks', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/webhooks',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const list = res.json();
      expect(Array.isArray(list)).toBe(true);
      expect(list.some((w: any) => w.id === createdWebhookId)).toBe(true);
    });

    it('should fetch a single webhook by ID via GET /api/webhooks/:id', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: `/api/webhooks/${createdWebhookId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(createdWebhookId);
      expect(res.json().name).toBe('Post Created Webhook');
    });

    it('should update a webhook via PATCH /api/webhooks/:id', async () => {
      const res = await app.server.inject({
        method: 'PATCH',
        url: `/api/webhooks/${createdWebhookId}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          name: 'Post Created Webhook (Updated)',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Post Created Webhook (Updated)');
    });

    it('should report webhook stats via GET /api/webhooks/stats', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/webhooks/stats',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const stats = res.json();
      expect(stats.totalWebhooks).toBeGreaterThanOrEqual(1);
      expect(stats.activeWebhooks).toBeGreaterThanOrEqual(1);
      expect(stats.successRate).toBeDefined();
    });

    it('should reject webhook creation with invalid URL or missing name', async () => {
      const resInvalidUrl = await app.server.inject({
        method: 'POST',
        url: '/api/webhooks',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          name: 'Invalid Webhook',
          url: 'not-a-valid-url',
        },
      });
      expect(resInvalidUrl.statusCode).toBe(400);

      const resMissingName = await app.server.inject({
        method: 'POST',
        url: '/api/webhooks',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          name: '',
          url: 'https://valid.com',
        },
      });
      expect(resMissingName.statusCode).toBe(400);
    });

    it('should reject webhook creation with SSRF targets (localhost, private IP, metadata)', async () => {
      const targets = [
        'http://127.0.0.1:8080/callback',
        'http://localhost:3000/webhook',
        'http://169.254.169.254/latest/meta-data',
        'http://10.0.0.1/webhook',
        'http://192.168.1.1/webhook',
        'http://172.16.0.1/webhook',
        'http://metadata.google.internal/computeMetadata/v1',
      ];

      for (const url of targets) {
        const res = await app.server.inject({
          method: 'POST',
          url: '/api/webhooks',
          headers: {
            authorization: `Bearer ${adminToken}`,
            'content-type': 'application/json',
          },
          payload: {
            name: `SSRF Test ${url}`,
            url,
          },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.payload);
        expect(body.message).toMatch(/private or loopback|prohibited/i);
      }
    });

    it('should reject webhook update with SSRF target URL', async () => {
      // First create a valid webhook
      const createRes = await app.server.inject({
        method: 'POST',
        url: '/api/webhooks',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          name: 'Valid For Update',
          url: 'https://webhook.site/test',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const whk = JSON.parse(createRes.payload);

      // Attempt to update with SSRF target
      const updateRes = await app.server.inject({
        method: 'PATCH',
        url: `/api/webhooks/${whk.id}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          url: 'http://169.254.169.254/latest/meta-data',
        },
      });
      expect(updateRes.statusCode).toBe(400);
      const body = JSON.parse(updateRes.payload);
      expect(body.message).toMatch(/private or loopback|prohibited/i);
    });

    it('should intercept and block redirect-based SSRF to metadata or loopback during delivery', async () => {
      // Mock fetch returning a 302 Found redirect to AWS cloud metadata
      const redirectFetch = vi.fn(async (url: string) => {
        if (url.includes('redirect-to-metadata')) {
          return {
            ok: false,
            status: 302,
            statusText: 'Found',
            headers: { location: 'http://169.254.169.254/latest/meta-data' },
            text: async () => '',
            json: async () => ({}),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {},
          text: async () => 'OK',
          json: async () => ({}),
        };
      });

      app.webhooks.setFetch(redirectFetch as any);

      try {
        const wh = app.webhooks.createWebhook({
          name: 'Redirect Test',
          url: 'https://example.com/redirect-to-metadata',
          event: 'posts.created',
        });

        const delivery = await app.webhooks.dispatch(wh, { event: 'posts.created', timestamp: new Date().toISOString() });

        expect(delivery.status).toBe('failed');
        expect(delivery.error).toMatch(/\[SsrfGuard\].*(private or metadata|cloud metadata)/i);
      } finally {
        // Restore default mock fetch
        app.webhooks.setFetch(mockFetch as any);
      }
    });

    it('should reject webhook creation and update with invalid HTTP method', async () => {
      const resInvalidMethod = await app.server.inject({
        method: 'POST',
        url: '/api/webhooks',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          name: 'Invalid Method Webhook',
          url: 'https://example.com/webhook',
          method: 'INVALID_VERB',
        },
      });
      expect(resInvalidMethod.statusCode).toBe(400);
      expect(resInvalidMethod.json().message).toContain('Invalid HTTP method');

      expect(() => {
        app.webhooks.createWebhook({
          name: 'Bad Method',
          url: 'https://example.com/webhook',
          method: 'CONNECT',
        });
      }).toThrow();
    });

    it('should coordinate with existing webhooks plugin without shadowing GET /api/webhooks/status', async () => {
      // 1. Without plugin, GET /api/webhooks/status reports plugin endpoint not found (not "Webhook not found for id status")
      const noPluginRes = await app.server.inject({
        method: 'GET',
        url: '/api/webhooks/status',
      });
      expect(noPluginRes.statusCode).toBe(404);
      expect(noPluginRes.json().message).toContain('Webhooks plugin');

      // 2. Install webhooks plugin dynamically after server boot
      app.use(
        webhookPlugin({
          collections: ['posts'],
        })
      );

      // 3. GET /api/webhooks/status is now handled by the dynamic plugin route rather than /api/webhooks/:id
      const pluginRes = await app.server.inject({
        method: 'GET',
        url: '/api/webhooks/status',
      });
      expect(pluginRes.statusCode).toBe(200);
      const pluginBody = pluginRes.json();
      expect(pluginBody.hasDiscord).toBe(false);
      expect(pluginBody.monitoredCollections).toContain('posts');
      expect(pluginBody.listenedEvents).toBeDefined();

      // 4. GET /api/webhooks/:id for actual webhook still returns the webhook config
      const whRes = await app.server.inject({
        method: 'GET',
        url: `/api/webhooks/${createdWebhookId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(whRes.statusCode).toBe(200);
      expect(whRes.json().id).toBe(createdWebhookId);
    });
  });

  // ==========================================
  // 3. Automated Outbound Dispatch on Mutations
  // ==========================================
  describe('3. Automated Outbound Webhook Dispatch & X-NodeStack-Signature', () => {
    beforeAll(async () => {
      // Clear captured outbound requests
      capturedOutboundRequests = [];

      // Create an order.updated webhook
      await app.server.inject({
        method: 'POST',
        url: '/api/webhooks',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          name: 'Order Updated Notification',
          url: 'https://example-orders-listener.com/webhooks',
          collection: 'orders',
          event: 'order.updated',
          headers: {
            'X-App-Env': 'production',
          },
          secret: 'whsec_order_secret_555',
          enabled: true,
        },
      });
    });

    it('should automatically fire post.created webhook on record creation with valid X-NodeStack-Signature', async () => {
      capturedOutboundRequests = [];

      // Insert a record into 'posts' collection
      const res = await app.server.inject({
        method: 'POST',
        url: '/api/collections/posts/records',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          title: 'Automated Webhook Test Post',
          status: 'published',
        },
      });
      expect([200, 201]).toContain(res.statusCode);
      const postRecord = res.json();

      // Allow background dispatch tick
      await new Promise((r) => setTimeout(r, 80));

      // Verify that mockFetch received the outbound request
      const matchingReq = capturedOutboundRequests.find(
        (r) => r.url === 'https://example-webhook-listener.com/events'
      );
      expect(matchingReq).toBeDefined();

      // Check request payload structure
      expect(matchingReq!.body.event).toBe('posts.created');
      expect(matchingReq!.body.collection).toBe('posts');
      expect(matchingReq!.body.action).toBe('created');
      expect(matchingReq!.body.record.title).toBe('Automated Webhook Test Post');
      expect(matchingReq!.body.record.id).toBe(postRecord.id);

      // Check custom headers
      const sentHeaders = matchingReq!.options.headers;
      expect(sentHeaders['X-Custom-Auth']).toBe('Bearer test-token-123');
      expect(sentHeaders['X-Source-App']).toBe('NodeStack-Dev');

      // Check X-NodeStack-Signature header
      const signatureHeader = sentHeaders['X-NodeStack-Signature'];
      expect(signatureHeader).toBeDefined();
      expect(signatureHeader).toHaveLength(64);

      // Verify that signature matches payload signed with webhook secret
      const isSigValid = WebhookService.verifySignature(
        JSON.stringify(matchingReq!.body),
        signatureHeader,
        'whsec_secret_alpha_987'
      );
      expect(isSigValid).toBe(true);
    });

    it('should fire order.updated webhook on record update and ignore post updates', async () => {
      // 1. Create an order record
      const createOrderRes = await app.server.inject({
        method: 'POST',
        url: '/api/collections/orders/records',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          item: 'MacBook Pro M4',
          amount: 2499,
          status: 'pending',
        },
      });
      const order = createOrderRes.json();
      capturedOutboundRequests = [];

      // 2. Update order to 'completed'
      const updateOrderRes = await app.server.inject({
        method: 'PATCH',
        url: `/api/collections/orders/records/${order.id}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          status: 'completed',
        },
      });
      expect(updateOrderRes.statusCode).toBe(200);

      await new Promise((r) => setTimeout(r, 80));

      // Verify order webhook received update event
      const orderReq = capturedOutboundRequests.find(
        (r) => r.url === 'https://example-orders-listener.com/webhooks'
      );
      expect(orderReq).toBeDefined();
      expect(orderReq!.body.event).toBe('orders.updated');
      expect(orderReq!.body.record.status).toBe('completed');
      expect(orderReq!.body.previous.status).toBe('pending');
      expect(orderReq!.options.headers['X-App-Env']).toBe('production');

      // Verify X-NodeStack-Signature on order webhook
      const orderSig = orderReq!.options.headers['X-NodeStack-Signature'];
      expect(orderSig).toBeDefined();
      expect(
        WebhookService.verifySignature(
          JSON.stringify(orderReq!.body),
          orderSig,
          'whsec_order_secret_555'
        )
      ).toBe(true);
    });

    it('should fire webhook configured with singular/present-tense event ("create") on record creation', async () => {
      capturedOutboundRequests = [];

      // Create a webhook specifically configured with event: "create" (present tense)
      await app.server.inject({
        method: 'POST',
        url: '/api/webhooks',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          name: 'Present Tense Create Hook',
          url: 'https://example-present-listener.com/create-events',
          collection: 'posts',
          event: 'create',
          enabled: true,
        },
      });

      // Insert record
      await app.server.inject({
        method: 'POST',
        url: '/api/collections/posts/records',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          title: 'Testing Present Tense Hook',
        },
      });

      // Allow background dispatch tick
      await new Promise((r) => setTimeout(r, 80));

      const hookReq = capturedOutboundRequests.find(
        (r) => r.url === 'https://example-present-listener.com/create-events'
      );
      expect(hookReq).toBeDefined();
      expect(hookReq!.body.event).toBe('posts.created');
    });

    it('should respect action constraint when event is wildcard (event: "*", action: "updated")', async () => {
      capturedOutboundRequests = [];

      // Create a webhook with event: "*" but action: "updated"
      await app.server.inject({
        method: 'POST',
        url: '/api/webhooks',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          name: 'Wildcard Event Action Updated Hook',
          url: 'https://example-action-listener.com/update-only',
          collection: 'posts',
          event: '*',
          action: 'updated',
          enabled: true,
        },
      });

      // 1. Insert record -> should NOT trigger this webhook
      const createRes = await app.server.inject({
        method: 'POST',
        url: '/api/collections/posts/records',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          title: 'Action Constraint Test Post',
        },
      });
      const createdPost = createRes.json();
      await new Promise((r) => setTimeout(r, 80));

      const createDispatched = capturedOutboundRequests.find(
        (r) => r.url === 'https://example-action-listener.com/update-only'
      );
      expect(createDispatched).toBeUndefined(); // Did not fire for create!

      // 2. Update record -> SHOULD trigger this webhook!
      await app.server.inject({
        method: 'PATCH',
        url: `/api/collections/posts/records/${createdPost.id}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          title: 'Action Constraint Test Post (Updated)',
        },
      });
      await new Promise((r) => setTimeout(r, 80));

      const updateDispatched = capturedOutboundRequests.find(
        (r) => r.url === 'https://example-action-listener.com/update-only'
      );
      expect(updateDispatched).toBeDefined();
      expect(updateDispatched!.body.event).toBe('posts.updated');
    });

    it('should dispatch GET and HEAD webhooks body-free with query encoding without fetch throwing', async () => {
      capturedOutboundRequests = [];

      // 1. Create a GET webhook with a secret
      const getWhRes = await app.server.inject({
        method: 'POST',
        url: '/api/webhooks',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          name: 'Query Notification Ping',
          url: 'https://example-listener.com/ping',
          collection: 'posts',
          event: 'created',
          method: 'GET',
          secret: 'whsec_get_secret_123',
          enabled: true,
        },
      });
      expect(getWhRes.statusCode).toBe(201);
      const getWebhook = getWhRes.json();
      expect(getWebhook.method).toBe('GET');

      // 2. Trigger test dispatch
      const testRes = await app.server.inject({
        method: 'POST',
        url: `/api/webhooks/${getWebhook.id}/test`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(testRes.statusCode).toBe(200);
      const delivery = testRes.json();
      expect(delivery.status).toBe('success');

      // 3. Verify mockFetch received body-free request without TypeError
      const req = capturedOutboundRequests.find((r) => r.url.startsWith('https://example-listener.com/ping'));
      expect(req).toBeDefined();
      expect(req!.options.method).toBe('GET');
      expect(req!.options.body).toBeUndefined(); // Body-free!
      expect(req!.options.headers['Content-Type']).toBeUndefined(); // No JSON content-type on body-free GET
      expect(req!.url).toContain('event='); // Query encoded!
      expect(req!.url).toContain('collection=posts');

      // 4. Verify HMAC signature over the query string
      const sig = req!.options.headers['X-NodeStack-Signature'];
      expect(sig).toBeDefined();
      const parsedUrl = new URL(req!.url);
      expect(WebhookService.verifySignature(parsedUrl.search.slice(1), sig, 'whsec_get_secret_123')).toBe(true);

      // 5. Verify HEAD webhook dispatches body-free without error
      const headWh = app.webhooks.createWebhook({
        name: 'Heartbeat Check',
        url: 'https://example-listener.com/heartbeat',
        method: 'HEAD',
        enabled: true,
      });
      expect(headWh.method).toBe('HEAD');

      const headDelivery = await app.webhooks.dispatch(headWh, { event: 'heartbeat', collection: 'system' });
      expect(headDelivery.status).toBe('success');

      const headReq = capturedOutboundRequests.find((r) => r.url.startsWith('https://example-listener.com/heartbeat'));
      expect(headReq).toBeDefined();
      expect(headReq!.options.method).toBe('HEAD');
      expect(headReq!.options.body).toBeUndefined(); // Body-free!
    });
  });

  // ==========================================
  // 4. Delivery Logs & Manual Retry Buttons
  // ==========================================
  describe('4. Delivery Logs & Manual Retry Engine (/api/webhooks/deliveries)', () => {
    let failedDeliveryId = '';

    beforeAll(async () => {
      // Create a failing webhook (pointing to fail-endpoint)
      const whRes = await app.server.inject({
        method: 'POST',
        url: '/api/webhooks',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          name: 'Flaky Webhook Service',
          url: 'https://fail-endpoint.example.com/hook',
          collection: 'posts',
          event: '*',
          secret: 'whsec_retry_secret_999',
          enabled: true,
        },
      });
      const flakyWebhook = whRes.json();

      // Trigger a delivery to fail-endpoint via test route
      const testRes = await app.server.inject({
        method: 'POST',
        url: `/api/webhooks/${flakyWebhook.id}/test`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const delivery = testRes.json();
      failedDeliveryId = delivery.id;
    });

    it('should query delivery logs with status codes and pagination', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/webhooks/deliveries?page=1&perPage=10',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toBeDefined();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.totalItems).toBeGreaterThanOrEqual(1);

      // Verify delivery fields
      const delivery = body.items.find((d: any) => d.id === failedDeliveryId);
      expect(delivery).toBeDefined();
      expect(delivery.responseStatus).toBe(500);
      expect(delivery.status).toBe('failed');
      expect(delivery.attempt).toBe(1);
      expect(delivery.requestPayload).toBeDefined();
      expect(delivery.requestHeaders).toBeDefined();
    });

    it('should fetch single delivery details via GET /api/webhooks/deliveries/:id', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: `/api/webhooks/deliveries/${failedDeliveryId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const del = res.json();
      expect(del.id).toBe(failedDeliveryId);
      expect(del.url).toContain('fail-endpoint');
    });

    it('should manually retry a failed delivery via POST /api/webhooks/deliveries/:id/retry', async () => {
      // First verify delivery attempt 1 failed
      const original = app.webhooks.getDeliveryById(failedDeliveryId);
      expect(original?.attempt).toBe(1);

      // Update the webhook url to a succeeding endpoint for retry simulation
      app.webhooks.updateWebhook(original!.webhookId, {
        url: 'https://repaired-endpoint.example.com/webhook',
      });

      // Call manual retry endpoint
      const retryRes = await app.server.inject({
        method: 'POST',
        url: `/api/webhooks/deliveries/${failedDeliveryId}/retry`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(retryRes.statusCode).toBe(200);
      const retriedDelivery = retryRes.json();
      expect(retriedDelivery.id).toBeDefined();
      expect(retriedDelivery.id).not.toBe(failedDeliveryId); // new delivery entry
      expect(retriedDelivery.attempt).toBe(2); // incremented attempt!
      expect(retriedDelivery.status).toBe('success');
      expect(retriedDelivery.responseStatus).toBe(200);

      // Verify the new attempt is stored in delivery history
      const listRes = await app.server.inject({
        method: 'GET',
        url: '/api/webhooks/deliveries',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const allDeliveries = listRes.json().items;
      const attempt2 = allDeliveries.find((d: any) => d.id === retriedDelivery.id);
      expect(attempt2).toBeDefined();
      expect(attempt2.attempt).toBe(2);
    });

    it('should reject malformed or negative olderThanDays parameter with 400 without deleting logs', async () => {
      // 1. Check non-empty before test
      const beforeRes = await app.server.inject({
        method: 'GET',
        url: '/api/webhooks/deliveries',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const initialCount = beforeRes.json().items.length;
      expect(initialCount).toBeGreaterThan(0);

      // 2. Reject string non-numeric input (?olderThanDays=abc)
      const malformedRes = await app.server.inject({
        method: 'DELETE',
        url: '/api/webhooks/deliveries?olderThanDays=abc',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(malformedRes.statusCode).toBe(400);
      expect(malformedRes.json().message).toContain('olderThanDays');

      // 3. Reject negative input (?olderThanDays=-5)
      const negativeRes = await app.server.inject({
        method: 'DELETE',
        url: '/api/webhooks/deliveries?olderThanDays=-5',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(negativeRes.statusCode).toBe(400);

      // 4. Verify WebhookService throws on non-finite input directly
      expect(() => app.webhooks.clearDeliveries(NaN)).toThrow();
      expect(() => app.webhooks.clearDeliveries('invalid' as any)).toThrow();
      expect(() => app.webhooks.clearDeliveries(-10)).toThrow();

      // 5. Verify NO logs were erased by malformed attempts
      const afterRes = await app.server.inject({
        method: 'GET',
        url: '/api/webhooks/deliveries',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(afterRes.json().items.length).toBe(initialCount);

      // 6. Test valid positive olderThanDays (e.g. 30 days) -> only deletes logs older than 30 days
      const olderThanRes = await app.server.inject({
        method: 'DELETE',
        url: '/api/webhooks/deliveries?olderThanDays=30',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(olderThanRes.statusCode).toBe(200);
      expect(olderThanRes.json().success).toBe(true);
      expect(olderThanRes.json().deletedCount).toBe(0); // none older than 30 days
    });

    it('should clear delivery logs via DELETE /api/webhooks/deliveries', async () => {
      const res = await app.server.inject({
        method: 'DELETE',
        url: '/api/webhooks/deliveries',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      const afterRes = await app.server.inject({
        method: 'GET',
        url: '/api/webhooks/deliveries',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(afterRes.json().items.length).toBe(0);
    });
  });

  // ==========================================
  // 5. Admin UI Bundler & DOM Integration
  // ==========================================
  describe('5. Admin UI Bundling & DOM Elements (Webhooks Manager)', () => {
    const uiDir = path.resolve(__dirname, '../src/admin/ui');

    it('should bundle webhooks.css and webhooks.js cleanly into index.html shell', () => {
      const bundled = AdminUIBundler.bundle(uiDir);
      expect(bundled).toBeDefined();

      // CSS bundling verification
      expect(bundled).not.toContain('<link rel="stylesheet" href="./css/webhooks.css">');
      expect(bundled).toContain('.webhooks-container');
      expect(bundled).toContain('.badge-event');
      expect(bundled).toContain('.badge-signature');
      expect(bundled).toContain('.btn-retry-action');

      // JS bundling verification
      expect(bundled).not.toContain('<script src="./js/webhooks.js"></script>');
      expect(bundled).toContain('let webhooksState =');
      expect(bundled).toContain('function renderWebhooksView');
      expect(bundled).toContain('function openCreateWebhookModal');
      expect(bundled).toContain('function retryWebhookDelivery');
      expect(bundled).toContain('function openDeliveryDetailDrawer');
      expect(bundled).toContain('openDeliveryDetailModal');
      expect(bundled).toContain('function handleDeleteWebhookClick');
      expect(bundled).toContain('function handleCopyWebhookUrl');
      expect(bundled).toContain('function handleCopyWebhookPayload');

      // HTML elements verification
      expect(bundled).toContain('id="nav-webhooks"');
      expect(bundled).toContain('id="page-view-webhooks"');
      expect(bundled).toContain('id="sidebar-webhooks-count"');
    });

    it('should render Webhooks Manager page view and interact with DOM in JSDOM environment', async () => {
      const bundledHtml = AdminUIBundler.bundle(uiDir);
      const dom = new JSDOM(bundledHtml, {
        runScripts: 'dangerously',
        url: 'http://localhost:8090/_/',
      });

      const { window } = dom;
      const { document } = window;

      // Mock api function in DOM
      window.api = vi.fn(async (url: string) => {
        if (url === '/api/webhooks/stats') {
          return {
            totalWebhooks: 2,
            activeWebhooks: 2,
            totalDeliveries: 15,
            successDeliveries: 14,
            failedDeliveries: 1,
            successRate: '93.3%',
          };
        }
        if (url === '/api/webhooks') {
          return [
            {
              id: 'whk_sample_1',
              name: 'Order Fulfillment Webhook',
              url: 'https://orders.service.com/webhook',
              collection: 'orders',
              event: 'order.updated',
              headers: { 'X-Auth': 'Bearer token' },
              secret: 'whsec_sample_secret',
              enabled: true,
              created: '2026-10-19T10:00:00Z',
            },
            {
              id: 'whk_sample_2',
              name: "O'Reilly's Hook'); alert(1); ('",
              url: 'https://example.com/api?q=it\'s_test',
              collection: 'orders',
              event: 'created',
              headers: {},
              secret: '',
              enabled: true,
              created: '2026-10-19T10:00:00Z',
            },
          ];
        }
        if (url.startsWith('/api/webhooks/deliveries/del_sample_1')) {
          return {
            id: 'del_sample_1',
            webhookId: 'whk_sample_1',
            webhookName: 'Order Fulfillment Webhook',
            url: "https://orders.service.com/webhook?param=it's_safe&break=');alert(1);('",
            event: 'order.updated',
            collection: 'orders',
            responseStatus: 200,
            durationMs: 42,
            status: 'success',
            attempt: 1,
            created: '2026-10-19T10:00:05Z',
            requestHeaders: { 'Content-Type': 'application/json' },
            requestPayload: { event: 'order.updated', record: { id: 'ord_1' } },
          };
        }
        if (url.startsWith('/api/webhooks/deliveries')) {
          return {
            items: [
              {
                id: 'del_sample_1',
                webhookId: 'whk_sample_1',
                webhookName: 'Order Fulfillment Webhook',
                url: 'https://orders.service.com/webhook',
                event: 'order.updated',
                collection: 'orders',
                responseStatus: 200,
                durationMs: 42,
                status: 'success',
                attempt: 1,
                created: '2026-10-19T10:00:05Z',
                requestHeaders: { 'Content-Type': 'application/json' },
                requestPayload: { event: 'order.updated', record: { id: 'ord_1' } },
              },
            ],
            totalItems: 1,
            totalPages: 1,
            page: 1,
            perPage: 25,
          };
        }
        return {};
      });

      // 1. Navigation test: selectNav('webhooks')
      window.selectNav('webhooks');
      const pageView = document.getElementById('page-view-webhooks');
      expect(pageView?.style.display).toBe('block');
      const navItem = document.getElementById('nav-webhooks');
      expect(navItem?.classList.contains('active')).toBe(true);

      // Verify breadcrumbs: should be directly under "NodeStack / Webhooks" (NOT nested under "Plugins")
      const trail = document.getElementById('breadcrumb-trail');
      expect(trail?.textContent).toContain('NodeStack');
      expect(trail?.textContent).toContain('Webhooks');
      expect(trail?.textContent).not.toContain('Plugins');

      // 2. Render Webhooks View
      window.renderWebhooksView();
      expect(document.querySelector('.webhooks-title-area h2')?.textContent).toContain(
        'Webhooks Manager'
      );
      expect(document.getElementById('webhooks-stats-grid')).not.toBeNull();

      // Wait microtask tick for async fetch
      await new Promise((r) => setTimeout(r, 50));

      // 3. Verify stats populated & sidebar count badge visible
      expect(document.getElementById('wh-stat-active')?.textContent).toBe('2');
      expect(document.getElementById('wh-stat-deliveries')?.textContent).toBe('15');
      expect(document.getElementById('wh-stat-rate')?.textContent).toBe('93.3%');
      const sidebarBadge = document.getElementById('sidebar-webhooks-count');
      expect(sidebarBadge?.textContent).toBe('2');
      expect(sidebarBadge?.style.display).toBe('inline-block');

      // 3.5 Verify safe rendering of webhook with apostrophes and special characters in name
      const deleteButtons = document.querySelectorAll('button[title="Delete Webhook"]');
      expect(deleteButtons.length).toBe(2);
      const dangerousBtn = Array.from(deleteButtons).find((b: any) => b.getAttribute('data-id') === 'whk_sample_2') as HTMLButtonElement;
      expect(dangerousBtn).toBeDefined();
      expect(dangerousBtn.getAttribute('data-name')).toBe("O'Reilly's Hook'); alert(1); ('");
      expect(dangerousBtn.getAttribute('onclick')).toBe('handleDeleteWebhookClick(this)');
      // Verify clicking triggers confirm without JS execution error or string breakout
      window.confirm = vi.fn(() => false);
      dangerousBtn.click();
      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining("O'Reilly's Hook'); alert(1); ('")
      );

      // 4. Test Create Webhook Modal
      window.openCreateWebhookModal();
      const modal = document.getElementById('webhook-modal-backdrop');
      expect(modal).not.toBeNull();
      expect(document.getElementById('wh-form-name')).not.toBeNull();
      expect(document.getElementById('wh-form-url')).not.toBeNull();
      expect(document.getElementById('wh-form-event-preview')).not.toBeNull();

      // Test secret generator button
      window.generateRandomWebhookSecret();
      const secretInput = document.getElementById('wh-form-secret') as HTMLInputElement;
      expect(secretInput.value).toContain('whsec_');

      // Close modal
      window.closeWebhookModal();
      expect(document.getElementById('webhook-modal-backdrop')).toBeNull();

      // 5. Switch to Deliveries Tab
      window.switchWebhooksTab('deliveries');
      await new Promise((r) => setTimeout(r, 50));
      expect(document.querySelector('.badge-status-code')?.textContent).toContain('200 SUCCESS');
      expect(document.querySelector('.btn-retry-action')).not.toBeNull();

      // 6. Test Delivery Details Drawer (view record style)
      await window.openDeliveryDetailDrawer('del_sample_1');
      const drawer = document.getElementById('webhook-drawer-panel');
      const backdrop = document.getElementById('webhook-drawer-backdrop');
      expect(drawer).not.toBeNull();
      expect(backdrop).not.toBeNull();
      expect(drawer?.classList.contains('record-drawer')).toBe(true);
      expect(drawer?.classList.contains('webhook-drawer')).toBe(true);
      expect(document.getElementById('webhook-drawer-title')?.textContent).toContain('order.updated');
      expect(document.getElementById('drawer-retry-btn')).not.toBeNull();

      // Test safe Copy URL button with apostrophe in URL
      const copyUrlBtn = document.getElementById('btn-copy-webhook-url') as HTMLButtonElement;
      expect(copyUrlBtn).not.toBeNull();
      expect(copyUrlBtn.getAttribute('data-url')).toContain("it's_safe");
      expect(copyUrlBtn.getAttribute('onclick')).toBe('handleCopyWebhookUrl(this)');
      expect(() => copyUrlBtn.click()).not.toThrow();

      // Test safe Copy Payload button
      const copyPayloadBtn = document.getElementById('btn-copy-webhook-payload') as HTMLButtonElement;
      expect(copyPayloadBtn).not.toBeNull();
      expect(copyPayloadBtn.getAttribute('onclick')).toBe('handleCopyWebhookPayload()');
      expect(() => copyPayloadBtn.click()).not.toThrow();

      // Close drawer
      window.closeWebhookDrawer();
    }, 15000);
  });
});
