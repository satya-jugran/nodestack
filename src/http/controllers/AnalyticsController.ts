import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { AnalyticsService } from '../../analytics/AnalyticsService';

export class AnalyticsController extends BaseController {
  constructor(private analyticsService: AnalyticsService) {
    super();
  }

  public async getMetrics(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const analytics = (req as any).appScope?.analytics || this.analyticsService;
    const metrics = analytics.getMetrics();
    this.ok(reply, metrics);
  }
}
