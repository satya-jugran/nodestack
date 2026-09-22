import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../database/DatabaseService';
import { ConfigService } from '../core/config/ConfigService';
import { SchemaService } from '../schema/SchemaService';
import { AppError, ConflictError, NotFoundError, UnauthorizedError } from '../core/errors/AppError';

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
    private schemaService: SchemaService
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
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as AuthClaims;
      return decoded;
    } catch {
      throw new UnauthorizedError('Invalid or expired authentication token');
    }
  }

  // --- Admin Auth ---

  public hasAdmins(): boolean {
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
    const admin = this.db.get<any>('SELECT * FROM _admins WHERE email = ?', [cleanEmail]);
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
    const admin = this.db.get<any>('SELECT * FROM _admins WHERE id = ?', [id]);
    if (!admin) return undefined;
    const { passwordHash, tokenKey, ...adminSafe } = admin;
    return adminSafe;
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
