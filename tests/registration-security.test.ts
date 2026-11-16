import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';

describe('Registration Security: Rate Limiting, Email Verification & Atomic Concurrency', () => {
  const testDir = path.resolve(__dirname, '../.test_reg_sec_data');
  let app: NodeStack;
  let baseUrl: string;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }

    app = new NodeStack({
      dataDir: testDir,
      port: 0,
      host: '127.0.0.1',
      appName: 'Reg Security App',
    });

    baseUrl = await app.start(0, '127.0.0.1');

    // Setup initial admin
    await app.auth.createInitialAdmin('master_admin@nodestack.test', 'MasterPassword123!');
  });

  afterAll(async () => {
    if (app) {
      await app.stop();
    }
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('1. Email Verification & Impersonation Prevention', () => {
    it('should disallow public callers from self-asserting verified: true during registration', async () => {
      // Register user record through public POST /api/collections/users/records attempting to spoof verified: true
      const res = await fetch(`${baseUrl}/api/collections/users/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'spoof_test@nodestack.test',
          password: 'UserPassword123!',
          verified: true, // Attempted spoof
        }),
      });

      expect(res.status).toBe(201);
      const user = await res.json();
      expect(user.email).toBe('spoof_test@nodestack.test');
      // Must be forced to false
      expect(user.verified).toBe(false);

      // Verify in DB directly
      const dbRow = (app as any).db.prepare('SELECT verified FROM users WHERE id = ?').get(user.id);
      expect(Boolean(dbRow.verified)).toBe(false);
    });

    it('should generate verification token and confirm verification successfully', async () => {
      // 1. Request verification token
      const reqRes = await app.auth.requestVerification('users', 'spoof_test@nodestack.test');
      expect(reqRes.token).toBeDefined();
      expect(reqRes.email).toBe('spoof_test@nodestack.test');

      // 2. Confirm verification with valid token
      const confirmRes = await app.auth.confirmVerification(reqRes.token);
      expect(confirmRes.verified).toBe(true);
      expect(confirmRes.email).toBe('spoof_test@nodestack.test');

      // 3. Verify in DB directly
      const dbRow = (app as any).db.prepare('SELECT verified FROM users WHERE email = ?').get('spoof_test@nodestack.test');
      expect(Boolean(dbRow.verified)).toBe(true);
    });

    it('should enforce 60-second cooldown per email to prevent spamming verification requests', async () => {
      // Create a fresh user record
      await app.records.create('users', {
        email: 'cooldown_user@nodestack.test',
        password: 'UserPassword123!',
      });

      // 1st request succeeds
      const res1 = await fetch(`${baseUrl}/api/collections/users/request-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'cooldown_user@nodestack.test' }),
      });
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.token).toBeUndefined(); // Non-sensitive acknowledgement: token must NOT leak in HTTP response
      expect(data1.message).toContain('Verification email sent');

      // 2nd immediate request must be rejected with 429 and cooldown message
      const res2 = await fetch(`${baseUrl}/api/collections/users/request-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'cooldown_user@nodestack.test' }),
      });
      expect(res2.status).toBe(429);
      const data2 = await res2.json();
      expect(data2.message).toContain('recently requested');
    });

    it('should reject verification request with HTTP 400 if account is already verified', async () => {
      // Create and verify an account
      await app.records.create('users', {
        email: 'already_verified@nodestack.test',
        password: 'UserPassword123!',
      });
      const { token } = await app.auth.requestVerification('users', 'already_verified@nodestack.test');
      await app.auth.confirmVerification(token);

      // Requesting verification again must return 400 Bad Request
      const res = await fetch(`${baseUrl}/api/collections/users/request-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'already_verified@nodestack.test' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain('already verified');
    });

    it('should reject tampered or expired verification tokens', async () => {
      await expect(app.auth.confirmVerification('invalid.jwt.token')).rejects.toThrow(/invalid/i);
    });

    it('should enforce requireEmailVerification option and block unverified login', async () => {
      // Create a collection with requireEmailVerification: true
      await app.schema.createCollection({
        name: 'members',
        type: 'auth',
        schema: [{ name: 'name', type: 'text' }],
        createRule: '',
        options: {
          requireEmailVerification: true,
        },
      });

      // Register an unverified member
      await app.records.create('members', {
        email: 'unverified_member@nodestack.test',
        password: 'MemberPassword123!',
      });

      // Attempt login prior to verification -> must fail with 403
      await expect(
        app.auth.authenticateRecord('members', 'unverified_member@nodestack.test', 'MemberPassword123!')
      ).rejects.toThrow(/verify your email/i);

      // Verify the member account
      const { token } = await app.auth.requestVerification('members', 'unverified_member@nodestack.test');
      await app.auth.confirmVerification(token);

      // Attempt login again -> now succeeds
      const authResult = await app.auth.authenticateRecord('members', 'unverified_member@nodestack.test', 'MemberPassword123!');
      expect(authResult.token).toBeDefined();
      expect(authResult.record.email).toBe('unverified_member@nodestack.test');
    });

    it('should confirm admin verification and update admin record', async () => {
      const adminRes = await app.auth.createAdmin('verify_admin@nodestack.test', 'AdminPassword123!');
      expect(adminRes.id).toBeDefined();

      const { token } = await app.auth.requestVerification('_admins', 'verify_admin@nodestack.test');
      expect(token).toBeDefined();

      const verifiedAdmin = await app.auth.confirmVerification(token);
      expect(verifiedAdmin.verified).toBe(true);
      expect(verifiedAdmin.email).toBe('verify_admin@nodestack.test');

      // Once verified, requesting verification again should reject with 400
      await expect(
        app.auth.requestVerification('_admins', 'verify_admin@nodestack.test')
      ).rejects.toThrow(/already verified/i);
    });

    it('should return non-sensitive acknowledgement on admin verification request without exposing token', async () => {
      await app.auth.createAdmin('token_leak_admin@nodestack.test', 'AdminPassword123!');
      const res = await fetch(`${baseUrl}/api/admins/request-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'token_leak_admin@nodestack.test' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeUndefined();
      expect(data.message).toContain('Verification email sent');
    });

    it('should reject verification tokens replayed across different applications/tenants', async () => {
      // 1. Create two isolated tenant scopes
      const tenantA = await app.apps.create({ name: 'Tenant A', slug: 'tenant-a' });
      const tenantB = await app.apps.create({ name: 'Tenant B', slug: 'tenant-b' });

      // 2. In tenantA, create a user with a specific record ID and email
      const userA = await tenantA.records.create('users', {
        id: 'shared_record_id_123',
        email: 'user_a@nodestack.test',
        password: 'PasswordTenantA123!',
      });
      expect(userA.id).toBe('shared_record_id_123');
      expect(userA.verified).toBe(false);

      // 3. In tenantB, create a victim user with the EXACT SAME record ID but different email
      const userB = await tenantB.records.create('users', {
        id: 'shared_record_id_123',
        email: 'victim@nodestack.test',
        password: 'PasswordTenantB123!',
      });
      expect(userB.id).toBe('shared_record_id_123');
      expect(userB.verified).toBe(false);

      // 4. Request verification token in tenantA
      const { token: tokenA } = await tenantA.auth.requestVerification('users', 'user_a@nodestack.test');
      expect(tokenA).toBeDefined();

      // 5. Attacker attempts to replay tokenA against tenantB to verify victim account
      await expect(
        tenantB.auth.confirmVerification(tokenA)
      ).rejects.toThrow(/different application/i);

      // Verify that victim user in tenantB was NOT marked verified
      const victimInDb = (tenantB as any).db.prepare('SELECT verified FROM users WHERE id = ?').get('shared_record_id_123');
      expect(Boolean(victimInDb.verified)).toBe(false);

      // 6. Attacker attempts to replay tokenA against root/default app
      await expect(
        app.auth.confirmVerification(tokenA)
      ).rejects.toThrow(/different application/i);

      // 7. Request token in root app and attempt to replay against tenantA
      await app.records.create('users', {
        email: 'default_cross_app@nodestack.test',
        password: 'DefaultUserPass123!',
      });
      const { token: defaultToken } = await app.auth.requestVerification('users', 'default_cross_app@nodestack.test');
      await expect(
        tenantA.auth.confirmVerification(defaultToken)
      ).rejects.toThrow(/different application/i);

      // 8. Confirming tokenA in tenantA (legitimate target) must succeed
      const confirmedA = await tenantA.auth.confirmVerification(tokenA);
      expect(confirmedA.verified).toBe(true);
      expect(confirmedA.email).toBe('user_a@nodestack.test');
    });

    it('should reject verification token if account email changes after token issuance', async () => {
      // 1. Create user with initial email
      const user = await app.records.create('users', {
        email: 'pre_change@nodestack.test',
        password: 'UserPassword123!',
      });
      expect(user.verified).toBe(false);

      // 2. Request verification token for initial email
      const { token } = await app.auth.requestVerification('users', 'pre_change@nodestack.test');
      expect(token).toBeDefined();

      // 3. User or admin updates email address to new address
      const userAuth = { id: user.id, email: user.email, collection: 'users', isAdmin: false, tokenKey: user.tokenKey };
      const updatedUser = await app.records.update('users', user.id, {
        email: 'post_change@nodestack.test',
      }, userAuth);
      expect(updatedUser.email).toBe('post_change@nodestack.test');
      expect(updatedUser.verified).toBe(false);

      // 4. Attempting to use the old verification token to verify the account MUST fail
      await expect(
        app.auth.confirmVerification(token)
      ).rejects.toThrow(/(does not match|invalidated)/i);

      // 5. Verify that the user remains unverified in database
      const dbRow = (app as any).db.prepare('SELECT email, verified FROM users WHERE id = ?').get(user.id);
      expect(dbRow.email).toBe('post_change@nodestack.test');
      expect(Boolean(dbRow.verified)).toBe(false);

      // 6. Requesting new verification for post_change@nodestack.test succeeds and can be confirmed
      const { token: newToken } = await app.auth.requestVerification('users', 'post_change@nodestack.test');
      const confirmed = await app.auth.confirmVerification(newToken);
      expect(confirmed.verified).toBe(true);
      expect(confirmed.email).toBe('post_change@nodestack.test');
    });

    it('should disallow non-admin callers from self-asserting verified: true during update', async () => {
      const user = await app.records.create('users', {
        email: 'update_spoof@nodestack.test',
        password: 'UserPassword123!',
      });
      expect(user.verified).toBe(false);

      // Authenticate as this user to get user JWT session
      const authRes = await app.auth.authenticateRecord('users', 'update_spoof@nodestack.test', 'UserPassword123!');
      const userJwt = authRes.token;

      // Public / non-admin user attempts HTTP PATCH on their own record with verified: true
      const patchRes = await fetch(`${baseUrl}/api/collections/users/records/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userJwt}`,
        },
        body: JSON.stringify({
          verified: true, // Spoofed verified
        }),
      });

      expect(patchRes.status).toBe(200);
      const patched = await patchRes.json();
      expect(patched.verified).toBe(false);

      // Direct programmatic update check as non-admin
      const userAuth = { id: user.id, email: user.email, collection: 'users', isAdmin: false, tokenKey: 'tk' };
      const updated = await app.records.update('users', user.id, {
        verified: true, // Spoofed verified
      }, userAuth);

      expect(updated.verified).toBe(false);
      const dbRow = (app as any).db.prepare('SELECT verified FROM users WHERE id = ?').get(user.id);
      expect(Boolean(dbRow.verified)).toBe(false);
    });
  });

  describe('2. Atomic Concurrency & Race Condition Prevention', () => {
    it('should atomically serialize concurrent account creation and prevent duplicate accounts or 500 errors', async () => {
      // Fire 8 concurrent calls to createAdmin with the EXACT same email
      const targetEmail = 'concurrent_admin@nodestack.test';
      const password = 'ConcurrentPassword123!';

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          app.auth.createAdmin(targetEmail, password)
        )
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly 1 must succeed
      expect(fulfilled.length).toBe(1);
      // All other 7 must be rejected with 409 ConflictError
      expect(rejected.length).toBe(7);

      for (const rej of rejected) {
        const error = (rej as PromiseRejectedResult).reason;
        expect(error.statusCode).toBe(409);
        expect(error.message).toContain('already exists');
      }

      // Verify that database contains exactly ONE admin with this email
      const countRow = (app as any).db.prepare(
        'SELECT COUNT(*) as count FROM _admins WHERE LOWER(email) = ?'
      ).get(targetEmail);
      expect(countRow.count).toBe(1);
    });

    it('should atomically serialize concurrent user record creation in auth collection', async () => {
      const targetEmail = 'concurrent_user@nodestack.test';
      const password = 'UserConcurrent123!';

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          app.records.create('users', {
            email: targetEmail,
            password,
          })
        )
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly 1 must succeed
      expect(fulfilled.length).toBe(1);
      // All other 7 must be rejected with 409 Conflict
      expect(rejected.length).toBe(7);

      for (const rej of rejected) {
        const error = (rej as PromiseRejectedResult).reason;
        expect(error.statusCode).toBe(409);
        expect(error.message).toContain('already registered');
      }

      // Verify DB contains exactly 1 user with this email
      const countRow = (app as any).db.prepare(
        'SELECT COUNT(*) as count FROM users WHERE LOWER(email) = ?'
      ).get(targetEmail);
      expect(countRow.count).toBe(1);
    });
  });

  describe('3. Rate Limiting with @fastify/rate-limit', () => {
    it('should throttle excessive registration attempts with HTTP 429 Too Many Requests', async () => {
      // Login as master admin to obtain auth token
      const loginRes = await app.auth.authenticateAdmin('master_admin@nodestack.test', 'MasterPassword123!');
      const adminToken = loginRes.token;

      let lastStatus: number | undefined;
      let hit429 = false;
      let rateLimitHeaders: Record<string, string> = {};

      // Send 12 rapid registration requests (limit is 10/min)
      for (let i = 1; i <= 12; i++) {
        const res = await fetch(`${baseUrl}/api/admins`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            email: `flood_admin_${i}@nodestack.test`,
            password: 'AdminPassword123!',
          }),
        });

        lastStatus = res.status;
        if (res.status === 429) {
          hit429 = true;
          rateLimitHeaders = {
            limit: res.headers.get('x-ratelimit-limit') || '',
            remaining: res.headers.get('x-ratelimit-remaining') || '',
            retryAfter: res.headers.get('retry-after') || '',
          };
          const data = await res.json();
          expect(data.statusCode).toBe(429);
          expect(data.message).toContain('Too many registration attempts');
          break;
        }
      }

      expect(hit429).toBe(true);
      expect(lastStatus).toBe(429);
      expect(rateLimitHeaders.limit).toBe('10');
      expect(rateLimitHeaders.remaining).toBe('0');
      expect(Number(rateLimitHeaders.retryAfter)).toBeGreaterThan(0);
    });

    it('should rate-limit email verification requests by IP when threshold is exceeded', async () => {
      let hit429 = false;
      let limitHitMessage = '';
      for (let i = 1; i <= 12; i++) {
        const res = await fetch(`${baseUrl}/api/admins/request-verification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: `ip_flood_admin_${i}@nodestack.test` }),
        });

        if (res.status === 429) {
          hit429 = true;
          const data = await res.json();
          limitHitMessage = data.message;
          break;
        }
      }
      expect(hit429).toBe(true);
      expect(limitHitMessage).toContain('Too many verification requests');
    });
  });
});
