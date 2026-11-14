import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { hashSecret, hmacSecret, timingSafeEqualStrings, verifySecret, loadOrCreateSecret } from '../src/core/crypto/secret';
import { ConfigService } from '../src/core/config/ConfigService';

describe('core/crypto/secret', () => {
  describe('hashSecret', () => {
    it('returns deterministic lowercase hex SHA-256 digest', () => {
      const expected = crypto.createHash('sha256').update('my-secret-token').digest('hex');
      expect(hashSecret('my-secret-token')).toBe(expected);
      expect(hashSecret('my-secret-token')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns HMAC-SHA256 digest when key is provided', () => {
      const serverKey = 'my-server-secret-key-123';
      const expected = crypto.createHmac('sha256', serverKey).update('my-secret-token').digest('hex');
      const plainExpected = crypto.createHash('sha256').update('my-secret-token').digest('hex');

      expect(hashSecret('my-secret-token', serverKey)).toBe(expected);
      expect(hashSecret('my-secret-token', serverKey)).not.toBe(plainExpected);
      expect(hashSecret('my-secret-token', serverKey)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('does not silently fall back to plain SHA-256 when an empty string key is provided', () => {
      const secret = 'my-secret-token';
      const plainSha256 = crypto.createHash('sha256').update(secret).digest('hex');
      const hmacEmptyKey = crypto.createHmac('sha256', '').update(secret).digest('hex');

      expect(hashSecret(secret, '')).toBe(hmacEmptyKey);
      expect(hashSecret(secret, '')).not.toBe(plainSha256);
    });
  });

  describe('hmacSecret', () => {
    it('returns deterministic hex HMAC-SHA256 digest keyed with server key', () => {
      const serverKey = 'server-master-secret';
      const token = 'nsk_live_sample_token';
      const expected = crypto.createHmac('sha256', serverKey).update(token).digest('hex');

      expect(hmacSecret(token, serverKey)).toBe(expected);
      expect(hmacSecret(token, serverKey)).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('timingSafeEqualStrings', () => {
    it('returns true for identical hex strings and false when different', () => {
      const a = hashSecret('alpha');
      const b = hashSecret('alpha');
      const c = hashSecret('beta');

      expect(timingSafeEqualStrings(a, b, 'hex')).toBe(true);
      expect(timingSafeEqualStrings(a, c, 'hex')).toBe(false);
    });

    it('rejects empty, null, undefined, and mismatched length inputs', () => {
      const hash = hashSecret('alpha');
      expect(timingSafeEqualStrings('', '', 'hex')).toBe(false);
      expect(timingSafeEqualStrings(null, hash, 'hex')).toBe(false);
      expect(timingSafeEqualStrings(hash, undefined, 'hex')).toBe(false);
      expect(timingSafeEqualStrings('abcd', 'abcdef', 'hex')).toBe(false);
    });

    it('rejects non-hex or truncated hex strings rather than comparing empty buffers', () => {
      expect(timingSafeEqualStrings('zzzz', 'zzzz', 'hex')).toBe(false);
      expect(timingSafeEqualStrings('abzz', 'abzz', 'hex')).toBe(false);
      expect(timingSafeEqualStrings('abc', 'abc', 'hex')).toBe(false);
    });

    it('supports utf8 comparison for signatures and plain encoded strings', () => {
      expect(timingSafeEqualStrings('sig=deadbeef', 'sig=deadbeef', 'utf8')).toBe(true);
      expect(timingSafeEqualStrings('sig=deadbeef', 'sig=deadbeee', 'utf8')).toBe(false);
      expect(timingSafeEqualStrings('short', 'longer', 'utf8')).toBe(false);
    });
  });

  describe('verifySecret', () => {
    it('verifies matching plaintext secret against its SHA-256 hash', () => {
      const secret = 'ns_live_super_secret_value';
      const expectedHash = hashSecret(secret);

      expect(verifySecret(expectedHash, secret)).toBe(true);
      expect(verifySecret(expectedHash, 'wrong-secret')).toBe(false);
    });

    it('verifies matching secret against its HMAC-SHA256 hash when key is provided', () => {
      const secret = 'nsk_live_token_12345';
      const serverSecret = 'instance_secret_key_999';
      const hmacHash = hashSecret(secret, serverSecret);

      expect(verifySecret(hmacHash, secret, serverSecret)).toBe(true);
      expect(verifySecret(hmacHash, secret, 'wrong-server-secret')).toBe(false);
      expect(verifySecret(hmacHash, 'wrong-token', serverSecret)).toBe(false);
    });

    it('does not silently fall back to plain SHA-256 when an empty string key is provided', () => {
      const secret = 'nsk_live_token_empty_key';
      const plainHash = hashSecret(secret); // unsalted SHA-256
      const hmacEmptyKeyHash = hashSecret(secret, ''); // HMAC with empty key

      expect(verifySecret(hmacEmptyKeyHash, secret, '')).toBe(true);
      expect(verifySecret(plainHash, secret, '')).toBe(false);
    });

    it('returns false for missing or malformed hashes', () => {
      const validHash = hashSecret('secret');
      expect(verifySecret(undefined, 'secret')).toBe(false);
      expect(verifySecret(null, 'secret')).toBe(false);
      expect(verifySecret('', 'secret')).toBe(false);
      expect(verifySecret(validHash, '')).toBe(false);
      expect(verifySecret(validHash, undefined)).toBe(false);
      expect(verifySecret('not-a-valid-hex-hash', 'secret')).toBe(false);
    });
  });

  describe('loadOrCreateSecret', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodestack-secret-test-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // cleanup best-effort
      }
    });

    it('creates a new 32-byte (64 hex char) secret file when none exists', () => {
      const secretFile = path.join(tempDir, '.secret');
      expect(fs.existsSync(secretFile)).toBe(false);

      const secret = loadOrCreateSecret(secretFile);
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(fs.existsSync(secretFile)).toBe(true);

      const fileContent = fs.readFileSync(secretFile, 'utf-8');
      expect(fileContent.trim()).toBe(secret);
    });

    it('creates nested directories automatically if parent does not exist', () => {
      const secretFile = path.join(tempDir, 'nested', 'deep', '.secret');
      const secret = loadOrCreateSecret(secretFile);

      expect(fs.existsSync(secretFile)).toBe(true);
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
    });

    it('loads existing secret without regenerating or overwriting', () => {
      const secretFile = path.join(tempDir, '.secret');
      const firstSecret = loadOrCreateSecret(secretFile);
      const secondSecret = loadOrCreateSecret(secretFile);

      expect(secondSecret).toBe(firstSecret);
      expect(fs.readFileSync(secretFile, 'utf-8').trim()).toBe(firstSecret);
    });

    it('reads pre-existing secret file and trims whitespace', () => {
      const secretFile = path.join(tempDir, '.secret');
      const customSecret = 'my-custom-preconfigured-secret-key-12345';
      fs.writeFileSync(secretFile, `  ${customSecret}\n\n`, 'utf-8');

      const loaded = loadOrCreateSecret(secretFile);
      expect(loaded).toBe(customSecret);
    });

    it('prevents TOCTOU race: concurrent worker calls all receive the same secret', async () => {
      const secretFile = path.join(tempDir, '.secret');
      const workerCount = 10;

      // Simulate 10 workers concurrently calling loadOrCreateSecret simultaneously
      const results = await Promise.all(
        Array.from({ length: workerCount }, () =>
          new Promise<string>((resolve) => {
            // Slight tick jitter to simulate race condition
            setImmediate(() => {
              resolve(loadOrCreateSecret(secretFile));
            });
          })
        )
      );

      const winnerSecret = results[0];
      expect(winnerSecret).toMatch(/^[0-9a-f]{64}$/);

      // All workers must have received identical secret
      for (const res of results) {
        expect(res).toBe(winnerSecret);
      }

      // File on disk must match the winner's secret
      expect(fs.readFileSync(secretFile, 'utf-8').trim()).toBe(winnerSecret);
    });

    it('integrates seamlessly with ConfigService without duplicate secrets across instances', () => {
      const dataDir = path.join(tempDir, 'data');
      const config1 = new ConfigService({ dataDir });
      const config2 = new ConfigService({ dataDir });

      expect(config1.jwtSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(config2.jwtSecret).toBe(config1.jwtSecret);

      const persisted = fs.readFileSync(path.join(dataDir, '.secret'), 'utf-8').trim();
      expect(persisted).toBe(config1.jwtSecret);
    });
  });
});
