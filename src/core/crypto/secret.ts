import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Compute a hex-encoded SHA-256 digest of a plaintext secret, or HMAC-SHA256 digest if key is provided.
 */
export function hashSecret(secret: string, key?: string): string {
  if (key) {
    return crypto.createHmac('sha256', key).update(secret).digest('hex');
  }
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/**
 * Compute a hex-encoded HMAC-SHA256 digest of a plaintext secret using a server key.
 */
export function hmacSecret(secret: string, key: string): string {
  return crypto.createHmac('sha256', key).update(secret).digest('hex');
}

/**
 * Constant-time comparison of two encoded strings.
 * Rejects empty inputs, mismatched decoded lengths, and invalid hex strings.
 */
export function timingSafeEqualStrings(
  a: string | undefined | null,
  b: string | undefined | null,
  encoding: BufferEncoding = 'hex'
): boolean {
  if (!a || !b) {
    return false;
  }

  try {
    const bufA = Buffer.from(a, encoding);
    const bufB = Buffer.from(b, encoding);

    if (bufA.length === 0 || bufA.length !== bufB.length) {
      return false;
    }

    if (encoding === 'hex' && (bufA.length * 2 !== a.length || bufB.length * 2 !== b.length)) {
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Verify a plaintext secret against its expected hex-encoded SHA-256 or HMAC-SHA256 hash
 * using constant-time comparison.
 */
export function verifySecret(
  expectedHash: string | undefined | null,
  providedSecret: string | undefined | null,
  key?: string
): boolean {
  if (!expectedHash || !providedSecret) {
    return false;
  }
  const providedHash = hashSecret(providedSecret, key);
  return timingSafeEqualStrings(expectedHash, providedHash, 'hex');
}

/**
 * Atomically load an existing secret from disk or create and persist a new 32-byte hex secret.
 * Uses writeFileSync with { flag: 'wx', mode: 0o600 } to prevent TOCTOU race conditions
 * where concurrent worker processes might generate different secrets or overwrite each other.
 * If the file already exists (EEXIST), reads and returns the existing secret instead.
 */
export function loadOrCreateSecret(secretFilePath: string): string {
  const parentDir = path.dirname(secretFilePath);
  if (parentDir && !fs.existsSync(parentDir)) {
    try {
      fs.mkdirSync(parentDir, { recursive: true });
    } catch {
      // Directory may have been created concurrently
    }
  }

  const generatedSecret = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(secretFilePath, generatedSecret, { flag: 'wx', mode: 0o600, encoding: 'utf-8' });
    return generatedSecret;
  } catch (err: any) {
    if (err && err.code === 'EEXIST') {
      let content = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          content = fs.readFileSync(secretFilePath, 'utf-8').trim();
          if (content) {
            return content;
          }
        } catch (readErr: any) {
          if (attempt === 9) {
            throw readErr;
          }
        }
      }
      return content;
    }

    // If the file already exists but writing failed due to read-only permissions
    if (fs.existsSync(secretFilePath)) {
      try {
        return fs.readFileSync(secretFilePath, 'utf-8').trim();
      } catch {
        // Fall through to re-throw original error
      }
    }

    throw err;
  }
}

