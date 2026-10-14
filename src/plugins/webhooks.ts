import * as crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { INodeStackPlugin, NodeStackPluginContext } from '../core/plugins/types';

export interface WebhookPluginOptions {
  discordWebhookUrl?: string;
  slackWebhookUrl?: string;
  collections?: string[];
  events?: Array<'create' | 'update' | 'delete'>;
  collectionName?: string;
  /** Authentication policy for action routes (e.g., /api/webhooks/test): 'admin' (default), 'adminOrInitial', 'user', or 'public' */
  authPolicy?: 'admin' | 'adminOrInitial' | 'user' | 'public';
  /** Custom fetch implementation (defaults to globalThis.fetch) */
  fetch?: typeof fetch;
  /** Run in dry-run mode without making outbound network calls */
  dryRun?: boolean;
}

export interface WebhookDispatchResult {
  id: string;
  platform: 'discord' | 'slack';
  payload: any;
  status: 'dispatched' | 'failed';
  statusCode?: number;
  error?: string;
  timestamp: string;
}

export class WebhookNotificationService {
  public dispatched: WebhookDispatchResult[] = [];

  constructor(public readonly options: WebhookPluginOptions) {}

  public getWebhookUrl(platform: 'discord' | 'slack'): string | undefined {
    if (platform === 'discord') {
      return this.options.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL;
    }
    return this.options.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL;
  }

  public formatPayload(platform: 'discord' | 'slack', payload: any): Record<string, any> {
    if (typeof payload === 'string') {
      return platform === 'discord' ? { content: payload } : { text: payload };
    }

    const titleOrName = payload?.record?.title || payload?.record?.name || payload?.record?.subject;
    const summary = titleOrName ? ` - "${titleOrName}"` : '';

    if (platform === 'discord') {
      // If caller provided explicit Discord message formatting (content or embeds)
      if (payload && (payload.content !== undefined || payload.embeds !== undefined)) {
        return payload;
      }
      const message =
        payload.message ||
        `**[NodeStack]** Event \`${payload.event || 'mutation'}\` on collection \`${payload.collection || 'unknown'}\`${
          payload.recordId ? ` (Record ID: \`${payload.recordId}\`)` : ''
        }${summary}`;
      return {
        content: message,
      };
    } else {
      // If caller provided explicit Slack formatting (text, blocks, or attachments)
      if (payload && (payload.text !== undefined || payload.blocks !== undefined || payload.attachments !== undefined)) {
        return payload;
      }
      const text =
        payload.message ||
        `*[NodeStack]* Event \`${payload.event || 'mutation'}\` on collection \`${payload.collection || 'unknown'}\`${
          payload.recordId ? ` (Record ID: \`${payload.recordId}\`)` : ''
        }${summary}`;
      return {
        text,
      };
    }
  }

  public async dispatch(
    platform: 'discord' | 'slack',
    payload: any,
    customUrl?: string
  ): Promise<WebhookDispatchResult> {
    const id = `wh_${crypto.randomBytes(6).toString('hex')}`;
    const timestamp = new Date().toISOString();
    const targetUrl = customUrl || this.getWebhookUrl(platform);

    if (!targetUrl) {
      const failedEntry: WebhookDispatchResult = {
        id,
        platform,
        payload,
        status: 'failed',
        error: `No webhook URL configured for platform "${platform}"`,
        timestamp,
      };
      this.dispatched.push(failedEntry);
      return failedEntry;
    }

    if (this.options.dryRun) {
      const entry: WebhookDispatchResult = {
        id,
        platform,
        payload,
        status: 'dispatched',
        statusCode: 200,
        timestamp,
      };
      this.dispatched.push(entry);
      return entry;
    }

    const fetchFn = this.options.fetch || globalThis.fetch;
    if (!fetchFn) {
      const failedEntry: WebhookDispatchResult = {
        id,
        platform,
        payload,
        status: 'failed',
        error: 'Global fetch is not available and no custom fetch was provided',
        timestamp,
      };
      this.dispatched.push(failedEntry);
      return failedEntry;
    }

    const bodyObj = this.formatPayload(platform, payload);

    try {
      const res = await fetchFn(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyObj),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const failedEntry: WebhookDispatchResult = {
          id,
          platform,
          payload,
          status: 'failed',
          statusCode: res.status,
          error: `Webhook HTTP ${res.status}: ${errText || res.statusText}`,
          timestamp,
        };
        this.dispatched.push(failedEntry);
        return failedEntry;
      }

      const successEntry: WebhookDispatchResult = {
        id,
        platform,
        payload,
        status: 'dispatched',
        statusCode: res.status,
        timestamp,
      };
      this.dispatched.push(successEntry);
      return successEntry;
    } catch (err: any) {
      const failedEntry: WebhookDispatchResult = {
        id,
        platform,
        payload,
        status: 'failed',
        error: err.message || String(err),
        timestamp,
      };
      this.dispatched.push(failedEntry);
      return failedEntry;
    }
  }
}

export function webhookPlugin(options: WebhookPluginOptions = {}): INodeStackPlugin {
  const webhookService = new WebhookNotificationService(options);
  const collectionName = options.collectionName || '_webhook_logs';
  const listenedEvents = options.events || ['create', 'update', 'delete'];
  const monitoredCollections = options.collections || [];

  return {
    name: 'webhooks',
    version: '1.0.0',
    description: 'Realtime Discord & Slack webhook notifications on database mutations',

    collections: [
      {
        name: collectionName,
        type: 'base',
        system: true,
        schema: [
          { id: 'f_target', name: 'platform', type: 'text', required: true },
          { id: 'f_event', name: 'event', type: 'text', required: true },
          { id: 'f_col', name: 'collection', type: 'text', required: true },
          { id: 'f_rec_id', name: 'recordId', type: 'text', required: false },
          { id: 'f_status', name: 'status', type: 'text', required: true },
          { id: 'f_status_code', name: 'statusCode', type: 'number', required: false },
          { id: 'f_error', name: 'error', type: 'text', required: false },
        ],
      },
    ],

    adminNavItems: [
      {
        id: 'webhooks',
        title: 'Webhooks',
        badge: (options.discordWebhookUrl || options.slackWebhookUrl || process.env.DISCORD_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL) ? 'CONFIGURED' : 'READY',
        badgeVariant: 'primary',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
        view: {
          title: 'Discord & Slack Webhook Feeds',
          description: `Broadcasting database mutation events for collections: ${monitoredCollections.length ? monitoredCollections.join(', ') : 'All collections'}`,
        },
      },
    ],

    register(ctx: NodeStackPluginContext) {
      // 1. Bind service into container
      ctx.bindService(Symbol.for('WebhookNotificationService'), webhookService);

      // Helper to log and dispatch
      const handleMutation = async (event: string, e: any) => {
        if (monitoredCollections.length > 0 && !monitoredCollections.includes(e.collection)) {
          return;
        }
        if (e.collection.startsWith('_')) {
          // ignore internal system tables by default
          return;
        }

        const payload = {
          event,
          collection: e.collection,
          recordId: e.record?.id,
          record: e.record,
          timestamp: new Date().toISOString(),
        };

        const platforms: Array<'discord' | 'slack'> = [];
        if (options.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL) {
          platforms.push('discord');
        }
        if (options.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL) {
          platforms.push('slack');
        }

        for (const platform of platforms) {
          const result = await webhookService.dispatch(platform, payload);

          try {
            await ctx.app.records.create(collectionName, {
              platform,
              event,
              collection: e.collection,
              recordId: e.record?.id || '',
              status: result.status,
              statusCode: result.statusCode,
              error: result.error || '',
            });
          } catch (err: any) {
            // non-fatal
          }

          if (result.status === 'dispatched') {
            await ctx.eventBus.emit('webhook:dispatched', {
              platform,
              event,
              collection: e.collection,
              recordId: e.record?.id,
              result,
            });
          } else {
            await ctx.eventBus.emit('webhook:failed', {
              platform,
              event,
              collection: e.collection,
              recordId: e.record?.id,
              result,
            });
          }
        }
      };

      // 2. Lifecycle hooks
      if (listenedEvents.includes('create')) {
        ctx.registerHook('afterCreate', (e: any) => handleMutation('record:created', e));
      }
      if (listenedEvents.includes('update')) {
        ctx.registerHook('afterUpdate', (e: any) => handleMutation('record:updated', e));
      }
      if (listenedEvents.includes('delete')) {
        ctx.registerHook('afterDelete', (e: any) => handleMutation('record:deleted', e));
      }

      // 3. REST endpoints
      ctx.registerRoute('GET', '/api/webhooks/status', async (_req, reply) => {
        return reply.send({
          hasDiscord: Boolean(options.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL),
          hasSlack: Boolean(options.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL),
          monitoredCollections,
          listenedEvents,
          dispatchedCount: webhookService.dispatched.filter((d) => d.status === 'dispatched').length,
          failedCount: webhookService.dispatched.filter((d) => d.status === 'failed').length,
          totalCount: webhookService.dispatched.length,
        });
      });

      ctx.registerRoute(
        'POST',
        '/api/webhooks/test',
        async (req: FastifyRequest, reply: FastifyReply) => {
          const body = (req.body as any) || {};
          const platform = body.platform === 'slack' ? 'slack' : 'discord';
          const entry = await webhookService.dispatch(
            platform,
            body.payload || { message: body.message || 'Test webhook from NodeStack' },
            body.url
          );

          try {
            await ctx.app.records.create(collectionName, {
              platform,
              event: 'manual:test',
              collection: '_manual',
              recordId: entry.id,
              status: entry.status,
              statusCode: entry.statusCode,
              error: entry.error || '',
            });
          } catch {
            // non-fatal
          }

          if (entry.status === 'failed') {
            const statusCode =
              entry.statusCode && entry.statusCode >= 400 && entry.statusCode < 600
                ? entry.statusCode
                : 502;
            return reply.status(statusCode).send(entry);
          }

          return reply.status(200).send(entry);
        },
        { auth: options.authPolicy || 'admin' }
      );
    },
  };
}
