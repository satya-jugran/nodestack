import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { AuthService } from '../../auth/AuthService';
import { AppError } from '../../core/errors/AppError';

export class AuthController extends BaseController {
  constructor(
    private authService: AuthService,
    private fileStorageService?: any
  ) {
    super();
  }

  private getAuth(req?: any): AuthService {
    return req?.appScope?.auth || this.authService;
  }

  private getFiles(req?: any): any {
    return req?.appScope?.files || this.fileStorageService;
  }

  private static initialSetupMutex: Promise<void> = Promise.resolve();

  private static async withInitialSetupLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = AuthController.initialSetupMutex;
    let release: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    AuthController.initialSetupMutex = current;
    await previous.catch(() => {});
    try {
      return await fn();
    } finally {
      release!();
    }
  }

  public async hasAdmins(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = this.getAuth(req);
    const hasAdmins = await auth.hasAdmins();
    this.ok(reply, { hasAdmins });
  }

  public async createInitialAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    return AuthController.withInitialSetupLock(async () => {
      const auth = this.getAuth(req);
      if (await auth.hasAdmins()) {
        throw new AppError('Initial admin setup is already complete', 400);
      }

      const { email, password, avatar } = (req.body as any) || {};
      const admin = await auth.createInitialAdmin(email, password, avatar);
      const authResult = await auth.authenticateAdmin(email, password);

      this.ok(reply, {
        token: authResult.token,
        admin,
      }, 201);
    });
  }

  public async createAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    return AuthController.withInitialSetupLock(async () => {
      const auth = this.getAuth(req);
      const hasAdmins = await auth.hasAdmins();
      if (hasAdmins && !req.auth?.isAdmin) {
        throw new AppError('Only admins are authorized to create admins', 403);
      }

      const { email, password, avatar } = (req.body as any) || {};
      if (!email || !password) {
        throw new AppError('Email and password are required', 400);
      }

      if (!hasAdmins) {
        const admin = await auth.createInitialAdmin(email, password, avatar);
        const authResult = await auth.authenticateAdmin(email, password);
        return this.ok(reply, {
          token: authResult.token,
          admin,
        }, 201);
      }

      const admin = await auth.createAdmin(email, password, avatar);
      this.ok(reply, admin, 201);
    });
  }

  public async adminLogin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { identity, password, email } = (req.body as any) || {};
    const targetEmail = identity || email;
    if (!targetEmail || !password) {
      throw new AppError('Email/identity and password are required', 400);
    }

    const auth = this.getAuth(req);
    let result;
    try {
      result = await auth.authenticateAdmin(targetEmail, password);
    } catch (err) {
      if (auth !== this.authService) {
        result = await this.authService.authenticateAdmin(targetEmail, password);
      } else {
        throw err;
      }
    }
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

    const auth = this.getAuth(req);
    const result = await auth.authenticateRecord(collection, targetIdentity, password);
    this.ok(reply, {
      token: result.token,
      record: result.record,
    });
  }

  public async getAdminMe(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!req.auth || !req.auth.isAdmin) {
      throw new AppError('Unauthorized', 401);
    }
    const auth = this.getAuth(req);
    const admin = (await auth.getAdminById(req.auth.id)) || (await this.authService.getAdminById(req.auth.id));
    if (!admin) {
      throw new AppError('Admin not found', 404);
    }
    this.ok(reply, admin);
  }

  public async listAuthMethods(
    req: FastifyRequest<{ Params: { collection: string }; Querystring: { redirectUri?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection } = req.params;
    const redirectUri = req.query?.redirectUri;
    const auth = this.getAuth(req);
    const result = await auth.listAuthMethods(collection, redirectUri);
    this.ok(reply, result);
  }

  public async authWithOAuth2(
    req: FastifyRequest<{ Params: { collection: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection } = req.params;
    const { provider, code, codeVerifier, redirectUrl, redirectUri, createData, state } = (req.body as any) || {};

    if (!provider || !code || !codeVerifier || !state) {
      throw new AppError('provider, code, codeVerifier, and state are required for OAuth2 authentication', 400);
    }

    const auth = this.getAuth(req);
    const files = this.getFiles(req);
    const result = await auth.authenticateOAuth2(
      collection,
      provider,
      code,
      codeVerifier,
      redirectUrl || redirectUri,
      createData,
      files,
      req.auth,
      state,
      req
    );

    this.ok(reply, result);
  }

  public async getExternalAuths(
    req: FastifyRequest<{ Params: { collection: string; id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection, id } = req.params;
    if (!req.auth || (!req.auth.isAdmin && req.auth.id !== id)) {
      throw new AppError('Unauthorized to view external auth identities', 401);
    }
    const auth = this.getAuth(req);
    const list = await auth.getExternalAuths(collection, id);
    this.ok(reply, list);
  }

  public async unlinkExternalAuth(
    req: FastifyRequest<{ Params: { collection: string; id: string; provider: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection, id, provider } = req.params;
    if (!req.auth || (!req.auth.isAdmin && req.auth.id !== id)) {
      throw new AppError('Unauthorized to unlink external auth identity', 401);
    }
    const auth = this.getAuth(req);
    await auth.unlinkExternalAuth(collection, id, provider);
    this.noContent(reply);
  }
}
