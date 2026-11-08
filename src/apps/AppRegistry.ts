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
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
      `);

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
        created TEXT NOT NULL,
        updated TEXT NOT NULL
      );
    `);

    const defaultExists = await this.driver.prepare('SELECT id FROM _apps WHERE slug = ? OR isDefault = 1').get('default');
    if (!defaultExists) {
      const now = new Date().toISOString();
      await this.driver.prepare(`
        INSERT INTO _apps (id, name, slug, description, icon, isDefault, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('app_default', 'Default App', 'default', 'Default system application', 'zap', 1, now, now);
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

  public getAllApps(): any {
    const rows: any = this.driver.prepare('SELECT * FROM _apps ORDER BY isDefault DESC, name ASC').all<any>();
    if (rows instanceof Promise) {
      return rows.then((r: any[]) => r.map((x: any) => this.mapRow(x)));
    }
    return (rows || []).map((r: any) => this.mapRow(r));
  }

  public getApp(slugOrId: string): any {
    const row = this.driver.prepare('SELECT * FROM _apps WHERE id = ? OR slug = ?').get<any>(slugOrId, slugOrId);
    if (row instanceof Promise) {
      return row.then((r) => (!r ? undefined : this.mapRow(r)));
    }
    if (!row) return undefined;
    return this.mapRow(row);
  }

  public getAppOrThrow(slugOrId: string): any {
    const app = this.getApp(slugOrId);
    if (app instanceof Promise) {
      return app.then((a) => {
        if (!a) throw new NotFoundError(`Application '${slugOrId}' not found`);
        return a;
      });
    }
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

  public deleteApp(slugOrId: string): any {
    if (slugOrId === 'default') {
      throw new AppError('Cannot delete the default application', 400);
    }
    const current = this.getAppOrThrow(slugOrId);
    const handleDelete = (app: AppModel) => {
      if (app.isDefault || app.slug === 'default') {
        throw new AppError('Cannot delete the default application', 400);
      }
      const res = this.driver.prepare('DELETE FROM _apps WHERE id = ?').run(app.id);
      if (res && typeof (res as any).then === 'function') {
        return (res as any).then(() => app);
      }
      return app;
    };

    if (current && typeof (current as any).then === 'function') {
      return (current as any).then(handleDelete);
    }
    return handleDelete(current);
  }

  // ==========================================
  // Super-Admin Methods (Global)
  // ==========================================

  public hasAdmins(): any {
    const row: any = this.driver.prepare('SELECT COUNT(*) as count FROM _admins').get<any>();
    if (row && typeof row.then === 'function') {
      return row.then((r: any) => Boolean(r && Number(r.count) > 0));
    }
    return Boolean(row && Number(row.count) > 0);
  }

  public getAdminByEmail(email: string): any {
    return this.driver.prepare('SELECT * FROM _admins WHERE email = ?').get<any>(email.toLowerCase().trim());
  }

  public getAdminById(id: string): any {
    return this.driver.prepare('SELECT * FROM _admins WHERE id = ?').get<any>(id);
  }

  public getAllAdmins(): any {
    return this.driver.prepare('SELECT id, email, avatar, created, updated FROM _admins ORDER BY created ASC').all<any>();
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

  public updateAdminTokenKey(id: string, tokenKey: string): any {
    const now = new Date().toISOString();
    return this.driver.prepare('UPDATE _admins SET tokenKey = ?, updated = ? WHERE id = ?').run(tokenKey, now, id);
  }

  public updateAdminPassword(emailOrId: string, passwordHash: string, tokenKey: string): any {
    const clean = emailOrId.toLowerCase().trim();
    const now = new Date().toISOString();
    return this.driver.prepare(
      'UPDATE _admins SET passwordHash = ?, tokenKey = ?, updated = ? WHERE email = ? OR id = ?'
    ).run(passwordHash, tokenKey, now, clean, clean);
  }

  public revokeAdminSessions(idOrEmail: string, tokenKey: string): any {
    const clean = idOrEmail.toLowerCase().trim();
    const now = new Date().toISOString();
    return this.driver.prepare(
      'UPDATE _admins SET tokenKey = ?, updated = ? WHERE id = ? OR email = ?'
    ).run(tokenKey, now, idOrEmail, clean);
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
