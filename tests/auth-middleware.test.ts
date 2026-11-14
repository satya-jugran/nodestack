import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { AuthMiddleware } from '../src/http/middleware/AuthMiddleware';

describe('AuthMiddleware - Token Validation & Immediate 401 Rejection', () => {
  const testDir = path.resolve(__dirname, '../.test_auth_middleware_data');
  let app: NodeStack;
  let serverUrl: string;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    app = new NodeStack({
      dataDir: testDir,
      port: 8149,
    });
    await app.start();
    serverUrl = 'http://127.0.0.1:8149';

    // Create a public collection (listRule: "" allows anonymous read)
    await app.schema.createCollection({
      name: 'articles',
      type: 'base',
      schema: [
        { name: 'title', type: 'text', required: true },
        { name: 'content', type: 'text' },
      ],
      listRule: '',
      viewRule: '',
      createRule: '@request.auth.isAdmin == true',
    });

    // Populate a test record
    await app.records.create(
      'articles',
      {
        title: 'Public Announcement',
        content: 'This is visible to anyone.',
      },
      { isAdmin: true }
    );

    // Create an admin
    await app.auth.createAdmin('admin@nodestack.test', 'AdminPassword123!');
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('1. Unit Tests for AuthMiddleware.handle', () => {
    it('should authenticate valid user token and not send reply', async () => {
      const user = await app.records.create('users', {
        email: 'user1@nodestack.test',
        password: 'UserPass123!',
      });
      const auth = await app.auth.authenticateRecord('users', 'user1@nodestack.test', 'UserPass123!');

      const middleware = new AuthMiddleware(app.auth);
      const req: any = {
        headers: { authorization: `Bearer ${auth.token}` },
      };
      const reply: any = {
        sent: false,
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockImplementation(function () {
          this.sent = true;
          return this;
        }),
      };

      await middleware.handle(req, reply);
      expect(req.auth).toBeDefined();
      expect(req.auth.id).toBe(user.id);
      expect(req.auth.email).toBe('user1@nodestack.test');
      expect(reply.sent).toBe(false);
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should reject tampered token with 401 immediately', async () => {
      const middleware = new AuthMiddleware(app.auth);
      const req: any = {
        headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tampered.signature' },
      };
      let sentStatus: number | undefined;
      let sentBody: any;
      const reply: any = {
        sent: false,
        status: vi.fn().mockImplementation((status: number) => {
          sentStatus = status;
          return reply;
        }),
        send: vi.fn().mockImplementation(function (body: any) {
          this.sent = true;
          sentBody = body;
          return this;
        }),
      };

      await middleware.handle(req, reply);
      expect(req.auth).toBeNull();
      expect(reply.sent).toBe(true);
      expect(sentStatus).toBe(401);
      expect(sentBody).toMatchObject({
        statusCode: 401,
        message: expect.stringMatching(/invalid|expired/i),
      });
    });

    it('should reject expired token with 401 immediately', async () => {
      const adminAuth = await app.auth.authenticateAdmin('admin@nodestack.test', 'AdminPassword123!');
      const claims = app.auth.verifyToken(adminAuth.token);
      // Generate expired token (-10s)
      const expiredToken = app.auth.generateToken(
        {
          id: claims.id,
          email: claims.email,
          collection: claims.collection,
          tokenKey: claims.tokenKey,
          isAdmin: true,
        },
        '-10s'
      );

      const middleware = new AuthMiddleware(app.auth);
      const req: any = {
        headers: { authorization: `Bearer ${expiredToken}` },
      };
      let sentStatus: number | undefined;
      const reply: any = {
        sent: false,
        status: vi.fn().mockImplementation((status: number) => {
          sentStatus = status;
          return reply;
        }),
        send: vi.fn().mockImplementation(function () {
          this.sent = true;
          return this;
        }),
      };

      await middleware.handle(req, reply);
      expect(req.auth).toBeNull();
      expect(reply.sent).toBe(true);
      expect(sentStatus).toBe(401);
    });

    it('should not interfere when no token is present', async () => {
      const middleware = new AuthMiddleware(app.auth);
      const req: any = {
        headers: {},
      };
      const reply: any = {
        sent: false,
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockImplementation(function () {
          this.sent = true;
          return this;
        }),
      };

      await middleware.handle(req, reply);
      expect(req.auth).toBeNull();
      expect(reply.sent).toBe(false);
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should abort requireAdmin and return 401 without sending 403 when token is invalid', async () => {
      const middleware = new AuthMiddleware(app.auth);
      const requireAdmin = middleware.requireAdmin();

      const req: any = {
        headers: { authorization: 'Bearer invalid.tampered.token' },
      };
      let sentStatus: number | undefined;
      const reply: any = {
        sent: false,
        status: vi.fn().mockImplementation((status: number) => {
          sentStatus = status;
          return reply;
        }),
        send: vi.fn().mockImplementation(function () {
          this.sent = true;
          return this;
        }),
      };

      await requireAdmin(req, reply);
      expect(reply.sent).toBe(true);
      expect(sentStatus).toBe(401);
      // Ensure reply.status was called once with 401, not overridden by 403
      expect(reply.status).toHaveBeenCalledTimes(1);
      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });

  describe('2. HTTP End-to-End Tests', () => {
    it('should permit anonymous requests to public collection without token', async () => {
      const res = await fetch(`${serverUrl}/api/collections/articles/records`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should reject tampered admin token with 401 on public collection instead of silently downgrading', async () => {
      const validAuth = await app.auth.authenticateAdmin('admin@nodestack.test', 'AdminPassword123!');
      // Tamper with the token payload / signature
      const parts = validAuth.token.split('.');
      const tamperedToken = `${parts[0]}.${parts[1]}.tampered_signature_xyz`;

      const res = await fetch(`${serverUrl}/api/collections/articles/records`, {
        headers: {
          authorization: `Bearer ${tamperedToken}`,
        },
      });

      // Must be 401 Unauthorized, NOT 200 OK (downgrade to anonymous)
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.statusCode).toBe(401);
    });

    it('should reject expired token with 401 on public collection', async () => {
      const validAuth = await app.auth.authenticateAdmin('admin@nodestack.test', 'AdminPassword123!');
      const claims = app.auth.verifyToken(validAuth.token);
      const expiredToken = app.auth.generateToken(
        {
          id: claims.id,
          email: claims.email,
          collection: claims.collection,
          tokenKey: claims.tokenKey,
          isAdmin: true,
        },
        '-5s'
      );

      const res = await fetch(`${serverUrl}/api/collections/articles/records`, {
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.statusCode).toBe(401);
    });

    it('should reject tampered token with 401 on admin endpoint instead of 403 Forbidden', async () => {
      const res = await fetch(`${serverUrl}/api/collections`, {
        headers: {
          authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
        },
      });

      // Must be 401 Unauthorized (invalid token), NOT 403 Forbidden (missing admin privilege)
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.statusCode).toBe(401);
    });

    it('should reject invalid token passed via query parameter (?token=...) with 401', async () => {
      const res = await fetch(`${serverUrl}/api/collections/articles/records?token=invalid.tampered.token`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.statusCode).toBe(401);
    });

    it('should succeed with valid admin token on admin endpoint', async () => {
      const validAuth = await app.auth.authenticateAdmin('admin@nodestack.test', 'AdminPassword123!');
      const res = await fetch(`${serverUrl}/api/collections`, {
        headers: {
          authorization: `Bearer ${validAuth.token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.items)).toBe(true);
    });
  });
});
