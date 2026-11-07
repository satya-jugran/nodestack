---
sidebar_position: 2
id: workers-and-functions
title: Workers & Function Integration
description: Executing background queue jobs with bound Serverless Functions, the QuickJS bridge, and the Client SDK
---

# Workers & Function Integration

NodeStack allows you to process background queue jobs either automatically using **Bound Serverless Functions** or programmatically via the **TypeScript Client SDK** and HTTP worker endpoints.

---

## 1. Automated Function Binding (`targetFunction`)

You can link any queue directly to an embedded QuickJS serverless function. When messages are published to the queue, NodeStack's background worker loop automatically claims messages and invokes the function.

### Setting up a Function Worker

In the Admin UI Queues Manager or via the API, configure `targetFunction` with your serverless function name:

```json
{
  "name": "send-welcome-emails",
  "concurrency": 5,
  "visibilityTimeoutSeconds": 60,
  "maxAttempts": 3,
  "targetFunction": "dispatch-email-fn"
}
```

### Writing the Function Handler

Inside your serverless function, access the queue message payload via `context.event`:

```javascript
// Function: dispatch-email-fn
module.exports = async function(core, context) {
  const { event } = context;
  const { recipient, subject, templateId, data } = event.payload;

  context.log(`Processing email for ${recipient}`);

  // Perform external HTTP request via safe network client
  const res = await core.network.fetch('https://api.emailprovider.com/v1/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${context.env.EMAIL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: recipient,
      subject: subject,
      template: templateId,
      variables: data
    })
  });

  if (!res.ok) {
    throw new Error(`Email provider error: ${res.statusText}`);
  }

  // Returning a result records it in the message's result field
  return { delivered: true, timestamp: Date.now() };
};
```

* **Automatic Success (`ack`)**: When the function finishes without throwing an exception, NodeStack marks the message as `completed` and records the return value in the message `result`.
* **Automatic Failure & Retry (`nack`)**: If the function throws an error or exceeds execution timeouts, NodeStack catches the error, records the error stack, and schedules a retry according to the queue's `backoffDelayMs`. If `maxAttempts` is reached, it routes to `dead_letter`.
* **Automatic Renaming Protection**: Renaming a serverless function automatically updates all queues referencing that function in their `targetFunction` field.

---

## 2. Accessing Queues Inside QuickJS Sandbox (`core.sdk.queue`)

Serverless functions can publish messages or inspect queues directly using the built-in `core.sdk.queue` bridge:

```javascript
module.exports = async function(core, context) {
  // Access a specific queue
  const emailQueue = core.sdk.queue('send-welcome-emails');

  // Enqueue a new message with an optional partition groupKey
  const message = await emailQueue.enqueue({
    recipient: context.body.email,
    subject: 'Welcome to our platform!',
    templateId: 'welcome-v1'
  }, {
    groupKey: `user:${context.body.userId}`,
    priority: 10,
    delaySeconds: 5
  });

  // Get message status or details
  const details = await core.sdk.queue.getMessage(message.id);

  return { queued: true, messageId: message.id };
};
```

:::caution System Queue Protection
Functions cannot access or enqueue jobs into internal system queues (such as `_flow_*`), ensuring workflow orchestration integrity.
:::

---

## 3. Programmatic Workers with Client SDK (`nodestack-client`)

External worker processes (e.g. Node.js microservices, Python daemons, or custom runners) can claim and process messages using `nodestack-client`:

```typescript
import { NodeStackClient } from 'nodestack-client';

const client = new NodeStackClient('http://localhost:8090', {
  apiKey: process.env.NODESTACK_API_KEY
});

const ordersQueue = client.queue('process-orders');

async function startWorker() {
  console.log('Worker started, listening for jobs...');

  while (true) {
    // 1. Atomically claim up to 5 jobs
    const messages = await ordersQueue.claim(5);

    if (messages.length === 0) {
      // No pending jobs, wait briefly
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    for (const msg of messages) {
      try {
        console.log(`Processing order: ${msg.id}`);

        // Extend lease heartbeat for long-running jobs
        await ordersQueue.touch(msg.id, msg.claimToken);

        // Process business logic
        const result = await processOrder(msg.payload);

        // 2. Acknowledge completion with result and verified claim token
        await ordersQueue.complete(msg.id, result, msg.claimToken);
      } catch (err: any) {
        console.error(`Failed to process order ${msg.id}:`, err);
        // 3. Mark failed to schedule retry or route to DLQ
        await ordersQueue.fail(msg.id, err.message, msg.claimToken);
      }
    }
  }
}

startWorker();
```

---

## 4. Lease Management & Worker Security

NodeStack uses cryptographic claim tokens to secure queue worker leases:
* **`claimToken` Verification**: When a worker claims a message, NodeStack issues a cryptographically random `claimToken` associated with the lease.
* **Lease Expiration (`visibilityTimeoutSeconds`)**: If a worker crashes or loses network connectivity, the lease expires automatically after `visibilityTimeoutSeconds`, and the job is returned to the pool.
* **Heartbeat Renewal (`touch`)**: Long-running workers can call `touch()` to extend the lease expiration window without resetting attempt counts.
* **Tamper Protection**: Attempting to complete or fail a job with an expired lease or mismatched `claimToken` is rejected with `HTTP 409 Conflict`, preventing split-brain executions.
