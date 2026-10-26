import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { NodeStack } from '../src/NodeStack';
import { NodeStackClient } from '../packages/client/src/Client';
import { PkceUtil } from '../packages/client/src/auth/PkceUtil';
import { IOAuthProvider, OAuthExchangeResult, OAuthProfile } from '../src/auth/oauth/types';
import { AppleProvider } from '../src/auth/oauth/AppleProvider';

class MockOAuthProvider implements IOAuthProvider {
  public name: string;
  public displayName: string;
  public mockProfile: OAuthProfile;

  constructor(name: string, displayName: string, mockProfile: OAuthProfile) {
    this.name = name;
    this.displayName = displayName;
    this.mockProfile = mockProfile;
  }

  public buildAuthUrl(state: string, codeChallenge: string, redirectUri?: string): string {
    return `https://${this.name}.mock.auth/oauth/authorize?state=${state}&code_challenge=${codeChallenge}&redirect_uri=${redirectUri || ''}`;
  }

  public async exchangeCode(code: string, codeVerifier: string, redirectUri?: string): Promise<OAuthExchangeResult> {
    if (code === 'invalid_code') {
      throw new Error('Invalid OAuth authorization code');
    }
    return {
      accessToken: `mock_access_token_${code}`,
      profile: this.mockProfile,
    };
  }
}

describe('OAuth2 / Social Logins (PKCE)', () => {
  const testDataDir = path.resolve('./.test_oauth2_data');
  let app: NodeStack;
  let serverUrl: string;

  beforeEach(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDataDir,
      port: 8146,
      jwtSecret: 'test_oauth2_secret_12345678901234567890',
    });

    serverUrl = await app.start();
  });

  afterEach(async () => {
    await app.stop();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('1. PKCE Utilities (PkceUtil)', () => {
    it('should generate valid code_verifier and code_challenge (S256 base64url)', async () => {
      const verifier = PkceUtil.generateVerifier(64);
      expect(verifier.length).toBe(64);
      expect(/^[A-Za-z0-9\-._~]+$/.test(verifier)).toBe(true);

      const challenge = await PkceUtil.generateChallenge(verifier);
      expect(challenge).toBeDefined();
      expect(typeof challenge).toBe('string');
      // S256 challenge length in base64url without padding is 43 chars
      expect(challenge.length).toBe(43);
      expect(/^[A-Za-z0-9\-_]+$/.test(challenge)).toBe(true);
    });

    it('should fail closed when no cryptographically secure RNG is available', () => {
      const originalCrypto = globalThis.crypto;
      try {
        Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
        const originalReq = (globalThis as any).require;
        (globalThis as any).require = undefined;

        expect(() => PkceUtil.generateVerifier()).toThrow(
          /A cryptographically secure random number generator.*is required/
        );
      } finally {
        Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
      }
    });
  });

  describe('2. Auth Methods Discovery', () => {
    it('should list configured OAuth providers with precomputed challenge and state', async () => {
      // Register mock Google and GitHub providers
      const googleMock = new MockOAuthProvider('google', 'Google', {
        id: 'g_123',
        email: 'alice@google.com',
        name: 'Alice Cooper',
        isEmailVerified: true,
        rawUser: { id: 'g_123' },
      });
      app.auth.getOAuthRegistry().register(googleMock);

      const res = await fetch(`${serverUrl}/api/collections/users/auth-methods?redirectUri=http://localhost:3000/callback`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.authProviders)).toBe(true);
      expect(data.authProviders.length).toBe(1);

      const providerInfo = data.authProviders[0];
      expect(providerInfo.name).toBe('google');
      expect(providerInfo.displayName).toBe('Google');
      expect(providerInfo.state).toBeDefined();
      expect(providerInfo.codeVerifier).toBeDefined();
      expect(providerInfo.codeChallenge).toBeDefined();
      expect(providerInfo.authUrl).toContain('google.mock.auth');
    });
  });

  describe('3. User Provisioning & Token Exchange', () => {
    it('should provision a new user on first-time OAuth2 login and issue session JWT', async () => {
      const githubMock = new MockOAuthProvider('github', 'GitHub', {
        id: 'gh_999',
        email: 'dev@github.com',
        name: 'Dev Coder',
        isEmailVerified: true,
        rawUser: { id: 'gh_999', login: 'devcoder' },
      });
      app.auth.getOAuthRegistry().register(githubMock);

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          code: 'valid_auth_code',
          codeVerifier: 'verifier_string_123',
          redirectUrl: 'http://localhost:3000/callback',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
      expect(data.record).toBeDefined();
      expect(data.record.email).toBe('dev@github.com');
      expect(data.record.name).toBe('Dev Coder');
      expect(data.record.verified).toBe(1);
      expect(data.record.passwordHash).toBeUndefined(); // Never leaked
      expect(data.meta.isNew).toBe(true);
      expect(data.meta.provider).toBe('github');

      // Subsequent login with same external identity should return existing user (isNew: false)
      const res2 = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          code: 'valid_auth_code_2',
          codeVerifier: 'verifier_string_123',
          redirectUrl: 'http://localhost:3000/callback',
        }),
      });

      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.meta.isNew).toBe(false);
      expect(data2.record.id).toBe(data.record.id);
    });

    it('should automatically link external identity to existing account if provider email is verified', async () => {
      // Create user first via password
      const db = app.db;
      const now = new Date().toISOString();
      const existingId = 'r_bob123';
      db.prepare(`
        INSERT INTO users (id, email, passwordHash, tokenKey, name, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(existingId, 'bob@example.com', 'dummy_hash', 'dummy_token_key', 'Bob Existing', now, now);

      // Social login with matching verified email
      const discordMock = new MockOAuthProvider('discord', 'Discord', {
        id: 'disc_456',
        email: 'bob@example.com',
        name: 'Bob Discord',
        isEmailVerified: true,
        rawUser: { id: 'disc_456' },
      });
      app.auth.getOAuthRegistry().register(discordMock);

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'discord',
          code: 'code_discord',
          codeVerifier: 'verifier_discord',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.record.id).toBe(existingId);
      expect(data.record.email).toBe('bob@example.com');
      expect(data.meta.isNew).toBe(false);

      // Verify link exists in _external_auths table
      const link = db.get<any>(
        'SELECT * FROM _external_auths WHERE collection = ? AND provider = ? AND providerUserId = ?',
        ['users', 'discord', 'disc_456']
      );
      expect(link).toBeDefined();
      expect(link.recordId).toBe(existingId);
    });

    it('should reject linking if provider email is unverified to prevent account takeover', async () => {
      const db = app.db;
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO users (id, email, passwordHash, tokenKey, name, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('r_victim', 'victim@secure.com', 'dummy_hash', 'dummy_token_key', 'Victim User', now, now);

      // Attacker social account with unverified matching email
      const attackerMock = new MockOAuthProvider('discord', 'Discord', {
        id: 'disc_attacker',
        email: 'victim@secure.com',
        name: 'Attacker Fake',
        isEmailVerified: false, // NOT VERIFIED!
        rawUser: { id: 'disc_attacker' },
      });
      app.auth.getOAuthRegistry().register(attackerMock);

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'discord',
          code: 'code_attacker',
          codeVerifier: 'verifier_attacker',
        }),
      });

      expect(res.status).toBe(400);
      const err = await res.json();
      expect(err.message).toContain('is not verified');
    });

    it('should enforce collection createRule on OAuth2 provisioning (rejecting conditional rules such as @request.auth.id != "")', async () => {
      // Configure createRule requiring an existing authenticated user
      const usersCol = app.schema.getCollectionOrThrow('users');
      usersCol.createRule = '@request.auth.id != ""';
      app.schema.updateCollection('users', usersCol);

      const mockMs = new MockOAuthProvider('microsoft', 'Microsoft', {
        id: 'ms_restricted',
        email: 'ms@restricted.com',
        isEmailVerified: true,
        rawUser: { id: 'ms_restricted' },
      });
      app.auth.getOAuthRegistry().register(mockMs);

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'microsoft',
          code: 'ms_code',
          codeVerifier: 'ms_verifier',
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain('You are not allowed to create records');

      // Reset createRule
      usersCol.createRule = '';
      app.schema.updateCollection('users', usersCol);
    });

    it('should enforce collection schema validation semantics on OAuth2 provisioning (rejecting missing required fields)', async () => {
      // Add a required field to users collection
      const usersCol = app.schema.getCollectionOrThrow('users');
      usersCol.schema.push({
        name: 'company',
        type: 'text',
        required: true,
      });
      app.schema.updateCollection('users', usersCol);

      const mockMs = new MockOAuthProvider('microsoft', 'Microsoft', {
        id: 'ms_validation_test',
        email: 'msval@company.com',
        isEmailVerified: true,
        rawUser: { id: 'ms_validation_test' },
      });
      app.auth.getOAuthRegistry().register(mockMs);

      // Attempt provisioning without the required 'company' field in createData
      const resFail = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'microsoft',
          code: 'ms_code_fail',
          codeVerifier: 'ms_verifier_fail',
        }),
      });

      expect(resFail.status).toBe(422);
      const err = await resFail.json();
      expect(err.message).toContain("Field 'company' is required");

      // Now provision WITH the required 'company' field in createData
      const resSuccess = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'microsoft',
          code: 'ms_code_success',
          codeVerifier: 'ms_verifier_success',
          createData: {
            company: 'Acme Corp',
          },
        }),
      });

      expect(resSuccess.status).toBe(200);
      const dataSuccess = await resSuccess.json();
      expect(dataSuccess.record.company).toBe('Acme Corp');
      expect(dataSuccess.meta.isNew).toBe(true);

      // Clean up schema
      usersCol.schema = usersCol.schema.filter((f) => f.name !== 'company');
      app.schema.updateCollection('users', usersCol);
    });
  });

  describe('4. External Identities Management (List & Unlink)', () => {
    it('should list and unlink social identities for an authenticated user', async () => {
      const mockGoogle = new MockOAuthProvider('google', 'Google', {
        id: 'g_link_test',
        email: 'linked@user.com',
        name: 'Linked User',
        isEmailVerified: true,
        rawUser: { id: 'g_link_test' },
      });
      app.auth.getOAuthRegistry().register(mockGoogle);

      // Login via OAuth
      const loginRes = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'code_g',
          codeVerifier: 'verifier_g',
        }),
      });
      const loginData = await loginRes.json();
      const userToken = loginData.token;
      const userId = loginData.record.id;

      // List external auths
      const listRes = await fetch(`${serverUrl}/api/collections/users/records/${userId}/external-auths`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      expect(listRes.status).toBe(200);
      const externalAuths = await listRes.json();
      expect(Array.isArray(externalAuths)).toBe(true);
      expect(externalAuths.length).toBe(1);
      expect(externalAuths[0].provider).toBe('google');

      // Unlink external auth
      const unlinkRes = await fetch(`${serverUrl}/api/collections/users/records/${userId}/external-auths/google`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userToken}` },
      });
      expect(unlinkRes.status).toBe(204);

      // List should now be empty
      const listAfter = await (await fetch(`${serverUrl}/api/collections/users/records/${userId}/external-auths`, {
        headers: { Authorization: `Bearer ${userToken}` },
      })).json();
      expect(listAfter.length).toBe(0);
    });
  });

  describe('5. nodestack-client SDK Integration', () => {
    it('should authenticate with OAuth2 code and verifier via client SDK and persist session', async () => {
      const mockApple = new MockOAuthProvider('apple', 'Apple', {
        id: 'apple_sdk_user',
        email: 'sdk@apple.com',
        isEmailVerified: true,
        rawUser: { sub: 'apple_sdk_user' },
      });
      app.auth.getOAuthRegistry().register(mockApple);

      const client = new NodeStackClient(serverUrl);
      expect(client.authStore.isValid).toBe(false);

      // List auth methods via SDK
      const methods = await client.collection('users').listAuthMethods();
      expect(methods.authProviders.some((p) => p.name === 'apple')).toBe(true);

      // Perform authWithOAuth2 via SDK
      const result = await client.collection('users').authWithOAuth2({
        provider: 'apple',
        code: 'apple_code_123',
        codeVerifier: 'apple_verifier_123',
      });

      expect(result.token).toBeDefined();
      expect(result.record.email).toBe('sdk@apple.com');
      // AuthStore should automatically persist the token and record
      expect(client.authStore.isValid).toBe(true);
      expect(client.authStore.token).toBe(result.token);
    });

    it('should securely handle popup postMessage flow (enforcing origin, source, and state binding)', async () => {
      const mockDiscord = new MockOAuthProvider('discord', 'Discord', {
        id: 'discord_popup_user',
        email: 'popup@discord.com',
        isEmailVerified: true,
        rawUser: { id: 'discord_popup_user' },
      });
      app.auth.getOAuthRegistry().register(mockDiscord);

      const messageListeners: ((event: any) => void)[] = [];
      const mockPopup: any = {
        closed: false,
        postMessage: () => {},
        close: () => {
          mockPopup.closed = true;
        },
      };
      const mockAttackerWindow: any = {
        closed: false,
        postMessage: () => {},
      };

      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {
        location: {
          href: 'http://localhost:3000/app',
          origin: 'http://localhost:3000',
        },
        addEventListener: (event: string, listener: any) => {
          if (event === 'message') messageListeners.push(listener);
        },
        removeEventListener: (event: string, listener: any) => {
          if (event === 'message') {
            const idx = messageListeners.indexOf(listener);
            if (idx >= 0) messageListeners.splice(idx, 1);
          }
        },
      };

      try {
        const client = new NodeStackClient(serverUrl);
        let capturedAuthUrl = '';

        const authPromise = client.collection('users').authWithOAuth2({
          provider: 'discord',
          redirectUrl: 'http://localhost:3000/callback',
          urlCallback: (url) => {
            capturedAuthUrl = url;
            return mockPopup;
          },
        });

        // Wait until urlCallback is called and listener is attached
        let attempts = 0;
        while (!capturedAuthUrl && attempts < 50) {
          await new Promise((r) => setTimeout(r, 20));
          attempts++;
        }

        const parsedUrl = new URL(capturedAuthUrl);
        const expectedState = parsedUrl.searchParams.get('state')!;
        expect(expectedState).toBeDefined();

        expect(messageListeners.length).toBe(1);
        const listener = messageListeners[0];

        // 1. Attacker sends injected error from foreign origin -> MUST BE IGNORED
        await listener({
          origin: 'https://evil-site.com',
          source: mockPopup,
          data: { type: 'nodestack_oauth_callback', state: expectedState, error: 'fake error' },
        });
        expect(messageListeners.length).toBe(1); // Listener NOT removed

        // 2. Attacker frame on correct origin sends injected message from wrong source -> MUST BE IGNORED
        await listener({
          origin: 'http://localhost:3000',
          source: mockAttackerWindow,
          data: { type: 'nodestack_oauth_callback', state: expectedState, code: 'stolen_code' },
        });
        expect(messageListeners.length).toBe(1); // Listener NOT removed

        // 3. Popup sends message with mismatched state (CSRF / stale flow) -> MUST BE IGNORED
        await listener({
          origin: 'http://localhost:3000',
          source: mockPopup,
          data: { type: 'nodestack_oauth_callback', state: 'wrong_state_value', code: 'valid_code' },
        });
        expect(messageListeners.length).toBe(1); // Listener NOT removed

        // 4. Valid message from expected popup, matching origin, matching state -> MUST BE ACCEPTED
        await listener({
          origin: 'http://localhost:3000',
          source: mockPopup,
          data: {
            type: 'nodestack_oauth_callback',
            state: expectedState,
            code: 'discord_popup_code',
          },
        });

        const authResult = await authPromise;
        expect(authResult.token).toBeDefined();
        expect(authResult.record.email).toBe('popup@discord.com');
        expect(messageListeners.length).toBe(0); // Listener cleaned up
        expect(mockPopup.closed).toBe(true); // Popup closed
      } finally {
        (globalThis as any).window = originalWindow;
      }
    });

    it('should reject when OAuth popup is closed by user before completion', async () => {
      const mockDiscord = new MockOAuthProvider('discord', 'Discord', {
        id: 'discord_popup_user_2',
        email: 'popup2@discord.com',
        isEmailVerified: true,
        rawUser: { id: 'discord_popup_user_2' },
      });
      app.auth.getOAuthRegistry().register(mockDiscord);

      const messageListeners: ((event: any) => void)[] = [];
      const mockPopup: any = {
        closed: false,
        postMessage: () => {},
        close: () => {
          mockPopup.closed = true;
        },
      };

      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {
        location: {
          href: 'http://localhost:3000/app',
          origin: 'http://localhost:3000',
        },
        addEventListener: (event: string, listener: any) => {
          if (event === 'message') messageListeners.push(listener);
        },
        removeEventListener: (event: string, listener: any) => {
          if (event === 'message') {
            const idx = messageListeners.indexOf(listener);
            if (idx >= 0) messageListeners.splice(idx, 1);
          }
        },
      };

      try {
        const client = new NodeStackClient(serverUrl);
        let opened = false;
        const authPromise = client.collection('users').authWithOAuth2({
          provider: 'discord',
          redirectUrl: 'http://localhost:3000/callback',
          urlCallback: () => {
            opened = true;
            return mockPopup;
          },
        });

        // Wait until urlCallback is invoked and listener is attached
        let attempts = 0;
        while (!opened && attempts < 50) {
          await new Promise((r) => setTimeout(r, 20));
          attempts++;
        }

        expect(messageListeners.length).toBe(1);

        // Simulate user closing the popup window
        mockPopup.closed = true;

        await expect(authPromise).rejects.toThrow('The OAuth popup window was closed before completing authentication.');
        expect(messageListeners.length).toBe(0); // Cleaned up
      } finally {
        (globalThis as any).window = originalWindow;
      }
    });
  });

  describe('6. Apple Provider JWS Cryptographic Verification', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { privateKey: attackerPrivateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

    const testKid = 'apple_key_2026';
    const jwk = publicKey.export({ format: 'jwk' }) as any;
    jwk.kid = testKid;
    jwk.alg = 'RS256';
    jwk.use = 'sig';

    const clientId = 'com.nodestack.service';
    const clientSecret = 'mock_apple_client_secret';

    it('should verify valid Apple id_token against JWKS public key and extract profile', async () => {
      const appleProvider = new AppleProvider({
        clientId,
        clientSecret,
        customKeys: [jwk],
      });

      const validToken = jwt.sign(
        {
          iss: 'https://appleid.apple.com',
          aud: clientId,
          sub: 'apple_unique_sub_123',
          email: 'johndoe@apple.com',
          email_verified: 'true',
        },
        privateKey,
        {
          algorithm: 'RS256',
          expiresIn: '10m',
          keyid: testKid,
        }
      );

      const profile = await (appleProvider as any).fetchUserProfile('mock_access_token', {
        id_token: validToken,
      });

      expect(profile.id).toBe('apple_unique_sub_123');
      expect(profile.email).toBe('johndoe@apple.com');
      expect(profile.isEmailVerified).toBe(true);
      expect(profile.rawUser.sub).toBe('apple_unique_sub_123');
    });

    it('should reject Apple id_token with forged signature', async () => {
      const appleProvider = new AppleProvider({
        clientId,
        clientSecret,
        customKeys: [jwk],
      });

      const forgedToken = jwt.sign(
        {
          iss: 'https://appleid.apple.com',
          aud: clientId,
          sub: 'victim_apple_id',
          email: 'victim@apple.com',
          email_verified: true,
        },
        attackerPrivateKey,
        {
          algorithm: 'RS256',
          expiresIn: '10m',
          keyid: testKid,
        }
      );

      await expect(
        (appleProvider as any).fetchUserProfile('mock_access_token', { id_token: forgedToken })
      ).rejects.toThrow(/invalid signature/);
    });

    it('should reject Apple id_token with mismatched audience', async () => {
      const appleProvider = new AppleProvider({
        clientId,
        clientSecret,
        customKeys: [jwk],
      });

      const wrongAudToken = jwt.sign(
        {
          iss: 'https://appleid.apple.com',
          aud: 'com.anotherapp.client',
          sub: 'apple_sub_456',
          email: 'test@apple.com',
          email_verified: true,
        },
        privateKey,
        {
          algorithm: 'RS256',
          expiresIn: '10m',
          keyid: testKid,
        }
      );

      await expect(
        (appleProvider as any).fetchUserProfile('mock_access_token', { id_token: wrongAudToken })
      ).rejects.toThrow(/jwt audience invalid/);
    });

    it('should reject Apple id_token with mismatched issuer', async () => {
      const appleProvider = new AppleProvider({
        clientId,
        clientSecret,
        customKeys: [jwk],
      });

      const wrongIssToken = jwt.sign(
        {
          iss: 'https://rogue-apple.com',
          aud: clientId,
          sub: 'apple_sub_789',
          email: 'test@apple.com',
          email_verified: true,
        },
        privateKey,
        {
          algorithm: 'RS256',
          expiresIn: '10m',
          keyid: testKid,
        }
      );

      await expect(
        (appleProvider as any).fetchUserProfile('mock_access_token', { id_token: wrongIssToken })
      ).rejects.toThrow(/jwt issuer invalid/);
    });

    it('should reject expired Apple id_token', async () => {
      const appleProvider = new AppleProvider({
        clientId,
        clientSecret,
        customKeys: [jwk],
      });

      const expiredToken = jwt.sign(
        {
          iss: 'https://appleid.apple.com',
          aud: clientId,
          sub: 'apple_sub_expired',
          email: 'expired@apple.com',
          email_verified: true,
        },
        privateKey,
        {
          algorithm: 'RS256',
          expiresIn: '-10s',
          keyid: testKid,
        }
      );

      await expect(
        (appleProvider as any).fetchUserProfile('mock_access_token', { id_token: expiredToken })
      ).rejects.toThrow(/jwt expired/);
    });

    it('should reject Apple id_token when kid is not found in JWKS', async () => {
      const appleProvider = new AppleProvider({
        clientId,
        clientSecret,
        customKeys: [jwk],
      });

      const unknownKidToken = jwt.sign(
        {
          iss: 'https://appleid.apple.com',
          aud: clientId,
          sub: 'apple_sub_unknown_kid',
          email: 'unknown@apple.com',
          email_verified: true,
        },
        privateKey,
        {
          algorithm: 'RS256',
          expiresIn: '10m',
          keyid: 'unregistered_kid_999',
        }
      );

      await expect(
        (appleProvider as any).fetchUserProfile('mock_access_token', { id_token: unknownKidToken })
      ).rejects.toThrow(/signing key not found/);
    });

    it('should reject Apple id_token when sub claim is missing', async () => {
      const appleProvider = new AppleProvider({
        clientId,
        clientSecret,
        customKeys: [jwk],
      });

      const missingSubToken = jwt.sign(
        {
          iss: 'https://appleid.apple.com',
          aud: clientId,
          email: 'nosub@apple.com',
          email_verified: true,
        },
        privateKey,
        {
          algorithm: 'RS256',
          expiresIn: '10m',
          keyid: testKid,
        }
      );

      await expect(
        (appleProvider as any).fetchUserProfile('mock_access_token', { id_token: missingSubToken })
      ).rejects.toThrow(/missing sub claim/);
    });
  });
});
