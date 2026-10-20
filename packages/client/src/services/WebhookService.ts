import { BaseService } from './BaseService';
import type {
  WebhookModel,
  WebhookCreateOptions,
  WebhookUpdateOptions,
  WebhookDeliveryLog,
  WebhookQueryOptions,
  DeliveryQueryOptions,
  DeliveryListResult,
  WebhookStatsResult,
  WebhookClearDeliveriesResult,
} from '../types';

/**
 * Computes an HMAC-SHA256 signature for a payload and secret string.
 */
export function computeWebhookSignature(payload: string | object, secret: string): string {
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  try {
    const nodeCrypto = typeof require !== 'undefined' ? require('crypto') : (globalThis as any)?.crypto;
    if (nodeCrypto && typeof nodeCrypto.createHmac === 'function') {
      return nodeCrypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex');
    }
  } catch {}
  throw new Error('[NodeStackClient] HMAC-SHA256 computation requires crypto module.');
}

/**
 * Verifies an incoming X-NodeStack-Signature header against the expected secret.
 * Tolerates both raw 64-char hex strings and 'sha256=' / 'sha256:' prefixes.
 * Uses constant-time comparison to mitigate timing attacks.
 */
export function verifyWebhookSignature(
  payload: string | object,
  signatureHeader: string,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  let expected = '';
  try {
    expected = computeWebhookSignature(payload, secret);
  } catch {
    return false;
  }

  let cleanHeader = signatureHeader.trim();
  if (cleanHeader.startsWith('sha256=')) {
    cleanHeader = cleanHeader.substring(7);
  } else if (cleanHeader.startsWith('sha256:')) {
    cleanHeader = cleanHeader.substring(7);
  }

  if (cleanHeader.length !== expected.length) return false;

  try {
    const nodeCrypto = typeof require !== 'undefined' ? require('crypto') : null;
    if (nodeCrypto && typeof nodeCrypto.timingSafeEqual === 'function' && typeof Buffer !== 'undefined') {
      return nodeCrypto.timingSafeEqual(Buffer.from(cleanHeader, 'hex'), Buffer.from(expected, 'hex'));
    }
  } catch {}

  // Constant-time string comparison fallback
  let diff = 0;
  for (let i = 0; i < cleanHeader.length; i++) {
    diff |= cleanHeader.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Service for managing outbound webhooks, inspecting deliveries, and manual retry (Admin only).
 */
export class WebhookService extends BaseService {
  /**
   * Retrieves all configured outbound webhooks.
   */
  public async getList(options: WebhookQueryOptions = {}): Promise<WebhookModel[]> {
    const res = await this.send<WebhookModel[]>('/api/webhooks', {
      method: 'GET',
      query: options,
    });
    return Array.isArray(res) ? res : [];
  }

  /**
   * Retrieves a single webhook by ID.
   */
  public async getOne(id: string): Promise<WebhookModel> {
    return this.send<WebhookModel>(`/api/webhooks/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  }

  /**
   * Creates a new outbound webhook configuration.
   */
  public async create(data: WebhookCreateOptions): Promise<WebhookModel> {
    return this.send<WebhookModel>('/api/webhooks', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Updates an existing webhook configuration.
   */
  public async update(id: string, data: WebhookUpdateOptions): Promise<WebhookModel> {
    return this.send<WebhookModel>(`/api/webhooks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: data,
    });
  }

  /**
   * Deletes a configured webhook by ID.
   */
  public async delete(id: string): Promise<boolean> {
    await this.send<void>(`/api/webhooks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return true;
  }

  /**
   * Dispatches a live test event to the target webhook endpoint with an optional payload.
   */
  public async test(id: string, payload?: any): Promise<WebhookDeliveryLog> {
    return this.send<WebhookDeliveryLog>(`/api/webhooks/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      body: payload !== undefined ? { payload } : {},
    });
  }

  /**
   * Retrieves overall webhook health and delivery statistics.
   */
  public async getStats(): Promise<WebhookStatsResult> {
    return this.send<WebhookStatsResult>('/api/webhooks/stats', {
      method: 'GET',
    });
  }

  /**
   * Queries paginated webhook delivery logs with optional filtering by webhook ID, collection, status, or search.
   */
  public async getDeliveries(options: DeliveryQueryOptions = {}): Promise<DeliveryListResult> {
    return this.send<DeliveryListResult>('/api/webhooks/deliveries', {
      method: 'GET',
      query: options,
    });
  }

  /**
   * Retrieves complete delivery log details including headers and request/response payloads.
   */
  public async getDelivery(id: string): Promise<WebhookDeliveryLog> {
    return this.send<WebhookDeliveryLog>(`/api/webhooks/deliveries/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  }

  /**
   * Manually retries a failed delivery attempt to its target endpoint.
   */
  public async retryDelivery(id: string): Promise<WebhookDeliveryLog> {
    return this.send<WebhookDeliveryLog>(`/api/webhooks/deliveries/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    });
  }

  /**
   * Clears delivery history logs. If olderThanDays is specified, only deletes logs older than that many days.
   */
  public async clearDeliveries(olderThanDays?: number): Promise<WebhookClearDeliveriesResult> {
    const query: Record<string, any> = {};
    if (olderThanDays !== undefined && olderThanDays !== null) {
      query.olderThanDays = olderThanDays;
    }
    return this.send<WebhookClearDeliveriesResult>('/api/webhooks/deliveries', {
      method: 'DELETE',
      query,
    });
  }

  /**
   * Verifies an incoming X-NodeStack-Signature header against the expected secret.
   */
  public verifySignature(payload: string | object, signatureHeader: string, secret: string): boolean {
    return verifyWebhookSignature(payload, signatureHeader, secret);
  }

  /**
   * Computes an HMAC-SHA256 signature for a payload and secret string.
   */
  public computeSignature(payload: string | object, secret: string): string {
    return computeWebhookSignature(payload, secret);
  }

  public static verifySignature = verifyWebhookSignature;
  public static computeSignature = computeWebhookSignature;
}
