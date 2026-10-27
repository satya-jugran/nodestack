import * as crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { INodeStackPlugin, NodeStackPluginContext, AdminNavItem } from '../core/plugins/types';

export interface ChatNotificationsPluginOptions {
  discordWebhookUrl?: string;
  slackWebhookUrl?: string;
  /** Whether notifications to Discord are enabled (default: true) */
  enableDiscord?: boolean;
  /** Whether notifications to Slack are enabled (default: true) */
  enableSlack?: boolean;
  collections?: string[];
  events?: Array<'create' | 'update' | 'delete'>;
  collectionName?: string;
  /** Authentication policy for action routes (e.g., /api/chat-notifications/test): 'admin' (default), 'adminOrInitial', 'user', or 'public' */
  authPolicy?: 'admin' | 'adminOrInitial' | 'user' | 'public';
  /** Custom fetch implementation (defaults to globalThis.fetch) */
  fetch?: typeof fetch;
  /** Run in dry-run mode without making outbound network calls */
  dryRun?: boolean;
}

/** Deprecated alias for ChatNotificationsPluginOptions */
export type WebhookPluginOptions = ChatNotificationsPluginOptions;

export interface ChatNotificationResult {
  id: string;
  platform: 'discord' | 'slack';
  payload: any;
  status: 'dispatched' | 'failed';
  statusCode?: number;
  error?: string;
  timestamp: string;
}

/** Deprecated alias for ChatNotificationResult */
export type WebhookDispatchResult = ChatNotificationResult;

export class ChatNotificationService {
  public dispatched: ChatNotificationResult[] = [];
  public options: ChatNotificationsPluginOptions;

  constructor(options: ChatNotificationsPluginOptions = {}) {
    this.options = {
      enableDiscord: true,
      enableSlack: true,
      ...options,
    };
  }

  public updateOptions(newOpts: Partial<ChatNotificationsPluginOptions>): void {
    this.options = { ...this.options, ...newOpts };
  }

  public getWebhookUrl(platform: 'discord' | 'slack'): string | undefined {
    if (platform === 'discord') {
      return this.options.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL;
    }
    return this.options.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL;
  }

  public isPlatformEnabled(platform: 'discord' | 'slack'): boolean {
    if (platform === 'discord') {
      const enabled = this.options.enableDiscord !== false;
      return enabled && Boolean(this.getWebhookUrl('discord'));
    }
    const enabled = this.options.enableSlack !== false;
    return enabled && Boolean(this.getWebhookUrl('slack'));
  }

  public getActivePlatforms(): Array<'discord' | 'slack'> {
    const platforms: Array<'discord' | 'slack'> = [];
    if (this.isPlatformEnabled('discord')) {
      platforms.push('discord');
    }
    if (this.isPlatformEnabled('slack')) {
      platforms.push('slack');
    }
    return platforms;
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
  ): Promise<ChatNotificationResult> {
    const id = `cn_${crypto.randomBytes(6).toString('hex')}`;
    const timestamp = new Date().toISOString();
    const targetUrl = customUrl || this.getWebhookUrl(platform);

    const isExplicitlyDisabled =
      platform === 'discord'
        ? this.options.enableDiscord === false
        : this.options.enableSlack === false;

    if (isExplicitlyDisabled && !customUrl) {
      const disabledEntry: ChatNotificationResult = {
        id,
        platform,
        payload,
        status: 'failed',
        error: `Notifications for "${platform}" are currently disabled in settings`,
        timestamp,
      };
      this.dispatched.push(disabledEntry);
      return disabledEntry;
    }

    if (!targetUrl) {
      const failedEntry: ChatNotificationResult = {
        id,
        platform,
        payload,
        status: 'failed',
        error: `No chat notification URL configured for platform "${platform}"`,
        timestamp,
      };
      this.dispatched.push(failedEntry);
      return failedEntry;
    }

    if (this.options.dryRun) {
      const entry: ChatNotificationResult = {
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
      const failedEntry: ChatNotificationResult = {
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
        const failedEntry: ChatNotificationResult = {
          id,
          platform,
          payload,
          status: 'failed',
          statusCode: res.status,
          error: `Chat Notification HTTP ${res.status}: ${errText || res.statusText}`,
          timestamp,
        };
        this.dispatched.push(failedEntry);
        return failedEntry;
      }

      const successEntry: ChatNotificationResult = {
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
      const failedEntry: ChatNotificationResult = {
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

/** Deprecated alias for ChatNotificationService */
export const WebhookNotificationService = ChatNotificationService;
export type WebhookNotificationService = ChatNotificationService;

export function chatNotificationsPlugin(options: ChatNotificationsPluginOptions = {}): INodeStackPlugin {
  const chatService = new ChatNotificationService(options);
  const collectionName = options.collectionName || '_chat_notification_logs';
  const listenedEvents = options.events || ['create', 'update', 'delete'];
  const monitoredCollections = options.collections || [];
  let currentContext: NodeStackPluginContext | null = null;

  const isConfigured = () => chatService.getActivePlatforms().length > 0;

  const chatIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

  const navItem: AdminNavItem = {
    id: 'chat-notifications',
    title: 'Chat Notifications',
    badge: isConfigured() ? 'CONFIGURED' : 'READY',
    badgeVariant: 'primary',
    icon: chatIconSvg,
    view: {
      title: 'Discord & Slack Chat Notifications',
      description: `Broadcasting database mutation events for collections: ${monitoredCollections.length ? monitoredCollections.join(', ') : 'All collections'}`,
    },
  };

  return {
    name: 'chat-notifications',
    version: '2.0.0',
    description: 'Realtime Discord & Slack chat notifications on database mutations',

    codeOptions: { ...(options || {}) },
    buildAdminNavItems(cfg: Record<string, any>) {
      const discordEnabled = cfg.enableDiscord !== undefined ? cfg.enableDiscord : (options?.enableDiscord !== false);
      const slackEnabled = cfg.enableSlack !== undefined ? cfg.enableSlack : (options?.enableSlack !== false);

      const hasDiscord = Boolean(cfg.discordWebhookUrl || options?.discordWebhookUrl) && discordEnabled;
      const hasSlack = Boolean(cfg.slackWebhookUrl || options?.slackWebhookUrl) && slackEnabled;
      const hasConfig = hasDiscord || hasSlack;

      return [{
        id: 'chat-notifications',
        title: 'Chat Notifications',
        badge: hasConfig ? 'CONFIGURED' : 'READY',
        badgeVariant: 'primary',
        icon: chatIconSvg,
        view: {
          title: 'Discord & Slack Chat Notifications',
          description: `Broadcasting database mutation events for collections: ${monitoredCollections.length ? monitoredCollections.join(', ') : 'All collections'}`,
        },
      }];
    },
    configSchema: {
      fields: [
        {
          name: 'discordWebhookUrl',
          label: 'Discord Webhook URL',
          type: 'text',
          envKey: 'DISCORD_WEBHOOK_URL',
          placeholder: 'https://discord.com/api/webhooks/...',
          description: 'Discord channel incoming webhook URL for activity dispatch',
        },
        {
          name: 'enableDiscord',
          label: 'Enable Discord Notifications',
          type: 'boolean',
          defaultValue: true,
          description: 'Deliver database mutation activity alerts to Discord channel',
        },
        {
          name: 'slackWebhookUrl',
          label: 'Slack Webhook URL',
          type: 'text',
          envKey: 'SLACK_WEBHOOK_URL',
          placeholder: 'https://hooks.slack.com/services/...',
          description: 'Slack incoming webhook URL for activity dispatch',
        },
        {
          name: 'enableSlack',
          label: 'Enable Slack Notifications',
          type: 'boolean',
          defaultValue: true,
          description: 'Deliver database mutation activity alerts to Slack channel',
        },
        {
          name: 'dryRun',
          label: 'Dry Run Simulation',
          type: 'boolean',
          defaultValue: false,
          description: 'Audit notifications to SQLite log table without making outbound HTTP calls',
        },
      ],
    },
    onConfigUpdate(newConfig) {
      chatService.updateOptions(newConfig);
      navItem.badge = isConfigured() ? 'CONFIGURED' : 'READY';
      if (currentContext) {
        currentContext.registerAdminNav(navItem);
      }
    },

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

    adminNavItems: [navItem],

    register(ctx: NodeStackPluginContext) {
      currentContext = ctx;
      // 1. Bind service into container (both new and legacy token)
      ctx.bindService(Symbol.for('ChatNotificationService'), chatService);
      ctx.bindService(Symbol.for('WebhookNotificationService'), chatService);

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

        const platforms = chatService.getActivePlatforms();

        for (const platform of platforms) {
          const result = await chatService.dispatch(platform, payload);

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

          const eventPayload = {
            platform,
            event,
            collection: e.collection,
            recordId: e.record?.id,
            result,
          };

          if (result.status === 'dispatched') {
            await ctx.eventBus.emit('chat:dispatched', eventPayload);
            await ctx.eventBus.emit('webhook:dispatched', eventPayload);
          } else {
            await ctx.eventBus.emit('chat:failed', eventPayload);
            await ctx.eventBus.emit('webhook:failed', eventPayload);
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

      const getScopedService = (req: FastifyRequest) => {
        const targetDb = (req as any).appScope?.db;
        const records = (req as any).appScope?.records || ctx.app.records;
        if (!targetDb || targetDb === ctx.app.db || !(ctx.app.plugins as any)?.getEffectiveConfig) {
          return { service: chatService, records };
        }
        const appConfig =
          (ctx.app.plugins as any).getEffectiveConfig('chat-notifications', targetDb) ||
          (ctx.app.plugins as any).getEffectiveConfig('webhooks', targetDb);
        const scopedService = new ChatNotificationService({
          ...options,
          ...appConfig,
        });
        return { service: scopedService, records };
      };

      // Handler for status
      const statusHandler = async (req: FastifyRequest, reply: FastifyReply) => {
        const { service: activeService, records } = getScopedService(req);
        let dispatchedCount = activeService.dispatched.filter((d: any) => d.status === 'dispatched').length;
        let failedCount = activeService.dispatched.filter((d: any) => d.status === 'failed').length;
        let totalCount = activeService.dispatched.length;

        // If scoped to a non-default app, check the app's durable log collection
        if ((req as any).appScope?.db && (req as any).appScope?.db !== ctx.app.db) {
          try {
            const logs = await records.getList(collectionName, { limit: 500 });
            dispatchedCount = logs.items.filter((l: any) => l.status === 'dispatched').length;
            failedCount = logs.items.filter((l: any) => l.status === 'failed').length;
            totalCount = logs.items.length;
          } catch {
            // collection might not exist yet
          }
        }

        return reply.send({
          hasDiscord: Boolean(activeService.getWebhookUrl('discord')),
          hasSlack: Boolean(activeService.getWebhookUrl('slack')),
          enableDiscord: activeService.options.enableDiscord !== false,
          enableSlack: activeService.options.enableSlack !== false,
          discordActive: activeService.isPlatformEnabled('discord'),
          slackActive: activeService.isPlatformEnabled('slack'),
          monitoredCollections,
          listenedEvents,
          dispatchedCount,
          failedCount,
          totalCount,
        });
      };

      // Handler for test
      const testHandler = async (req: FastifyRequest, reply: FastifyReply) => {
        const { service: activeService, records } = getScopedService(req);
        const body = (req.body as any) || {};
        const platform = body.platform === 'slack' ? 'slack' : 'discord';
        const entry = await activeService.dispatch(
          platform,
          body.payload || { message: body.message || 'Test notification from NodeStack' },
          body.url
        );

        try {
          await records.create(collectionName, {
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
      };

      // 3. REST endpoints (both official and legacy paths)
      ctx.registerRoute('GET', '/api/chat-notifications/status', statusHandler);
      ctx.registerRoute('GET', '/api/webhooks/status', statusHandler);

      const routeOptions = { auth: options.authPolicy || 'admin' };
      ctx.registerRoute('POST', '/api/chat-notifications/test', testHandler, routeOptions);
      ctx.registerRoute('POST', '/api/webhooks/test', testHandler, routeOptions);
    },
    onDestroy() {
      currentContext = null;
    },
  };
}

/** Convenience alias for chatNotificationsPlugin */
export const chatPlugin = chatNotificationsPlugin;

/** Backwards-compatible alias for webhookPlugin */
export function webhookPlugin(options: WebhookPluginOptions = {}): INodeStackPlugin {
  return chatNotificationsPlugin({
    collectionName: options.collectionName || '_webhook_logs',
    ...options,
  });
}
