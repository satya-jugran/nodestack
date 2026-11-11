import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';

describe('Initial Setup Security & Unauthenticated Bypass Prevention Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_initial_setup_sec_data');
  let baseUrl: string;
  let app: NodeStack;

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
      appName: 'Security Test App',
    });

    baseUrl = await app.start(0, '127.0.0.1');
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

  describe('1. Unauthenticated Mutation Protection Prior to Admin Registration (!hasAdmins)', () => {
    it('should verify instance has no admins initially', async () => {
      const res = await fetch(`${baseUrl}/api/admins/has-admins`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.hasAdmins).toBe(false);
    });

    it('should REJECT unauthenticated POST /api/snapshots/:id/restore with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/snapshots/fake-id/restore`, {
        method: 'POST',
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain('super-admin');
    });

    it('should REJECT unauthenticated POST /api/snapshots with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'evil-snapshot' }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain('admins are authorized');
    });

    it('should REJECT unauthenticated GET /api/snapshots with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/snapshots`);
      expect(res.status).toBe(403);
    });

    it('should REJECT unauthenticated POST /api/queues with 403 Forbidden (requires super-admin)', async () => {
      const res = await fetch(`${baseUrl}/api/queues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'evil-queue' }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain('super-admin');
    });

    it('should REJECT unauthenticated POST /api/queues/:name/messages with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/queues/default/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { poison: true } }),
      });
      expect(res.status).toBe(403);
    });

    it('should REJECT unauthenticated GET /api/queues with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/queues`);
      expect(res.status).toBe(403);
    });
  });

  describe('2. Initial Admin Creation & Setup Routes Allowlist', () => {
    it('should ALLOW initial setup routes like POST /api/templates/apply without auth when !hasAdmins', async () => {
      // POST /api/templates/apply without token should be allowed past auth middleware during initial setup
      const res = await fetch(`${baseUrl}/api/templates/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: 'ecommerce' }),
      });
      // Should not be 403 Forbidden (templates apply produces 201)
      expect(res.status).toBe(201);
    });

    it('should ALLOW initial admin creation via POST /api/admins when !hasAdmins', async () => {
      const res = await fetch(`${baseUrl}/api/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@nodestack.io',
          password: 'SuperSecurePassword123!',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.token).toBeDefined();
      expect(data.admin).toBeDefined();
      expect(data.admin.email).toBe('admin@nodestack.io');
    });

    it('should verify instance now reports hasAdmins as true', async () => {
      const res = await fetch(`${baseUrl}/api/admins/has-admins`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.hasAdmins).toBe(true);
    });
  });

  describe('3. Post-Setup Authorization Enforcement', () => {
    it('should REJECT subsequent unauthenticated POST /api/admins with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'attacker@evil.com',
          password: 'AttackerPassword123!',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('should REJECT subsequent unauthenticated POST /api/admins/create-initial with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/admins/create-initial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'attacker@evil.com',
          password: 'AttackerPassword123!',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('should REJECT unauthenticated POST /api/templates/apply now that admins exist', async () => {
      const res = await fetch(`${baseUrl}/api/templates/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: 'blog' }),
      });
      expect(res.status).toBe(403);
    });

    it('should ALLOW authenticated super-admin to create queues and snapshots', async () => {
      const loginRes = await fetch(`${baseUrl}/api/admins/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: 'admin@nodestack.io',
          password: 'SuperSecurePassword123!',
        }),
      });
      expect(loginRes.status).toBe(200);
      const loginData = await loginRes.json();
      const token = loginData.token;

      // Create queue with super-admin
      const qRes = await fetch(`${baseUrl}/api/queues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: 'valid-queue', concurrency: 3 }),
      });
      expect(qRes.status).toBe(201);

      // Create snapshot with super-admin
      const snapRes = await fetch(`${baseUrl}/api/snapshots`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: 'valid-snapshot' }),
      });
      expect(snapRes.status).toBe(201);
      const snapData = await snapRes.json();

      // Restore snapshot with super-admin
      const restoreRes = await fetch(`${baseUrl}/api/snapshots/${snapData.id}/restore`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(restoreRes.status).toBe(200);
    });
  });

  describe('4. Atomic Serialized First-Run Admin Race Condition Prevention', () => {
    const raceTestDir = path.resolve(__dirname, '../.test_initial_setup_race_data');
    let raceBaseUrl: string;
    let raceApp: NodeStack;

    beforeAll(async () => {
      if (fs.existsSync(raceTestDir)) {
        try {
          fs.rmSync(raceTestDir, { recursive: true, force: true });
        } catch {}
      }

      raceApp = new NodeStack({
        dataDir: raceTestDir,
        port: 0,
        host: '127.0.0.1',
        appName: 'Race Security App',
      });

      raceBaseUrl = await raceApp.start(0, '127.0.0.1');
    });

    afterAll(async () => {
      if (raceApp) {
        await raceApp.stop();
      }
      if (fs.existsSync(raceTestDir)) {
        try {
          fs.rmSync(raceTestDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('should serialize concurrent initial admin requests and allow exactly ONE creation', async () => {
      // Fire 6 concurrent unauthenticated requests with different email addresses
      const emails = [
        'legitimate_admin@nodestack.io',
        'racing_attacker_1@evil.com',
        'racing_attacker_2@evil.com',
        'racing_attacker_3@evil.com',
        'racing_attacker_4@evil.com',
        'racing_attacker_5@evil.com',
      ];

      const responses = await Promise.all(
        emails.map((email, idx) => {
          // Mix POST /api/admins and POST /api/admins/create-initial
          const endpoint = idx % 2 === 0 ? '/api/admins' : '/api/admins/create-initial';
          return fetch(`${raceBaseUrl}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              password: `Password12345_${idx}!`,
            }),
          });
        })
      );

      const statuses = responses.map((r) => r.status);
      const successes = statuses.filter((s) => s === 201);
      const failures = statuses.filter((s) => s === 400 || s === 403);

      // Exactly ONE must succeed with 201
      expect(successes.length).toBe(1);
      // All other 5 must fail with 400 or 403
      expect(failures.length).toBe(5);

      // Verify that in the database, exactly 1 admin exists
      const dbAdmins = (raceApp as any).db.prepare('SELECT id, email FROM _admins').all();
      expect(dbAdmins.length).toBe(1);
    });
  });

  describe('5. Tenant-Scoped Initial Admin Creation via x-nodestack-app Isolation', () => {
    it('should create an admin in tenant scope without polluting global store', async () => {
      // 1. Create a sub-app via super-admin
      const loginRes = await fetch(`${baseUrl}/api/admins/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: 'admin@nodestack.io',
          password: 'SuperSecurePassword123!',
        }),
      });
      const loginData = await loginRes.json();
      const superToken = loginData.token;

      const createAppRes = await fetch(`${baseUrl}/api/apps`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${superToken}`,
        },
        body: JSON.stringify({
          name: 'Tenant Alpha App',
          slug: 'tenant-alpha',
        }),
      });
      expect(createAppRes.status).toBe(201);

      // 2. Query has-admins with x-nodestack-app header
      const tenantHasAdminsBefore = await fetch(`${baseUrl}/api/admins/has-admins`, {
        headers: {
          'x-nodestack-app': 'tenant-alpha',
        },
      });
      expect(tenantHasAdminsBefore.status).toBe(200);
      const beforeData = await tenantHasAdminsBefore.json();
      expect(beforeData.hasAdmins).toBe(false);

      // 3. Create initial admin for tenant-alpha via POST /api/admins with x-nodestack-app
      const createTenantAdminRes = await fetch(`${baseUrl}/api/admins`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-nodestack-app': 'tenant-alpha',
        },
        body: JSON.stringify({
          email: 'tenant_admin@alpha.com',
          password: 'TenantAlphaPassword123!',
        }),
      });
      expect(createTenantAdminRes.status).toBe(201);
      const tenantAdminData = await createTenantAdminRes.json();
      expect(tenantAdminData.token).toBeDefined();

      // 4. Decode claims: must be tenant-scoped
      const tenantScope = (app as any).apps.get('tenant-alpha');
      const verified = await tenantScope.auth.verifyToken(tenantAdminData.token);
      expect(verified.isTenantScoped).toBe(true);
      expect(verified.isSuperAdmin).toBe(false);

      // 5. Query has-admins for tenant-alpha: now true
      const tenantHasAdminsAfter = await fetch(`${baseUrl}/api/admins/has-admins`, {
        headers: {
          'x-nodestack-app': 'tenant-alpha',
        },
      });
      const afterData = await tenantHasAdminsAfter.json();
      expect(afterData.hasAdmins).toBe(true);

      // 6. Global admins list must NOT contain tenant_admin@alpha.com
      const globalAdmins = (app as any).db.prepare('SELECT email FROM _admins WHERE email = ?').all('tenant_admin@alpha.com');
      expect(globalAdmins.length).toBe(0);

      // 7. Tenant DB must contain tenant_admin@alpha.com
      const tenantAdmins = tenantScope.db.prepare('SELECT email FROM _admins WHERE email = ?').all('tenant_admin@alpha.com');
      expect(tenantAdmins.length).toBe(1);
    });
  });
});
