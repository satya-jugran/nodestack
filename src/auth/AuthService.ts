import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../database/DatabaseService';
import { ConfigService } from '../core/config/ConfigService';
import { SchemaService } from '../schema/SchemaService';
import { AppError, ConflictError, NotFoundError, UnauthorizedError } from '../core/errors/AppError';
import { AppRegistry } from '../apps/AppRegistry';

export interface AuthClaims {
  id: string;
  email: string;
  collection: string;
  tokenKey: string;
  isAdmin: boolean;
}

export interface AuthResult {
  token: string;
  record: Record<string, any>;
}

export class AuthService {
  constructor(
    private db: DatabaseService,
    private config: ConfigService,
    private schemaService: SchemaService,
    private registry?: AppRegistry
  ) {}

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
}
