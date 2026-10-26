import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService, AuthClaims } from '../../auth/AuthService';
import { ApiKeyService, hasScope } from '../../auth/ApiKeyService';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthClaims | null;
  }
}

export class AuthMiddleware {
  constructor(
    private authService: AuthService,
    private apiKeyService?: ApiKeyService
  ) {}

  public setApiKeyService(service: ApiKeyService): void {
    this.apiKeyService = service;
  }

  public getAuthService(req?: FastifyRequest): AuthService {
    return (req as any)?.appScope?.auth || this.authService;
  }

  public getApiKeyService(req?: FastifyRequest): ApiKeyService | undefined {
    return (req as any)?.appScope?.apiKeys || this.apiKeyService;
  }

  public async handle(req: FastifyRequest, _reply?: FastifyReply): Promise<void> {
    req.auth = null;

    // 1. Check for API Key in x-api-key header or Authorization header (Bearer nsk_... / ApiKey nsk_...)
    const xApiKey = req.headers['x-api-key'];
    let apiKeyToken: string | undefined;

    if (typeof xApiKey === 'string' && xApiKey.trim()) {
      apiKeyToken = xApiKey.trim();
    } else {
      const authHeader = req.headers.authorization;
      if (authHeader) {
        if (authHeader.startsWith('Bearer nsk_') || authHeader.startsWith('bearer nsk_')) {
          apiKeyToken = authHeader.substring(7).trim();
        } else if (authHeader.startsWith('ApiKey ') || authHeader.startsWith('apikey ')) {
          apiKeyToken = authHeader.substring(7).trim();
        }
      }
    }

    if (apiKeyToken && apiKeyToken.startsWith('nsk_')) {
      const apiKeyService = this.getApiKeyService(req);
      if (apiKeyService) {
        const clientIp = req.ip || (req.socket ? req.socket.remoteAddress : undefined);
        const result = apiKeyService.verifyKey(apiKeyToken, clientIp);
        if (result.valid && result.apiKey) {
          const key = result.apiKey;
          const isSuperAdmin = key.role === 'admin' || key.scopes.includes('*') || key.scopes.includes('admin:*');
          req.auth = {
            id: key.id,
            email: `${key.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}@service.nodestack.local`,
            collection: '_api_keys',
            tokenKey: key.id,
            isAdmin: isSuperAdmin,
            isApiKey: true,
            apiKeyId: key.id,
            apiKeyName: key.name,
            scopes: key.scopes,
            allowedIps: key.allowedIps,
          };
          return;
        }
      }
      // If an explicit API key was provided but was invalid, do not attempt to parse it as JWT
      return;
    }

    // 2. Standard JWT Authentication (Bearer <jwt> or ?token=<jwt>)
    let token: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query && typeof (req.query as any).token === 'string') {
      token = (req.query as any).token;
    } else if (req.url && req.url.includes('?')) {
      try {
        const queryIndex = req.url.indexOf('?');
        const qs = new URLSearchParams(req.url.slice(queryIndex + 1));
        const qToken = qs.get('token');
        if (qToken) {
          token = qToken;
        }
      } catch {}
    }

    if (token) {
      const authService = this.getAuthService(req);
      try {
        req.auth = authService.verifyToken(token);
      } catch {
        // Fallback to global authService if scoped verification fails for super-admin tokens
        if (authService !== this.authService) {
          try {
            const adminClaims = this.authService.verifyToken(token);
            if (adminClaims && adminClaims.isAdmin) {
              req.auth = adminClaims;
            }
          } catch {
            // Leave req.auth as null
          }
        }
      }
    }
  }

  public requireAdmin() {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await this.handle(req, reply);
      const isAuthorized =
        Boolean(req.auth?.isAdmin) ||
        Boolean(req.auth?.isApiKey && (req.auth.scopes?.includes('*') || req.auth.scopes?.includes('admin:*')));

      if (!isAuthorized) {
        reply.status(403).send({
          statusCode: 403,
          message: 'Only admins are authorized to access this resource',
        });
      }
    };
  }

  public requireAdminOrInitialSetup() {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await this.handle(req, reply);
      const authService = this.getAuthService(req);
      const hasAdmins = authService.hasAdmins() || this.authService.hasAdmins();
      if (!hasAdmins) {
        return;
      }
      const isAuthorized =
        Boolean(req.auth?.isAdmin) ||
        Boolean(req.auth?.isApiKey && (req.auth.scopes?.includes('*') || req.auth.scopes?.includes('admin:*')));

      if (!isAuthorized) {
        reply.status(403).send({
          statusCode: 403,
          message: 'Only admins are authorized to access this resource',
        });
      }
    };
  }

  public requireAuth() {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await this.handle(req, reply);
      if (!req.auth) {
        reply.status(401).send({
          statusCode: 401,
          message: 'Authentication required to access this resource',
        });
      }
    };
  }

  public requireScope(resource: string, action: string) {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await this.handle(req, reply);
      if (!req.auth) {
        return reply.status(401).send({
          statusCode: 401,
          message: 'Authentication required to access this resource',
        });
      }
      if (!hasScope(req.auth, resource, action)) {
        return reply.status(403).send({
          statusCode: 403,
          message: `API Key missing required scope for '${resource}:${action}'`,
        });
      }
    };
  }
}
