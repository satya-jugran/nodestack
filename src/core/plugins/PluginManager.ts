import { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import findMyWay from 'find-my-way';
import { Container } from '../container/Container';
import { TOKENS, ServiceIdentifier } from '../container/Tokens';
import { AppError, NotFoundError } from '../errors/AppError';
import {
  INodeStackPlugin,
  NodeStackPlugin,
  NodeStackPluginContext,
  PluginMetadata,
  RegisteredPluginRecord,
  HttpMethod,
  PluginRouteOptions,
  PluginConfigResult,
  ResolvedPluginConfigField,
  PluginConfigSource,
} from './types';
import type { NodeStack } from '../../NodeStack';
import { stripePlugin } from '../../plugins/stripe';
import { s3StoragePlugin } from '../../plugins/s3';
import { resendPlugin } from '../../plugins/resend';
import { webhookPlugin } from '../../plugins/webhooks';
import { algoliaPlugin } from '../../plugins/algolia';

export interface OfficialPluginMetadata {
  id: string;
  name: string;
  packageName: string;
  title: string;
  category: string;
  description: string;
  icon: string;
  badge: string;
  isInstalled: boolean;
  hasConfig: boolean;
  collections: string[];
}

export interface OfficialPluginDef {
  id: string;
  name: string;
  packageName: string;
  title: string;
  category: string;
  description: string;
  icon: string;
  badge: string;
  collections: string[];
  factory: () => INodeStackPlugin;
}

export const OFFICIAL_PLUGINS: OfficialPluginDef[] = [
  {
    id: 'stripe',
    name: 'stripe',
    packageName: '@nodestackapp/plugin-stripe',
    title: 'Stripe Payments',
    category: 'Payments & Checkout',
    description: 'Process checkout sessions, customer billing portals, and verify webhook signatures with audit logs.',
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
    badge: 'PAYMENTS',
    collections: ['_stripe_payments'],
    factory: () => stripePlugin(),
  },
  {
    id: 's3-storage',
    name: 's3-storage',
    packageName: '@nodestackapp/plugin-s3',
    title: 'S3 Cloud Storage',
    category: 'Object Storage & CDN',
    description: 'AWS S3, MinIO, and Cloudflare R2 object storage with SigV4 presigned upload URLs and file tracking.',
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
    badge: 'STORAGE',
    collections: ['_s3_uploads'],
    factory: () => s3StoragePlugin(),
  },
  {
    id: 'resend',
    name: 'resend',
    packageName: '@nodestackapp/plugin-resend',
    title: 'Resend Transactional Email',
    category: 'Communications',
    description: 'Transactional email delivery via Resend API with safe dry-run mode and delivery logs in SQLite.',
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
    badge: 'EMAIL',
    collections: ['_email_logs'],
    factory: () => resendPlugin(),
  },
  {
    id: 'webhooks',
    name: 'webhooks',
    packageName: '@nodestackapp/plugin-webhooks',
    title: 'Discord & Slack Webhooks',
    category: 'Automation & Alerts',
    description: 'Real-time outbound notifications to Discord and Slack channels on database mutations with payload logs.',
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    badge: 'WEBHOOKS',
    collections: ['_webhook_logs'],
    factory: () => webhookPlugin(),
  },
  {
    id: 'algolia',
    name: 'algolia',
    packageName: '@nodestackapp/plugin-algolia',
    title: 'Algolia Search Sync',
    category: 'Search & Discovery',
    description: 'Realtime search indexing on record mutations, background sync queues, and batch re-indexing.',
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    badge: 'SEARCH',
    collections: ['_algolia_sync_queue'],
    factory: () => algoliaPlugin(),
  },
];

export class PluginManager {
  private plugins = new Map<string, RegisteredPluginRecord>();
  private pendingInits: Promise<void>[] = [];
  private anonymousCounter = 1;
  private registeredFunctions = new Set<Function>();
  private dynamicRouter = findMyWay({ defaultRoute: (_req: any, res: any) => res.end() });
  private dynamicRoutesMap = new Map<
    string,
    { method: string; path: string; handler: RouteHandlerMethod; preHandler?: any; pluginName?: string }
  >();

  constructor(
    private readonly app: NodeStack,
    private readonly container: Container
  ) {
    this.initSettingsTable();
    this.registerConfigRoutes();

    if (this.app.adminUi && typeof (this.app.adminUi as any).setCatalogGetter === 'function') {
      (this.app.adminUi as any).setCatalogGetter(() => this.getOfficialCatalog());
    }

    if (this.app.server && typeof (this.app.server as any).setDynamicRouteHandler === 'function') {
      (this.app.server as any).setDynamicRouteHandler((req: FastifyRequest, reply: FastifyReply) =>
        this.handleDynamicRoute(req, reply)
      );
    }

    this.loadAutoEnabledPlugins();
  }

  /**
   * Install/use a plugin on the NodeStack instance
   */
  public use(pluginOrFn: NodeStackPlugin): this {
    // 1. Normalize plugin
    let plugin: INodeStackPlugin;
    if (typeof pluginOrFn === 'function') {
      if (this.registeredFunctions.has(pluginOrFn)) {
        throw new Error('[PluginManager] This plugin function is already registered.');
      }
      const fnName = pluginOrFn.name || `plugin_${this.anonymousCounter++}`;
      plugin = {
        name: fnName,
        register: pluginOrFn,
      };
    } else {
      plugin = pluginOrFn;
    }

    if (!plugin || typeof plugin !== 'object' || !plugin.name) {
      throw new Error('[PluginManager] Invalid plugin provided: must have a valid name');
    }

    // 2. Check duplicate registration
    if (this.plugins.has(plugin.name)) {
      throw new Error(
        `[PluginManager] Plugin "${plugin.name}" is already registered. Duplicate plugin registrations are not permitted.`
      );
    }

    if (typeof pluginOrFn === 'function') {
      this.registeredFunctions.add(pluginOrFn);
    }

    // 3. Validate dependencies
    if (plugin.dependencies && plugin.dependencies.length > 0) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(
            `[PluginManager] Plugin "${plugin.name}" requires dependent plugin "${dep}" which has not been registered.`
          );
        }
      }
    }

    // 4. Build Plugin Context
    const context: NodeStackPluginContext = {
      app: this.app,
      container: this.container,
      tokens: TOKENS,
      config: this.app.config,
      db: this.app.db,
      schema: this.app.schema,
      eventBus: this.app.eventBus,
      adminUi: this.app.adminUi,
      auth: {
        requireAdmin: () => this.app.authMiddleware.requireAdmin(),
        requireAdminOrInitial: () => this.app.authMiddleware.requireAdminOrInitialSetup(),
        requireAuth: () => this.app.authMiddleware.requireAuth(),
      },
      router: {
        get: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) =>
          context.registerRoute('GET', path, handler, options),
        post: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) =>
          context.registerRoute('POST', path, handler, options),
        patch: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) =>
          context.registerRoute('PATCH', path, handler, options),
        delete: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) =>
          context.registerRoute('DELETE', path, handler, options),
        put: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) =>
          context.registerRoute('PUT', path, handler, options),
        raw: this.app.server.app,
      },
      registerRoute: (
        method: HttpMethod,
        path: string,
        handler: RouteHandlerMethod,
        options: PluginRouteOptions = {}
      ) => {
        const fastify = this.app.server.app;
        const resolvedOptions = this.resolveRouteOptions(options);

        const routeHandler: RouteHandlerMethod = async (req, reply) => {
          if (!this.plugins.has(plugin.name)) {
            return reply.status(404).send({
              statusCode: 404,
              error: 'Not Found',
              message: `Route ${req.method}:${req.url} not found (plugin disabled)`,
            });
          }
          return handler.call(this.app.server.app, req, reply);
        };

        this.registerDynamicRoute(method, path, routeHandler, resolvedOptions, plugin.name);

        const isBooted = this.isFastifyBooted(fastify);
        if (!isBooted) {
          try {
            const m = method.toLowerCase();
            if (typeof (fastify as any)[m] === 'function') {
              (fastify as any)[m](path, resolvedOptions, routeHandler);
            } else {
              fastify.route({
                method: method as any,
                url: path,
                handler: routeHandler,
                ...resolvedOptions,
              });
            }
          } catch {
            // Already booted fallback to dynamicRouter
          }
        }
      },
      registerHook: (
        event: string,
        handler: any,
        collection?: string
      ) => {
        switch (event) {
          case 'beforeCreate':
            this.app.onRecordBeforeCreate(collection ? collection : handler, collection ? handler : undefined);
            break;
          case 'afterCreate':
            this.app.onRecordAfterCreate(collection ? collection : handler, collection ? handler : undefined);
            break;
          case 'beforeUpdate':
            this.app.onRecordBeforeUpdate(collection ? collection : handler, collection ? handler : undefined);
            break;
          case 'afterUpdate':
            this.app.onRecordAfterUpdate(collection ? collection : handler, collection ? handler : undefined);
            break;
          case 'beforeDelete':
            this.app.onRecordBeforeDelete(collection ? collection : handler, collection ? handler : undefined);
            break;
          case 'afterDelete':
            this.app.onRecordAfterDelete(collection ? collection : handler, collection ? handler : undefined);
            break;
          case 'beforeServe':
            this.app.onBeforeServe(handler);
            break;
          case 'afterServe':
            this.app.onAfterServe(handler);
            break;
          default:
            this.app.eventBus.on(event, handler);
            break;
        }
      },
      registerSystemCollection: (dto) => {
        return this.app.schema.registerSystemCollection(dto);
      },
      registerAdminNav: (item) => {
        this.app.adminUi.registerNavItem(item);
      },
      getService: <T>(token: ServiceIdentifier<T>): T => {
        return this.container.get<T>(token);
      },
      bindService: <T>(token: ServiceIdentifier<T>, instance: T) => {
        this.container.bindInstance<T>(token, instance);
      },
    };

    // 5. Execute Declarative Registrations
    if (plugin.collections && Array.isArray(plugin.collections)) {
      for (const colDto of plugin.collections) {
        context.registerSystemCollection(colDto);
      }
    }

    if (plugin.routes && Array.isArray(plugin.routes)) {
      for (const route of plugin.routes) {
        const routeOpts: PluginRouteOptions = { ...(route.options || {}) };
        if (route.auth && !routeOpts.auth) {
          routeOpts.auth = route.auth;
        }
        context.registerRoute(route.method, route.path, route.handler, routeOpts);
      }
    }

    if (plugin.adminNavItems && Array.isArray(plugin.adminNavItems)) {
      for (const navItem of plugin.adminNavItems) {
        context.registerAdminNav(navItem);
      }
    }

    // 6. Execute Lifecycle Hooks
    const runLifecycle = async () => {
      if (typeof plugin.register === 'function') {
        const res = plugin.register(context);
        if (res instanceof Promise) {
          await res;
        }
      }

      if (typeof plugin.init === 'function') {
        const res = plugin.init(context);
        if (res instanceof Promise) {
          await res;
        }
      }
    };

    const lifecyclePromise = runLifecycle()
      .then(() => {
        const record = this.plugins.get(plugin.name);
        if (record) {
          record.status = 'initialized';
        }
      })
      .catch((err) => {
        const record = this.plugins.get(plugin.name);
        if (record) {
          record.status = 'error';
          record.error = err;
        }
        console.error(`[PluginManager] Error initializing plugin "${plugin.name}":`, err);
        throw err;
      });

    this.pendingInits.push(lifecyclePromise);

    // 7. Register Serve Hooks if present
    if (typeof plugin.onBeforeServe === 'function') {
      this.app.onBeforeServe((ctx) => plugin.onBeforeServe!(ctx));
    }

    if (typeof plugin.onAfterServe === 'function') {
      this.app.onAfterServe((ctx) => plugin.onAfterServe!(ctx));
    }

    // 8. Register Admin UI Plugin Metadata
    this.app.adminUi.registerPluginMeta({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      hasConfig: Boolean(plugin.configSchema?.fields && plugin.configSchema.fields.length > 0),
    });

    // 9. Store plugin record
    this.plugins.set(plugin.name, {
      name: plugin.name,
      plugin,
      context,
      status: 'registered',
    });

    // 10. If plugin defines configSchema and onConfigUpdate, hydrate with effective initial settings
    if (plugin.configSchema?.fields && typeof plugin.onConfigUpdate === 'function') {
      try {
        const effective = this.getEffectiveConfig(plugin.name);
        const initialSync = plugin.onConfigUpdate(effective);
        if (initialSync instanceof Promise) {
          this.pendingInits.push(initialSync.catch(() => {}));
        }
      } catch {}
    }

    return this;
  }

  /**
   * Ensures that all asynchronous plugin initialization is resolved.
   * Invoked automatically by `app.start()` before the server binds and listens.
   */
  public async ensureInitialized(): Promise<void> {
    if (this.pendingInits.length > 0) {
      const inits = [...this.pendingInits];
      this.pendingInits = [];
      await Promise.all(inits);
    }
  }

  /**
   * Check if a plugin is registered
   */
  public hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Get a registered plugin by name
   */
  public getPlugin<T extends INodeStackPlugin = INodeStackPlugin>(name: string): T | undefined {
    return this.plugins.get(name)?.plugin as T | undefined;
  }

  /**
   * Get all registered plugins
   */
  public getAllPlugins(): INodeStackPlugin[] {
    return Array.from(this.plugins.values()).map((r) => r.plugin);
  }

  /**
   * Get plugin metadata for UI and telemetry
   */
  public getPluginsMetadata(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map((r) => ({
      name: r.plugin.name,
      version: r.plugin.version,
      description: r.plugin.description,
    }));
  }

  /**
   * Resolve authentication policy into Fastify preHandler middleware
   */
  private resolveRouteOptions(rawOptions?: PluginRouteOptions): any {
    const options: any = { ...(rawOptions || {}) };
    const authPolicy = options.auth || (options.requireAdmin ? 'admin' : undefined);

    let authPreHandler: any = null;
    if (authPolicy === 'admin') {
      authPreHandler = this.app.authMiddleware.requireAdmin();
    } else if (authPolicy === 'adminOrInitial') {
      authPreHandler = this.app.authMiddleware.requireAdminOrInitialSetup();
    } else if (authPolicy === 'auth' || authPolicy === 'user') {
      authPreHandler = this.app.authMiddleware.requireAuth();
    }

    if (authPreHandler) {
      if (options.preHandler) {
        const existing = Array.isArray(options.preHandler) ? options.preHandler : [options.preHandler];
        options.preHandler = [authPreHandler, ...existing];
      } else {
        options.preHandler = authPreHandler;
      }
    }

    delete options.auth;
    delete options.requireAdmin;

    return options;
  }

  private isFastifyBooted(fastify: any): boolean {
    if (!fastify) return false;
    if (fastify.server && (fastify.server as any).listening) return true;
    for (const sym of Object.getOwnPropertySymbols(fastify)) {
      if (sym.description === 'fastify.state') {
        const state = fastify[sym];
        if (state && (state.ready || state.started || state.listening || state.booting)) {
          return true;
        }
      }
    }
    return false;
  }

  private registerDynamicRoute(
    method: HttpMethod,
    path: string,
    handler: RouteHandlerMethod,
    options: any = {},
    pluginName?: string
  ): void {
    const m = method.toUpperCase();
    const routeKey = `${m}:${path}`;
    const item = {
      method: m,
      path,
      handler,
      preHandler: options.preHandler,
      pluginName,
    };
    (handler as any).routeData = item;
    this.dynamicRoutesMap.set(routeKey, item);
    try {
      this.dynamicRouter.on(m as any, path, { store: item } as any, handler as any, item);
    } catch {
      // route may already be registered
    }
  }

  public async handleDynamicRoute(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const urlPath = req.url.split('?')[0];
    const match = this.dynamicRouter.find(req.method as any, urlPath);
    if (!match) return false;

    const routeData = (match.store || (match.handler as any)?.routeData || match.handler) as any;
    const handler = typeof routeData?.handler === 'function'
      ? routeData.handler
      : (typeof match.handler === 'function' ? match.handler : null);
    if (!handler) return false;

    (req as any).params = { ...((req as any).params || {}), ...match.params };

    if (routeData.preHandler) {
      const handlers = Array.isArray(routeData.preHandler) ? routeData.preHandler : [routeData.preHandler];
      for (const ph of handlers) {
        await ph(req, reply);
        if (reply.sent) return true;
      }
    }

    const result = await handler.call(this.app.server.app, req, reply);
    if (!reply.sent && result !== undefined) {
      reply.send(result);
    }
    return true;
  }

  private removeDynamicRoutesForPlugin(pluginName: string): void {
    for (const [key, item] of Array.from(this.dynamicRoutesMap.entries())) {
      if (item.pluginName === pluginName) {
        this.dynamicRoutesMap.delete(key);
      }
    }
    this.dynamicRouter.reset();
    for (const item of this.dynamicRoutesMap.values()) {
      try {
        (item.handler as any).routeData = item;
        this.dynamicRouter.on(item.method as any, item.path, { store: item } as any, item.handler as any, item);
      } catch {}
    }
  }

  /**
   * Return catalog of official first-party extensions and their installation status
   */
  public getOfficialCatalog(): OfficialPluginMetadata[] {
    return OFFICIAL_PLUGINS.map((def) => {
      const isInstalled = this.plugins.has(def.name);
      return {
        id: def.id,
        name: def.name,
        packageName: def.packageName,
        title: def.title,
        category: def.category,
        description: def.description,
        icon: def.icon,
        badge: def.badge,
        isInstalled,
        hasConfig: isInstalled ? Boolean(this.plugins.get(def.name)?.plugin.configSchema?.fields?.length) : true,
        collections: def.collections,
      };
    });
  }

  /**
   * 1-Click enable official first-party plugin at runtime
   */
  public async enableOfficialPlugin(id: string): Promise<PluginConfigResult | null> {
    const def = OFFICIAL_PLUGINS.find((p) => p.id === id || p.name === id);
    if (!def) {
      throw new NotFoundError(`Official plugin "${id}" not found in catalog`);
    }

    if (!this.plugins.has(def.name)) {
      const plugin = def.factory();
      this.use(plugin);
      await this.ensureInitialized();
    }

    this.initSettingsTable();
    let dbSettings: Record<string, any> = {};
    try {
      const row = this.app.db.get<{ settings: string }>(
        'SELECT settings FROM _plugin_settings WHERE pluginName = ?',
        [def.name]
      );
      if (row?.settings) {
        dbSettings = JSON.parse(row.settings);
      }
    } catch {}

    dbSettings._enabled = true;
    const now = new Date().toISOString();
    this.app.db.prepare(`
      INSERT INTO _plugin_settings (pluginName, settings, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(pluginName) DO UPDATE SET settings=excluded.settings, updatedAt=excluded.updatedAt
    `).run(def.name, JSON.stringify(dbSettings), now);

    return this.getPluginConfig(def.name);
  }

  /**
   * Deactivate official first-party plugin
   */
  public async disableOfficialPlugin(id: string): Promise<void> {
    const def = OFFICIAL_PLUGINS.find((p) => p.id === id || p.name === id);
    const name = def ? def.name : id;

    const record = this.plugins.get(name);
    if (record) {
      if (typeof record.plugin.onDestroy === 'function') {
        try {
          await record.plugin.onDestroy(record.context);
        } catch (e) {
          console.error(`[PluginManager] Error destroying plugin "${name}":`, e);
        }
      }

      if (record.plugin.adminNavItems) {
        for (const item of record.plugin.adminNavItems) {
          this.app.adminUi.removeNavItem(item.id);
        }
      }
      this.app.adminUi.removePluginMeta(name);

      this.removeDynamicRoutesForPlugin(name);
      this.plugins.delete(name);
    }

    this.initSettingsTable();
    let dbSettings: Record<string, any> = {};
    try {
      const row = this.app.db.get<{ settings: string }>(
        'SELECT settings FROM _plugin_settings WHERE pluginName = ?',
        [name]
      );
      if (row?.settings) {
        dbSettings = JSON.parse(row.settings);
      }
    } catch {}

    dbSettings._enabled = false;
    const now = new Date().toISOString();
    this.app.db.prepare(`
      INSERT INTO _plugin_settings (pluginName, settings, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(pluginName) DO UPDATE SET settings=excluded.settings, updatedAt=excluded.updatedAt
    `).run(name, JSON.stringify(dbSettings), now);
  }

  /**
   * Auto-load any official plugins previously enabled in _plugin_settings on startup
   */
  private loadAutoEnabledPlugins(): void {
    this.initSettingsTable();
    try {
      if (this.app.db && typeof this.app.db.all === 'function') {
        const rows = this.app.db.all<{ pluginName: string; settings: string }>(
          'SELECT pluginName, settings FROM _plugin_settings'
        );
        for (const row of rows) {
          try {
            const parsed = JSON.parse(row.settings);
            if (parsed && parsed._enabled === true) {
              const def = OFFICIAL_PLUGINS.find((p) => p.name === row.pluginName || p.id === row.pluginName);
              if (def && !this.plugins.has(def.name)) {
                this.use(def.factory());
              }
            }
          } catch {}
        }
      }
    } catch {
      // Ignore during initial setup or mock runs
    }
  }

  /**
   * Initialize SQLite settings table for plugins if not already present
   */
  private initSettingsTable(): void {
    try {
      if (this.app.db && typeof this.app.db.run === 'function') {
        this.app.db.run(`
          CREATE TABLE IF NOT EXISTS _plugin_settings (
            pluginName TEXT PRIMARY KEY,
            settings TEXT NOT NULL DEFAULT '{}',
            updatedAt TEXT NOT NULL
          )
        `);
      }
    } catch {
      // Ignore during mock or container tests
    }
  }

  /**
   * Register Fastify routes for retrieving and updating plugin configuration
   */
  private registerConfigRoutes(): void {
    const fastify = this.app.server?.app;
    if (!fastify) return;

    fastify.get(
      '/api/plugins/available',
      { preHandler: this.app.authMiddleware.requireAdmin() },
      async (_req: FastifyRequest, reply: FastifyReply) => {
        return reply.send({
          plugins: this.getOfficialCatalog(),
        });
      }
    );

    fastify.post(
      '/api/plugins/:name/enable',
      { preHandler: this.app.authMiddleware.requireAdmin() },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const { name } = req.params as { name: string };
        try {
          const config = await this.enableOfficialPlugin(name);
          return reply.send({
            success: true,
            message: `Plugin "${name}" enabled successfully`,
            config,
          });
        } catch (err: any) {
          const statusCode = err.statusCode || 400;
          return reply.status(statusCode).send({
            statusCode,
            message: err.message || `Failed to enable plugin "${name}"`,
          });
        }
      }
    );

    fastify.post(
      '/api/plugins/:name/disable',
      { preHandler: this.app.authMiddleware.requireAdmin() },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const { name } = req.params as { name: string };
        try {
          await this.disableOfficialPlugin(name);
          return reply.send({
            success: true,
            message: `Plugin "${name}" disabled successfully`,
          });
        } catch (err: any) {
          const statusCode = err.statusCode || 400;
          return reply.status(statusCode).send({
            statusCode,
            message: err.message || `Failed to disable plugin "${name}"`,
          });
        }
      }
    );

    fastify.get(
      '/api/plugins/:name/config',
      { preHandler: this.app.authMiddleware.requireAdmin() },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const { name } = req.params as { name: string };
        try {
          const config = this.getPluginConfig(name);
          return reply.send(config);
        } catch (err: any) {
          const statusCode = err.statusCode || 404;
          return reply.status(statusCode).send({
            statusCode,
            message: err.message || `Plugin "${name}" not found`,
          });
        }
      }
    );

    fastify.put(
      '/api/plugins/:name/config',
      { preHandler: this.app.authMiddleware.requireAdmin() },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const { name } = req.params as { name: string };
        const body = (req.body as any) || {};
        try {
          const updated = await this.updatePluginConfig(name, body);
          return reply.send(updated);
        } catch (err: any) {
          const statusCode = err.statusCode || 400;
          return reply.status(statusCode).send({
            statusCode,
            message: err.message,
          });
        }
      }
    );
  }

  /**
   * Resolve raw effective configuration dictionary for internal plugin execution.
   * Resolves values from environment variables, database (_plugin_settings), code options, and defaults.
   * Unlike getPluginConfig, this preserves raw secrets required by plugins at runtime.
   */
  public getEffectiveConfig(name: string): Record<string, any> {
    let record = this.plugins.get(name);
    if (!record) {
      for (const rec of this.plugins.values()) {
        if (rec.plugin.adminNavItems?.some((i) => i.id === name)) {
          record = rec;
          name = rec.name;
          break;
        }
      }
    }
    if (!record) {
      throw new NotFoundError(`Plugin "${name}" is not registered`);
    }

    const plugin = record.plugin;
    if (!plugin.configSchema?.fields || plugin.configSchema.fields.length === 0) {
      return {};
    }

    this.initSettingsTable();
    let dbSettings: Record<string, any> = {};
    try {
      const row = this.app.db.get<{ settings: string }>(
        'SELECT settings FROM _plugin_settings WHERE pluginName = ?',
        [name]
      );
      if (row?.settings) {
        dbSettings = JSON.parse(row.settings);
      }
    } catch {}

    const effective: Record<string, any> = {};
    for (const field of plugin.configSchema.fields) {
      let val: any = undefined;

      // 1. Environment Variable
      if (field.envKey && process.env[field.envKey] !== undefined && process.env[field.envKey] !== '') {
        val = process.env[field.envKey];
      }
      // 2. Database Settings
      else if (dbSettings[field.name] !== undefined) {
        val = dbSettings[field.name];
      }
      // 3. Code Options
      else if (
        plugin.codeOptions &&
        plugin.codeOptions[field.name] !== undefined &&
        plugin.codeOptions[field.name] !== ''
      ) {
        val = plugin.codeOptions[field.name];
      }
      // 4. Default Fallback
      else {
        val =
          field.defaultValue !== undefined
            ? field.defaultValue
            : (field.type === 'boolean'
                ? false
                : (field.type === 'select' && field.required && field.options && field.options.length > 0
                    ? (typeof field.options[0] === 'object' && field.options[0] !== null && 'value' in field.options[0]
                        ? field.options[0].value
                        : field.options[0])
                    : undefined));
      }

      if (val !== undefined && val !== '') {
        effective[field.name] = val;
      }
    }

    return effective;
  }

  /**
   * Option B: Resolve plugin configuration with strict environment & code precedence.
   * If a setting is defined via process.env, it is locked.
   * If not defined in env, it is editable via SQLite database (_plugin_settings).
   *
   * SECURITY: For fields of type 'password', raw secret values are NEVER returned in responses.
   * value is omitted (undefined), and hasValue indicates whether a secret is configured.
   */
  public getPluginConfig(name: string): PluginConfigResult {
    let record = this.plugins.get(name);
    if (!record) {
      for (const rec of this.plugins.values()) {
        if (rec.plugin.adminNavItems?.some((i) => i.id === name)) {
          record = rec;
          name = rec.name;
          break;
        }
      }
    }
    if (!record) {
      throw new NotFoundError(`Plugin "${name}" is not registered`);
    }

    const plugin = record.plugin;
    if (!plugin.configSchema || !plugin.configSchema.fields || plugin.configSchema.fields.length === 0) {
      return {
        plugin: name,
        hasConfig: false,
        fields: [],
      };
    }

    this.initSettingsTable();
    let dbSettings: Record<string, any> = {};
    try {
      const row = this.app.db.get<{ settings: string }>(
        'SELECT settings FROM _plugin_settings WHERE pluginName = ?',
        [name]
      );
      if (row?.settings) {
        dbSettings = JSON.parse(row.settings);
      }
    } catch {}

    const fields: ResolvedPluginConfigField[] = plugin.configSchema.fields.map((field) => {
      let rawValue: any = undefined;
      let isLocked = false;
      let source: PluginConfigSource = 'default';
      let lockReason: string | undefined = undefined;

      // 1. Strict Option B: Check Environment Variable (The ONLY source that locks)
      if (field.envKey && process.env[field.envKey] !== undefined && process.env[field.envKey] !== '') {
        rawValue = process.env[field.envKey];
        isLocked = true;
        source = 'env';
        lockReason = `Managed by environment variable (${field.envKey})`;
      }
      // 2. Check Database Settings (Editable via Admin UI, overrides code fallbacks)
      else if (dbSettings[field.name] !== undefined) {
        rawValue = dbSettings[field.name];
        isLocked = false;
        source = 'db';
      }
      // 3. Programmatic Code Options / Fallback (Editable in UI)
      else if (
        plugin.codeOptions &&
        plugin.codeOptions[field.name] !== undefined &&
        plugin.codeOptions[field.name] !== ''
      ) {
        rawValue = plugin.codeOptions[field.name];
        isLocked = false;
        source = 'code';
      }
      // 4. Default Fallback
      else {
        rawValue =
          field.defaultValue !== undefined
            ? field.defaultValue
            : (field.type === 'boolean'
                ? false
                : (field.type === 'select' && field.required && field.options && field.options.length > 0
                    ? (typeof field.options[0] === 'object' && field.options[0] !== null && 'value' in field.options[0]
                        ? field.options[0].value
                        : field.options[0])
                    : undefined));
        isLocked = false;
        source = 'default';
      }

      // Security: Omit raw password values from responses and provide write-only hint
      if (field.type === 'password') {
        const hasValue = rawValue !== undefined && rawValue !== '' && rawValue !== null;
        return {
          ...field,
          value: undefined, // Omit raw secret from API and UI response!
          hasValue,
          maskedValue: hasValue ? '••••••••' : undefined,
          isLocked,
          source,
          lockReason,
        };
      }

      return {
        ...field,
        value: rawValue,
        isLocked,
        source,
        lockReason,
      };
    });

    return {
      plugin: name,
      hasConfig: true,
      fields,
    };
  }

  /**
   * Option B: Update plugin configuration from Admin UI.
   * Throws 400 Bad Request if trying to update any locked field.
   * Implements a write-only / unchanged-secret update path:
   *   - Password fields left empty or set to '••••••••' preserve existing secrets unchanged.
   *   - A non-empty string updates the secret in _plugin_settings.
   * Saves updates to _plugin_settings and fires onConfigUpdate on the plugin with effective settings.
   */
  public async updatePluginConfig(name: string, updates: Record<string, any>): Promise<PluginConfigResult> {
    let record = this.plugins.get(name);
    if (!record) {
      for (const rec of this.plugins.values()) {
        if (rec.plugin.adminNavItems?.some((i) => i.id === name)) {
          record = rec;
          name = rec.name;
          break;
        }
      }
    }
    if (!record) {
      throw new NotFoundError(`Plugin "${name}" is not registered`);
    }

    const currentConfig = this.getPluginConfig(name);
    if (!currentConfig.hasConfig) {
      throw new AppError(`Plugin "${name}" does not define a configuration schema`, 400);
    }

    this.initSettingsTable();
    let dbSettings: Record<string, any> = {};
    try {
      const row = this.app.db.get<{ settings: string }>(
        'SELECT settings FROM _plugin_settings WHERE pluginName = ?',
        [name]
      );
      if (row?.settings) {
        dbSettings = JSON.parse(row.settings);
      }
    } catch {}

    // Validate that no locked fields are being modified
    for (const [key, val] of Object.entries(updates)) {
      const field = currentConfig.fields.find((f) => f.name === key);
      if (!field) continue;

      if (field.isLocked) {
        // If unchanged placeholder or blank is passed for a locked field, ignore without error
        if (val === undefined || val === '' || val === null || val === '••••••••') {
          continue;
        }
        throw new AppError(
          `Field "${key}" is locked by ${field.lockReason || 'production environment'} and cannot be modified via UI.`,
          400
        );
      }

      // Write-only / unchanged-secret update path:
      if (field.type === 'password') {
        if (val === undefined || val === '' || val === null || val === '••••••••') {
          // Unchanged: preserve existing stored secret
          continue;
        }
        // Operator provided a new secret
        dbSettings[key] = String(val).trim();
        continue;
      }

      // Format/sanitize values for other field types
      let cleanedVal = val;
      if (field.type === 'number') {
        cleanedVal = val === '' ? undefined : Number(val);
      } else if (field.type === 'boolean') {
        cleanedVal = Boolean(val);
      } else if (field.type === 'select') {
        if (field.options && field.options.length > 0) {
          const matchedOpt = field.options.find((opt) => {
            const optVal = typeof opt === 'object' && opt !== null && 'value' in opt ? opt.value : opt;
            return String(optVal) === String(val);
          });
          if (matchedOpt) {
            const rawOptVal =
              typeof matchedOpt === 'object' && matchedOpt !== null && 'value' in matchedOpt
                ? matchedOpt.value
                : matchedOpt;
            cleanedVal = rawOptVal;
          } else if (val === '' || val === undefined || val === null) {
            if (field.required) {
              throw new AppError(`Field "${key}" is required.`, 400);
            }
            cleanedVal = undefined;
          } else {
            const allowedLabels = field.options.map((opt) => {
              const optVal = typeof opt === 'object' && opt !== null && 'value' in opt ? opt.value : opt;
              return JSON.stringify(optVal);
            });
            throw new AppError(
              `Invalid value "${val}" for select field "${key}". Allowed choices: ${allowedLabels.join(', ')}`,
              400
            );
          }
        }
      }
      if (cleanedVal === undefined) {
        delete dbSettings[key];
      } else {
        dbSettings[key] = cleanedVal;
      }
    }

    const now = new Date().toISOString();
    this.app.db.prepare(`
      INSERT INTO _plugin_settings (pluginName, settings, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(pluginName) DO UPDATE SET settings=excluded.settings, updatedAt=excluded.updatedAt
    `).run(name, JSON.stringify(dbSettings), now);

    // Compute effective full configuration with raw secrets for runtime update
    if (typeof record.plugin.onConfigUpdate === 'function') {
      const effectiveConfig = this.getEffectiveConfig(name);
      await record.plugin.onConfigUpdate(effectiveConfig);
    }

    return this.getPluginConfig(name);
  }

  /**
   * Clean up and destroy all plugins
   */
  public async dispose(): Promise<void> {
    for (const record of this.plugins.values()) {
      if (typeof record.plugin.onDestroy === 'function') {
        try {
          await record.plugin.onDestroy(record.context);
        } catch (e) {
          console.error(`[PluginManager] Error disposing plugin "${record.name}":`, e);
        }
      }
    }
    this.plugins.clear();
    this.pendingInits = [];
    this.registeredFunctions.clear();
  }
}
