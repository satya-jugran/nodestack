import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { TemplateService } from '../../templates/TemplateService';
import { AppError } from '../../core/errors/AppError';

export class TemplateController extends BaseController {
  constructor(private templateService: TemplateService) {
    super();
  }

  public async list(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const items = this.templateService.list();
    this.ok(reply, {
      items,
      totalItems: items.length,
    });
  }

  public async getOne(
    req: FastifyRequest<{ Params: { template: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const template = this.templateService.getOrThrow(req.params.template);
    this.ok(reply, {
      id: template.id,
      name: template.name,
      tagline: template.tagline,
      description: template.description,
      icon: template.icon,
      badge: template.badge,
      aliases: template.aliases,
      collections: template.collections.map((c) => ({
        name: c.name,
        fields: (c.dto.schema || []).map((f) => ({
          name: f.name,
          type: f.type,
          required: Boolean(f.required),
        })),
      })),
      stats: template.stats,
    });
  }

  public async apply(
    req: FastifyRequest<{ Body: { template?: string; overwrite?: boolean } }>,
    reply: FastifyReply
  ): Promise<void> {
    const templateName = req.body?.template;
    if (!templateName) {
      throw new AppError('Field "template" is required in request body', 400);
    }
    const result = await this.templateService.apply(templateName, {
      overwrite: Boolean(req.body?.overwrite),
    });
    this.ok(reply, result, 201);
  }

  public async applyParam(
    req: FastifyRequest<{
      Params: { template: string };
      Body?: { overwrite?: boolean };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const result = await this.templateService.apply(req.params.template, {
      overwrite: Boolean(req.body?.overwrite),
    });
    this.ok(reply, result, 201);
  }
}
