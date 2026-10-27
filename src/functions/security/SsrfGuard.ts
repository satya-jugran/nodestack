import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
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
    /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // 100.64.0.0/10 Carrier-grade NAT
    /^::1$/i,                         // IPv6 Loopback
    /^::$/i,                          // IPv6 Unspecified
    /^f[cd][0-9a-f]{2}:/i,            // IPv6 Unique Local Address (ULA) fc00::/7 (covers fc00::/8 and fd00::/8)
    /^fe[89ab][0-9a-f]:/i,            // IPv6 Link-Local fe80::/10 (fe80:: - febf::)
    /^::ffff:127\./i,                 // IPv4-mapped IPv6 loopback
    /^::ffff:10\./i,                  // IPv4-mapped IPv6
    /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./i,
    /^::ffff:192\.168\./i,
    /^::ffff:169\.254\./i,
    /^::ffff:0\./i,
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

    const host = (hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname).toLowerCase();

    for (const pattern of allowedDomains) {
      const cleanPattern = pattern.trim().toLowerCase();
      if (!cleanPattern) continue;

      if (cleanPattern === host) {
        return true;
      }
      if (cleanPattern.startsWith('*.')) {
        const suffix = cleanPattern.slice(2);
        if (host === suffix || host.endsWith('.' + suffix)) {
          return true;
        }
      } else if (cleanPattern.startsWith('.')) {
        const suffix = cleanPattern.slice(1);
        if (host === suffix || host.endsWith('.' + suffix)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Validates whether an IP address belongs to private, loopback, or cloud metadata ranges.
   */
  public static isPrivateIp(ip: string): boolean {
    let clean = ip.trim().toLowerCase();
    if (clean.startsWith('[') && clean.endsWith(']')) {
      clean = clean.slice(1, -1);
    }

    for (const pattern of SsrfGuard.BLOCKED_IP_PATTERNS) {
      if (pattern.test(clean)) {
        return true;
      }
    }

    // Comprehensive IPv4 octet check
    const v4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(clean);
    if (v4Match) {
      const [_, a, b, c, d] = v4Match.map(Number);
      if (a > 255 || b > 255 || c > 255 || d > 255) return true; // Malformed IPv4
      return SsrfGuard.isPrivateIpv4(a, b, c, d);
    }

    // Comprehensive IPv6 structure check (handles uncompressed zeros, ULA fc00::/7, link-local fe80::/10, etc.)
    const v6Blocks = SsrfGuard.parseIpv6(clean);
    if (v6Blocks) {
      // Loopback ::1
      if (v6Blocks.slice(0, 7).every((b) => b === 0) && v6Blocks[7] === 1) return true;
      // Unspecified ::
      if (v6Blocks.every((b) => b === 0)) return true;
      // Unique Local (ULA) fc00::/7 (covers fc00::/8 and fd00::/8, 0xfc00 - 0xfdff)
      if ((v6Blocks[0] & 0xfe00) === 0xfc00) return true;
      // Link-Local fe80::/10 (0xfe80 - 0xfebf)
      if ((v6Blocks[0] & 0xffc0) === 0xfe80) return true;
      // IPv4-mapped IPv6 ::ffff:0:0/96
      if (v6Blocks.slice(0, 5).every((b) => b === 0) && v6Blocks[5] === 0xffff) {
        const a = (v6Blocks[6] >> 8) & 0xff;
        const b = v6Blocks[6] & 0xff;
        const c = (v6Blocks[7] >> 8) & 0xff;
        const d = v6Blocks[7] & 0xff;
        return SsrfGuard.isPrivateIpv4(a, b, c, d);
      }
    }

    return false;
  }

  private static isPrivateIpv4(a: number, b: number, c: number, d: number): boolean {
    if (a === 127) return true; // 127.0.0.0/8 Loopback
    if (a === 10) return true;  // 10.0.0.0/8 Private
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 Private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 Private
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 Link-local / Cloud Metadata
    if (a === 0) return true; // 0.0.0.0/8 Current network
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 Carrier-grade NAT
    if (a >= 224) return true; // Multicast / Reserved / Broadcast (224.0.0.0/4 and above)
    return false;
  }

  private static parseIpv6(clean: string): number[] | null {
    if (!clean.includes(':')) return null;
    let normalized = clean;
    if (normalized.includes('.')) {
      const lastColon = normalized.lastIndexOf(':');
      const v4Part = normalized.slice(lastColon + 1);
      const v4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4Part);
      if (!v4Match) return null;
      const [_, a, b, c, d] = v4Match.map(Number);
      if (a > 255 || b > 255 || c > 255 || d > 255) return null;
      const hex1 = ((a << 8) | b).toString(16);
      const hex2 = ((c << 8) | d).toString(16);
      normalized = normalized.slice(0, lastColon) + ':' + hex1 + ':' + hex2;
    }
    const parts = normalized.split('::');
    if (parts.length > 2) return null;
    let blocks: string[] = [];
    if (parts.length === 2) {
      const left = parts[0] ? parts[0].split(':') : [];
      const right = parts[1] ? parts[1].split(':') : [];
      const missing = 8 - (left.length + right.length);
      if (missing < 0) return null;
      blocks = [...left, ...Array(missing).fill('0'), ...right];
    } else {
      blocks = parts[0].split(':');
    }
    if (blocks.length !== 8) return null;
    const nums: number[] = [];
    for (const b of blocks) {
      if (!/^[0-9a-f]{1,4}$/i.test(b)) return null;
      nums.push(parseInt(b, 16));
    }
    return nums;
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

    const rawHostname = parsed.hostname.toLowerCase();
    const hostname = rawHostname.startsWith('[') && rawHostname.endsWith(']')
      ? rawHostname.slice(1, -1)
      : rawHostname;

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
    let lookupResult: Array<{ address: string; family: number }>;
    try {
      lookupResult = await dnsLookup(hostname, { all: true });
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

    if (!lookupResult || lookupResult.length === 0) {
      throw new SsrfGuardError(`Failed to resolve host '${hostname}': No DNS records found`);
    }

    // Pin the validated resolution onto the URL object to defeat DNS-rebinding attacks
    (parsed as any).pinnedAddress = lookupResult[0].address;
    (parsed as any).pinnedFamily = lookupResult[0].family;
    (parsed as any).cleanHostname = hostname;

    return parsed;
  }

  /**
   * Creates a hardened fetch function wrapper with SSRF validation,
   * pinned DNS resolution (preventing TOCTOU DNS rebinding),
   * execution timeout, and standardized Response representation.
   */
  public static createGuardedFetch(
    allowedDomains?: string[],
    timeoutMs = 10000,
    customFetch?: typeof fetch
  ) {
    if (customFetch) {
      return async (url: string, init?: any) => {
        await SsrfGuard.validateUrl(url, allowedDomains);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await customFetch(url, {
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

    // Production / native rebinding-safe pinned fetch
    return async (url: string, init?: any) => {
      let currentUrl = url;
      let currentInit = init || {};
      let redirectsCount = 0;
      const maxRedirects = 5;

      while (true) {
        const validated = await SsrfGuard.validateUrl(currentUrl, allowedDomains);
        const pinnedAddress = (validated as any).pinnedAddress;
        const pinnedFamily = (validated as any).pinnedFamily;
        const cleanHostname = (validated as any).cleanHostname || validated.hostname;

        const res = await SsrfGuard.executePinnedRequest({
          url: validated,
          cleanHostname,
          pinnedAddress,
          pinnedFamily,
          init: currentInit,
          timeoutMs,
        });

        // Handle redirect if status is 3xx and Location header is present
        if (
          res.status >= 300 &&
          res.status < 400 &&
          res.headers['location'] &&
          currentInit.redirect !== 'manual'
        ) {
          redirectsCount++;
          if (redirectsCount > maxRedirects) {
            throw new SsrfGuardError(`Too many redirects (limit: ${maxRedirects})`);
          }

          const nextLocation = res.headers['location'];
          const nextUrl = new URL(nextLocation, validated).toString();

          // Prepare init for next redirect hop
          let nextMethod = currentInit.method || 'GET';
          let nextBody = currentInit.body;
          if (
            res.status === 303 ||
            ((res.status === 301 || res.status === 302) && nextMethod.toUpperCase() === 'POST')
          ) {
            nextMethod = 'GET';
            nextBody = undefined;
          }

          currentUrl = nextUrl;
          currentInit = {
            ...currentInit,
            method: nextMethod,
            body: nextBody,
          };
          continue;
        }

        return res;
      }
    };
  }

  private static executePinnedRequest(options: {
    url: URL;
    cleanHostname: string;
    pinnedAddress: string;
    pinnedFamily: number;
    init: any;
    timeoutMs: number;
  }): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    json: () => Promise<any>;
    text: () => Promise<string>;
  }> {
    return new Promise((resolve, reject) => {
      const isHttps = options.url.protocol === 'https:';
      const transport = isHttps ? https : http;
      const port = options.url.port || (isHttps ? 443 : 80);

      const headers: Record<string, string> = {};
      if (options.init.headers) {
        if (typeof options.init.headers.forEach === 'function') {
          options.init.headers.forEach((val: string, key: string) => {
            headers[key] = val;
          });
        } else if (Array.isArray(options.init.headers)) {
          for (const [key, val] of options.init.headers) {
            headers[key] = String(val);
          }
        } else if (typeof options.init.headers === 'object') {
          for (const [key, val] of Object.entries(options.init.headers)) {
            headers[key] = String(val);
          }
        }
      }

      const hasHostHeader = Object.keys(headers).some((k) => k.toLowerCase() === 'host');
      if (!hasHostHeader) {
        headers['Host'] = options.url.host;
      }

      const reqOptions: any = {
        protocol: options.url.protocol,
        hostname: options.cleanHostname,
        port,
        path: options.url.pathname + options.url.search,
        method: options.init.method || 'GET',
        headers,
        lookup: (hostname: string, opts: any, callback: any) => {
          if (typeof opts === 'function') {
            callback = opts;
            opts = {};
          }
          if (opts && opts.all) {
            callback(null, [{ address: options.pinnedAddress, family: options.pinnedFamily }]);
          } else {
            callback(null, options.pinnedAddress, options.pinnedFamily);
          }
        },
      };

      if (isHttps) {
        reqOptions.servername = options.cleanHostname;
      }

      let timer: NodeJS.Timeout | null = null;
      if (options.timeoutMs > 0) {
        timer = setTimeout(() => {
          req.destroy(new Error(`Request timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
      }

      if (options.init.signal) {
        const signal = options.init.signal;
        if (signal.aborted) {
          if (timer) clearTimeout(timer);
          return reject(new Error('This operation was aborted'));
        }
        signal.addEventListener(
          'abort',
          () => {
            if (timer) clearTimeout(timer);
            req.destroy(new Error('This operation was aborted'));
          },
          { once: true }
        );
      }

      const req = transport.request(reqOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          if (timer) clearTimeout(timer);
          const bodyBuffer = Buffer.concat(chunks);
          const bodyText = bodyBuffer.toString('utf8');

          const resHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') resHeaders[k.toLowerCase()] = v;
            else if (Array.isArray(v)) resHeaders[k.toLowerCase()] = v.join(', ');
          }

          resolve({
            ok: (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300,
            status: res.statusCode ?? 500,
            statusText: res.statusMessage || '',
            headers: resHeaders,
            json: async () => JSON.parse(bodyText),
            text: async () => bodyText,
          });
        });
      });

      req.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });

      if (options.init.body) {
        if (typeof options.init.body === 'string' || Buffer.isBuffer(options.init.body)) {
          req.write(options.init.body);
        } else {
          req.write(JSON.stringify(options.init.body));
        }
      }

      req.end();
    });
  }
}
