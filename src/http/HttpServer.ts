import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Readable } from 'stream';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ConfigService, CorsConfigOptions } from '../core/config/ConfigService';
import { LogService } from '../logger/LogService';
import { AuthMiddleware } from './middleware/AuthMiddleware';
import { ChaosMiddleware } from './middleware/ChaosMiddleware';
import { AuthController } from './controllers/AuthController';
import { CollectionController } from './controllers/CollectionController';
import { RecordController } from './controllers/RecordController';
import { FileController } from './controllers/FileController';
import { RealtimeController } from './controllers/RealtimeController';
import { LogController } from './controllers/LogController';
import { HealthController } from './controllers/HealthController';
import { AnalyticsController } from './controllers/AnalyticsController';
import { TemplateController } from './controllers/TemplateController';
import { SnapshotController } from './controllers/SnapshotController';
import { AuditLogController } from './controllers/AuditLogController';
import { WebhookController } from './controllers/WebhookController';
import { FunctionController } from './controllers/FunctionController';
import { FlowController } from './controllers/FlowController';
import { QueueController } from './controllers/QueueController';
import { DatabaseController } from './controllers/DatabaseController';
import { AppController } from './controllers/AppController';
import { AppResolutionMiddleware } from './middleware/AppResolutionMiddleware';
import { ApiKeyController } from './controllers/ApiKeyController';
import { AdminUIService } from '../admin/AdminUIService';
import { DocsService } from '../admin/DocsService';
import { TypeGenerator } from '../schema/TypeGenerator';
import { AppError } from '../core/errors/AppError';
import { MaintenanceGate } from '../core/maintenance/MaintenanceGate';

export class HttpServer {
  public readonly app: FastifyInstance;
  public readonly chaosMiddleware: ChaosMiddleware;
  public readonly maintenanceGate?: MaintenanceGate;
  private apiKeyController?: ApiKeyController;
  private functionController?: FunctionController;
  private flowController?: FlowController;
  private queueController?: QueueController;
  private databaseController?: DatabaseController;
  private dynamicRouteHandler?: (req: FastifyRequest, reply: FastifyReply) => Promise<boolean>;
  private dynamicRouteMatcher?: (method: string, path: string) => any;

  public setDatabaseController(controller: DatabaseController): void {
    this.databaseController = controller;
  }

  public setApiKeyController(controller: ApiKeyController): void {
    this.apiKeyController = controller;
  }

  public setFunctionController(controller: FunctionController): void {
    this.functionController = controller;
  }

  public setFlowController(controller: FlowController): void {
    this.flowController = controller;
  }

  public setQueueController(controller: QueueController): void {
    this.queueController = controller;
  }

  public setDynamicRouteHandler(handler: (req: FastifyRequest, reply: FastifyReply) => Promise<boolean>): void {
    this.dynamicRouteHandler = handler;
  }

  public setDynamicRouteMatcher(matcher: (method: string, path: string) => any): void {
    this.dynamicRouteMatcher = matcher;
  }

  constructor(
    private config: ConfigService,
    private logService: LogService,
    private authMiddleware: AuthMiddleware,
    private authController: AuthController,
    private collectionController: CollectionController,
    private recordController: RecordController,
    private fileController: FileController,
    private realtimeController: RealtimeController,
    private logController: LogController,
    private healthController: HealthController,
    private adminUiService: AdminUIService,
    private typeGenerator?: TypeGenerator,
    private docsService?: DocsService,
    analyticsControllerOrChaos?: AnalyticsController | ChaosMiddleware,
    chaosMiddleware?: ChaosMiddleware,
    private templateController?: TemplateController,
    private snapshotController?: SnapshotController,
    maintenanceGate?: MaintenanceGate,
    private auditLogController?: AuditLogController,
    private webhookController?: WebhookController,
    private appController?: AppController,
    private appResolutionMiddleware?: AppResolutionMiddleware,
    apiKeyController?: ApiKeyController,
    functionController?: FunctionController,
    flowController?: FlowController,
    queueController?: QueueController,
    databaseController?: DatabaseController
  ) {
    this.maintenanceGate = maintenanceGate;
    if (databaseController) {
      this.databaseController = databaseController;
    }
    if (apiKeyController) {
      this.apiKeyController = apiKeyController;
    }
    if (functionController) {
      this.functionController = functionController;
    }
    if (flowController) {
      this.flowController = flowController;
    }
    if (queueController) {
      this.queueController = queueController;
    }

    let analyticsController: AnalyticsController | undefined;
    if (analyticsControllerOrChaos instanceof ChaosMiddleware) {
      this.chaosMiddleware = analyticsControllerOrChaos;
    } else {
      analyticsController = analyticsControllerOrChaos;
      this.chaosMiddleware = chaosMiddleware || new ChaosMiddleware(config);
    }
    this.analyticsController = analyticsController;

    this.app = fastify({
      logger: false,
    });

    this.setupPlugins();
    this.setupHooks();
    this.setupRoutes();
    this.setupErrorHandler();
  }

  private analyticsController?: AnalyticsController;

  private setupPlugins(): void {
    this.setupCors();

    this.app.register(multipart, {
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit
      },
    });

    this.app.addContentTypeParser(
      ['text/csv', 'text/plain'],
      { parseAs: 'string' },
      (_req, body, done) => {
        done(null, body);
      }
    );
  }

  private setupCors(): void {
    if (this.config.cors === false) {
      return;
    }

    const configCors: CorsConfigOptions =
      typeof this.config.cors === 'object' && this.config.cors !== null
        ? this.config.cors
        : {};

    const defaultMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    const defaultExposedHeaders = [
      'x-simulated-delay',
      'x-simulated-chaos',
      'x-simulated-error',
      'x-simulated-fail-rate',
    ];

    const methods = configCors.methods || defaultMethods;
    const exposedHeaders = configCors.exposedHeaders || defaultExposedHeaders;
    const allowedHeaders = configCors.allowedHeaders ?? null;
    const maxAge = configCors.maxAge ?? null;

    const localhostRegex = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

    const isWildcardOrigin =
      configCors.origin === '*' ||
      (typeof configCors.origin === 'string' && configCors.origin.trim() === '*') ||
      (Array.isArray(configCors.origin) &&
        configCors.origin.some((p) => typeof p === 'string' && p.trim() === '*'));

    const isMatch = (origin: string, pattern: string | RegExp | Array<string | RegExp>): boolean => {
      if (Array.isArray(pattern)) {
        return pattern.some((p) => isMatch(origin, p));
      }
      if (pattern instanceof RegExp) {
        if (pattern.global || pattern.sticky) {
          pattern.lastIndex = 0;
          return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(origin);
        }
        return pattern.test(origin);
      }
      if (typeof pattern === 'string') {
        const trimmed = pattern.trim();
        if (trimmed === '*') return false;
        return origin.replace(/\/+$/, '') === trimmed.replace(/\/+$/, '');
      }
      return false;
    };

    const isTrustedOrigin = (origin: string): boolean => {
      if (isWildcardOrigin || configCors.origin === false) {
        return false;
      }

      // 1. User configured allowlist
      if (configCors.origin !== undefined && configCors.origin !== true) {
        if (typeof configCors.origin !== 'function') {
          return isMatch(origin, configCors.origin);
        }
      }

      // 2. In development mode, trust localhost and self host/port by default
      if (this.config.dev) {
        if (localhostRegex.test(origin)) {
          return true;
        }
        if (this.config.host && this.config.host !== '0.0.0.0') {
          const selfHttp = `http://${this.config.host}:${this.config.port}`;
          const selfHttps = `https://${this.config.host}:${this.config.port}`;
          if (isMatch(origin, [selfHttp, selfHttps])) {
            return true;
          }
        }
      }

      return false;
    };

    this.app.register(cors, {
      delegator: (req: FastifyRequest, callback: (err: Error | null, corsOptions?: any) => void) => {
        const origin = req.headers.origin;

        // If request does not have an Origin header, omit CORS headers
        if (!origin) {
          callback(null, {
            origin: false,
          });
          return;
        }

        // Explicitly disabled origin (origin: false)
        if (configCors.origin === false) {
          callback(null, {
            origin: false,
            credentials: false,
          });
          return;
        }

        // Handle custom origin callback or promise function
        if (typeof configCors.origin === 'function') {
          const fn = configCors.origin;
          const handleResult = (allow: boolean) => {
            if (!allow) {
              callback(null, { origin: false, credentials: false });
            } else {
              callback(null, {
                origin,
                credentials: configCors.credentials !== false,
                methods,
                allowedHeaders,
                exposedHeaders,
                maxAge,
              });
            }
          };

          try {
            if (fn.length >= 2) {
              fn(origin, (err, allow) => {
                if (err) return callback(err);
                handleResult(Boolean(allow));
              });
            } else {
              const res = (fn as any)(origin);
              if (res && typeof res.then === 'function') {
                res.then((allow: boolean) => handleResult(Boolean(allow))).catch(callback);
              } else {
                handleResult(Boolean(res));
              }
            }
          } catch (err: any) {
            callback(err);
          }
          return;
        }

        // Wildcard origin: explicitly disallow credentials per W3C CORS specification
        if (isWildcardOrigin) {
          callback(null, {
            origin: '*',
            credentials: false,
            methods,
            allowedHeaders,
            exposedHeaders,
            maxAge,
          });
          return;
        }

        // If explicit reflection is configured (origin: true):
        // Allow reflection, but strictly disallow credentials for untrusted origins
        if (configCors.origin === true) {
          const trusted = isTrustedOrigin(origin);
          callback(null, {
            origin: true,
            credentials: trusted ? (configCors.credentials !== false) : false,
            methods,
            allowedHeaders,
            exposedHeaders,
            maxAge,
          });
          return;
        }

        // For allowlisted or default trusted origins
        const trusted = isTrustedOrigin(origin);
        if (trusted) {
          callback(null, {
            origin: true,
            credentials: configCors.credentials !== false,
            methods,
            allowedHeaders,
            exposedHeaders,
            maxAge,
          });
          return;
        }

        // Untrusted origin:
        // If development reflection is specifically enabled, reflect origin with credentials: false
        if (configCors.allowDevReflection && this.config.dev) {
          callback(null, {
            origin: true,
            credentials: false,
            methods,
            allowedHeaders,
            exposedHeaders,
            maxAge,
          });
          return;
        }

        // Otherwise disallow untrusted origins completely
        callback(null, {
          origin: false,
          credentials: false,
        });
      },
    });
  }

  private setupHooks(): void {
    // Latency, request tracking, and audit logging
    this.app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      (req as any)._startTime = process.hrtime();
      const reqId = (req.id as string) || (req.headers['x-request-id'] as string) || `req_${Math.random().toString(36).substring(2, 9)}`;
      (req as any)._reqId = reqId;

      // Resolve application scope
      if (this.appResolutionMiddleware) {
        await this.appResolutionMiddleware.resolve()(req, reply);
        if (reply.sent) return;
      }

      // Coordinate reset with request/database locking maintenance gate
      const gate = (req as any).appScope?.maintenanceGate || this.maintenanceGate;
      if (gate) {
        (req as any)._maintenanceGate = gate;
        const isExclusiveMutation =
          (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PATCH') &&
          (req.url.includes('/restore') ||
           req.url.includes('/snapshots') ||
           req.url.includes('/database/switch'));
        const isExempt =
          isExclusiveMutation ||
          req.url.includes('/restore') ||
          req.url.includes('/database/switch') ||
          req.url.includes('/database/migration-progress') ||
          req.url.startsWith('/api/realtime');
        try {
          await gate.trackRequestStart(reqId, isExempt);
        } catch (err: any) {
          return reply.status(503).send({
            statusCode: 503,
            error: 'Service Unavailable',
            message: err.message || 'Server is temporarily undergoing snapshot maintenance. Please retry.',
          });
        }
      }

      if (req.raw && !req.raw.destroyed) {
        req.raw.once('close', () => {
          const gate = (req as any)._maintenanceGate || (req as any).appScope?.maintenanceGate || this.maintenanceGate;
          if (gate) {
            gate.trackRequestEnd(reqId);
          }
        });
      }

      // Extract authentication claims first so req.auth is populated for gate checks
      await this.authMiddleware.handle(req, null as any);

      // Latency & Chaos Simulation (For Testing Frontend States)
      // Gated by explicit development/feature flag or admin authorization
      if (this.chaosMiddleware) {
        const shortCircuited = await this.chaosMiddleware.handle(req, reply);
        if (shortCircuited || reply.sent) {
          const gate = (req as any)._maintenanceGate || (req as any).appScope?.maintenanceGate || this.maintenanceGate;
          if (gate && req.raw?.destroyed) {
            gate.trackRequestEnd(reqId);
          }
          return;
        }
      }

      // Fast-path dispatch for dynamic plugin routes that might otherwise be intercepted by static/parametric routes
      if (req.method === 'GET') {
        const urlPath = (req.url || '').split('?')[0];
        if (urlPath === '/api/webhooks/status' && this.dynamicRouteMatcher && this.dynamicRouteMatcher('GET', urlPath) && this.dynamicRouteHandler) {
          const handled = await this.dynamicRouteHandler(req, reply);
          if (handled || reply.sent) return;
        }
      }
    });

    // Dynamic Route preParsing & rawBody Capture
    this.app.addHook('preParsing', async (req: FastifyRequest, reply: FastifyReply, payload: any) => {
      const contentType = (req.headers['content-type'] as string) || '';
      if (contentType.includes('multipart/form-data')) {
        return payload;
      }

      const urlPath = (req.url || '').split('?')[0];
      const dynamicRoute = this.dynamicRouteMatcher ? this.dynamicRouteMatcher(req.method, urlPath) : null;
      if (!dynamicRoute) {
        return payload;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const buf = Buffer.concat(chunks);
      (req as any).rawBody = buf.toString('utf8');

      let stream: any = Readable.from([buf]);
      if (dynamicRoute.preParsing) {
        const hooks = Array.isArray(dynamicRoute.preParsing) ? dynamicRoute.preParsing : [dynamicRoute.preParsing];
        for (const hook of hooks) {
          stream = await hook(req, reply, stream);
        }
      }
      return stream;
    });

    this.app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
      const reqId = (req as any)._reqId;
      const gate = (req as any)._maintenanceGate || (req as any).appScope?.maintenanceGate || this.maintenanceGate;
      if (reqId && gate) {
        gate.trackRequestEnd(reqId);
      }

      const startTime = (req as any)._startTime;
      let duration = 0;
      if (startTime) {
        const diff = process.hrtime(startTime);
        duration = diff[0] * 1000 + diff[1] / 1e6;
      }

      const logEntry = {
        method: req.method,
        url: req.url,
        status: reply.statusCode,
        duration,
        ip: req.ip,
        authId: req.auth?.id,
        authCollection: req.auth?.collection,
        userAgent: req.headers['user-agent'],
      };

      const targetLogs = (req as any).appScope?.logs || this.logService;
      targetLogs.logRequest(logEntry);
      if (targetLogs !== this.logService) {
        this.logService.logRequest(logEntry, { skipConsole: true });
      }
    });

    this.app.addHook('onError', async (req: FastifyRequest) => {
      const reqId = (req as any)._reqId;
      const gate = (req as any)._maintenanceGate || (req as any).appScope?.maintenanceGate || this.maintenanceGate;
      if (reqId && gate) {
        gate.trackRequestEnd(reqId);
      }
    });
  }

  private setupErrorHandler(): void {
    this.app.setErrorHandler((error: any, _req: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          statusCode: error.statusCode,
          message: error.message,
          data: error.data,
        });
      }

      // Fastify validation or syntax errors
      const status = error.statusCode || 500;
      if (status >= 500) {
        console.error('[HttpServer] Internal error:', error);
      }

      return reply.status(status).send({
        statusCode: status,
        message: error.message || 'Internal server error',
      });
    });

    this.app.setNotFoundHandler(async (req: FastifyRequest, reply: FastifyReply) => {
      if (this.dynamicRouteHandler) {
        try {
          const handled = await this.dynamicRouteHandler(req, reply);
          if (handled) return;
        } catch (err: any) {
          const status = err.statusCode || 500;
          return reply.status(status).send({
            statusCode: status,
            message: err.message || 'Internal server error',
          });
        }
      }

      if (req.url.startsWith('/_/')) {
        reply.header('Content-Type', 'text/html; charset=utf-8');
        return reply.send(this.adminUiService.getHtml());
      }

      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Route ${req.method}:${req.url} not found`,
      });
    });
  }

  private setupRoutes(): void {
    const app = this.app;
    const requireAdmin = this.authMiddleware.requireAdmin();

    // 0. Application / MVP Management Endpoints (Super-admin only)
    if (this.appController) {
      app.get('/api/apps', { preHandler: requireAdmin }, (req, reply) =>
        this.appController!.list(req, reply)
      );
      app.post('/api/apps', { preHandler: requireAdmin }, (req: any, reply) =>
        this.appController!.create(req, reply)
      );
      app.get('/api/apps/:appId', { preHandler: requireAdmin }, (req: any, reply) =>
        this.appController!.getOne(req, reply)
      );
      app.patch('/api/apps/:appId', { preHandler: requireAdmin }, (req: any, reply) =>
        this.appController!.update(req, reply)
      );
      app.delete('/api/apps/:appId', { preHandler: requireAdmin }, (req: any, reply) =>
        this.appController!.delete(req, reply)
      );
    }

    // 0.2 System Database Management Endpoints (Super-admin only)
    if (this.databaseController) {
      app.get('/api/system/database/status', { preHandler: requireAdmin }, (req, reply) =>
        this.databaseController!.getStatus(req, reply)
      );
      app.get('/api/system/database/migration-progress', { preHandler: requireAdmin }, (req, reply) =>
        this.databaseController!.getMigrationProgress(req, reply)
      );
      app.post('/api/system/database/test', { preHandler: requireAdmin }, (req: any, reply) =>
        this.databaseController!.testConnection(req, reply)
      );
      app.post('/api/system/database/switch', { preHandler: requireAdmin }, (req: any, reply) =>
        this.databaseController!.switchDatabase(req, reply)
      );
    }

    // 0.5 Scoped routes for /api/apps/:appId/...
    app.get('/api/apps/:appId/collections', { preHandler: requireAdmin }, (req, reply) =>
      this.collectionController.list(req, reply)
    );
    app.post('/api/apps/:appId/collections', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.create(req, reply)
    );
    app.post('/api/apps/:appId/collections/infer-schema', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.inferSchema(req, reply)
    );
    app.post('/api/apps/:appId/collections/import-json', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.importJson(req, reply)
    );
    app.get('/api/apps/:appId/collections/:collection', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.getOne(req, reply)
    );
    app.patch('/api/apps/:appId/collections/:collection', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.update(req, reply)
    );
    app.delete('/api/apps/:appId/collections/:collection', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.delete(req, reply)
    );
    app.get('/api/apps/:appId/collections/:collection/records', (req: any, reply) =>
      this.recordController.getList(req, reply)
    );
    app.get('/api/apps/:appId/collections/:collection/records/:id', (req: any, reply) =>
      this.recordController.getOne(req, reply)
    );
    app.post('/api/apps/:appId/collections/:collection/records', (req: any, reply) =>
      this.recordController.create(req, reply)
    );
    app.patch('/api/apps/:appId/collections/:collection/records/:id', (req: any, reply) =>
      this.recordController.update(req, reply)
    );
    app.delete('/api/apps/:appId/collections/:collection/records/:id', (req: any, reply) =>
      this.recordController.delete(req, reply)
    );
    app.get('/api/apps/:appId/collections/:collection/export', (req: any, reply) =>
      this.recordController.exportRecords(req, reply)
    );
    app.get('/api/apps/:appId/collections/:collection/export/:format', (req: any, reply) =>
      this.recordController.exportRecords(req, reply)
    );
    app.post('/api/apps/:appId/collections/:collection/import', (req: any, reply) =>
      this.recordController.importRecords(req, reply)
    );
    app.post('/api/apps/:appId/collections/:collection/auth-with-password', (req: any, reply) =>
      this.authController.recordLogin(req, reply)
    );
    app.get('/api/apps/:appId/collections/:collection/auth-methods', (req: any, reply) =>
      this.authController.listAuthMethods(req, reply)
    );
    app.post('/api/apps/:appId/collections/:collection/auth-with-oauth2', (req: any, reply) =>
      this.authController.authWithOAuth2(req, reply)
    );
    app.get('/api/apps/:appId/collections/:collection/records/:id/external-auths', (req: any, reply) =>
      this.authController.getExternalAuths(req, reply)
    );
    app.delete('/api/apps/:appId/collections/:collection/records/:id/external-auths/:provider', (req: any, reply) =>
      this.authController.unlinkExternalAuth(req, reply)
    );

    // Scoped API Keys & Service Accounts
    app.get('/api/apps/:appId/api-keys', { preHandler: requireAdmin }, (req: any, reply) =>
      this.apiKeyController ? this.apiKeyController.list(req, reply) : reply.status(501).send()
    );
    app.post('/api/apps/:appId/api-keys', { preHandler: requireAdmin }, (req: any, reply) =>
      this.apiKeyController ? this.apiKeyController.create(req, reply) : reply.status(501).send()
    );
    app.get('/api/apps/:appId/api-keys/:id', { preHandler: requireAdmin }, (req: any, reply) =>
      this.apiKeyController ? this.apiKeyController.getOne(req, reply) : reply.status(501).send()
    );
    app.patch('/api/apps/:appId/api-keys/:id', { preHandler: requireAdmin }, (req: any, reply) =>
      this.apiKeyController ? this.apiKeyController.update(req, reply) : reply.status(501).send()
    );
    app.delete('/api/apps/:appId/api-keys/:id', { preHandler: requireAdmin }, (req: any, reply) =>
      this.apiKeyController ? this.apiKeyController.delete(req, reply) : reply.status(501).send()
    );
    app.post('/api/apps/:appId/api-keys/:id/rotate', { preHandler: requireAdmin }, (req: any, reply) =>
      this.apiKeyController ? this.apiKeyController.rotate(req, reply) : reply.status(501).send()
    );
    app.get('/api/apps/:appId/files/:collection/:recordId/:filename', (req: any, reply) =>
      this.fileController.getFile(req, reply)
    );
    app.post('/api/apps/:appId/collections/:collection/generate-mock', { preHandler: requireAdmin }, (req: any, reply) =>
      this.recordController.generateMock(req, reply)
    );

    if (this.snapshotController) {
      const requireAdminOrInitial = this.authMiddleware.requireAdminOrInitialSetup();
      const requireAdmin = this.authMiddleware.requireAdmin();
      app.get('/api/apps/:appId/snapshots', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.snapshotController!.listSnapshots(req, reply)
      );
      app.post('/api/apps/:appId/snapshots', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.snapshotController!.createSnapshot(req, reply)
      );
      app.get('/api/apps/:appId/snapshots/:id', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.snapshotController!.getSnapshot(req, reply)
      );
      app.post('/api/apps/:appId/snapshots/:id/restore', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.snapshotController!.restoreSnapshot(req, reply)
      );
      app.delete('/api/apps/:appId/snapshots/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.snapshotController!.deleteSnapshot(req, reply)
      );
      app.delete('/api/apps/:appId/snapshots', { preHandler: requireAdmin }, (req: any, reply) =>
        this.snapshotController!.clearAllSnapshots(req, reply)
      );
    }
    if (this.webhookController) {
      app.get('/api/apps/:appId/webhooks', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.getWebhooks(req, reply)
      );
      app.post('/api/apps/:appId/webhooks', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.createWebhook(req, reply)
      );
      app.get('/api/apps/:appId/webhooks/stats', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.getStats(req, reply)
      );
      app.get('/api/apps/:appId/webhooks/deliveries', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.getDeliveries(req, reply)
      );
      app.get('/api/apps/:appId/webhooks/deliveries/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.getDelivery(req, reply)
      );
      app.get('/api/apps/:appId/webhooks/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.getWebhook(req, reply)
      );
      app.patch('/api/apps/:appId/webhooks/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.updateWebhook(req, reply)
      );
      app.delete('/api/apps/:appId/webhooks/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.deleteWebhook(req, reply)
      );
      app.post('/api/apps/:appId/webhooks/:id/test', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.testWebhook(req, reply)
      );
      app.delete('/api/apps/:appId/webhooks/deliveries', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.clearDeliveries(req, reply)
      );
      app.post('/api/apps/:appId/webhooks/deliveries/:id/retry', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.retryDelivery(req, reply)
      );
    }

    if (this.functionController) {
      const requireAdmin = this.authMiddleware.requireAdmin();
      app.get('/api/apps/:appId/functions', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.getFunctions(req, reply)
      );
      app.post('/api/apps/:appId/functions', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.createFunction(req, reply)
      );
      app.get('/api/apps/:appId/functions/stats', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.getStats(req, reply)
      );
      app.get('/api/apps/:appId/functions/logs', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.getLogs(req, reply)
      );
      app.delete('/api/apps/:appId/functions/logs', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.clearLogs(req, reply)
      );
      app.get('/api/apps/:appId/functions/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.getFunction(req, reply)
      );
      app.patch('/api/apps/:appId/functions/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.updateFunction(req, reply)
      );
      app.delete('/api/apps/:appId/functions/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.deleteFunction(req, reply)
      );
      app.post('/api/apps/:appId/functions/:id/test', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.testFunction(req, reply)
      );
      app.get('/api/apps/:appId/functions/:id/logs', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.getLogs(req, reply)
      );
      app.all('/api/apps/:appId/functions/:name/invoke', (req: any, reply) =>
        this.functionController!.invoke(req, reply)
      );
    }

    if (this.flowController) {
      const requireAdmin = this.authMiddleware.requireAdmin();
      app.get('/api/apps/:appId/flows', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.getFlows(req, reply)
      );
      app.post('/api/apps/:appId/flows', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.createFlow(req, reply)
      );
      app.get('/api/apps/:appId/flows/executions', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.getExecutions(req, reply)
      );
      app.get('/api/apps/:appId/flows/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.getFlow(req, reply)
      );
      app.patch('/api/apps/:appId/flows/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.updateFlow(req, reply)
      );
      app.delete('/api/apps/:appId/flows/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.deleteFlow(req, reply)
      );
      app.post('/api/apps/:appId/flows/:id/execute', (req: any, reply) =>
        this.flowController!.executeFlow(req, reply)
      );
      app.get('/api/apps/:appId/flows/:id/executions', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.getExecutions(req, reply)
      );
      app.get('/api/apps/:appId/flows/executions/:executionId', (req: any, reply) =>
        this.flowController!.getExecution(req, reply)
      );
      app.post('/api/apps/:appId/flows/executions/:executionId/resume', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.resumeExecution(req, reply)
      );
      app.post('/api/apps/:appId/flows/executions/:executionId/abort', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.abortExecution(req, reply)
      );
      app.post('/api/apps/:appId/flows/executions/recover', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.recoverExecutions(req, reply)
      );
      app.delete('/api/apps/:appId/flows/:id/executions', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.clearExecutions(req, reply)
      );
    }

    if (this.queueController) {
      const requireAdminOrInitial = this.authMiddleware.requireAdminOrInitialSetup();
      app.get('/api/apps/:appId/queues', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getQueues(req, reply)
      );
      app.post('/api/apps/:appId/queues', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.upsertQueue(req, reply)
      );
      app.get('/api/apps/:appId/queues/stats', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getStats(req, reply)
      );
      app.get('/api/apps/:appId/queues/messages', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getAllMessages(req, reply)
      );
      app.get('/api/apps/:appId/queues/messages/:id', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getMessageById(req, reply)
      );
      app.post('/api/apps/:appId/queues/cleanup', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.cleanupQueues(req, reply)
      );
      app.get('/api/apps/:appId/queues/:name', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getQueue(req, reply)
      );
      app.delete('/api/apps/:appId/queues/:name', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.deleteQueue(req, reply)
      );
      app.post('/api/apps/:appId/queues/:name/messages', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.sendMessage(req, reply)
      );
      app.get('/api/apps/:appId/queues/:name/messages', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getMessages(req, reply)
      );
      app.get('/api/apps/:appId/queues/:name/messages/:id', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getMessage(req, reply)
      );
      app.post('/api/apps/:appId/queues/:name/messages/:id/ack', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.ackMessage(req, reply)
      );
      app.post('/api/apps/:appId/queues/:name/messages/:id/nack', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.nackMessage(req, reply)
      );
      app.post('/api/apps/:appId/queues/:name/messages/:id/touch', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.touchMessage(req, reply)
      );
      app.post('/api/apps/:appId/queues/:name/messages/:id/skip', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.forceSkipMessage(req, reply)
      );
      app.post('/api/apps/:appId/queues/:name/messages/:id/retry', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.retryMessage(req, reply)
      );
      app.delete('/api/apps/:appId/queues/:name/messages/:id', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.deleteMessage(req, reply)
      );
      app.post('/api/apps/:appId/queues/:name/dlq/retry', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.retryDlq(req, reply)
      );
      app.delete('/api/apps/:appId/queues/:name/purge', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.purgeQueue(req, reply)
      );
    }

    app.get('/api/apps/:appId/realtime', (req, reply) => this.realtimeController.connect(req, reply));
    app.post('/api/apps/:appId/realtime', (req, reply) => this.realtimeController.setSubscriptions(req, reply));

    if (this.templateController) {
      const requireAdminOrInitial = this.authMiddleware.requireAdminOrInitialSetup();
      app.get('/api/apps/:appId/templates', (req, reply) => this.templateController!.list(req, reply));
      app.get('/api/apps/:appId/templates/:template', (req: any, reply) => this.templateController!.getOne(req, reply));
      app.post('/api/apps/:appId/templates/apply', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.templateController!.apply(req, reply)
      );
      app.post('/api/apps/:appId/templates/:template/apply', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.templateController!.applyParam(req, reply)
      );
    }

    // 1. Health & Settings
    app.get('/api/health', (req, reply) => this.healthController.getHealth(req, reply));
    app.get('/api/settings', (req, reply) => this.healthController.getSettings(req, reply));

    // 2. Auth Endpoints
    app.get('/api/admins/has-admins', (req, reply) => this.authController.hasAdmins(req, reply));
    app.post('/api/admins/create-initial', (req, reply) => this.authController.createInitialAdmin(req, reply));
    app.post('/api/admins/auth-with-password', (req, reply) => this.authController.adminLogin(req, reply));
    app.get('/api/admins/me', (req, reply) => this.authController.getAdminMe(req, reply));
    app.post('/api/collections/:collection/auth-with-password', (req: any, reply) =>
      this.authController.recordLogin(req, reply)
    );
    app.get('/api/collections/:collection/auth-methods', (req: any, reply) =>
      this.authController.listAuthMethods(req, reply)
    );
    app.post('/api/collections/:collection/auth-with-oauth2', (req: any, reply) =>
      this.authController.authWithOAuth2(req, reply)
    );
    app.get('/api/collections/:collection/records/:id/external-auths', (req: any, reply) =>
      this.authController.getExternalAuths(req, reply)
    );
    app.delete('/api/collections/:collection/records/:id/external-auths/:provider', (req: any, reply) =>
      this.authController.unlinkExternalAuth(req, reply)
    );

    // 2.5 API Keys & Machine-to-Machine (M2M) Endpoints (Super-admin only)
    app.get('/api/api-keys', { preHandler: requireAdmin }, (req, reply) =>
      this.apiKeyController ? this.apiKeyController.list(req, reply) : reply.status(501).send()
    );
    app.post('/api/api-keys', { preHandler: requireAdmin }, (req: any, reply) =>
      this.apiKeyController ? this.apiKeyController.create(req, reply) : reply.status(501).send()
    );
    app.get('/api/api-keys/:id', { preHandler: requireAdmin }, (req: any, reply) =>
      this.apiKeyController ? this.apiKeyController.getOne(req, reply) : reply.status(501).send()
    );
    app.patch('/api/api-keys/:id', { preHandler: requireAdmin }, (req: any, reply) =>
      this.apiKeyController ? this.apiKeyController.update(req, reply) : reply.status(501).send()
    );
    app.delete('/api/api-keys/:id', { preHandler: requireAdmin }, (req: any, reply) =>
      this.apiKeyController ? this.apiKeyController.delete(req, reply) : reply.status(501).send()
    );
    app.post('/api/api-keys/:id/rotate', { preHandler: requireAdmin }, (req: any, reply) =>
      this.apiKeyController ? this.apiKeyController.rotate(req, reply) : reply.status(501).send()
    );

    // 3. Collection Schema Endpoints (Admin only)
    app.get('/api/collections', { preHandler: requireAdmin }, (req, reply) =>
      this.collectionController.list(req, reply)
    );
    app.get('/api/collections/:collection', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.getOne(req, reply)
    );
    app.post('/api/collections', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.create(req, reply)
    );
    app.post('/api/collections/infer-schema', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.inferSchema(req, reply)
    );
    app.post('/api/collections/import-json', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.importJson(req, reply)
    );
    app.patch('/api/collections/:collection', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.update(req, reply)
    );
    app.delete('/api/collections/:collection', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.delete(req, reply)
    );

    // 3.5 Starter Templates & Recipes Endpoints
    if (this.templateController) {
      const requireAdminOrInitial = this.authMiddleware.requireAdminOrInitialSetup();
      app.get('/api/templates', (req, reply) => this.templateController!.list(req, reply));
      app.get('/api/templates/:template', (req: any, reply) => this.templateController!.getOne(req, reply));
      app.post('/api/templates/apply', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.templateController!.apply(req, reply)
      );
      app.post('/api/templates/:template/apply', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.templateController!.applyParam(req, reply)
      );
    }

    // 3.8 Application Snapshots Management
    if (this.snapshotController) {
      const requireAdminOrInitial = this.authMiddleware.requireAdminOrInitialSetup();
      const requireAdmin = this.authMiddleware.requireAdmin();
      app.get('/api/snapshots', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.snapshotController!.listSnapshots(req, reply)
      );
      app.post('/api/snapshots', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.snapshotController!.createSnapshot(req, reply)
      );
      app.get('/api/snapshots/:id', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.snapshotController!.getSnapshot(req, reply)
      );
      app.post('/api/snapshots/:id/restore', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.snapshotController!.restoreSnapshot(req, reply)
      );
      app.delete('/api/snapshots/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.snapshotController!.deleteSnapshot(req, reply)
      );
      app.delete('/api/snapshots', { preHandler: requireAdmin }, (req: any, reply) =>
        this.snapshotController!.clearAllSnapshots(req, reply)
      );
    }

    // 4. Record CRUD Endpoints
    app.get('/api/collections/:collection/records', (req: any, reply) =>
      this.recordController.getList(req, reply)
    );
    app.get('/api/collections/:collection/records/:id', (req: any, reply) =>
      this.recordController.getOne(req, reply)
    );
    app.post('/api/collections/:collection/records', (req: any, reply) =>
      this.recordController.create(req, reply)
    );
    app.patch('/api/collections/:collection/records/:id', (req: any, reply) =>
      this.recordController.update(req, reply)
    );
    app.delete('/api/collections/:collection/records/:id', (req: any, reply) =>
      this.recordController.delete(req, reply)
    );
    app.get('/api/collections/:collection/export', (req: any, reply) =>
      this.recordController.exportRecords(req, reply)
    );
    app.get('/api/collections/:collection/export/:format', (req: any, reply) =>
      this.recordController.exportRecords(req, reply)
    );
    app.post('/api/collections/:collection/import', (req: any, reply) =>
      this.recordController.importRecords(req, reply)
    );
    app.post('/api/collections/:collection/generate-mock', { preHandler: requireAdmin }, (req: any, reply) =>
      this.recordController.generateMock(req, reply)
    );

    // 5. File Serving
    app.get('/api/files/:collection/:recordId/:filename', (req: any, reply) =>
      this.fileController.getFile(req, reply)
    );

    // 6. Realtime SSE
    app.get('/api/realtime', (req, reply) => this.realtimeController.connect(req, reply));
    app.post('/api/realtime', (req, reply) => this.realtimeController.setSubscriptions(req, reply));

    // 7. Request Logs (Admin only)
    app.get('/api/logs', { preHandler: requireAdmin }, (req: any, reply) =>
      this.logController.getLogs(req, reply)
    );
    app.delete('/api/logs', { preHandler: requireAdmin }, (req: any, reply) =>
      this.logController.clearLogs(req, reply)
    );
    app.get('/api/apps/:appId/logs', { preHandler: requireAdmin }, (req: any, reply) =>
      this.logController.getLogs(req, reply)
    );
    app.delete('/api/apps/:appId/logs', { preHandler: requireAdmin }, (req: any, reply) =>
      this.logController.clearLogs(req, reply)
    );

    // 7.5 Data Mutation Audit Logs (Admin only)
    if (this.auditLogController) {
      app.get('/api/audit-logs', { preHandler: requireAdmin }, (req: any, reply) =>
        this.auditLogController!.getGlobalLogs(req, reply)
      );
      app.get('/api/collections/:collection/records/:id/history', { preHandler: requireAdmin }, (req: any, reply) =>
        this.auditLogController!.getRecordHistory(req, reply)
      );
      app.post('/api/audit-logs/prune', { preHandler: requireAdmin }, (req: any, reply) =>
        this.auditLogController!.pruneLogs(req, reply)
      );
      app.get('/api/apps/:appId/audit-logs', { preHandler: requireAdmin }, (req: any, reply) =>
        this.auditLogController!.getGlobalLogs(req, reply)
      );
      app.get('/api/apps/:appId/collections/:collection/records/:id/history', { preHandler: requireAdmin }, (req: any, reply) =>
        this.auditLogController!.getRecordHistory(req, reply)
      );
      app.post('/api/apps/:appId/audit-logs/prune', { preHandler: requireAdmin }, (req: any, reply) =>
        this.auditLogController!.pruneLogs(req, reply)
      );
    }

    // 7.6 Outbound Webhooks & Delivery Logs (Admin only)
    if (this.webhookController) {
      app.get('/api/webhooks', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.getWebhooks(req, reply)
      );
      app.post('/api/webhooks', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.createWebhook(req, reply)
      );
      app.get('/api/webhooks/stats', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.getStats(req, reply)
      );
      app.get('/api/webhooks/deliveries', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.getDeliveries(req, reply)
      );
      app.delete('/api/webhooks/deliveries', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.clearDeliveries(req, reply)
      );
      app.get('/api/webhooks/deliveries/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.getDelivery(req, reply)
      );
      app.post('/api/webhooks/deliveries/:id/retry', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.retryDelivery(req, reply)
      );
      app.get('/api/webhooks/:id', async (req: any, reply) => {
        const id = req.params.id;
        const urlPath = (req.url || '').split('?')[0];

        // 1. Coordinate with dynamic plugin route (e.g. GET /api/webhooks/status)
        if (this.dynamicRouteMatcher && this.dynamicRouteMatcher('GET', urlPath) && this.dynamicRouteHandler) {
          const handled = await this.dynamicRouteHandler(req, reply);
          if (handled || reply.sent) return;
        }

        // 2. Reserve /api/webhooks/status for the official webhooks plugin
        if (id === 'status') {
          if (this.dynamicRouteHandler) {
            const handled = await this.dynamicRouteHandler(req, reply);
            if (handled || reply.sent) return;
          }
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'Webhooks plugin status endpoint not found (plugin disabled or unconfigured)',
          });
        }

        // 3. Core webhook by ID requires admin authorization
        await requireAdmin(req, reply);
        if (reply.sent) return;

        return this.webhookController!.getWebhook(req, reply);
      });
      app.patch('/api/webhooks/:id', { preHandler: requireAdmin }, async (req: any, reply) => {
        if (req.params.id === 'status') {
          return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Reserved plugin path' });
        }
        return this.webhookController!.updateWebhook(req, reply);
      });
      app.delete('/api/webhooks/:id', { preHandler: requireAdmin }, async (req: any, reply) => {
        if (req.params.id === 'status') {
          return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Reserved plugin path' });
        }
        return this.webhookController!.deleteWebhook(req, reply);
      });
      app.post('/api/webhooks/:id/test', { preHandler: requireAdmin }, (req: any, reply) =>
        this.webhookController!.testWebhook(req, reply)
      );
    }

    // 7.7 Serverless Functions ("NodeStack Functions")
    if (this.functionController) {
      const requireAdmin = this.authMiddleware.requireAdmin();
      app.get('/api/functions', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.getFunctions(req, reply)
      );
      app.post('/api/functions', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.createFunction(req, reply)
      );
      app.get('/api/functions/stats', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.getStats(req, reply)
      );
      app.get('/api/functions/logs', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.getLogs(req, reply)
      );
      app.delete('/api/functions/logs', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.clearLogs(req, reply)
      );
      app.get('/api/functions/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.getFunction(req, reply)
      );
      app.patch('/api/functions/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.updateFunction(req, reply)
      );
      app.delete('/api/functions/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.deleteFunction(req, reply)
      );
      app.post('/api/functions/:id/test', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.testFunction(req, reply)
      );
      app.get('/api/functions/:id/logs', { preHandler: requireAdmin }, (req: any, reply) =>
        this.functionController!.getLogs(req, reply)
      );
      app.all('/api/functions/:name/invoke', (req: any, reply) =>
        this.functionController!.invoke(req, reply)
      );
    }

    if (this.flowController) {
      const requireAdmin = this.authMiddleware.requireAdmin();
      app.get('/api/flows', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.getFlows(req, reply)
      );
      app.post('/api/flows', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.createFlow(req, reply)
      );
      app.get('/api/flows/executions', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.getExecutions(req, reply)
      );
      app.get('/api/flows/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.getFlow(req, reply)
      );
      app.patch('/api/flows/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.updateFlow(req, reply)
      );
      app.delete('/api/flows/:id', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.deleteFlow(req, reply)
      );
      app.post('/api/flows/:id/execute', (req: any, reply) =>
        this.flowController!.executeFlow(req, reply)
      );
      app.get('/api/flows/:id/executions', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.getExecutions(req, reply)
      );
      app.get('/api/flows/executions/:executionId', (req: any, reply) =>
        this.flowController!.getExecution(req, reply)
      );
      app.post('/api/flows/executions/:executionId/resume', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.resumeExecution(req, reply)
      );
      app.post('/api/flows/executions/:executionId/abort', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.abortExecution(req, reply)
      );
      app.post('/api/flows/executions/recover', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.recoverExecutions(req, reply)
      );
      app.delete('/api/flows/:id/executions', { preHandler: requireAdmin }, (req: any, reply) =>
        this.flowController!.clearExecutions(req, reply)
      );
    }

    // 7.8 Generic Queue Processor ("NodeStack Queues")
    if (this.queueController) {
      const requireAdminOrInitial = this.authMiddleware.requireAdminOrInitialSetup();
      app.get('/api/queues', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getQueues(req, reply)
      );
      app.post('/api/queues', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.upsertQueue(req, reply)
      );
      app.get('/api/queues/stats', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getStats(req, reply)
      );
      app.get('/api/queues/messages', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getAllMessages(req, reply)
      );
      app.get('/api/queues/messages/:id', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getMessageById(req, reply)
      );
      app.post('/api/queues/cleanup', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.cleanupQueues(req, reply)
      );
      app.get('/api/queues/:name', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getQueue(req, reply)
      );
      app.delete('/api/queues/:name', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.deleteQueue(req, reply)
      );
      app.post('/api/queues/:name/messages', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.sendMessage(req, reply)
      );
      app.get('/api/queues/:name/messages', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getMessages(req, reply)
      );
      app.get('/api/queues/:name/messages/:id', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.getMessage(req, reply)
      );
      app.post('/api/queues/:name/messages/:id/ack', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.ackMessage(req, reply)
      );
      app.post('/api/queues/:name/messages/:id/nack', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.nackMessage(req, reply)
      );
      app.post('/api/queues/:name/messages/:id/touch', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.touchMessage(req, reply)
      );
      app.post('/api/queues/:name/messages/:id/skip', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.forceSkipMessage(req, reply)
      );
      app.post('/api/queues/:name/messages/:id/retry', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.retryMessage(req, reply)
      );
      app.delete('/api/queues/:name/messages/:id', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.deleteMessage(req, reply)
      );
      app.post('/api/queues/:name/dlq/retry', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.retryDlq(req, reply)
      );
      app.delete('/api/queues/:name/purge', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.queueController!.purgeQueue(req, reply)
      );
    }

    // 8. Analytics & Metrics (Admin only)
    if (this.analyticsController) {
      app.get('/api/metrics', { preHandler: requireAdmin }, (req, reply) =>
        this.analyticsController!.getMetrics(req, reply)
      );
      app.get('/api/apps/:appId/metrics', { preHandler: requireAdmin }, (req, reply) =>
        this.analyticsController!.getMetrics(req, reply)
      );
    }

    // 9. TypeGen Endpoints
    const handleTypegen = async (req: any, reply: FastifyReply) => {
      const typegen = req.appScope?.typegen || this.typeGenerator;
      if (!typegen) {
        return reply.status(500).send({ message: 'TypeGenerator is not configured' });
      }
      const ts = await typegen.generate();
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      return reply.send(ts);
    };

    app.get('/api/apps/:appId/types.d.ts', handleTypegen);
    app.get('/api/apps/:appId/types', handleTypegen);
    app.get('/_/types.d.ts', handleTypegen);
    app.get('/api/types.d.ts', handleTypegen);
    app.get('/api/types', handleTypegen);

    // 9. Interactive Docs & OpenAPI Endpoints
    if (this.docsService) {
      this.docsService.registerRoutes(app);
    }

    // 10. Embedded Admin UI SPA
    this.adminUiService.registerRoutes(app);
  }

  public async listen(port = this.config.port, host = this.config.host): Promise<string> {
    return this.app.listen({ port, host });
  }

  public async close(): Promise<string | void> {
    await this.app.close();
  }

  public inject(opts: any): Promise<any> {
    return this.app.inject(opts);
  }
}
