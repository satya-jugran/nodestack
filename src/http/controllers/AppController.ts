import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { AppManager } from '../../apps/AppManager';
import { CreateAppDto, UpdateAppDto } from '../../apps/models/App';

export class AppController extends BaseController {
  constructor(private appManager: AppManager) {
    super();
  }

  public async list(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const apps = this.appManager.list();
    this.ok(reply, {
      items: apps,
      totalItems: apps.length,
    });
  }

  public async getOne(
    req: FastifyRequest<{ Params: { appId: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const scope = this.appManager.get(req.params.appId);
    this.ok(reply, scope.app);
  }

  public async create(
    req: FastifyRequest<{ Body: CreateAppDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const scope = await this.appManager.create(req.body);
    this.ok(reply, scope.app, 201);
  }

  public async update(
    req: FastifyRequest<{ Params: { appId: string }; Body: UpdateAppDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const updated = this.appManager.update(req.params.appId, req.body);
    this.ok(reply, updated);
  }

  public async delete(
    req: FastifyRequest<{ Params: { appId: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    await this.appManager.delete(req.params.appId);
    this.noContent(reply);
  }
}
