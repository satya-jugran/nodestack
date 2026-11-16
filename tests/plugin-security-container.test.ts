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

  it('should allow plugins to resolve core services via ctx.getService', () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8216 });

    let resolvedDb: any = null;
    let resolvedConfig: any = null;

    const observerPlugin: INodeStackPlugin = {
      name: 'observer-plugin',
      onRegister(ctx) {
        resolvedDb = ctx.getService(TOKENS.DatabaseService);
        resolvedConfig = ctx.getService(TOKENS.ConfigService);
      },
    };

    app.use(observerPlugin);

    expect(resolvedDb).toBe(app.db);
    expect(resolvedConfig).toBe(app.config);
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
});
