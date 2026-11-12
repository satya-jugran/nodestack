import * as crypto from 'crypto';

/**
 * Compute a hex-encoded SHA-256 digest of a plaintext secret.
 */
export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
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
 * Verify a plaintext secret against its expected hex-encoded SHA-256 hash
 * using constant-time comparison.
 */
export function verifySecret(
  expectedHash: string | undefined | null,
  providedSecret: string | undefined | null
): boolean {
  if (!expectedHash || !providedSecret) {
    return false;
  }
  const providedHash = hashSecret(providedSecret);
  return timingSafeEqualStrings(expectedHash, providedHash, 'hex');
}
