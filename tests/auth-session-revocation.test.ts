import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { UnauthorizedError } from '../src/core/errors/AppError';

describe('Auth Token Revocation & Password Reset Session Invalidation', () => {
  const testDir = path.resolve(__dirname, '../.test_auth_revocation_data');
  let app: NodeStack;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    app = new NodeStack({
      dataDir: testDir,
      port: 8133,
    });
    await app.start();
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should invalidate existing admin JWTs immediately upon password reset', async () => {
    // 1. Create admin and authenticate
    await app.auth.createAdmin('security@nodestack.io', 'OldPassword123!');
    const auth1 = await app.auth.authenticateAdmin('security@nodestack.io', 'OldPassword123!');
    const token1 = auth1.token;

    // 2. verifyToken succeeds with token1
    const claims1 = app.auth.verifyToken(token1);
    expect(claims1.email).toBe('security@nodestack.io');
    expect(claims1.isAdmin).toBe(true);

    // 3. Make HTTP request with token1 - should succeed (200)
    const res1 = await fetch('http://127.0.0.1:8133/api/admins/me', {
      headers: { authorization: `Bearer ${token1}` },
    });
    expect(res1.status).toBe(200);

    // 4. Reset admin password (rotates tokenKey in _admins table)
    await app.auth.updateAdminPassword('security@nodestack.io', 'NewSecretPassword456!');

    // 5. verifyToken with token1 MUST now throw UnauthorizedError
    expect(() => app.auth.verifyToken(token1)).toThrow(UnauthorizedError);

    // 6. HTTP request with old token1 MUST now be rejected (401/403)
    const resOld = await fetch('http://127.0.0.1:8133/api/admins/me', {
      headers: { authorization: `Bearer ${token1}` },
    });
    expect(resOld.status).toBe(401);

    // 7. Old password authentication fails
    await expect(
      app.auth.authenticateAdmin('security@nodestack.io', 'OldPassword123!')
    ).rejects.toThrow(UnauthorizedError);

    // 8. New password authentication succeeds and produces new valid token2
    const auth2 = await app.auth.authenticateAdmin('security@nodestack.io', 'NewSecretPassword456!');
    const token2 = auth2.token;
    expect(token2).toBeDefined();
    expect(token2).not.toBe(token1);

    const claims2 = app.auth.verifyToken(token2);
    expect(claims2.email).toBe('security@nodestack.io');

    const res2 = await fetch('http://127.0.0.1:8133/api/admins/me', {
      headers: { authorization: `Bearer ${token2}` },
    });
    expect(res2.status).toBe(200);

    // 9. Explicit session revocation via revokeAdminSessions rotates tokenKey
    app.auth.revokeAdminSessions('security@nodestack.io');
    expect(() => app.auth.verifyToken(token2)).toThrow(UnauthorizedError);

    const resRevoked = await fetch('http://127.0.0.1:8133/api/admins/me', {
      headers: { authorization: `Bearer ${token2}` },
    });
    expect(resRevoked.status).toBe(401);
  });

  it('should invalidate existing user collection JWTs immediately upon password change', async () => {
    // 1. Create a user in auth collection
    const user = await app.records.create('users', {
      email: 'member@nodestack.io',
      password: 'UserPassword123!',
    });

    const userAuth1 = await app.auth.authenticateRecord('users', 'member@nodestack.io', 'UserPassword123!');
    const userToken1 = userAuth1.token;

    // verifyToken succeeds
    const userClaims1 = app.auth.verifyToken(userToken1);
    expect(userClaims1.email).toBe('member@nodestack.io');
    expect(userClaims1.isAdmin).toBe(false);

    // 2. Update user's password in the record (passing authenticated user claims)
    await app.records.update('users', user.id, {
      password: 'UpdatedPassword789!',
    }, userClaims1);

    // 3. Old user token MUST now be revoked
    expect(() => app.auth.verifyToken(userToken1)).toThrow(UnauthorizedError);

    // 4. Authenticate with new password
    const userAuth2 = await app.auth.authenticateRecord('users', 'member@nodestack.io', 'UpdatedPassword789!');
    const userToken2 = userAuth2.token;
    expect(userToken2).toBeDefined();
    expect(app.auth.verifyToken(userToken2).email).toBe('member@nodestack.io');

    // 5. Explicit user session revocation
    app.auth.revokeRecordSessions('users', user.id);
    expect(() => app.auth.verifyToken(userToken2)).toThrow(UnauthorizedError);
  });
});
