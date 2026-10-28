---
sidebar_position: 2
id: context-api
title: Context API Reference (ctx)
description: Complete specification of the execution context injected into NodeStack functions
---

# Context API Reference (`ctx`)

Every serverless function in NodeStack receives a single `ctx` execution parameter. The `ctx` object provides isolated, scoped access to the incoming HTTP request, database events, collection CRUD operations, safe network fetching, encrypted environment secrets, and execution logging.

```javascript
export default async function(ctx) {
  // ctx.* APIs are available here
}
```

---

## 1. HTTP Request (`ctx.request`)

When a function is invoked via HTTP, `ctx.request` provides full access to the request metadata:

```javascript
export default async function(ctx) {
  const method = ctx.request.method;
  const headers = ctx.request.headers;
  const query = ctx.request.query;
  const body = ctx.request.body;
  const auth = ctx.request.auth;

  ctx.log(`Handling ${method} request with auth:`, auth?.email || 'Anonymous');
  
  return { status: 200, body: { received: body } };
}
```

### Properties

| Property | Type | Description |
| :--- | :--- | :--- |
| `ctx.request.method` | `string` | The HTTP request method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`). |
| `ctx.request.headers` | `Record<string, string>` | Lowercase key-value map of incoming request headers (e.g. `authorization`, `content-type`). |
| `ctx.request.query` | `Record<string, string>` | Parsed URL query parameters (e.g. `?search=shoes&page=2` becomes `{ search: "shoes", page: "2" }`). |
| `ctx.request.params` | `Record<string, string>` | Route parameters if invoked under a parameterized route. |
| `ctx.request.body` | `any` | Parsed JSON or URL-encoded request body. |
| `ctx.request.auth` | `object \| null` | Authenticated session context of the caller (or `null` if unauthenticated). |

#### `ctx.request.auth` Object
```typescript
{
  id: string;          // User ID or Admin ID
  email: string;       // User or Admin email
  role: string;        // 'user' | 'admin' | 'apiKey'
  isSuperuser: boolean;// true if invoked by a superuser admin
}
```

---

## 2. Database Records CRUD (`ctx.records`)

Functions can query and mutate collection records directly inside the engine.

Unless the function is configured with the **Elevated Service Role**, all `ctx.records` operations strictly enforce the target collection's row-level **Access Rules** (`listRule`, `viewRule`, `createRule`, `updateRule`, `deleteRule`) using the caller's `ctx.request.auth` identity.

```javascript
export default async function(ctx) {
  // 1. Retrieve a single record
  const order = await ctx.records.get('orders', 'rec_order123');

  // 2. Query multiple records with filter and pagination
  const activeOrders = await ctx.records.list('orders', {
    filter: 'status = "pending" && total > 50',
    sort: '-created',
    page: 1,
    perPage: 20
  });

  // 3. Create a new record
  const newAudit = await ctx.records.create('audit_events', {
    action: 'checkout_completed',
    amount: order.total,
    userId: ctx.request.auth?.id
  });

  // 4. Update an existing record
  await ctx.records.update('orders', order.id, {
    status: 'processing'
  });

  // 5. Delete a record
  await ctx.records.delete('temp_carts', 'cart_999');

  return { status: 200, body: { success: true } };
}
```

### Methods

| Method | Signature | Description |
| :--- | :--- | :--- |
| `ctx.records.get(collection, id)` | `Promise<Record>` | Retrieves a single record by its unique ID. Throws 404 if not found or unauthorized. |
| `ctx.records.list(collection, options)` | `Promise<{ items: Record[], totalItems: number, page: number, perPage: number }>` | Queries collection records with filter expression, sorting, and pagination. |
| `ctx.records.create(collection, data)` | `Promise<Record>` | Validates schema constraints and inserts a new record. |
| `ctx.records.update(collection, id, data)` | `Promise<Record>` | Validates schema constraints and updates fields on an existing record. |
| `ctx.records.delete(collection, id)` | `Promise<boolean>` | Deletes a record by its unique ID. |

---

## 3. Database Lifecycle Events (`ctx.event`)

When a function is triggered via a **Database Lifecycle Hook** (`eventTrigger`), `ctx.event` contains the mutation context:

```javascript
export default async function(ctx) {
  if (ctx.event) {
    const { collection, action, phase, record, originalRecord } = ctx.event;
    
    ctx.log(`Lifecycle hook triggered on ${collection}:${phase}${action}`);

    // Pre-create validation guardrail
    if (phase === 'before' && action === 'Create') {
      if (record.amount < 0) {
        // Block creation with a custom client response
        return {
          status: 400,
          body: { cancel: true, reason: 'Amount cannot be negative' }
        };
      }

      // Pre-create data normalization
      if (record.title) {
        record.slug = record.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      }
    }

    return { status: 200, body: { record } };
  }
}
```

### Properties

| Property | Type | Description |
| :--- | :--- | :--- |
| `ctx.event.collection` | `string` | The collection undergoing mutation (e.g. `orders`). |
| `ctx.event.action` | `string` | The action being performed: `'Create'`, `'Update'`, or `'Delete'`. |
| `ctx.event.phase` | `string` | Execution phase: `'before'` (intercept/validate) or `'after'` (post-commit/notify). |
| `ctx.event.record` | `object` | The record data being created or updated. |
| `ctx.event.originalRecord` | `object \| null` | The existing record prior to mutation (available in `Update` and `Delete`). |

---

## 4. Guarded Outbound Fetch (`ctx.fetch`)

Functions can call external APIs using `ctx.fetch()`. All requests pass through NodeStack's **Anti-SSRF Firewall (`SsrfGuard`)**:

```javascript
export default async function(ctx) {
  // Calling public APIs is allowed by default
  const res = await ctx.fetch('https://api.github.com/users/octocat', {
    method: 'GET',
    headers: {
      'User-Agent': 'NodeStack-Functions',
      'Accept': 'application/json'
    }
  });

  const userData = await res.json();

  return {
    status: 200,
    body: {
      login: userData.login,
      publicRepos: userData.public_repos
    }
  };
}
```

### Supported Response Helpers
* `await res.json()`: Parses response body as JSON.
* `await res.text()`: Reads response body as plain text.
* `res.status`: Numeric HTTP status code (e.g. `200`, `404`).
* `res.ok`: Boolean flag (`status >= 200 && status < 300`).
* `res.headers`: Header inspection map.

> [!CAUTION]
> Direct requests to `localhost`, `127.0.0.1`, private LAN ranges (`10.0.0.0/8`, `192.168.0.0/16`), or cloud metadata endpoints (`169.254.169.254`) are blocked and throw an Anti-SSRF exception. See [Security & Guardrails](./security.md).

---

## 5. Encrypted Environment Secrets (`ctx.env`)

Functions can access scoped environment secrets defined in the function's Configuration tab:

```javascript
export default async function(ctx) {
  const stripeSecret = ctx.env.STRIPE_SECRET_KEY;
  const webhookSecret = ctx.env.WEBHOOK_SIGNING_KEY;

  if (!stripeSecret) {
    return { status: 500, body: { error: 'STRIPE_SECRET_KEY not configured' } };
  }

  // Use the secret safely
  return { status: 200, body: { configured: true } };
}
```

* **Encrypted at Rest**: Environment variables are stored encrypted in SQLite.
* **Hermetic Isolation**: `ctx.env` exposes **only** the secrets specifically mapped to this function. The host server's `process.env` is never exposed to the sandbox.

---

## 6. Execution Logging (`ctx.log`)

Functions can emit structured log entries captured in the NodeStack audit history:

```javascript
export default async function(ctx) {
  ctx.log("Starting order calculation for cart:", ctx.request.body.cartId);
  console.log("Standard console.log is also redirected to ctx.log");

  return { status: 200, body: { ok: true } };
}
```

All logs are visible in the **Live Test Runner** and stored in the **Function Logs** tab with latency and caller attribution.

---

## 7. Multi-Tenant Application Context (`ctx.app`)

When running under a multi-tenant application, `ctx.app` contains the tenant information:

```javascript
export default async function(ctx) {
  ctx.log(`Executing in tenant: ${ctx.app.name} (${ctx.app.slug})`);

  return {
    status: 200,
    body: {
      tenant: ctx.app.slug,
      isDefault: ctx.app.slug === 'default'
    }
  };
}
```

---

## 8. Web Standard Globals

The QuickJS sandbox provides standard JavaScript Web APIs:

* `crypto.randomUUID()`: Generate cryptographically secure UUID v4 identifiers.
* `TextEncoder` & `TextDecoder`: UTF-8 string encoding and decoding.
* `setTimeout(fn, ms)`: Timer execution within function timeout constraints.
* `JSON.stringify()` & `JSON.parse()`.
* `Math`, `Date`, `RegExp`, `Array`, `Object`, `Promise`.
