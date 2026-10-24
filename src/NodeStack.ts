import chalk from 'chalk';
import { FastifyInstance, RouteHandlerMethod } from 'fastify';
import { Container } from './core/container/Container';
import { TOKENS } from './core/container/Tokens';
import { ConfigService, NodeStackConfigOptions } from './core/config/ConfigService';
import { DatabaseService } from './database/DatabaseService';
import { SchemaService } from './schema/SchemaService';
import { SchemaInferenceService } from './schema/SchemaInferenceService';
import { TypeGenerator } from './schema/TypeGenerator';
import { OpenApiGenerator } from './schema/OpenApiGenerator';
import { DocsService } from './admin/DocsService';
import { RuleEngine } from './rules/RuleEngine';
import { AuthService } from './auth/AuthService';
import { RecordService } from './records/RecordService';
import { FtsService } from './records/FtsService';
import { MockDataService } from './records/MockDataService';
import { FileStorageService } from './files/FileStorageService';
import { RealtimeService } from './realtime/RealtimeService';
import { LogService } from './logger/LogService';
import { EventBus } from './core/events/EventBus';
import { HttpServer } from './http/HttpServer';
import { AdminUIService } from './admin/AdminUIService';
import { AuthMiddleware } from './http/middleware/AuthMiddleware';
import { ChaosMiddleware } from './http/middleware/ChaosMiddleware';
import { AuthController } from './http/controllers/AuthController';
import { CollectionController } from './http/controllers/CollectionController';
import { RecordController } from './http/controllers/RecordController';
import { FileController } from './http/controllers/FileController';
import { RealtimeController } from './http/controllers/RealtimeController';
import { LogController } from './http/controllers/LogController';
import { HealthController } from './http/controllers/HealthController';
import { AnalyticsController } from './http/controllers/AnalyticsController';
import { AnalyticsService } from './analytics/AnalyticsService';
import { TemplateService } from './templates/TemplateService';
import { TemplateController } from './http/controllers/TemplateController';
import { DemoService } from './demo/DemoService';
import { DemoController } from './http/controllers/DemoController';
import { SnapshotService } from './snapshots/SnapshotService';
import { SnapshotController } from './http/controllers/SnapshotController';
import { AuditLogService } from './audit/AuditLogService';
import { AuditLogController } from './http/controllers/AuditLogController';
import { WebhookService } from './webhooks/WebhookService';
import { WebhookController } from './http/controllers/WebhookController';
import { AppRegistry } from './apps/AppRegistry';
import { AppManager, DatabaseDriverFactory } from './apps/AppManager';
import { AppScope } from './apps/AppScope';
import { AppController } from './http/controllers/AppController';
import { AppResolutionMiddleware } from './http/middleware/AppResolutionMiddleware';
import { MaintenanceGate } from './core/maintenance/MaintenanceGate';
import { PluginManager } from './core/plugins/PluginManager';
import { INodeStackPlugin, NodeStackPlugin } from './core/plugins/types';
import {
  HookHandler,
  RecordBeforeEventContext,
  RecordAfterEventContext,
  ServeEventContext,
} from './core/events/types';
import { IDatabaseDriver } from './database/drivers/IDatabaseDriver';

export interface NodeStackOptions extends NodeStackConfigOptions {
  customDriver?: IDatabaseDriver;
  systemDriver?: IDatabaseDriver;
  driverFactory?: DatabaseDriverFactory;
}

export class NodeStack {
  public readonly container: Container;
  public readonly config: ConfigService;
  public readonly maintenanceGate: MaintenanceGate;
  public readonly eventBus: EventBus;
  public readonly db: DatabaseService;
  public readonly schema: SchemaService;
  public readonly records: RecordService;
  public readonly mockData: MockDataService;
  public readonly templates: TemplateService;
  public readonly auth: AuthService;
  public readonly snapshots: SnapshotService;
  public readonly demo: DemoService;
  public readonly files: FileStorageService;
  public readonly realtime: RealtimeService;
  public readonly logs: LogService;
  public readonly analytics: AnalyticsService;
  public readonly schemaInference: SchemaInferenceService;
  public readonly typegen: TypeGenerator;
  public readonly openapi: OpenApiGenerator;
  public readonly docs: DocsService;
  public readonly adminUi: AdminUIService;
  public readonly chaos: ChaosMiddleware;
  public readonly authMiddleware: AuthMiddleware;
  public readonly server: HttpServer;
  public readonly pluginManager: PluginManager;
  public get plugins(): PluginManager {
    return this.pluginManager;
  }
  public readonly auditLogs: AuditLogService;
  public readonly fts: FtsService;
  public readonly webhooks: WebhookService;
  public readonly registry: AppRegistry;
  public readonly apps: AppManager;
  public readonly defaultApp: AppScope;
  public readonly appController: AppController;
  public readonly appResolution: AppResolutionMiddleware;

  constructor(options: NodeStackOptions = {}) {
    this.container = new Container();

    // 1. Config Service
    this.config = new ConfigService(options);
    this.container.bindInstance(TOKENS.ConfigService, this.config);

    // 1.2 System Registry & Multi-App Orchestrator
    this.registry = new AppRegistry(this.config, options.systemDriver || options.customDriver);
    this.container.bindInstance(TOKENS.AppRegistry, this.registry);

    this.apps = new AppManager(
      this.registry,
      this.config,
      options.customDriver,
      options.driverFactory
    );
    this.container.bindInstance(TOKENS.AppManager, this.apps);

    // 1.3 Boot Default App Scope
    this.defaultApp = this.apps.init();

    // 1.5 Maintenance Gate (coordinates demo resets & system maintenance with HTTP requests)
    this.maintenanceGate = this.defaultApp.maintenanceGate;
    this.container.bindInstance(TOKENS.MaintenanceGate, this.maintenanceGate);

    // 2. Database Service
    this.db = this.defaultApp.db;
    this.container.bindInstance(TOKENS.DatabaseService, this.db);

    // 3. Event Bus
    this.eventBus = this.defaultApp.eventBus;
    this.container.bindInstance(TOKENS.EventBus, this.eventBus);

    // 3.5 FTS Service
    this.fts = this.defaultApp.fts;
    this.container.bindInstance(TOKENS.FtsService, this.fts);

    // 4. Schema Service
    this.schema = this.defaultApp.schema;
    this.container.bindInstance(TOKENS.SchemaService, this.schema);

    // 5. Type Generator
    this.typegen = this.defaultApp.typegen;
    this.container.bindInstance(TOKENS.TypeGenerator, this.typegen);

    // 6. OpenAPI Generator
    this.openapi = this.defaultApp.openapi;
    this.container.bindInstance(TOKENS.OpenApiGenerator, this.openapi);

    // 7. Rule Engine
    const ruleEngine = this.defaultApp.ruleEngine;
    this.container.bindInstance(TOKENS.RuleEngine, ruleEngine);

    // 8. Auth Service
    this.auth = this.defaultApp.auth;
    this.container.bindInstance(TOKENS.AuthService, this.auth);

    // 9. File Storage Service
    this.files = this.defaultApp.files;
    this.container.bindInstance(TOKENS.FileStorageService, this.files);

    // 10. Realtime Service
    this.realtime = this.defaultApp.realtime;
    this.container.bindInstance(TOKENS.RealtimeService, this.realtime);

    // 11. Log Service
    this.logs = this.defaultApp.logs;
    this.container.bindInstance(TOKENS.LogService, this.logs);

    // 12. Record Service
    this.records = this.defaultApp.records;
    this.container.bindInstance(TOKENS.RecordService, this.records);

    // 13. Mock Data Service
    this.mockData = this.defaultApp.mockData;
    this.container.bindInstance(TOKENS.MockDataService, this.mockData);

    // 13.5 Starter Templates & Recipes Service
    this.templates = this.defaultApp.templates;
    this.container.bindInstance(TOKENS.TemplateService, this.templates);

    // 13.6 Demo Service ("Reset to Demo State")
    this.snapshots = this.defaultApp.snapshots;
    this.container.bindInstance(TOKENS.SnapshotService, this.snapshots);
    this.demo = this.defaultApp.demo;
    this.container.bindInstance(TOKENS.DemoService, this.demo);

    // 14. Analytics Service
    this.analytics = this.defaultApp.analytics;
    this.container.bindInstance(TOKENS.AnalyticsService, this.analytics);

    // 15. Admin UI & Docs Services
    this.adminUi = new AdminUIService();
    this.container.bindInstance(TOKENS.AdminUIService, this.adminUi);

    this.docs = new DocsService(this.openapi, this.config, this.apps);
    this.container.bindInstance(TOKENS.DocsService, this.docs);

    // 16. Schema Inference Service ("Paste JSON → Instant API")
    this.schemaInference = new SchemaInferenceService(this.db, this.schema, this.realtime);
    this.container.bindInstance(TOKENS.SchemaInferenceService, this.schemaInference);

    // 17. Controllers & Middleware
    this.chaos = new ChaosMiddleware(this.config);
    this.container.bindInstance(TOKENS.ChaosMiddleware, this.chaos);

    this.authMiddleware = new AuthMiddleware(this.auth);
    this.container.bindInstance(TOKENS.AuthMiddleware, this.authMiddleware);
    const authCtrl = new AuthController(this.auth);
    const collectionCtrl = new CollectionController(this.schema, this.schemaInference, this.files);
    const recordCtrl = new RecordController(this.records, this.schema, this.files, this.mockData);
    const fileCtrl = new FileController(this.files, this.schema, ruleEngine, this.db);
    const realtimeCtrl = new RealtimeController(this.realtime, this.apps);
    const logCtrl = new LogController(this.logs);
    const healthCtrl = new HealthController(this.config);
    const analyticsCtrl = new AnalyticsController(this.analytics);
    const templateCtrl = new TemplateController(this.templates);
    this.container.bindInstance(TOKENS.TemplateController, templateCtrl);
    const demoCtrl = new DemoController(this.demo);
    this.container.bindInstance(TOKENS.DemoController, demoCtrl);
    const snapshotCtrl = new SnapshotController(this.snapshots);
    this.container.bindInstance(TOKENS.SnapshotController, snapshotCtrl);

    // 17.5 Audit Log Service ("Read-Only Audit Trail")
    this.auditLogs = this.defaultApp.auditLogs;
    this.container.bindInstance(TOKENS.AuditLogService, this.auditLogs);

    const auditLogCtrl = new AuditLogController(this.auditLogs);
    this.container.bindInstance(TOKENS.AuditLogController, auditLogCtrl);

    // 17.6 Webhook Service ("Outbound Webhooks Manager")
    this.webhooks = this.defaultApp.webhooks;
    this.container.bindInstance(TOKENS.WebhookService, this.webhooks);

    const webhookCtrl = new WebhookController(this.webhooks);
    this.container.bindInstance(TOKENS.WebhookController, webhookCtrl);

    // 17.8 Multi-App Management & Resolution
    this.appController = new AppController(this.apps);
    this.appResolution = new AppResolutionMiddleware(this.apps);

    // 18. HTTP Server
    this.server = new HttpServer(
      this.config,
      this.logs,
      this.authMiddleware,
      authCtrl,
      collectionCtrl,
      recordCtrl,
      fileCtrl,
      realtimeCtrl,
      logCtrl,
      healthCtrl,
      this.adminUi,
      this.typegen,
      this.docs,
      analyticsCtrl,
      this.chaos,
      templateCtrl,
      demoCtrl,
      snapshotCtrl,
      this.maintenanceGate,
      auditLogCtrl,
      webhookCtrl,
      this.appController,
      this.appResolution
    );
    this.container.bindInstance(TOKENS.HttpServer, this.server);

    // 19. Plugin Manager
    this.pluginManager = new PluginManager(this, this.container);
    this.container.bindInstance(TOKENS.PluginRegistry, this.pluginManager);
  }

  // --- Formal Plugin Architecture (app.use) ---
  public use(plugin: NodeStackPlugin): this {
    this.pluginManager.use(plugin);
    return this;
  }

  public async initPlugins(): Promise<void> {
    await this.pluginManager.ensureInitialized();
  }

  public hasPlugin(name: string, db?: DatabaseService): boolean {
    return this.pluginManager.hasPlugin(name, db);
  }

  public getPlugin<T extends INodeStackPlugin = INodeStackPlugin>(name: string): T | undefined {
    return this.pluginManager.getPlugin<T>(name);
  }

  // --- Type & OpenAPI Generation ---
  public generateTypes(): string {
    return this.typegen.generate();
  }

  public generateOpenApi(): Record<string, any> {
    return this.openapi.generate({
      title: `${this.config?.appName || 'NodeStack'} API`,
    });
  }

  public generateOpenApiJson(pretty = true): string {
    return this.openapi.generateJson(pretty, {
      title: `${this.config?.appName || 'NodeStack'} API`,
    });
  }

  // --- Router for custom developer endpoints ---
  public get router(): {
    get: (path: string, handler: RouteHandlerMethod) => void;
    post: (path: string, handler: RouteHandlerMethod) => void;
    patch: (path: string, handler: RouteHandlerMethod) => void;
    delete: (path: string, handler: RouteHandlerMethod) => void;
    raw: FastifyInstance;
  } {
    return {
      get: (path: string, handler: RouteHandlerMethod) => this.server.app.get(path, handler),
      post: (path: string, handler: RouteHandlerMethod) => this.server.app.post(path, handler),
      patch: (path: string, handler: RouteHandlerMethod) => this.server.app.patch(path, handler),
      delete: (path: string, handler: RouteHandlerMethod) => this.server.app.delete(path, handler),
      raw: this.server.app,
    };
  }

  // --- Lifecycle Hooks Registration ---
  public onRecordBeforeCreate(
    collectionOrHandler: string | HookHandler<RecordBeforeEventContext>,
    handler?: HookHandler<RecordBeforeEventContext>
  ): this {
    this.eventBus.onRecordBeforeCreate(collectionOrHandler, handler);
    return this;
  }

  public onRecordAfterCreate(
    collectionOrHandler: string | HookHandler<RecordAfterEventContext>,
    handler?: HookHandler<RecordAfterEventContext>
  ): this {
    this.eventBus.onRecordAfterCreate(collectionOrHandler, handler);
    return this;
  }

  public onRecordBeforeUpdate(
    collectionOrHandler: string | HookHandler<RecordBeforeEventContext>,
    handler?: HookHandler<RecordBeforeEventContext>
  ): this {
    this.eventBus.onRecordBeforeUpdate(collectionOrHandler, handler);
    return this;
  }

  public onRecordAfterUpdate(
    collectionOrHandler: string | HookHandler<RecordAfterEventContext>,
    handler?: HookHandler<RecordAfterEventContext>
  ): this {
    this.eventBus.onRecordAfterUpdate(collectionOrHandler, handler);
    return this;
  }

  public onRecordBeforeDelete(
    collectionOrHandler: string | HookHandler<RecordBeforeEventContext>,
    handler?: HookHandler<RecordBeforeEventContext>
  ): this {
    this.eventBus.onRecordBeforeDelete(collectionOrHandler, handler);
    return this;
  }

  public onRecordAfterDelete(
    collectionOrHandler: string | HookHandler<RecordAfterEventContext>,
    handler?: HookHandler<RecordAfterEventContext>
  ): this {
    this.eventBus.onRecordAfterDelete(collectionOrHandler, handler);
    return this;
  }

  public onBeforeServe(handler: HookHandler<ServeEventContext>): this {
    this.eventBus.onBeforeServe(handler);
    return this;
  }

  public onAfterServe(handler: HookHandler<ServeEventContext>): this {
    this.eventBus.onAfterServe(handler);
    return this;
  }

  public onDemoSnapshot(handler: (metadata: any) => void | Promise<void>): this {
    this.eventBus.on('demo:snapshot', handler);
    return this;
  }

  public onSnapshotCreate(handler: (metadata: any) => void | Promise<void>): this {
    this.eventBus.on('snapshot:create', handler);
    return this;
  }

  public onSnapshotRestore(handler: (result: any) => void | Promise<void>): this {
    this.eventBus.on('snapshot:restore', handler);
    return this;
  }

  public onSnapshotDelete(handler: (info: any) => void | Promise<void>): this {
    this.eventBus.on('snapshot:delete', handler);
    return this;
  }

  public onDemoReset(handler: (result: any) => void | Promise<void>): this {
    this.eventBus.on('demo:reset', handler);
    return this;
  }

  // --- Start & Stop Application ---
  public async start(port = this.config.port, host = this.config.host): Promise<string> {
    // 1. Ensure all plugins have completed asynchronous initialization
    await this.pluginManager.ensureInitialized();

    const serveContext: ServeEventContext = {
      server: this.server.app,
      port,
      host,
    };

    await this.eventBus.triggerBeforeServe(serveContext);

    const address = await this.server.listen(port, host);

    await this.eventBus.triggerAfterServe(serveContext);

    this.printStartupBanner(address);

    return address;
  }

  public async stop(): Promise<void> {
    await this.pluginManager.dispose();
    this.realtime.dispose();
    await this.server.close();
    this.apps.closeAll();
    await this.container.dispose();
  }

  private printStartupBanner(address: string): void {
    const banner = `
${chalk.bold.cyan('  ╔═══════════════════════════════════════════════════════╗')}
${chalk.bold.cyan('  ║')}  ${chalk.bold.white('NodeStack')} ${chalk.dim('— The TypeScript-Native Backend Stack')}    ${chalk.bold.cyan('║')}
${chalk.bold.cyan('  ╚═══════════════════════════════════════════════════════╝')}

  ${chalk.green('➜')}  ${chalk.bold('Server:')}     ${chalk.cyan(address)}
  ${chalk.green('➜')}  ${chalk.bold('Admin UI:')}   ${chalk.cyan(`${address}/_/`)}
  ${chalk.green('➜')}  ${chalk.bold('API Docs:')}   ${chalk.cyan(`${address}/_/docs`)}
  ${chalk.green('➜')}  ${chalk.bold('REST API:')}   ${chalk.cyan(`${address}/api/`)}
  ${chalk.green('➜')}  ${chalk.bold('Realtime:')}   ${chalk.cyan(`${address}/api/realtime`)}
  ${chalk.green('➜')}  ${chalk.bold('Database:')}   ${chalk.gray(this.config.dbPath)}
  ${chalk.green('➜')}  ${chalk.bold('Storage:')}    ${chalk.gray(this.config.storageDir)}
`;
    console.log(banner);
  }
}

// Deprecated aliases for backwards compatibility
export { NodeStack as NodeBase, NodeStackOptions as NodeBaseOptions };
