import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { RealtimeService } from '../../realtime/RealtimeService';
import { AppManager } from '../../apps/AppManager';
import { AppError } from '../../core/errors/AppError';

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
    realtime.registerClient(reply, req.auth);
  }

  public async setSubscriptions(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { clientId, subscriptions } = (req.body as any) || {};

    if (!clientId || !Array.isArray(subscriptions)) {
      throw new AppError('clientId and subscriptions array are required', 400);
    }

    const realtime = this.getRealtime(req);
    let ok = realtime.setSubscriptions(clientId, subscriptions);

    // If client wasn't found in this scope, check other cached scopes or default service
    if (!ok && this.appManager) {
      for (const app of this.appManager.getCachedScopes()) {
        if (app.realtime !== realtime && app.realtime.setSubscriptions(clientId, subscriptions)) {
          ok = true;
          break;
        }
      }
    } else if (!ok && realtime !== this.realtimeService) {
      ok = this.realtimeService.setSubscriptions(clientId, subscriptions);
    }

    if (!ok) {
      throw new AppError('Realtime client not found or disconnected', 404);
    }

    this.noContent(reply);
  }
}
