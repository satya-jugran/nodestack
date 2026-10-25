---
sidebar_position: 1
id: outbound-webhooks
title: Outbound Webhooks Engine
description: Automated HTTP callbacks, HMAC-SHA256 signature verification, and delivery retries
---

# Outbound Webhooks Engine

NodeStack includes a dedicated Outbound Webhook Subsystem that dispatches HTTP callbacks whenever collection mutations occur.

---

## Key Capabilities

* **Collection & Action Filtering**: Trigger webhooks on `create`, `update`, `delete`, or wildcard `*`.
* **HMAC-SHA256 Signatures**: Every payload is signed with your secret key using HMAC-SHA256 and sent in the `x-nodestack-signature` HTTP header.
* **Automated Exponential Retries**: Transient failures (e.g. 500 status codes, network timeouts) are retried automatically with exponential backoff.
* **Admin UI Webhooks Manager**: Visual interface to register endpoints, dispatch test events, and inspect real-time delivery logs.
* **Programmatic Client SDK**: Register webhooks and verify signatures directly via `nodestack-client`.

---

## Webhook Payload Structure

When an event fires, NodeStack sends a `POST` request with JSON:

```json
{
  "event": "posts.create",
  "action": "create",
  "collection": "posts",
  "timestamp": "2026-10-20T12:00:00.000Z",
  "record": {
    "id": "rec_001",
    "title": "New Article",
    "status": "published",
    "created": "2026-10-20T12:00:00.000Z",
    "updated": "2026-10-20T12:00:00.000Z"
  }
}
```

---

## Cryptographic Verification (`x-nodestack-signature`)

To prevent spoofing and replay attacks, verify the `x-nodestack-signature` header on your receiving server.

### Verification in Node.js / Express / Fastify

```typescript
import crypto from 'node:crypto';

function verifyNodeStackSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(digest));
}
```

### Verification with `nodestack-client`

The TypeScript client provides a built-in helper:

```typescript
import NodeStackClient from 'nodestack-client';

const client = new NodeStackClient('http://localhost:8090');

// In your webhook receiver endpoint:
const isValid = client.webhooks.verifySignature(
  rawRequestBodyString,
  req.headers['x-nodestack-signature'],
  'whsec_9948a8cf38b1e42c'
);

if (!isValid) {
  return reply.status(401).send({ error: 'Invalid HMAC signature' });
}
```

---

## Managing Webhooks via Client SDK

```typescript
// 1. Create a webhook subscription
const webhook = await client.webhooks.create({
  name: 'Payment Processing Dispatcher',
  url: 'https://api.myapp.com/webhooks/orders',
  collection: 'orders',
  action: 'create', // 'create' | 'update' | 'delete' | '*'
  secret: 'whsec_9948a8cf38b1e42c',
  enabled: true,
});

// 2. Dispatch an instant test payload
await client.webhooks.test(webhook.id, { test: true });

// 3. Inspect delivery history logs
const deliveries = await client.webhooks.getDeliveries({
  webhookId: webhook.id,
  status: 'failed',
});

// 4. Retry a failed delivery attempt manually
if (deliveries.items.length > 0) {
  await client.webhooks.retryDelivery(deliveries.items[0].id);
}
```
