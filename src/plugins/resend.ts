import * as crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { INodeStackPlugin, NodeStackPluginContext } from '../core/plugins/types';

export interface ResendPluginOptions {
  apiKey: string;
  from?: string;
  collectionName?: string;
  /** Authentication policy for send endpoint: 'admin' (default), 'adminOrInitial', 'user', or 'public' */
  authPolicy?: 'admin' | 'adminOrInitial' | 'user' | 'public';
  /** Optional custom base endpoint (defaults to https://api.resend.com) */
  endpoint?: string;
  /** Custom fetch implementation (defaults to globalThis.fetch) */
  fetch?: typeof fetch;
  /** Run in dry-run mode without making outbound network calls */
  dryRun?: boolean;
}

export interface ResendEmailResult {
  id: string;
  from: string;
  to: string;
  subject: string;
  status: 'sent' | 'delivered' | 'failed';
  createdAt: string;
  error?: string;
}

export class ResendEmailService {
  constructor(public readonly options: ResendPluginOptions) {}

  public getBaseUrl(): string {
    if (this.options.endpoint) {
      return this.options.endpoint.replace(/\/+$/, '');
    }
    return 'https://api.resend.com';
  }

  public async sendEmail(params: {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    from?: string;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
  }): Promise<ResendEmailResult> {
    const from = params.from || this.options.from || 'noreply@nodestack.io';
    const toList = Array.isArray(params.to) ? params.to : [params.to];
    const toStr = toList.join(', ');

    if (this.options.dryRun) {
      const id = `email_${crypto.randomBytes(8).toString('hex')}`;
      return {
        id,
        from,
        to: toStr,
        subject: params.subject,
        status: 'delivered',
        createdAt: new Date().toISOString(),
      };
    }

    const fetchFn = this.options.fetch || globalThis.fetch;
    if (!fetchFn) {
      throw new Error('[ResendEmailService] Global fetch is not available');
    }

    const url = `${this.getBaseUrl()}/emails`;
    const payload: any = {
      from,
      to: toList,
      subject: params.subject,
    };
    if (params.html) payload.html = params.html;
    if (params.text) payload.text = params.text;
    if (params.replyTo) payload.reply_to = params.replyTo;
    if (params.cc) payload.cc = Array.isArray(params.cc) ? params.cc : [params.cc];
    if (params.bcc) payload.bcc = Array.isArray(params.bcc) ? params.bcc : [params.bcc];

    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      const errMsg = errData?.message || (await res.text().catch(() => '')) || res.statusText;
      const error: any = new Error(`Resend API error (${res.status}): ${errMsg}`);
      error.status = res.status;
      error.response = errData;
      throw error;
    }

    const data: any = await res.json().catch(() => ({}));
    const id = data?.id || `email_${crypto.randomBytes(8).toString('hex')}`;

    return {
      id,
      from,
      to: toStr,
      subject: params.subject,
      status: 'delivered',
      createdAt: new Date().toISOString(),
    };
  }
}

export function resendPlugin(options: ResendPluginOptions): INodeStackPlugin {
  if (!options || !options.apiKey) {
    throw new Error('[resendPlugin] Missing required option: apiKey');
  }

  const emailService = new ResendEmailService(options);
  const collectionName = options.collectionName || '_email_logs';

  return {
    name: 'resend',
    version: '1.0.0',
    description: 'Resend transactional email delivery service & dispatch logs',

    collections: [
      {
        name: collectionName,
        type: 'base',
        system: true,
        schema: [
          { id: 'f_to', name: 'to', type: 'text', required: true },
          { id: 'f_from', name: 'from', type: 'text', required: true },
          { id: 'f_subject', name: 'subject', type: 'text', required: true },
          { id: 'f_status', name: 'status', type: 'text', required: true },
          { id: 'f_msg_id', name: 'messageId', type: 'text', required: true },
          { id: 'f_error', name: 'error', type: 'text', required: false },
        ],
      },
    ],

    adminNavItems: [
      {
        id: 'resend-email',
        title: 'Email Delivery',
        badge: 'ACTIVE',
        badgeVariant: 'success',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
        view: {
          title: 'Resend Email Service',
          description: `Configured with default sender "${options.from || 'noreply@nodestack.io'}"`,
        },
      },
    ],

    register(ctx: NodeStackPluginContext) {
      // 1. Bind service into container
      ctx.bindService(Symbol.for('ResendEmailService'), emailService);

      // 2. Register custom endpoints
      ctx.registerRoute('GET', '/api/resend/status', async (_req, reply) => {
        return reply.send({
          configured: true,
          from: options.from || 'noreply@nodestack.io',
          collection: collectionName,
          endpoint: emailService.getBaseUrl(),
        });
      });

      ctx.registerRoute(
        'POST',
        '/api/resend/send',
        async (req: FastifyRequest, reply: FastifyReply) => {
          const body = (req.body as any) || {};
          if (!body.to || !body.subject) {
            return reply.status(400).send({
              statusCode: 400,
              message: 'to and subject are required to send an email',
            });
          }

          const from = body.from || options.from || 'noreply@nodestack.io';
          const toStr = Array.isArray(body.to) ? body.to.join(', ') : String(body.to);

          try {
            const sent = await emailService.sendEmail(body);

            // Persist successful delivery
            try {
              await ctx.app.records.create(collectionName, {
                to: sent.to,
                from: sent.from,
                subject: sent.subject,
                status: sent.status,
                messageId: sent.id,
              });
            } catch (e: any) {
              // non-fatal
            }

            // Emit delivery event only after a successful response
            await ctx.eventBus.emit('email:sent', sent);

            return reply.status(200).send(sent);
          } catch (err: any) {
            const errorMsg = err.message || 'Failed to send email via Resend';
            const failedRecord = {
              id: `email_${crypto.randomBytes(8).toString('hex')}`,
              from,
              to: toStr,
              subject: body.subject,
              status: 'failed',
              createdAt: new Date().toISOString(),
              error: errorMsg,
            };

            // Persist failed attempt to logs
            try {
              await ctx.app.records.create(collectionName, {
                to: failedRecord.to,
                from: failedRecord.from,
                subject: failedRecord.subject,
                status: 'failed',
                messageId: failedRecord.id,
                error: errorMsg,
              });
            } catch {
              // non-fatal
            }

            // Emit failure event
            await ctx.eventBus.emit('email:failed', failedRecord);

            const statusCode =
              typeof err.status === 'number' && err.status >= 400 && err.status < 600
                ? err.status
                : 502;

            return reply.status(statusCode).send({
              statusCode,
              message: errorMsg,
              details: failedRecord,
            });
          }
        },
        { auth: options.authPolicy || 'admin' }
      );
    },
  };
}
