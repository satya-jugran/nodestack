import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { NodeStack } from '../src/NodeStack';
import { NodeStackClient } from '../packages/client/src/Client';
import { PkceUtil } from '../packages/client/src/auth/PkceUtil';
import { IOAuthProvider, OAuthExchangeResult, OAuthProfile } from '../src/auth/oauth/types';
import { BaseOAuthProvider } from '../src/auth/oauth/BaseOAuthProvider';
import { GoogleProvider } from '../src/auth/oauth/GoogleProvider';
import { AppleProvider } from '../src/auth/oauth/AppleProvider';
import { GitHubProvider } from '../src/auth/oauth/GitHubProvider';
import { MicrosoftProvider } from '../src/auth/oauth/MicrosoftProvider';
import { SsrfGuard } from '../src/functions/security/SsrfGuard';

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

  describe('10. OAuth2 Avatar Download SSRF Protection', () => {
    it('should block internal loopback, cloud metadata, and non-HTTP avatar URLs via SsrfGuard', async () => {
      let internalHits = 0;
      const internalServer = http.createServer((_req, res) => {
        internalHits++;
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      });
      await new Promise<void>((resolve) => internalServer.listen(0, '127.0.0.1', resolve));
      const port = (internalServer.address() as any).port;

      try {
        const ssrfUrls = [
          `http://127.0.0.1:${port}/internal-avatar.png`,
          'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
          'file:///etc/passwd',
        ];

        for (let i = 0; i < ssrfUrls.length; i++) {
          const mockProvider = new MockOAuthProvider('google', 'Google', {
            id: `g_ssrf_${i}`,
            email: `ssrf_${i}@example.com`,
            name: `SSRF Test ${i}`,
            avatarUrl: ssrfUrls[i],
            isEmailVerified: true,
            rawUser: { id: `g_ssrf_${i}` },
          });
          app.auth.getOAuthRegistry().register(mockProvider);
          app.auth.getOAuthRegistry().registerSession({
            state: `ssrf_state_${i}`,
            provider: 'google',
            collection: 'users',
          });

          const fetchSpy = vi.spyOn(globalThis, 'fetch');
          const result = await app.auth.authenticateOAuth2(
            'users',
            'google',
            `code_${i}`,
            `verifier_${i}`,
            undefined,
            undefined,
            app.files,
            undefined,
            `ssrf_state_${i}`
          );

          expect(fetchSpy).not.toHaveBeenCalled();
          fetchSpy.mockRestore();

          expect(result.token).toBeDefined();
          expect(result.record.avatar).toBeFalsy();
        }

        expect(internalHits).toBe(0);
      } finally {
        await new Promise<void>((resolve) => internalServer.close(() => resolve()));
      }
    });

    it('should block redirects from external avatar URLs to internal/metadata addresses', async () => {
      const requestedUrls: string[] = [];
      const mockFetch = (async (url: string) => {
        requestedUrls.push(url);
        return {
          ok: false,
          status: 302,
          statusText: 'Found',
          headers: new Headers({ Location: 'http://169.254.169.254/latest/meta-data/' }),
          text: async () => '',
          json: async () => ({}),
        } as any;
      }) as any;

      const originalCreateGuardedFetch = SsrfGuard.createGuardedFetch.bind(SsrfGuard);
      const spy = vi
        .spyOn(SsrfGuard, 'createGuardedFetch')
        .mockImplementation(() => originalCreateGuardedFetch(undefined, 5000, mockFetch));

      try {
        const mockProvider = new MockOAuthProvider('google', 'Google', {
          id: 'g_redir_ssrf',
          email: 'redir_ssrf@example.com',
          avatarUrl: 'https://cdn.example.com/avatar-redirect.png',
          isEmailVerified: true,
          rawUser: { id: 'g_redir_ssrf' },
        });
        app.auth.getOAuthRegistry().register(mockProvider);
        app.auth.getOAuthRegistry().registerSession({
          state: 'redir_ssrf_state',
          provider: 'google',
          collection: 'users',
        });

        const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'google',
            code: 'g_code',
            codeVerifier: 'g_verifier',
            state: 'redir_ssrf_state',
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.record.avatar).toBeFalsy();
        expect(requestedUrls).toEqual(['https://cdn.example.com/avatar-redirect.png']);
      } finally {
        spy.mockRestore();
      }
    });

    it('should download and save valid external avatar binaries through SsrfGuard.createGuardedFetch', async () => {
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xaa]);
      const mockFetch = (async () => {
        const ab = new ArrayBuffer(pngBytes.byteLength);
        new Uint8Array(ab).set(pngBytes);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'image/png; charset=binary' }),
          arrayBuffer: async () => ab,
          text: async () => '',
          json: async () => ({}),
        } as any;
      }) as any;

      const originalCreateGuardedFetch = SsrfGuard.createGuardedFetch.bind(SsrfGuard);
      const spy = vi
        .spyOn(SsrfGuard, 'createGuardedFetch')
        .mockImplementation(() => originalCreateGuardedFetch(undefined, 5000, mockFetch));

      try {
        const mockProvider = new MockOAuthProvider('google', 'Google', {
          id: 'g_valid_avatar',
          email: 'avatar_user@example.com',
          name: 'Avatar User',
          avatarUrl: 'https://cdn.example.com/avatars/alice.png',
          isEmailVerified: true,
          rawUser: { id: 'g_valid_avatar' },
        });
        app.auth.getOAuthRegistry().register(mockProvider);
        app.auth.getOAuthRegistry().registerSession({
          state: 'valid_avatar_state',
          provider: 'google',
          collection: 'users',
        });

        const res = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'google',
            code: 'g_code',
            codeVerifier: 'g_verifier',
            state: 'valid_avatar_state',
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(spy).toHaveBeenCalled();
        expect(data.record.avatar).toMatch(/^avatar_google_[a-f0-9]+\.png$/);

        const usersCol = await app.schema.getCollectionOrThrow('users');
        const savedPath = app.files.getFilePath(usersCol.id, data.record.id, data.record.avatar);
        const savedBytes = fs.readFileSync(savedPath);
        expect(savedBytes.equals(pngBytes)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('11. BaseOAuthProvider State Generation, Cookie Binding & handleCallback CSRF Protection', () => {
    class ConcreteTestOAuthProvider extends BaseOAuthProvider {
      public mockProfile: OAuthProfile;
      constructor(config?: any, mockProfile?: OAuthProfile) {
        super({
          name: config?.name || 'test_oauth',
          displayName: config?.displayName || 'Test OAuth',
          clientId: config?.clientId || 'test_id',
          clientSecret: config?.clientSecret || 'test_secret',
          authUrl: config?.authUrl || 'https://auth.example.com/oauth/authorize',
          tokenUrl: config?.tokenUrl || 'https://auth.example.com/oauth/token',
          userinfoUrl: config?.userinfoUrl || 'https://auth.example.com/oauth/userinfo',
          scopes: ['read', 'email'],
          ...config,
        });
        this.mockProfile = mockProfile || {
          id: 'test_user_42',
          email: 'test42@example.com',
          isEmailVerified: true,
          rawUser: { id: 'test_user_42' },
        };
      }

      public override async exchangeCode(
        code: string,
        codeVerifier: string,
        redirectUri?: string
      ): Promise<OAuthExchangeResult> {
        if (code === 'invalid_exchange_code') {
          throw new Error('Code exchange rejected by IdP');
        }
        return {
          accessToken: `token_for_${code}_verified_with_${codeVerifier}`,
          profile: this.mockProfile,
        };
      }

      protected async fetchUserProfile(): Promise<OAuthProfile> {
        return this.mockProfile;
      }
    }

    it('should generate cryptographically random state parameter and PKCE challenge via getAuthorizationUrl', () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl('http://localhost:3000/callback');

      expect(auth.state).toBeDefined();
      expect(typeof auth.state).toBe('string');
      expect(auth.state.length).toBe(32); // 16 bytes hex

      expect(auth.codeVerifier).toBeDefined();
      expect(auth.codeVerifier.length).toBe(64); // 32 bytes hex

      expect(auth.codeChallenge).toBeDefined();
      expect(auth.codeChallenge.length).toBe(43); // sha256 base64url

      expect(auth.url).toContain('https://auth.example.com/oauth/authorize?');
      expect(auth.url).toContain(`state=${auth.state}`);
      expect(auth.url).toContain(`code_challenge=${auth.codeChallenge}`);
      expect(auth.url).toContain('code_challenge_method=S256');
      expect(auth.url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback');
    });

    it('should store state session server-side with 10-minute TTL in getAuthorizationUrl', () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl('http://localhost:3000/callback');

      const session = provider.getStateSession(auth.state);
      expect(session).toBeDefined();
      expect(session?.state).toBe(auth.state);
      expect(session?.provider).toBe('test_oauth');
      expect(session?.codeVerifier).toBe(auth.codeVerifier);
      expect(session?.codeChallenge).toBe(auth.codeChallenge);
      expect(session?.redirectUri).toBe('http://localhost:3000/callback');
      expect(session?.expiresAt).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
      expect(session?.expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000 + 1000);
    });

    it('should format an HTTP-only SameSite=Lax cookie in getAuthorizationUrl', () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl('http://localhost:3000/callback');

      expect(auth.cookieHeader).toBeDefined();
      expect(auth.cookieHeader).toContain(`oauth_state_test_oauth=${auth.state}`);
      expect(auth.cookieHeader).toContain('Path=/');
      expect(auth.cookieHeader).toContain('Max-Age=600');
      expect(auth.cookieHeader).toContain('SameSite=Lax');
      expect(auth.cookieHeader).toContain('HttpOnly');

      expect(auth.cookie.name).toBe('oauth_state_test_oauth');
      expect(auth.cookie.value).toBe(auth.state);
      expect(auth.cookie.options.httpOnly).toBe(true);
      expect(auth.cookie.options.sameSite).toBe('lax');
    });

    it('should support string coercion on AuthorizationUrlResult', () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl();

      expect(String(auth)).toBe(auth.url);
      expect(`${auth}`).toBe(auth.url);
      expect(auth + '').toBe(auth.url);
    });

    it('should reject handleCallback when authorization code is missing', async () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl();

      await expect(
        provider.handleCallback({
          code: '',
          state: auth.state,
          codeVerifier: auth.codeVerifier,
        })
      ).rejects.toThrow(/missing authorization code/i);
    });

    it('should reject handleCallback when state parameter is missing (CSRF protection)', async () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl();

      await expect(
        provider.handleCallback({
          code: 'valid_code',
          state: '', // missing
          codeVerifier: auth.codeVerifier,
        })
      ).rejects.toThrow(/missing state parameter/i);
    });

    it('should reject handleCallback when state is forged or invalid (CSRF attack prevented)', async () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl();

      await expect(
        provider.handleCallback({
          code: 'valid_code',
          state: 'attacker_forged_state_parameter_123',
          codeVerifier: auth.codeVerifier,
        })
      ).rejects.toThrow(/Invalid or expired OAuth state parameter/i);
    });

    it('should reject handleCallback when state parameter has expired', async () => {
      const provider = new ConcreteTestOAuthProvider();
      const state = 'expired_prov_state_123';
      provider.saveStateSession({
        state,
        provider: 'test_oauth',
        codeChallenge: '',
        expiresAt: Date.now() - 5000, // Expired
        createdAt: Date.now() - 600000,
      });

      await expect(
        provider.handleCallback({
          code: 'valid_code',
          state,
        })
      ).rejects.toThrow(/expired/i);
    });

    it('should reject handleCallback when state provider does not match the provider', async () => {
      const provider = new ConcreteTestOAuthProvider({ name: 'github' });
      const state = 'mismatched_prov_state_123';
      provider.saveStateSession({
        state,
        provider: 'google', // Mismatched
        codeChallenge: '',
        expiresAt: Date.now() + 60000,
        createdAt: Date.now(),
      });

      await expect(
        provider.handleCallback({
          code: 'valid_code',
          state,
        })
      ).rejects.toThrow(/OAuth state provider mismatch/i);
    });

    it('should reject handleCallback when redirect_uri does not match session redirect_uri', async () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl('http://localhost:3000/callback');

      await expect(
        provider.handleCallback({
          code: 'valid_code',
          state: auth.state,
          codeVerifier: auth.codeVerifier,
          redirectUri: 'http://evil.com/callback',
        })
      ).rejects.toThrow(/OAuth state redirect_uri mismatch/i);
    });

    it('should reject handleCallback when PKCE code_verifier does not match challenge', async () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl();

      await expect(
        provider.handleCallback({
          code: 'valid_code',
          state: auth.state,
          codeVerifier: 'attacker_wrong_verifier_payload',
        })
      ).rejects.toThrow(/PKCE code_verifier does not match/i);
    });

    it('should reject handleCallback when session cookie does not match state (CSRF detected)', async () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl();

      // Attacker tries to inject state into victim who has a different cookie
      await expect(
        provider.handleCallback({
          code: 'valid_code',
          state: auth.state,
          codeVerifier: auth.codeVerifier,
          cookieState: 'victim_different_cookie_state_987',
        })
      ).rejects.toThrow(/does not match session cookie: potential CSRF attack detected/i);
    });

    it('should prevent replay attacks by consuming state session immediately on first handleCallback', async () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl();

      // 1. First exchange: successful and consumes state
      const result = await provider.handleCallback({
        code: 'one_time_code_1',
        state: auth.state,
        codeVerifier: auth.codeVerifier,
      });
      expect(result.accessToken).toContain('one_time_code_1');

      // 2. Replay attempt with same state must fail
      await expect(
        provider.handleCallback({
          code: 'one_time_code_2',
          state: auth.state,
          codeVerifier: auth.codeVerifier,
        })
      ).rejects.toThrow(/Invalid or expired OAuth state parameter/i);
    });

    it('should successfully verify state and cookie, consume state, and exchange code', async () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl('http://localhost:3000/callback');

      const result = await provider.handleCallback(
        'valid_code_123',
        auth.state,
        auth.codeVerifier,
        'http://localhost:3000/callback',
        auth.state // Matching cookie state
      );

      expect(result.accessToken).toBe(`token_for_valid_code_123_verified_with_${auth.codeVerifier}`);
      expect(result.profile.email).toBe('test42@example.com');
      // State consumed from store
      expect(provider.getStateSession(auth.state)).toBeUndefined();
    });

    it('should support request-like object (req.query and req.headers.cookie) in handleCallback', async () => {
      const provider = new ConcreteTestOAuthProvider();
      const auth = provider.getAuthorizationUrl('http://localhost:3000/callback');

      const mockReq = {
        query: {
          code: 'req_code_456',
          state: auth.state,
          codeVerifier: auth.codeVerifier,
          redirectUri: 'http://localhost:3000/callback',
        },
        headers: {
          cookie: `session_id=abc; oauth_state_test_oauth=${auth.state}; other=1`,
        },
      };

      const result = await provider.handleCallback(mockReq);
      expect(result.accessToken).toBe(`token_for_req_code_456_verified_with_${auth.codeVerifier}`);
      expect(result.profile.id).toBe('test_user_42');
    });

    it('should inherit getAuthorizationUrl and handleCallback on GoogleProvider with custom params', async () => {
      const google = new GoogleProvider({
        clientId: 'google_client_id_test',
        clientSecret: 'google_client_secret_test',
      });

      const auth = google.getAuthorizationUrl('http://localhost:3000/callback');
      expect(auth.url).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
      expect(auth.url).toContain('&access_type=offline&prompt=consent');
      expect(auth.cookieHeader).toContain('oauth_state_google=');
      expect(google.getStateSession(auth.state)).toBeDefined();
    });

    it('should set Set-Cookie in auth-methods and reject state-cookie mismatch in auth-with-oauth2', async () => {
      const mockProvider = new MockOAuthProvider('google', 'Google', {
        id: 'g_cookie_test',
        email: 'cookie@google.com',
        isEmailVerified: true,
        rawUser: { id: 'g_cookie_test' },
      });
      app.auth.getOAuthRegistry().register(mockProvider);

      // 1. GET auth-methods sets Set-Cookie
      const resMethods = await fetch(`${serverUrl}/api/collections/users/auth-methods`);
      expect(resMethods.status).toBe(200);
      const setCookieHeader = resMethods.headers.get('set-cookie');
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader).toContain('oauth_state_google=');
      expect(setCookieHeader).toContain('HttpOnly');

      const methodsData = await resMethods.json();
      const googleMethod = methodsData.authProviders.find((p: any) => p.name === 'google');
      expect(googleMethod).toBeDefined();

      // 2. Attacker CSRF attempt: forged state sent with a mismatched cookie
      const resCsrf = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'oauth_state_google=legitimate_user_cookie_state_999',
        },
        body: JSON.stringify({
          provider: 'google',
          code: 'valid_code',
          codeVerifier: googleMethod.codeVerifier,
          state: googleMethod.state, // Server state doesn't match cookie state!
        }),
      });

      expect(resCsrf.status).toBe(400);
      const csrfData = await resCsrf.json();
      expect(csrfData.message).toContain('session cookie does not match state parameter');

      // 3. Legitimate request: cookie matches state
      const resValid = await fetch(`${serverUrl}/api/collections/users/auth-with-oauth2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `oauth_state_google=${googleMethod.state}`,
        },
        body: JSON.stringify({
          provider: 'google',
          code: 'valid_code',
          codeVerifier: googleMethod.codeVerifier,
          state: googleMethod.state,
        }),
      });

      expect(resValid.status).toBe(200);
      const validData = await resValid.json();
      expect(validData.token).toBeDefined();
      expect(validData.record.email).toBe('cookie@google.com');
    });

    it('should isolate OAuth state transactions between different app scopes', () => {
      const mockProviderA = new ConcreteTestOAuthProvider({ name: 'google' });
      const mockProviderB = new ConcreteTestOAuthProvider({ name: 'google' });

      const registryA = new (app.auth.getOAuthRegistry().constructor as any)(undefined, 'app_alpha');
      registryA.register(mockProviderA);

      const registryB = new (app.auth.getOAuthRegistry().constructor as any)(undefined, 'app_beta');
      registryB.register(mockProviderB);

      // App A lists auth methods and creates a state bound to app_alpha
      const methodsA = registryA.listAuthMethods('http://localhost:3000/callback', 'users');
      expect(methodsA.length).toBe(1);
      const stateA = methodsA[0].state;
      const verifierA = methodsA[0].codeVerifier;

      // Attacker tries to consume stateA in App B
      expect(() => {
        registryB.validateAndConsumeState(stateA, 'google', 'users', verifierA);
      }).toThrow(/Invalid or expired OAuth state parameter/i);

      // State remains valid and consumable only within App A
      const sessionA = registryA.validateAndConsumeState(stateA, 'google', 'users', verifierA);
      expect(sessionA.appId).toBe('app_alpha');
      expect(sessionA.state).toBe(stateA);
    });

    it('should reject validateAndConsumeState when session appId does not match request appId', () => {
      const registry = new (app.auth.getOAuthRegistry().constructor as any)(undefined, 'app_shop');
      registry.registerSession({
        state: 'app_mismatch_state_123',
        provider: 'google',
        collection: 'users',
        appId: 'app_admin', // Bound to a different app
      });

      expect(() => {
        registry.validateAndConsumeState('app_mismatch_state_123', 'google', 'users', undefined, undefined, 'app_shop');
      }).toThrow(/OAuth state app mismatch: expected 'app_admin', got 'app_shop'/i);
    });

    it('should reject global session fallback when global session has mismatched or missing appId', () => {
      const registry = new (app.auth.getOAuthRegistry().constructor as any)(undefined, 'app_finance');

      // Global session without appId
      BaseOAuthProvider.saveGlobalStateSession({
        state: 'global_state_no_app',
        provider: 'google',
        collection: 'users',
        codeChallenge: '',
        expiresAt: Date.now() + 60000,
        createdAt: Date.now(),
      });

      expect(() => {
        registry.validateAndConsumeState('global_state_no_app', 'google', 'users');
      }).toThrow(/Invalid or expired OAuth state parameter/i);

      // Global session with mismatched appId
      BaseOAuthProvider.saveGlobalStateSession({
        state: 'global_state_wrong_app',
        provider: 'google',
        collection: 'users',
        appId: 'app_marketing',
        codeChallenge: '',
        expiresAt: Date.now() + 60000,
        createdAt: Date.now(),
      });

      expect(() => {
        registry.validateAndConsumeState('global_state_wrong_app', 'google', 'users');
      }).toThrow(/Invalid or expired OAuth state parameter/i);
    });

    it('should format and isolate app-scoped cookie names', () => {
      const cookieShop = BaseOAuthProvider.createStateCookie('state_shop_123', undefined, 'google', 'shop');
      expect(cookieShop.name).toBe('oauth_state_shop_google');

      const cookieBlog = BaseOAuthProvider.createStateCookie('state_blog_456', undefined, 'google', 'blog');
      expect(cookieBlog.name).toBe('oauth_state_blog_google');

      const cookieDefault = BaseOAuthProvider.createStateCookie('state_def_789', undefined, 'google', 'default');
      expect(cookieDefault.name).toBe('oauth_state_google');
    });
  });
});
