import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { hashSecret, timingSafeEqualStrings, verifySecret } from '../src/core/crypto/secret';

describe('core/crypto/secret', () => {
  describe('hashSecret', () => {
    it('returns deterministic lowercase hex SHA-256 digest', () => {
      const expected = crypto.createHash('sha256').update('my-secret-token').digest('hex');
      expect(hashSecret('my-secret-token')).toBe(expected);
      expect(hashSecret('my-secret-token')).toMatch(/^[0-9a-f]{64}$/);
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
});
