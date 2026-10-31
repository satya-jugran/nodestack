import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { AppError, ForbiddenError, UnauthorizedError } from '../../core/errors/AppError';
import { FunctionService } from '../../functions/FunctionService';
import { CreateFunctionDto, UpdateFunctionDto, FunctionRequestContext } from '../../functions/types';

export class FunctionController extends BaseController {
  constructor(private functionService?: FunctionService) {
    super();
  }

  private getFunctionsService(req: any): FunctionService {
    return req?.appScope?.functions || this.functionService;
  }

  // ==========================================
  // Admin Management Endpoints
  // ==========================================

  public async getFunctions(
    req: FastifyRequest<{ Querystring: { search?: string; enabled?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFunctionsService(req);
    const enabled = req.query.enabled !== undefined ? req.query.enabled === 'true' || req.query.enabled === '1' : undefined;
    const functions = service.getAllFunctions({
      search: req.query.search,
      enabled,
    });
    this.ok(reply, functions);
  }

  public async getFunction(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFunctionsService(req);
    const fn = service.getFunctionById(req.params.id) || service.getFunctionByName(req.params.id);
    if (!fn) {
      this.error(reply, 'Function not found', 404);
      return;
    }
    this.ok(reply, fn);
  }

  public async createFunction(
    req: FastifyRequest<{ Body: CreateFunctionDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFunctionsService(req);
    try {
      const created = service.createFunction(req.body, (req as any).auth);
      this.ok(reply, created, 201);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to create function', 400);
    }
  }

  public async updateFunction(
    req: FastifyRequest<{ Params: { id: string }; Body: UpdateFunctionDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFunctionsService(req);
    try {
      const updated = service.updateFunction(req.params.id, req.body, (req as any).auth);
      this.ok(reply, updated);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to update function', 400);
    }
  }

  public async deleteFunction(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFunctionsService(req);
    try {
      service.deleteFunction(req.params.id, (req as any).auth);
      this.ok(reply, { success: true, message: 'Function deleted' });
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to delete function', 400);
    }
  }

  public async testFunction(
    req: FastifyRequest<{ Params: { id: string }; Body: any }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFunctionsService(req);
    try {
      const result = await service.testFunction(
        req.params.id,
        req.body || {},
        (req as any).auth
      );
      this.ok(reply, result);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to test function', 500);
    }
  }

  public async getLogs(
    req: FastifyRequest<{
      Params?: { id?: string };
      Querystring: { functionId?: string; page?: string; perPage?: string; status?: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFunctionsService(req);
    const fnId = req.params?.id || req.query.functionId;
    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const perPage = req.query.perPage ? parseInt(req.query.perPage, 10) : 25;
    const status = req.query.status;

    const result = service.getLogs(fnId, { page, perPage, status });
    this.ok(reply, result);
  }

  public async clearLogs(
    req: FastifyRequest<{ Params?: { id?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFunctionsService(req);
    const fnId = req.params?.id;
    service.clearLogs(fnId);
    this.ok(reply, { success: true, message: 'Logs cleared' });
  }

  public async getStats(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const service = this.getFunctionsService(req);
    const stats = service.getStats();
    this.ok(reply, stats);
  }

  // ==========================================
  // Dynamic Invocation Endpoint
  // ==========================================

  public async invoke(
    req: FastifyRequest<{ Params: { name: string; [key: string]: any } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFunctionsService(req);
    const functionName = req.params.name;
    const fn = service.getFunctionByName(functionName) || service.getFunctionById(functionName);

    if (!fn) {
      this.error(reply, `Function '${functionName}' not found`, 404);
      return;
    }

    if (!fn.enabled) {
      this.error(reply, `Function '${fn.name}' is currently disabled`, 403);
      return;
    }

    // Auth Policy Enforcement
    const auth = (req as any).auth;
    try {
      service.verifyAuthPolicy(fn, auth);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Authorization failed', 403);
      return;
    }

    const requestContext: FunctionRequestContext = {
      method: req.method,
      path: req.url,
      query: (req.query as Record<string, any>) || {},
      headers: (req.headers as Record<string, string>) || {},
      body: req.body ?? {},
      params: (req.params as Record<string, string>) || {},
      auth: auth ? { id: auth.id, role: auth.isAdmin ? 'admin' : (auth.isApiKey ? 'apiKey' : 'user'), email: auth.email } : null,
    };

    try {
      const result = await service.executeFunction(fn.id, requestContext, auth);

      // Set custom response headers if returned by function
      if (result.headers && typeof result.headers === 'object') {
        for (const [key, val] of Object.entries(result.headers)) {
          reply.header(key, val);
        }
      }

      if (result.status === 'timeout') {
        reply.status(504).send({
          statusCode: 504,
          error: 'Gateway Timeout',
          message: result.error || 'Function execution timed out',
          durationMs: result.durationMs,
        });
        return;
      }

      if (result.status === 'error') {
        reply.status(result.statusCode || 500).send({
          statusCode: result.statusCode || 500,
          error: 'Internal Server Error',
          message: result.error || 'Function execution failed',
          durationMs: result.durationMs,
        });
        return;
      }

      reply.status(result.statusCode || 200).send(result.body ?? null);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Execution error', 500);
    }
  }
}
