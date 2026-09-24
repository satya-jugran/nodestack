import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ConfigService } from '../core/config/ConfigService';
import { LogService } from '../logger/LogService';
import { AuthMiddleware } from './middleware/AuthMiddleware';
import { AuthController } from './controllers/AuthController';
import { CollectionController } from './controllers/CollectionController';
import { RecordController } from './controllers/RecordController';
import { FileController } from './controllers/FileController';
import { RealtimeController } from './controllers/RealtimeController';
import { LogController } from './controllers/LogController';
import { HealthController } from './controllers/HealthController';
import { AnalyticsController } from './controllers/AnalyticsController';
import { AdminUIService } from '../admin/AdminUIService';
import { DocsService } from '../admin/DocsService';
import { TypeGenerator } from '../schema/TypeGenerator';
import { AppError } from '../core/errors/AppError';

export class HttpServer {
  public readonly app: FastifyInstance;

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
    private analyticsController?: AnalyticsController
  ) {
    this.app = fastify({
      logger: false,
    });

    this.setupPlugins();
    this.setupHooks();
    this.setupRoutes();
    this.setupErrorHandler();
  }

  private setupPlugins(): void {
    this.app.register(cors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
    // Latency and audit logging
    this.app.addHook('onRequest', async (req: FastifyRequest) => {
      (req as any)._startTime = process.hrtime();
      await this.authMiddleware.handle(req, null as any);
    });

    this.app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
      const startTime = (req as any)._startTime;
      let duration = 0;
      if (startTime) {
        const diff = process.hrtime(startTime);
        duration = diff[0] * 1000 + diff[1] / 1e6;
      }

      this.logService.logRequest({
        method: req.method,
        url: req.url,
        status: reply.statusCode,
        duration,
        ip: req.ip,
        authId: req.auth?.id,
        authCollection: req.auth?.collection,
        userAgent: req.headers['user-agent'],
      });
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
  }

  private setupRoutes(): void {
    const app = this.app;
    const requireAdmin = this.authMiddleware.requireAdmin();

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
    app.patch('/api/collections/:collection', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.update(req, reply)
    );
    app.delete('/api/collections/:collection', { preHandler: requireAdmin }, (req: any, reply) =>
      this.collectionController.delete(req, reply)
    );

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

    // 8. Analytics & Metrics (Admin only)
    if (this.analyticsController) {
      app.get('/api/metrics', { preHandler: requireAdmin }, (req, reply) =>
        this.analyticsController!.getMetrics(req, reply)
      );
    }

    // 9. TypeGen Endpoints
    const handleTypegen = (_req: FastifyRequest, reply: FastifyReply) => {
      if (!this.typeGenerator) {
        return reply.status(500).send({ message: 'TypeGenerator is not configured' });
      }
      const ts = this.typeGenerator.generate();
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      return reply.send(ts);
    };

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
}
