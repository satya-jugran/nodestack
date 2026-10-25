---
sidebar_position: 2
id: lifecycle-hooks
title: Lifecycle Hooks
description: Intercepting and mutating records before and after database actions
---

Lifecycle Hooks

NodeStack allows you to attach asynchronous event hooks to any collection mutation.

---

## Available Hooks

For any collection:

* **`onRecordBeforeCreate(collection, handler)`**: Intercept and validate or mutate record data before it is inserted into SQLite. Throwing an error aborts the insert.
* **`onRecordAfterCreate(collection, handler)`**: Executes after the record is persisted. Ideal for sending emails, push notifications, or external API calls.
* **`onRecordBeforeUpdate(collection, handler)`**: Intercept before updating an existing record.
* **`onRecordAfterUpdate(collection, handler)`**: Executes after an update.
* **`onRecordBeforeDelete(collection, handler)`**: Validate whether deletion is allowed.
* **`onRecordAfterDelete(collection, handler)`**: Cleanup auxiliary resources (S3 assets, related cache keys).

---

## Example: Validation & Auto-Slugging

```typescript
import { NodeStack } from '@nodestackapp/server';

const app = new NodeStack({ dataDir: './nodestack_data' });

// Before creating an article
app.onRecordBeforeCreate('articles', async (event) => {
  const { record, httpContext } = event;

  // Validation
  if (!record.title || record.title.length < 5) {
    throw new Error('Title must be at least 5 characters');
  }

  // Auto-generate slug
  record.slug = record.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');

  // Attach creator from auth token
  if (httpContext?.authRecord) {
    record.author = httpContext.authRecord.id;
  }
});

// After creating an order
app.onRecordAfterCreate('orders', async (event) => {
  const { record } = event;
  console.log(`Sending confirmation email for order #${record.id}`);
  // Call Stripe, SendGrid, Twilio, etc.
});

await app.start();
```
