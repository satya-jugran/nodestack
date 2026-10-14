import * as crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { INodeStackPlugin, NodeStackPluginContext } from '../core/plugins/types';

export interface WebhookPluginOptions {
  discordWebhookUrl?: string;
  slackWebhookUrl?: string;
  collections?: string[];
  events?: Array<'create' | 'update' | 'delete'>;
  collectionName?: string;
}

export class WebhookNotificationService {
  public dispatched: Array<{ platform: string; payload: any; timestamp: string }> = [];

  constructor(public readonly options: WebhookPluginOptions) {}

  public async dispatch(platform: 'discord' | 'slack', payload: any) {
    const entry = {
      id: `wh_${crypto.randomBytes(6).toString('hex')}`,
      platform,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.dispatched.push(entry);
    return entry;
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
        ],
      },
    ],

    adminNavItems: [
      {
        id: 'webhooks',
        title: 'Webhooks',
        badge: (options.discordWebhookUrl || options.slackWebhookUrl) ? 'CONFIGURED' : 'READY',
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
          timestamp: new Date().toISOString(),
        };

        if (options.discordWebhookUrl) {
          await webhookService.dispatch('discord', payload);
        }
        if (options.slackWebhookUrl) {
          await webhookService.dispatch('slack', payload);
        }

        try {
          await ctx.app.records.create(collectionName, {
            platform: options.discordWebhookUrl ? 'discord' : 'slack',
            event,
            collection: e.collection,
            recordId: e.record?.id || '',
            status: 'dispatched',
          });
        } catch (err: any) {
          // non-fatal
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
          hasDiscord: Boolean(options.discordWebhookUrl),
          hasSlack: Boolean(options.slackWebhookUrl),
          monitoredCollections,
          listenedEvents,
          dispatchedCount: webhookService.dispatched.length,
        });
      });

      ctx.registerRoute('POST', '/api/webhooks/test', async (req: FastifyRequest, reply: FastifyReply) => {
        const body = (req.body as any) || {};
        const platform = body.platform === 'slack' ? 'slack' : 'discord';
        const entry = await webhookService.dispatch(platform, { message: body.message || 'Test webhook from NodeStack' });
        return reply.status(200).send(entry);
      });
    },
  };
}
