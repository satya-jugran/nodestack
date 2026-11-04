import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { AppError } from '../../core/errors/AppError';
import { QueueService } from '../../queue/QueueService';
import { CreateQueueDto } from '../../queue/types';

export class QueueController extends BaseController {
  constructor(private queueService?: QueueService) {
    super();
  }

  private getQueueService(req: any): QueueService {
    return req?.appScope?.queue || this.queueService!;
  }

  private assertNotSystemQueue(name: string): void {
    if (!name || name.trim().startsWith('_system:')) {
      throw new AppError(`Cannot create, modify, or delete reserved system queue '${name}'`, 403);
    }
  }

  public async getQueues(
    req: FastifyRequest<{ Querystring: { includeSystem?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    const includeSystem = req.query.includeSystem === 'true' || req.query.includeSystem === '1';
    const queues = await service.getAllQueues(includeSystem);
    this.ok(reply, queues);
  }

  public async getStats(
    req: FastifyRequest<{ Querystring: { queue?: string; includeSystem?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    const includeSystem = req.query.includeSystem === 'true' || req.query.includeSystem === '1';
    const stats = await service.getStats(req.query?.queue || undefined, includeSystem);
    const queues = await service.getAllQueues(includeSystem);
    this.ok(reply, {
      ...stats,
      totalQueues: queues.length,
    });
  }

  public async getAllJobs(
    req: FastifyRequest<{
      Querystring: {
        queue?: string;
        status?: string;
        page?: string;
        perPage?: string;
        includeSystem?: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const perPage = req.query.perPage ? parseInt(req.query.perPage, 10) : 25;
    const includeSystem = req.query.includeSystem === 'true' || req.query.includeSystem === '1';
    const result = await service.getJobs({
      queue: req.query.queue || undefined,
      status: req.query.status && req.query.status !== 'all' ? req.query.status : undefined,
      page,
      perPage,
      includeSystem,
    });
    this.ok(reply, result);
  }

  private enrichJobWithLogs(req: any, job: any): any {
    if (!job) return job;
    try {
      const service = this.getQueueService(req);
      const db = (req as any)?.appScope?.db || service.getDatabase();
      if (db) {
        const row = db.prepare(`
          SELECT logs, durationMs FROM _function_logs
          WHERE actorId = ? OR actorId = ? OR logs LIKE ?
          ORDER BY timestamp DESC LIMIT 1
        `).get(`job:${job.id}`, job.id, `%${job.id}%`) as any;
        if (row && row.logs) {
          return { ...job, executionLogs: row.logs, executionDurationMs: row.durationMs };
        }
      }
    } catch {
      // ignore
    }
    return job;
  }

  public async getJobById(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    const job = await service.getJob(req.params.id);
    if (!job) {
      this.error(reply, `Job '${req.params.id}' not found`, 404);
      return;
    }
    this.ok(reply, this.enrichJobWithLogs(req, job));
  }

  public async upsertQueue(
    req: FastifyRequest<{ Body: CreateQueueDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    try {
      const body = req.body || ({} as CreateQueueDto);
      if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
        this.error(reply, 'Queue name is required', 400);
        return;
      }
      this.assertNotSystemQueue(body.name);

      const created = await service.upsertQueue({
        ...body,
        isSystem: false,
      });
      const stats = await service.getStats(created.name);
      this.ok(reply, { ...created, stats }, 201);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to register queue', 400);
    }
  }

  public async getQueue(
    req: FastifyRequest<{ Params: { name: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    const queue = await service.getQueue(req.params.name);
    if (!queue) {
      this.error(reply, `Queue '${req.params.name}' not found`, 404);
      return;
    }
    const stats = await service.getStats(queue.name);
    this.ok(reply, { ...queue, stats });
  }

  public async deleteQueue(
    req: FastifyRequest<{ Params: { name: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    try {
      this.assertNotSystemQueue(req.params.name);
      const existing = await service.getQueue(req.params.name);
      if (!existing) {
        this.error(reply, `Queue '${req.params.name}' not found`, 404);
        return;
      }
      if (existing.isSystem) {
        this.error(reply, `Cannot delete system queue '${req.params.name}'`, 403);
        return;
      }
      await service.deleteQueue(req.params.name);
      this.ok(reply, { success: true, message: `Queue '${req.params.name}' deleted` });
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to delete queue', 400);
    }
  }

  public async sendMessage(
    req: FastifyRequest<{ Params: { name: string }; Body: any }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    try {
      const queueName = req.params.name;
      this.assertNotSystemQueue(queueName);

      const body: Record<string, any> = (req.body as any) ?? {};
      if (Array.isArray(body?.messages)) {
        const dtos = body.messages.map((m: any) => ({
          queue: queueName,
          payload: m.payload !== undefined ? m.payload : m,
          groupKey: m.groupKey,
          delaySeconds: m.delaySeconds,
          priority: m.priority,
          maxAttempts: m.maxAttempts,
          deduplicationId: m.deduplicationId,
        }));
        const jobs = await service.sendBatch(dtos);
        this.ok(reply, jobs, 201);
        return;
      }

      const hasEnvelope =
        body &&
        typeof body === 'object' &&
        !Array.isArray(body) &&
        ('payload' in body ||
          'delaySeconds' in body ||
          'priority' in body ||
          'maxAttempts' in body ||
          'groupKey' in body ||
          'deduplicationId' in body);

      const payload = hasEnvelope ? body.payload : body;
      const job = await service.send(queueName, payload, {
        id: hasEnvelope ? body.id : undefined,
        groupKey: hasEnvelope ? body.groupKey : undefined,
        delaySeconds: hasEnvelope ? body.delaySeconds : undefined,
        priority: hasEnvelope ? body.priority : undefined,
        maxAttempts: hasEnvelope ? body.maxAttempts : undefined,
        deduplicationId: hasEnvelope ? body.deduplicationId : undefined,
      });

      this.ok(reply, job, 201);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to enqueue message', 400);
    }
  }

  public async getMessages(
    req: FastifyRequest<{
      Params: { name: string };
      Querystring: {
        limit?: string;
        visibilityTimeoutSeconds?: string;
        workerId?: string;
        inspect?: string;
        status?: string;
        page?: string;
        perPage?: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    const queueName = req.params.name;

    if (req.query.inspect === 'true' || req.query.inspect === '1' || req.query.status) {
      const page = req.query.page ? parseInt(req.query.page, 10) : 1;
      const perPage = req.query.perPage ? parseInt(req.query.perPage, 10) : 25;
      const result = await service.getJobs({
        queue: queueName,
        status: req.query.status,
        page,
        perPage,
      });
      this.ok(reply, result);
      return;
    }

    this.assertNotSystemQueue(queueName);
    const limit = req.query.limit ? Math.max(1, Math.min(parseInt(req.query.limit, 10) || 1, 50)) : 1;
    const visibilityTimeout = req.query.visibilityTimeoutSeconds
      ? Math.max(1, parseInt(req.query.visibilityTimeoutSeconds, 10) || 30)
      : 30;
    const workerId = req.query.workerId || 'http-consumer';

    const claimed = await service.claim(queueName, visibilityTimeout, limit, workerId);
    this.ok(reply, claimed);
  }

  public async getMessage(
    req: FastifyRequest<{ Params: { name: string; id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    this.assertNotSystemQueue(req.params.name);

    const job = await service.getJob(req.params.id);
    if (!job || job.queue !== req.params.name) {
      this.error(reply, `Message '${req.params.id}' not found in queue '${req.params.name}'`, 404);
      return;
    }
    this.ok(reply, this.enrichJobWithLogs(req, job));
  }

  public async ackMessage(
    req: FastifyRequest<{ Params: { name: string; id: string }; Body?: { result?: any; claimToken?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    this.assertNotSystemQueue(req.params.name);

    const job = await service.getJob(req.params.id);
    if (!job || job.queue !== req.params.name) {
      this.error(reply, `Message '${req.params.id}' not found in queue '${req.params.name}'`, 404);
      return;
    }

    const claimToken = (req.body?.claimToken || (req.headers['x-claim-token'] as string) || (req.query as any)?.claimToken) as string | undefined;
    const completed = await service.complete(req.params.id, req.body?.result, claimToken);
    if (!completed) {
      this.error(reply, `Message '${req.params.id}' not found, already completed, or claim token invalid`, 404);
      return;
    }
    const updated = await service.getJob(req.params.id);
    this.ok(reply, { success: true, job: updated });
  }

  public async nackMessage(
    req: FastifyRequest<{ Params: { name: string; id: string }; Body?: { error?: string; backoffDelayMs?: number; claimToken?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    this.assertNotSystemQueue(req.params.name);

    const job = await service.getJob(req.params.id);
    if (!job || job.queue !== req.params.name) {
      this.error(reply, `Message '${req.params.id}' not found in queue '${req.params.name}'`, 404);
      return;
    }

    const claimToken = (req.body?.claimToken || (req.headers['x-claim-token'] as string) || (req.query as any)?.claimToken) as string | undefined;
    const errMsg = req.body?.error || 'Message rejected (NACK) by consumer';
    const result = await service.fail(req.params.id, errMsg, req.body?.backoffDelayMs, claimToken);
    if (result.attempts === 0) {
      this.error(reply, `Message '${req.params.id}' not found or claim token invalid`, 404);
      return;
    }
    const updated = await service.getJob(req.params.id);
    this.ok(reply, { ...result, job: updated });
  }

  public async touchMessage(
    req: FastifyRequest<{ Params: { name: string; id: string }; Body?: { extensionSeconds?: number; claimToken?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    this.assertNotSystemQueue(req.params.name);

    const job = await service.getJob(req.params.id);
    if (!job || job.queue !== req.params.name) {
      this.error(reply, `Message '${req.params.id}' not found in queue '${req.params.name}'`, 404);
      return;
    }

    const claimToken = (req.body?.claimToken || (req.headers['x-claim-token'] as string) || (req.query as any)?.claimToken) as string | undefined;
    const ext = req.body?.extensionSeconds || 30;
    const ok = await service.touch(req.params.id, ext, claimToken);
    if (!ok) {
      this.error(reply, `Message '${req.params.id}' is not currently processing or claim token invalid`, 404);
      return;
    }
    const updated = await service.getJob(req.params.id);
    this.ok(reply, { success: true, job: updated });
  }

  public async retryDlq(
    req: FastifyRequest<{ Params: { name: string }; Body?: { limit?: number } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    this.assertNotSystemQueue(req.params.name);

    const limit = req.body?.limit || 100;
    const retriedCount = await service.retryDeadLetterJobs(req.params.name, limit);
    this.ok(reply, { success: true, retriedCount });
  }

  public async purgeQueue(
    req: FastifyRequest<{ Params: { name: string }; Querystring: { status?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    this.assertNotSystemQueue(req.params.name);
    const purgedCount = await service.purge(req.params.name, req.query.status);
    this.ok(reply, { success: true, purgedCount });
  }

  public async cleanupQueues(
    req: FastifyRequest<{ Body?: { retentionDays?: number; queue?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getQueueService(req);
    const prunedCount = await service.cleanup(req.body?.retentionDays, req.body?.queue);
    this.ok(reply, { success: true, prunedCount });
  }
}
