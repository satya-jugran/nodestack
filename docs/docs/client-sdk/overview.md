---
sidebar_position: 1
id: overview
title: Client SDK Overview
description: Zero-dependency, lightweight TypeScript client for NodeStack
---

Client SDK Overview

The `nodestack-client` is a zero-dependency, isomorphic TypeScript & JavaScript client for NodeStack. It runs seamlessly in web browsers, React, Next.js, React Native, Node.js, Bun, and Deno.

---

## Highlights
**Ultra-lightweight**: `< 10 KB` minified + gzipped.
**Multi-Application Scoping (v2.0)**: Fluent `client.app(slug)` scoping, automatic `x-nodestack-app` header injection, and `client.apps` management service.
**Reactive Auth**: `LocalAuthStore` (browser `localStorage`), `MemoryAuthStore` (Node/SSR/testing), with `onChange` subscriptions.
**Fluent CRUD Operations**: `getList`, `getFullList`, `getFirstListItem`, `create`, `update`, `delete`.
**Application Snapshots (v2.0)**: Programmatic checkpoint management with `client.snapshots` (create, restore, drift checks, FIFO eviction).
**FTS5 Full-Text Search**: Built-in support for BM25 ranking, prefix queries, and highlighted snippet excerpts.
**Webhooks Client Service**: Webhook registration, delivery logs, test dispatch, and HMAC verification.
**Multiplexed SSE Realtime**: Persistent connection with auto-handshake and auto-reconnect.
**100% Type-Safe**: Works with `nodestack typegen` for complete end-to-end typing.

---

## Installation

```bash
npm install nodestack-client
```

---

## Initializing the Client

### In the Browser (React / Vue / Svelte / Plain JS)

```typescript
import NodeStackClient from 'nodestack-client';

// Connects to your backend and persists auth in localStorage
const client = new NodeStackClient('http://localhost:8090');
```

### In Node.js / Server-Side Rendering (Next.js / Remix / SSR)

In server environments without `window.localStorage`, pass a `MemoryAuthStore`:

```typescript
import NodeStackClient, { MemoryAuthStore } from 'nodestack-client';

const client = new NodeStackClient('http://localhost:8090', {
  authStore: new MemoryAuthStore(),
});
```

---

## Reactive Auth State Listener

Listen to login and logout events across your entire application:

```typescript
client.authStore.onChange((token, record) => {
  console.log('User auth state changed:');
  console.log('Token exists:', !!token);
  console.log('Active user ID:', record?.id);
});
```

---

## Multi-Application Scoping (v2.0)

When connecting to a NodeStack v2.0 server with multiple hosted applications, use `client.app(slug)` to scope all queries, file URLs, and realtime streams to a specific application:

```typescript
// Create an app-scoped instance
const shopClient = client.app('shop');

// Automatically sends `x-nodestack-app: shop` header on all requests
const products = await shopClient.collection('products').getList(1, 10);

// File URLs automatically include the app prefix:
// /api/apps/shop/files/products/rec_123/image.png
const url = shopClient.files.getUrl(products.items[0], products.items[0].image);

// Realtime SSE automatically subscribes with ?app=shop
shopClient.collection('orders').subscribe('*', (e) => {
  console.log('Shop order mutation:', e.record);
});
```

For more details on managing applications and architecture, see the [Multi-Application Platform Guide](../core-concepts/multi-application.md).

---

## Application Snapshots (v2.0)

Manage time-travel checkpoints programmatically using `client.snapshots`:

```typescript
// 1. Create a snapshot checkpoint
const snapshot = await client.snapshots.create({
  label: 'Before Product Migration',
  description: 'Schema backup prior to v2 product catalog update',
  evictOldest: true, // Auto-evict oldest checkpoint if at 10-snapshot limit
});

// 2. List all snapshots and drift status
const list = await client.snapshots.list();
console.log('Active snapshots:', list.snapshots);
console.log('Database drift detected:', list.driftDetected);

// 3. Restore to checkpoint non-destructively
await client.snapshots.restore(snapshot.id);
```

For more details, see the [Application Snapshots Guide](../core-concepts/snapshots.md).
