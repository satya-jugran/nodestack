import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { ConfigService } from '../core/config/ConfigService';
import { AppError, NotFoundError, UnauthorizedError, ForbiddenError } from '../core/errors/AppError';
import { hashSecret, timingSafeEqualStrings, verifySecret } from '../core/crypto/secret';
import { AuthClaims } from './AuthService';
import type { RealtimeService, RealtimeIdentityFilter } from '../realtime/RealtimeService';

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
  private realtimeService?: RealtimeService;
  private keyRevokedListeners: Array<(filter: RealtimeIdentityFilter) => void> = [];

  constructor(
    private db: DatabaseService,
    private config: ConfigService
  ) {
    // Flush usage stats every 5 seconds to reduce write load
    this.usageFlushTimer = setInterval(() => {
      this.flushUsageStats().catch(() => {});
    }, 5000);
    if (this.usageFlushTimer.unref) {
      this.usageFlushTimer.unref();
    }
  }

  public setRealtimeService(realtimeService: RealtimeService): void {
    this.realtimeService = realtimeService;
  }

  public onKeyRevoked(listener: (filter: RealtimeIdentityFilter) => void): void {
    this.keyRevokedListeners.push(listener);
  }

  private notifyKeyRevoked(id: string): void {
    const filter: RealtimeIdentityFilter = {
      collection: '_api_keys',
      isApiKey: true,
      id,
    };
    try {
      this.realtimeService?.revokeClientsByIdentity(filter);
    } catch {
      // non-fatal
    }
    for (const listener of this.keyRevokedListeners) {
      try {
        listener(filter);
      } catch {
        // non-fatal
      }
    }
  }

  public async dispose(): Promise<void> {
    if (this.usageFlushTimer) {
      clearInterval(this.usageFlushTimer);
      await this.flushUsageStats();
    }
  }

  /**
   * Generates a new API Key with full secret returned only once.
   */
  public createKey(dto: CreateApiKeyDto): any {
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

    const secretHash = hashSecret(secretKey);
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

    const runRes = this.db.run(
      `INSERT INTO _api_keys (
        id, name, description, keyPrefix, secretHash, redactedKey, role, scopes, allowedIps,
        expiresAt, lastUsedAt, lastUsedIp, totalRequests, status, createdBy, created, updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    const result = {
      apiKey: safeKey,
      secretKey,
    };

    if (runRes && typeof (runRes as any).then === 'function') {
      return (runRes as any).then(() => result);
    }
    return result;
  }

  /**
   * Fast verification of an incoming raw key string.
   */
  public verifyKey(rawKey: string, clientIp?: string): any {
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
    }

    const validateModel = (model?: ApiKeyModel): any => {
      if (!model) {
        return { valid: false, error: 'API key not found' };
      }

      if (model.status !== 'active') {
        return { valid: false, error: `API key is ${model.status}` };
      }

      // 2. Cryptographic comparison of SHA-256 hash
      if (!verifySecret(model.secretHash, trimmed)) {
        return { valid: false, error: 'Invalid API key secret' };
      }

      // 3. Expiration check
      const expired = this.handleIfExpired(model);
      const finalizeValid = (isExpired: boolean): any => {
        if (isExpired) {
          return { valid: false, error: 'API key has expired' };
        }

        // 4. IP allowlist check
        if (model.allowedIps && model.allowedIps.length > 0 && clientIp) {
          if (!this.isIpAllowed(clientIp, model.allowedIps)) {
            return { valid: false, error: `IP ${clientIp} not in allowed range` };
          }
        }

        // 5. Asynchronously record usage statistics
        this.recordUsage(model.id, clientIp);

        return {
          valid: true,
          apiKey: model,
        };
      };

      if (expired && typeof (expired as any).then === 'function') {
        return (expired as Promise<boolean>).then(finalizeValid);
      }
      return finalizeValid(Boolean(expired));
    };

    if (keyModel) {
      return validateModel(keyModel);
    }

    const row = this.db.get<any>('SELECT * FROM _api_keys WHERE keyPrefix = ?', keyPrefix);
    if (row && typeof (row as any).then === 'function') {
      return (row as any).then((r: any) => {
        if (r) {
          keyModel = this.mapRow(r);
          this.keyCache.set(keyPrefix, { key: keyModel, expiresAt: Date.now() + 10000 });
        }
        return validateModel(keyModel);
      });
    }

    if (row) {
      keyModel = this.mapRow(row);
      this.keyCache.set(keyPrefix, { key: keyModel, expiresAt: Date.now() + 10000 });
    }
    return validateModel(keyModel);
  }

  private sameStringSet(a?: string[], b?: string[]): boolean {
    const setA = new Set((a || []).map((v) => v.trim()));
    const setB = new Set((b || []).map((v) => v.trim()));
    if (setA.size !== setB.size) return false;
    for (const item of setA) {
      if (!setB.has(item)) return false;
    }
    return true;
  }

  private handleIfExpired(model: ApiKeyModel): boolean | Promise<boolean> {
    if (!model.expiresAt) return false;
    const exp = new Date(model.expiresAt).getTime();
    if (Date.now() <= exp) return false;
    const updateRes = this.db.run("UPDATE _api_keys SET status = 'expired' WHERE id = ?", model.id);
    model.status = 'expired';
    this.keyCache.delete(model.keyPrefix);
    this.notifyKeyRevoked(model.id);
    if (updateRes && typeof (updateRes as any).then === 'function') {
      return (updateRes as any).then(() => true);
    }
    return true;
  }

  /**
   * Re-verifies previously issued API key claims against current key status,
   * expiration, optional secret hash, IP allowlist, and granted scopes.
   */
  public verifyClaims(
    claims: AuthClaims | null | undefined,
    options?: { expectedSecretHash?: string; clientIp?: string }
  ): boolean | Promise<boolean> {
    if (!claims || !claims.isApiKey) {
      return false;
    }

    const keyId = claims.apiKeyId || claims.id;
    if (!keyId) {
      return false;
    }

    let cachedModel: ApiKeyModel | undefined;
    for (const entry of this.keyCache.values()) {
      if (entry.key.id === keyId && entry.expiresAt > Date.now()) {
        cachedModel = entry.key;
        break;
      }
    }

    const validateModel = (model: ApiKeyModel | undefined): boolean | Promise<boolean> => {
      if (!model || model.status !== 'active') {
        return false;
      }

      if (options?.expectedSecretHash && !timingSafeEqualStrings(model.secretHash, options.expectedSecretHash, 'hex')) {
        return false;
      }

      const expired = this.handleIfExpired(model);
      const finalizeCheck = (isExpired: boolean): boolean => {
        if (isExpired) return false;

        if (options?.clientIp && model.allowedIps && model.allowedIps.length > 0) {
          if (!this.isIpAllowed(options.clientIp, model.allowedIps)) {
            return false;
          }
        }

        const hasAdminPrivilege =
          model.role === 'admin' || model.scopes.includes('*') || model.scopes.includes('admin:*');
        if (Boolean(claims.isAdmin) !== hasAdminPrivilege) {
          return false;
        }
        if (Array.isArray(claims.scopes) && !this.sameStringSet(claims.scopes, model.scopes)) {
          return false;
        }
        if (Array.isArray(claims.allowedIps) && !this.sameStringSet(claims.allowedIps, model.allowedIps)) {
          return false;
        }
        return true;
      };

      if (expired && typeof (expired as any).then === 'function') {
        return (expired as Promise<boolean>).then(finalizeCheck);
      }
      return finalizeCheck(Boolean(expired));
    };

    if (cachedModel) {
      return validateModel(cachedModel);
    }

    const row = this.db.get<any>('SELECT * FROM _api_keys WHERE id = ?', keyId);
    if (row && typeof (row as any).then === 'function') {
      return (row as any).then((r: any) => {
        if (!r) return false;
        const model = this.mapRow(r);
        this.keyCache.set(model.keyPrefix, { key: model, expiresAt: Date.now() + 10000 });
        return validateModel(model);
      });
    }

    if (!row) return false;
    const model = this.mapRow(row);
    this.keyCache.set(model.keyPrefix, { key: model, expiresAt: Date.now() + 10000 });
    return validateModel(model);
  }

  private isIpAllowed(ip: string, allowedList: string[]): boolean {
    const cleanIp = ip.replace(/^::ffff:/, '').trim();
    for (const pattern of allowedList) {
      const cleanPattern = pattern.trim();
      if (cleanPattern === '*' || cleanPattern === cleanIp) {
        return true;
      }
      if (cleanPattern.endsWith('.') && cleanIp.startsWith(cleanPattern)) {
        return true;
      }
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

  private recordUsage(keyId: string, ip?: string): void {
    const existing = this.pendingUsageUpdates.get(keyId) || {
      lastUsedAt: new Date().toISOString(),
      lastUsedIp: ip || 'unknown',
      count: 0,
    };
    existing.lastUsedAt = new Date().toISOString();
    existing.lastUsedIp = ip || 'unknown';
    existing.count += 1;
    this.pendingUsageUpdates.set(keyId, existing);
  }

  private async flushUsageStats(): Promise<void> {
    if (this.pendingUsageUpdates.size === 0) return;
    try {
      const entries = Array.from(this.pendingUsageUpdates.entries());
      this.pendingUsageUpdates.clear();
      if (this.db.dialect.name === 'sqlite') {
        this.db.transaction(() => {
          for (const [keyId, stats] of entries) {
            this.db.run(
              `UPDATE _api_keys
              SET lastUsedAt = ?, lastUsedIp = ?, totalRequests = totalRequests + ?
              WHERE id = ?`,
              stats.lastUsedAt, stats.lastUsedIp, stats.count, keyId
            );
          }
        });
      } else {
        await this.db.transaction(async (tx) => {
          for (const [keyId, stats] of entries) {
            await tx.prepare(
              `UPDATE _api_keys
              SET lastUsedAt = ?, lastUsedIp = ?, totalRequests = totalRequests + ?
              WHERE id = ?`
            ).run(stats.lastUsedAt, stats.lastUsedIp, stats.count, keyId);
          }
        });
      }
    } catch {
      // Non-fatal if DB is temporarily locked
    }
  }

  public listKeys(): any {
    const rows = this.db.all<any>('SELECT * FROM _api_keys ORDER BY created DESC');
    const processRows = (r: any[]) =>
      (r || []).map((item) => {
        const { secretHash: _, ...safe } = this.mapRow(item);
        return safe;
      });
    if (rows && typeof (rows as any).then === 'function') {
      return (rows as any).then(processRows);
    }
    return processRows(rows || []);
  }

  public getKey(id: string): any {
    const row = this.db.get<any>('SELECT * FROM _api_keys WHERE id = ?', id);
    const processRow = (r: any) => {
      if (!r) {
        throw new NotFoundError(`API key '${id}' not found`);
      }
      const { secretHash: _, ...safe } = this.mapRow(r);
      return safe;
    };
    if (row && typeof (row as any).then === 'function') {
      return (row as any).then(processRow);
    }
    return processRow(row);
  }

  public updateKey(id: string, dto: UpdateApiKeyDto): any {
    const existing = this.getKey(id);
    const doUpdate = (current: any) => {
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
      const runRes = this.db.run(`UPDATE _api_keys SET ${updates.join(', ')} WHERE id = ?`, ...params);
      this.keyCache.delete(current.keyPrefix);
      const shouldRevoke =
        (dto.status !== undefined && dto.status !== 'active') ||
        dto.role !== undefined ||
        dto.scopes !== undefined ||
        dto.allowedIps !== undefined ||
        dto.expiresAt !== undefined;
      if (shouldRevoke) {
        this.notifyKeyRevoked(id);
      }
      if (runRes && typeof (runRes as any).then === 'function') {
        return (runRes as any).then(() => this.getKey(id));
      }
      return this.getKey(id);
    };

    if (existing && typeof (existing as any).then === 'function') {
      return (existing as any).then(doUpdate);
    }
    return doUpdate(existing);
  }

  public revokeKey(id: string): any {
    const existing = this.getKey(id);
    const doRevoke = (current: any) => {
      const now = new Date().toISOString();
      const runRes = this.db.run("UPDATE _api_keys SET status = 'revoked', updated = ? WHERE id = ?", now, id);
      this.keyCache.delete(current.keyPrefix);
      this.notifyKeyRevoked(id);
      if (runRes && typeof (runRes as any).then === 'function') {
        return (runRes as any).then(() => {});
      }
    };
    if (existing && typeof (existing as any).then === 'function') {
      return (existing as any).then(doRevoke);
    }
    return doRevoke(existing);
  }

  public deleteKey(id: string): any {
    const existing = this.getKey(id);
    const doDelete = (current: any) => {
      const runRes = this.db.run('DELETE FROM _api_keys WHERE id = ?', id);
      this.keyCache.delete(current.keyPrefix);
      this.notifyKeyRevoked(id);
      if (runRes && typeof (runRes as any).then === 'function') {
        return (runRes as any).then(() => {});
      }
    };
    if (existing && typeof (existing as any).then === 'function') {
      return (existing as any).then(doDelete);
    }
    return doDelete(existing);
  }

  /**
   * Rotates an API Key secret. Invalides old secret, generates new one, and returns it.
   */
  public rotateKey(id: string): any {
    const existing = this.getKey(id);
    const doRotate = (current: any) => {
      const keyPrefix = current.keyPrefix;
      const secretEntropy = crypto.randomBytes(24).toString('hex');
      const secretKey = `${keyPrefix}_${secretEntropy}`;
      const redactedKey = `${keyPrefix}...${secretEntropy.slice(-4)}`;
      const secretHash = hashSecret(secretKey);
      const now = new Date().toISOString();

      const runRes = this.db.run(
        `UPDATE _api_keys
        SET secretHash = ?, redactedKey = ?, status = 'active', updated = ?
        WHERE id = ?`,
        secretHash, redactedKey, now, id
      );

      this.keyCache.delete(keyPrefix);
      this.notifyKeyRevoked(id);
      const finalize = () => {
        const updated = this.getKey(id);
        if (updated && typeof (updated as any).then === 'function') {
          return (updated as any).then((u: any) => ({ apiKey: u, secretKey }));
        }
        return { apiKey: updated, secretKey };
      };

      if (runRes && typeof (runRes as any).then === 'function') {
        return (runRes as any).then(finalize);
      }
      return finalize();
    };

    if (existing && typeof (existing as any).then === 'function') {
      return (existing as any).then(doRotate);
    }
    return doRotate(existing);
  }

  private mapRow(row: any): ApiKeyModel {
    let scopes: string[] = [];
    let allowedIps: string[] = [];
    try {
      scopes = typeof row.scopes === 'string' ? JSON.parse(row.scopes) : (row.scopes || []);
    } catch {}
    try {
      allowedIps = typeof row.allowedIps === 'string' ? JSON.parse(row.allowedIps) : (row.allowedIps || []);
    } catch {}

    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      keyPrefix: row.keyPrefix,
      secretHash: row.secretHash,
      redactedKey: row.redactedKey,
      role: row.role,
      scopes,
      allowedIps,
      expiresAt: row.expiresAt || null,
      lastUsedAt: row.lastUsedAt || null,
      lastUsedIp: row.lastUsedIp || null,
      totalRequests: Number(row.totalRequests || 0),
      status: row.status,
      createdBy: row.createdBy || undefined,
      created: row.created,
      updated: row.updated,
    };
  }
}
