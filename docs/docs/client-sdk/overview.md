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
**Reactive Auth**: `LocalAuthStore` (browser `localStorage`), `MemoryAuthStore` (Node/SSR/testing), with `onChange` subscriptions.
**Fluent CRUD Operations**: `getList`, `getFullList`, `getFirstListItem`, `create`, `update`, `delete`.
**FTS5 Full-Text Search (v1.3)**: Built-in support for BM25 ranking, prefix queries, and highlighted snippet excerpts.
**Webhooks Client Service (v1.3)**: Webhook registration, delivery logs, test dispatch, and HMAC verification.
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
