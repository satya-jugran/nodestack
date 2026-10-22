import * as crypto from 'crypto';
import { IDatabaseDriver } from '../database/drivers/IDatabaseDriver';
import { NodeSqliteDriver } from '../database/drivers/NodeSqliteDriver';
import { ConfigService } from '../core/config/ConfigService';
import { AppModel, CreateAppDto, UpdateAppDto } from './models/App';
import { AppError, ConflictError, NotFoundError } from '../core/errors/AppError';

export class AppRegistry {
  private driver: IDatabaseDriver;

  constructor(private config: ConfigService, customDriver?: IDatabaseDriver) {
    if (customDriver) {
      this.driver = customDriver;
    } else {
      this.driver = new NodeSqliteDriver(config.systemDbPath);
    }
    this.init();
  }

  public getDriver(): IDatabaseDriver {
    return this.driver;
  }

  public init(): void {
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS _apps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT 'cube',
        isDefault INTEGER NOT NULL DEFAULT 0,
        created TEXT NOT NULL,
        updated TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_apps_slug ON _apps(slug);

      CREATE TABLE IF NOT EXISTS _admins (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL,
        tokenKey TEXT NOT NULL,
        avatar TEXT,
        created TEXT NOT NULL,
        updated TEXT NOT NULL
      );
    `);

    // Ensure default application exists
    const defaultExists = this.driver.prepare('SELECT id FROM _apps WHERE slug = ? OR isDefault = 1').get('default');
    if (!defaultExists) {
      const now = new Date().toISOString();
      this.driver.prepare(`
        INSERT INTO _apps (id, name, slug, description, icon, isDefault, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'app_default',
        'Default App',
        'default',
        'Default system application',
        'zap',
        1,
        now,
        now
      );
    }
  }

  public getAllApps(): AppModel[] {
    const rows = this.driver.prepare('SELECT * FROM _apps ORDER BY isDefault DESC, name ASC').all<any>();
    return rows.map((r) => this.mapRow(r));
  }

  public getApp(slugOrId: string): AppModel | undefined {
    const row = this.driver.prepare('SELECT * FROM _apps WHERE id = ? OR slug = ?').get<any>(slugOrId, slugOrId);
    if (!row) return undefined;
    return this.mapRow(row);
  }

  public getAppOrThrow(slugOrId: string): AppModel {
    const app = this.getApp(slugOrId);
    if (!app) {
      throw new NotFoundError(`Application '${slugOrId}' not found`);
    }
    return app;
  }

  public createApp(dto: CreateAppDto): AppModel {
    const name = (dto.name || '').trim();
    if (!name) {
      throw new AppError('Application name is required', 400);
    }

    const slug = (dto.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).trim();
    if (!slug || !/^[a-z0-9-_]+$/.test(slug)) {
      throw new AppError('Application slug must only contain lowercase alphanumeric characters, hyphens, and underscores', 400);
    }

    const existing = this.getApp(slug);
    if (existing) {
      throw new ConflictError(`Application with slug '${slug}' already exists`);
    }

    const id = `app_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const description = (dto.description || '').trim();
    const icon = (dto.icon || 'cube').trim();

    this.driver.prepare(`
      INSERT INTO _apps (id, name, slug, description, icon, isDefault, created, updated)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, name, slug, description, icon, now, now);

    return this.getAppOrThrow(id);
  }

  public updateApp(slugOrId: string, dto: UpdateAppDto): AppModel {
    const current = this.getAppOrThrow(slugOrId);
    const name = dto.name !== undefined ? dto.name.trim() : current.name;
    const description = dto.description !== undefined ? dto.description.trim() : current.description;
    const icon = dto.icon !== undefined ? dto.icon.trim() : current.icon;
    const now = new Date().toISOString();

    if (!name) {
      throw new AppError('Application name cannot be empty', 400);
    }

    this.driver.prepare(`
      UPDATE _apps
      SET name = ?, description = ?, icon = ?, updated = ?
      WHERE id = ?
    `).run(name, description, icon, now, current.id);

    return this.getAppOrThrow(current.id);
  }

  public deleteApp(slugOrId: string): AppModel {
    const current = this.getAppOrThrow(slugOrId);
    if (current.isDefault || current.slug === 'default') {
      throw new AppError('Cannot delete the default application', 400);
    }

    this.driver.prepare('DELETE FROM _apps WHERE id = ?').run(current.id);
    return current;
  }

  // ==========================================
  // Super-Admin Methods (Global)
  // ==========================================

  public hasAdmins(): boolean {
    const row = this.driver.prepare('SELECT COUNT(*) as count FROM _admins').get<any>();
    return Boolean(row && row.count > 0);
  }

  public getAdminByEmail(email: string): any {
    return this.driver.prepare('SELECT * FROM _admins WHERE email = ?').get<any>(email.toLowerCase().trim());
  }

  public getAdminById(id: string): any {
    return this.driver.prepare('SELECT * FROM _admins WHERE id = ?').get<any>(id);
  }

  public getAllAdmins(): any[] {
    return this.driver.prepare('SELECT id, email, avatar, created, updated FROM _admins ORDER BY created ASC').all<any>();
  }

  public createAdmin(email: string, passwordHash: string, tokenKey: string): any {
    const cleanEmail = email.toLowerCase().trim();
    const existing = this.getAdminByEmail(cleanEmail);
    if (existing) {
      throw new ConflictError(`Admin with email '${cleanEmail}' already exists`);
    }

    const id = `adm_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    this.driver.prepare(`
      INSERT INTO _admins (id, email, passwordHash, tokenKey, avatar, created, updated)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run(id, cleanEmail, passwordHash, tokenKey, now, now);

    return this.getAdminById(id);
  }

  public updateAdminTokenKey(id: string, tokenKey: string): void {
    const now = new Date().toISOString();
    this.driver.prepare('UPDATE _admins SET tokenKey = ?, updated = ? WHERE id = ?').run(tokenKey, now, id);
  }

  public updateAdminPassword(emailOrId: string, passwordHash: string, tokenKey: string): void {
    const clean = emailOrId.toLowerCase().trim();
    const now = new Date().toISOString();
    this.driver.prepare(
      'UPDATE _admins SET passwordHash = ?, tokenKey = ?, updated = ? WHERE email = ? OR id = ?'
    ).run(passwordHash, tokenKey, now, clean, clean);
  }

  public revokeAdminSessions(idOrEmail: string, tokenKey: string): void {
    const clean = idOrEmail.toLowerCase().trim();
    const now = new Date().toISOString();
    this.driver.prepare(
      'UPDATE _admins SET tokenKey = ?, updated = ? WHERE id = ? OR email = ?'
    ).run(tokenKey, now, idOrEmail, clean);
  }

  public close(): void {
    try {
      this.driver.close();
    } catch {
      // ignore
    }
  }

  private mapRow(r: any): AppModel {
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description || '',
      icon: r.icon || 'cube',
      isDefault: Boolean(r.isDefault),
      created: r.created,
      updated: r.updated,
    };
  }
}
