import { FastifyInstance, RouteHandlerMethod } from 'fastify';
import { Container } from '../container/Container';
import { TOKENS, ServiceIdentifier } from '../container/Tokens';
import {
  INodeStackPlugin,
  NodeStackPlugin,
  NodeStackPluginContext,
  PluginMetadata,
  RegisteredPluginRecord,
  HttpMethod,
} from './types';
import type { NodeStack } from '../../NodeStack';

export class PluginManager {
  private plugins = new Map<string, RegisteredPluginRecord>();
  private pendingInits: Promise<void>[] = [];
  private anonymousCounter = 1;

  constructor(
    private readonly app: NodeStack,
    private readonly container: Container
  ) {}

  /**
   * Install/use a plugin on the NodeStack instance
   */
  public use(pluginOrFn: NodeStackPlugin): this {
    // 1. Normalize plugin
    let plugin: INodeStackPlugin;
    if (typeof pluginOrFn === 'function') {
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

    // 2. Validate dependencies
    if (plugin.dependencies && plugin.dependencies.length > 0) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(
            `[PluginManager] Plugin "${plugin.name}" requires dependent plugin "${dep}" which has not been registered.`
          );
        }
      }
    }

    // 3. Check duplicate registration
    if (this.plugins.has(plugin.name)) {
      console.warn(`[PluginManager] Warning: Plugin "${plugin.name}" is already registered. Overwriting registration.`);
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
      router: {
        get: (path: string, handler: RouteHandlerMethod) => this.app.server.app.get(path, handler),
        post: (path: string, handler: RouteHandlerMethod) => this.app.server.app.post(path, handler),
        patch: (path: string, handler: RouteHandlerMethod) => this.app.server.app.patch(path, handler),
        delete: (path: string, handler: RouteHandlerMethod) => this.app.server.app.delete(path, handler),
        put: (path: string, handler: RouteHandlerMethod) => this.app.server.app.put(path, handler),
        raw: this.app.server.app,
      },
      registerRoute: (
        method: HttpMethod,
        path: string,
        handler: RouteHandlerMethod,
        options: any = {}
      ) => {
        const fastify = this.app.server.app;
        const m = method.toLowerCase();
        if (typeof (fastify as any)[m] === 'function') {
          (fastify as any)[m](path, options, handler);
        } else {
          fastify.route({
            method: method as any,
            url: path,
            handler,
            ...options,
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
        context.registerRoute(route.method, route.path, route.handler, route.options);
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
    });

    // 9. Store plugin record
    this.plugins.set(plugin.name, {
      name: plugin.name,
      plugin,
      context,
      status: 'registered',
    });

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
  }
}
