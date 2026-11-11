import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';

describe('Initial Setup Security & Unauthenticated Bypass Prevention Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_initial_setup_sec_data');
  const port = 8249;
  const baseUrl = `http://127.0.0.1:${port}`;
  let app: NodeStack;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }

    app = new NodeStack({
      dataDir: testDir,
      port,
      appName: 'Security Test App',
    });

    await app.start(port);
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
});
