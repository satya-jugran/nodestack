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
import { GitHubProvider } from '../src/auth/oauth/GitHubProvider';
import { MicrosoftProvider } from '../src/auth/oauth/MicrosoftProvider';

class MockOAuthProvider implements IOAuthProvider {
  public name: string;
  public displayName: string;
  public mockProfile: OAuthProfile;
  public enabled?: boolean;

  constructor(name: string, displayName: string, mockProfile: OAuthProfile, enabled: boolean = true) {
    this.name = name;
    this.displayName = displayName;
    this.mockProfile = mockProfile;
    this.enabled = enabled;
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

    it('should not register or advertise providers configured with enabled: false in registerFromConfig', async () => {
      const registry = app.auth.getOAuthRegistry();

      registry.registerFromConfig({
        name: 'google',
        displayName: 'Google',
        clientId: 'google_id',
        clientSecret: 'google_secret',
        enabled: false,
      });

      expect(registry.getProvider('google')).toBeUndefined();
      expect(registry.isProviderEnabled('google')).toBe(false);
      expect(registry.getEnabledProviders().some((p) => p.name === 'google')).toBe(false);

      const res = await fetch(`${serverUrl}/api/collections/users/auth-methods`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.authProviders.some((p: any) => p.name === 'google')).toBe(false);
    });

    it('should unregister an existing provider if registerFromConfig is called with enabled: false', async () => {
      const registry = app.auth.getOAuthRegistry();

      registry.register(
        new MockOAuthProvider('github', 'GitHub', {
          id: 'gh_active',
          email: 'active@github.com',
          isEmailVerified: true,
          rawUser: { id: 'gh_active' },
        })
      );
      expect(registry.getProvider('github')).toBeDefined();

      // Disable it via registerFromConfig
      registry.registerFromConfig({
        name: 'github',
        displayName: 'GitHub',
        clientId: 'gh_id',
        clientSecret: 'gh_secret',
        enabled: false,
      });

      expect(registry.getProvider('github')).toBeUndefined();
      expect(registry.isProviderEnabled('github')).toBe(false);
      expect(registry.getEnabledProviders().some((p) => p.name === 'github')).toBe(false);
    });

    it('should not register or advertise providers passed with enabled: false to register()', async () => {
      const registry = app.auth.getOAuthRegistry();

      const disabledMock = new MockOAuthProvider(
        'discord',
        'Discord',
        {
          id: 'disc_disabled',
          email: 'disabled@discord.com',
          isEmailVerified: true,
          rawUser: { id: 'disc_disabled' },
        },
        false
      );

      registry.register(disabledMock);
      expect(registry.getProvider('discord')).toBeUndefined();
      expect(registry.isProviderEnabled('discord')).toBe(false);
      expect(registry.getEnabledProviders().some((p) => p.name === 'discord')).toBe(false);

      const res = await fetch(`${serverUrl}/api/collections/users/auth-methods`);
      const data = await res.json();
      expect(data.authProviders.some((p: any) => p.name === 'discord')).toBe(false);
    });

    it('should reject authWithOAuth2 when provider is disabled', async () => {
      const registry = app.auth.getOAuthRegistry();
      registry.registerFromConfig({
        name: 'google',
        displayName: 'Google',
        clientId: 'google_id',
        clientSecret: 'google_secret',
        enabled: false,
      });

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'any_code',
          codeVerifier: 'any_verifier',
          state: 'any_state',
        }),
      });

      expect(res.status).toBe(400);
      const err = await res.json();
      expect(err.message).toContain("OAuth2 provider 'google' is not configured or enabled");
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
      app.auth.getOAuthRegistry().registerSession({
        state: 'gh_state_1',
        provider: 'github',
        collection: 'users',
        redirectUri: 'http://localhost:3000/callback',
      });

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          code: 'valid_auth_code',
          codeVerifier: 'verifier_string_123',
          state: 'gh_state_1',
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
      app.auth.getOAuthRegistry().registerSession({
        state: 'gh_state_2',
        provider: 'github',
        collection: 'users',
        redirectUri: 'http://localhost:3000/callback',
      });

      const res2 = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          code: 'valid_auth_code_2',
          codeVerifier: 'verifier_string_123',
          state: 'gh_state_2',
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
      app.auth.getOAuthRegistry().registerSession({
        state: 'disc_state_link',
        provider: 'discord',
        collection: 'users',
      });

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'discord',
          code: 'code_discord',
          codeVerifier: 'verifier_discord',
          state: 'disc_state_link',
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
      app.auth.getOAuthRegistry().registerSession({
        state: 'attacker_state',
        provider: 'discord',
        collection: 'users',
      });

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'discord',
          code: 'code_attacker',
          codeVerifier: 'verifier_attacker',
          state: 'attacker_state',
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
      app.auth.getOAuthRegistry().registerSession({
        state: 'ms_state_rule',
        provider: 'microsoft',
        collection: 'users',
      });

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'microsoft',
          code: 'ms_code',
          codeVerifier: 'ms_verifier',
          state: 'ms_state_rule',
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
      app.auth.getOAuthRegistry().registerSession({
        state: 'ms_state_fail',
        provider: 'microsoft',
        collection: 'users',
      });

      const resFail = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'microsoft',
          code: 'ms_code_fail',
          codeVerifier: 'ms_verifier_fail',
          state: 'ms_state_fail',
        }),
      });

      expect(resFail.status).toBe(422);
      const err = await resFail.json();
      expect(err.message).toContain("Field 'company' is required");

      // Now provision WITH the required 'company' field in createData
      app.auth.getOAuthRegistry().registerSession({
        state: 'ms_state_success',
        provider: 'microsoft',
        collection: 'users',
      });

      const resSuccess = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'microsoft',
          code: 'ms_code_success',
          codeVerifier: 'ms_verifier_success',
          state: 'ms_state_success',
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

    it('should enforce type, length, and value constraints on custom schema fields during OAuth2 provisioning', async () => {
      const usersCol = app.schema.getCollectionOrThrow('users');
      usersCol.schema.push(
        {
          name: 'phone',
          type: 'text',
          options: { min: 10, max: 15 },
        },
        {
          name: 'age',
          type: 'number',
          options: { min: 18 },
        }
      );
      app.schema.updateCollection('users', usersCol);

      const mockProvider = new MockOAuthProvider('google', 'Google', {
        id: 'g_constraints_test',
        email: 'constraints@test.com',
        isEmailVerified: true,
        rawUser: { id: 'g_constraints_test' },
      });
      app.auth.getOAuthRegistry().register(mockProvider);

      // 1. Rejected when text length is below minimum constraint
      app.auth.getOAuthRegistry().registerSession({
        state: 'state_too_short',
        provider: 'google',
        collection: 'users',
      });
      const resTooShort = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'code_short',
          codeVerifier: 'verifier_short',
          state: 'state_too_short',
          createData: {
            phone: '123', // < 10 characters
            age: 25,
          },
        }),
      });
      expect(resTooShort.status).toBe(422);
      const errTooShort = await resTooShort.json();
      expect(errTooShort.message).toContain("Field 'phone' must be at least 10 characters");

      // 2. Rejected when number value is below minimum constraint
      app.auth.getOAuthRegistry().registerSession({
        state: 'state_underage',
        provider: 'google',
        collection: 'users',
      });
      const resUnderage = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'code_underage',
          codeVerifier: 'verifier_underage',
          state: 'state_underage',
          createData: {
            phone: '+12345678901',
            age: 16, // < 18
          },
        }),
      });
      expect(resUnderage.status).toBe(422);
      const errUnderage = await resUnderage.json();
      expect(errUnderage.message).toContain("Field 'age' must be greater than or equal to 18");

      // 3. Accepted when constraints are satisfied
      app.auth.getOAuthRegistry().registerSession({
        state: 'state_valid_constraints',
        provider: 'google',
        collection: 'users',
      });
      const resValid = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'code_valid',
          codeVerifier: 'verifier_valid',
          state: 'state_valid_constraints',
          createData: {
            phone: '+12345678901',
            age: '25', // Should be normalized to number 25
          },
        }),
      });
      expect(resValid.status).toBe(200);
      const dataValid = await resValid.json();
      expect(dataValid.record.phone).toBe('+12345678901');
      expect(dataValid.record.age).toBe(25);

      // Clean up schema
      usersCol.schema = usersCol.schema.filter((f) => f.name !== 'phone' && f.name !== 'age');
      app.schema.updateCollection('users', usersCol);
    });

    it('should trigger record lifecycle hooks (onRecordBeforeCreate & onRecordAfterCreate) during OAuth2 provisioning', async () => {
      const usersCol = app.schema.getCollectionOrThrow('users');
      usersCol.schema.push({
        name: 'role',
        type: 'text',
      });
      app.schema.updateCollection('users', usersCol);

      let beforeHookInvoked = false;
      let afterCreatedId: string | null = null;

      const unregisterBefore = app.eventBus.onRecordBeforeCreate('users', async (ctx) => {
        beforeHookInvoked = true;
        // Hook mutates record data before persistence
        ctx.record.role = 'vip_member';
      });

      const unregisterAfter = app.eventBus.onRecordAfterCreate('users', async (ctx) => {
        afterCreatedId = ctx.record.id;
      });

      try {
        const mockProvider = new MockOAuthProvider('google', 'Google', {
          id: 'g_hooks_user',
          email: 'hooks@test.com',
          isEmailVerified: true,
          rawUser: { id: 'g_hooks_user' },
        });
        app.auth.getOAuthRegistry().register(mockProvider);
        app.auth.getOAuthRegistry().registerSession({
          state: 'state_hooks_test',
          provider: 'google',
          collection: 'users',
        });

        const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'google',
            code: 'code_hooks',
            codeVerifier: 'verifier_hooks',
            state: 'state_hooks_test',
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(beforeHookInvoked).toBe(true);
        expect(data.record.role).toBe('vip_member'); // Modified by onRecordBeforeCreate hook!
        expect(afterCreatedId).toBe(data.record.id);
      } finally {
        unregisterBefore();
        unregisterAfter();
        usersCol.schema = usersCol.schema.filter((f) => f.name !== 'role');
        app.schema.updateCollection('users', usersCol);
      }
    });

    it('should allow onRecordBeforeCreate lifecycle hook to cancel OAuth2 user provisioning', async () => {
      const unregisterCancelHook = app.eventBus.onRecordBeforeCreate('users', async (ctx) => {
        ctx.cancel('Registration is temporarily closed for maintenance');
      });

      try {
        const mockProvider = new MockOAuthProvider('google', 'Google', {
          id: 'g_cancel_test',
          email: 'cancelled@test.com',
          isEmailVerified: true,
          rawUser: { id: 'g_cancel_test' },
        });
        app.auth.getOAuthRegistry().register(mockProvider);
        app.auth.getOAuthRegistry().registerSession({
          state: 'state_cancel_test',
          provider: 'google',
          collection: 'users',
        });

        const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'google',
            code: 'code_cancel',
            codeVerifier: 'verifier_cancel',
            state: 'state_cancel_test',
          }),
        });

        expect(res.status).toBe(400);
        const err = await res.json();
        expect(err.message).toContain('Registration is temporarily closed for maintenance');
      } finally {
        unregisterCancelHook();
      }
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
      app.auth.getOAuthRegistry().registerSession({
        state: 'g_state_link',
        provider: 'google',
        collection: 'users',
      });

      const loginRes = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'code_g',
          codeVerifier: 'verifier_g',
          state: 'g_state_link',
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
      const appleProvider = methods.authProviders.find((p) => p.name === 'apple')!;
      expect(appleProvider).toBeDefined();

      // Perform authWithOAuth2 via SDK
      const result = await client.collection('users').authWithOAuth2({
        provider: 'apple',
        code: 'apple_code_123',
        codeVerifier: appleProvider.codeVerifier,
        state: appleProvider.state,
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

  describe('7. GitHub Provider Email Verification Metadata Resolution', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should mark email as unverified if public profile email is not verified in /user/emails', async () => {
      const provider = new GitHubProvider({
        clientId: 'mock_gh_client',
        clientSecret: 'mock_gh_secret',
      });

      globalThis.fetch = (async (url: any) => {
        if (String(url) === 'https://api.github.com/user') {
          return {
            ok: true,
            json: async () => ({
              id: 12345,
              login: 'attacker',
              email: 'victim@company.com',
            }),
          };
        }
        if (String(url) === 'https://api.github.com/user/emails') {
          return {
            ok: true,
            json: async () => [
              { email: 'victim@company.com', primary: false, verified: false },
              { email: 'attacker_real@gmail.com', primary: true, verified: false },
            ],
          };
        }
        return originalFetch(url);
      }) as any;

      const profile = await (provider as any).fetchUserProfile('mock_token');
      expect(profile.id).toBe('12345');
      expect(profile.email).toBe('victim@company.com');
      // Crucial: Must NOT be marked verified
      expect(profile.isEmailVerified).toBe(false);
    });

    it('should use primary verified email from /user/emails even if public profile email is unverified', async () => {
      const provider = new GitHubProvider({
        clientId: 'mock_gh_client',
        clientSecret: 'mock_gh_secret',
      });

      globalThis.fetch = (async (url: any) => {
        if (String(url) === 'https://api.github.com/user') {
          return {
            ok: true,
            json: async () => ({
              id: 67890,
              login: 'developer',
              email: 'unverified-public@other.com',
            }),
          };
        }
        if (String(url) === 'https://api.github.com/user/emails') {
          return {
            ok: true,
            json: async () => [
              { email: 'unverified-public@other.com', primary: false, verified: false },
              { email: 'verified-primary@developer.com', primary: true, verified: true },
            ],
          };
        }
        return originalFetch(url);
      }) as any;

      const profile = await (provider as any).fetchUserProfile('mock_token');
      expect(profile.id).toBe('67890');
      // Resolves to genuine verified primary email
      expect(profile.email).toBe('verified-primary@developer.com');
      expect(profile.isEmailVerified).toBe(true);
    });

    it('should mark email as verified if public profile email is verified in /user/emails', async () => {
      const provider = new GitHubProvider({
        clientId: 'mock_gh_client',
        clientSecret: 'mock_gh_secret',
      });

      globalThis.fetch = (async (url: any) => {
        if (String(url) === 'https://api.github.com/user') {
          return {
            ok: true,
            json: async () => ({
              id: 54321,
              login: 'alice',
              email: 'alice@company.com',
            }),
          };
        }
        if (String(url) === 'https://api.github.com/user/emails') {
          return {
            ok: true,
            json: async () => [
              { email: 'alice@company.com', primary: true, verified: true },
            ],
          };
        }
        return originalFetch(url);
      }) as any;

      const profile = await (provider as any).fetchUserProfile('mock_token');
      expect(profile.id).toBe('54321');
      expect(profile.email).toBe('alice@company.com');
      expect(profile.isEmailVerified).toBe(true);
    });

    it('should fail closed (unverified) if /user/emails request fails', async () => {
      const provider = new GitHubProvider({
        clientId: 'mock_gh_client',
        clientSecret: 'mock_gh_secret',
      });

      globalThis.fetch = (async (url: any) => {
        if (String(url) === 'https://api.github.com/user') {
          return {
            ok: true,
            json: async () => ({
              id: 99999,
              login: 'bob',
              email: 'bob@example.com',
            }),
          };
        }
        if (String(url) === 'https://api.github.com/user/emails') {
          throw new Error('Network error or rate limited');
        }
        return originalFetch(url);
      }) as any;

      const profile = await (provider as any).fetchUserProfile('mock_token');
      expect(profile.id).toBe('99999');
      expect(profile.email).toBe('bob@example.com');
      // Must fail closed: cannot verify without /user/emails confirmation
      expect(profile.isEmailVerified).toBe(false);
    });

    it('should pass abort signal with centralized timeout to both /user and /user/emails requests', async () => {
      const provider = new GitHubProvider({
        clientId: 'mock_gh_client',
        clientSecret: 'mock_gh_secret',
        timeoutMs: 5000,
      });

      const signals: any[] = [];
      globalThis.fetch = (async (url: any, options: any) => {
        signals.push({ url: String(url), signal: options?.signal });
        if (String(url) === 'https://api.github.com/user') {
          return {
            ok: true,
            json: async () => ({
              id: 88888,
              login: 'signal-user',
              email: 'signal@example.com',
            }),
          };
        }
        if (String(url) === 'https://api.github.com/user/emails') {
          return {
            ok: true,
            json: async () => [{ email: 'signal@example.com', primary: true, verified: true }],
          };
        }
        return originalFetch(url, options);
      }) as any;

      const profile = await (provider as any).fetchUserProfile('mock_token');
      expect(profile.id).toBe('88888');
      expect(signals.length).toBe(2);
      expect(signals[0].signal).toBeDefined();
      expect(signals[1].signal).toBeDefined();
    });
  });

  describe('8. Microsoft Provider Email Verification Assertion Resolution', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should leave isEmailVerified as false when neither id_token nor Graph profile attests verification', async () => {
      const provider = new MicrosoftProvider({
        clientId: 'mock_ms_client',
        clientSecret: 'mock_ms_secret',
      });

      globalThis.fetch = (async (url: any) => {
        if (String(url) === 'https://graph.microsoft.com/v1.0/me') {
          return {
            ok: true,
            json: async () => ({
              id: 'ms_user_123',
              displayName: 'Enterprise User',
              mail: 'unverified@enterprise.com',
              userPrincipalName: 'unverified@enterprise.com',
            }),
          };
        }
        return originalFetch(url);
      }) as any;

      const profile = await (provider as any).fetchUserProfile('mock_token');
      expect(profile.id).toBe('ms_user_123');
      expect(profile.email).toBe('unverified@enterprise.com');
      expect(profile.isEmailVerified).toBe(false);
    });

    it('should mark isEmailVerified as true when id_token explicitly attests email_verified', async () => {
      const provider = new MicrosoftProvider({
        clientId: 'mock_ms_client',
        clientSecret: 'mock_ms_secret',
      });

      globalThis.fetch = (async (url: any) => {
        if (String(url) === 'https://graph.microsoft.com/v1.0/me') {
          return {
            ok: true,
            json: async () => ({
              id: 'ms_user_456',
              displayName: 'Verified Consumer',
              mail: 'consumer@outlook.com',
              userPrincipalName: 'consumer@outlook.com',
            }),
          };
        }
        return originalFetch(url);
      }) as any;

      const idTokenPayload = {
        sub: 'ms_user_456',
        email: 'consumer@outlook.com',
        email_verified: true,
      };
      const mockIdToken = `header.${Buffer.from(JSON.stringify(idTokenPayload)).toString('base64url')}.sig`;

      const profile = await (provider as any).fetchUserProfile('mock_token', {
        id_token: mockIdToken,
      });

      expect(profile.id).toBe('ms_user_456');
      expect(profile.email).toBe('consumer@outlook.com');
      expect(profile.isEmailVerified).toBe(true);
    });

    it('should mark isEmailVerified as true when id_token contains Entra ID xms_edov domain-verified claim', async () => {
      const provider = new MicrosoftProvider({
        clientId: 'mock_ms_client',
        clientSecret: 'mock_ms_secret',
      });

      globalThis.fetch = (async (url: any) => {
        if (String(url) === 'https://graph.microsoft.com/v1.0/me') {
          return {
            ok: true,
            json: async () => ({
              id: 'ms_user_789',
              displayName: 'Corp Employee',
              mail: 'employee@verified-tenant.com',
              userPrincipalName: 'employee@verified-tenant.com',
            }),
          };
        }
        return originalFetch(url);
      }) as any;

      const idTokenPayload = {
        sub: 'ms_user_789',
        preferred_username: 'employee@verified-tenant.com',
        xms_edov: '1',
      };
      const mockIdToken = `header.${Buffer.from(JSON.stringify(idTokenPayload)).toString('base64url')}.sig`;

      const profile = await (provider as any).fetchUserProfile('mock_token', {
        id_token: mockIdToken,
      });

      expect(profile.id).toBe('ms_user_789');
      expect(profile.email).toBe('employee@verified-tenant.com');
      expect(profile.isEmailVerified).toBe(true);
    });

    it('should leave isEmailVerified as false when id_token explicitly indicates email_verified: false', async () => {
      const provider = new MicrosoftProvider({
        clientId: 'mock_ms_client',
        clientSecret: 'mock_ms_secret',
      });

      globalThis.fetch = (async (url: any) => {
        if (String(url) === 'https://graph.microsoft.com/v1.0/me') {
          return {
            ok: true,
            json: async () => ({
              id: 'ms_user_000',
              displayName: 'Unverified Guest',
              mail: 'guest@external.com',
              userPrincipalName: 'guest@external.com',
            }),
          };
        }
        return originalFetch(url);
      }) as any;

      const idTokenPayload = {
        sub: 'ms_user_000',
        email: 'guest@external.com',
        email_verified: false,
      };
      const mockIdToken = `header.${Buffer.from(JSON.stringify(idTokenPayload)).toString('base64url')}.sig`;

      const profile = await (provider as any).fetchUserProfile('mock_token', {
        id_token: mockIdToken,
      });

      expect(profile.id).toBe('ms_user_000');
      expect(profile.email).toBe('guest@external.com');
      expect(profile.isEmailVerified).toBe(false);
    });
  });

  describe('9. State Parameter & PKCE Session Binding (Login-CSRF & Account Swapping Protection)', () => {
    it('should reject authentication when state parameter is missing', async () => {
      const mockProvider = new MockOAuthProvider('google', 'Google', {
        id: 'g_state_missing',
        email: 'statemissing@google.com',
        isEmailVerified: true,
        rawUser: { id: 'g_state_missing' },
      });
      app.auth.getOAuthRegistry().register(mockProvider);

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'valid_code',
          codeVerifier: 'valid_verifier',
          // state omitted
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain('state');
    });

    it('should reject authentication when state is invalid or non-existent', async () => {
      const mockProvider = new MockOAuthProvider('google', 'Google', {
        id: 'g_state_invalid',
        email: 'stateinvalid@google.com',
        isEmailVerified: true,
        rawUser: { id: 'g_state_invalid' },
      });
      app.auth.getOAuthRegistry().register(mockProvider);

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'valid_code',
          codeVerifier: 'valid_verifier',
          state: 'unrecognized_random_state_98765',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain('Invalid or expired OAuth state parameter');
    });

    it('should reject authentication when state session has expired', async () => {
      const mockProvider = new MockOAuthProvider('google', 'Google', {
        id: 'g_state_expired',
        email: 'stateexpired@google.com',
        isEmailVerified: true,
        rawUser: { id: 'g_state_expired' },
      });
      app.auth.getOAuthRegistry().register(mockProvider);

      app.auth.getOAuthRegistry().registerSession({
        state: 'expired_state_123',
        provider: 'google',
        collection: 'users',
        expiresAt: Date.now() - 1000, // Expired in the past
      });

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'valid_code',
          codeVerifier: 'valid_verifier',
          state: 'expired_state_123',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toMatch(/expired/i);
    });

    it('should prevent replay attacks by consuming the state session immediately on first exchange', async () => {
      const mockProvider = new MockOAuthProvider('google', 'Google', {
        id: 'g_replay_user',
        email: 'replay@google.com',
        isEmailVerified: true,
        rawUser: { id: 'g_replay_user' },
      });
      app.auth.getOAuthRegistry().register(mockProvider);

      app.auth.getOAuthRegistry().registerSession({
        state: 'single_use_state_token',
        provider: 'google',
        collection: 'users',
      });

      // First exchange: valid and consumes the state token
      const res1 = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'code_1',
          codeVerifier: 'verifier_1',
          state: 'single_use_state_token',
        }),
      });
      expect(res1.status).toBe(200);

      // Replay attempt with same state token must fail
      const res2 = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'code_2',
          codeVerifier: 'verifier_2',
          state: 'single_use_state_token',
        }),
      });
      expect(res2.status).toBe(400);
      const data2 = await res2.json();
      expect(data2.message).toContain('Invalid or expired OAuth state parameter');
    });

    it('should reject authentication when state provider does not match the request provider', async () => {
      const mockGithub = new MockOAuthProvider('github', 'GitHub', {
        id: 'gh_prov_mismatch',
        email: 'gh@mismatch.com',
        isEmailVerified: true,
        rawUser: { id: 'gh_prov_mismatch' },
      });
      app.auth.getOAuthRegistry().register(mockGithub);

      // Session was registered for 'google'
      app.auth.getOAuthRegistry().registerSession({
        state: 'google_session_state',
        provider: 'google',
        collection: 'users',
      });

      // Attacker or swapped request tries to exchange with 'github'
      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          code: 'gh_code',
          codeVerifier: 'gh_verifier',
          state: 'google_session_state',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain('OAuth state provider mismatch');
    });

    it('should reject authentication when state collection does not match the requested collection', async () => {
      const mockGoogle = new MockOAuthProvider('google', 'Google', {
        id: 'g_col_mismatch',
        email: 'col@mismatch.com',
        isEmailVerified: true,
        rawUser: { id: 'g_col_mismatch' },
      });
      app.auth.getOAuthRegistry().register(mockGoogle);

      // Session was registered for 'admins' collection
      app.auth.getOAuthRegistry().registerSession({
        state: 'admins_session_state',
        provider: 'google',
        collection: 'admins',
      });

      // Request sent to 'users' collection
      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'g_code',
          codeVerifier: 'g_verifier',
          state: 'admins_session_state',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain('OAuth state collection mismatch');
    });

    it('should reject authentication when PKCE code_verifier does not match the session code_challenge', async () => {
      const mockGoogle = new MockOAuthProvider('google', 'Google', {
        id: 'g_pkce_mismatch',
        email: 'pkce@mismatch.com',
        isEmailVerified: true,
        rawUser: { id: 'g_pkce_mismatch' },
      });
      app.auth.getOAuthRegistry().register(mockGoogle);

      const secretVerifier = 'real_super_secret_pkce_verifier_string_123';
      const realChallenge = crypto.createHash('sha256').update(secretVerifier).digest('base64url');

      app.auth.getOAuthRegistry().registerSession({
        state: 'pkce_bound_state',
        provider: 'google',
        collection: 'users',
        codeChallenge: realChallenge,
      });

      // Attacker tries to exchange with a forged/mismatched code_verifier
      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'g_code',
          codeVerifier: 'attacker_wrong_verifier_string_456',
          state: 'pkce_bound_state',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain('PKCE code_verifier does not match the session code_challenge');
    });

    it('should reject authentication when redirect_uri does not match the session redirect_uri', async () => {
      const mockGoogle = new MockOAuthProvider('google', 'Google', {
        id: 'g_uri_mismatch',
        email: 'uri@mismatch.com',
        isEmailVerified: true,
        rawUser: { id: 'g_uri_mismatch' },
      });
      app.auth.getOAuthRegistry().register(mockGoogle);

      app.auth.getOAuthRegistry().registerSession({
        state: 'redirect_bound_state',
        provider: 'google',
        collection: 'users',
        redirectUri: 'http://localhost:3000/callback',
      });

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'g_code',
          codeVerifier: 'g_verifier',
          state: 'redirect_bound_state',
          redirectUrl: 'http://evil-callback.com/callback',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain('OAuth state redirect_uri mismatch');
    });

    it('should successfully authenticate when state, provider, collection, and PKCE challenge match', async () => {
      const mockGoogle = new MockOAuthProvider('google', 'Google', {
        id: 'g_pkce_success',
        email: 'pkcesuccess@google.com',
        isEmailVerified: true,
        rawUser: { id: 'g_pkce_success' },
      });
      app.auth.getOAuthRegistry().register(mockGoogle);

      const secretVerifier = 'valid_client_verifier_secret_1234567890';
      const challenge = crypto.createHash('sha256').update(secretVerifier).digest('base64url');

      app.auth.getOAuthRegistry().registerSession({
        state: 'valid_session_state',
        provider: 'google',
        collection: 'users',
        codeChallenge: challenge,
        redirectUri: 'http://localhost:3000/callback',
      });

      const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'valid_pkce_code',
          codeVerifier: secretVerifier,
          state: 'valid_session_state',
          redirectUrl: 'http://localhost:3000/callback',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
      expect(data.record.email).toBe('pkcesuccess@google.com');
    });
  });
});
