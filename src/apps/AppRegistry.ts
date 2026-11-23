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
    this.initSync();
  }

  public getDriver(): IDatabaseDriver {
    return this.driver;
  }

  public initSync(): void {
    if (this.driver instanceof NodeSqliteDriver) {
      this.driver.execSync(`
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
          verified INTEGER NOT NULL DEFAULT 0,
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
      `);
      try { this.driver.execSync('ALTER TABLE _admins ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;'); } catch {}

      const defaultExists = this.driver.prepareSync('SELECT id FROM _apps WHERE slug = ? OR isDefault = 1').get('default');
      if (!defaultExists) {
        const now = new Date().toISOString();
        this.driver.prepareSync(`
          INSERT INTO _apps (id, name, slug, description, icon, isDefault, created, updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run('app_default', 'Default App', 'default', 'Default system application', 'zap', 1, now, now);
      }

      const demoExists = this.driver.prepareSync('SELECT id FROM _apps WHERE slug = ?').get('ecommerce-demo');
      if (!demoExists) {
        const now = new Date().toISOString();
        this.driver.prepareSync(`
          INSERT INTO _apps (id, name, slug, description, icon, isDefault, created, updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'app_ecommerce_demo',
          'E-Commerce Demo',
          'ecommerce-demo',
          'Retail storefront showcase pre-seeded with catalog, serverless lambdas, and event-driven flows',
          'shopping-bag',
          0,
          now,
          now
        );
      }
    }
  }

  public async init(): Promise<void> {
    const dialect = this.driver.dialect;
    const pk = dialect ? dialect.mapFieldType('text', { isPrimaryKey: true }) : 'TEXT';
    const unq = dialect ? dialect.mapFieldType('text', { isUnique: true }) : 'TEXT';
    const txt = dialect ? dialect.mapFieldType('text') : 'TEXT';
    const bool = dialect ? dialect.mapFieldType('bool') : 'INTEGER';
    const boolFalse = dialect ? dialect.booleanLiteral(false) : '0';

    if (dialect) {
      await this.driver.exec(
        dialect.createTableIfNotExists(
          '_apps',
          `
        id ${pk} PRIMARY KEY,
        name ${txt} NOT NULL,
        slug ${unq} UNIQUE NOT NULL,
        description ${txt} NOT NULL DEFAULT '',
        icon ${txt} NOT NULL DEFAULT 'cube',
        isDefault ${bool} NOT NULL DEFAULT ${boolFalse},
        created ${txt} NOT NULL,
        updated ${txt} NOT NULL
      `
        )
      );
      try {
        await this.driver.exec(dialect.createIndexIfNotExists('idx_apps_slug', '_apps', 'slug'));
      } catch {}

      await this.driver.exec(
        dialect.createTableIfNotExists(
          '_admins',
          `
        id ${pk} PRIMARY KEY,
        email ${unq} UNIQUE NOT NULL,
        passwordHash ${txt} NOT NULL,
        tokenKey ${txt} NOT NULL,
        avatar ${txt},
        verified ${bool} NOT NULL DEFAULT ${boolFalse},
        created ${txt} NOT NULL,
        updated ${txt} NOT NULL
      `
        )
      );
      try {
        const alterSql = dialect.addColumnSql('_admins', `verified ${bool} NOT NULL DEFAULT ${boolFalse}`);
        await this.driver.exec(alterSql);
      } catch {}
    } else {
      await this.driver.exec(`
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
          verified INTEGER NOT NULL DEFAULT 0,
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
      `);
      try {
        await this.driver.exec('ALTER TABLE _admins ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;');
      } catch {}
    }

    const isDefaultVal = (dialect && dialect.name === 'postgres') ? true : 1;
    const defaultExists = await this.driver.prepare('SELECT id FROM _apps WHERE slug = ? OR isDefault = 1').get('default');
    if (!defaultExists) {
      const now = new Date().toISOString();
      await this.driver.prepare(`
        INSERT INTO _apps (id, name, slug, description, icon, isDefault, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('app_default', 'Default App', 'default', 'Default system application', 'zap', isDefaultVal, now, now);
    }
  }

  public getAllAppsSync(): AppModel[] {
    if (this.driver instanceof NodeSqliteDriver) {
      const rows = this.driver.prepareSync('SELECT * FROM _apps ORDER BY isDefault DESC, name ASC').all<any>();
      return rows.map((r) => this.mapRow(r));
    }
    return [this.getDefaultAppModel()];
  }

  public getDefaultAppModel(): AppModel {
    const now = new Date().toISOString();
    return {
      id: 'app_default',
      name: 'Default App',
      slug: 'default',
      description: 'Default system application',
      icon: 'zap',
      isDefault: true,
      created: now,
      updated: now,
    };
  }

  public getAppSync(slugOrId: string): AppModel | undefined {
    if (this.driver instanceof NodeSqliteDriver) {
      const row = this.driver.prepareSync('SELECT * FROM _apps WHERE id = ? OR slug = ?').get<any>(slugOrId, slugOrId);
      if (!row) return undefined;
      return this.mapRow(row);
    }
    if (slugOrId === 'default' || slugOrId === 'app_default') {
      return this.getDefaultAppModel();
    }
    return undefined;
  }

  public async getAllApps(): Promise<AppModel[]> {
    const rows = await this.driver.prepare('SELECT * FROM _apps ORDER BY isDefault DESC, name ASC').all<any>();
    return (rows || []).map((r: any) => this.mapRow(r));
  }

  public async getApp(slugOrId: string): Promise<AppModel | undefined> {
    const row = await this.driver.prepare('SELECT * FROM _apps WHERE id = ? OR slug = ?').get<any>(slugOrId, slugOrId);
    if (!row) return undefined;
    return this.mapRow(row);
  }

  public async getAppOrThrow(slugOrId: string): Promise<AppModel> {
    const app = await this.getApp(slugOrId);
    if (!app) {
      throw new NotFoundError(`Application '${slugOrId}' not found`);
    }
    return app;
  }

  public async createApp(dto: CreateAppDto): Promise<AppModel> {
    const name = (dto.name || '').trim();
    if (!name) {
      throw new AppError('Application name is required', 400);
    }

    const slug = (dto.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).trim();
    if (!slug || !/^[a-z0-9-_]+$/.test(slug)) {
      throw new AppError('Application slug must only contain lowercase alphanumeric characters, hyphens, and underscores', 400);
    }

    const existing = await this.getApp(slug);
    if (existing) {
      throw new ConflictError(`Application with slug '${slug}' already exists`);
    }

    const id = dto.slug === 'ecommerce-demo' ? 'app_ecommerce_demo' : `app_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const description = (dto.description || '').trim();
    const icon = (dto.icon || 'cube').trim();

    await this.driver.prepare(`
      INSERT INTO _apps (id, name, slug, description, icon, isDefault, created, updated)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, name, slug, description, icon, now, now);

    return await this.getAppOrThrow(id);
  }

  public async updateApp(slugOrId: string, dto: UpdateAppDto): Promise<AppModel> {
    const current = await this.getAppOrThrow(slugOrId);
    const name = dto.name !== undefined ? dto.name.trim() : current.name;
    const description = dto.description !== undefined ? dto.description.trim() : current.description;
    const icon = dto.icon !== undefined ? dto.icon.trim() : current.icon;
    const now = new Date().toISOString();

    if (!name) {
      throw new AppError('Application name cannot be empty', 400);
    }

    await this.driver.prepare(`
      UPDATE _apps
      SET name = ?, description = ?, icon = ?, updated = ?
      WHERE id = ?
    `).run(name, description, icon, now, current.id);

    return await this.getAppOrThrow(current.id);
  }

  public async deleteApp(slugOrId: string): Promise<AppModel> {
    if (slugOrId === 'default') {
      throw new AppError('Cannot delete the default application', 400);
    }
    const app = await this.getAppOrThrow(slugOrId);
    if (app.isDefault || app.slug === 'default') {
      throw new AppError('Cannot delete the default application', 400);
    }
    await this.driver.prepare('DELETE FROM _apps WHERE id = ?').run(app.id);
    return app;
  }

  // ==========================================
  // Super-Admin Methods (Global)
  // ==========================================

  public async hasAdmins(): Promise<boolean> {
    const row = await this.driver.prepare('SELECT COUNT(*) as count FROM _admins').get<any>();
    return Boolean(row && Number(row.count) > 0);
  }

  public async getAdminByEmail(email: string): Promise<any> {
    return await this.driver.prepare('SELECT * FROM _admins WHERE email = ?').get<any>(email.toLowerCase().trim());
  }

  public async getAdminById(id: string): Promise<any> {
    return await this.driver.prepare('SELECT * FROM _admins WHERE id = ?').get<any>(id);
  }

  public async getAllAdmins(): Promise<any[]> {
    return await this.driver.prepare('SELECT id, email, avatar, created, updated FROM _admins ORDER BY created ASC').all<any>();
  }

  public async createAdmin(email: string, passwordHash: string, tokenKey: string): Promise<any> {
    const cleanEmail = email.toLowerCase().trim();
    const existing = await this.getAdminByEmail(cleanEmail);
    if (existing) {
      throw new ConflictError(`Admin with email '${cleanEmail}' already exists`);
    }

    const id = `adm_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    await this.driver.prepare(`
      INSERT INTO _admins (id, email, passwordHash, tokenKey, avatar, created, updated)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run(id, cleanEmail, passwordHash, tokenKey, now, now);

    return await this.getAdminById(id);
  }

  public async updateAdminTokenKey(id: string, tokenKey: string): Promise<any> {
    const now = new Date().toISOString();
    return await this.driver.prepare('UPDATE _admins SET tokenKey = ?, updated = ? WHERE id = ?').run(tokenKey, now, id);
  }

  public async updateAdminPassword(emailOrId: string, passwordHash: string, tokenKey: string): Promise<any> {
    const clean = emailOrId.toLowerCase().trim();
    const now = new Date().toISOString();
    return await this.driver.prepare(
      'UPDATE _admins SET passwordHash = ?, tokenKey = ?, updated = ? WHERE email = ? OR id = ?'
    ).run(passwordHash, tokenKey, now, clean, clean);
  }

  public async revokeAdminSessions(idOrEmail: string, tokenKey: string): Promise<any> {
    const clean = idOrEmail.toLowerCase().trim();
    const now = new Date().toISOString();
    return await this.driver.prepare(
      'UPDATE _admins SET tokenKey = ?, updated = ? WHERE id = ? OR email = ?'
    ).run(tokenKey, now, idOrEmail, clean);
  }

  public async updateAdminVerified(id: string, verified: boolean): Promise<any> {
    const now = new Date().toISOString();
    const verifiedVal = this.driver.dialect?.name === 'postgres' ? Boolean(verified) : (verified ? 1 : 0);
    return await this.driver.prepare('UPDATE _admins SET verified = ?, updated = ? WHERE id = ?').run(verifiedVal, now, id);
  }

  public async close(): Promise<void> {
    try {
      await this.driver.close();
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
