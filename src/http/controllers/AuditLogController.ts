import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { AuditLogService, AuditQueryOptions } from '../../audit/AuditLogService';

export class AuditLogController extends BaseController {
  constructor(private auditLogService: AuditLogService) {
    super();
  }

  public async getGlobalLogs(
    req: FastifyRequest<{ Querystring: AuditQueryOptions }>,
    reply: FastifyReply
  ): Promise<void> {
    const auditService = (req as any).appScope?.auditLogs || this.auditLogService;
    const result = auditService.getGlobalLogs(req.query || {});
    this.ok(reply, result);
  }

  public async getRecordHistory(
    req: FastifyRequest<{
      Params: { collection: string; id: string };
      Querystring: { page?: number; perPage?: number };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection, id } = req.params;
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 25));

    const auditService = (req as any).appScope?.auditLogs || this.auditLogService;
    const result = auditService.getRecordHistory(collection, id, page, perPage);
    this.ok(reply, result);
  }

  public async pruneLogs(
    req: FastifyRequest<{ Body: { olderThanDays: number } }>,
    reply: FastifyReply
  ): Promise<void> {
    const days = Math.max(1, Number(req.body?.olderThanDays) || 90);
    const auditService = (req as any).appScope?.auditLogs || this.auditLogService;
    const deletedCount = auditService.pruneLogs(days);
    this.ok(reply, { success: true, deletedCount, olderThanDays: days });
  }
}
