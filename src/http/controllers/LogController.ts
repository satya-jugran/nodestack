import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { LogService } from '../../logger/LogService';

export class LogController extends BaseController {
  constructor(private logService: LogService) {
    super();
  }

  public async getLogs(
    req: FastifyRequest<{ Querystring: { page?: number; perPage?: number } }>,
    reply: FastifyReply
  ): Promise<void> {
    const logs = (req as any).appScope?.logs || this.logService;
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(200, Math.max(1, Number(req.query.perPage) || 50));
    const result = logs.getLogs(page, perPage);
    this.ok(reply, result);
  }

  public async clearLogs(
    req: FastifyRequest<any>,
    reply: FastifyReply
  ): Promise<void> {
    const logs = (req as any).appScope?.logs || this.logService;
    const rawOlderThan = (req.query as any)?.olderThanDays;
    let olderThanDays: number | undefined = undefined;

    if (rawOlderThan !== undefined && rawOlderThan !== null && String(rawOlderThan).trim() !== '') {
      const parsed = Number(rawOlderThan);
      if (!Number.isFinite(parsed) || parsed < 0) {
        this.error(reply, 'Invalid olderThanDays parameter. Must be a non-negative number.', 400);
        return;
      }
      olderThanDays = parsed;
    }

    try {
      const deletedCount = logs.clearLogs(olderThanDays);
      if (olderThanDays !== undefined) {
        this.ok(reply, { success: true, deletedCount, olderThanDays });
      } else {
        this.noContent(reply);
      }
    } catch (err: any) {
      this.error(reply, err.message || 'Failed to clear logs', 400);
    }
  }
}
