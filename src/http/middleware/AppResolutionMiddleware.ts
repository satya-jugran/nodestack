import { FastifyRequest, FastifyReply } from 'fastify';
import { AppManager } from '../../apps/AppManager';
import { AppScope } from '../../apps/AppScope';
import { NotFoundError } from '../../core/errors/AppError';

export class AppResolutionMiddleware {
  constructor(private appManager: AppManager) {}

  public resolve() {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      // If already resolved, skip
      if ((req as any).appScope) {
        return;
      }

      let targetApp: string | undefined;

      // 1. URL Parameter or Path prefix (e.g. /api/apps/:appId/...)
      const params = (req.params as any) || {};
      if (params.appId) {
        targetApp = String(params.appId);
      } else if (req.url) {
        const match = req.url.match(/^\/api\/apps\/([^\/?#]+)/);
        if (match) {
          targetApp = decodeURIComponent(match[1]);
        }
      }

      // 2. Header (e.g. x-nodestack-app: shop-mvp)
      if (!targetApp && req.headers['x-nodestack-app']) {
        targetApp = String(req.headers['x-nodestack-app']);
      }
      if (!targetApp && req.headers['x-app-id']) {
        targetApp = String(req.headers['x-app-id']);
      }

      // 3. Query Parameter (e.g. ?app=shop-mvp)
      const query = (req.query as any) || {};
      if (!targetApp && query.app) {
        targetApp = String(query.app);
      } else if (!targetApp && req.url && req.url.includes('?')) {
        const queryIndex = req.url.indexOf('?');
        const qs = new URLSearchParams(req.url.slice(queryIndex + 1));
        const appParam = qs.get('app') || qs.get('appId');
        if (appParam) {
          targetApp = appParam;
        }
      }

      // 4. Default Application fallback & sanitize
      if (
        !targetApp ||
        !targetApp.trim() ||
        targetApp === '[object Object]' ||
        targetApp === 'undefined' ||
        targetApp === 'null'
      ) {
        targetApp = 'default';
      }

      try {
        const scope = this.appManager.get(targetApp.trim());
        (req as any).appScope = scope;
        (req as any).appContext = {
          app: scope.app,
          slug: scope.app.slug,
          id: scope.app.id,
        };
      } catch (err: any) {
        // For UI and Docs viewer routes, gracefully fallback to default app rather than returning raw 404 JSON
        if (req.url && (req.url.startsWith('/_/docs') || req.url.startsWith('/_/'))) {
          try {
            const fallbackScope = this.appManager.get('default');
            (req as any).appScope = fallbackScope;
            (req as any).appContext = {
              app: fallbackScope.app,
              slug: fallbackScope.app.slug,
              id: fallbackScope.app.id,
            };
            return;
          } catch {}
        }

        if (err instanceof NotFoundError) {
          reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: `Application '${targetApp}' not found`,
          });
          return;
        }
        reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: err.message,
        });
      }
    };
  }
}
