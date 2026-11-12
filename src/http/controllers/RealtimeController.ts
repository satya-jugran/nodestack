import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { RealtimeService } from '../../realtime/RealtimeService';
import { AppManager } from '../../apps/AppManager';
import { AppError, UnauthorizedError } from '../../core/errors/AppError';
import { getRequestAuthRevalidator } from '../middleware/AuthMiddleware';

export class RealtimeController extends BaseController {
  constructor(
    private realtimeService: RealtimeService,
    private appManager?: AppManager
  ) {
    super();
  }

  private getRealtime(req?: any): RealtimeService {
    return req?.appScope?.realtime || this.realtimeService;
  }

  public async connect(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    const realtime = this.getRealtime(req);
    realtime.registerClient(reply, req.auth, getRequestAuthRevalidator(req));
  }

  public async setSubscriptions(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { clientId, subscriptions, clientSecret: bodySecret } = (req.body as any) || {};

    if (
      typeof clientId !== 'string' ||
      !clientId.trim() ||
      !Array.isArray(subscriptions) ||
      !subscriptions.every((s) => typeof s === 'string')
    ) {
      throw new AppError('clientId and subscriptions string array are required', 400);
    }

    if (bodySecret !== undefined && typeof bodySecret !== 'string') {
      throw new AppError('clientSecret must be a string', 400);
    }

    const headerSecret =
      typeof req.headers['x-realtime-secret'] === 'string'
        ? req.headers['x-realtime-secret']
        : typeof req.headers['x-client-secret'] === 'string'
        ? req.headers['x-client-secret']
        : undefined;

    const rawSecret = bodySecret !== undefined ? bodySecret : headerSecret;
    const providedSecret = typeof rawSecret === 'string' && rawSecret.trim() ? rawSecret.trim() : undefined;

    if (!req.auth && !providedSecret) {
      throw new UnauthorizedError('Authentication or realtime client secret is required');
    }

    const realtime = this.getRealtime(req);
    const ok = await realtime.setSubscriptions(clientId.trim(), subscriptions, {
      callerAuth: req.auth,
      clientSecret: bodySecret !== undefined ? bodySecret : providedSecret,
    });

    if (!ok) {
      throw new AppError('Realtime client not found or disconnected', 404);
    }

    this.noContent(reply);
  }
}
