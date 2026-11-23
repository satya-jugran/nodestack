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

export interface ListKeysOptions {
  limit?: number;
  offset?: number;
  status?: string;
  createdBy?: string;
}

export interface SimulateKeyOptions {
  keyId?: string;
  role?: string;
  scopes?: string[];
  allowedIps?: string[];
  subsystem: 'collections' | 'functions' | 'flows' | 'queues';
  resource: string;
  action: string;
  clientIp?: string;
  appSlug?: string;
}

export interface SimulateKeyResult {
  allowed: boolean;
  status: number;
  reason: string;
  matchedScope: string | null;
  requiredScope: string;
  subsystem: string;
  resource: string;
  action: string;
  ipCheck: {
    enforced: boolean;
    allowed: boolean;
    clientIp: string | null;
  };
  curlExample: string;
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

function hasScopedResourceAccess(
  auth: AuthClaims | null | undefined,
  category: string,
  resourceName: string,
  actions: string[]
): boolean {
  if (!auth) return false;
  if (auth.isAdmin) return true;
  if (!auth.isApiKey || !Array.isArray(auth.scopes)) return false;

  const cat = category.trim().toLowerCase();
  const res = resourceName.trim().toLowerCase();
  const actSet = new Set(actions.map((a) => a.toLowerCase()));

  for (const s of auth.scopes) {
    const scope = String(s || '').trim().toLowerCase();
    if (!scope) continue;
    if (scope === '*' || scope === 'admin:*' || scope === cat || scope === `${cat}:*`) {
      return true;
    }
    if (res && (scope === `${cat}:${res}` || scope === `${cat}:${res}:*`)) {
      return true;
    }
    for (const act of actSet) {
      if (scope === `${cat}:${act}`) return true;
      if (res && (scope === `${cat}:${res}:${act}` || scope === `${res}:${act}`)) return true;
    }
  }

  return false;
}

/**
 * Checks whether an API key or admin caller is permitted to invoke a serverless function.
 */
export function hasFunctionScope(auth: AuthClaims | null | undefined, functionName: string): boolean {
  return hasScopedResourceAccess(auth, 'functions', functionName, ['invoke', 'execute']);
}

/**
 * Checks whether an API key or admin caller is permitted to execute an HTTP flow.
 */
export function hasFlowScope(auth: AuthClaims | null | undefined, flowName: string): boolean {
  return hasScopedResourceAccess(auth, 'flows', flowName, ['execute', 'invoke']);
}

/**
 * Checks whether an API key or admin caller has permission for a queue action (global or per-queue).
 */
export function hasQueueScope(
  auth: AuthClaims | null | undefined,
  queueName: string | undefined,
  action: 'send' | 'read' | 'delete'
): boolean {
  if (!auth) return false;
  if (auth.isAdmin) return true;
  if (!auth.isApiKey || !Array.isArray(auth.scopes)) return false;

  const normalizedActions =
    action === 'send'
      ? ['send', 'write', 'create']
      : action === 'read'
        ? ['read', 'view', 'list']
        : ['delete', 'write'];

  return hasScopedResourceAccess(auth, 'queues', queueName || '', normalizedActions);
}

export function hasCronScope(
  auth: AuthClaims | null | undefined,
  action: 'read' | 'write' | 'trigger'
): boolean {
  if (!auth) return false;
  if (auth.isAdmin) return true;
  if (!auth.isApiKey || !Array.isArray(auth.scopes)) return false;

  const normalizedActions =
    action === 'read'
      ? ['read', 'list', 'view']
      : action === 'trigger'
        ? ['trigger', 'execute', 'run', 'write']
        : ['write', 'create', 'update', 'delete'];

  return hasScopedResourceAccess(auth, 'cron', '*', normalizedActions);
}

const RESERVED_SCOPE_CATEGORIES = new Set(['*', 'admin', 'functions', 'flows', 'queues', 'cron']);
const COLLECTION_READ_ACTIONS = new Set(['read', 'list', 'view']);
const COLLECTION_WRITE_ACTIONS = new Set(['write', 'create', 'update', 'delete']);
const QUEUE_GLOBAL_ACTIONS = new Set(['send', 'read', 'delete', '*']);

/**
 * Deduplicates scopes and removes specific resource scopes that are superseded
 * by a broader wildcard scope in the same permission group.
 */
export function normalizeApiKeyScopes(rawScopes: string[] | undefined, role?: string): string[] {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawScopes || []) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(trimmed);
    }
  }

  if (role === 'admin' || seen.has('*')) {
    return ['*'];
  }
  if (seen.has('admin:*')) {
    return ['admin:*'];
  }

  const hasAllColRead = seen.has('*:read');
  const hasAllColWrite = seen.has('*:write');
  const hasAllFunctions =
    seen.has('functions') || seen.has('functions:*') || seen.has('functions:invoke') || seen.has('functions:execute');
  const hasAllFlows =
    seen.has('flows') || seen.has('flows:*') || seen.has('flows:execute') || seen.has('flows:invoke');
  const hasAllQueues = seen.has('queues') || seen.has('queues:*');
  const hasQueueSendAll = hasAllQueues || seen.has('queues:send');
  const hasQueueReadAll = hasAllQueues || seen.has('queues:read');
  const hasQueueDeleteAll = hasAllQueues || seen.has('queues:delete');

  // Track per-collection `<col>:*` and per-queue `queues:<q>` / `queues:<q>:*` wildcards
  const wildcardCollections = new Set<string>();
  const wildcardQueues = new Set<string>();
  for (const s of seen) {
    const parts = s.split(':');
    if (parts.length === 2 && parts[1] === '*' && !RESERVED_SCOPE_CATEGORIES.has(parts[0])) {
      wildcardCollections.add(parts[0]);
    }
    if (parts[0] === 'queues' && parts.length === 2 && !QUEUE_GLOBAL_ACTIONS.has(parts[1])) {
      wildcardQueues.add(parts[1]);
    }
    if (parts[0] === 'queues' && parts.length === 3 && parts[2] === '*' && !QUEUE_GLOBAL_ACTIONS.has(parts[1])) {
      wildcardQueues.add(parts[1]);
    }
  }

  return cleaned.filter((original) => {
    const s = original.toLowerCase();
    const parts = s.split(':');

    // 1. Collections: `<col>:<action>`
    if (parts.length === 2 && !RESERVED_SCOPE_CATEGORIES.has(parts[0])) {
      const [col, act] = parts;
      if (act !== '*' && wildcardCollections.has(col)) return false;
      if (hasAllColRead && COLLECTION_READ_ACTIONS.has(act)) return false;
      if (hasAllColWrite && COLLECTION_WRITE_ACTIONS.has(act)) return false;
      return true;
    }

    // 2. Functions: strip specific `functions:<name>` / `functions:<name>:<act>` when wildcard is present
    if (parts[0] === 'functions' && hasAllFunctions) {
      if (s === 'functions' || s === 'functions:*' || s === 'functions:invoke' || s === 'functions:execute') {
        return true;
      }
      return false;
    }

    // 3. Flows: strip specific `flows:<name>` / `flows:<name>:<act>` when wildcard is present
    if (parts[0] === 'flows' && hasAllFlows) {
      if (s === 'flows' || s === 'flows:*' || s === 'flows:execute' || s === 'flows:invoke') {
        return true;
      }
      return false;
    }

    // 4. Queues
    if (parts[0] === 'queues') {
      if (hasAllQueues) {
        return s === 'queues' || s === 'queues:*';
      }
      if (parts.length === 3) {
        const [, qName, qAct] = parts;
        if (qAct !== '*' && wildcardQueues.has(qName)) return false;
        if (qAct === 'send' && hasQueueSendAll) return false;
        if (qAct === 'read' && hasQueueReadAll) return false;
        if (qAct === 'delete' && hasQueueDeleteAll) return false;
      }
      return true;
    }

    return true;
  });
}

export class ApiKeyService {
  public static readonly DEFAULT_MAX_API_KEYS_PER_USER = 50;

  // In-memory quick lookup cache (keyPrefix -> CachedKey) with 10s TTL
  private keyCache: Map<string, { key: ApiKeyModel; expiresAt: number }> = new Map();
  private pendingUsageUpdates: Map<string, { lastUsedAt: string; lastUsedIp: string; count: number }> = new Map();
  private inFlightMigrations: Map<string, Promise<any>> = new Map();
  private usageFlushTimer?: NodeJS.Timeout;
  private realtimeService?: RealtimeService;
  private keyRevokedListeners: Array<(filter: RealtimeIdentityFilter) => void> = [];
  private userQuotaLocks: Map<string, Promise<void>> = new Map();

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
   * Retrieves the server secret used for keying HMAC-SHA256 operations.
   */
  public getServerSecret(): string {
    const secret =
      this.config?.apiKeySecret ||
      this.config?.jwtSecret ||
      process.env.NODESTACK_API_KEY_SECRET ||
      process.env.NODESTACK_JWT_SECRET ||
      process.env.NODEBASE_JWT_SECRET;
    if (secret && typeof secret === 'string' && secret.trim()) {
      return secret.trim();
    }
    return 'nodestack_fallback_api_key_server_secret';
  }

  /**
   * Hashes an API key secret using HMAC-SHA256 keyed with the server secret.
   */
  public hashApiKey(secretKey: string): string {
    return hashSecret(secretKey, this.getServerSecret());
  }

  /**
   * Generates a new API Key with full secret returned only once.
   * Enforces per-user quota check and insertion atomically within a single transaction boundary.
   */
  public async createKey(dto: CreateApiKeyDto): Promise<{ apiKey: SafeApiKeyModel; secretKey: string }> {
    const name = (dto.name || '').trim();
    if (!name) {
      throw new AppError('API key name is required', 400);
    }

    const maxKeys = (this.config as any)?.maxApiKeysPerUser || ApiKeyService.DEFAULT_MAX_API_KEYS_PER_USER;

    return await this.serializeUserCreation(dto.createdBy, async () => {
      return await this.db.transaction(async () => {
        if (this.db.dialect.name === 'postgres' && dto.createdBy) {
          try {
            await this.db.get("SELECT pg_advisory_xact_lock(hashtext('api_key_quota_' || ?))", dto.createdBy);
          } catch {}
        }
        if (dto.createdBy) {
          const countRow = await this.db.get<{ count: number }>(
            "SELECT COUNT(*) as count FROM _api_keys WHERE createdBy = ? AND status != 'revoked'",
            dto.createdBy
          );
          const currentCount = Number(countRow?.count || 0);
          if (currentCount >= maxKeys) {
            throw new AppError(
              `API key quota exceeded: maximum of ${maxKeys} active keys allowed per user`,
              400
            );
          }
        }
        return await this.insertKeyRecord(dto, name);
      });
    });
  }

  private async serializeUserCreation<T>(userId: string | undefined, fn: () => Promise<T> | T): Promise<T> {
    if (!userId) {
      return fn();
    }

    while (this.userQuotaLocks.has(userId)) {
      try {
        await this.userQuotaLocks.get(userId);
      } catch {}
    }

    let release!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.userQuotaLocks.set(userId, lockPromise);

    try {
      return await fn();
    } finally {
      if (this.userQuotaLocks.get(userId) === lockPromise) {
        this.userQuotaLocks.delete(userId);
      }
      release();
    }
  }

  private async insertKeyRecord(dto: CreateApiKeyDto, name: string): Promise<{ apiKey: SafeApiKeyModel; secretKey: string }> {
    const env = (dto.env || (this.config.dev ? 'test' : 'live')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'live';
    const keyId = crypto.randomBytes(3).toString('hex'); // 6 chars
    const secretEntropy = crypto.randomBytes(24).toString('hex'); // 48 chars
    const secretKey = `nsk_${env}_${keyId}_${secretEntropy}`;
    const keyPrefix = `nsk_${env}_${keyId}`;
    const redactedKey = `${keyPrefix}...${secretEntropy.slice(-4)}`;

    const secretHash = this.hashApiKey(secretKey);
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
    const scopes = normalizeApiKeyScopes(dto.scopes, role);

    const allowedIps = (dto.allowedIps || []).map((ip) => ip.trim()).filter(Boolean);

    await this.db.run(
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
    return {
      apiKey: safeKey,
      secretKey,
    };
  }

  /**
   * Fast verification of an incoming raw key string.
   */
  public async verifyKey(
    rawKey: string,
    clientIp?: string
  ): Promise<{ valid: boolean; apiKey?: ApiKeyModel; error?: string }> {
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

    if (!keyModel) {
      const row = await this.db.get<any>('SELECT * FROM _api_keys WHERE keyPrefix = ?', keyPrefix);
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

    const activeModel = keyModel;

    // 2. Cryptographic comparison using HMAC-SHA256 keyed with server secret
    const serverSecret = this.getServerSecret();
    let isValid = verifySecret(activeModel.secretHash, trimmed, serverSecret);

    // Support legacy unsalted SHA-256 hashes with transparent automatic upgrade to HMAC-SHA256
    if (!isValid && verifySecret(activeModel.secretHash, trimmed)) {
      const legacyHash = activeModel.secretHash;
      const upgradedHash = this.hashApiKey(trimmed);

      try {
        const updatePromise = this.db.run(
          'UPDATE _api_keys SET secretHash = ? WHERE id = ? AND secretHash = ?',
          upgradedHash,
          activeModel.id,
          legacyHash
        );
        this.inFlightMigrations.set(activeModel.id, updatePromise as Promise<any>);

        const updateRes = await updatePromise;
        const changes = Number(
          updateRes?.changes ?? (updateRes as any)?.rowCount ?? (typeof updateRes === 'number' ? updateRes : 0)
        );
        if (changes > 0) {
          activeModel.secretHash = upgradedHash;
          isValid = true;
        } else {
          // Zero rows affected: concurrent update or rotation occurred
          this.keyCache.delete(activeModel.keyPrefix);
          const recheckRow = await this.db.get<any>('SELECT * FROM _api_keys WHERE id = ?', activeModel.id);
          if (!recheckRow) {
            return { valid: false, error: 'API key not found' };
          }
          const latestModel = this.mapRow(recheckRow);
          if (verifySecret(latestModel.secretHash, trimmed, serverSecret)) {
            this.keyCache.set(latestModel.keyPrefix, { key: latestModel, expiresAt: Date.now() + 10000 });
            isValid = true;
            return await this.finalizeValidKey(latestModel, clientIp);
          }
          return { valid: false, error: 'Invalid API key secret' };
        }
      } catch {
        this.keyCache.delete(activeModel.keyPrefix);
        return { valid: false, error: 'Failed to migrate legacy API key secret' };
      } finally {
        this.inFlightMigrations.delete(activeModel.id);
      }
    }

    if (!isValid) {
      return { valid: false, error: 'Invalid API key secret' };
    }

    return await this.finalizeValidKey(activeModel, clientIp);
  }

  private async finalizeValidKey(
    targetModel: ApiKeyModel,
    clientIp?: string
  ): Promise<{ valid: boolean; apiKey?: ApiKeyModel; error?: string }> {
    const expired = await this.handleIfExpired(targetModel);
    if (expired) {
      return { valid: false, error: 'API key has expired' };
    }

    if (targetModel.allowedIps && targetModel.allowedIps.length > 0 && clientIp) {
      if (!this.isIpAllowed(clientIp, targetModel.allowedIps)) {
        return { valid: false, error: `IP ${clientIp} not in allowed range` };
      }
    }

    this.recordUsage(targetModel.id, clientIp);

    return {
      valid: true,
      apiKey: targetModel,
    };
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

  private async handleIfExpired(model: ApiKeyModel): Promise<boolean> {
    if (!model.expiresAt) return false;
    const exp = new Date(model.expiresAt).getTime();
    if (Date.now() <= exp) return false;
    await this.db.run("UPDATE _api_keys SET status = 'expired' WHERE id = ?", model.id);
    model.status = 'expired';
    this.keyCache.delete(model.keyPrefix);
    this.notifyKeyRevoked(model.id);
    return true;
  }

  /**
   * Re-verifies previously issued API key claims against current key status,
   * expiration, optional secret hash, IP allowlist, and granted scopes.
   */
  public async verifyClaims(
    claims: AuthClaims | null | undefined,
    options?: { expectedSecretHash?: string; clientIp?: string }
  ): Promise<boolean> {
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

    if (!cachedModel) {
      const row = await this.db.get<any>('SELECT * FROM _api_keys WHERE id = ?', keyId);
      if (!row) return false;
      cachedModel = this.mapRow(row);
      this.keyCache.set(cachedModel.keyPrefix, { key: cachedModel, expiresAt: Date.now() + 10000 });
    }

    const model = cachedModel;
    if (!model || model.status !== 'active') {
      return false;
    }

    if (options?.expectedSecretHash && !timingSafeEqualStrings(model.secretHash, options.expectedSecretHash, 'hex')) {
      return false;
    }

    const isExpired = await this.handleIfExpired(model);
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
  }

  public isIpAllowed(ip: string, allowedList: string[]): boolean {
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
      await this.db.transaction(async (tx) => {
        for (const [keyId, stats] of entries) {
          await tx.prepare(
            `UPDATE _api_keys
            SET lastUsedAt = ?, lastUsedIp = ?, totalRequests = totalRequests + ?
            WHERE id = ?`
          ).run(stats.lastUsedAt, stats.lastUsedIp, stats.count, keyId);
        }
      });
    } catch {
      // Non-fatal if DB is temporarily locked
    }
  }

  public async listKeys(options?: ListKeysOptions): Promise<Omit<ApiKeyModel, 'secretHash'>[]> {
    const rawLimit = options?.limit !== undefined && Number.isFinite(Number(options.limit))
      ? Math.trunc(Number(options.limit))
      : 100;
    const limit = Math.max(1, Math.min(500, rawLimit));

    const rawOffset = options?.offset !== undefined && Number.isFinite(Number(options.offset))
      ? Math.trunc(Number(options.offset))
      : 0;
    const offset = Math.max(0, rawOffset);

    const conditions: string[] = [];
    const params: any[] = [];

    if (options?.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options?.createdBy) {
      conditions.push('createdBy = ?');
      params.push(options.createdBy);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM _api_keys ${whereClause} ORDER BY created DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await this.db.all<any>(sql, ...params);
    return (rows || []).map((item) => {
      const { secretHash: _, ...safe } = this.mapRow(item);
      return safe;
    });
  }

  public async getKey(id: string): Promise<Omit<ApiKeyModel, 'secretHash'>> {
    const row = await this.db.get<any>('SELECT * FROM _api_keys WHERE id = ?', id);
    if (!row) {
      throw new NotFoundError(`API key '${id}' not found`);
    }
    const { secretHash: _, ...safe } = this.mapRow(row);
    return safe;
  }

  public async updateKey(id: string, dto: UpdateApiKeyDto): Promise<SafeApiKeyModel> {
    const current = await this.getKey(id);
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
    const effectiveRole = dto.role !== undefined ? dto.role : current.role;
    const isRoleChanging = dto.role !== undefined && dto.role !== current.role;
    if (dto.role !== undefined) {
      updates.push('role = ?');
      params.push(dto.role);
    }
    if (dto.scopes !== undefined || isRoleChanging || effectiveRole === 'admin') {
      let baseScopes: string[];
      if (dto.scopes !== undefined) {
        baseScopes = dto.scopes;
        // If the key is non-admin, remove admin wildcard scopes to prevent privilege escalation/leakage
        if (effectiveRole !== 'admin') {
          baseScopes = baseScopes.filter((s: string) => {
            const trimmed = String(s || '').trim().toLowerCase();
            return trimmed !== '*' && trimmed !== 'admin:*';
          });
        }
      } else if (effectiveRole === 'admin') {
        baseScopes = ['*'];
      } else {
        // Role changed to non-admin without explicit scopes (role downgrade)
        // Strip any admin wildcard scopes inherited from the admin role
        baseScopes = (current.scopes || []).filter((s: string) => {
          const trimmed = String(s || '').trim().toLowerCase();
          return trimmed !== '*' && trimmed !== 'admin:*';
        });
      }
      const nextScopes = normalizeApiKeyScopes(baseScopes, effectiveRole);
      updates.push('scopes = ?');
      params.push(JSON.stringify(nextScopes));
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
    await this.db.run(`UPDATE _api_keys SET ${updates.join(', ')} WHERE id = ?`, ...params);
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
    return await this.getKey(id);
  }

  public async revokeKey(id: string): Promise<void> {
    const current = await this.getKey(id);
    const now = new Date().toISOString();
    await this.db.run("UPDATE _api_keys SET status = 'revoked', updated = ? WHERE id = ?", now, id);
    this.keyCache.delete(current.keyPrefix);
    this.notifyKeyRevoked(id);
  }

  public async deleteKey(id: string): Promise<void> {
    const current = await this.getKey(id);
    await this.db.run('DELETE FROM _api_keys WHERE id = ?', id);
    this.keyCache.delete(current.keyPrefix);
    this.notifyKeyRevoked(id);
  }

  /**
   * Rotates an API Key secret. Invalides old secret, generates new one, and returns it.
   */
  public async rotateKey(id: string): Promise<{ apiKey: SafeApiKeyModel; secretKey: string }> {
    const inFlight = this.inFlightMigrations.get(id);
    if (inFlight) {
      try {
        await inFlight;
      } catch {}
      return await this.rotateKey(id);
    }
    const current = await this.getKey(id);
    const keyPrefix = current.keyPrefix;
    const secretEntropy = crypto.randomBytes(24).toString('hex');
    const secretKey = `${keyPrefix}_${secretEntropy}`;
    const redactedKey = `${keyPrefix}...${secretEntropy.slice(-4)}`;
    const secretHash = this.hashApiKey(secretKey);
    const now = new Date().toISOString();

    await this.db.run(
      `UPDATE _api_keys
      SET secretHash = ?, redactedKey = ?, status = 'active', updated = ?
      WHERE id = ?`,
      secretHash, redactedKey, now, id
    );

    this.keyCache.delete(keyPrefix);
    this.notifyKeyRevoked(id);
    const updated = await this.getKey(id);
    return { apiKey: updated, secretKey };
  }

  /**
   * Evaluates key permissions and IP restrictions against a subsystem resource and action
   * in dry-run simulation mode without side-effects.
   */
  public async simulate(options: SimulateKeyOptions): Promise<SimulateKeyResult> {
    let key: Omit<ApiKeyModel, 'secretHash'> | ApiKeyModel | null = null;
    if (options.keyId) {
      key = await this.getKey(options.keyId);
      if (!key) {
        throw new NotFoundError(`API key '${options.keyId}' not found`);
      }
    }

    const subsystem = (options.subsystem || '').toLowerCase();
    const resource = (options.resource || '').trim();
    const action = (options.action || '').trim().toLowerCase();

    const effectiveRole = (options.role || key?.role || 'service') as 'admin' | 'service' | 'custom';
    const effectiveScopes = normalizeApiKeyScopes(
      options.scopes !== undefined ? options.scopes : (key?.scopes || []),
      effectiveRole
    );
    const effectiveIps = options.allowedIps !== undefined ? options.allowedIps : (key?.allowedIps || []);
    const hasIpRestriction = Array.isArray(effectiveIps) && effectiveIps.length > 0;

    let isKeyActive = true;
    let inactiveReason = '';
    if (key) {
      if (key.status === 'revoked') {
        isKeyActive = false;
        inactiveReason = 'API key is revoked';
      } else if (key.status === 'expired' || (key.expiresAt && new Date(key.expiresAt) < new Date())) {
        isKeyActive = false;
        inactiveReason = 'API key has expired';
      }
    }

    if (!isKeyActive) {
      return {
        allowed: false,
        status: 403,
        reason: inactiveReason,
        matchedScope: null,
        requiredScope: '',
        subsystem,
        resource,
        action,
        ipCheck: { enforced: hasIpRestriction, allowed: true, clientIp: options.clientIp || null },
        curlExample: '',
      };
    }

    if (hasIpRestriction && options.clientIp) {
      const ipAllowed = this.isIpAllowed(options.clientIp, effectiveIps);
      if (!ipAllowed) {
        return {
          allowed: false,
          status: 403,
          reason: `Client IP '${options.clientIp}' not in allowed IP list (${effectiveIps.join(', ')})`,
          matchedScope: null,
          requiredScope: '',
          subsystem,
          resource,
          action,
          ipCheck: { enforced: true, allowed: false, clientIp: options.clientIp },
          curlExample: '',
        };
      }
    }

    const isAdmin = effectiveRole === 'admin' || effectiveScopes.includes('*') || effectiveScopes.includes('admin:*');
    const simulatedAuth: AuthClaims = {
      id: key?.id || 'simulated_key',
      email: `${(key?.name || 'simulated').toLowerCase().replace(/[^a-z0-9]/g, '_')}@service.nodestack.local`,
      collection: '_api_keys',
      tokenKey: key?.id || 'simulated_key',
      isAdmin,
      isApiKey: true,
      scopes: effectiveScopes,
      role: effectiveRole,
      allowedIps: effectiveIps,
    };

    let allowed = false;
    let matchedScope: string | null = null;
    let requiredScope = '';
    let reason = '';

    if (subsystem === 'collections') {
      requiredScope = `${resource}:${action}`;
      allowed = hasScope(simulatedAuth, resource, action);
      if (allowed) {
        if (isAdmin) {
          matchedScope = effectiveScopes.find(s => s === '*' || s === 'admin:*') || 'role:admin';
          reason = `Granted with full administrative access (${matchedScope})`;
        } else {
          matchedScope = effectiveScopes.find(s => {
            const sc = s.toLowerCase();
            return sc === '*' || sc === `${resource.toLowerCase()}:*` || sc === requiredScope.toLowerCase() ||
              ((action === 'list' || action === 'view' || action === 'export') && (sc === `${resource.toLowerCase()}:read` || sc === '*:read')) ||
              ((action === 'create' || action === 'update' || action === 'delete' || action === 'import') && (sc === `${resource.toLowerCase()}:write` || sc === '*:write'));
          }) || null;
          reason = `Granted by scope '${matchedScope}'`;
        }
      } else {
        reason = `Missing required scope '${resource}:${action}' (or wildcard '${resource}:*')`;
      }
    } else if (subsystem === 'functions') {
      requiredScope = `functions:${resource}`;
      allowed = hasFunctionScope(simulatedAuth, resource);
      if (allowed) {
        if (isAdmin) {
          matchedScope = effectiveScopes.find(s => s === '*' || s === 'admin:*') || 'role:admin';
          reason = `Granted with full administrative access (${matchedScope})`;
        } else {
          matchedScope = effectiveScopes.find(s => {
            const sc = s.toLowerCase();
            return sc === '*' || sc === 'functions' || sc === 'functions:*' || sc === `functions:${resource.toLowerCase()}` || sc === `functions:${resource.toLowerCase()}:*` || sc === `functions:${resource.toLowerCase()}:invoke`;
          }) || null;
          reason = `Granted by scope '${matchedScope}'`;
        }
      } else {
        reason = `Missing required scope 'functions:${resource}' (or wildcard 'functions:*')`;
      }
    } else if (subsystem === 'flows') {
      requiredScope = `flows:${resource}`;
      allowed = hasFlowScope(simulatedAuth, resource);
      if (allowed) {
        if (isAdmin) {
          matchedScope = effectiveScopes.find(s => s === '*' || s === 'admin:*') || 'role:admin';
          reason = `Granted with full administrative access (${matchedScope})`;
        } else {
          matchedScope = effectiveScopes.find(s => {
            const sc = s.toLowerCase();
            return sc === '*' || sc === 'flows' || sc === 'flows:*' || sc === `flows:${resource.toLowerCase()}` || sc === `flows:${resource.toLowerCase()}:*` || sc === `flows:${resource.toLowerCase()}:execute`;
          }) || null;
          reason = action === 'poll'
            ? `Granted by scope '${matchedScope}' (Note: caller must also match execution actorId)`
            : `Granted by scope '${matchedScope}'`;
        }
      } else {
        reason = `Missing required scope 'flows:${resource}' (or wildcard 'flows:*')`;
      }
    } else if (subsystem === 'queues') {
      const queueAct = action === 'claim' ? 'read' : (action as 'send' | 'read' | 'delete');
      requiredScope = `queues:${resource}:${queueAct}`;
      allowed = hasQueueScope(simulatedAuth, resource, queueAct);
      if (allowed) {
        if (isAdmin) {
          matchedScope = effectiveScopes.find(s => s === '*' || s === 'admin:*') || 'role:admin';
          reason = `Granted with full administrative access (${matchedScope})`;
        } else {
          matchedScope = effectiveScopes.find(s => {
            const sc = s.toLowerCase();
            return sc === '*' || sc === 'queues' || sc === 'queues:*' || sc === `queues:${resource.toLowerCase()}` || sc === `queues:${resource.toLowerCase()}:*` || sc === `queues:${resource.toLowerCase()}:${queueAct}`;
          }) || null;
          reason = `Granted by scope '${matchedScope}'`;
        }
      } else {
        reason = `Missing required scope 'queues:${resource}:${queueAct}' (or wildcard 'queues:${resource}:*')`;
      }
    } else {
      throw new AppError(`Invalid subsystem '${options.subsystem}'. Expected one of: collections, functions, flows, queues`, 400);
    }

    const keyToken = key?.redactedKey ? `${key.keyPrefix}...` : 'YOUR_API_KEY';
    const pathPrefix = options.appSlug && options.appSlug !== 'default'
      ? `/api/apps/${encodeURIComponent(options.appSlug)}`
      : '/api';
    let curlExample = '';
    if (subsystem === 'collections') {
      if (action === 'list') {
        curlExample = `curl -X GET "${pathPrefix}/collections/${resource}/records" \\\n  -H "Authorization: ApiKey ${keyToken}"`;
      } else if (action === 'view') {
        curlExample = `curl -X GET "${pathPrefix}/collections/${resource}/records/<RECORD_ID>" \\\n  -H "Authorization: ApiKey ${keyToken}"`;
      } else if (action === 'create') {
        curlExample = `curl -X POST "${pathPrefix}/collections/${resource}/records" \\\n  -H "Authorization: ApiKey ${keyToken}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"field": "value"}'`;
      } else if (action === 'update') {
        curlExample = `curl -X PATCH "${pathPrefix}/collections/${resource}/records/<RECORD_ID>" \\\n  -H "Authorization: ApiKey ${keyToken}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"field": "value"}'`;
      } else if (action === 'delete') {
        curlExample = `curl -X DELETE "${pathPrefix}/collections/${resource}/records/<RECORD_ID>" \\\n  -H "Authorization: ApiKey ${keyToken}"`;
      }
    } else if (subsystem === 'functions') {
      curlExample = `curl -X POST "${pathPrefix}/functions/${resource}/invoke" \\\n  -H "Authorization: ApiKey ${keyToken}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"param": "value"}'`;
    } else if (subsystem === 'flows') {
      if (action === 'poll') {
        curlExample = `curl -X GET "${pathPrefix}/flows/executions/<EXECUTION_ID>" \\\n  -H "Authorization: ApiKey ${keyToken}"`;
      } else {
        curlExample = `curl -X POST "${pathPrefix}/flows/${resource}/execute" \\\n  -H "Authorization: ApiKey ${keyToken}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"param": "value"}'`;
      }
    } else if (subsystem === 'queues') {
      if (action === 'send') {
        curlExample = `curl -X POST "${pathPrefix}/queues/${resource}/messages" \\\n  -H "Authorization: ApiKey ${keyToken}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"payload": {"task": "demo"}}'`;
      } else if (action === 'read' || action === 'claim') {
        curlExample = `curl -X GET "${pathPrefix}/queues/${resource}/messages" \\\n  -H "Authorization: ApiKey ${keyToken}"`;
      } else {
        curlExample = `curl -X DELETE "${pathPrefix}/queues/${resource}/messages/<MESSAGE_ID>" \\\n  -H "Authorization: ApiKey ${keyToken}"`;
      }
    }

    return {
      allowed,
      status: allowed ? 200 : 403,
      reason,
      matchedScope,
      requiredScope,
      subsystem,
      resource,
      action,
      ipCheck: {
        enforced: hasIpRestriction,
        allowed: !hasIpRestriction || !options.clientIp ? true : this.isIpAllowed(options.clientIp, effectiveIps),
        clientIp: options.clientIp || null,
      },
      curlExample,
    };
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
