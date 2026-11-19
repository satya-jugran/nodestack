import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { NodeStack } from '../src/NodeStack';
import { NodeStackClient, MemoryAuthStore } from '../packages/client/src';
import { runCli } from '../src/cli/cli';

describe('Unified Authorization: Hydrated Roles, Protected Fields, Custom Functions/Flows & Scoped API Keys', () => {
  const testDataDir = path.resolve('./.test_rbac_unified_data');
  let app: NodeStack;
  let serverUrl: string;
  let adminToken: string;

  beforeEach(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDataDir,
      port: 0,
      host: '127.0.0.1',
      jwtSecret: 'test_rbac_unified_secret_1234567890abcdef',
    });

    serverUrl = await app.start(0, '127.0.0.1');

    await app.auth.createAdmin('admin@nodestack.local', 'AdminSecretPass123!');
    const adminAuth = await app.auth.authenticateAdmin('admin@nodestack.local', 'AdminSecretPass123!');
    adminToken = adminAuth.token;
  });

  afterEach(async () => {
    await app.stop();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('1. End-User Attribute Hydration, Cache Invalidation & Protected (adminOnly) Fields', () => {
    it('enforces adminOnly protected fields and hydrates updated roles onto existing JWTs without re-login', async () => {
      const usersCol = await app.schema.getCollectionOrThrow('users');
      await app.schema.updateCollection('users', {
        schema: [
          ...usersCol.schema,
          {
            id: 'f_role',
            name: 'role',
            type: 'select',
            required: true,
            unique: false,
            adminOnly: true,
            defaultValue: 'user',
            options: { values: ['user', 'editor', 'moderator'] },
          },
        ],
      });

      await app.schema.createCollection({
        name: 'vendors',
        type: 'auth',
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: 'id = @request.auth.id',
        deleteRule: 'id = @request.auth.id',
        schema: [
          {
            id: 'f_vname',
            name: 'name',
            type: 'text',
            required: false,
          },
          {
            id: 'f_vrole',
            name: 'role',
            type: 'select',
            required: true,
            adminOnly: true,
            defaultValue: 'pending',
            options: { values: ['pending', 'verified_seller'] },
          },
        ],
      });

      await app.schema.createCollection({
        name: 'editorial_posts',
        type: 'base',
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.role = "moderator"',
        updateRule: '@request.auth.role = "moderator"',
        deleteRule: '@request.auth.role = "moderator"',
        schema: [{ id: 'f_ep_title', name: 'title', type: 'text', required: true }],
      });

      await app.schema.createCollection({
        name: 'vendor_listings',
        type: 'base',
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.collection = "vendors" && @request.auth.role = "verified_seller"',
        updateRule: null,
        deleteRule: null,
        schema: [{ id: 'f_vl_sku', name: 'sku', type: 'text', required: true }],
      });

      // (a) Public signup omitting role -> assigns defaultValue 'user' and exposes it in response
      const signupRes = await fetch(`${serverUrl}/api/collections/users/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice@example.com',
          password: 'UserPass123!',
          name: 'Alice',
        }),
      });
      expect(signupRes.status).toBe(201);
      const alice = await signupRes.json();
      expect(alice.role).toBe('user');

      // (b) Public signup attempting to self-assign protected role -> 403 Forbidden
      const escalateSignupRes = await fetch(`${serverUrl}/api/collections/users/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'attacker@example.com',
          password: 'UserPass123!',
          name: 'Attacker',
          role: 'moderator',
        }),
      });
      expect(escalateSignupRes.status).toBe(403);
      const escalateErr = await escalateSignupRes.json();
      expect(escalateErr.message).toContain("Field 'role' is protected");

      // Log Alice in
      const loginRes = await fetch(`${serverUrl}/api/collections/users/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'alice@example.com', password: 'UserPass123!' }),
      });
      expect(loginRes.status).toBe(200);
      const { token: aliceToken } = await loginRes.json();

      // (c) Self-update passing unchanged role succeeds (200), modifying role is rejected (403)
      const sameRolePatch = await fetch(`${serverUrl}/api/collections/users/records/${alice.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ name: 'Alice Updated', role: 'user' }),
      });
      expect(sameRolePatch.status).toBe(200);

      const escalatePatch = await fetch(`${serverUrl}/api/collections/users/records/${alice.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ role: 'moderator' }),
      });
      expect(escalatePatch.status).toBe(403);

      // (d) Alice ('user') is forbidden from creating editorial_posts
      const deniedPost = await fetch(`${serverUrl}/api/collections/editorial_posts/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ title: 'Unauthorized draft' }),
      });
      expect(deniedPost.status).toBe(403);

      // (e) Admin promotes Alice to 'moderator' -> cache invalidates -> existing JWT works immediately!
      const adminPromote = await fetch(`${serverUrl}/api/collections/users/records/${alice.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ role: 'moderator' }),
      });
      expect(adminPromote.status).toBe(200);

      const allowedPost = await fetch(`${serverUrl}/api/collections/editorial_posts/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ title: 'Moderator Approved' }),
      });
      expect(allowedPost.status).toBe(201);

      // (f) Cross-collection boundary: Alice ('users', 'moderator') cannot create vendor_listings
      const crossColDenied = await fetch(`${serverUrl}/api/collections/vendor_listings/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ sku: 'SKU-WRONG-COL' }),
      });
      expect(crossColDenied.status).toBe(403);

      // Vendor signup & promotion to verified_seller succeeds on vendor_listings
      const vendorSignup = await fetch(`${serverUrl}/api/collections/vendors/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'shop@vendor.com', password: 'VendorPass123!', name: 'Shop Co' }),
      });
      expect(vendorSignup.status).toBe(201);
      const vendorRec = await vendorSignup.json();
      expect(vendorRec.role).toBe('pending');

      const vendorLogin = await fetch(`${serverUrl}/api/collections/vendors/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'shop@vendor.com', password: 'VendorPass123!' }),
      });
      const { token: vendorToken } = await vendorLogin.json();

      // Admin promotes vendor to verified_seller
      const promoteVendor = await fetch(`${serverUrl}/api/collections/vendors/records/${vendorRec.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ role: 'verified_seller' }),
      });
      expect(promoteVendor.status).toBe(200);

      const vendorAllowed = await fetch(`${serverUrl}/api/collections/vendor_listings/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${vendorToken}`,
        },
        body: JSON.stringify({ sku: 'SKU-VALID-001' }),
      });
      expect(vendorAllowed.status).toBe(201);
    });
  });

  describe('2. Dual-Track authPolicy: custom on Functions & HTTP Flows + Execution Polling Isolation', () => {
    it('enforces invokeRule and scoped API keys on both Functions and HTTP Flows with actor isolation', async () => {
      const usersCol = await app.schema.getCollectionOrThrow('users');
      await app.schema.updateCollection('users', {
        schema: [
          ...usersCol.schema,
          {
            id: 'f_role',
            name: 'role',
            type: 'select',
            defaultValue: 'user',
            adminOnly: true,
            options: { values: ['user', 'moderator'] },
          },
        ],
      });

      // Create userA (promoted to moderator) and userB (stays user)
      const uARes = await fetch(`${serverUrl}/api/collections/users/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'mod@example.com', password: 'ModUserPass123!', name: 'Mod User' }),
      });
      const userA = await uARes.json();

      const uBRes = await fetch(`${serverUrl}/api/collections/users/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'regular@example.com', password: 'RegUserPass123!', name: 'Reg User' }),
      });
      const userB = await uBRes.json();

      // Promote userA to moderator
      await fetch(`${serverUrl}/api/collections/users/records/${userA.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ role: 'moderator' }),
      });

      const modLogin = await fetch(`${serverUrl}/api/collections/users/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'mod@example.com', password: 'ModUserPass123!' }),
      });
      const { token: modToken } = await modLogin.json();

      const regLogin = await fetch(`${serverUrl}/api/collections/users/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'regular@example.com', password: 'RegUserPass123!' }),
      });
      const { token: regToken } = await regLogin.json();

      // Provision Function with custom invokeRule
      app.functions.createFunction({
        name: 'mod-audit-fn',
        code: `export default async function(core, ctx) { return { status: 200, body: { auth: ctx.request.auth } }; }`,
        enabled: true,
        authPolicy: 'custom',
        invokeRule: '@request.auth.role = "moderator"',
        methods: ['POST'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const scopedFnKey = app.apiKeys.createKey({
        name: 'Audit Fn Key',
        role: 'service',
        scopes: ['functions:mod-audit-fn'],
      });
      const wrongKey = app.apiKeys.createKey({
        name: 'Unrelated Key',
        role: 'service',
        scopes: ['orders:read'],
      });

      // Function checks: anon (403), regular user (403), moderator (200), scoped key (200), wrong key (403)
      const fnAnon = await fetch(`${serverUrl}/api/functions/mod-audit-fn/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(fnAnon.status).toBe(403);

      const fnReg = await fetch(`${serverUrl}/api/functions/mod-audit-fn/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${regToken}` },
        body: JSON.stringify({}),
      });
      expect(fnReg.status).toBe(403);

      const fnMod = await fetch(`${serverUrl}/api/functions/mod-audit-fn/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${modToken}` },
        body: JSON.stringify({}),
      });
      expect(fnMod.status).toBe(200);
      const fnModBody = await fnMod.json();
      expect(fnModBody.auth.role).toBe('moderator');
      expect(fnModBody.auth.collection).toBe('users');
      expect(fnModBody.auth.tokenKey).toBeUndefined();

      const fnKeyAllowed = await fetch(`${serverUrl}/api/functions/mod-audit-fn/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${scopedFnKey.secretKey}` },
        body: JSON.stringify({}),
      });
      expect(fnKeyAllowed.status).toBe(200);

      const fnKeyDenied = await fetch(`${serverUrl}/api/functions/mod-audit-fn/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${wrongKey.secretKey}` },
        body: JSON.stringify({}),
      });
      expect(fnKeyDenied.status).toBe(403);

      // Provision HTTP Flow with custom invokeRule
      app.flows.createFlow({
        name: 'mod-approval-flow',
        enabled: true,
        triggerType: 'http',
        authPolicy: 'custom',
        invokeRule: '@request.auth.role = "moderator"',
        definition: {
          startAt: 'ApproveStep',
          states: {
            ApproveStep: { type: 'Pass', result: { approved: true }, end: true },
          },
        },
      });

      const scopedFlowKey = app.apiKeys.createKey({
        name: 'Flow Key',
        role: 'service',
        scopes: ['flows:mod-approval-flow'],
      });

      const anotherScopedFlowKey = app.apiKeys.createKey({
        name: 'Another Flow Key',
        role: 'service',
        scopes: ['flows:mod-approval-flow'],
      });

      // Flow checks: anon (403), regular user (403), moderator (202 + poll 200), wrong user poll (403), scoped key (202 + poll 200), wrong key (403)
      const flowAnon = await fetch(`${serverUrl}/api/flows/mod-approval-flow/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 1 }),
      });
      expect(flowAnon.status).toBe(403);

      const flowReg = await fetch(`${serverUrl}/api/flows/mod-approval-flow/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${regToken}` },
        body: JSON.stringify({ orderId: 1 }),
      });
      expect(flowReg.status).toBe(403);

      const flowMod = await fetch(`${serverUrl}/api/flows/mod-approval-flow/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${modToken}` },
        body: JSON.stringify({ orderId: 1 }),
      });
      expect(flowMod.status).toBe(202);
      const modExec = await flowMod.json();
      expect(modExec.executionId).toBeDefined();

      // Moderator can poll their own execution
      const pollOwner = await fetch(`${serverUrl}/api/flows/executions/${modExec.executionId}`, {
        headers: { Authorization: `Bearer ${modToken}` },
      });
      expect(pollOwner.status).toBe(200);

      // Different user cannot poll Moderator's execution
      const pollOther = await fetch(`${serverUrl}/api/flows/executions/${modExec.executionId}`, {
        headers: { Authorization: `Bearer ${regToken}` },
      });
      expect(pollOther.status).toBe(403);

      // Scoped flow API key can execute & poll
      const flowKeyRes = await fetch(`${serverUrl}/api/flows/mod-approval-flow/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${scopedFlowKey.secretKey}` },
        body: JSON.stringify({ orderId: 2 }),
      });
      expect(flowKeyRes.status).toBe(202);
      const keyExec = await flowKeyRes.json();

      const pollKey = await fetch(`${serverUrl}/api/flows/executions/${keyExec.executionId}`, {
        headers: { Authorization: `ApiKey ${scopedFlowKey.secretKey}` },
      });
      expect(pollKey.status).toBe(200);

      // Another scoped key (with same flow scope) CANNOT poll this execution (actor isolation)
      const pollAnotherKey = await fetch(`${serverUrl}/api/flows/executions/${keyExec.executionId}`, {
        headers: { Authorization: `ApiKey ${anotherScopedFlowKey.secretKey}` },
      });
      expect(pollAnotherKey.status).toBe(403);

      // Scoped key CANNOT poll an execution created by a different actor (Moderator)
      const pollModExecByKey = await fetch(`${serverUrl}/api/flows/executions/${modExec.executionId}`, {
        headers: { Authorization: `ApiKey ${scopedFlowKey.secretKey}` },
      });
      expect(pollModExecByKey.status).toBe(403);

      // Moderator CANNOT poll an execution created by an API key
      const pollKeyExecByMod = await fetch(`${serverUrl}/api/flows/executions/${keyExec.executionId}`, {
        headers: { Authorization: `Bearer ${modToken}` },
      });
      expect(pollKeyExecByMod.status).toBe(403);

      const flowKeyDenied = await fetch(`${serverUrl}/api/flows/mod-approval-flow/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${wrongKey.secretKey}` },
        body: JSON.stringify({ orderId: 3 }),
      });
      expect(flowKeyDenied.status).toBe(403);

      // Service boundary enforcement on app.flows.executeFlow()
      // 1. Direct invocation without actor on protected HTTP flow fails
      await expect(
        app.flows.executeFlow('mod-approval-flow', { orderId: 4 })
      ).rejects.toThrow(/You do not satisfy the access rule to execute flow 'mod-approval-flow'/);

      // 2. Direct invocation with non-moderator actor fails
      await expect(
        app.flows.executeFlow('mod-approval-flow', { orderId: 4 }, { id: 'u_user', role: 'user' })
      ).rejects.toThrow(/You do not satisfy the access rule to execute flow 'mod-approval-flow'/);

      // 3. Direct invocation with authorized moderator actor succeeds
      const directModExec = await app.flows.executeFlow(
        'mod-approval-flow',
        { orderId: 4 },
        { id: 'u_mod', role: 'moderator' },
        { wait: true }
      );
      expect(directModExec.status).toBe('succeeded');

      // 4. Explicit trusted internal execution (e.g. event triggers) succeeds without external actor
      const directTrustedExec = await app.flows.executeFlow(
        'mod-approval-flow',
        { orderId: 5 },
        undefined,
        { wait: true, trusted: true }
      );
      expect(directTrustedExec.status).toBe('succeeded');
    });
  });

  describe('3. Per-Queue API Key Scopes (queues:<name>:send)', () => {
    it('restricts REST queue ingestion and core.sdk.queue.send() to the authorized target queue only', async () => {
      await app.queue.upsertQueue({ name: 'email-jobs' });
      await app.queue.upsertQueue({ name: 'payout-jobs' });

      app.functions.createFunction({
        name: 'queue-proxy-fn',
        code: `
          export default async function(core, ctx) {
            const targetQueue = ctx.request.body.targetQueue;
            const job = await core.sdk.queue(targetQueue).send({ task: 'ping' });
            return { status: 200, body: { jobId: job.id } };
          }
        `,
        enabled: true,
        authPolicy: 'apiKey',
        methods: ['POST'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const emailWorkerKey = app.apiKeys.createKey({
        name: 'Email Queue Key',
        role: 'service',
        scopes: ['queues:email-jobs:send', 'functions:queue-proxy-fn'],
      });

      // REST enqueue: email-jobs succeeds (201), payout-jobs is rejected (403)
      const emailRest = await fetch(`${serverUrl}/api/queues/email-jobs/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${emailWorkerKey.secretKey}` },
        body: JSON.stringify({ payload: { to: 'user@example.com' } }),
      });
      expect(emailRest.status).toBe(201);

      const payoutRest = await fetch(`${serverUrl}/api/queues/payout-jobs/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${emailWorkerKey.secretKey}` },
        body: JSON.stringify({ payload: { amount: 5000 } }),
      });
      expect(payoutRest.status).toBe(403);

      // Inside non-elevated function: email-jobs succeeds (200), payout-jobs fails (403 / 500 error)
      const fnAllowed = await fetch(`${serverUrl}/api/functions/queue-proxy-fn/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${emailWorkerKey.secretKey}` },
        body: JSON.stringify({ targetQueue: 'email-jobs' }),
      });
      expect(fnAllowed.status).toBe(200);
      const fnAllowedBody = await fnAllowed.json();
      expect(fnAllowedBody.jobId).toBeDefined();

      const fnDenied = await fetch(`${serverUrl}/api/functions/queue-proxy-fn/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${emailWorkerKey.secretKey}` },
        body: JSON.stringify({ targetQueue: 'payout-jobs' }),
      });
      expect([403, 500]).toContain(fnDenied.status);
      const fnDeniedBody = await fnDenied.json();
      expect(fnDeniedBody.message).toContain('missing required scope');
    });

    it('enforces that claiming queue messages requires read scope and rejects send-only keys', async () => {
      app.functions.createFunction({
        name: 'queue-claim-fn',
        code: `
          export default async function(core, ctx) {
            const queueName = ctx.request.body.queueName;
            const messages = await core.sdk.queue(queueName).claim();
            return { status: 200, body: { count: messages.length } };
          }
        `,
        enabled: true,
        authPolicy: 'apiKey',
        methods: ['POST'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const sendOnlyKey = app.apiKeys.createKey({
        name: 'Send Only Key',
        role: 'service',
        scopes: ['queues:email-jobs:send', 'functions:queue-claim-fn'],
      });

      const readKey = app.apiKeys.createKey({
        name: 'Read Key',
        role: 'service',
        scopes: ['queues:email-jobs:read', 'functions:queue-claim-fn'],
      });

      // send-only key attempting to claim should fail
      const claimDenied = await fetch(`${serverUrl}/api/functions/queue-claim-fn/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${sendOnlyKey.secretKey}` },
        body: JSON.stringify({ queueName: 'email-jobs' }),
      });
      expect([403, 500]).toContain(claimDenied.status);
      const claimDeniedBody = await claimDenied.json();
      expect(claimDeniedBody.message).toContain('missing required scope to claim messages');

      // read key attempting to claim should succeed
      const claimAllowed = await fetch(`${serverUrl}/api/functions/queue-claim-fn/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${readKey.secretKey}` },
        body: JSON.stringify({ queueName: 'email-jobs' }),
      });
      expect(claimAllowed.status).toBe(200);
      const claimAllowedBody = await claimAllowed.json();
      expect(claimAllowedBody.count).toBeDefined();
    });
  });

  describe('4. Admin UI JSDOM Verification (API Keys Manager, Secure Defaults, Custom Rules & Protected Fields)', () => {
    it('renders #nav-api-keys, 4-subsystem scope matrix, admin UI defaults, standalone rule editor, and role preset', async () => {
      const bundledHtmlPath = path.resolve('dist/admin/ui/index.html');
      const html = fs.readFileSync(bundledHtmlPath, 'utf8');

      const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'http://localhost:8090/_/',
        beforeParse(window: any) {
          window.setInterval = vi.fn().mockReturnValue(1);
          window.clearInterval = vi.fn();
          window.fetch = vi.fn().mockImplementation(async () => ({
            ok: true,
            json: async () => ({ hasAdmins: true }),
          }));
        },
      });
      const win = dom.window as any;
      const doc = win.document;

      try {
        win.api = vi.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/api/api-keys') return [];
          if (endpoint === '/api/functions') return [{ id: 'fn_1', name: 'my-fn' }];
          if (endpoint === '/api/flows') return [{ id: 'fl_1', name: 'my-flow', triggerType: 'http' }];
          if (endpoint === '/api/queues') return [{ name: 'email-jobs', isSystem: false }];
          return [];
        });
        win.state.collections = [
          { id: 'c_users', name: 'users', type: 'auth', system: false, schema: [{ id: 'f1', name: 'name', type: 'text' }] },
          { id: 'c_orders', name: 'orders', type: 'base', system: false, schema: [{ id: 'f2', name: 'title', type: 'text' }] },
        ];

        // 1. Sidebar link & navigation to API Keys view
        const navApiKeys = doc.getElementById('nav-api-keys');
        expect(navApiKeys).not.toBeNull();
        await win.selectNav('api-keys', false);
        expect(doc.getElementById('page-view-api-keys')?.style.display).toBe('block');

        // 2. Open API Key Drawer & check 4 <fieldset> scope legends
        await win.openApiKeyDrawer();
        const drawerText = doc.getElementById('drawer-root')?.textContent || '';
        expect(drawerText).toContain('Collections Scopes');
        expect(drawerText).toContain('Serverless Functions Scopes');
        expect(drawerText).toContain('HTTP Flows Scopes');
        expect(drawerText).toContain('Message Queues Scopes');
        expect(drawerText).toContain('email-jobs');

        // 2a. Mutual exclusion: All ("*") <-> Specific across all 4 subsystems
        const colAllRead = doc.getElementById('scope-col-all-read') as HTMLInputElement;
        const colAllWrite = doc.getElementById('scope-col-all-write') as HTMLInputElement;
        const colR0 = doc.getElementById('scope-col-r-0') as HTMLInputElement;
        const colR1 = doc.getElementById('scope-col-r-1') as HTMLInputElement;
        const colW0 = doc.getElementById('scope-col-w-0') as HTMLInputElement;

        // Checking All Collections Read disables specific Read checkboxes (but not Write)
        colAllRead.checked = true;
        colAllRead.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(colR0.disabled).toBe(true);
        expect(colR1.disabled).toBe(true);
        expect(colW0.disabled).toBe(false);

        // Unchecking All Collections Read re-enables specific Read checkboxes
        colAllRead.checked = false;
        colAllRead.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(colR0.disabled).toBe(false);
        expect(colR1.disabled).toBe(false);

        // Checking specific Collection Read disables All Collections Read (but leaves other rows & All Write enabled)
        colR0.checked = true;
        colR0.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(colAllRead.disabled).toBe(true);
        expect(colR1.disabled).toBe(false);
        expect(colAllWrite.disabled).toBe(false);

        // Unchecking specific Collection Read re-enables All Collections Read
        colR0.checked = false;
        colR0.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(colAllRead.disabled).toBe(false);

        // Functions mutual exclusion
        const fnAll = doc.getElementById('scope-fn-all') as HTMLInputElement;
        const fn0 = doc.getElementById('scope-fn-0') as HTMLInputElement;
        fnAll.checked = true;
        fnAll.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(fn0.disabled).toBe(true);
        fnAll.checked = false;
        fnAll.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(fn0.disabled).toBe(false);
        fn0.checked = true;
        fn0.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(fnAll.disabled).toBe(true);
        fn0.checked = false;
        fn0.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(fnAll.disabled).toBe(false);

        // Flows mutual exclusion
        const flowAll = doc.getElementById('scope-flow-all') as HTMLInputElement;
        const flow0 = doc.getElementById('scope-flow-0') as HTMLInputElement;
        flowAll.checked = true;
        flowAll.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(flow0.disabled).toBe(true);
        flowAll.checked = false;
        flowAll.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(flow0.disabled).toBe(false);
        flow0.checked = true;
        flow0.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(flowAll.disabled).toBe(true);
        flow0.checked = false;
        flow0.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(flowAll.disabled).toBe(false);

        // Queues mutual exclusion per action column
        const qAllSend = doc.getElementById('scope-q-all-send') as HTMLInputElement;
        const qS0 = doc.getElementById('scope-q-s-0') as HTMLInputElement;
        const qR0 = doc.getElementById('scope-q-r-0') as HTMLInputElement;
        qAllSend.checked = true;
        qAllSend.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(qS0.disabled).toBe(true);
        expect(qR0.disabled).toBe(false);
        qAllSend.checked = false;
        qAllSend.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(qS0.disabled).toBe(false);
        qS0.checked = true;
        qS0.dispatchEvent(new win.Event('change', { bubbles: true }));
        expect(qAllSend.disabled).toBe(true);
        win.closeApiKeyDrawer();

        // 2b. Initial drawer sync when editing an existing key with specific scope
        win.apiKeysState.keys = [
          { id: 'k_existing', name: 'Order Writer', role: 'service', scopes: ['orders:write'] },
        ];
        await win.openApiKeyDrawer('k_existing');
        expect((doc.getElementById('scope-col-all-write') as HTMLInputElement).disabled).toBe(true);
        expect((doc.getElementById('scope-col-all-read') as HTMLInputElement).disabled).toBe(false);
        win.closeApiKeyDrawer();

        // 2c. API Key Permissions Tester Modal
        win.renderApiKeysView();
        const testBtn = doc.querySelector('button[data-action="test"][data-key-id="k_existing"]') as HTMLButtonElement;
        expect(testBtn).not.toBeNull();
        await win.openApiKeyTesterModal('k_existing');
        expect(doc.getElementById('apikey-tester-title')?.textContent).toContain('API Key Permissions Tester');
        expect(doc.getElementById('tester-subsystem-select')).not.toBeNull();
        expect(doc.getElementById('btn-run-api-key-test')).not.toBeNull();

        // Switch to Queues in tester
        win.handleTesterSubsystemChange('queues', 'k_existing');
        const actSelect = doc.getElementById('tester-action-select') as HTMLSelectElement;
        expect(actSelect.textContent).toContain('send');
        expect(actSelect.textContent).toContain('claim');

        // Mock simulation response and trigger simulation
        win.api = vi.fn().mockImplementation(async (endpoint: string, opts?: any) => {
          if (endpoint.includes('/simulate')) {
            return {
              allowed: true,
              status: 200,
              reason: "Granted by scope 'queues:email-jobs:send'",
              matchedScope: 'queues:email-jobs:send',
              curlExample: 'curl -X POST "/api/queues/email-jobs/messages"',
            };
          }
          return [];
        });
        await win.runApiKeySimulation('k_existing');
        expect(doc.getElementById('api-key-tester-result')?.textContent).toContain('ACCESS GRANTED');
        expect(doc.getElementById('api-key-tester-result')?.textContent).toContain('queues:email-jobs:send');
        win.closeApiKeyTesterModal();

        // 3. New Function UI defaults authPolicy to 'admin' and supports 'custom' Visual Rule Editor
        await win.openCreateFunctionModal();
        expect(win.functionsState.activeFunctionForEdit.authPolicy).toBe('admin');
        const fnAuthSelect = doc.getElementById('fn-editor-auth') as HTMLSelectElement;
        expect(fnAuthSelect.value).toBe('admin');
        win.handleFunctionAuthPolicyChange('custom');
        expect(doc.getElementById('standalone-rule-editor-fn_invoke')).not.toBeNull();
        win.closeFunctionEditor(false);

        // 4. New HTTP Flow modal pre-selects 'admin' on #new-flow-auth-policy
        win.openCreateFlowModal();
        const flowAuthSelect = doc.getElementById('new-flow-auth-policy') as HTMLSelectElement;
        expect(flowAuthSelect).not.toBeNull();
        expect(flowAuthSelect.value).toBe('admin');
        win.closeFlowModal();

        // 5. Schema UI renders '+ Add Role Field' preset and Protected checkbox on auth collection
        win.state.activeCollection = JSON.parse(JSON.stringify(win.state.collections[0]));
        win.renderSchemaView();
        expect(doc.getElementById('btn-add-role-field')).not.toBeNull();
        expect(doc.querySelectorAll('.field-admin-only-cb').length).toBeGreaterThan(0);

        win.addRoleFieldPreset();
        const addedRoleField = win.state.activeCollection.schema.find((f: any) => f.name === 'role');
        expect(addedRoleField).toBeDefined();
        expect(addedRoleField.adminOnly).toBe(true);
        expect(addedRoleField.defaultValue).toBe('user');
      } finally {
        dom.window.close();
      }
    });
  });

  describe('5. Client SDK (client.apiKeys), CLI (nodestack api-keys) & Server Scope Normalization', () => {
    it('supports full API key lifecycle + server-side scope normalization via NodeStackClient SDK', async () => {
      await app.schema.createCollection({
        name: 'orders',
        type: 'base',
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        schema: [{ name: 'title', type: 'text', required: true }],
      });

      const adminClient = new NodeStackClient(serverUrl, {
        authStore: new MemoryAuthStore(),
      });
      await adminClient.admins.authWithPassword('admin@nodestack.local', 'AdminSecretPass123!');

      // Create key with redundant specific scopes alongside wildcards -> server must normalize
      const created = await adminClient.apiKeys.create({
        name: 'SDK Worker',
        role: 'service',
        scopes: [
          '*:read',
          'users:read',
          'functions:invoke',
          'functions:my-fn',
          'queues:send',
          'queues:email-jobs:send',
          'queues:email-jobs:read',
        ],
      });

      expect(created.secretKey.startsWith('nsk_')).toBe(true);
      expect(created.apiKey.scopes).toEqual([
        '*:read',
        'functions:invoke',
        'queues:send',
        'queues:email-jobs:read',
      ]);

      const listed = await adminClient.apiKeys.getList();
      expect(listed.some((k) => k.id === created.apiKey.id)).toBe(true);

      const fetched = await adminClient.apiKeys.getOne(created.apiKey.id);
      expect(fetched.name).toBe('SDK Worker');

      // Rotate key secret
      const rotated = await adminClient.apiKeys.rotate(created.apiKey.id);
      expect(rotated.secretKey.startsWith('nsk_')).toBe(true);
      expect(rotated.secretKey).not.toBe(created.secretKey);

      // Revoke and verify access is denied, then restore and verify access resumes
      const revoked = await adminClient.apiKeys.revoke(created.apiKey.id);
      expect(revoked.status).toBe('revoked');

      const keyClient = new NodeStackClient(serverUrl, { apiKey: rotated.secretKey });
      let rejectedStatus = 0;
      try {
        await keyClient.collection('orders').getList();
      } catch (err: any) {
        rejectedStatus = err?.status || 0;
      }
      expect([401, 403]).toContain(rejectedStatus);

      const restored = await adminClient.apiKeys.restore(created.apiKey.id);
      expect(restored.status).toBe('active');
      const ordersRes = await keyClient.collection('orders').getList();
      expect(Array.isArray(ordersRes.items)).toBe(true);

      // Update scopes -> normalization strips flows:mod-approval-flow when flows:execute is set
      const updated = await adminClient.apiKeys.update(created.apiKey.id, {
        scopes: ['flows:execute', 'flows:mod-approval-flow'],
      });
      expect(updated.scopes).toEqual(['flows:execute']);

      // Delete
      const deleted = await adminClient.apiKeys.delete(created.apiKey.id);
      expect(deleted).toBe(true);
      const afterDelete = await adminClient.apiKeys.getList();
      expect(afterDelete.some((k) => k.id === created.apiKey.id)).toBe(false);
    });

    it('manages API keys end-to-end via CLI (nodestack api-keys list/create/rotate/revoke/restore/delete)', async () => {
      const cliDir = path.resolve('./.test_rbac_cli_apikeys_data');
      if (fs.existsSync(cliDir)) {
        fs.rmSync(cliDir, { recursive: true, force: true });
      }

      const captureLogs = async (fn: () => Promise<void>): Promise<string> => {
        const logs: string[] = [];
        const origLog = console.log;
        console.log = (...args: any[]) => logs.push(args.join(' '));
        try {
          await fn();
        } finally {
          console.log = origLog;
        }
        return logs.join('\n').trim();
      };

      try {
        // 1. Create with --scopes including redundant collection write
        const createOut = await captureLogs(async () => {
          await runCli([
            'node',
            'nodestack',
            'api-keys',
            'create',
            'CLI Pipeline Key',
            '--scopes',
            '*:write,orders:write,queues:jobs:send',
            '-d',
            cliDir,
            '--json',
          ]);
        });
        const created = JSON.parse(createOut);
        expect(created.secretKey.startsWith('nsk_')).toBe(true);
        expect(created.apiKey.name).toBe('CLI Pipeline Key');
        expect(created.apiKey.scopes).toEqual(['*:write', 'queues:jobs:send']);

        const keyId = created.apiKey.id;

        // 2. List
        const listOut = await captureLogs(async () => {
          await runCli(['node', 'nodestack', 'api-keys', 'list', '-d', cliDir, '--json']);
        });
        const list = JSON.parse(listOut);
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(keyId);
        expect(list[0].secretKey).toBeUndefined();
        expect(list[0].secretHash).toBeUndefined();

        // 3. Rotate
        const rotateOut = await captureLogs(async () => {
          await runCli(['node', 'nodestack', 'api-keys', 'rotate', keyId, '-d', cliDir, '--json']);
        });
        const rotated = JSON.parse(rotateOut);
        expect(rotated.secretKey.startsWith('nsk_')).toBe(true);
        expect(rotated.secretKey).not.toBe(created.secretKey);

        // 4. Revoke
        const revokeOut = await captureLogs(async () => {
          await runCli(['node', 'nodestack', 'api-keys', 'revoke', keyId, '-d', cliDir, '--json']);
        });
        expect(JSON.parse(revokeOut).status).toBe('revoked');

        // 5. Restore
        const restoreOut = await captureLogs(async () => {
          await runCli(['node', 'nodestack', 'api-keys', 'restore', keyId, '-d', cliDir, '--json']);
        });
        expect(JSON.parse(restoreOut).status).toBe('active');

        // 6. Delete
        const deleteOut = await captureLogs(async () => {
          await runCli(['node', 'nodestack', 'api-keys', 'delete', keyId, '-d', cliDir, '--json']);
        });
        expect(JSON.parse(deleteOut)).toEqual({ id: keyId, deleted: true });

        const listAfterOut = await captureLogs(async () => {
          await runCli(['node', 'nodestack', 'api-keys', 'list', '-d', cliDir, '--json']);
        });
        expect(JSON.parse(listAfterOut)).toEqual([]);
      } finally {
        if (fs.existsSync(cliDir)) {
          fs.rmSync(cliDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe('6. Policy Engine Dry-Run API Key Simulation Endpoint (/api/api-keys/:id/simulate)', () => {
    it('accurately evaluates permissions across Collections, Functions, Flows, and Queues with IP checks', async () => {
      // 1. Create a scoped service key
      const createdKey = app.apiKeys.createKey({
        name: 'Multi-Role Worker',
        role: 'service',
        scopes: [
          'orders:read',
          'functions:queue-proxy-fn',
          'flows:mod-approval-flow',
          'queues:email-jobs:send',
        ],
        allowedIps: ['127.0.0.1', '10.0.0.0/24'],
      });
      const key = createdKey.apiKey;

      // Simulation requires Admin token
      const simulateCall = async (body: any) => {
        const res = await fetch(`${serverUrl}/api/api-keys/${key.id}/simulate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify(body),
        });
        return { status: res.status, body: await res.json() };
      };

      // 2. Collections: orders:list succeeds, orders:create is denied
      const colAllowed = await simulateCall({ subsystem: 'collections', resource: 'orders', action: 'list' });
      expect(colAllowed.status).toBe(200);
      expect(colAllowed.body.allowed).toBe(true);
      expect(colAllowed.body.matchedScope).toBe('orders:read');
      expect(colAllowed.body.curlExample).toContain('GET "/api/collections/orders/records"');

      const colDenied = await simulateCall({ subsystem: 'collections', resource: 'orders', action: 'create' });
      expect(colDenied.status).toBe(200);
      expect(colDenied.body.allowed).toBe(false);
      expect(colDenied.body.status).toBe(403);
      expect(colDenied.body.reason).toContain('Missing required scope');

      // 3. Functions: queue-proxy-fn succeeds, unknown-fn is denied
      const fnAllowed = await simulateCall({ subsystem: 'functions', resource: 'queue-proxy-fn', action: 'invoke' });
      expect(fnAllowed.body.allowed).toBe(true);
      expect(fnAllowed.body.matchedScope).toBe('functions:queue-proxy-fn');

      const fnDenied = await simulateCall({ subsystem: 'functions', resource: 'unknown-fn', action: 'invoke' });
      expect(fnDenied.body.allowed).toBe(false);

      // 4. Flows: mod-approval-flow succeeds, unknown-flow is denied
      const flowAllowed = await simulateCall({ subsystem: 'flows', resource: 'mod-approval-flow', action: 'execute' });
      expect(flowAllowed.body.allowed).toBe(true);
      expect(flowAllowed.body.matchedScope).toBe('flows:mod-approval-flow');

      const flowDenied = await simulateCall({ subsystem: 'flows', resource: 'other-flow', action: 'execute' });
      expect(flowDenied.body.allowed).toBe(false);

      // 5. Queues: send succeeds, read/claim is denied
      const queueSend = await simulateCall({ subsystem: 'queues', resource: 'email-jobs', action: 'send' });
      expect(queueSend.body.allowed).toBe(true);
      expect(queueSend.body.matchedScope).toBe('queues:email-jobs:send');

      const queueRead = await simulateCall({ subsystem: 'queues', resource: 'email-jobs', action: 'read' });
      expect(queueRead.body.allowed).toBe(false);
      expect(queueRead.body.reason).toContain('queues:email-jobs:read');

      // 6. IP Allowlist checks
      const ipAllowed = await simulateCall({
        subsystem: 'queues',
        resource: 'email-jobs',
        action: 'send',
        clientIp: '127.0.0.1',
      });
      expect(ipAllowed.body.allowed).toBe(true);
      expect(ipAllowed.body.ipCheck.enforced).toBe(true);
      expect(ipAllowed.body.ipCheck.allowed).toBe(true);

      const ipDenied = await simulateCall({
        subsystem: 'queues',
        resource: 'email-jobs',
        action: 'send',
        clientIp: '198.51.100.25',
      });
      expect(ipDenied.body.allowed).toBe(false);
      expect(ipDenied.body.reason).toContain('not in allowed IP list');
      expect(ipDenied.body.ipCheck.allowed).toBe(false);

      // 7. Revocation checks
      await app.apiKeys.updateKey(key.id, { status: 'revoked' });
      const revokedCheck = await simulateCall({ subsystem: 'collections', resource: 'orders', action: 'list' });
      expect(revokedCheck.body.allowed).toBe(false);
      expect(revokedCheck.body.reason).toContain('API key is revoked');
    });
  });
});
