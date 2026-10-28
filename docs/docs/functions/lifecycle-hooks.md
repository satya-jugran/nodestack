---
sidebar_position: 3
id: lifecycle-hooks
title: Database Lifecycle Hooks
description: Wire serverless functions to collection database mutations for automated validation and enrichment
---

# Database Lifecycle Hooks

In addition to direct HTTP endpoints, NodeStack Functions can be configured as **Database Lifecycle Hooks**. Whenever a record is created, updated, or deleted in a collection, NodeStack synchronously invokes the assigned function.

---

## Trigger Syntax (`eventTrigger`)

Functions subscribe to lifecycle events by setting the `eventTrigger` property:

```
<collection>:<phase><Action>
```

### Supported Lifecycle Phases & Actions

| Trigger Expression | Trigger Moment | Primary Use Case |
| :--- | :--- | :--- |
| `orders:beforeCreate` | Intercepted before the record is written to SQLite. | Validation, default values, and data sanitization. |
| `orders:afterCreate` | Fired immediately after the transaction commits. | Outbound notifications, webhook dispatch, analytics. |
| `products:beforeUpdate` | Intercepted before an existing record is updated. | Immutability enforcement, state transition checks. |
| `products:afterUpdate` | Fired after the update transaction commits. | Cache invalidation, audit logging, inventory recalculation. |
| `users:beforeDelete` | Intercepted before a record is deleted. | Guard against deleting active accounts or root admins. |
| `users:afterDelete` | Fired after record deletion commits. | Cascading cleanup, S3 file deletion. |

### Wildcard Support
* `orders:*`: Listen to all lifecycle events on the `orders` collection.
* `*:beforeCreate`: Global pre-creation interceptor for all collections.

---

## Validation & Blocking Mutations

In `before*` hooks, you can cancel the operation and return a descriptive error to the client by returning `{ status: 400, body: { cancel: true, reason: "..." } }`:

```javascript
export default async function(ctx) {
  if (ctx.event && ctx.event.record) {
    const record = ctx.event.record;

    // Guardrail: Validate order amounts
    if (record.total !== undefined && record.total <= 0) {
      return {
        status: 400,
        body: {
          cancel: true,
          reason: "Order total must be greater than zero."
        }
      };
    }

    // Guardrail: Enforce business rule
    if (record.country === "US" && !record.state) {
      return {
        status: 422,
        body: {
          cancel: true,
          reason: "State code is required for US shipping addresses."
        }
      };
    }

    return { status: 200 };
  }
}
```

When `cancel: true` is returned, NodeStack rolls back the transaction and returns the specified HTTP status code and reason to the client initiating the CRUD request.

---

## Data Enrichment & Normalization

In `beforeCreate` and `beforeUpdate` hooks, you can mutate the `ctx.event.record` object directly. The modified fields are written atomically to SQLite:

```javascript
export default async function(ctx) {
  if (ctx.event && ctx.event.record) {
    const record = ctx.event.record;

    // 1. Generate URL slug from title
    if (record.title) {
      record.slug = record.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    // 2. Set default status
    if (!record.status) {
      record.status = 'draft';
    }

    // 3. Normalize tags
    if (Array.isArray(record.tags)) {
      record.tags = record.tags.map(t => t.trim().toLowerCase());
    }

    return { status: 200, body: { record } };
  }
}
```

---

## Comparing Previous State (`originalRecord`)

In `beforeUpdate`, `afterUpdate`, `beforeDelete`, and `afterDelete` hooks, `ctx.event.originalRecord` contains the record state before the mutation occurred:

```javascript
export default async function(ctx) {
  if (ctx.event) {
    const { record, originalRecord } = ctx.event;

    // Detect if order status transitioned to 'paid'
    if (originalRecord && originalRecord.status !== 'paid' && record.status === 'paid') {
      ctx.log(`Order ${record.id} transitioned to PAID. Triggering fulfillment...`);

      // Trigger outbound fulfillment integration
      await ctx.fetch('https://fulfillment.example.com/api/ship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: record.id,
          customerEmail: record.customerEmail,
          items: record.items
        })
      });
    }

    return { status: 200 };
  }
}
```

---

## Post-Commit Notifications (`afterCreate` / `afterUpdate`)

`after*` hooks execute after SQLite commits the database transaction. They are ideal for non-blocking integrations, sending emails, and broadcasting external webhooks:

```javascript
export default async function(ctx) {
  if (ctx.event && ctx.event.phase === 'after' && ctx.event.action === 'Create') {
    const newUser = ctx.event.record;

    ctx.log(`Sending welcome email to: ${newUser.email}`);

    // Call Resend / SendGrid API using safe fetch
    await ctx.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ctx.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'onboarding@example.com',
        to: newUser.email,
        subject: 'Welcome to our platform!',
        html: `<p>Hi ${newUser.name || 'there'}, your account is ready!</p>`
      })
    });

    return { status: 200 };
  }
}
```
