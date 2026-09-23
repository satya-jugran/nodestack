import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { AnalyticsService } from '../../analytics/AnalyticsService';

export class AnalyticsController extends BaseController {
  constructor(private analyticsService: AnalyticsService) {
    super();
  }

  public async getMetrics(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const metrics = this.analyticsService.getMetrics();
    this.ok(reply, metrics);
  }
}
