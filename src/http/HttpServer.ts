import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Readable } from 'stream';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ConfigService } from '../core/config/ConfigService';
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
import { DemoController } from './controllers/DemoController';
import { SnapshotController } from './controllers/SnapshotController';
import { AuditLogController } from './controllers/AuditLogController';
import { WebhookController } from './controllers/WebhookController';
import { AppController } from './controllers/AppController';
import { AppResolutionMiddleware } from './middleware/AppResolutionMiddleware';
import { AdminUIService } from '../admin/AdminUIService';
import { DocsService } from '../admin/DocsService';
import { TypeGenerator } from '../schema/TypeGenerator';
import { AppError } from '../core/errors/AppError';
import { MaintenanceGate } from '../core/maintenance/MaintenanceGate';

export class HttpServer {
  public readonly app: FastifyInstance;
  public readonly chaosMiddleware: ChaosMiddleware;
  public readonly maintenanceGate?: MaintenanceGate;
  private dynamicRouteHandler?: (req: FastifyRequest, reply: FastifyReply) => Promise<boolean>;
  private dynamicRouteMatcher?: (method: string, path: string) => any;

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
    private demoController?: DemoController,
    private snapshotController?: SnapshotController,
    maintenanceGate?: MaintenanceGate,
    private auditLogController?: AuditLogController,
    private webhookController?: WebhookController,
    private appController?: AppController,
    private appResolutionMiddleware?: AppResolutionMiddleware
  ) {
    this.maintenanceGate = maintenanceGate;

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
    this.app.register(cors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposedHeaders: [
        'x-simulated-delay',
        'x-simulated-chaos',
        'x-simulated-error',
        'x-simulated-fail-rate',
      ],
    });

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
          (req.url.includes('/demo/reset') ||
           req.url.includes('/restore') ||
           req.url.includes('/snapshots') ||
           req.url.includes('/demo/snapshot'));
        const isExempt =
          isExclusiveMutation ||
          req.url.includes('/demo/reset') ||
          req.url.includes('/restore') ||
          req.url.startsWith('/api/realtime');
        try {
          await gate.trackRequestStart(reqId, isExempt);
        } catch (err: any) {
          return reply.status(503).send({
            statusCode: 503,
            error: 'Service Unavailable',
            message: err.message || 'Server is temporarily undergoing demo reset maintenance. Please retry.',
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
    if (this.demoController) {
      const requireAdminOrInitial = this.authMiddleware.requireAdminOrInitialSetup();
      const requireAdmin = this.authMiddleware.requireAdmin();
      app.get('/api/apps/:appId/demo/status', (req, reply) => this.demoController!.getStatus(req, reply));
      app.post('/api/apps/:appId/demo/snapshot', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.demoController!.createSnapshot(req, reply)
      );
      app.post('/api/apps/:appId/demo/reset', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.demoController!.reset(req, reply)
      );
      app.delete('/api/apps/:appId/demo/snapshot', { preHandler: requireAdmin }, (req: any, reply) =>
        this.demoController!.clearSnapshot(req, reply)
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

    // 3.8 Demo State Management ("Reset to Demo State")

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
    if (this.demoController) {
      const requireAdminOrInitial = this.authMiddleware.requireAdminOrInitialSetup();
      const requireAdmin = this.authMiddleware.requireAdmin();
      app.get('/api/demo/status', (req, reply) => this.demoController!.getStatus(req, reply));
      app.post('/api/demo/snapshot', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.demoController!.createSnapshot(req, reply)
      );
      app.post('/api/demo/reset', { preHandler: requireAdminOrInitial }, (req: any, reply) =>
        this.demoController!.reset(req, reply)
      );
      app.delete('/api/demo/snapshot', { preHandler: requireAdmin }, (req: any, reply) =>
        this.demoController!.clearSnapshot(req, reply)
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
    app.delete('/api/logs', { preHandler: requireAdmin }, (req, reply) =>
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
    const handleTypegen = (req: any, reply: FastifyReply) => {
      const typegen = req.appScope?.typegen || this.typeGenerator;
      if (!typegen) {
        return reply.status(500).send({ message: 'TypeGenerator is not configured' });
      }
      const ts = typegen.generate();
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

  public async close(): Promise<void> {
    await this.app.close();
  }

  public inject(opts: any): Promise<any> {
    return this.app.inject(opts);
  }
}
