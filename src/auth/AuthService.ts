import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../database/DatabaseService';
import { ConfigService } from '../core/config/ConfigService';
import { SchemaService } from '../schema/SchemaService';
import { AppError, ConflictError, NotFoundError, UnauthorizedError, ForbiddenError } from '../core/errors/AppError';
import { AppRegistry } from '../apps/AppRegistry';
import { OAuthProviderRegistry } from './oauth/OAuthProviderRegistry';
import { AuthMethodProviderInfo, ExternalAuthModel, OAuthProfile } from './oauth/types';
import { FileStorageService } from '../files/FileStorageService';
import { RuleEngine } from '../rules/RuleEngine';
import { RecordValidator } from '../records/RecordValidator';
import { EventBus } from '../core/events/EventBus';
import { RealtimeService } from '../realtime/RealtimeService';

export interface AuthClaims {
  id: string;
  email: string;
  collection: string;
  tokenKey: string;
  isAdmin: boolean;
  isApiKey?: boolean;
  apiKeyId?: string;
  apiKeyName?: string;
  scopes?: string[];
  allowedIps?: string[];
}

export interface AuthResult {
  token: string;
  record: Record<string, any>;
}

export interface OAuthAuthResult extends AuthResult {
  meta: {
    provider: string;
    isNew: boolean;
    providerUserId: string;
    rawUser: Record<string, any>;
  };
}

export class AuthService {
  private oauthRegistry: OAuthProviderRegistry;
  private ruleEngine: RuleEngine;
  private eventBus?: EventBus;
  private realtimeService?: RealtimeService;

  constructor(
    private db: DatabaseService,
    private config: ConfigService,
    private schemaService: SchemaService,
    private registry?: AppRegistry,
    oauthRegistry?: OAuthProviderRegistry,
    ruleEngine?: RuleEngine,
    eventBus?: EventBus,
    realtimeService?: RealtimeService
  ) {
    this.oauthRegistry = oauthRegistry || new OAuthProviderRegistry();
    this.ruleEngine = ruleEngine || new RuleEngine();
    this.eventBus = eventBus;
    this.realtimeService = realtimeService;
  }

  public setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  public setRealtimeService(realtimeService: RealtimeService): void {
    this.realtimeService = realtimeService;
  }

  public getOAuthRegistry(): OAuthProviderRegistry {
    return this.oauthRegistry;
  }

  public async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  public async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  public generateToken(claims: AuthClaims, expiresIn: string | number = '7d'): string {
    return jwt.sign(claims, this.config.jwtSecret, { expiresIn: expiresIn as any });
  }

  public verifyToken(token: string): AuthClaims {
    let decoded: AuthClaims;
    try {
      decoded = jwt.verify(token, this.config.jwtSecret) as AuthClaims;
    } catch {
      throw new UnauthorizedError('Invalid or expired authentication token');
    }

    if (!decoded || !decoded.id || !decoded.collection) {
      throw new UnauthorizedError('Invalid authentication token payload');
    }

    // Verify tokenKey against stored tokenKey to ensure revoked / rotated sessions are rejected
    if (decoded.isAdmin || decoded.collection === '_admins') {
      let admin = this.registry
        ? this.registry.getAdminById(decoded.id)
        : undefined;
      if (!admin) {
        admin = this.db.get<any>('SELECT * FROM _admins WHERE id = ?', [decoded.id]);
        if (admin && this.registry) {
          try {
            this.registry.getDriver().prepare(`
              INSERT OR REPLACE INTO _admins (id, email, passwordHash, tokenKey, avatar, created, updated)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(admin.id, admin.email, admin.passwordHash, admin.tokenKey, admin.avatar || null, admin.created, admin.updated);
          } catch {}
        }
      }
      if (!admin || !admin.tokenKey || admin.tokenKey !== decoded.tokenKey) {
        throw new UnauthorizedError('Authentication token has been revoked or expired');
      }
    } else {
      const col = this.schemaService.getCollection(decoded.collection);
      if (col && col.type === 'auth') {
        const record = this.db.get<any>(
          `SELECT tokenKey FROM "${col.name}" WHERE id = ?`,
          [decoded.id]
        );
        if (!record || !record.tokenKey || record.tokenKey !== decoded.tokenKey) {
          throw new UnauthorizedError('Authentication token has been revoked or expired');
        }
      } else {
        throw new UnauthorizedError('Authentication token collection not found');
      }
    }

    return decoded;
  }

  // --- Admin Auth ---

  public hasAdmins(): boolean {
    const registryHas = this.registry ? this.registry.hasAdmins() : false;
    if (registryHas) return true;
    const row = this.db.get<any>('SELECT COUNT(*) as count FROM _admins');
    return (row?.count || 0) > 0;
  }

  public async createAdmin(email: string, password: string, avatar?: string): Promise<Record<string, any>> {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new AppError('Valid email is required', 400);
    }
    if (!password || password.length < 8) {
      throw new AppError('Password must be at least 8 characters long', 400);
    }

    if (this.registry) {
      const regExisting = this.registry.getAdminByEmail(cleanEmail);
      if (regExisting) {
        throw new ConflictError(`Admin with email '${cleanEmail}' already exists`);
      }
    }
    const existing = this.db.get<any>('SELECT id FROM _admins WHERE email = ?', [cleanEmail]);
    if (existing) {
      throw new ConflictError(`Admin with email '${cleanEmail}' already exists`);
    }

    const id = `adm_${crypto.randomBytes(6).toString('hex')}`;
    const passwordHash = await this.hashPassword(password);
    const tokenKey = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO _admins (id, email, passwordHash, tokenKey, avatar, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, cleanEmail, passwordHash, tokenKey, avatar || null, now, now);

    if (this.registry) {
      try {
        this.registry.getDriver().prepare(`
          INSERT INTO _admins (id, email, passwordHash, tokenKey, avatar, created, updated)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, cleanEmail, passwordHash, tokenKey, avatar || null, now, now);
      } catch {
        // ignore duplicate in system DB
      }
    }

    return {
      id,
      email: cleanEmail,
      avatar: avatar || null,
      created: now,
      updated: now,
    };
  }

  public async authenticateAdmin(email: string, password: string): Promise<AuthResult> {
    const cleanEmail = email.trim().toLowerCase();
    let admin = this.registry
      ? this.registry.getAdminByEmail(cleanEmail)
      : undefined;
    if (!admin) {
      admin = this.db.get<any>('SELECT * FROM _admins WHERE email = ?', [cleanEmail]);
      if (admin && this.registry) {
        try {
          this.registry.getDriver().prepare(`
            INSERT OR REPLACE INTO _admins (id, email, passwordHash, tokenKey, avatar, created, updated)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(admin.id, admin.email, admin.passwordHash, admin.tokenKey, admin.avatar || null, admin.created, admin.updated);
        } catch {}
      }
    }
    if (!admin) {
      throw new UnauthorizedError('Invalid admin credentials');
    }

    const valid = await this.verifyPassword(password, admin.passwordHash);
    if (!valid) {
      throw new UnauthorizedError('Invalid admin credentials');
    }

    const claims: AuthClaims = {
      id: admin.id,
      email: admin.email,
      collection: '_admins',
      tokenKey: admin.tokenKey,
      isAdmin: true,
    };

    const token = this.generateToken(claims, '14d');
    const { passwordHash, tokenKey, ...adminSafe } = admin;

    return {
      token,
      record: adminSafe,
    };
  }

  public getAdminById(id: string): Record<string, any> | undefined {
    let admin = this.registry
      ? this.registry.getAdminById(id)
      : undefined;
    if (!admin) {
      admin = this.db.get<any>('SELECT * FROM _admins WHERE id = ?', [id]);
    }
    if (!admin) return undefined;
    const { passwordHash, tokenKey, ...adminSafe } = admin;
    return adminSafe;
  }

  public async updateAdminPassword(email: string, newPassword: string): Promise<void> {
    const cleanEmail = email.trim().toLowerCase();
    const admin = this.registry
      ? this.registry.getAdminByEmail(cleanEmail)
      : this.db.get<any>('SELECT id FROM _admins WHERE email = ?', [cleanEmail]);
    if (!admin) {
      throw new NotFoundError(`Admin with email '${cleanEmail}' not found`);
    }
    if (!newPassword || newPassword.length < 8) {
      throw new AppError('Password must be at least 8 characters long', 400);
    }
    const passwordHash = await this.hashPassword(newPassword);
    const tokenKey = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    if (this.registry) {
      this.registry.updateAdminPassword(cleanEmail, passwordHash, tokenKey);
    }

    try {
      this.db.prepare(
        'UPDATE _admins SET passwordHash = ?, tokenKey = ?, updated = ? WHERE email = ?'
      ).run(passwordHash, tokenKey, now, cleanEmail);
    } catch {
      // non-fatal if table doesn't exist in app database
    }
  }

  public revokeAdminSessions(idOrEmail: string): void {
    const clean = idOrEmail.trim().toLowerCase();
    const tokenKey = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    let registryFound = false;
    if (this.registry) {
      const regAdmin = this.registry.getAdminById(idOrEmail) || this.registry.getAdminByEmail(clean);
      if (regAdmin) {
        this.registry.revokeAdminSessions(idOrEmail, tokenKey);
        registryFound = true;
      }
    }

    let dbChanges = 0;
    try {
      const result = this.db.prepare(
        'UPDATE _admins SET tokenKey = ?, updated = ? WHERE id = ? OR email = ?'
      ).run(tokenKey, now, idOrEmail, clean);
      dbChanges = Number(result.changes);
    } catch {
      // non-fatal if table doesn't exist in app database
    }

    if (dbChanges === 0 && !registryFound) {
      throw new NotFoundError(`Admin '${idOrEmail}' not found`);
    }
  }

  public revokeRecordSessions(collectionName: string, idOrEmail: string): void {
    const col = this.schemaService.getCollectionOrThrow(collectionName);
    if (col.type !== 'auth') {
      throw new AppError(`Collection '${collectionName}' is not an auth collection`, 400);
    }
    const clean = idOrEmail.trim().toLowerCase();
    const tokenKey = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const result = this.db.prepare(
      `UPDATE "${col.name}" SET tokenKey = ?, updated = ? WHERE id = ? OR email = ?`
    ).run(tokenKey, now, idOrEmail, clean);
    if (result.changes === 0) {
      throw new NotFoundError(`Record '${idOrEmail}' not found in '${collectionName}'`);
    }
  }

  // --- Collection Auth (Users / Customers etc.) ---

  public async authenticateRecord(
    collectionName: string,
    identity: string,
    password: string
  ): Promise<AuthResult> {
    const col = this.schemaService.getCollectionOrThrow(collectionName);
    if (col.type !== 'auth') {
      throw new AppError(`Collection '${collectionName}' is not an auth collection`, 400);
    }

    const cleanIdentity = identity.trim().toLowerCase();
    const record = this.db.get<any>(
      `SELECT * FROM "${col.name}" WHERE email = ?`,
      [cleanIdentity]
    );

    if (!record) {
      throw new UnauthorizedError('Invalid authentication credentials');
    }

    const valid = await this.verifyPassword(password, record.passwordHash);
    if (!valid) {
      throw new UnauthorizedError('Invalid authentication credentials');
    }

    const claims: AuthClaims = {
      id: record.id,
      email: record.email,
      collection: col.name,
      tokenKey: record.tokenKey,
      isAdmin: false,
    };

    const token = this.generateToken(claims, '7d');
    const { passwordHash, tokenKey, ...recordSafe } = record;

    return {
      token,
      record: recordSafe,
    };
  }

  // --- OAuth2 / Social Logins ---

  public listAuthMethods(collectionName: string, redirectUri?: string): { authProviders: AuthMethodProviderInfo[] } {
    const col = this.schemaService.getCollectionOrThrow(collectionName);
    if (col.type !== 'auth') {
      throw new AppError(`Collection '${collectionName}' is not an auth collection`, 400);
    }
    const providers = this.oauthRegistry.listAuthMethods(redirectUri, col.name);
    return {
      authProviders: providers,
    };
  }

  public async authenticateOAuth2(
    collectionName: string,
    providerName: string,
    code: string,
    codeVerifier: string,
    redirectUri?: string,
    createData?: Record<string, any>,
    fileStorageService?: FileStorageService,
    callerAuth?: any,
    state?: string,
    httpContext?: any
  ): Promise<OAuthAuthResult> {
    const col = this.schemaService.getCollectionOrThrow(collectionName);
    if (col.type !== 'auth') {
      throw new AppError(`Collection '${collectionName}' is not an auth collection`, 400);
    }

    const cleanProviderName = providerName.trim().toLowerCase();
    const provider = this.oauthRegistry.getProvider(cleanProviderName);
    if (!provider) {
      throw new AppError(`OAuth2 provider '${cleanProviderName}' is not configured or enabled`, 400);
    }

    if (!state) {
      throw new AppError('OAuth state parameter is required', 400);
    }

    // Validate and consume state before exchanging the code
    const session = this.oauthRegistry.validateAndConsumeState(
      state,
      cleanProviderName,
      col.name,
      codeVerifier,
      redirectUri
    );

    const effectiveRedirectUri = redirectUri || session.redirectUri;

    // 1. Exchange authorization code and code_verifier with provider
    const exchange = await provider.exchangeCode(code, codeVerifier, effectiveRedirectUri);
    const { id: providerUserId, email: rawEmail, name, avatarUrl, isEmailVerified, rawUser } = exchange.profile;
    const cleanEmail = (rawEmail || '').toLowerCase().trim();

    // 2. Check if external auth identity is already linked
    const existingLink = this.db.get<any>(
      'SELECT * FROM _external_auths WHERE collection = ? AND provider = ? AND providerUserId = ?',
      [col.name, cleanProviderName, providerUserId]
    );

    let targetRecord: Record<string, any> | undefined;
    let isNewUser = false;
    const now = new Date().toISOString();

    if (existingLink) {
      targetRecord = this.db.get<any>(`SELECT * FROM "${col.name}" WHERE id = ?`, [existingLink.recordId]);
      if (targetRecord) {
        this.db.prepare('UPDATE _external_auths SET updated = ? WHERE id = ?').run(now, existingLink.id);
      } else {
        this.db.prepare('DELETE FROM _external_auths WHERE id = ?').run(existingLink.id);
      }
    }

    if (!targetRecord) {
      // 3. Check if account with same email already exists
      if (cleanEmail) {
        const existingByEmail = this.db.get<any>(
          `SELECT * FROM "${col.name}" WHERE email = ?`,
          [cleanEmail]
        );

        if (existingByEmail) {
          // Strict policy: provider email MUST be verified to prevent account takeover
          if (!isEmailVerified) {
            throw new AppError(
              `Cannot automatically link ${provider.displayName} account: provider email '${cleanEmail}' is not verified`,
              400
            );
          }

          targetRecord = existingByEmail;
          // Link this external auth to the existing user
          const linkId = `ea_${crypto.randomBytes(6).toString('hex')}`;
          this.db.prepare(`
            INSERT INTO _external_auths (id, collection, recordId, provider, providerUserId, email, created, updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(linkId, col.name, existingByEmail.id, cleanProviderName, providerUserId, cleanEmail || null, now, now);
        }
      }
    }

    // 4. Provision new user if not found
    if (!targetRecord) {
      isNewUser = true;
      const newId = `r_${crypto.randomBytes(6).toString('hex')}`;
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await this.hashPassword(randomPassword);
      const tokenKey = crypto.randomBytes(16).toString('hex');

      let insertRecord: Record<string, any> = {
        id: newId,
        email: cleanEmail || `${cleanProviderName}_${providerUserId}@oauth.nodestack.local`,
        emailVisibility: 0,
        verified: isEmailVerified ? 1 : 0,
        passwordHash,
        tokenKey,
        created: now,
        updated: now,
      };

      const hasNameField = col.schema.some((f) => f.name === 'name');
      if (hasNameField && name) {
        insertRecord.name = name;
      }

      const avatarField = col.schema.find((f) => f.name === 'avatar');
      if (avatarField && avatarUrl) {
        if (avatarField.type === 'file' && fileStorageService) {
          try {
            const avatarRes = await fetch(avatarUrl);
            if (avatarRes.ok) {
              const arrayBuf = await avatarRes.arrayBuffer();
              const buffer = Buffer.from(arrayBuf);
              const mimeType = avatarRes.headers.get('content-type') || 'image/png';
              const ext = mimeType.includes('jpeg') ? '.jpg' : mimeType.includes('gif') ? '.gif' : mimeType.includes('webp') ? '.webp' : '.png';
              const savedMeta = await fileStorageService.saveFile(
                col.id,
                newId,
                `avatar_${cleanProviderName}${ext}`,
                buffer,
                mimeType,
                avatarField.options
              );
              insertRecord.avatar = savedMeta.filename;
            }
          } catch {
            // Non-fatal if avatar download fails
          }
        } else if (avatarField.type === 'text' || avatarField.type === 'url') {
          insertRecord.avatar = avatarUrl;
        }
      }

      if (createData && typeof createData === 'object') {
        const reservedFields = new Set(['id', 'passwordHash', 'tokenKey', 'created', 'updated']);
        for (const [key, val] of Object.entries(createData)) {
          if (!reservedFields.has(key)) {
            insertRecord[key] = val;
          }
        }
      }

      // 1. Trigger lifecycle hook: onRecordBeforeCreate
      const effectiveEventBus = this.eventBus || (httpContext as any)?.appScope?.eventBus;
      if (effectiveEventBus) {
        insertRecord = await effectiveEventBus.triggerRecordBeforeCreate(
          col.name,
          insertRecord,
          callerAuth,
          httpContext
        );
      }

      // 2. Enforce collection schema validation semantics before insertion
      for (const field of col.schema) {
        const val = insertRecord[field.name];
        RecordValidator.validateField(field, val);
        insertRecord[field.name] = RecordValidator.normalizeFieldValue(field, val);
      }

      // 3. Enforce collection create authorization rule semantics
      const isAllowed = this.ruleEngine.evaluate(col.createRule, {
        auth: callerAuth,
        data: insertRecord,
      });

      if (!isAllowed) {
        if (col.createRule === null) {
          throw new ForbiddenError(`Public registration is disabled for collection '${collectionName}'`);
        }
        throw new ForbiddenError(`You are not allowed to create records in '${collectionName}'`);
      }

      // 4. Insert into database
      const columns = Object.keys(insertRecord).map((k) => `"${k}"`);
      const placeholders = Object.keys(insertRecord).map(() => '?');
      const values = Object.values(insertRecord);

      this.db.prepare(`
        INSERT INTO "${col.name}" (${columns.join(', ')})
        VALUES (${placeholders.join(', ')})
      `).run(...values);

      // 5. Link external social identity
      const linkId = `ea_${crypto.randomBytes(6).toString('hex')}`;
      this.db.prepare(`
        INSERT INTO _external_auths (id, collection, recordId, provider, providerUserId, email, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(linkId, col.name, newId, cleanProviderName, providerUserId, cleanEmail || null, now, now);

      targetRecord = insertRecord;

      // 6. Trigger lifecycle hook: onRecordAfterCreate
      if (effectiveEventBus) {
        const hookRecord = { ...insertRecord, password: '[SET]' };
        await effectiveEventBus.triggerRecordAfterCreate(
          col.name,
          hookRecord,
          callerAuth,
          httpContext
        );
      }

      // 7. Broadcast realtime event
      const effectiveRealtime = this.realtimeService || (httpContext as any)?.appScope?.realtime;
      if (effectiveRealtime) {
        const { passwordHash: _, tokenKey: __, ...publicRecord } = insertRecord;
        effectiveRealtime.broadcast('create', col.name, publicRecord);
      }
    }

    if (!targetRecord) {
      throw new AppError('Failed to resolve authenticated user', 500);
    }

    // 5. Issue JWT session token
    const claims: AuthClaims = {
      id: targetRecord.id,
      email: targetRecord.email,
      collection: col.name,
      tokenKey: targetRecord.tokenKey,
      isAdmin: false,
    };

    const token = this.generateToken(claims, '7d');
    const { passwordHash: _, tokenKey: __, ...recordSafe } = targetRecord;

    return {
      token,
      record: recordSafe,
      meta: {
        provider: cleanProviderName,
        isNew: isNewUser,
        providerUserId,
        rawUser,
      },
    };
  }

  public getExternalAuths(collectionName: string, recordId: string): ExternalAuthModel[] {
    const rows = this.db.all<any>(
      'SELECT * FROM _external_auths WHERE collection = ? AND recordId = ? ORDER BY created ASC',
      [collectionName, recordId]
    );
    return rows;
  }

  public unlinkExternalAuth(collectionName: string, recordId: string, provider: string): void {
    const result = this.db.run(
      'DELETE FROM _external_auths WHERE collection = ? AND recordId = ? AND provider = ?',
      [collectionName, recordId, provider.toLowerCase()]
    );
    if (result.changes === 0) {
      throw new NotFoundError(`External auth '${provider}' not linked to record '${recordId}'`);
    }
  }
}
