---
sidebar_position: 4
id: webhooks-client
title: Webhooks Client Service (v1.3)
description: Programmatic webhook management and HMAC-SHA256 signature verification
---

Webhooks Client Service (v1.3)

NodeStack v1.3 adds a first-class `client.webhooks` service to `nodestack-client` for managing outbound webhooks and verifying incoming signatures.

---

## 1. Create a Webhook Subscription

```typescript
const webhook = await client.webhooks.create({
  name: 'Slack Notification Bridge',
  url: 'https://api.myapp.com/webhooks/orders',
  collection: 'orders',
  action: 'create', // 'create' | 'update' | 'delete' | '*'
  secret: 'whsec_9948a8cf38b1e42c',
  enabled: true,
});

console.log('Registered webhook ID:', webhook.id);
```

---

## 2. Dispatch a Test Payload

Trigger a mock webhook event to test external connectivity without mutating real database records:

```typescript
const testResult = await client.webhooks.test(webhook.id, {
  mockKey: 'mockValue',
});

console.log('Test delivery status code:', testResult.statusCode);
console.log('Delivery latency:', testResult.latencyMs, 'ms');
```

---

## 3. Inspect Delivery Logs

Query the delivery attempts history:

```typescript
const deliveries = await client.webhooks.getDeliveries({
  webhookId: webhook.id,
  status: 'failed',
});

console.log(`Found ${deliveries.items.length} failed delivery attempts`);
```

---

## 4. Retry a Failed Delivery

Manually retry any failed delivery attempt:

```typescript
if (deliveries.items.length > 0) {
  const retryResult = await client.webhooks.retryDelivery(deliveries.items[0].id);
  console.log('Retry result:', retryResult.status);
}
```

---

## 5. Verify Inbound Webhook Signatures

In your downstream receiver service (e.g., Express, Next.js API route, Fastify), verify that payloads originated from NodeStack:

```typescript
import NodeStackClient from 'nodestack-client';

const client = new NodeStackClient('http://localhost:8090');

export async function handleWebhook(req, res) {
  const signature = req.headers['x-nodestack-signature'];
  const rawBody = req.rawBody; // Make sure to use unparsed raw string body
  const secret = process.env.WEBHOOK_SECRET;

  const isValid = client.webhooks.verifySignature(rawBody, signature, secret);

  if (!isValid) {
    return res.status(401).send('Signature verification failed');
  }

  // Signature valid! Process payload safely.
  const payload = JSON.parse(rawBody);
  console.log('Verified event:', payload.event, payload.record);
  res.status(200).send({ received: true });
}
```
