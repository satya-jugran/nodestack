import { IDatabaseDriver } from '../drivers/IDatabaseDriver';

export class SystemMigrations {
  public static run(driver: IDatabaseDriver): void {
    driver.transaction(() => {
      // 1. Collections metadata table
      driver.exec(`
        CREATE TABLE IF NOT EXISTS _collections (
          id TEXT PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          type TEXT NOT NULL DEFAULT 'base',
          system INTEGER NOT NULL DEFAULT 0,
          schema TEXT NOT NULL DEFAULT '[]',
          indexes TEXT NOT NULL DEFAULT '[]',
          listRule TEXT,
          viewRule TEXT,
          createRule TEXT,
          updateRule TEXT,
          deleteRule TEXT,
          options TEXT NOT NULL DEFAULT '{}',
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
      `);

      // 2. Admins table
      driver.exec(`
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

      // 3. Request & traffic logs table
      driver.exec(`
        CREATE TABLE IF NOT EXISTS _logs (
          id TEXT PRIMARY KEY,
          method TEXT NOT NULL,
          url TEXT NOT NULL,
          status INTEGER NOT NULL,
          duration REAL NOT NULL,
          ip TEXT,
          authId TEXT,
          authCollection TEXT,
          userAgent TEXT,
          data TEXT,
          created TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_logs_created ON _logs(created DESC);
      `);

      // 4. Key-value parameters / settings table
      driver.exec(`
        CREATE TABLE IF NOT EXISTS _params (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      // Create default "users" auth collection if not already existing
      const usersExists = driver.prepare('SELECT id FROM _collections WHERE name = ?').get('users');
      if (!usersExists) {
        const now = new Date().toISOString();
        const userSchema = JSON.stringify([
          { id: 'f_name', name: 'name', type: 'text', required: false, unique: false },
          { id: 'f_avatar', name: 'avatar', type: 'file', required: false, unique: false, options: { maxSelect: 1, maxSize: 5242880, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } }
        ]);
        const userOptions = JSON.stringify({
          allowEmailAuth: true,
          requireEmailVerification: false,
          minPasswordLength: 8,
        });

        driver.prepare(`
          INSERT INTO _collections (
            id, name, type, system, schema, indexes, listRule, viewRule, createRule, updateRule, deleteRule, options, created, updated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'c_users_default',
          'users',
          'auth',
          0,
          userSchema,
          '[]',
          'id = @request.auth.id',
          'id = @request.auth.id',
          '', // open signup by default
          'id = @request.auth.id',
          'id = @request.auth.id',
          userOptions,
          now,
          now
        );

        // Create the actual users SQLite table
        driver.exec(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            emailVisibility INTEGER NOT NULL DEFAULT 0,
            verified INTEGER NOT NULL DEFAULT 0,
            passwordHash TEXT NOT NULL,
            tokenKey TEXT NOT NULL,
            name TEXT,
            avatar TEXT,
            created TEXT NOT NULL,
            updated TEXT NOT NULL
          );
        `);
      }
    });
  }
}
