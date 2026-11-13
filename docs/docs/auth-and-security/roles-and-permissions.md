---
sidebar_position: 2
id: roles-and-permissions
title: Authorization, Roles & Permissions
description: How authorization works in NodeStack, modeling roles vs. personas, and implementing RBAC, ABAC, and subscription tiers
---

# Authorization, Roles & Permissions

Developers coming from traditional enterprise frameworks (such as Spring Security, Django, or ASP.NET Identity) often expect a rigid, pre-baked **Role-Based Access Control (RBAC)** matrix backed by five database tables: `users`, `roles`, `user_roles`, `permissions`, and `role_permissions`.

NodeStack takes a modern, flexible approach inspired by **Row-Level Security (RLS)** and **Attribute-Based Access Control (ABAC)** (similar to PocketBase and Supabase). 

Instead of boxing your application into an inflexible role matrix, NodeStack combines:
1. **Declarative Collection Access Rules (Fast-Path)** for 90% of day-to-day authorization (ownership, public/private state, status checks).
2. **TypeScript Server Lifecycle Hooks & Serverless Functions (Escape Hatch)** for the remaining 10% of complex multi-table checks, subscription validations, and external billing verification.

---

## The 5 Collection Permission Gates

Every collection in NodeStack defines five independent permission rules that map to the standard CRUD lifecycle:

| Action / Gate | HTTP Endpoint | Description |
| :--- | :--- | :--- |
| **`listRule`** | `GET /api/collections/:col/records` | Controls querying and searching. Compiles directly into SQL `WHERE` clauses. |
| **`viewRule`** | `GET /api/collections/:col/records/:id` | Controls reading a single record by its ID. |
| **`createRule`** | `POST /api/collections/:col/records` | Controls inserting new records (including user self-registration). |
| **`updateRule`** | `PATCH /api/collections/:col/records/:id` | Controls modifying existing records. |
| **`deleteRule`** | `DELETE /api/collections/:col/records/:id` | Controls permanently deleting records. |

### Rule States

Each rule slot can be in one of three states:

* **Locked (`null`)**: Restricted exclusively to administrators (`_admins` or superusers) and internal backend code. Non-admin callers receive `403 Forbidden`.
* **Public (`""` empty string)**: Open to all callers, including unauthenticated guests.
* **Conditional Expression**: Evaluated dynamically using request attributes (`@request.auth.*`, `@request.query.*`, `@request.data.*`) and record fields.

```text
// 1. Strict Owner Access:
user = @request.auth.id

// 2. Public can read published items; authors can view their own drafts:
status = "published" || author = @request.auth.id

// 3. User can edit their own profile, but cannot tamper with their role:
@request.auth.id = id && @request.data.role = null
```

---

## Personas vs. Roles (The Golden Rule)

A common point of confusion when first designing a NodeStack application is whether to create new tables for different user tiers.

:::caution Anti-Pattern: Never Create Multiple Tables for Tiers of the Same Entity
Do **not** create a `customers_gold` or `users_admin` table to represent user levels! 

If you separate standard and gold customers into different tables:
* You fragment your user identity (IDs must change or be cloned).
* All relational foreign keys (`orders.user`, `reviews.user`, `addresses.user`) break or require complex cascading updates.
* Password hashes and OAuth2 social links must be duplicated.
* Active user sessions are invalidated.
:::

Follow this simple architectural rule:

```
┌─────────────────────────────────────────────────────────────────┐
│ Separate AUTH COLLECTIONS are for different ACTOR PERSONAS      │
│ (Customers vs. Sellers vs. Couriers vs. Internal Staff)         │
└─────────────────────────────────────────────────────────────────┘
                                ▲
                                │ DIFFERENT PURPOSES
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ Separate FIELDS / RELATIONS are for TIERS, ROLES & RANKS         │
│ (Standard vs. Gold, Free vs. Pro, Viewer vs. Editor)            │
└─────────────────────────────────────────────────────────────────┘
```

* **Use separate Auth Collections** when actors have completely different life-cycles, schemas, credentials, and portals (e.g., a buyer does not "upgrade" into a courier).
* **Use Fields or Relations** within the **same collection** when a user upgrades, downgrades, or shifts roles (e.g., standard customer upgrades to Gold/Prime).

---

## 4 Idiomatic Patterns for Roles & Permissions

### Pattern 1: Field-Based Roles & Tiers (Simplest & Most Common)

To implement tiers such as `standard`, `gold`, or `platinum`:

#### 1. Add a `tier` field to your collection
In the Admin UI (`http://localhost:8090/_/`) or code, add a `select` field to `customers`:
* **Name**: `tier`
* **Options**: `["standard", "silver", "gold", "platinum"]`
* **Default**: `"standard"`

#### 2. Prevent users from escalating their own role
In the `customers` collection's **`updateRule`**:
```text
@request.auth.id = id && @request.data.tier = null
```
This ensures users can update their profile information (name, avatar), but cannot tamper with the `tier` field in their PATCH payload.

#### 3. Promote the user with a single update
When a user subscribes or is upgraded:
```typescript
import { NodeStackClient } from 'nodestack-client';

const client = new NodeStackClient('http://localhost:8090');

// From your admin portal or backend payment handler:
await client.collection('customers').update('usr_abc123', {
  tier: 'gold',
});
```
* The user's ID remains untouched.
* Historical orders, reviews, and favorites remain connected.
* The user does not need to re-authenticate.

---

### Pattern 2: Relational Subscription Model (Time-Bound & Billing)

For applications integrated with payment gateways (e.g. Stripe, LemonSqueezy):

```
┌──────────────────┐           ┌─────────────────────────────┐
│    customers     │ 1       * │        subscriptions        │
├──────────────────┤───────────├─────────────────────────────┤
│ id               │           │ id                          │
│ email            │           │ customer (relation)         │
│ name             │           │ plan: "gold" | "platinum"   │
│ created          │           │ status: "active" | "past_due│
└──────────────────┘           │ expiresAt: "2027-12-31"     │
                               └─────────────────────────────┘
```

When a webhook arrives from your billing provider, record the subscription:
```typescript
await client.collection('subscriptions').create({
  customer: customerId,
  plan: 'gold',
  status: 'active',
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
});
```

---

### Pattern 3: Server-Side TypeScript Lifecycle Hooks (`EventBus`)

When you need deep, multi-table authorization (e.g., verifying department hierarchy, checking team memberships, or applying conditional discounts), use native TypeScript hooks:

```typescript
import { NodeStack } from '@nodestackapp/server';

const app = new NodeStack({ dataDir: './nodestack_data' });

app.onRecordBeforeCreate('orders', async (event) => {
  const { record, auth } = event;

  // Superusers bypass checks
  if (auth?.isAdmin) return;

  // If a VIP promo code was supplied:
  if (record.promoCode === 'GOLD_PRIME_20') {
    // 1. Fetch live customer record from SQLite
    const customer = await app.records.getOne('customers', auth.id);

    // 2. Validate tier
    if (customer.tier !== 'gold' && customer.tier !== 'platinum') {
      throw new Error('The promo code GOLD_PRIME_20 is strictly reserved for Gold members');
    }

    // 3. Apply 20% discount server-side
    record.discountAmount = record.total * 0.20;
    record.total = record.total - record.discountAmount;
  }
});
```

---

### Pattern 4: Sandboxed Serverless Functions (`FunctionService`)

For custom business workflows requiring multi-step verification:
1. Create a serverless function with `authPolicy: 'auth'`.
2. Inside the function, `context.auth` provides the caller's identity `{ id, role, email }`.
3. If the function is configured with `elevated: true`, it can perform administrative queries that bypass collection access rules.

```typescript
// Invocation via client SDK:
const result = await client.functions.invoke('upgrade-membership', {
  plan: 'gold',
  paymentMethodId: 'pm_card_visa',
});
```

---

## How Authorization Engages with Subsystems

Authorization in NodeStack is deeply woven into all runtime components:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        NodeStack Core Engine                           │
├────────────────────┬───────────────────────────────────────────────────┤
│ Subsystem          │ Authorization Enforcement Mechanism               │
├────────────────────┼───────────────────────────────────────────────────┤
│ **Collections**    │ 5 CRUD rules compiled to SQL WHERE predicates     │
│ **Realtime SSE**   │ Per-client viewRule evaluation & auto-sanitization│
│ **Functions**      │ authPolicy ('public' | 'auth' | 'admin' | 'apiKey')│
│ **Webhooks**       │ HMAC-SHA256 signature verification & SSRF guard   │
│ **API Keys**       │ Scoped RBAC permissions ("orders:read", "*:write")│
│ **Session State**  │ tokenKey cache with instant realtime revocation   │
└────────────────────┴───────────────────────────────────────────────────┘
```

### 1. Realtime SSE Streams
Unlike platforms that broadcast all database changes to every connected subscriber, NodeStack evaluates `collection.viewRule` **per connected client for every database change**:
* If client Alice does not have permission to view Bob's order, Alice's SSE stream never receives the event frame.
* Sensitive fields (such as hidden emails when `emailVisibility = false`) are dynamically sanitized according to the recipient's privileges.
* When a user changes their password or an admin revokes their token, `revokeClientsByIdentity` terminates their live SSE connection immediately.

### 2. Outbound Webhooks
* **Management**: Creating, updating, or testing webhooks is restricted to Admins (`requireAdmin`).
* **Cryptographic Signatures**: NodeStack signs outbound webhook payloads using **HMAC-SHA256** with a shared secret. Receiving servers verify the signature via the `X-NodeStack-Signature` header.
* **Anti-SSRF Protection**: NodeStack's `SsrfGuard` blocks webhooks and serverless functions from querying internal networks (e.g. `127.0.0.1`, private subnets, or cloud metadata endpoints).

### 3. Machine-to-Machine API Keys
API keys support full RBAC:
* **Roles**: `'admin' | 'service' | 'custom'`
* **Granular Scopes**: e.g., `["products:read", "orders:*", "*:write"]`
* **IP Whitelisting**: Restricted to specific client CIDRs or IP addresses.
* Verified using timing-safe cryptographic comparisons.

---

## Comparison Summary

| Capability | Traditional Rigid RBAC | NodeStack Dual-Layer Model |
| :--- | :--- | :--- |
| **Permissions Structure** | Static join tables (`user_roles`, `role_permissions`) | 5 CRUD rules per collection (`list`, `view`, `create`, `update`, `delete`) |
| **Resource Ownership** | Requires custom controller code (`WHERE user_id = ?`) | Native expression: `user = @request.auth.id` |
| **Lifecycle State Checks**| Requires custom controller code | Native expression: `status = "draft"` |
| **User Tiers / Ranks** | Role switching across join tables | Single attribute update: `tier: "gold"` |
| **Realtime Security** | Client-side filtering (vulnerable to data leaks) | Server-side per-client `viewRule` evaluation |
| **Custom Complex Logic**| Writing boilerplate middleware | Native TypeScript lifecycle hooks (`onRecordBefore*`) |
