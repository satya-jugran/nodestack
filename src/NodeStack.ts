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
import { MockDataService } from './records/MockDataService';
import { FileStorageService } from './files/FileStorageService';
import { RealtimeService } from './realtime/RealtimeService';
import { LogService } from './logger/LogService';
import { EventBus } from './core/events/EventBus';
import { HttpServer } from './http/HttpServer';
import { AdminUIService } from './admin/AdminUIService';
import { AuthMiddleware } from './http/middleware/AuthMiddleware';
import { AuthController } from './http/controllers/AuthController';
import { CollectionController } from './http/controllers/CollectionController';
import { RecordController } from './http/controllers/RecordController';
import { FileController } from './http/controllers/FileController';
import { RealtimeController } from './http/controllers/RealtimeController';
import { LogController } from './http/controllers/LogController';
import { HealthController } from './http/controllers/HealthController';
import { AnalyticsController } from './http/controllers/AnalyticsController';
import { AnalyticsService } from './analytics/AnalyticsService';
import {
  HookHandler,
  RecordBeforeEventContext,
  RecordAfterEventContext,
  ServeEventContext,
} from './core/events/types';
import { IDatabaseDriver } from './database/drivers/IDatabaseDriver';

export interface NodeStackOptions extends NodeStackConfigOptions {
  customDriver?: IDatabaseDriver;
}

export class NodeStack {
  public readonly container: Container;
  public readonly config: ConfigService;
  public readonly eventBus: EventBus;
  public readonly db: DatabaseService;
  public readonly schema: SchemaService;
  public readonly records: RecordService;
  public readonly mockData: MockDataService;
  public readonly auth: AuthService;
  public readonly files: FileStorageService;
  public readonly realtime: RealtimeService;
  public readonly logs: LogService;
  public readonly analytics: AnalyticsService;
  public readonly schemaInference: SchemaInferenceService;
  public readonly typegen: TypeGenerator;
  public readonly openapi: OpenApiGenerator;
  public readonly docs: DocsService;
  public readonly adminUi: AdminUIService;
  public readonly server: HttpServer;

  constructor(options: NodeStackOptions = {}) {
    this.container = new Container();

    // 1. Config Service
    this.config = new ConfigService(options);
    this.container.bindInstance(TOKENS.ConfigService, this.config);

    // 2. Database Service
    this.db = new DatabaseService(this.config, options.customDriver);
    this.container.bindInstance(TOKENS.DatabaseService, this.db);
    this.db.init(); // Run system tables migration

    // 3. Event Bus
    this.eventBus = new EventBus();
    this.container.bindInstance(TOKENS.EventBus, this.eventBus);

    // 4. Schema Service
    this.schema = new SchemaService(this.db);
    this.container.bindInstance(TOKENS.SchemaService, this.schema);

    // 5. Type Generator
    this.typegen = new TypeGenerator(this.schema);
    this.container.bindInstance(TOKENS.TypeGenerator, this.typegen);

    // 6. OpenAPI Generator
    this.openapi = new OpenApiGenerator(this.schema, {
      title: `${this.config.appName} API`,
    });
    this.container.bindInstance(TOKENS.OpenApiGenerator, this.openapi);

    // 7. Rule Engine
    const ruleEngine = new RuleEngine();
    this.container.bindInstance(TOKENS.RuleEngine, ruleEngine);

    // 8. Auth Service
    this.auth = new AuthService(this.db, this.config, this.schema);
    this.container.bindInstance(TOKENS.AuthService, this.auth);

    // 9. File Storage Service
    this.files = new FileStorageService(this.config);
    this.container.bindInstance(TOKENS.FileStorageService, this.files);

    // 10. Realtime Service
    this.realtime = new RealtimeService(ruleEngine, this.schema);
    this.container.bindInstance(TOKENS.RealtimeService, this.realtime);

    // 11. Log Service
    this.logs = new LogService(this.db);
    this.container.bindInstance(TOKENS.LogService, this.logs);

    // 12. Record Service
    this.records = new RecordService(
      this.db,
      this.schema,
      ruleEngine,
      this.eventBus,
      this.realtime,
      this.files
    );
    this.container.bindInstance(TOKENS.RecordService, this.records);

    // 13. Mock Data Service
    this.mockData = new MockDataService(
      this.db,
      this.schema,
      this.files,
      this.eventBus,
      this.realtime
    );
    this.container.bindInstance(TOKENS.MockDataService, this.mockData);

    // 14. Analytics Service
    this.analytics = new AnalyticsService(this.db, this.config, this.schema, this.realtime);
    this.container.bindInstance(TOKENS.AnalyticsService, this.analytics);

    // 15. Admin UI & Docs Services
    this.adminUi = new AdminUIService();
    this.container.bindInstance(TOKENS.AdminUIService, this.adminUi);

    this.docs = new DocsService(this.openapi, this.config);
    this.container.bindInstance(TOKENS.DocsService, this.docs);

    // 16. Schema Inference Service ("Paste JSON → Instant API")
    this.schemaInference = new SchemaInferenceService(this.db, this.schema, this.realtime);
    this.container.bindInstance(TOKENS.SchemaInferenceService, this.schemaInference);

    // 17. Controllers & Middleware
    const authMiddleware = new AuthMiddleware(this.auth);
    const authCtrl = new AuthController(this.auth);
    const collectionCtrl = new CollectionController(this.schema, this.schemaInference);
    const recordCtrl = new RecordController(this.records, this.schema, this.files, this.mockData);
    const fileCtrl = new FileController(this.files, this.schema, ruleEngine, this.db);
    const realtimeCtrl = new RealtimeController(this.realtime);
    const logCtrl = new LogController(this.logs);
    const healthCtrl = new HealthController(this.config);
    const analyticsCtrl = new AnalyticsController(this.analytics);

    // 16. HTTP Server
    this.server = new HttpServer(
      this.config,
      this.logs,
      authMiddleware,
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
      analyticsCtrl
    );
    this.container.bindInstance(TOKENS.HttpServer, this.server);
  }

  // --- Type & OpenAPI Generation ---
  public generateTypes(): string {
    return this.typegen.generate();
  }

  public generateOpenApi(): Record<string, any> {
    return this.openapi.generate();
  }

  public generateOpenApiJson(pretty = true): string {
    return this.openapi.generateJson(pretty);
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

  // --- Start & Stop Application ---
  public async start(port = this.config.port, host = this.config.host): Promise<string> {
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
    this.realtime.dispose();
    await this.server.close();
    this.db.close();
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
