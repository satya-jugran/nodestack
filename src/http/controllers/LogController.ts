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
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(200, Math.max(1, Number(req.query.perPage) || 50));
    const result = this.logService.getLogs(page, perPage);
    this.ok(reply, result);
  }

  public async clearLogs(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    this.logService.clearLogs();
    this.noContent(reply);
  }
}
