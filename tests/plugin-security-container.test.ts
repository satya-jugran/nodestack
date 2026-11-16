import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { INodeStackPlugin, NodeStackPluginContext, PluginContext } from '../src/core/plugins/types';
import { TOKENS } from '../src/core/container/Tokens';

describe('Plugin Security: Principle of Least Privilege (PoLP) PluginContext & Core Token Protection', () => {
  const testDataDir = path.join(__dirname, '.test_plugin_security_data_' + Date.now());
  let app: NodeStack;

  beforeEach(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    if (app) {
      await app.stop().catch(() => {});
    }
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('should provide restricted PluginContext to plugin.onRegister and plugin.register adhering to PoLP', () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8210 });
    let receivedCtx: PluginContext | null = null;

    const testPlugin: INodeStackPlugin = {
      name: 'polp-inspection-plugin',
      onRegister(ctx) {
        receivedCtx = ctx;
      },
    };

    app.use(testPlugin);

    expect(receivedCtx).toBeDefined();

    // 1. Verify container and internal token catalog are completely absent
    expect((receivedCtx as any).container).toBeUndefined();
    expect((receivedCtx as any).tokens).toBeUndefined();

    // 2. Verify adminUi and router.raw are absent
    expect((receivedCtx as any).adminUi).toBeUndefined();
    expect((receivedCtx?.router as any).raw).toBeUndefined();

    // 3. Verify app facade does NOT expose host container, stop, server, defaultApp, or raw PluginManager
    expect((receivedCtx?.app as any).container).toBeUndefined();
    expect((receivedCtx?.app as any).stop).toBeUndefined();
    expect((receivedCtx?.app as any).server).toBeUndefined();
    expect((receivedCtx?.app as any).maintenanceGate).toBeUndefined();
    expect((receivedCtx?.app as any).defaultApp).toBeUndefined();

    // 4. Verify app.plugins is a restricted facade and does NOT expose container, app, use, or disposeScope
    expect((receivedCtx?.app?.plugins as any).container).toBeUndefined();
    expect((receivedCtx?.app?.plugins as any).app).toBeUndefined();
    expect((receivedCtx?.app?.plugins as any).use).toBeUndefined();
    expect((receivedCtx?.app?.plugins as any).disposeScope).toBeUndefined();
    expect(typeof receivedCtx?.app?.plugins?.getEffectiveConfig).toBe('function');

    // 5. Verify eventBus does NOT expose clear()
    expect((receivedCtx?.eventBus as any).clear).toBeUndefined();

    // 6. Verify legitimate capabilities ARE present
    expect(receivedCtx?.app).toBeDefined();
    expect(receivedCtx?.db).toBeDefined();
    expect(receivedCtx?.schema).toBeDefined();
    expect(receivedCtx?.config).toBeDefined();
    expect(receivedCtx?.records).toBeDefined();
    expect(typeof receivedCtx?.getService).toBe('function');
    expect(typeof receivedCtx?.bindService).toBe('function');
    expect(typeof receivedCtx?.eventBus.on).toBe('function');
    expect(typeof receivedCtx?.eventBus.emit).toBe('function');
  });

  it('should prevent plugins from overriding AuthService via ctx.bindService in onRegister', () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8211 });

    const maliciousAuthService = {
      authenticate: () => ({ id: 'hacked', role: 'superadmin' }),
    };

    const maliciousPlugin: INodeStackPlugin = {
      name: 'malicious-auth-override-bindservice',
      onRegister(ctx) {
        ctx.bindService(TOKENS.AuthService, maliciousAuthService as any);
      },
    };

    expect(() => {
      app.use(maliciousPlugin);
    }).toThrow(/Cannot override core service token: AuthService/i);

    // Ensure authentic AuthService was NOT replaced
    expect(app.container.get(TOKENS.AuthService)).toBe(app.auth);
  });

  it('should prevent plugins from overriding DatabaseService via ctx.bindService in register', () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8212 });

    const maliciousDb = {
      run: () => {},
      all: () => [],
    };

    const maliciousPlugin: INodeStackPlugin = {
      name: 'malicious-db-override',
      register(ctx) {
        ctx.bindService(TOKENS.DatabaseService, maliciousDb as any);
      },
    };

    expect(() => {
      app.use(maliciousPlugin);
    }).toThrow(/Cannot override core service token: DatabaseService/i);

    expect(app.container.get(TOKENS.DatabaseService)).toBe(app.db);
  });

  it('should ensure custom string tokens do not shadow or compromise core symbol-keyed services', () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8213 });

    const fakeAuth = { authenticate: () => 'fake' };
    const pluginStringToken: INodeStackPlugin = {
      name: 'plugin-with-string-token',
      onRegister(ctx) {
        ctx.bindService('auth', fakeAuth as any);
      },
    };

    app.use(pluginStringToken);

    // Custom string service is accessible via its string key
    expect(app.container.get('auth')).toBe(fakeAuth);

    // Authentic core service remains intact and untouched
    expect(app.container.get(TOKENS.AuthService)).toBe(app.auth);
    expect(app.auth).not.toBe(fakeAuth);
  });

  it('should enforce container-level immutability for core tokens', () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8214 });

    // Verify container locked status
    expect(app.container.isLocked(TOKENS.AuthService)).toBe(true);
    expect(app.container.isLocked(TOKENS.DatabaseService)).toBe(true);
    expect(app.container.isLocked(TOKENS.ConfigService)).toBe(true);

    // Container bindInstance fails on locked tokens
    expect(() => {
      app.container.bindInstance(TOKENS.AuthService, {} as any);
    }).toThrow(/Cannot override locked service token: AuthService/i);

    // Container bindFactory fails on locked tokens
    expect(() => {
      app.container.bindFactory(TOKENS.DatabaseService, () => ({} as any));
    }).toThrow(/Cannot override locked service token: DatabaseService/i);

    // Container bindClass fails on locked tokens
    class FakeConfig {}
    expect(() => {
      app.container.bindClass(TOKENS.ConfigService, FakeConfig as any);
    }).toThrow(/Cannot override locked service token: ConfigService/i);
  });

  it('should still allow plugins to register and resolve custom non-core services', () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8215 });

    const customToken = Symbol('CustomLogger');
    class CustomLogger {
      public log(msg: string) {
        return `[LOG]: ${msg}`;
      }
    }

    let resolvedFromContext: CustomLogger | null = null;
    const customPlugin: INodeStackPlugin = {
      name: 'custom-service-plugin',
      onRegister(ctx) {
        ctx.bindService(customToken, new CustomLogger());
        resolvedFromContext = ctx.getService<CustomLogger>(customToken);
      },
    };

    app.use(customPlugin);

    const resolved = app.container.get<CustomLogger>(customToken);
    expect(resolved).toBeDefined();
    expect(resolved.log('hello')).toBe('[LOG]: hello');
    expect(resolvedFromContext).toBe(resolved);
  });

  it('should allow plugins to resolve safe allowlisted core services via ctx.getService', () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8216 });

    let resolvedDb: any = null;
    let resolvedConfig: any = null;
    let resolvedSchema: any = null;
    let resolvedRecords: any = null;

    const observerPlugin: INodeStackPlugin = {
      name: 'observer-plugin',
      onRegister(ctx) {
        resolvedDb = ctx.getService(TOKENS.DatabaseService);
        resolvedConfig = ctx.getService(TOKENS.ConfigService);
        resolvedSchema = ctx.getService(TOKENS.SchemaService);
        resolvedRecords = ctx.getService(TOKENS.RecordService);
      },
    };

    app.use(observerPlugin);

    expect(resolvedDb).toBe(app.db);
    expect(resolvedConfig).toBe(app.config);
    expect(resolvedSchema).toBe(app.schema);
    expect(resolvedRecords).toBe(app.records);
  });

  it('should prevent plugins from resolving restricted core services via ctx.getService', () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8217 });

    const restrictedTokens = [
      TOKENS.HttpServer,
      TOKENS.AdminUIService,
      TOKENS.MaintenanceGate,
      TOKENS.PluginRegistry,
      TOKENS.AppManager,
      TOKENS.AppRegistry,
      TOKENS.EventBus,
      TOKENS.RuleEngine,
      TOKENS.ChaosMiddleware,
    ];

    let capturedCtx: PluginContext | null = null;
    const testPlugin: INodeStackPlugin = {
      name: 'token-probe-plugin',
      onRegister(ctx) {
        capturedCtx = ctx;
      },
    };

    app.use(testPlugin);
    expect(capturedCtx).toBeDefined();

    for (const token of restrictedTokens) {
      expect(() => {
        capturedCtx!.getService(token);
      }).toThrow(/Access to restricted service token is not permitted/i);
    }
  });

  it('should allow plugins to perform CRUD operations via ctx.records', async () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8217 });

    let createdRecordId: string = '';
    let retrievedRecord: any = null;

    const crudPlugin: INodeStackPlugin = {
      name: 'crud-plugin',
      async register(ctx) {
        ctx.schema.createCollection({
          name: 'notes',
          type: 'base',
          schema: [
            { id: 'f_title', name: 'title', type: 'text', required: true },
          ],
          listRule: '',
          viewRule: '',
          createRule: '',
        });
      },
      async init(ctx) {
        // Create record via ctx.records
        const created = await ctx.records.create('notes', { title: 'First Note' });
        createdRecordId = created.id;
        retrievedRecord = await ctx.records.getOne('notes', created.id);
      },
    };

    app.use(crudPlugin);
    await app.start();

    expect(createdRecordId).toBeDefined();
    expect(retrievedRecord).toBeDefined();
    expect(retrievedRecord.title).toBe('First Note');
  });

  it('should support eventBus isolation without clear() capability', () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8218 });

    let eventPayload: any = null;
    const eventPlugin: INodeStackPlugin = {
      name: 'event-plugin',
      onRegister(ctx) {
        // Can subscribe
        ctx.eventBus.on('custom:event', (payload: any) => {
          eventPayload = payload;
        });

        // Can emit
        ctx.eventBus.emit('custom:event', { success: true });

        // Cannot clear
        expect((ctx.eventBus as any).clear).toBeUndefined();
      },
    };

    app.use(eventPlugin);

    expect(eventPayload).toEqual({ success: true });
  });

  it('should ensure tenant-scoped plugins receive restricted app facade without defaultApp or scope escalation', async () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8219 });
    await app.start();

    // Create a tenant app scope
    const tenantScope = await app.apps.create({ name: 'Tenant A', slug: 'tenant-a' });

    let scopedCtx: PluginContext | null = null;
    const scopedPlugin: INodeStackPlugin = {
      name: 'tenant-inspection-plugin',
      register(ctx) {
        scopedCtx = ctx;
      },
    };

    app.pluginManager.provisionPluginForScope(scopedPlugin, tenantScope);

    expect(scopedCtx).toBeDefined();
    expect((scopedCtx?.app as any).defaultApp).toBeUndefined();
    expect((scopedCtx?.app as any).container).toBeUndefined();
    expect((scopedCtx?.app as any).server).toBeUndefined();
    expect((scopedCtx?.app as any).maintenanceGate).toBeUndefined();
    expect((scopedCtx?.app?.plugins as any).container).toBeUndefined();
    expect((scopedCtx?.app?.plugins as any).use).toBeUndefined();
    expect((scopedCtx?.app?.plugins as any).disposeScope).toBeUndefined();
    expect(typeof scopedCtx?.app?.plugins?.getEffectiveConfig).toBe('function');

    // Verify tenant-scoped bindService is disabled and does NOT mutate root container
    const tenantCustomToken = Symbol('TenantScopedService');
    scopedCtx!.bindService(tenantCustomToken, { tenant: 'Tenant A' });
    expect(app.container.has(tenantCustomToken)).toBe(false);
  });

  it('should ensure core tokens are locked BEFORE auto-enabled plugins run on startup', async () => {
    const startupTestDataDir = path.join(__dirname, '.test_plugin_startup_race_' + Date.now());
    fs.mkdirSync(startupTestDataDir, { recursive: true });

    try {
      const initApp = new NodeStack({ dataDir: startupTestDataDir, port: 8225 });
      await initApp.db.run(
        `INSERT INTO _plugin_settings (pluginName, settings, updatedAt) VALUES (?, ?, ?)`,
        'stripe',
        JSON.stringify({ _enabled: true }),
        new Date().toISOString()
      );
      await initApp.stop();

      // Restart app: PluginManager auto-loads 'stripe' after tokens are locked
      const restartedApp = new NodeStack({ dataDir: startupTestDataDir, port: 8226 });

      expect(restartedApp.container.isLocked(TOKENS.AuthService)).toBe(true);
      expect(restartedApp.container.isLocked(TOKENS.DatabaseService)).toBe(true);
      expect(restartedApp.container.isLocked(TOKENS.HttpServer)).toBe(true);
      expect(restartedApp.container.isLocked(TOKENS.PluginRegistry)).toBe(true);

      expect(restartedApp.container.get(TOKENS.AuthService)).toBe(restartedApp.auth);
      expect(restartedApp.container.get(TOKENS.DatabaseService)).toBe(restartedApp.db);

      await restartedApp.stop();
    } finally {
      if (fs.existsSync(startupTestDataDir)) {
        fs.rmSync(startupTestDataDir, { recursive: true, force: true });
      }
    }
  });

  it('should prevent plugins from accessing other plugins effective config and secrets', () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8227 });

    let capturedAttackerCtx: PluginContext | null = null;
    const attackerPlugin: INodeStackPlugin = {
      name: 'attacker-plugin',
      configSchema: {
        fields: [{ name: 'ownSecret', type: 'password', isLocked: false, source: 'code' }],
      },
      codeOptions: { ownSecret: 'attacker-secret' },
      onRegister(ctx) {
        capturedAttackerCtx = ctx;
      },
    };

    const victimPlugin: INodeStackPlugin = {
      name: 'victim-payment-plugin',
      configSchema: {
        fields: [{ name: 'apiKey', type: 'password', isLocked: false, source: 'code' }],
      },
      codeOptions: { apiKey: 'super-secret-stripe-key' },
    };

    app.use(victimPlugin);
    app.use(attackerPlugin);

    expect(capturedAttackerCtx).toBeDefined();

    // 1. Attacker CAN read its own effective config
    const ownConfig = capturedAttackerCtx!.app.plugins?.getEffectiveConfig();
    expect(ownConfig).toBeDefined();
    expect(ownConfig?.ownSecret).toBe('attacker-secret');

    const ownConfigByName = capturedAttackerCtx!.app.plugins?.getEffectiveConfig('attacker-plugin');
    expect(ownConfigByName?.ownSecret).toBe('attacker-secret');

    // 2. Attacker CANNOT read victim plugin's config or secrets
    expect(() => {
      capturedAttackerCtx!.app.plugins?.getEffectiveConfig('victim-payment-plugin');
    }).toThrow(/Unauthorized configuration access: Plugin "attacker-plugin" is not permitted to access configuration for "victim-payment-plugin"/i);

    expect(() => {
      capturedAttackerCtx!.app.plugins?.getEffectiveConfig('stripe');
    }).toThrow(/Unauthorized configuration access: Plugin "attacker-plugin" is not permitted to access configuration for "stripe"/i);
  });

  it('should allow chat-notifications and webhooks to access each other as justified aliases', () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8228 });

    let chatCtx: PluginContext | null = null;
    const chatPlugin: INodeStackPlugin = {
      name: 'chat-notifications',
      onRegister(ctx) {
        chatCtx = ctx;
      },
    };

    app.use(chatPlugin);

    expect(chatCtx).toBeDefined();
    // Can access chat-notifications
    expect(() => chatCtx!.app.plugins?.getEffectiveConfig('chat-notifications')).not.toThrow();
    // Can access justified alias webhooks
    expect(() => chatCtx!.app.plugins?.getEffectiveConfig('webhooks')).not.toThrow();
    // Cannot access unrelated plugin
    expect(() => chatCtx!.app.plugins?.getEffectiveConfig('resend')).toThrow(/Unauthorized configuration access/i);
  });
});
