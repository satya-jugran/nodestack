import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { ConfigService } from '../core/config/ConfigService';
import { AppError, NotFoundError, UnauthorizedError, ForbiddenError } from '../core/errors/AppError';
import { AuthClaims } from './AuthService';

export interface ApiKeyModel {
  id: string;
  name: string;
  description: string;
  keyPrefix: string;
  secretHash: string;
  redactedKey: string;
  role: 'admin' | 'service' | 'custom';
  scopes: string[];
  allowedIps: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  totalRequests: number;
  status: 'active' | 'revoked' | 'expired';
  createdBy?: string;
  created: string;
  updated: string;
}

export type SafeApiKeyModel = Omit<ApiKeyModel, 'secretHash'>;

export interface CreateApiKeyDto {
  name: string;
  description?: string;
  role?: 'admin' | 'service' | 'custom';
  scopes?: string[];
  allowedIps?: string[];
  expiresInDays?: number;
  expiresAt?: string;
  createdBy?: string;
  env?: string;
}

export interface UpdateApiKeyDto {
  name?: string;
  description?: string;
  role?: 'admin' | 'service' | 'custom';
  scopes?: string[];
  allowedIps?: string[];
  expiresAt?: string | null;
  status?: 'active' | 'revoked';
}

/**
 * Checks if a given AuthClaims object has permissions for a resource and action.
 */
export function hasScope(
  auth: AuthClaims | null | undefined,
  resource: string,
  action: string
): boolean {
  if (!auth) return false;
  if (auth.isAdmin) return true;
  if (!auth.isApiKey || !Array.isArray(auth.scopes)) return false;

  const scopes = auth.scopes;
  const res = resource.toLowerCase();
  const act = action.toLowerCase();
  const required = `${res}:${act}`;

  for (const s of scopes) {
    const scope = s.trim().toLowerCase();
    if (scope === '*' || scope === 'admin:*') return true;
    if (scope === `${res}:*`) return true;
    if (scope === required) return true;

    // Granular read / write rollups
    if (act === 'list' || act === 'view' || act === 'export') {
      if (scope === `${res}:read` || scope === '*:read') return true;
    }
    if (act === 'create' || act === 'update' || act === 'delete' || act === 'import') {
      if (scope === `${res}:write` || scope === '*:write') return true;
    }
  }

  return false;
}

export class ApiKeyService {
  // In-memory quick lookup cache (keyPrefix -> CachedKey) with 10s TTL
  private keyCache: Map<string, { key: ApiKeyModel; expiresAt: number }> = new Map();
  private pendingUsageUpdates: Map<string, { lastUsedAt: string; lastUsedIp: string; count: number }> = new Map();
  private usageFlushTimer?: NodeJS.Timeout;

  constructor(
    private db: DatabaseService,
    private config: ConfigService
  ) {
    // Flush usage stats every 5 seconds to reduce write load on SQLite WAL
    this.usageFlushTimer = setInterval(() => {
      this.flushUsageStats();
    }, 5000);
    if (this.usageFlushTimer.unref) {
      this.usageFlushTimer.unref();
    }
  }

  public dispose(): void {
    if (this.usageFlushTimer) {
      clearInterval(this.usageFlushTimer);
      this.flushUsageStats();
    }
  }

  /**
   * Generates a new API Key with full secret returned only once.
   */
  public createKey(dto: CreateApiKeyDto): { apiKey: SafeApiKeyModel; secretKey: string } {
    const name = (dto.name || '').trim();
    if (!name) {
      throw new AppError('API key name is required', 400);
    }

    const env = (dto.env || (this.config.dev ? 'test' : 'live')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'live';
    const keyId = crypto.randomBytes(3).toString('hex'); // 6 chars
    const secretEntropy = crypto.randomBytes(24).toString('hex'); // 48 chars
    const secretKey = `nsk_${env}_${keyId}_${secretEntropy}`;
    const keyPrefix = `nsk_${env}_${keyId}`;
    const redactedKey = `${keyPrefix}...${secretEntropy.slice(-4)}`;

    const secretHash = crypto.createHash('sha256').update(secretKey).digest('hex');
    const id = `key_${keyId}_${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();

    let expiresAt: string | null = null;
    if (dto.expiresAt) {
      expiresAt = new Date(dto.expiresAt).toISOString();
    } else if (dto.expiresInDays && dto.expiresInDays > 0) {
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + dto.expiresInDays);
      expiresAt = expDate.toISOString();
    }

    const role = dto.role || 'service';
    let scopes = dto.scopes || [];
    if (role === 'admin' && !scopes.includes('*')) {
      scopes = ['*'];
    }

    const allowedIps = (dto.allowedIps || []).map((ip) => ip.trim()).filter(Boolean);

    this.db.prepare(`
      INSERT INTO _api_keys (
        id, name, description, keyPrefix, secretHash, redactedKey, role, scopes, allowedIps,
        expiresAt, lastUsedAt, lastUsedIp, totalRequests, status, createdBy, created, updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      dto.description || '',
      keyPrefix,
      secretHash,
      redactedKey,
      role,
      JSON.stringify(scopes),
      JSON.stringify(allowedIps),
      expiresAt,
      null,
      null,
      0,
      'active',
      dto.createdBy || null,
      now,
      now
    );

    const createdKey: ApiKeyModel = {
      id,
      name,
      description: dto.description || '',
      keyPrefix,
      secretHash,
      redactedKey,
      role,
      scopes,
      allowedIps,
      expiresAt,
      lastUsedAt: null,
      lastUsedIp: null,
      totalRequests: 0,
      status: 'active',
      createdBy: dto.createdBy,
      created: now,
      updated: now,
    };

    // Prime cache
    this.keyCache.set(keyPrefix, { key: createdKey, expiresAt: Date.now() + 10000 });

    const { secretHash: _, ...safeKey } = createdKey;
    return {
      apiKey: safeKey,
      secretKey,
    };
  }

  /**
   * Fast verification of an incoming raw key string.
   */
  public verifyKey(rawKey: string, clientIp?: string): { valid: boolean; apiKey?: ApiKeyModel; error?: string } {
    if (!rawKey || typeof rawKey !== 'string') {
      return { valid: false, error: 'Empty API key' };
    }

    const trimmed = rawKey.trim();
    if (!trimmed.startsWith('nsk_')) {
      return { valid: false, error: 'Invalid API key format' };
    }

    // Key format: nsk_<env>_<keyId>_<secretEntropy>
    const parts = trimmed.split('_');
    if (parts.length < 4) {
      return { valid: false, error: 'Malformed API key structure' };
    }

    const keyPrefix = `${parts[0]}_${parts[1]}_${parts[2]}`;
    let keyModel: ApiKeyModel | undefined;

    // 1. Check in-memory cache
    const cached = this.keyCache.get(keyPrefix);
    if (cached && cached.expiresAt > Date.now()) {
      keyModel = cached.key;
    } else {
      const row = this.db.get<any>('SELECT * FROM _api_keys WHERE keyPrefix = ?', [keyPrefix]);
      if (row) {
        keyModel = this.mapRow(row);
        this.keyCache.set(keyPrefix, { key: keyModel, expiresAt: Date.now() + 10000 });
      }
    }

    if (!keyModel) {
      return { valid: false, error: 'API key not found' };
    }

    if (keyModel.status !== 'active') {
      return { valid: false, error: `API key is ${keyModel.status}` };
    }

    // 2. Cryptographic comparison of SHA-256 hash
    const inputHash = crypto.createHash('sha256').update(trimmed).digest('hex');
    const expectedHashBuffer = Buffer.from(keyModel.secretHash, 'hex');
    const inputHashBuffer = Buffer.from(inputHash, 'hex');

    if (
      expectedHashBuffer.length !== inputHashBuffer.length ||
      !crypto.timingSafeEqual(expectedHashBuffer, inputHashBuffer)
    ) {
      return { valid: false, error: 'Invalid API key secret' };
    }

    // 3. Expiration check
    if (keyModel.expiresAt) {
      const exp = new Date(keyModel.expiresAt).getTime();
      if (Date.now() > exp) {
        this.db.prepare("UPDATE _api_keys SET status = 'expired' WHERE id = ?").run(keyModel.id);
        keyModel.status = 'expired';
        this.keyCache.delete(keyPrefix);
        return { valid: false, error: 'API key has expired' };
      }
    }

    // 4. IP allowlist check
    if (keyModel.allowedIps && keyModel.allowedIps.length > 0 && clientIp) {
      if (!this.isIpAllowed(clientIp, keyModel.allowedIps)) {
        return { valid: false, error: `IP ${clientIp} is not authorized for this API key` };
      }
    }

    // 5. Track usage asynchronously
    this.recordUsage(keyModel.id, clientIp || '127.0.0.1');

    return {
      valid: true,
      apiKey: keyModel,
    };
  }

  /**
   * Helper to check if an IP matches allowed IP addresses / CIDRs.
   */
  private isIpAllowed(ip: string, allowedList: string[]): boolean {
    const cleanIp = ip.replace(/^::ffff:/, '').trim();
    for (const pattern of allowedList) {
      const cleanPattern = pattern.trim();
      if (cleanPattern === '*' || cleanPattern === cleanIp) {
        return true;
      }
      // Simple prefix check for subnet like "192.168.1."
      if (cleanPattern.endsWith('.') && cleanIp.startsWith(cleanPattern)) {
        return true;
      }
      // Basic /24 CIDR check
      if (cleanPattern.includes('/24')) {
        const subnet = cleanPattern.split('/24')[0].split('.').slice(0, 3).join('.');
        if (cleanIp.startsWith(subnet + '.')) {
          return true;
        }
      }
      if (cleanIp === '127.0.0.1' && (cleanPattern === 'localhost' || cleanPattern === '::1')) {
        return true;
      }
    }
    return false;
  }

  private recordUsage(keyId: string, ip: string): void {
    const existing = this.pendingUsageUpdates.get(keyId) || {
      lastUsedAt: new Date().toISOString(),
      lastUsedIp: ip,
      count: 0,
    };
    existing.lastUsedAt = new Date().toISOString();
    existing.lastUsedIp = ip;
    existing.count += 1;
    this.pendingUsageUpdates.set(keyId, existing);
  }

  private flushUsageStats(): void {
    if (this.pendingUsageUpdates.size === 0) return;
    try {
      this.db.transaction(() => {
        const stmt = this.db.prepare(`
          UPDATE _api_keys
          SET lastUsedAt = ?, lastUsedIp = ?, totalRequests = totalRequests + ?
          WHERE id = ?
        `);
        for (const [keyId, stats] of this.pendingUsageUpdates.entries()) {
          stmt.run(stats.lastUsedAt, stats.lastUsedIp, stats.count, keyId);
        }
      });
      this.pendingUsageUpdates.clear();
    } catch {
      // Non-fatal if DB is temporarily locked
    }
  }

  public listKeys(): SafeApiKeyModel[] {
    const rows = this.db.all<any>('SELECT * FROM _api_keys ORDER BY created DESC');
    return rows.map((r) => {
      const { secretHash: _, ...safe } = this.mapRow(r);
      return safe;
    });
  }

  public getKey(id: string): SafeApiKeyModel {
    const row = this.db.get<any>('SELECT * FROM _api_keys WHERE id = ?', [id]);
    if (!row) {
      throw new NotFoundError(`API key '${id}' not found`);
    }
    const { secretHash: _, ...safe } = this.mapRow(row);
    return safe;
  }

  public updateKey(id: string, dto: UpdateApiKeyDto): SafeApiKeyModel {
    const existing = this.db.get<any>('SELECT * FROM _api_keys WHERE id = ?', [id]);
    if (!existing) {
      throw new NotFoundError(`API key '${id}' not found`);
    }

    const updates: string[] = ['updated = ?'];
    const now = new Date().toISOString();
    const params: any[] = [now];

    if (dto.name !== undefined) {
      const cleanName = dto.name.trim();
      if (!cleanName) throw new AppError('Name cannot be empty', 400);
      updates.push('name = ?');
      params.push(cleanName);
    }
    if (dto.description !== undefined) {
      updates.push('description = ?');
      params.push(dto.description);
    }
    if (dto.role !== undefined) {
      updates.push('role = ?');
      params.push(dto.role);
    }
    if (dto.scopes !== undefined) {
      updates.push('scopes = ?');
      params.push(JSON.stringify(dto.scopes));
    }
    if (dto.allowedIps !== undefined) {
      updates.push('allowedIps = ?');
      params.push(JSON.stringify(dto.allowedIps));
    }
    if (dto.expiresAt !== undefined) {
      updates.push('expiresAt = ?');
      params.push(dto.expiresAt ? new Date(dto.expiresAt).toISOString() : null);
    }
    if (dto.status !== undefined) {
      updates.push('status = ?');
      params.push(dto.status);
    }

    params.push(id);
    this.db.prepare(`UPDATE _api_keys SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    this.keyCache.delete(existing.keyPrefix);
    return this.getKey(id);
  }

  public revokeKey(id: string): void {
    const existing = this.db.get<any>('SELECT keyPrefix FROM _api_keys WHERE id = ?', [id]);
    if (!existing) {
      throw new NotFoundError(`API key '${id}' not found`);
    }
    const now = new Date().toISOString();
    this.db.prepare("UPDATE _api_keys SET status = 'revoked', updated = ? WHERE id = ?").run(now, id);
    this.keyCache.delete(existing.keyPrefix);
  }

  public deleteKey(id: string): void {
    const existing = this.db.get<any>('SELECT keyPrefix FROM _api_keys WHERE id = ?', [id]);
    if (!existing) {
      throw new NotFoundError(`API key '${id}' not found`);
    }
    this.db.prepare('DELETE FROM _api_keys WHERE id = ?').run(id);
    this.keyCache.delete(existing.keyPrefix);
  }

  /**
   * Rotates an API Key secret. Invalides old secret, generates new one, and returns it.
   */
  public rotateKey(id: string): { apiKey: SafeApiKeyModel; secretKey: string } {
    const existing = this.db.get<any>('SELECT * FROM _api_keys WHERE id = ?', [id]);
    if (!existing) {
      throw new NotFoundError(`API key '${id}' not found`);
    }

    const keyPrefix = existing.keyPrefix;
    const parts = keyPrefix.split('_');
    const secretEntropy = crypto.randomBytes(24).toString('hex');
    const secretKey = `${keyPrefix}_${secretEntropy}`;
    const redactedKey = `${keyPrefix}...${secretEntropy.slice(-4)}`;
    const secretHash = crypto.createHash('sha256').update(secretKey).digest('hex');
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE _api_keys
      SET secretHash = ?, redactedKey = ?, status = 'active', updated = ?
      WHERE id = ?
    `).run(secretHash, redactedKey, now, id);

    this.keyCache.delete(keyPrefix);
    const updatedKey = this.getKey(id);

    return {
      apiKey: updatedKey,
      secretKey,
    };
  }

  private mapRow(row: any): ApiKeyModel {
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      keyPrefix: row.keyPrefix,
      secretHash: row.secretHash,
      redactedKey: row.redactedKey,
      role: row.role || 'service',
      scopes: typeof row.scopes === 'string' ? JSON.parse(row.scopes || '[]') : row.scopes || [],
      allowedIps: typeof row.allowedIps === 'string' ? JSON.parse(row.allowedIps || '[]') : row.allowedIps || [],
      expiresAt: row.expiresAt || null,
      lastUsedAt: row.lastUsedAt || null,
      lastUsedIp: row.lastUsedIp || null,
      totalRequests: Number(row.totalRequests || 0),
      status: row.status || 'active',
      createdBy: row.createdBy || undefined,
      created: row.created,
      updated: row.updated,
    };
  }
}
