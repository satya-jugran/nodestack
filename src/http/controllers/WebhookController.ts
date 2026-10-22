import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { AppError } from '../../core/errors/AppError';
import {
  WebhookService,
  WebhookQueryOptions,
  DeliveryQueryOptions,
} from '../../webhooks/WebhookService';

export class WebhookController extends BaseController {
  constructor(private webhookService: WebhookService) {
    super();
  }

  private getWebhooksService(req: any): WebhookService {
    return req?.appScope?.webhooks || this.webhookService;
  }

  public async getWebhooks(
    req: FastifyRequest<{ Querystring: WebhookQueryOptions }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getWebhooksService(req);
    const webhooks = service.getWebhooks(req.query || {});
    this.ok(reply, webhooks);
  }

  public async createWebhook(
    req: FastifyRequest<{
      Body: {
        name: string;
        url: string;
        collection?: string;
        event?: string;
        action?: string;
        method?: string;
        headers?: Record<string, string> | string;
        secret?: string | null;
        enabled?: boolean;
      };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getWebhooksService(req);
    try {
      const created = service.createWebhook(req.body);
      this.ok(reply, created, 201);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to create webhook', 400);
    }
  }

  public async getWebhook(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getWebhooksService(req);
    const webhook = service.getWebhookById(req.params.id);
    if (!webhook) {
      this.error(reply, 'Webhook not found', 404);
      return;
    }
    this.ok(reply, webhook);
  }

  public async updateWebhook(
    req: FastifyRequest<{
      Params: { id: string };
      Body: Partial<{
        name: string;
        url: string;
        collection: string;
        event: string;
        action: string;
        method: string;
        headers: Record<string, string> | string;
        secret: string | null;
        enabled: boolean;
      }>;
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getWebhooksService(req);
    try {
      const updated = service.updateWebhook(req.params.id, req.body);
      this.ok(reply, updated);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to update webhook', 400);
    }
  }

  public async deleteWebhook(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getWebhooksService(req);
    service.deleteWebhook(req.params.id);
    this.noContent(reply);
  }

  public async testWebhook(
    req: FastifyRequest<{ Params: { id: string }; Body?: { payload?: any } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getWebhooksService(req);
    const result = await service.testWebhook(req.params.id, req.body?.payload);
    this.ok(reply, result);
  }

  public async getStats(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getWebhooksService(req);
    const stats = service.getStats();
    this.ok(reply, stats);
  }

  public async getDeliveries(
    req: FastifyRequest<{ Querystring: DeliveryQueryOptions }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getWebhooksService(req);
    const deliveries = service.getDeliveries(req.query || {});
    this.ok(reply, deliveries);
  }

  public async getDelivery(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getWebhooksService(req);
    const delivery = service.getDeliveryById(req.params.id);
    if (!delivery) {
      this.error(reply, 'Delivery log not found', 404);
      return;
    }
    this.ok(reply, delivery);
  }

  public async retryDelivery(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getWebhooksService(req);
    const result = await service.retryDelivery(req.params.id);
    this.ok(reply, result);
  }

  public async clearDeliveries(
    req: FastifyRequest<{ Querystring: { olderThanDays?: string | number } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getWebhooksService(req);
    const rawOlderThan = req.query?.olderThanDays;
    let olderThanDays: number | undefined = undefined;

    if (rawOlderThan !== undefined && rawOlderThan !== null && String(rawOlderThan).trim() !== '') {
      const parsed = Number(rawOlderThan);
      if (!Number.isFinite(parsed) || parsed < 0) {
        this.error(reply, 'Invalid olderThanDays parameter. Must be a non-negative number.', 400);
        return;
      }
      olderThanDays = parsed;
    }

    try {
      const deletedCount = service.clearDeliveries(olderThanDays);
      this.ok(reply, { success: true, deletedCount });
    } catch (err: any) {
      this.error(reply, err.message || 'Failed to clear deliveries', 400);
    }
  }
}
