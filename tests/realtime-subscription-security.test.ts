import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { NodeStackClient, MemoryAuthStore } from '../packages/client/src';

describe('Realtime Subscription Ownership & Session Binding Security', { timeout: 20000 }, () => {
  const testDir = path.resolve(__dirname, '../.test_realtime_subscription_security');
  const port = 8296;
  let app: NodeStack;
  let adminToken: string;
  let aliceToken: string;
  let bobToken: string;
  let apiKey1Secret: string;
  let apiKey2Secret: string;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    app = new NodeStack({
      dataDir: testDir,
      port,
    });
    await app.start();

    // Create admin
    await app.auth.createAdmin('sec-admin@nodestack.test', 'AdminPassword123!');
    const adminAuth = await app.auth.authenticateAdmin('sec-admin@nodestack.test', 'AdminPassword123!');
    adminToken = adminAuth.token;

    // Create public posts collection
    await app.schema.createCollection({
      name: 'posts',
      type: 'base',
      schema: [{ name: 'title', type: 'text', required: true }],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });

    // Create two users: Alice and Bob
    await app.records.create('users', {
      email: 'alice@nodestack.test',
      password: 'AlicePassword123!',
    });
    await app.records.create('users', {
      email: 'bob@nodestack.test',
      password: 'BobPassword123!',
    });

    aliceToken = (await app.auth.authenticateRecord('users', 'alice@nodestack.test', 'AlicePassword123!')).token;
    bobToken = (await app.auth.authenticateRecord('users', 'bob@nodestack.test', 'BobPassword123!')).token;

    // Create two API keys
    apiKey1Secret = (
      await app.defaultApp.apiKeys.createKey({
        name: 'Realtime Key 1',
        role: 'service',
        scopes: ['posts:read'],
      })
    ).secretKey;
    apiKey2Secret = (
      await app.defaultApp.apiKeys.createKey({
        name: 'Realtime Key 2',
        role: 'service',
        scopes: ['posts:read'],
      })
    ).secretKey;

    // Create a second app for cross-app isolation testing
    await app.apps.registry.createApp({
      name: 'Tenant App A',
      slug: 'tenant-a',
    });
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  function connectSSE(options: {
    token?: string;
    headers?: Record<string, string>;
    urlPath?: string;
  } = {}): Promise<{
    clientId: string;
    clientSecret: string;
    events: Array<{ event: string; data: any }>;
    isClosed: () => boolean;
    close: () => void;
  }> {
    return new Promise((resolve, reject) => {
      const events: Array<{ event: string; data: any }> = [];
      let clientId = '';
      let clientSecret = '';
      let streamClosed = false;
      const basePath = options.urlPath || '/api/realtime';
      const url = options.token
        ? `http://127.0.0.1:${port}${basePath}?token=${encodeURIComponent(options.token)}`
        : `http://127.0.0.1:${port}${basePath}`;

      const req = http.get(
        url,
        { headers: options.headers || {} },
        (res) => {
          res.on('close', () => {
            streamClosed = true;
          });
          res.on('end', () => {
            streamClosed = true;
          });
          let buffer = '';
          res.on('data', (chunk) => {
            buffer += chunk.toString();
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() || '';
            for (const block of blocks) {
              const eventMatch = block.match(/event:\s*([^\r\n]+)/);
              const dataMatch = block.match(/data:\s*(\{.*\})/);
              if (!dataMatch) continue;
              const eventName = eventMatch ? eventMatch[1].trim() : 'message';
              let parsed: any;
              try {
                parsed = JSON.parse(dataMatch[1]);
              } catch {
                continue;
              }
              if (eventName === 'NS_CONNECT' && !clientId) {
                clientId = parsed.clientId;
                clientSecret = parsed.clientSecret || '';
                resolve({
                  clientId,
                  clientSecret,
                  events,
                  isClosed: () => streamClosed,
                  close: () => {
                    try {
                      req.destroy();
                      res.destroy();
                    } catch {}
                  },
                });
              } else if (eventName !== 'NB_CONNECT' && eventName !== 'NS_CONNECT') {
                events.push({ event: eventName, data: parsed });
              }
            }
          });
        }
      );
      req.on('error', reject);
    });
  }

  it('should reject unauthenticated POST /api/realtime even with valid active or guessed clientIds (401)', async () => {
    const aliceSSE = await connectSSE({ token: aliceToken });
    const guestSSE = await connectSSE();

    try {
      expect(aliceSSE.clientSecret).toBeTruthy();
      expect(guestSSE.clientSecret).toBeTruthy();

      // 1. Unauthenticated attack against Alice's authenticated clientId
      const attackAlice = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: aliceSSE.clientId,
          subscriptions: ['*'],
        }),
      });
      expect(attackAlice.status).toBe(401);

      // 2. Unauthenticated attack against Guest's anonymous clientId without clientSecret
      const attackGuest = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: guestSSE.clientId,
          subscriptions: ['*'],
        }),
      });
      expect(attackGuest.status).toBe(401);

      // 3. Unauthenticated probe with non-existent clientId also returns 401 (no clientId enumeration)
      const probeMissing = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cl_nonexistent_1234',
          subscriptions: ['posts'],
        }),
      });
      expect(probeMissing.status).toBe(401);

      // 4. Unauthenticated request with ONLY clientSecret targeting an authenticated client is still rejected (401)
      const secretOnlyOnAuth = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: aliceSSE.clientId,
          clientSecret: aliceSSE.clientSecret,
          subscriptions: ['posts'],
        }),
      });
      expect(secretOnlyOnAuth.status).toBe(401);
    } finally {
      aliceSSE.close();
      guestSSE.close();
    }
  });

  it('should prevent cross-user and cross-admin hijacking of another user SSE client (403)', async () => {
    const aliceSSE = await connectSSE({ token: aliceToken });

    try {
      // Alice subscribes to 'posts' using her own token (even without clientSecret)
      const aliceSub = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          clientId: aliceSSE.clientId,
          subscriptions: ['posts'],
        }),
      });
      expect(aliceSub.status).toBe(204);

      // Bob attempts to hijack/clear Alice's subscriptions using Bob's valid JWT
      const bobAttack = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bobToken}`,
        },
        body: JSON.stringify({
          clientId: aliceSSE.clientId,
          subscriptions: ['__noop__'],
        }),
      });
      expect(bobAttack.status).toBe(403);

      // Even an admin cannot hijack Alice's SSE clientId
      const adminAttack = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          clientId: aliceSSE.clientId,
          subscriptions: ['__noop__'],
        }),
      });
      expect(adminAttack.status).toBe(403);

      // Alice providing wrong clientSecret is also rejected (403)
      const wrongSecret = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          clientId: aliceSSE.clientId,
          clientSecret: 'wrong_secret_value',
          subscriptions: ['__noop__'],
        }),
      });
      expect(wrongSecret.status).toBe(403);

      // Verify Alice's original subscription ('posts') remained untouched (no DoS)
      const post = await app.records.create('posts', { title: 'Post After Hijack Attempt' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 150));

      const received = aliceSSE.events.find((e) => e.event === 'posts' && e.data?.record?.id === post.id);
      expect(received).toBeDefined();
      expect(received?.data?.record?.title).toBe('Post After Hijack Attempt');

      // Alice updating with both matching token and matching clientSecret succeeds
      const aliceResub = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          clientId: aliceSSE.clientId,
          clientSecret: aliceSSE.clientSecret,
          subscriptions: ['posts'],
        }),
      });
      expect(aliceResub.status).toBe(204);
    } finally {
      aliceSSE.close();
    }
  });

  it('should bind anonymous SSE clients to their per-connection clientSecret and reject hijacking', async () => {
    const guestSSE = await connectSSE();

    try {
      // Guest sets initial subscription using valid clientSecret
      const validSub = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: guestSSE.clientId,
          clientSecret: guestSSE.clientSecret,
          subscriptions: ['posts'],
        }),
      });
      expect(validSub.status).toBe(204);

      // Another caller with wrong clientSecret is rejected (403)
      const wrongSecret = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: guestSSE.clientId,
          clientSecret: '0'.repeat(64),
          subscriptions: ['__noop__'],
        }),
      });
      expect(wrongSecret.status).toBe(403);

      // Authenticated third party (Bob) cannot hijack anonymous guest's clientId without guest's clientSecret
      const bobHijackGuest = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bobToken}`,
        },
        body: JSON.stringify({
          clientId: guestSSE.clientId,
          subscriptions: ['__noop__'],
        }),
      });
      expect(bobHijackGuest.status).toBe(403);

      // Also supports x-realtime-secret header
      const headerSecretSub = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-realtime-secret': guestSSE.clientSecret,
        },
        body: JSON.stringify({
          clientId: guestSSE.clientId,
          subscriptions: ['posts'],
        }),
      });
      expect(headerSecretSub.status).toBe(204);

      // Guest still receives events
      const post = await app.records.create('posts', { title: 'Guest Public Post' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 150));
      const received = guestSSE.events.find((e) => e.event === 'posts' && e.data?.record?.id === post.id);
      expect(received).toBeDefined();
    } finally {
      guestSSE.close();
    }
  });

  it('should enforce API key ownership and session revocation on POST /api/realtime', async () => {
    const apiKeySSE = await connectSSE({
      headers: { 'x-api-key': apiKey1Secret },
    });

    try {
      // Wrong API key cannot modify subscriptions
      const wrongKey = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey2Secret,
        },
        body: JSON.stringify({
          clientId: apiKeySSE.clientId,
          subscriptions: ['posts'],
        }),
      });
      expect(wrongKey.status).toBe(403);

      // Owner API key succeeds
      const ownerKey = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey1Secret}`,
        },
        body: JSON.stringify({
          clientId: apiKeySSE.clientId,
          subscriptions: ['posts'],
        }),
      });
      expect(ownerKey.status).toBe(204);
    } finally {
      apiKeySSE.close();
    }

    // Revoked JWT session cannot manage subscriptions
    await app.records.create('users', {
      email: 'revoked@nodestack.test',
      password: 'RevokedPassword123!',
    });
    const revokedAuth = await app.auth.authenticateRecord('users', 'revoked@nodestack.test', 'RevokedPassword123!');
    const revokedSSE = await connectSSE({ token: revokedAuth.token });
    try {
      await app.auth.revokeRecordSessions('users', revokedAuth.record.id);

      const postWithRevoked = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${revokedAuth.token}`,
        },
        body: JSON.stringify({
          clientId: revokedSSE.clientId,
          clientSecret: revokedSSE.clientSecret,
          subscriptions: ['posts'],
        }),
      });
      expect(postWithRevoked.status).toBe(401);
    } finally {
      revokedSSE.close();
    }
  });

  it('should isolate realtime clientIds strictly per application scope and validate payloads', async () => {
    const tenantSSE = await connectSSE({
      urlPath: '/api/apps/tenant-a/realtime',
    });

    try {
      // Posting to default scope with tenant-a clientId + secret must return 404 (no cross-scope fallback)
      const crossScope = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: tenantSSE.clientId,
          clientSecret: tenantSSE.clientSecret,
          subscriptions: ['*'],
        }),
      });
      expect(crossScope.status).toBe(404);

      // Posting to matching scope succeeds
      const sameScope = await fetch(`http://127.0.0.1:${port}/api/apps/tenant-a/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: tenantSSE.clientId,
          clientSecret: tenantSSE.clientSecret,
          subscriptions: ['*'],
        }),
      });
      expect(sameScope.status).toBe(204);

      // Non-string subscription entries return 400 (not 500)
      const badPayload = await fetch(`http://127.0.0.1:${port}/api/apps/tenant-a/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: tenantSSE.clientId,
          clientSecret: tenantSSE.clientSecret,
          subscriptions: [123],
        }),
      });
      expect(badPayload.status).toBe(400);
    } finally {
      tenantSSE.close();
    }
  });

  it('should work end-to-end with NodeStackClient for both authenticated users and anonymous guests', async () => {
    class HttpEventSource {
      public listeners: Record<string, Function[]> = {};
      public onerror: any = null;
      private req: http.ClientRequest;
      private res?: http.IncomingMessage;

      constructor(url: string) {
        this.req = http.get(url, (res) => {
          this.res = res;
          let buffer = '';
          res.on('data', (chunk) => {
            buffer += chunk.toString();
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() || '';
            for (const block of blocks) {
              const eventMatch = block.match(/event:\s*([^\r\n]+)/);
              const dataMatch = block.match(/data:\s*(\{.*\})/);
              if (!eventMatch || !dataMatch) continue;
              const eventName = eventMatch[1].trim();
              const list = this.listeners[eventName];
              if (list) {
                for (const cb of list) {
                  cb({ data: dataMatch[1] });
                }
              }
            }
          });
        });
        this.req.on('error', (err) => {
          if (this.onerror) this.onerror(err);
        });
      }

      public addEventListener(type: string, cb: Function) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(cb);
      }

      public close() {
        try {
          this.req.destroy();
          this.res?.destroy();
        } catch {}
      }
    }

    // 1. Authenticated NodeStackClient
    const aliceClient = new NodeStackClient(`http://127.0.0.1:${port}`, {
      authStore: new MemoryAuthStore(),
      EventSource: HttpEventSource,
    });
    await aliceClient.collection('users').authWithPassword('alice@nodestack.test', 'AlicePassword123!');
    const aliceEvents: any[] = [];
    const aliceUnsub = await aliceClient.collection('posts').subscribe('*', (e) => aliceEvents.push(e));

    // 2. Anonymous NodeStackClient
    const guestClient = new NodeStackClient(`http://127.0.0.1:${port}`, {
      authStore: new MemoryAuthStore(),
      EventSource: HttpEventSource,
    });
    const guestEvents: any[] = [];
    const guestUnsub = await guestClient.collection('posts').subscribe('*', (e) => guestEvents.push(e));

    try {
      const created = await app.records.create('posts', { title: 'SDK E2E Post' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 150));

      expect(aliceEvents.some((e) => e.record?.id === created.id)).toBe(true);
      expect(guestEvents.some((e) => e.record?.id === created.id)).toBe(true);

      await aliceUnsub();
      await guestUnsub();
    } finally {
      aliceClient.realtime.disconnect();
      guestClient.realtime.disconnect();
    }
  });

  it('should stop protected SSE broadcasts and close open connections when user session is revoked, password changes, or user is deleted', async () => {
    await app.schema.createCollection({
      name: 'private_notes',
      type: 'base',
      schema: [{ name: 'body', type: 'text', required: true }],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });

    // 1. User session revocation stops further protected events
    await app.records.create('users', {
      email: 'sse-revoke@nodestack.test',
      password: 'OldPassword123!',
    });
    const auth1 = await app.auth.authenticateRecord('users', 'sse-revoke@nodestack.test', 'OldPassword123!');
    const sse1 = await connectSSE({ token: auth1.token });

    try {
      const sub1 = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth1.token}`,
        },
        body: JSON.stringify({
          clientId: sse1.clientId,
          clientSecret: sse1.clientSecret,
          subscriptions: ['private_notes'],
        }),
      });
      expect(sub1.status).toBe(204);

      const beforeNote = await app.records.create('private_notes', { body: 'Before Revoke' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 120));
      expect(sse1.events.some((e) => e.data?.record?.id === beforeNote.id)).toBe(true);

      await app.auth.revokeRecordSessions('users', auth1.record.id);
      await new Promise((r) => setTimeout(r, 50));
      expect(sse1.isClosed()).toBe(true);

      const afterNote = await app.records.create('private_notes', { body: 'After Revoke' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 150));
      expect(sse1.events.some((e) => e.data?.record?.id === afterNote.id)).toBe(false);
    } finally {
      sse1.close();
    }

    // 2. Password update on auth user invalidates existing SSE stream
    const user2 = await app.records.create('users', {
      email: 'sse-pw@nodestack.test',
      password: 'StartPassword123!',
    });
    const auth2 = await app.auth.authenticateRecord('users', 'sse-pw@nodestack.test', 'StartPassword123!');
    const claims2 = app.auth.verifyToken(auth2.token);
    const sse2 = await connectSSE({ token: auth2.token });

    try {
      await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth2.token}`,
        },
        body: JSON.stringify({
          clientId: sse2.clientId,
          subscriptions: ['private_notes'],
        }),
      });

      const prePwNote = await app.records.create('private_notes', { body: 'Pre Password Change' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 120));
      expect(sse2.events.some((e) => e.data?.record?.id === prePwNote.id)).toBe(true);

      await app.records.update('users', user2.id, { password: 'BrandNewPassword123!' }, claims2);
      await new Promise((r) => setTimeout(r, 50));
      expect(sse2.isClosed()).toBe(true);

      const postPwNote = await app.records.create('private_notes', { body: 'Post Password Change' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 150));
      expect(sse2.events.some((e) => e.data?.record?.id === postPwNote.id)).toBe(false);
    } finally {
      sse2.close();
    }

    // 3. Deleting the authenticated user record stops further protected events
    const user3 = await app.records.create('users', {
      email: 'sse-del@nodestack.test',
      password: 'DeletePassword123!',
    });
    const auth3 = await app.auth.authenticateRecord('users', 'sse-del@nodestack.test', 'DeletePassword123!');
    const sse3 = await connectSSE({ token: auth3.token });

    try {
      await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth3.token}`,
        },
        body: JSON.stringify({
          clientId: sse3.clientId,
          subscriptions: ['private_notes'],
        }),
      });

      await app.records.delete('users', user3.id, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 50));
      expect(sse3.isClosed()).toBe(true);

      const postDeleteNote = await app.records.create('private_notes', { body: 'After Delete' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 150));
      expect(sse3.events.some((e) => e.data?.record?.id === postDeleteNote.id)).toBe(false);
    } finally {
      sse3.close();
    }
  });

  it('should revalidate and close expired JWTs, revoked/rotated API keys, and revoked super-admin sessions across scopes', async () => {
    // Ensure admin_notes exists on default and tenant-a
    await app.schema.createCollection({
      name: 'admin_notes',
      type: 'base',
      schema: [{ name: 'secret', type: 'text', required: true }],
      listRule: '@request.auth.isAdmin == true',
      viewRule: '@request.auth.isAdmin == true',
      createRule: '@request.auth.isAdmin == true',
      updateRule: '@request.auth.isAdmin == true',
      deleteRule: '@request.auth.isAdmin == true',
    });

    const tenantScope = await app.apps.getAsync('tenant-a');
    await tenantScope.schema.createCollection({
      name: 'tenant_admin_notes',
      type: 'base',
      schema: [{ name: 'secret', type: 'text', required: true }],
      listRule: '@request.auth.isAdmin == true',
      viewRule: '@request.auth.isAdmin == true',
      createRule: '@request.auth.isAdmin == true',
      updateRule: '@request.auth.isAdmin == true',
      deleteRule: '@request.auth.isAdmin == true',
    });

    // 1. Short-lived JWT expiring while SSE stream remains open
    await app.records.create('users', {
      email: 'sse-exp@nodestack.test',
      password: 'ExpPassword123!',
    });
    const expAuth = await app.auth.authenticateRecord('users', 'sse-exp@nodestack.test', 'ExpPassword123!');
    const claims = app.auth.verifyToken(expAuth.token);
    const shortToken = app.auth.generateToken(
      {
        id: claims.id,
        email: claims.email,
        collection: claims.collection,
        tokenKey: claims.tokenKey,
        isAdmin: false,
      },
      '1s'
    );
    const expSSE = await connectSSE({ token: shortToken });

    try {
      const subRes = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${shortToken}`,
        },
        body: JSON.stringify({
          clientId: expSSE.clientId,
          subscriptions: ['private_notes'],
        }),
      });
      expect(subRes.status).toBe(204);

      const n1 = await app.records.create('private_notes', { body: 'Before JWT Exp' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 120));
      expect(expSSE.events.some((e) => e.data?.record?.id === n1.id)).toBe(true);

      await new Promise((r) => setTimeout(r, 1100));
      const n2 = await app.records.create('private_notes', { body: 'After JWT Exp' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 150));
      expect(expSSE.events.some((e) => e.data?.record?.id === n2.id)).toBe(false);
      expect(expSSE.isClosed()).toBe(true);
    } finally {
      expSSE.close();
    }

    // 2. Out-of-band DB tokenKey rotation + cache invalidation caught on broadcast() revalidation
    const oobAuth = await app.auth.authenticateRecord('users', 'sse-exp@nodestack.test', 'ExpPassword123!');
    const oobSSE = await connectSSE({ token: oobAuth.token });

    try {
      await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${oobAuth.token}`,
        },
        body: JSON.stringify({
          clientId: oobSSE.clientId,
          subscriptions: ['private_notes'],
        }),
      });

      app.db.run('UPDATE users SET tokenKey = ? WHERE id = ?', 'rotated_out_of_band_key', oobAuth.record.id);
      app.auth.invalidateTokenCache('users', oobAuth.record.id);

      const n3 = await app.records.create('private_notes', { body: 'Blocked By Broadcast Revalidate' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 150));
      expect(oobSSE.events.some((e) => e.data?.record?.id === n3.id)).toBe(false);
      expect(oobSSE.isClosed()).toBe(true);
    } finally {
      oobSSE.close();
    }

    // 3. API Key revocation and rotation stop SSE event delivery
    const createdKey = await app.defaultApp.apiKeys.createKey({
      name: 'Revocable Realtime Key',
      role: 'admin',
      scopes: ['*'],
    });
    const apiKeySSE = await connectSSE({
      headers: { 'x-api-key': createdKey.secretKey },
    });

    try {
      await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': createdKey.secretKey,
        },
        body: JSON.stringify({
          clientId: apiKeySSE.clientId,
          subscriptions: ['admin_notes'],
        }),
      });

      const a1 = await app.records.create('admin_notes', { secret: 'Key Valid Secret' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 120));
      expect(apiKeySSE.events.some((e) => e.data?.record?.id === a1.id)).toBe(true);

      await app.defaultApp.apiKeys.rotateKey(createdKey.apiKey.id);
      await new Promise((r) => setTimeout(r, 50));
      expect(apiKeySSE.isClosed()).toBe(true);

      const a2 = await app.records.create('admin_notes', { secret: 'Key Rotated Secret' }, { isAdmin: true });
      await new Promise((r) => setTimeout(r, 150));
      expect(apiKeySSE.events.some((e) => e.data?.record?.id === a2.id)).toBe(false);
    } finally {
      apiKeySSE.close();
    }

    // 4. Super-admin revocation propagates to both control-plane and tenant SSE streams
    await app.auth.createAdmin('sec-admin-sse@nodestack.io', 'AdminPassword123!');
    const tempAdminToken = (await app.auth.authenticateAdmin('sec-admin-sse@nodestack.io', 'AdminPassword123!')).token;
    const rootAdminSSE = await connectSSE({ token: tempAdminToken });
    const tenantAdminSSE = await connectSSE({
      token: tempAdminToken,
      urlPath: '/api/apps/tenant-a/realtime',
    });

    try {
      await fetch(`http://127.0.0.1:${port}/api/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tempAdminToken}`,
        },
        body: JSON.stringify({
          clientId: rootAdminSSE.clientId,
          subscriptions: ['admin_notes'],
        }),
      });
      await fetch(`http://127.0.0.1:${port}/api/apps/tenant-a/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tempAdminToken}`,
        },
        body: JSON.stringify({
          clientId: tenantAdminSSE.clientId,
          subscriptions: ['tenant_admin_notes'],
        }),
      });

      const t1 = await tenantScope.records.create(
        'tenant_admin_notes',
        { secret: 'Before Admin Revoke' },
        { isAdmin: true }
      );
      await new Promise((r) => setTimeout(r, 120));
      expect(tenantAdminSSE.events.some((e) => e.data?.record?.id === t1.id)).toBe(true);

      app.auth.revokeAdminSessions('sec-admin-sse@nodestack.io');
      await new Promise((r) => setTimeout(r, 50));
      expect(rootAdminSSE.isClosed()).toBe(true);
      expect(tenantAdminSSE.isClosed()).toBe(true);

      const rAfter = await app.records.create('admin_notes', { secret: 'After Admin Revoke Root' }, { isAdmin: true });
      const tAfter = await tenantScope.records.create(
        'tenant_admin_notes',
        { secret: 'After Admin Revoke Tenant' },
        { isAdmin: true }
      );
      await new Promise((r) => setTimeout(r, 150));

      expect(rootAdminSSE.events.some((e) => e.data?.record?.id === rAfter.id)).toBe(false);
      expect(tenantAdminSSE.events.some((e) => e.data?.record?.id === tAfter.id)).toBe(false);
    } finally {
      rootAdminSSE.close();
      tenantAdminSSE.close();
    }
  });
});
