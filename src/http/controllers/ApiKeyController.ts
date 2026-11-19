import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { ApiKeyService, CreateApiKeyDto, UpdateApiKeyDto } from '../../auth/ApiKeyService';
import { AppError } from '../../core/errors/AppError';

export class ApiKeyController extends BaseController {
  constructor(private apiKeyService: ApiKeyService) {
    super();
  }

  private getService(req?: FastifyRequest): ApiKeyService {
    return (req as any)?.appScope?.apiKeys || this.apiKeyService;
  }

  public async list(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const service = this.getService(req);
    const query = (req.query as any) || {};

    let limit: number | undefined;
    if (query.limit !== undefined && query.limit !== '') {
      const raw = typeof query.limit === 'string' ? query.limit.trim() : query.limit;
      if (typeof raw === 'string' && !/^\+?\d+$/.test(raw)) {
        throw new AppError("Query parameter 'limit' must be an integer", 400);
      }
      const num = Number(raw);
      if (!Number.isInteger(num) || num < 1) {
        throw new AppError("Query parameter 'limit' must be a positive integer", 400);
      }
      limit = num;
    }

    let offset: number | undefined;
    if (query.offset !== undefined && query.offset !== '') {
      const raw = typeof query.offset === 'string' ? query.offset.trim() : query.offset;
      if (typeof raw === 'string' && !/^\+?\d+$/.test(raw)) {
        throw new AppError("Query parameter 'offset' must be an integer", 400);
      }
      const num = Number(raw);
      if (!Number.isInteger(num) || num < 0) {
        throw new AppError("Query parameter 'offset' must be a non-negative integer", 400);
      }
      offset = num;
    }

    if (query.status && !['active', 'revoked', 'expired'].includes(query.status)) {
      throw new AppError("Query parameter 'status' must be one of: active, revoked, expired", 400);
    }

    const keys = await service.listKeys({
      limit,
      offset,
      status: query.status,
    });
    this.ok(reply, keys);
  }

  public async create(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const service = this.getService(req);
    const body = (req.body as CreateApiKeyDto) || {};
    const createdBy = req.auth?.id;
    const result = await service.createKey({
      ...body,
      createdBy,
    });
    this.ok(reply, result, 201);
  }

  public async getOne(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getService(req);
    const key = await service.getKey(req.params.id);
    this.ok(reply, key);
  }

  public async update(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getService(req);
    const body = (req.body as UpdateApiKeyDto) || {};
    const updated = await service.updateKey(req.params.id, body);
    this.ok(reply, updated);
  }

  public async delete(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getService(req);
    await service.deleteKey(req.params.id);
    this.noContent(reply);
  }

  public async rotate(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getService(req);
    const result = await service.rotateKey(req.params.id);
    this.ok(reply, result);
  }

  public async simulate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const service = this.getService(req);
    const body = (req.body as any) || {};
    const keyId = (req.params as any)?.id || body.keyId;
    const appScope = (req as any)?.appScope;
    const appSlug = (req.params as any)?.appId || appScope?.app?.slug || appScope?.app?.id;
    const result = await service.simulate({
      ...body,
      keyId,
      appSlug: appSlug && appSlug !== 'default' ? appSlug : body.appSlug,
    });
    this.ok(reply, result);
  }
}
