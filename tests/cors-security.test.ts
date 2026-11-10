import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';

describe('CORS Security & Credentials Hardening', () => {
  const testDataDir = path.resolve(__dirname, '../.test_cors_data');

  beforeEach(() => {
    if (fs.existsSync(testDataDir)) {
      try {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      } catch {}
    }
  });

  afterEach(() => {
    delete process.env.NODESTACK_CORS_ORIGIN;
    delete process.env.NODEBASE_CORS_ORIGIN;
    delete process.env.NODESTACK_CORS_CREDENTIALS;
    delete process.env.NODEBASE_CORS_CREDENTIALS;
    if (fs.existsSync(testDataDir)) {
      try {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('1. Default Development Behavior', () => {
    it('should allow localhost origins with credentials in development mode', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        dev: true,
      });
      await app.server.app.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should allow 127.0.0.1 and IPv6 [::1] on arbitrary ports in dev', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        dev: true,
      });
      await app.server.app.ready();

      const res1 = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'http://127.0.0.1:5173',
        },
      });
      expect(res1.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
      expect(res1.headers['access-control-allow-credentials']).toBe('true');

      const res2 = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'http://[::1]:8080',
        },
      });
      expect(res2.headers['access-control-allow-origin']).toBe('http://[::1]:8080');
      expect(res2.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should NOT allow untrusted external origins by default in dev and omit credentials', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        dev: true,
      });
      await app.server.app.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://evil-attacker.com',
        },
      });

      // No CORS headers should be returned for untrusted origin
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('should reject preflight OPTIONS from untrusted origin by default in dev', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        dev: true,
      });
      await app.server.app.ready();

      const res = await app.server.inject({
        method: 'OPTIONS',
        url: '/api/health',
        headers: {
          origin: 'https://evil-attacker.com',
          'access-control-request-method': 'POST',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('2. Production Mode Security (dev: false)', () => {
    it('should disallow all cross-origin requests by default when no CORS allowlist is configured', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        dev: false,
      });
      await app.server.app.ready();

      const resLocal = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'http://localhost:3000',
        },
      });
      expect(resLocal.headers['access-control-allow-origin']).toBeUndefined();
      expect(resLocal.headers['access-control-allow-credentials']).toBeUndefined();

      const resEvil = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://malicious.org',
        },
      });
      expect(resEvil.headers['access-control-allow-origin']).toBeUndefined();
      expect(resEvil.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('3. Configurable Allowlist', () => {
    it('should allow only explicitly specified trusted origins and credentials', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        dev: false,
        cors: {
          origin: ['https://trusted.app.com', 'https://admin.app.com'],
          credentials: true,
        },
      });
      await app.server.app.ready();

      // Trusted domain 1
      const res1 = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://trusted.app.com',
        },
      });
      expect(res1.headers['access-control-allow-origin']).toBe('https://trusted.app.com');
      expect(res1.headers['access-control-allow-credentials']).toBe('true');

      // Trusted domain 2
      const res2 = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://admin.app.com',
        },
      });
      expect(res2.headers['access-control-allow-origin']).toBe('https://admin.app.com');
      expect(res2.headers['access-control-allow-credentials']).toBe('true');

      // Untrusted domain
      const res3 = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://evil.com',
        },
      });
      expect(res3.headers['access-control-allow-origin']).toBeUndefined();
      expect(res3.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('should support RegExp allowlist matching', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        dev: false,
        cors: {
          origin: /^https:\/\/([a-z0-9-]+\.)?internal\.company\.com$/,
          credentials: true,
        },
      });
      await app.server.app.ready();

      const resValid = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://portal.internal.company.com',
        },
      });
      expect(resValid.headers['access-control-allow-origin']).toBe('https://portal.internal.company.com');
      expect(resValid.headers['access-control-allow-credentials']).toBe('true');

      const resInvalid = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://external.fakecompany.com',
        },
      });
      expect(resInvalid.headers['access-control-allow-origin']).toBeUndefined();
      expect(resInvalid.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('should support shorthand corsOrigin property in NodeStackOptions', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        corsOrigin: 'https://shorthand.app.com',
      });
      await app.server.app.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://shorthand.app.com',
        },
      });
      expect(res.headers['access-control-allow-origin']).toBe('https://shorthand.app.com');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('4. Environment Variable Configuration', () => {
    it('should parse NODESTACK_CORS_ORIGIN comma-separated allowlist', async () => {
      process.env.NODESTACK_CORS_ORIGIN = 'https://portal.domain.com, https://cms.domain.com';

      const app = new NodeStack({
        dataDir: testDataDir,
        dev: false,
      });
      await app.server.app.ready();

      const res1 = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://portal.domain.com' },
      });
      expect(res1.headers['access-control-allow-origin']).toBe('https://portal.domain.com');
      expect(res1.headers['access-control-allow-credentials']).toBe('true');

      const res2 = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://cms.domain.com' },
      });
      expect(res2.headers['access-control-allow-origin']).toBe('https://cms.domain.com');

      const resEvil = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://untrusted.com' },
      });
      expect(resEvil.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('5. Wildcard Origin with Credentials Protection', () => {
    it('should strictly disallow credentials when wildcard origin is configured', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        cors: {
          origin: '*',
          credentials: true, // Should be overridden/disallowed because origin is wildcard
        },
      });
      await app.server.app.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://any-domain.com',
        },
      });

      expect(res.headers['access-control-allow-origin']).toBe('*');
      // Access-Control-Allow-Credentials MUST NOT be sent with wildcard origin
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('should strictly disallow credentials when NODESTACK_CORS_ORIGIN=*', async () => {
      process.env.NODESTACK_CORS_ORIGIN = '*';
      process.env.NODESTACK_CORS_CREDENTIALS = 'true';

      const app = new NodeStack({
        dataDir: testDataDir,
      });
      await app.server.app.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://any-third-party.org',
        },
      });

      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('should normalize origin: [\'*\'] array to wildcard and force credentials off', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        cors: {
          origin: ['*'],
          credentials: true,
        },
      });
      await app.server.app.ready();

      // Check ConfigService normalized state
      expect(app.config.cors).toBeDefined();
      if (typeof app.config.cors === 'object') {
        expect(app.config.cors.origin).toBe('*');
        expect(app.config.cors.credentials).toBe(false);
      }

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://untrusted-site.com',
        },
      });

      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('should normalize origin array containing wildcard [\'https://trusted.com\', \'*\'] and force credentials off', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        cors: {
          origin: ['https://trusted.com', '*'],
          credentials: true,
        },
      });
      await app.server.app.ready();

      // Should normalize to scalar wildcard and disable credentials
      if (typeof app.config.cors === 'object') {
        expect(app.config.cors.origin).toBe('*');
        expect(app.config.cors.credentials).toBe(false);
      }

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://random-site.com',
        },
      });

      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('should normalize comma-separated NODESTACK_CORS_ORIGIN containing \'*\' and force credentials off', async () => {
      process.env.NODESTACK_CORS_ORIGIN = 'https://app.com, *, https://other.com';
      process.env.NODESTACK_CORS_CREDENTIALS = 'true';

      const app = new NodeStack({
        dataDir: testDataDir,
      });
      await app.server.app.ready();

      if (typeof app.config.cors === 'object') {
        expect(app.config.cors.origin).toBe('*');
        expect(app.config.cors.credentials).toBe(false);
      }

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://any-domain.org',
        },
      });

      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('6. Dynamic Reflection with Untrusted Credential Protection', () => {
    it('should disallow credentials for untrusted origins even if origin: true and credentials: true are passed', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        dev: true,
        cors: {
          origin: true, // Dynamic reflection requested
          credentials: true,
        },
      });
      await app.server.app.ready();

      // Trusted origin (localhost in dev) gets credentials: true
      const resLocal = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'http://localhost:3000',
        },
      });
      expect(resLocal.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(resLocal.headers['access-control-allow-credentials']).toBe('true');

      // Untrusted external origin gets reflected origin BUT credentials MUST be omitted/disallowed
      const resEvil = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://evil.attacker.com',
        },
      });
      expect(resEvil.headers['access-control-allow-origin']).toBe('https://evil.attacker.com');
      expect(resEvil.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('should support allowDevReflection flag in development while strictly omitting credentials', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        dev: true,
        cors: {
          allowDevReflection: true,
        },
      });
      await app.server.app.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://external-dev-tool.io',
        },
      });

      expect(res.headers['access-control-allow-origin']).toBe('https://external-dev-tool.io');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('7. Disabling CORS (cors: false)', () => {
    it('should omit all CORS headers when cors is explicitly set to false', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        cors: false,
      });
      await app.server.app.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('8. Custom Origin Validator Function', () => {
    it('should support custom function for dynamic origin validation', async () => {
      const app = new NodeStack({
        dataDir: testDataDir,
        cors: {
          origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
            cb(null, origin?.endsWith('.acme.corp'));
          },
          credentials: true,
        },
      });
      await app.server.app.ready();

      const resAllowed = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://dashboard.acme.corp' },
      });
      expect(resAllowed.headers['access-control-allow-origin']).toBe('https://dashboard.acme.corp');
      expect(resAllowed.headers['access-control-allow-credentials']).toBe('true');

      const resDenied = await app.server.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://acme.corp.attacker.com' },
      });
      expect(resDenied.headers['access-control-allow-origin']).toBeUndefined();
      expect(resDenied.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });
});
