import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { RealtimeService } from '../../realtime/RealtimeService';
import { AppError } from '../../core/errors/AppError';

export class RealtimeController extends BaseController {
  constructor(private realtimeService: RealtimeService) {
    super();
  }

  public async connect(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    this.realtimeService.registerClient(reply, req.auth);
  }

  public async setSubscriptions(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { clientId, subscriptions } = (req.body as any) || {};

    if (!clientId || !Array.isArray(subscriptions)) {
      throw new AppError('clientId and subscriptions array are required', 400);
    }

    const ok = this.realtimeService.setSubscriptions(clientId, subscriptions);
    if (!ok) {
      throw new AppError('Realtime client not found or disconnected', 404);
    }

    this.noContent(reply);
  }
}
