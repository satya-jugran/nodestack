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

      // 5. Data mutation audit logs table
      driver.exec(`
        CREATE TABLE IF NOT EXISTS _audit_logs (
          id TEXT PRIMARY KEY,
          collection TEXT NOT NULL,
          recordId TEXT NOT NULL,
          action TEXT NOT NULL,
          diff TEXT NOT NULL,
          changedFields TEXT NOT NULL,
          authId TEXT,
          authEmail TEXT,
          authCollection TEXT,
          isAdmin INTEGER NOT NULL DEFAULT 0,
          ip TEXT,
          userAgent TEXT,
          created TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_record ON _audit_logs(collection, recordId, created DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON _audit_logs(created DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON _audit_logs(action);
      `);

      // 6. Outbound Webhooks and Delivery Logs
      driver.exec(`
        CREATE TABLE IF NOT EXISTS _webhooks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          event TEXT NOT NULL,
          collection TEXT NOT NULL,
          action TEXT NOT NULL DEFAULT '*',
          method TEXT NOT NULL DEFAULT 'POST',
          headers TEXT,
          secret TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_webhooks_collection ON _webhooks(collection);
        CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON _webhooks(enabled);

        CREATE TABLE IF NOT EXISTS _webhook_deliveries (
          id TEXT PRIMARY KEY,
          webhookId TEXT NOT NULL,
          webhookName TEXT NOT NULL,
          url TEXT NOT NULL,
          event TEXT NOT NULL,
          collection TEXT NOT NULL,
          recordId TEXT,
          requestHeaders TEXT NOT NULL,
          requestPayload TEXT NOT NULL,
          responseStatus INTEGER NOT NULL DEFAULT 0,
          responseHeaders TEXT,
          responseBody TEXT,
          durationMs INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          error TEXT,
          attempt INTEGER NOT NULL DEFAULT 1,
          created TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_webhook_del_wh ON _webhook_deliveries(webhookId, created DESC);
        CREATE INDEX IF NOT EXISTS idx_webhook_del_created ON _webhook_deliveries(created DESC);
        CREATE INDEX IF NOT EXISTS idx_webhook_del_status ON _webhook_deliveries(status);
      `);

      // 7. External OAuth2 Linked Accounts
      driver.exec(`
        CREATE TABLE IF NOT EXISTS _external_auths (
          id TEXT PRIMARY KEY,
          collection TEXT NOT NULL,
          recordId TEXT NOT NULL,
          provider TEXT NOT NULL,
          providerUserId TEXT NOT NULL,
          email TEXT,
          created TEXT NOT NULL,
          updated TEXT NOT NULL,
          UNIQUE(collection, provider, providerUserId)
        );
        CREATE INDEX IF NOT EXISTS idx_ext_auth_rec ON _external_auths(collection, recordId);
        CREATE INDEX IF NOT EXISTS idx_ext_auth_prov ON _external_auths(provider, providerUserId);
      `);

      // 8. API Keys & Machine-to-Machine (M2M) Service Accounts
      driver.exec(`
        CREATE TABLE IF NOT EXISTS _api_keys (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          keyPrefix TEXT NOT NULL,
          secretHash TEXT NOT NULL,
          redactedKey TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'service',
          scopes TEXT NOT NULL DEFAULT '[]',
          allowedIps TEXT NOT NULL DEFAULT '[]',
          expiresAt TEXT,
          lastUsedAt TEXT,
          lastUsedIp TEXT,
          totalRequests INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          createdBy TEXT,
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_prefix ON _api_keys(keyPrefix);
        CREATE INDEX IF NOT EXISTS idx_api_keys_status ON _api_keys(status);
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
          '',
          '',
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
