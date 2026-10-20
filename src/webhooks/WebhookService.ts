import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { EventBus } from '../core/events/EventBus';
import { RecordAfterEventContext } from '../core/events/types';
import { AppError } from '../core/errors/AppError';

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  collection: string;
  event: string;
  action: string;
  method: string;
  headers: Record<string, string>;
  secret: string | null;
  enabled: boolean;
  created: string;
  updated: string;
}

export interface WebhookDeliveryLog {
  id: string;
  webhookId: string;
  webhookName: string;
  url: string;
  event: string;
  collection: string;
  recordId: string | null;
  requestHeaders: Record<string, string>;
  requestPayload: any;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
  durationMs: number;
  status: 'success' | 'failed';
  error: string | null;
  attempt: number;
  created: string;
}

export interface WebhookQueryOptions {
  collection?: string;
  event?: string;
  enabled?: boolean;
}

export interface DeliveryQueryOptions {
  webhookId?: string;
  collection?: string;
  status?: 'success' | 'failed' | 'all';
  search?: string;
  page?: number;
  perPage?: number;
}

export interface DeliveryListResult {
  items: WebhookDeliveryLog[];
  totalItems: number;
  totalPages: number;
  page: number;
  perPage: number;
}

export interface WebhookStatsResult {
  totalWebhooks: number;
  activeWebhooks: number;
  totalDeliveries: number;
  successDeliveries: number;
  failedDeliveries: number;
  successRate: string;
}

export interface WebhookServiceOptions {
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}

export class WebhookService {
  private fetchFn: typeof fetch;
  private requestTimeoutMs: number;

  constructor(
    private db: DatabaseService,
    private eventBus?: EventBus,
    options: WebhookServiceOptions = {}
  ) {
    this.fetchFn = options.fetch || globalThis.fetch;
    this.requestTimeoutMs = options.requestTimeoutMs || 10000;
    this.initTables();
  }

  public setFetch(customFetch: typeof fetch): void {
    this.fetchFn = customFetch;
  }

  /**
   * Ensures SQLite tables and indices for webhooks and deliveries exist.
   */
  public initTables(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS _webhooks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          event TEXT NOT NULL,
          collection TEXT NOT NULL,
          action TEXT NOT NULL DEFAULT '*',
          method TEXT NOT NULL DEFAULT 'POST',
          headers TEXT,
          secret TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_webhooks_collection ON _webhooks(collection);
        CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON _webhooks(enabled);

        CREATE TABLE IF NOT EXISTS _webhook_deliveries (
          id TEXT PRIMARY KEY,
          webhookId TEXT NOT NULL,
          webhookName TEXT NOT NULL,
          url TEXT NOT NULL,
          event TEXT NOT NULL,
          collection TEXT NOT NULL,
          recordId TEXT,
          requestHeaders TEXT NOT NULL,
          requestPayload TEXT NOT NULL,
          responseStatus INTEGER NOT NULL DEFAULT 0,
          responseHeaders TEXT,
          responseBody TEXT,
          durationMs INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          error TEXT,
          attempt INTEGER NOT NULL DEFAULT 1,
          created TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_webhook_del_wh ON _webhook_deliveries(webhookId, created DESC);
        CREATE INDEX IF NOT EXISTS idx_webhook_del_created ON _webhook_deliveries(created DESC);
        CREATE INDEX IF NOT EXISTS idx_webhook_del_status ON _webhook_deliveries(status);
      `);
    } catch {
      // Ignored if already initialized
    }
  }

  // ==========================================
  // Webhook Configuration CRUD
  // ==========================================

  public createWebhook(data: {
    name: string;
    url: string;
    collection?: string;
    event?: string;
    action?: string;
    method?: string;
    headers?: Record<string, string> | string;
    secret?: string | null;
    enabled?: boolean;
  }): WebhookConfig {
    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      throw new AppError('Webhook name is required', 400);
    }
    if (!data.url || typeof data.url !== 'string' || !data.url.trim()) {
      throw new AppError('Target HTTP endpoint URL is required', 400);
    }

    try {
      const parsed = new URL(data.url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('URL must start with http:// or https://');
      }
    } catch {
      throw new AppError('A valid HTTP or HTTPS endpoint URL is required', 400);
    }

    let collection = (data.collection || '*').trim();
    let event = (data.event || '*').trim();

    // If event is formatted as collection.event (e.g. "post.created"), split cleanly
    if (event.includes('.')) {
      const [colPart, actPart] = event.split('.');
      if ((!collection || collection === '*') && colPart && colPart !== '*') {
        collection = colPart;
      }
      if (actPart) {
        event = actPart;
      }
    }

    const action = data.action ? data.action.trim() : event !== '*' ? event : '*';
    const id = `whk_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    let normalizedHeaders: Record<string, string> = {};
    if (typeof data.headers === 'string') {
      try {
        normalizedHeaders = JSON.parse(data.headers);
      } catch {
        normalizedHeaders = {};
      }
    } else if (data.headers && typeof data.headers === 'object') {
      normalizedHeaders = { ...data.headers };
    }

    const enabled = data.enabled !== undefined ? (data.enabled ? 1 : 0) : 1;
    const secret = data.secret && data.secret.trim() ? data.secret.trim() : null;
    const method = (data.method || 'POST').trim().toUpperCase();

    this.db.prepare(`
      INSERT INTO _webhooks (
        id, name, url, event, collection, action, method, headers, secret, enabled, created, updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.name.trim(),
      data.url.trim(),
      event,
      collection,
      action,
      method,
      JSON.stringify(normalizedHeaders),
      secret,
      enabled,
      now,
      now
    );

    return {
      id,
      name: data.name.trim(),
      url: data.url.trim(),
      collection,
      event,
      action,
      method,
      headers: normalizedHeaders,
      secret,
      enabled: Boolean(enabled),
      created: now,
      updated: now,
    };
  }

  public getWebhooks(options: WebhookQueryOptions = {}): WebhookConfig[] {
    const whereClauses: string[] = [];
    const params: any[] = [];

    if (options.collection) {
      whereClauses.push('(collection = ? OR collection = "*")');
      params.push(options.collection);
    }
    if (options.event) {
      whereClauses.push('(event = ? OR event = "*")');
      params.push(options.event);
    }
    if (options.enabled !== undefined) {
      whereClauses.push('enabled = ?');
      params.push(options.enabled ? 1 : 0);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const rows = this.db.all<any>(`SELECT * FROM _webhooks ${whereSql} ORDER BY created DESC`, params);

    return rows.map((r) => this.mapWebhookRow(r));
  }

  public getWebhookById(id: string): WebhookConfig | null {
    const row = this.db.get<any>('SELECT * FROM _webhooks WHERE id = ?', [id]);
    if (!row) return null;
    return this.mapWebhookRow(row);
  }

  public updateWebhook(
    id: string,
    updates: Partial<{
      name: string;
      url: string;
      collection: string;
      event: string;
      action: string;
      method: string;
      headers: Record<string, string> | string;
      secret: string | null;
      enabled: boolean;
    }>
  ): WebhookConfig {
    const existing = this.getWebhookById(id);
    if (!existing) {
      throw new AppError('Webhook not found', 404);
    }

    let url = existing.url;
    if (updates.url !== undefined) {
      try {
        const parsed = new URL(updates.url.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('URL must start with http:// or https://');
        }
        url = updates.url.trim();
      } catch {
        throw new AppError('A valid HTTP or HTTPS endpoint URL is required', 400);
      }
    }

    const name = updates.name !== undefined ? updates.name.trim() : existing.name;
    if (!name) throw new AppError('Webhook name cannot be empty', 400);

    let collection = updates.collection !== undefined ? updates.collection.trim() : existing.collection;
    let event = updates.event !== undefined ? updates.event.trim() : existing.event;

    if (event.includes('.')) {
      const [colPart, actPart] = event.split('.');
      if (colPart && colPart !== '*') collection = colPart;
      if (actPart) event = actPart;
    }

    const action = updates.action !== undefined ? updates.action.trim() : event !== '*' ? event : existing.action;
    const method = updates.method !== undefined ? updates.method.trim().toUpperCase() : existing.method;

    let headers = existing.headers;
    if (updates.headers !== undefined) {
      if (typeof updates.headers === 'string') {
        try {
          headers = JSON.parse(updates.headers);
        } catch {
          headers = {};
        }
      } else if (updates.headers && typeof updates.headers === 'object') {
        headers = { ...updates.headers };
      }
    }

    let secret = existing.secret;
    if (updates.secret !== undefined) {
      secret = updates.secret && updates.secret.trim() ? updates.secret.trim() : null;
    }

    const enabled = updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : existing.enabled ? 1 : 0;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE _webhooks SET
        name = ?, url = ?, collection = ?, event = ?, action = ?, method = ?,
        headers = ?, secret = ?, enabled = ?, updated = ?
      WHERE id = ?
    `).run(
      name,
      url,
      collection,
      event,
      action,
      method,
      JSON.stringify(headers),
      secret,
      enabled,
      now,
      id
    );

    return {
      id,
      name,
      url,
      collection,
      event,
      action,
      method,
      headers,
      secret,
      enabled: Boolean(enabled),
      created: existing.created,
      updated: now,
    };
  }

  public deleteWebhook(id: string): boolean {
    const existing = this.getWebhookById(id);
    if (!existing) {
      throw new AppError('Webhook not found', 404);
    }
    const result = this.db.prepare('DELETE FROM _webhooks WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  // ==========================================
  // Delivery Logs & Retries
  // ==========================================

  public getDeliveries(options: DeliveryQueryOptions = {}): DeliveryListResult {
    const page = Math.max(1, Number(options.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(options.perPage) || 25));
    const offset = (page - 1) * perPage;

    const whereClauses: string[] = [];
    const params: any[] = [];

    if (options.webhookId) {
      whereClauses.push('webhookId = ?');
      params.push(options.webhookId);
    }
    if (options.collection) {
      whereClauses.push('collection = ?');
      params.push(options.collection);
    }
    if (options.status && options.status !== 'all') {
      whereClauses.push('status = ?');
      params.push(options.status);
    }
    if (options.search && options.search.trim()) {
      const term = `%${options.search.trim()}%`;
      whereClauses.push('(url LIKE ? OR event LIKE ? OR webhookName LIKE ? OR error LIKE ?)');
      params.push(term, term, term, term);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow = this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM _webhook_deliveries ${whereSql}`,
      params
    );
    const totalItems = countRow?.count || 0;
    const totalPages = Math.ceil(totalItems / perPage);

    const rows = this.db.all<any>(
      `SELECT * FROM _webhook_deliveries ${whereSql} ORDER BY created DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    const items: WebhookDeliveryLog[] = rows.map((r) => this.mapDeliveryRow(r));

    return {
      items,
      totalItems,
      totalPages,
      page,
      perPage,
    };
  }

  public getDeliveryById(id: string): WebhookDeliveryLog | null {
    const row = this.db.get<any>('SELECT * FROM _webhook_deliveries WHERE id = ?', [id]);
    if (!row) return null;
    return this.mapDeliveryRow(row);
  }

  public clearDeliveries(olderThanDays?: number): number {
    if (olderThanDays && olderThanDays > 0) {
      const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
      const res = this.db.prepare('DELETE FROM _webhook_deliveries WHERE created < ?').run(cutoff);
      return Number(res.changes);
    }
    const res = this.db.prepare('DELETE FROM _webhook_deliveries').run();
    return Number(res.changes);
  }

  public getStats(): WebhookStatsResult {
    const totalRow = this.db.get<{ total: number; active: number }>(`
      SELECT COUNT(*) as total, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active FROM _webhooks
    `);
    const deliveriesRow = this.db.get<{ total: number; success: number; failed: number }>(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM _webhook_deliveries
    `);

    const totalWebhooks = totalRow?.total || 0;
    const activeWebhooks = totalRow?.active || 0;
    const totalDeliveries = deliveriesRow?.total || 0;
    const successDeliveries = deliveriesRow?.success || 0;
    const failedDeliveries = deliveriesRow?.failed || 0;

    let successRate = '100%';
    if (totalDeliveries > 0) {
      const rate = ((successDeliveries / totalDeliveries) * 100).toFixed(1);
      successRate = `${rate}%`;
    }

    return {
      totalWebhooks,
      activeWebhooks,
      totalDeliveries,
      successDeliveries,
      failedDeliveries,
      successRate,
    };
  }

  // ==========================================
  // Dispatch & Manual Retry
  // ==========================================

  /**
   * Outbound HTTP dispatch engine for a single webhook.
   */
  public async dispatch(
    webhook: Pick<WebhookConfig, 'id' | 'name' | 'url' | 'method' | 'headers' | 'secret'>,
    payload: any,
    attempt = 1
  ): Promise<WebhookDeliveryLog> {
    const deliveryId = `whd_${crypto.randomBytes(8).toString('hex')}`;
    const timestamp = new Date().toISOString();
    const eventName = payload?.event || 'custom';
    const collectionName = payload?.collection || (payload?.event?.includes('.') ? payload.event.split('.')[0] : 'default');
    const recordId = payload?.record?.id || payload?.recordId || null;

    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

    // Prepare Request Headers
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'NodeStack-Webhooks/1.2.0',
      ...(webhook.headers || {}),
    };

    // Calculate HMAC-SHA256 Secret Signature (X-NodeStack-Signature)
    if (webhook.secret) {
      const signature = WebhookService.computeSignature(payloadString, webhook.secret);
      requestHeaders['X-NodeStack-Signature'] = signature;
    }

    const startTime = Date.now();
    let responseStatus = 0;
    let responseHeaders: Record<string, string> = {};
    let responseBody = '';
    let status: 'success' | 'failed' = 'failed';
    let errorMessage: string | null = null;

    const fetchFn = this.fetchFn || globalThis.fetch;

    if (!fetchFn) {
      errorMessage = 'Global fetch is not available';
    } else {
      let timeoutId: any = null;
      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

        const res = await fetchFn(webhook.url, {
          method: webhook.method || 'POST',
          headers: requestHeaders,
          body: payloadString,
          signal: controller.signal,
        });

        responseStatus = res.status;
        res.headers.forEach((val, key) => {
          responseHeaders[key] = val;
        });

        responseBody = await res.text().catch(() => '');
        // Keep body reasonable for SQLite storage (first 10,000 characters)
        if (responseBody.length > 10000) {
          responseBody = responseBody.substring(0, 10000) + '... [truncated]';
        }

        if (res.ok) {
          status = 'success';
        } else {
          status = 'failed';
          errorMessage = `HTTP ${res.status}: ${res.statusText || 'Response not OK'}`;
        }
      } catch (err: any) {
        status = 'failed';
        errorMessage = err.name === 'AbortError' ? `Request timed out after ${this.requestTimeoutMs}ms` : (err.message || String(err));
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }

    const durationMs = Date.now() - startTime;

    // Record Delivery Log in SQLite
    try {
      this.db.prepare(`
        INSERT INTO _webhook_deliveries (
          id, webhookId, webhookName, url, event, collection, recordId,
          requestHeaders, requestPayload, responseStatus, responseHeaders,
          responseBody, durationMs, status, error, attempt, created
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        deliveryId,
        webhook.id,
        webhook.name,
        webhook.url,
        eventName,
        collectionName,
        recordId,
        JSON.stringify(requestHeaders),
        payloadString,
        responseStatus,
        JSON.stringify(responseHeaders),
        responseBody,
        durationMs,
        status,
        errorMessage,
        attempt,
        timestamp
      );
    } catch (dbErr) {
      console.error('[WebhookService] Failed to record delivery log:', dbErr);
    }

    const deliveryRecord: WebhookDeliveryLog = {
      id: deliveryId,
      webhookId: webhook.id,
      webhookName: webhook.name,
      url: webhook.url,
      event: eventName,
      collection: collectionName,
      recordId,
      requestHeaders,
      requestPayload: this.safeParseJson(payloadString, payload),
      responseStatus,
      responseHeaders,
      responseBody,
      durationMs,
      status,
      error: errorMessage,
      attempt,
      created: timestamp,
    };

    if (this.eventBus) {
      const eventName = status === 'success' ? 'webhook:delivered' : 'webhook:failed';
      this.eventBus.emit(eventName, {
        webhook,
        delivery: deliveryRecord,
      });
    }

    return deliveryRecord;
  }

  /**
   * Manual Retry Button handler:
   * Retries an existing delivery by ID, re-delivering the exact original payload.
   */
  public async retryDelivery(deliveryId: string): Promise<WebhookDeliveryLog> {
    const original = this.getDeliveryById(deliveryId);
    if (!original) {
      throw new AppError('Delivery log not found', 404);
    }

    const webhook = this.getWebhookById(original.webhookId);
    const targetWebhook: Pick<WebhookConfig, 'id' | 'name' | 'url' | 'method' | 'headers' | 'secret'> = webhook || {
      id: original.webhookId,
      name: original.webhookName,
      url: original.url,
      method: 'POST',
      headers: original.requestHeaders,
      secret: null,
    };

    const nextAttempt = (original.attempt || 1) + 1;
    return this.dispatch(targetWebhook, original.requestPayload, nextAttempt);
  }

  /**
   * Dispatches a live test event to verify the target webhook endpoint.
   */
  public async testWebhook(webhookId: string, customPayload?: any): Promise<WebhookDeliveryLog> {
    const webhook = this.getWebhookById(webhookId);
    if (!webhook) {
      throw new AppError('Webhook not found', 404);
    }

    const eventName = webhook.event !== '*' ? (webhook.event.includes('.') ? webhook.event : `${webhook.collection}.${webhook.event}`) : `${webhook.collection}.test`;

    const testPayload = customPayload || {
      event: eventName,
      collection: webhook.collection,
      action: 'test',
      record: {
        id: `test_${crypto.randomBytes(4).toString('hex')}`,
        title: 'NodeStack Webhook Verification',
        description: 'Verifying outbound webhook connectivity, headers, and secret signature.',
        status: 'verified',
        created: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };

    return this.dispatch(webhook, testPayload, 1);
  }

  // ==========================================
  // EventBus Lifecycle Hook Matching
  // ==========================================

  /**
   * Evaluates if a webhook matches a given collection and mutation event.
   * Handles formats:
   *  - collection: 'posts', event: 'post.created'
   *  - collection: 'orders', event: 'order.updated'
   *  - collection: '*', event: '*'
   */
  public matchesEvent(
    webhook: Pick<WebhookConfig, 'collection' | 'event' | 'action' | 'enabled'>,
    collection: string,
    action: 'created' | 'updated' | 'deleted'
  ): boolean {
    if (!webhook.enabled) return false;

    const colLower = collection.toLowerCase();
    const actLower = action.toLowerCase();
    const baseAction = actLower.replace(/ed$/, ''); // 'create', 'update', 'delete'

    // 1. Check Collection Match
    const webhookCol = webhook.collection.toLowerCase();
    let colMatches = webhookCol === '*' || webhookCol === colLower;
    if (!colMatches) {
      // Tolerate singular/plural differences (e.g. 'post' vs 'posts', 'order' vs 'orders')
      if (colLower.endsWith('s') && colLower.slice(0, -1) === webhookCol) {
        colMatches = true;
      } else if (webhookCol.endsWith('s') && webhookCol.slice(0, -1) === colLower) {
        colMatches = true;
      }
    }
    if (!colMatches) return false;

    // 2. Check Event/Action Match
    const webhookEvent = webhook.event.toLowerCase();
    if (webhookEvent === '*' || webhookEvent === '*.*') return true;

    // Direct action match (e.g. event = 'created' or 'create')
    if (webhookEvent === actLower || webhookEvent === baseAction) return true;

    // Composite event match (e.g. 'post.created', 'order.updated', 'posts.create')
    if (webhookEvent.includes('.')) {
      const [eCol, eAct] = webhookEvent.split('.');
      const eColMatches = eCol === '*' || eCol === colLower || (colLower.endsWith('s') && colLower.slice(0, -1) === eCol) || (eCol.endsWith('s') && eCol.slice(0, -1) === colLower);
      const eActMatches = eAct === '*' || eAct === actLower || eAct === baseAction;
      return eColMatches && eActMatches;
    }

    return false;
  }

  /**
   * Invoked automatically by EventBus when database mutations occur.
   */
  public async handleRecordEvent(
    action: 'create' | 'update' | 'delete',
    ctx: RecordAfterEventContext
  ): Promise<void> {
    try {
      if (!ctx || !ctx.collection) return;
      // Skip internal system collections
      if (ctx.collection.startsWith('_')) return;

      const normalizedAction: 'created' | 'updated' | 'deleted' =
        action === 'create' ? 'created' : action === 'update' ? 'updated' : 'deleted';

      const allWebhooks = this.getWebhooks({ enabled: true });
      const matchingWebhooks = allWebhooks.filter((w) =>
        this.matchesEvent(w, ctx.collection, normalizedAction)
      );

      if (matchingWebhooks.length === 0) return;

      const payload = {
        event: `${ctx.collection}.${normalizedAction}`,
        collection: ctx.collection,
        action: normalizedAction,
        record: ctx.record,
        previous: ctx.originalRecord || null,
        timestamp: new Date().toISOString(),
      };

      // Dispatch asynchronously without blocking caller
      for (const webhook of matchingWebhooks) {
        this.dispatch(webhook, payload).catch((err) => {
          console.error(`[WebhookService] Error dispatching webhook ${webhook.id}:`, err);
        });
      }
    } catch (err) {
      console.error('[WebhookService] Error in handleRecordEvent:', err);
    }
  }

  // ==========================================
  // Cryptographic Signature Utilities
  // ==========================================

  /**
   * Computes HMAC-SHA256 signature for X-NodeStack-Signature header.
   */
  public static computeSignature(payload: string | object, secret: string): string {
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex');
  }

  /**
   * Verifies an incoming X-NodeStack-Signature header against the expected secret.
   * Tolerates both raw 64-char hex strings and "sha256=" / "sha256:" prefixes.
   */
  public static verifySignature(
    payload: string | object,
    signatureHeader: string,
    secret: string
  ): boolean {
    if (!signatureHeader || !secret) return false;
    const expected = WebhookService.computeSignature(payload, secret);

    let cleanHeader = signatureHeader.trim();
    if (cleanHeader.startsWith('sha256=')) {
      cleanHeader = cleanHeader.substring(7);
    } else if (cleanHeader.startsWith('sha256:')) {
      cleanHeader = cleanHeader.substring(7);
    }

    try {
      const a = Buffer.from(cleanHeader, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // ==========================================
  // Helpers
  // ==========================================

  private mapWebhookRow(r: any): WebhookConfig {
    return {
      id: r.id,
      name: r.name,
      url: r.url,
      collection: r.collection,
      event: r.event,
      action: r.action,
      method: r.method,
      headers: this.safeParseJson(r.headers, {}),
      secret: r.secret || null,
      enabled: Boolean(r.enabled),
      created: r.created,
      updated: r.updated,
    };
  }

  private mapDeliveryRow(r: any): WebhookDeliveryLog {
    return {
      id: r.id,
      webhookId: r.webhookId,
      webhookName: r.webhookName,
      url: r.url,
      event: r.event,
      collection: r.collection,
      recordId: r.recordId || null,
      requestHeaders: this.safeParseJson(r.requestHeaders, {}),
      requestPayload: this.safeParseJson(r.requestPayload, r.requestPayload),
      responseStatus: r.responseStatus,
      responseHeaders: this.safeParseJson(r.responseHeaders, {}),
      responseBody: r.responseBody || '',
      durationMs: r.durationMs,
      status: r.status,
      error: r.error || null,
      attempt: r.attempt || 1,
      created: r.created,
    };
  }

  private safeParseJson<T>(raw: string, fallback: T): T {
    if (!raw || typeof raw !== 'string') return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
}
