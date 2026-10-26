import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { ApiKeyService, CreateApiKeyDto, UpdateApiKeyDto } from '../../auth/ApiKeyService';

export class ApiKeyController extends BaseController {
  constructor(private apiKeyService: ApiKeyService) {
    super();
  }

  private getService(req?: FastifyRequest): ApiKeyService {
    return (req as any)?.appScope?.apiKeys || this.apiKeyService;
  }

  public async list(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const service = this.getService(req);
    const keys = service.listKeys();
    this.ok(reply, keys);
  }

  public async create(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const service = this.getService(req);
    const body = (req.body as CreateApiKeyDto) || {};
    const createdBy = req.auth?.id;
    const result = service.createKey({
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
    const key = service.getKey(req.params.id);
    this.ok(reply, key);
  }

  public async update(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getService(req);
    const body = (req.body as UpdateApiKeyDto) || {};
    const updated = service.updateKey(req.params.id, body);
    this.ok(reply, updated);
  }

  public async delete(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getService(req);
    service.deleteKey(req.params.id);
    this.noContent(reply);
  }

  public async rotate(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getService(req);
    const result = service.rotateKey(req.params.id);
    this.ok(reply, result);
  }
}
