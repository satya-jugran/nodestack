import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../src/core/config/ConfigService';
import { DatabaseService } from '../src/database/DatabaseService';
import { SchemaService } from '../src/schema/SchemaService';
import { AuthService } from '../src/auth/AuthService';
import { RecordService } from '../src/records/RecordService';
import { EventBus } from '../src/core/events/EventBus';

describe('Sprint 3 Performance & Architecture Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_performance_data');
  let config: ConfigService;
  let db: DatabaseService;
  let schema: SchemaService;
  let authService: AuthService;
  let eventBus: EventBus;
  let recordService: RecordService;

  beforeEach(async () => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
    fs.mkdirSync(testDir, { recursive: true });

    config = new ConfigService({ dataDir: testDir, jwtSecret: 'perf_test_secret_32_bytes_long!!' });
    db = new DatabaseService(config);
    db.init();

    schema = new SchemaService(db);

    eventBus = new EventBus();
    authService = new AuthService(db, config, schema, undefined, undefined, undefined, eventBus);
    recordService = new RecordService(db, schema, undefined, eventBus);

    // Update 'users' collection with custom fields if needed
    const usersCol = schema.getCollectionOrThrow('users');
    const existingFieldNames = new Set(usersCol.schema.map((f) => f.name));
    if (!existingFieldNames.has('name')) {
      usersCol.schema.push({ name: 'name', type: 'text', required: false });
    }
    if (!existingFieldNames.has('role')) {
      usersCol.schema.push({ name: 'role', type: 'text', required: false });
    }
    schema.updateCollection('users', usersCol);
  });

  afterEach(() => {
    if (db && db.isOpen()) {
      db.close();
    }
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('1. AuthService TokenKey LRU Cache with TTL & Event-Driven Invalidation', () => {
    it('should cache tokenKey on verifyToken and invalidate on session revocation', async () => {
      // 1. Create a user
      const user = await recordService.create(
        'users',
        {
          email: 'alice@example.com',
          password: 'Password123!',
          name: 'Alice',
          emailVisibility: true,
        },
        undefined
      );

      // Authenticate to obtain valid token with tokenKey claim
      const authResult = await authService.authenticateRecord('users', 'alice@example.com', 'Password123!');
      const token = authResult.token;

      // Verify token initial call (populates cache)
      const verified = authService.verifyToken(token);
      expect(verified.id).toBe(user.id);
      const cachedTokenKey = authService.getCachedTokenKey(`users:${user.id}`);
      expect(cachedTokenKey).toBeDefined();
      expect(typeof cachedTokenKey).toBe('string');

      // Verify token subsequently hits cache
      const cachedVerify = authService.verifyToken(token);
      expect(cachedVerify.id).toBe(user.id);

      // Revoke user sessions
      authService.revokeRecordSessions('users', user.id);

      // Cache should be invalidated immediately
      expect(authService.getCachedTokenKey(`users:${user.id}`)).toBeNull();

      // Subsequent verifyToken with old token must now throw UnauthorizedError
      expect(() => authService.verifyToken(token)).toThrow(/revoked or expired/);
    });

    it('should invalidate tokenKey cache when user record is updated or deleted via EventBus', async () => {
      const user = await recordService.create(
        'users',
        {
          email: 'bob@example.com',
          password: 'Password123!',
          name: 'Bob',
          emailVisibility: true,
        },
        undefined
      );

      const authResult = await authService.authenticateRecord('users', 'bob@example.com', 'Password123!');
      const token = authResult.token;

      authService.verifyToken(token);
      expect(authService.getCachedTokenKey(`users:${user.id}`)).toBeDefined();

      // Update user name (triggers record.afterUpdate)
      await recordService.update('users', user.id, { name: 'Bob Updated' }, { id: user.id, collection: 'users' });

      // EventBus listener should have cleared the cached tokenKey
      expect(authService.getCachedTokenKey(`users:${user.id}`)).toBeNull();
    });
  });

  describe('2. Non-blocking Asynchronous Password Hashing in importRecords', () => {
    it('should asynchronously hash passwords for auth collection imports in batches', async () => {
      const usersToImport = [
        { email: 'u1@test.com', password: 'SecretPassword1!', name: 'User 1' },
        { email: 'u2@test.com', password: 'SecretPassword2!', name: 'User 2' },
        { email: 'u3@test.com', password: 'SecretPassword3!', name: 'User 3' },
      ];

      const result = await recordService.importRecords('users', usersToImport);
      expect(result.success).toBe(true);
      expect(result.imported).toBe(3);

      const dbUser = db.get<any>('SELECT * FROM "users" WHERE email = ?', ['u1@test.com']);
      expect(dbUser).toBeDefined();
      expect(dbUser.passwordHash).toBeDefined();
      expect(dbUser.passwordHash).toMatch(/^\$2[aby]\$/); // Valid bcrypt hash
      expect(dbUser.tokenKey).toBeDefined();

      const validPass = await authService.verifyPassword('SecretPassword1!', dbUser.passwordHash);
      expect(validPass).toBe(true);
    });
  });

  describe('3. Memory-Efficient Chunked exportRecords', () => {
    it('should export records in chunked batches without promise explosion for CSV and JSON', async () => {
      const adminAuth = { isAdmin: true };

      // Create 15 records
      for (let i = 1; i <= 15; i++) {
        await recordService.create(
          'users',
          {
            email: `bulk_${i}@test.com`,
            password: `pass_${i}_test!`,
            name: `Bulk User ${i}`,
            emailVisibility: true,
          },
          adminAuth
        );
      }

      // Test CSV Export
      const csvExport = await recordService.exportRecords('users', 'csv', {}, adminAuth);
      expect(csvExport.mimeType).toBe('text/csv; charset=utf-8');
      expect(csvExport.data).toContain('id,email,verified,emailVisibility');
      expect(csvExport.data).toContain('bulk_1@test.com');
      expect(csvExport.data).toContain('bulk_15@test.com');

      // Test JSON Export
      const jsonExport = await recordService.exportRecords('users', 'json', {}, adminAuth);
      expect(jsonExport.mimeType).toBe('application/json; charset=utf-8');
      const parsed = JSON.parse(jsonExport.data);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(15);
      expect(parsed[0].passwordHash).toBeUndefined(); // Sanitized!
      expect(parsed[0].tokenKey).toBeUndefined(); // Sanitized!
    });
  });
});
