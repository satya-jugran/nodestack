import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { CronService } from '../../cron/CronService';
import {
  CreateCronScheduleDto,
  UpdateCronScheduleDto,
  CronTargetType,
} from '../../cron/types';

export class CronController extends BaseController {
  constructor(private cronService?: CronService) {
    super();
  }

  private getCronService(req: any): CronService {
    return req?.appScope?.cron || this.cronService!;
  }

  public async getPreview(
    req: FastifyRequest<{
      Body: { cronExpression: string; timezone?: string; count?: number };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getCronService(req);
    const { cronExpression, timezone, count } = req.body || {};
    const result = service.preview(cronExpression, timezone, count);
    this.ok(reply, result);
  }

  public async getStats(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getCronService(req);
    const stats = await service.getStats();
    this.ok(reply, stats);
  }

  public async getSchedules(
    req: FastifyRequest<{
      Querystring: { targetType?: string; enabled?: string; targetId?: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getCronService(req);
    const targetType = req.query.targetType as CronTargetType | undefined;
    const enabled =
      req.query.enabled !== undefined
        ? req.query.enabled === 'true' || req.query.enabled === '1'
        : undefined;
    const targetId = req.query.targetId;

    const schedules = await service.getAllSchedules({
      targetType,
      enabled,
      targetId,
    });
    this.ok(reply, schedules);
  }

  public async createSchedule(
    req: FastifyRequest<{ Body: CreateCronScheduleDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getCronService(req);
    const schedule = await service.createSchedule(req.body, (req as any).user);
    this.ok(reply, schedule, 201);
  }

  public async getSchedule(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getCronService(req);
    const schedule = await service.getSchedule(req.params.id);
    if (!schedule) {
      this.error(reply, `Schedule '${req.params.id}' not found`, 404);
      return;
    }
    this.ok(reply, schedule);
  }

  public async updateSchedule(
    req: FastifyRequest<{ Params: { id: string }; Body: UpdateCronScheduleDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getCronService(req);
    const updated = await service.updateSchedule(req.params.id, req.body, (req as any).user);
    this.ok(reply, updated);
  }

  public async deleteSchedule(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getCronService(req);
    const deleted = await service.deleteSchedule(req.params.id, (req as any).user);
    if (!deleted) {
      this.error(reply, `Schedule '${req.params.id}' not found`, 404);
      return;
    }
    this.ok(reply, { success: true });
  }

  public async triggerSchedule(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getCronService(req);
    const run = await service.triggerSchedule(req.params.id, (req as any).user);
    this.ok(reply, run);
  }

  public async getRuns(
    req: FastifyRequest<{
      Querystring: {
        scheduleId?: string;
        targetType?: string;
        status?: string;
        page?: string;
        perPage?: string;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getCronService(req);
    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const perPage = req.query.perPage ? parseInt(req.query.perPage, 10) : 30;
    const result = await service.getRuns({
      scheduleId: req.query.scheduleId,
      targetType: req.query.targetType as CronTargetType | undefined,
      status: req.query.status && req.query.status !== 'all' ? req.query.status : undefined,
      page,
      perPage,
    });
    this.ok(reply, result);
  }

  public async clearRuns(
    req: FastifyRequest<{ Querystring: { scheduleId?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getCronService(req);
    const deletedCount = await service.clearRuns(req.query.scheduleId);
    this.ok(reply, { success: true, count: deletedCount });
  }
}
