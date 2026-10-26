/**
 * Lightweight, zero-dependency PKCE helper for browsers and Node.js environments.
 */
export class PkceUtil {
  public static generateVerifier(length = 64): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const clampedLength = Math.max(43, Math.min(128, length));
    const randomBytes = new Uint8Array(clampedLength);

    const g: any = typeof globalThis !== 'undefined' ? globalThis : {};
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(randomBytes);
    } else if (g.crypto && g.crypto.getRandomValues) {
      g.crypto.getRandomValues(randomBytes);
    } else {
      let filled = false;
      try {
        const req = g.require;
        if (typeof req === 'function') {
          req('crypto').randomFillSync(randomBytes);
          filled = true;
        }
      } catch {}

      if (!filled) {
        for (let i = 0; i < clampedLength; i++) {
          randomBytes[i] = Math.floor(Math.random() * 256);
        }
      }
    }

    let result = '';
    for (let i = 0; i < clampedLength; i++) {
      result += charset[randomBytes[i] % charset.length];
    }
    return result;
  }

  public static async generateChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);

    const g: any = typeof globalThis !== 'undefined' ? globalThis : {};
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const hash = await crypto.subtle.digest('SHA-256', data);
      return PkceUtil.base64UrlEncode(new Uint8Array(hash));
    } else if (g.crypto && g.crypto.subtle) {
      const hash = await g.crypto.subtle.digest('SHA-256', data);
      return PkceUtil.base64UrlEncode(new Uint8Array(hash));
    }

    try {
      const req = g.require;
      if (typeof req === 'function') {
        const hash = req('crypto').createHash('sha256').update(data).digest();
        return PkceUtil.base64UrlEncode(new Uint8Array(hash));
      }
    } catch {}

    throw new Error('Web Crypto API (crypto.subtle) is not available to compute SHA-256 code challenge.');
  }

  public static base64UrlEncode(bytes: Uint8Array): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let base64 = '';
    const byteLength = bytes.byteLength;
    const byteRemainder = byteLength % 3;
    const mainLength = byteLength - byteRemainder;

    let a: number, b: number, c: number, d: number;
    let chunk: number;

    for (let i = 0; i < mainLength; i += 3) {
      chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      a = (chunk & 16515072) >> 18;
      b = (chunk & 258048) >> 12;
      c = (chunk & 4032) >> 6;
      d = chunk & 63;
      base64 += chars[a] + chars[b] + chars[c] + chars[d];
    }

    if (byteRemainder === 1) {
      chunk = bytes[mainLength];
      a = (chunk & 252) >> 2;
      b = (chunk & 3) << 4;
      base64 += chars[a] + chars[b] + '==';
    } else if (byteRemainder === 2) {
      chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];
      a = (chunk & 64512) >> 10;
      b = (chunk & 1008) >> 4;
      c = (chunk & 15) << 2;
      base64 += chars[a] + chars[b] + chars[c] + '=';
    }

    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
