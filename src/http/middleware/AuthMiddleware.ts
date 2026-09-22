import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService, AuthClaims } from '../../auth/AuthService';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthClaims | null;
  }
}

export class AuthMiddleware {
  constructor(private authService: AuthService) {}

  public async handle(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    req.auth = null;

    let token: string | undefined;

    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query && typeof (req.query as any).token === 'string') {
      // Allow token via query param (useful for SSE and file downloads)
      token = (req.query as any).token;
    }

    if (token) {
      try {
        req.auth = this.authService.verifyToken(token);
      } catch {
        // Leave req.auth as null so route can determine if auth is required
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
}
