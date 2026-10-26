import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { NodeStackClient } from '../packages/client/src/Client';
import { PkceUtil } from '../packages/client/src/auth/PkceUtil';
import { IOAuthProvider, OAuthExchangeResult, OAuthProfile } from '../src/auth/oauth/types';

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
  });
});
