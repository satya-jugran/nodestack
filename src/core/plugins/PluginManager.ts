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
  AdminNavItem,
} from './types';
import type { NodeStack } from '../../NodeStack';
import { DatabaseService } from '../../database/DatabaseService';
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
  private pluginHookUnsubscribers = new Map<string, Array<() => void>>();
  private runtimeLoadedOfficialPlugins = new Set<string>();

  constructor(
    private readonly app: NodeStack,
    private readonly container: Container
  ) {
    this.initSettingsTable();
    this.registerConfigRoutes();

    if (this.app.adminUi && typeof (this.app.adminUi as any).setCatalogGetter === 'function') {
      (this.app.adminUi as any).setCatalogGetter((db?: DatabaseService) => this.getOfficialCatalog(db));
    }

    if (this.app.adminUi && typeof (this.app.adminUi as any).setNavItemsGetter === 'function') {
      (this.app.adminUi as any).setNavItemsGetter((db?: DatabaseService) => this.getScopedNavItems(db));
    }

    if (this.app.server && typeof (this.app.server as any).setDynamicRouteHandler === 'function') {
      (this.app.server as any).setDynamicRouteHandler((req: FastifyRequest, reply: FastifyReply) =>
        this.handleDynamicRoute(req, reply)
      );
    }

    if (this.app.server && typeof (this.app.server as any).setDynamicRouteMatcher === 'function') {
      (this.app.server as any).setDynamicRouteMatcher((method: string, path: string) =>
        this.findDynamicRoute(method, path)
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

        const registerBoth = (p: string) => {
          this.registerDynamicRoute(method, p, routeHandler, resolvedOptions, plugin.name);
          const isBooted = this.isFastifyBooted(fastify);
          if (!isBooted) {
            try {
              const m = method.toLowerCase();
              if (typeof (fastify as any)[m] === 'function') {
                (fastify as any)[m](p, resolvedOptions, routeHandler);
              } else {
                fastify.route({
                  method: method as any,
                  url: p,
                  handler: routeHandler,
                  ...resolvedOptions,
                });
              }
            } catch {
              // Already booted fallback to dynamicRouter
            }
          }
        };

        registerBoth(path);
        if (path.startsWith('/api/') && !path.startsWith('/api/apps/')) {
          registerBoth(path.replace(/^\/api\//, '/api/apps/:appId/'));
        }
      },
      registerHook: (
        event: string,
        handler: any,
        collection?: string
      ) => {
        // Guard handler with the plugin's active status
        const guardedHandler = async (...args: any[]) => {
          if (!this.plugins.has(plugin.name)) {
            return;
          }
          return handler(...args);
        };

        let unsubscribe: () => void;
        switch (event) {
          case 'beforeCreate':
            unsubscribe = this.app.eventBus.onRecordBeforeCreate(
              collection ? collection : guardedHandler,
              collection ? guardedHandler : undefined
            );
            break;
          case 'afterCreate':
            unsubscribe = this.app.eventBus.onRecordAfterCreate(
              collection ? collection : guardedHandler,
              collection ? guardedHandler : undefined
            );
            break;
          case 'beforeUpdate':
            unsubscribe = this.app.eventBus.onRecordBeforeUpdate(
              collection ? collection : guardedHandler,
              collection ? guardedHandler : undefined
            );
            break;
          case 'afterUpdate':
            unsubscribe = this.app.eventBus.onRecordAfterUpdate(
              collection ? collection : guardedHandler,
              collection ? guardedHandler : undefined
            );
            break;
          case 'beforeDelete':
            unsubscribe = this.app.eventBus.onRecordBeforeDelete(
              collection ? collection : guardedHandler,
              collection ? guardedHandler : undefined
            );
            break;
          case 'afterDelete':
            unsubscribe = this.app.eventBus.onRecordAfterDelete(
              collection ? collection : guardedHandler,
              collection ? guardedHandler : undefined
            );
            break;
          case 'beforeServe':
            unsubscribe = this.app.eventBus.onBeforeServe(guardedHandler);
            break;
          case 'afterServe':
            unsubscribe = this.app.eventBus.onAfterServe(guardedHandler);
            break;
          default:
            unsubscribe = this.app.eventBus.on(event, guardedHandler);
            break;
        }

        if (!this.pluginHookUnsubscribers.has(plugin.name)) {
          this.pluginHookUnsubscribers.set(plugin.name, []);
        }
        this.pluginHookUnsubscribers.get(plugin.name)!.push(unsubscribe);
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
    if (typeof plugin.register === 'function') {
      const regRes = plugin.register(context);
      if (regRes instanceof Promise) {
        this.pendingInits.push(
          regRes.catch((err) => {
            const record = this.plugins.get(plugin.name);
            if (record) {
              record.status = 'error';
              record.error = err;
            }
            console.error(`[PluginManager] Error in register hook for "${plugin.name}":`, err);
          })
        );
      }
    }

    if (typeof plugin.init === 'function') {
      const initPromise = (async () => {
        try {
          await plugin.init!(context);
          const record = this.plugins.get(plugin.name);
          if (record) {
            record.status = 'initialized';
          }
        } catch (err: any) {
          const record = this.plugins.get(plugin.name);
          if (record) {
            record.status = 'error';
            record.error = err instanceof Error ? err : new Error(String(err));
          }
          console.error(`[PluginManager] Error initializing plugin "${plugin.name}":`, err);
        }
      })();
      this.pendingInits.push(initPromise);
    } else {
      const record = this.plugins.get(plugin.name);
      if (record) {
        record.status = 'initialized';
      }
    }

    // 7. Register Serve Hooks if present
    if (typeof plugin.onBeforeServe === 'function') {
      const unsub = this.app.eventBus.onBeforeServe(async (ctx) => {
        if (!this.plugins.has(plugin.name)) return;
        return plugin.onBeforeServe!(ctx);
      });
      if (!this.pluginHookUnsubscribers.has(plugin.name)) {
        this.pluginHookUnsubscribers.set(plugin.name, []);
      }
      this.pluginHookUnsubscribers.get(plugin.name)!.push(unsub);
    }

    if (typeof plugin.onAfterServe === 'function') {
      const unsub = this.app.eventBus.onAfterServe(async (ctx) => {
        if (!this.plugins.has(plugin.name)) return;
        return plugin.onAfterServe!(ctx);
      });
      if (!this.pluginHookUnsubscribers.has(plugin.name)) {
        this.pluginHookUnsubscribers.set(plugin.name, []);
      }
      this.pluginHookUnsubscribers.get(plugin.name)!.push(unsub);
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

  public findDynamicRoute(method: string, path: string): any {
    const match = this.dynamicRouter.find(method.toUpperCase() as any, path);
    if (!match) return null;
    return (match.store || (match.handler as any)?.routeData || match.handler) as any;
  }

  private registerDynamicRoute(
    method: HttpMethod,
    path: string,
    handler: RouteHandlerMethod,
    options: any = {},
    pluginName?: string
  ): void {
    // If route options contain unsupported Fastify options that cannot be honored at runtime,
    // explicitly reject them so developers get fast, clear feedback
    const isBooted = this.isFastifyBooted(this.app?.server?.app);
    if (isBooted) {
      const unsupportedOptions = ['constraints'].filter((key) => key in options);
      if (unsupportedOptions.length > 0) {
        throw new Error(
          `[PluginManager] Unsupported route option(s) [${unsupportedOptions.join(', ')}] for runtime route "${method} ${path}". Runtime routes cannot use these options.`
        );
      }
    }

    const m = method.toUpperCase();
    const routeKey = `${m}:${path}`;
    const item = {
      method: m,
      path,
      handler,
      options,
      preParsing: options.preParsing,
      preValidation: options.preValidation,
      preHandler: options.preHandler,
      preSerialization: options.preSerialization,
      onSend: options.onSend,
      onResponse: options.onResponse,
      onError: options.onError,
      schema: options.schema,
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

    try {
      // 1. preValidation lifecycle hooks
      if (routeData.preValidation) {
        const preValidators = Array.isArray(routeData.preValidation) ? routeData.preValidation : [routeData.preValidation];
        for (const pv of preValidators) {
          await pv.call(this.app.server.app, req, reply);
          if (reply.sent) return true;
        }
      }

      // 2. preHandler lifecycle hooks
      if (routeData.preHandler) {
        const handlers = Array.isArray(routeData.preHandler) ? routeData.preHandler : [routeData.preHandler];
        for (const ph of handlers) {
          await ph.call(this.app.server.app, req, reply);
          if (reply.sent) return true;
        }
      }

      // 3. Route Handler
      let result = await handler.call(this.app.server.app, req, reply);

      // 4. preSerialization lifecycle hooks
      if (!reply.sent && result !== undefined && routeData.preSerialization) {
        const preSerializers = Array.isArray(routeData.preSerialization) ? routeData.preSerialization : [routeData.preSerialization];
        for (const ps of preSerializers) {
          result = await ps.call(this.app.server.app, req, reply, result);
        }
      }

      // 5. onSend lifecycle hooks
      if (!reply.sent && result !== undefined && routeData.onSend) {
        const onSends = Array.isArray(routeData.onSend) ? routeData.onSend : [routeData.onSend];
        for (const os of onSends) {
          result = await os.call(this.app.server.app, req, reply, result);
        }
      }

      if (!reply.sent && result !== undefined) {
        reply.send(result);
      }

      // 6. onResponse lifecycle hooks
      if (routeData.onResponse) {
        const onResponses = Array.isArray(routeData.onResponse) ? routeData.onResponse : [routeData.onResponse];
        for (const or of onResponses) {
          await or.call(this.app.server.app, req, reply);
        }
      }

      return true;
    } catch (err: any) {
      if (routeData.onError) {
        const onErrors = Array.isArray(routeData.onError) ? routeData.onError : [routeData.onError];
        for (const oe of onErrors) {
          await oe.call(this.app.server.app, req, reply, err);
        }
      }
      throw err;
    }
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

  private removeHooksForPlugin(pluginName: string): void {
    const unsubs = this.pluginHookUnsubscribers.get(pluginName);
    if (unsubs) {
      for (const unsub of unsubs) {
        try {
          unsub();
        } catch {}
      }
      this.pluginHookUnsubscribers.delete(pluginName);
    }
  }

  /**
   * Return application-scoped navigation items for installed plugins and active configurations
   */
  public getScopedNavItems(db?: DatabaseService): AdminNavItem[] {
    const targetDb = db || this.app.db;
    const catalog = this.getOfficialCatalog(targetDb);
    const navItems: AdminNavItem[] = [];

    for (const record of this.plugins.values()) {
      const plugin = record.plugin;
      const official = catalog.find((c) => c.name === plugin.name || c.id === plugin.name);

      // If it is an official catalog plugin and NOT installed in targetDb, omit from sidebar nav
      if (official && !official.isInstalled) {
        continue;
      }

      let effectiveConfig: Record<string, any> = {};
      try {
        effectiveConfig = this.getEffectiveConfig(plugin.name, targetDb);
      } catch {
        effectiveConfig = {};
      }

      if (typeof (plugin as any).buildAdminNavItems === 'function') {
        const items = (plugin as any).buildAdminNavItems(effectiveConfig, record.context);
        if (Array.isArray(items)) {
          navItems.push(...items);
          continue;
        }
      }

      if (plugin.adminNavItems) {
        navItems.push(...plugin.adminNavItems);
      }
    }

    return navItems;
  }

  /**
   * Return catalog of official first-party extensions and their installation status
   */
  public getOfficialCatalog(db?: DatabaseService): OfficialPluginMetadata[] {
    const targetDb = db || this.app.db;
    const enabledMap = new Map<string, boolean>();
    try {
      this.initSettingsTable(targetDb);
      if (targetDb && typeof targetDb.all === 'function') {
        const rows = targetDb.all<{ pluginName: string; settings: string }>(
          'SELECT pluginName, settings FROM _plugin_settings'
        );
        for (const r of rows) {
          try {
            const s = JSON.parse(r.settings);
            if (s && s._enabled !== undefined) {
              enabledMap.set(r.pluginName, Boolean(s._enabled));
            }
          } catch {}
        }
      }
    } catch {}

    return OFFICIAL_PLUGINS.map((def) => {
      const isEnabledInDb = enabledMap.get(def.name);
      let isInstalled: boolean;
      if (isEnabledInDb !== undefined) {
        isInstalled = isEnabledInDb;
      } else if (this.runtimeLoadedOfficialPlugins.has(def.name)) {
        isInstalled = false;
      } else if (targetDb !== this.app.db) {
        isInstalled = false;
      } else {
        isInstalled = this.plugins.has(def.name);
      }
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
  public async enableOfficialPlugin(id: string, db?: DatabaseService): Promise<PluginConfigResult | null> {
    const targetDb = db || this.app.db;
    const def = OFFICIAL_PLUGINS.find((p) => p.id === id || p.name === id);
    if (!def) {
      throw new NotFoundError(`Official plugin "${id}" not found in catalog`);
    }

    this.runtimeLoadedOfficialPlugins.add(def.name);
    if (!this.plugins.has(def.name)) {
      const plugin = def.factory();
      this.use(plugin);
      await this.ensureInitialized();
    }

    this.initSettingsTable(targetDb);
    let dbSettings: Record<string, any> = {};
    try {
      const row = targetDb.get<{ settings: string }>(
        'SELECT settings FROM _plugin_settings WHERE pluginName = ?',
        [def.name]
      );
      if (row?.settings) {
        dbSettings = JSON.parse(row.settings);
      }
    } catch {}

    dbSettings._enabled = true;
    const now = new Date().toISOString();
    targetDb.prepare(`
      INSERT INTO _plugin_settings (pluginName, settings, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(pluginName) DO UPDATE SET settings=excluded.settings, updatedAt=excluded.updatedAt
    `).run(def.name, JSON.stringify(dbSettings), now);

    return this.getPluginConfig(def.name, targetDb);
  }

  /**
   * Deactivate official first-party plugin
   */
  public async disableOfficialPlugin(id: string, db?: DatabaseService): Promise<void> {
    const targetDb = db || this.app.db;
    const def = OFFICIAL_PLUGINS.find((p) => p.id === id || p.name === id);
    const name = def ? def.name : id;

    this.initSettingsTable(targetDb);
    let dbSettings: Record<string, any> = {};
    try {
      const row = targetDb.get<{ settings: string }>(
        'SELECT settings FROM _plugin_settings WHERE pluginName = ?',
        [name]
      );
      if (row?.settings) {
        dbSettings = JSON.parse(row.settings);
      }
    } catch {}

    dbSettings._enabled = false;
    const now = new Date().toISOString();
    targetDb.prepare(`
      INSERT INTO _plugin_settings (pluginName, settings, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(pluginName) DO UPDATE SET settings=excluded.settings, updatedAt=excluded.updatedAt
    `).run(name, JSON.stringify(dbSettings), now);

    if (targetDb === this.app.db) {
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
        this.removeHooksForPlugin(name);
        this.removeDynamicRoutesForPlugin(name);
        this.plugins.delete(name);
      }
    }
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
  private initSettingsTable(db?: DatabaseService): void {
    const targetDb = db || this.app.db;
    try {
      if (targetDb && typeof targetDb.run === 'function') {
        targetDb.run(`
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

    const setupRoutes = (prefix = '') => {
      fastify.get(
        `${prefix}/api/plugins/available`,
        { preHandler: this.app.authMiddleware.requireAdmin() },
        async (req: FastifyRequest, reply: FastifyReply) => {
          const targetDb = (req as any).appScope?.db || this.app.db;
          return reply.send({
            plugins: this.getOfficialCatalog(targetDb),
          });
        }
      );

      fastify.post(
        `${prefix}/api/plugins/:name/enable`,
        { preHandler: this.app.authMiddleware.requireAdmin() },
        async (req: FastifyRequest, reply: FastifyReply) => {
          const { name } = req.params as { name: string };
          const targetDb = (req as any).appScope?.db || this.app.db;
          try {
            const config = await this.enableOfficialPlugin(name, targetDb);
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
        `${prefix}/api/plugins/:name/disable`,
        { preHandler: this.app.authMiddleware.requireAdmin() },
        async (req: FastifyRequest, reply: FastifyReply) => {
          const { name } = req.params as { name: string };
          const targetDb = (req as any).appScope?.db || this.app.db;
          try {
            await this.disableOfficialPlugin(name, targetDb);
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
        `${prefix}/api/plugins/:name/config`,
        { preHandler: this.app.authMiddleware.requireAdmin() },
        async (req: FastifyRequest, reply: FastifyReply) => {
          const { name } = req.params as { name: string };
          const targetDb = (req as any).appScope?.db || this.app.db;
          try {
            const config = this.getPluginConfig(name, targetDb);
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
        `${prefix}/api/plugins/:name/config`,
        { preHandler: this.app.authMiddleware.requireAdmin() },
        async (req: FastifyRequest, reply: FastifyReply) => {
          const { name } = req.params as { name: string };
          const body = (req.body as any) || {};
          const targetDb = (req as any).appScope?.db || this.app.db;
          try {
            const updated = await this.updatePluginConfig(name, body, targetDb);
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
    };

    setupRoutes('');
    setupRoutes('/api/apps/:appId');
  }

  /**
   * Resolve raw effective configuration dictionary for internal plugin execution.
   * Resolves values from environment variables, database (_plugin_settings), code options, and defaults.
   * Unlike getPluginConfig, this preserves raw secrets required by plugins at runtime.
   */
  public getEffectiveConfig(name: string, db?: DatabaseService): Record<string, any> {
    const targetDb = db || this.app.db;
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

    this.initSettingsTable(targetDb);
    let dbSettings: Record<string, any> = {};
    try {
      const row = targetDb.get<{ settings: string }>(
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
  public getPluginConfig(name: string, db?: DatabaseService): PluginConfigResult {
    const targetDb = db || this.app.db;
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

    this.initSettingsTable(targetDb);
    let dbSettings: Record<string, any> = {};
    try {
      const row = targetDb.get<{ settings: string }>(
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
  public async updatePluginConfig(name: string, updates: Record<string, any>, db?: DatabaseService): Promise<PluginConfigResult> {
    const targetDb = db || this.app.db;
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

    const currentConfig = this.getPluginConfig(name, targetDb);
    if (!currentConfig.hasConfig) {
      throw new AppError(`Plugin "${name}" does not define a configuration schema`, 400);
    }

    this.initSettingsTable(targetDb);
    let dbSettings: Record<string, any> = {};
    try {
      const row = targetDb.get<{ settings: string }>(
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
    targetDb.prepare(`
      INSERT INTO _plugin_settings (pluginName, settings, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(pluginName) DO UPDATE SET settings=excluded.settings, updatedAt=excluded.updatedAt
    `).run(name, JSON.stringify(dbSettings), now);

    // Compute effective full configuration with raw secrets for runtime update
    if (typeof record.plugin.onConfigUpdate === 'function') {
      const effectiveConfig = this.getEffectiveConfig(name, targetDb);
      await record.plugin.onConfigUpdate(effectiveConfig);
    }

    return this.getPluginConfig(name, targetDb);
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
