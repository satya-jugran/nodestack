import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { RecordSanitizer } from '../src/records/RecordSanitizer';
import { CollectionModel } from '../src/schema/models/Collection';

describe('Realtime SSE Record Sanitization & Email Privacy (BOLA Prevention)', () => {
  describe('Unit: RecordSanitizer & RealtimeService.sanitizeRecord', () => {
    const authCol: CollectionModel = {
      id: 'col_users',
      name: 'users',
      type: 'auth',
      system: true,
      schema: [
        { name: 'name', type: 'text', required: false },
        { name: 'active', type: 'bool', required: false },
        { name: 'settings', type: 'json', required: false },
      ],
      indexes: [],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      options: {},
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    const baseCol: CollectionModel = {
      id: 'col_posts',
      name: 'posts',
      type: 'base',
      system: false,
      schema: [
        { name: 'title', type: 'text', required: true },
        { name: 'email', type: 'email', required: false },
      ],
      indexes: [],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      options: {},
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    const rawUserRecord = {
      id: 'usr_victim_123',
      email: 'victim@example.com',
      emailVisibility: false,
      verified: 1,
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz123456',
      tokenKey: 'tok_secret_key_123',
      password: 'PlainPasswordShouldNeverLeak',
      name: 'Victim User',
      active: 1,
      settings: '{"theme":"dark"}',
    };

    it('should strip passwordHash, tokenKey, and password unconditionally for auth collections', () => {
      const sanitized = RecordSanitizer.sanitize(rawUserRecord, authCol, { isAdmin: true });
      expect(sanitized.passwordHash).toBeUndefined();
      expect(sanitized.tokenKey).toBeUndefined();
      expect(sanitized.password).toBeUndefined();
      expect(sanitized.verified).toBe(true);
      expect(sanitized.active).toBe(true);
      expect(sanitized.settings).toEqual({ theme: 'dark' });
    });

    it('should mask email for anonymous/unauthenticated subscribers when emailVisibility is false', () => {
      const sanitized = RecordSanitizer.sanitize(rawUserRecord, authCol, undefined);
      expect(sanitized.email).toBeUndefined();
      expect(sanitized.id).toBe('usr_victim_123');
      expect(sanitized.name).toBe('Victim User');
    });

    it('should mask email for third-party user subscribers when emailVisibility is false', () => {
      const thirdPartyAuth = { id: 'usr_attacker_456', isAdmin: false };
      const sanitized = RecordSanitizer.sanitize(rawUserRecord, authCol, thirdPartyAuth);
      expect(sanitized.email).toBeUndefined();
      expect(sanitized.id).toBe('usr_victim_123');
    });

    it('should retain email for the record owner when emailVisibility is false', () => {
      const ownerAuth = { id: 'usr_victim_123', isAdmin: false };
      const sanitized = RecordSanitizer.sanitize(rawUserRecord, authCol, ownerAuth);
      expect(sanitized.email).toBe('victim@example.com');
    });

    it('should retain email for admin subscribers when emailVisibility is false', () => {
      const adminAuth = { id: 'adm_admin_999', isAdmin: true };
      const sanitized = RecordSanitizer.sanitize(rawUserRecord, authCol, adminAuth);
      expect(sanitized.email).toBe('victim@example.com');
    });

    it('should retain email for all subscribers when emailVisibility is true', () => {
      const publicUserRecord = {
        ...rawUserRecord,
        emailVisibility: true,
      };
      const anonymousSanitized = RecordSanitizer.sanitize(publicUserRecord, authCol, undefined);
      expect(anonymousSanitized.email).toBe('victim@example.com');

      const thirdPartySanitized = RecordSanitizer.sanitize(publicUserRecord, authCol, { id: 'usr_thirdparty', isAdmin: false });
      expect(thirdPartySanitized.email).toBe('victim@example.com');
    });

    it('should not mask email in base collections', () => {
      const postRecord = {
        id: 'post_123',
        title: 'Hello World',
        email: 'contact@example.com',
      };
      const sanitized = RecordSanitizer.sanitize(postRecord, baseCol, undefined);
      expect(sanitized.email).toBe('contact@example.com');
      expect(sanitized.title).toBe('Hello World');
    });
  });

  describe('Integration: Realtime SSE Broadcast to Subscribers', () => {
    const testDir = path.resolve(__dirname, '../.test_realtime_email_privacy');
    const port = 8189;
    let app: NodeStack;
    let adminToken: string;

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
      await app.auth.createAdmin('admin@realtime-privacy.test', 'AdminPassword123!');
      const adminAuth = await app.auth.authenticateAdmin('admin@realtime-privacy.test', 'AdminPassword123!');
      adminToken = adminAuth.token;

      // Update users collection viewRule to "" (publicly viewable user directory)
      await app.schema.updateCollection('users', {
        viewRule: '',
      });
    });

    afterAll(async () => {
      await app.stop();
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    function connectSSE(token?: string): Promise<{
      clientId: string;
      clientSecret: string;
      events: any[];
      close: () => void;
    }> {
      return new Promise((resolve, reject) => {
        const events: any[] = [];
        let clientId = '';
        let clientSecret = '';
        const url = token
          ? `http://127.0.0.1:${port}/api/realtime?token=${token}`
          : `http://127.0.0.1:${port}/api/realtime`;

        const req = http.get(url, (res) => {
          let buffer = '';
          res.on('data', (chunk) => {
            buffer += chunk.toString();
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() || '';
            for (const block of blocks) {
              if (block.includes('NS_CONNECT')) {
                const dataMatch = block.match(/data: (\{.*\})/);
                if (dataMatch && !clientId) {
                  const parsed = JSON.parse(dataMatch[1]);
                  clientId = parsed.clientId;
                  clientSecret = parsed.clientSecret || '';
                  resolve({
                    clientId,
                    clientSecret,
                    events,
                    close: () => {
                      try {
                        req.destroy();
                        res.destroy();
                      } catch {}
                    },
                  });
                }
              } else if (block.includes('event: users')) {
                const dataMatch = block.match(/data: (\{.*\})/);
                if (dataMatch) {
                  try {
                    events.push(JSON.parse(dataMatch[1]));
                  } catch {}
                }
              }
            }
          });
        });
        req.on('error', reject);
      });
    }

    it('should not leak email of newly registered user with emailVisibility=false to third-party SSE subscriber', async () => {
      // 1. Connect third-party guest subscriber (no auth)
      const guestSSE = await connectSSE();
      // 2. Connect admin subscriber
      const adminSSE = await connectSSE(adminToken);

      try {
        // Subscribe both to 'users'
        const guestSubRes = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: guestSSE.clientId,
            clientSecret: guestSSE.clientSecret,
            subscriptions: ['users'],
          }),
        });
        expect(guestSubRes.status).toBe(204);

        const adminSubRes = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            clientId: adminSSE.clientId,
            clientSecret: adminSSE.clientSecret,
            subscriptions: ['users'],
          }),
        });
        expect(adminSubRes.status).toBe(204);

        // 3. Register a new user with emailVisibility: false
        const registerRes = await fetch(`http://127.0.0.1:${port}/api/collections/users/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'private_user@nodestack.test',
            password: 'UserSecretPassword123!',
            passwordConfirm: 'UserSecretPassword123!',
            emailVisibility: false,
            name: 'Private User',
          }),
        });
        expect(registerRes.status).toBe(201);
        const registeredUser = await registerRes.json();
        expect(registeredUser.email).toBe('private_user@nodestack.test');

        // Wait for SSE propagation
        await new Promise((r) => setTimeout(r, 150));

        // Guest subscriber MUST receive the create event, but WITHOUT the email field
        const guestEvent = guestSSE.events.find((e) => e.record?.id === registeredUser.id);
        expect(guestEvent).toBeDefined();
        expect(guestEvent.action).toBe('create');
        expect(guestEvent.record.email).toBeUndefined();
        expect(guestEvent.record.name).toBe('Private User');
        expect(guestEvent.record.emailVisibility).toBe(false);

        // Admin subscriber MUST receive the create event WITH the email field
        const adminEvent = adminSSE.events.find((e) => e.record?.id === registeredUser.id);
        expect(adminEvent).toBeDefined();
        expect(adminEvent.action).toBe('create');
        expect(adminEvent.record.email).toBe('private_user@nodestack.test');
      } finally {
        guestSSE.close();
        adminSSE.close();
      }
    });

    it('should include email when emailVisibility=true for third-party SSE subscribers', async () => {
      const guestSSE = await connectSSE();
      try {
        const subRes = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: guestSSE.clientId,
            clientSecret: guestSSE.clientSecret,
            subscriptions: ['users'],
          }),
        });
        expect(subRes.status).toBe(204);

        const registerRes = await fetch(`http://127.0.0.1:${port}/api/collections/users/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'public_user@nodestack.test',
            password: 'UserSecretPassword123!',
            passwordConfirm: 'UserSecretPassword123!',
            emailVisibility: true,
            name: 'Public User',
          }),
        });
        expect(registerRes.status).toBe(201);
        const registeredUser = await registerRes.json();

        await new Promise((r) => setTimeout(r, 150));

        const guestEvent = guestSSE.events.find((e) => e.record?.id === registeredUser.id);
        expect(guestEvent).toBeDefined();
        expect(guestEvent.record.email).toBe('public_user@nodestack.test');
      } finally {
        guestSSE.close();
      }
    });

    it('should re-sanitize and mask email on update and delete events for private users', async () => {
      // Create private user
      const userRes = await fetch(`http://127.0.0.1:${port}/api/collections/users/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'update_delete_victim@nodestack.test',
          password: 'SecretPassword123!',
          passwordConfirm: 'SecretPassword123!',
          emailVisibility: false,
          name: 'Before Update',
        }),
      });
      const user = await userRes.json();

      const guestSSE = await connectSSE();
      const adminSSE = await connectSSE(adminToken);

      try {
        const subRes = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: guestSSE.clientId,
            clientSecret: guestSSE.clientSecret,
            subscriptions: ['users'],
          }),
        });
        expect(subRes.status).toBe(204);
        const adminSubRes = await fetch(`http://127.0.0.1:${port}/api/realtime`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            clientId: adminSSE.clientId,
            clientSecret: adminSSE.clientSecret,
            subscriptions: ['users'],
          }),
        });
        expect(adminSubRes.status).toBe(204);

        // 1. Update user
        const updateRes = await fetch(`http://127.0.0.1:${port}/api/collections/users/records/${user.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            name: 'After Update',
          }),
        });
        expect(updateRes.status).toBe(200);

        await new Promise((r) => setTimeout(r, 150));

        const guestUpdateEvent = guestSSE.events.find((e) => e.action === 'update' && e.record?.id === user.id);
        expect(guestUpdateEvent).toBeDefined();
        expect(guestUpdateEvent.record.name).toBe('After Update');
        expect(guestUpdateEvent.record.email).toBeUndefined();

        const adminUpdateEvent = adminSSE.events.find((e) => e.action === 'update' && e.record?.id === user.id);
        expect(adminUpdateEvent).toBeDefined();
        expect(adminUpdateEvent.record.email).toBe('update_delete_victim@nodestack.test');

        // 2. Delete user
        const deleteRes = await fetch(`http://127.0.0.1:${port}/api/collections/users/records/${user.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
          },
        });
        expect(deleteRes.status).toBe(204);

        await new Promise((r) => setTimeout(r, 150));

        const guestDeleteEvent = guestSSE.events.find((e) => e.action === 'delete' && e.record?.id === user.id);
        expect(guestDeleteEvent).toBeDefined();
        expect(guestDeleteEvent.record.email).toBeUndefined();

        const adminDeleteEvent = adminSSE.events.find((e) => e.action === 'delete' && e.record?.id === user.id);
        expect(adminDeleteEvent).toBeDefined();
        expect(adminDeleteEvent.record.email).toBe('update_delete_victim@nodestack.test');
      } finally {
        guestSSE.close();
        adminSSE.close();
      }
    });
  });
});
