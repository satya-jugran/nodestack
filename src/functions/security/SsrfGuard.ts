import * as dns from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);

export class SsrfGuardError extends Error {
  constructor(message: string) {
    super(`[SsrfGuard] ${message}`);
    this.name = 'SsrfGuardError';
  }
}

export class SsrfGuard {
  private static readonly BLOCKED_IP_PATTERNS = [
    /^127\./,                         // 127.0.0.0/8 Loopback
    /^10\./,                          // 10.0.0.0/8 Private
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 Private
    /^192\.168\./,                    // 192.168.0.0/16 Private
    /^169\.254\./,                    // 169.254.0.0/16 Link-local / Cloud Metadata
    /^0\./,                           // 0.0.0.0/8
    /^::1$/,                          // IPv6 Loopback
    /^fc00:/i,                        // IPv6 Unique Local
    /^fe80:/i,                        // IPv6 Link-local
    /^::ffff:127\./i,                 // IPv4-mapped IPv6 loopback
    /^::ffff:10\./i,                  // IPv4-mapped IPv6
    /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./i,
    /^::ffff:192\.168\./i,
    /^::ffff:169\.254\./i,
  ];

  private static readonly BLOCKED_HOSTNAMES = [
    'localhost',
    'metadata.google.internal',
    'instance-data',
  ];

  /**
   * Validates if a hostname matches the configured domain allowlist.
   * If allowlist is empty or undefined, any public domain is permitted.
   */
  public static isAllowedDomain(hostname: string, allowedDomains?: string[]): boolean {
    if (!allowedDomains || allowedDomains.length === 0) {
      return true;
    }

    const host = hostname.toLowerCase();
    for (const pattern of allowedDomains) {
      const cleanPattern = pattern.trim().toLowerCase();
      if (!cleanPattern) continue;

      if (cleanPattern === host) {
        return true;
      }
      if (cleanPattern.startsWith('*.') && host.endsWith(cleanPattern.slice(2))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validates whether an IP address belongs to private, loopback, or cloud metadata ranges.
   */
  public static isPrivateIp(ip: string): boolean {
    for (const pattern of SsrfGuard.BLOCKED_IP_PATTERNS) {
      if (pattern.test(ip)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Parses and validates a URL for SSRF protection:
   * 1. Protocol must be http: or https:
   * 2. Hostname must not be in blocked names list (localhost, etc.)
   * 3. Domain must match allowlist if configured
   * 4. DNS resolution must not resolve to any private/internal IP
   */
  public static async validateUrl(rawUrl: string, allowedDomains?: string[]): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new SsrfGuardError(`Invalid URL: ${rawUrl}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new SsrfGuardError(`Forbidden protocol '${parsed.protocol}'. Only http: and https: are allowed.`);
    }

    const hostname = parsed.hostname.toLowerCase();

    if (SsrfGuard.BLOCKED_HOSTNAMES.includes(hostname)) {
      throw new SsrfGuardError(`Host '${hostname}' is prohibited`);
    }

    if (!SsrfGuard.isAllowedDomain(hostname, allowedDomains)) {
      throw new SsrfGuardError(`Host '${hostname}' is not in the allowed domains whitelist`);
    }

    // Direct IP check if hostname is already an IP literal
    if (SsrfGuard.isPrivateIp(hostname)) {
      throw new SsrfGuardError(`Direct access to private or metadata IP '${hostname}' is prohibited`);
    }

    // Resolve DNS to verify the target IP is public
    try {
      const lookupResult = await dnsLookup(hostname, { all: true });
      for (const entry of lookupResult) {
        if (SsrfGuard.isPrivateIp(entry.address)) {
          throw new SsrfGuardError(
            `Host '${hostname}' resolves to private/prohibited IP '${entry.address}'`
          );
        }
      }
    } catch (err: any) {
      if (err instanceof SsrfGuardError) throw err;
      throw new SsrfGuardError(`Failed to resolve host '${hostname}': ${err.message}`);
    }

    return parsed;
  }

  /**
   * Creates a hardened fetch function wrapper with SSRF validation,
   * execution timeout, and standardized Response representation.
   */
  public static createGuardedFetch(
    allowedDomains?: string[],
    timeoutMs = 10000,
    customFetch?: typeof fetch
  ) {
    const baseFetch = customFetch || globalThis.fetch;

    return async (url: string, init?: any) => {
      await SsrfGuard.validateUrl(url, allowedDomains);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await baseFetch(url, {
          ...(init || {}),
          signal: controller.signal,
        });

        // Collect headers into a plain Record
        const headers: Record<string, string> = {};
        if (response.headers && typeof response.headers.forEach === 'function') {
          response.headers.forEach((val, key) => {
            headers[key.toLowerCase()] = val;
          });
        }

        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers,
          json: async () => response.json(),
          text: async () => response.text(),
        };
      } finally {
        clearTimeout(timer);
      }
    };
  }
}
