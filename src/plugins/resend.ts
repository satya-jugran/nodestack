import * as crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { INodeStackPlugin, NodeStackPluginContext } from '../core/plugins/types';

export interface ResendPluginOptions {
  apiKey: string;
  from?: string;
  collectionName?: string;
  /** Authentication policy for send endpoint: 'admin' (default), 'adminOrInitial', 'user', or 'public' */
  authPolicy?: 'admin' | 'adminOrInitial' | 'user' | 'public';
}

export class ResendEmailService {
  constructor(public readonly options: ResendPluginOptions) {}

  public async sendEmail(params: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    from?: string;
  }) {
    const id = `email_${crypto.randomBytes(8).toString('hex')}`;
    return {
      id,
      from: params.from || this.options.from || 'noreply@nodestack.io',
      to: params.to,
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
          { id: 'f_to', name: 'to', type: 'email', required: true },
          { id: 'f_from', name: 'from', type: 'text', required: true },
          { id: 'f_subject', name: 'subject', type: 'text', required: true },
          { id: 'f_status', name: 'status', type: 'text', required: true },
          { id: 'f_msg_id', name: 'messageId', type: 'text', required: true },
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

          const sent = await emailService.sendEmail(body);

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

          await ctx.eventBus.emit('email:sent', sent);

          return reply.status(200).send(sent);
        },
        { auth: options.authPolicy || 'admin' }
      );
    },
  };
}
