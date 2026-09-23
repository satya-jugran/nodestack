import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { ConfigService } from '../../core/config/ConfigService';

export class HealthController extends BaseController {
  constructor(private config: ConfigService) {
    super();
  }

  public async getHealth(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    this.ok(reply, {
      status: 'ok',
      version: '1.0.0',
      appName: this.config.appName,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  }

  public async getSettings(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    this.ok(reply, {
      appName: this.config.appName,
      version: '1.0.0',
    });
  }
}
