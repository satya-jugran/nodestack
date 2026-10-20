import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import {
  WebhookService,
  WebhookQueryOptions,
  DeliveryQueryOptions,
} from '../../webhooks/WebhookService';

export class WebhookController extends BaseController {
  constructor(private webhookService: WebhookService) {
    super();
  }

  public async getWebhooks(
    req: FastifyRequest<{ Querystring: WebhookQueryOptions }>,
    reply: FastifyReply
  ): Promise<void> {
    const webhooks = this.webhookService.getWebhooks(req.query || {});
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
    const created = this.webhookService.createWebhook(req.body);
    this.ok(reply, created, 201);
  }

  public async getWebhook(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const webhook = this.webhookService.getWebhookById(req.params.id);
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
    const updated = this.webhookService.updateWebhook(req.params.id, req.body);
    this.ok(reply, updated);
  }

  public async deleteWebhook(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    this.webhookService.deleteWebhook(req.params.id);
    this.noContent(reply);
  }

  public async testWebhook(
    req: FastifyRequest<{ Params: { id: string }; Body?: { payload?: any } }>,
    reply: FastifyReply
  ): Promise<void> {
    const result = await this.webhookService.testWebhook(req.params.id, req.body?.payload);
    this.ok(reply, result);
  }

  public async getStats(
    _req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const stats = this.webhookService.getStats();
    this.ok(reply, stats);
  }

  public async getDeliveries(
    req: FastifyRequest<{ Querystring: DeliveryQueryOptions }>,
    reply: FastifyReply
  ): Promise<void> {
    const deliveries = this.webhookService.getDeliveries(req.query || {});
    this.ok(reply, deliveries);
  }

  public async getDelivery(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const delivery = this.webhookService.getDeliveryById(req.params.id);
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
    const result = await this.webhookService.retryDelivery(req.params.id);
    this.ok(reply, result);
  }

  public async clearDeliveries(
    req: FastifyRequest<{ Querystring: { olderThanDays?: number } }>,
    reply: FastifyReply
  ): Promise<void> {
    const deletedCount = this.webhookService.clearDeliveries(req.query?.olderThanDays);
    this.ok(reply, { success: true, deletedCount });
  }
}
