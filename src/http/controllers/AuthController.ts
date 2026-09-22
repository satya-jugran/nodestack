import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { AuthService } from '../../auth/AuthService';
import { AppError } from '../../core/errors/AppError';

export class AuthController extends BaseController {
  constructor(private authService: AuthService) {
    super();
  }

  public async hasAdmins(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const hasAdmins = this.authService.hasAdmins();
    this.ok(reply, { hasAdmins });
  }

  public async createInitialAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (this.authService.hasAdmins()) {
      throw new AppError('Initial admin setup is already complete', 400);
    }

    const { email, password } = req.body as any;
    const admin = await this.authService.createAdmin(email, password);
    const authResult = await this.authService.authenticateAdmin(email, password);

    this.ok(reply, {
      token: authResult.token,
      admin,
    }, 201);
  }

  public async adminLogin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { identity, password, email } = (req.body as any) || {};
    const targetEmail = identity || email;
    if (!targetEmail || !password) {
      throw new AppError('Email/identity and password are required', 400);
    }

    const result = await this.authService.authenticateAdmin(targetEmail, password);
    this.ok(reply, {
      token: result.token,
      admin: result.record,
    });
  }

  public async recordLogin(
    req: FastifyRequest<{ Params: { collection: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection } = req.params;
    const { identity, email, password } = (req.body as any) || {};
    const targetIdentity = identity || email;

    if (!targetIdentity || !password) {
      throw new AppError('Identity and password are required', 400);
    }

    const result = await this.authService.authenticateRecord(collection, targetIdentity, password);
    this.ok(reply, {
      token: result.token,
      record: result.record,
    });
  }

  public async getAdminMe(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!req.auth || !req.auth.isAdmin) {
      throw new AppError('Unauthorized', 401);
    }
    const admin = this.authService.getAdminById(req.auth.id);
    if (!admin) {
      throw new AppError('Admin not found', 404);
    }
    this.ok(reply, admin);
  }
}
