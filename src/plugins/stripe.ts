import * as crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { INodeStackPlugin, NodeStackPluginContext } from '../core/plugins/types';

export interface StripePluginOptions {
  secretKey?: string;
  webhookSecret?: string;
  currency?: string;
  customersCollection?: string;
  paymentsCollection?: string;
  /** Optional custom base endpoint (defaults to https://api.stripe.com) */
  endpoint?: string;
  /** Custom fetch implementation (defaults to globalThis.fetch) */
  fetch?: typeof fetch;
  /** Run in dry-run mode without making outbound network calls */
  dryRun?: boolean;
}

export interface StripeCheckoutSessionResult {
  id: string;
  url: string;
  amount: number;
  currency: string;
  customerEmail: string;
  status?: string;
  livemode?: boolean;
}

export class StripeService {
  public options: StripePluginOptions;

  constructor(options: StripePluginOptions = {}) {
    this.options = { ...options };
  }

  public updateOptions(newOpts: Partial<StripePluginOptions>): void {
    this.options = { ...this.options, ...newOpts };
  }

  public isTestMode(): boolean {
    return (this.options.secretKey || '').startsWith('sk_test_');
  }

  public getBaseUrl(): string {
    if (this.options.endpoint) {
      return this.options.endpoint.replace(/\/+$/, '');
    }
    return 'https://api.stripe.com';
  }

  public async createCheckoutSession(params: {
    email: string;
    amount: number;
    currency?: string;
    customerId?: string;
    successUrl?: string;
    cancelUrl?: string;
    productName?: string;
  }): Promise<StripeCheckoutSessionResult> {
    const currency = (params.currency || this.options.currency || 'usd').toLowerCase();
    const isTest = this.isTestMode();

    if (this.options.dryRun) {
      const prefix = isTest ? 'cs_test_' : 'cs_live_';
      const id = `${prefix}${crypto.randomBytes(12).toString('hex')}`;
      return {
        id,
        url: `https://checkout.stripe.com/pay/${id}`,
        amount: params.amount,
        currency,
        customerEmail: params.email,
        status: 'open',
        livemode: !isTest,
      };
    }

    const fetchFn = this.options.fetch || globalThis.fetch;
    if (!fetchFn) {
      throw new Error('[StripeService] Global fetch is not available');
    }

    const url = `${this.getBaseUrl()}/v1/checkout/sessions`;

    // Stripe API uses application/x-www-form-urlencoded
    const form = new URLSearchParams();
    form.append('mode', 'payment');
    form.append(
      'success_url',
      params.successUrl || 'https://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}'
    );
    form.append('cancel_url', params.cancelUrl || 'https://localhost:3000/cancel');
    if (params.email) {
      form.append('customer_email', params.email);
    }
    if (params.customerId) {
      form.append('customer', params.customerId);
    }
    form.append('line_items[0][price_data][currency]', currency);
    form.append('line_items[0][price_data][unit_amount]', String(Math.round(params.amount)));
    form.append(
      'line_items[0][price_data][product_data][name]',
      params.productName || 'Payment'
    );
    form.append('line_items[0][quantity]', '1');

    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.options.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      const errMsg =
        errData?.error?.message || (await res.text().catch(() => '')) || res.statusText;
      const error: any = new Error(`Stripe API error (${res.status}): ${errMsg}`);
      error.status = res.status;
      error.response = errData;
      throw error;
    }

    const data: any = await res.json();
    return {
      id: data.id,
      url: data.url || `https://checkout.stripe.com/pay/${data.id}`,
      amount: typeof data.amount_total === 'number' ? data.amount_total : params.amount,
      currency: data.currency || currency,
      customerEmail: data.customer_email || params.email,
      status: data.status || 'open',
      livemode: Boolean(data.livemode),
    };
  }

  public verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string,
    secret?: string,
    toleranceSeconds: number = 300
  ): boolean {
    const webhookSecret = secret || this.options.webhookSecret;
    if (!webhookSecret || !signatureHeader) {
      return false;
    }

    const parts = signatureHeader.split(',');
    let timestamp: number | null = null;
    const signatures: string[] = [];

    for (const part of parts) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();

      if (key === 't') {
        timestamp = parseInt(val, 10);
      } else if (key === 'v1' && val) {
        signatures.push(val);
      }
    }

    if (!timestamp || signatures.length === 0 || isNaN(timestamp)) {
      return false;
    }

    if (toleranceSeconds > 0) {
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > toleranceSeconds) {
        return false;
      }
    }

    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const signedPayload = `${timestamp}.${bodyStr}`;

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(signedPayload, 'utf8')
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    for (const sig of signatures) {
      const sigBuffer = Buffer.from(sig, 'utf8');
      if (
        sigBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(sigBuffer, expectedBuffer)
      ) {
        return true;
      }
    }

    return false;
  }

  public generateWebhookSignature(
    rawBody: string | Buffer,
    secret?: string,
    timestamp?: number
  ): string {
    const webhookSecret = secret || this.options.webhookSecret;
    if (!webhookSecret) {
      throw new Error('[StripeService] webhookSecret is required to generate a signature');
    }

    const t = timestamp || Math.floor(Date.now() / 1000);
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const signedPayload = `${t}.${bodyStr}`;

    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(signedPayload, 'utf8')
      .digest('hex');

    return `t=${t},v1=${signature}`;
  }
}

export function stripePlugin(options: StripePluginOptions = {}): INodeStackPlugin {
  const secretKey = options?.secretKey || process.env.STRIPE_SECRET_KEY || '';
  const customersCol = options?.customersCollection || '_stripe_customers';
  const paymentsCol = options?.paymentsCollection || '_stripe_payments';
  const stripeService = new StripeService({ ...options, secretKey });
  const isTest = stripeService.isTestMode();

  return {
    name: 'stripe',
    version: '1.0.0',
    description: 'Stripe payments, checkout sessions, customer billing & webhook events',

    codeOptions: { ...(options || {}) },
    configSchema: {
      fields: [
        {
          name: 'secretKey',
          label: 'Stripe Secret Key',
          type: 'password',
          envKey: 'STRIPE_SECRET_KEY',
          placeholder: 'sk_test_... or sk_live_...',
          description: 'Used for Stripe Checkout sessions and payment processing',
          required: true,
        },
        {
          name: 'webhookSecret',
          label: 'Webhook Signing Secret',
          type: 'password',
          envKey: 'STRIPE_WEBHOOK_SECRET',
          placeholder: 'whsec_...',
          description: 'Used to verify incoming Stripe webhook event signatures',
        },
        {
          name: 'currency',
          label: 'Default Currency',
          type: 'text',
          envKey: 'STRIPE_CURRENCY',
          defaultValue: 'usd',
          placeholder: 'usd',
          description: 'Standard 3-letter ISO currency code (usd, eur, gbp, etc.)',
        },
        {
          name: 'endpoint',
          label: 'Custom API Endpoint',
          type: 'text',
          envKey: 'STRIPE_ENDPOINT',
          placeholder: 'https://api.stripe.com',
          description: 'Custom Stripe base endpoint for proxies or local mocks',
        },
        {
          name: 'dryRun',
          label: 'Dry Run Simulation',
          type: 'boolean',
          defaultValue: false,
          description: 'Simulate checkout sessions without calling Stripe live API',
        },
      ],
    },
    onConfigUpdate(newConfig) {
      stripeService.updateOptions(newConfig);
    },

    collections: [
      {
        name: customersCol,
        type: 'base',
        system: true,
        schema: [
          { id: 'f_cust_id', name: 'customerId', type: 'text', required: true, unique: true },
          { id: 'f_email', name: 'email', type: 'email', required: true },
          { id: 'f_user_id', name: 'userId', type: 'text', required: false },
          { id: 'f_sub_id', name: 'subscriptionId', type: 'text', required: false },
          { id: 'f_sub_status', name: 'subscriptionStatus', type: 'text', required: false },
          { id: 'f_plan', name: 'plan', type: 'text', required: false },
        ],
      },
      {
        name: paymentsCol,
        type: 'base',
        system: true,
        schema: [
          { id: 'f_pi_id', name: 'paymentIntentId', type: 'text', required: true, unique: true },
          { id: 'f_cust_ref', name: 'customerId', type: 'text', required: false },
          { id: 'f_amount', name: 'amount', type: 'number', required: true },
          { id: 'f_curr', name: 'currency', type: 'text', required: false, defaultValue: 'usd' },
          { id: 'f_status', name: 'status', type: 'text', required: true },
        ],
      },
    ],

    adminNavItems: [
      {
        id: 'stripe',
        title: 'Stripe Payments',
        badge: isTest ? 'TEST MODE' : 'LIVE',
        badgeVariant: isTest ? 'warning' : 'success',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
        view: {
          title: 'Stripe Payments Dashboard',
          description: `Configured in ${isTest ? 'Test Mode' : 'Live Mode'} with collections ${customersCol} & ${paymentsCol}.`,
          html: `
            <div style="width: 100%; display: flex; flex-direction: column; gap: 1.25rem;">
              <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <div style="width: 40px; height: 40px; border-radius: 10px; background: #635bff; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 800; font-size: 18px;">
                      S
                    </div>
                    <div>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-weight: 800; font-size: 16px; color: #fff;">Stripe Payment Extension</span>
                        <span class="badge ${isTest ? 'badge-warning' : 'badge-success'}">${isTest ? 'TEST MODE' : 'LIVE'}</span>
                      </div>
                      <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                        Automated webhooks, customer tables, and checkout sessions
                      </div>
                    </div>
                  </div>
                  <button class="btn btn-secondary btn-sm" onclick="selectNav('home')">← Overview</button>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem;">
                  <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem;">
                    <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Webhook Route</div>
                    <div style="font-size: 13px; font-weight: 700; color: #60a5fa; font-family: monospace; margin-top: 4px;">POST /api/stripe/webhook</div>
                  </div>
                  <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem;">
                    <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Customer Table</div>
                    <div style="font-size: 13px; font-weight: 700; color: #34d399; font-family: monospace; margin-top: 4px;">${customersCol}</div>
                  </div>
                  <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem;">
                    <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Payments Table</div>
                    <div style="font-size: 13px; font-weight: 700; color: #34d399; font-family: monospace; margin-top: 4px;">${paymentsCol}</div>
                  </div>
                </div>
              </div>
            </div>
          `,
        },
      },
    ],

    register(ctx: NodeStackPluginContext) {
      // 1. Bind service into container
      ctx.bindService(Symbol.for('StripeService'), stripeService);

      // 2. Register custom developer endpoints
      ctx.registerRoute('GET', '/api/stripe/status', async (_req, reply) => {
        return reply.send({
          enabled: true,
          testMode: isTest,
          currency: options.currency || 'usd',
          customersCollection: customersCol,
          paymentsCollection: paymentsCol,
        });
      });

      ctx.registerRoute('POST', '/api/stripe/checkout-session', async (req: FastifyRequest, reply: FastifyReply) => {
        const body = (req.body as any) || {};
        if (!body.email || !body.amount) {
          return reply.status(400).send({
            statusCode: 400,
            message: 'email and amount are required to create a checkout session',
          });
        }
        try {
          const session = await stripeService.createCheckoutSession(body);
          return reply.status(201).send(session);
        } catch (err: any) {
          const statusCode =
            typeof err.status === 'number' && err.status >= 400 && err.status < 600
              ? err.status
              : 502;
          return reply.status(statusCode).send({
            statusCode,
            message: err.message || 'Failed to create Stripe checkout session',
          });
        }
      });

      const captureRawBody = async (req: any, _reply: any, payload: any) => {
        let data = '';
        for await (const chunk of payload) {
          data += chunk;
        }
        req.rawBody = data;
        const { Readable } = await import('stream');
        return Readable.from([data]);
      };

      ctx.registerRoute(
        'POST',
        '/api/stripe/webhook',
        async (req: FastifyRequest, reply: FastifyReply) => {
          const webhookSecret = options.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;

          if (webhookSecret) {
            const sigHeader = (req.headers['stripe-signature'] as string) || '';
            if (!sigHeader) {
              return reply.status(400).send({
                statusCode: 400,
                message: 'Missing stripe-signature header',
              });
            }

            const rawBody =
              (req as any).rawBody ||
              (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

            const isValid = stripeService.verifyWebhookSignature(rawBody, sigHeader, webhookSecret);
            if (!isValid) {
              return reply.status(400).send({
                statusCode: 400,
                message: 'Invalid stripe webhook signature',
              });
            }
          }

          const payload = (req.body as any) || {};
          const eventType = payload.type || 'payment_intent.succeeded';
          const dataObject = payload.data?.object || payload;

          // Auto-record payment if payment_intent
          if (eventType === 'payment_intent.succeeded' || eventType === 'checkout.session.completed') {
            const piId = dataObject.id || `pi_${crypto.randomBytes(8).toString('hex')}`;
            try {
              await ctx.app.records.create(paymentsCol, {
                paymentIntentId: piId,
                customerId: dataObject.customer || '',
                amount: dataObject.amount || 0,
                currency: dataObject.currency || options.currency || 'usd',
                status: 'succeeded',
              });
            } catch (e: any) {
              // Already recorded or validation notice
            }
          }

          // Trigger custom EventBus event for developers to subscribe
          await ctx.eventBus.emit('stripe:webhook', { type: eventType, data: dataObject });

          return reply.send({ received: true, event: eventType });
        },
        { preParsing: captureRawBody }
      );
    },
  };
}
