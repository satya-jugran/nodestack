import { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
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

export class PluginManager {
  private plugins = new Map<string, RegisteredPluginRecord>();
  private pendingInits: Promise<void>[] = [];
  private anonymousCounter = 1;
  private registeredFunctions = new Set<Function>();

  constructor(
    private readonly app: NodeStack,
    private readonly container: Container
  ) {
    this.initSettingsTable();
    this.registerConfigRoutes();
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
          this.app.server.app.get(path, this.resolveRouteOptions(options), handler),
        post: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) =>
          this.app.server.app.post(path, this.resolveRouteOptions(options), handler),
        patch: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) =>
          this.app.server.app.patch(path, this.resolveRouteOptions(options), handler),
        delete: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) =>
          this.app.server.app.delete(path, this.resolveRouteOptions(options), handler),
        put: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) =>
          this.app.server.app.put(path, this.resolveRouteOptions(options), handler),
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
        const m = method.toLowerCase();
        if (typeof (fastify as any)[m] === 'function') {
          (fastify as any)[m](path, resolvedOptions, handler);
        } else {
          fastify.route({
            method: method as any,
            url: path,
            handler,
            ...resolvedOptions,
          });
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
