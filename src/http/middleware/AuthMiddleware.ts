import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService, AuthClaims } from '../../auth/AuthService';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthClaims | null;
  }
}

export class AuthMiddleware {
  constructor(private authService: AuthService) {}

  public getAuthService(req?: FastifyRequest): AuthService {
    return (req as any)?.appScope?.auth || this.authService;
  }

  public async handle(req: FastifyRequest, _reply?: FastifyReply): Promise<void> {
    req.auth = null;

    let token: string | undefined;

    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query && typeof (req.query as any).token === 'string') {
      // Allow token via query param (useful for SSE and file downloads)
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
        // If scoped verification failed (e.g. app-scoped collection token or scoped admin mismatch),
        // fallback to default authService if the token is a valid global admin token.
        if (authService !== this.authService) {
          try {
            const adminClaims = this.authService.verifyToken(token);
            if (adminClaims && adminClaims.isAdmin) {
              req.auth = adminClaims;
            }
          } catch {
            // Leave req.auth as null so route can determine if auth is required
          }
        }
      }
    }
  }

  public requireAdmin() {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await this.handle(req, reply);
      if (!req.auth || !req.auth.isAdmin) {
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
      if (!req.auth || !req.auth.isAdmin) {
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
}
