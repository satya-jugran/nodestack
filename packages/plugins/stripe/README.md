# @nodestackapp/plugin-stripe

Official Stripe payments, checkout sessions, customer billing, and webhook integration plugin for [NodeStack](https://github.com/satya-jugran/nodebase).

## Features

- **Automated Collections**: Auto-creates `_stripe_customers` and `_stripe_payments` system collections in SQLite.
- **Embedded Admin UI Dashboard**: Dedicated Stripe billing view and overview cards directly in the NodeStack Admin UI.
- **Stripe Checkout Sessions**: Instant `POST /api/stripe/checkout-session` endpoint to initiate checkout flows.
- **Webhook Processing**: Secure `POST /api/stripe/webhook` handling and internal `stripe:webhook` EventBus broadcasting.
- **Zero Runtime Dependencies**: Ultra-lightweight and compiled for dual CommonJS + ESM.

## Installation

```bash
npm install @nodestackapp/plugin-stripe
```

*(Ensure `nodestack` is installed as a peer dependency: `npm install nodestack`)*

## Usage

```typescript
import { NodeStack } from 'nodestack';
import { stripePlugin } from '@nodestackapp/plugin-stripe';

const app = new NodeStack();

app.use(stripePlugin({
  secretKey: process.env.STRIPE_SECRET_KEY!,
  currency: 'usd',
}));

// Listen to Stripe webhook events anywhere in your application
app.eventBus.on('stripe:webhook', async (event: any) => {
  console.log('Stripe event received:', event.type);
});

await app.start(3000);
```

## Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `secretKey` | `string` | *(required)* | Stripe secret key (`sk_live_...` or `sk_test_...`) |
| `webhookSecret` | `string` | `undefined` | Optional webhook endpoint signing secret |
| `currency` | `string` | `'usd'` | Default currency ISO code |
| `customersCollection` | `string` | `'_stripe_customers'` | Custom collection name for customers |
| `paymentsCollection` | `string` | `'_stripe_payments'` | Custom collection name for payments |

## License

MIT
