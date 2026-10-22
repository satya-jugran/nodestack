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

  public async clearLogs(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const logs = (req as any).appScope?.logs || this.logService;
    logs.clearLogs();
    this.noContent(reply);
  }
}
