# 🚀 nodestack-client

> **The Official Lightweight, Type-Safe JavaScript & TypeScript Client SDK for [NodeStack](https://github.com/satya-jugran/nodestack)**
>
> Published on npm: [`nodestack-client`](https://www.npmjs.com/package/nodestack-client)

[![npm version](https://img.shields.io/npm/v/nodestack-client.svg?color=blue)](https://www.npmjs.com/package/nodestack-client)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A zero-dependency, isomorphic JavaScript and TypeScript client for NodeStack with out-of-the-box support for:
- ⚡ **Zero runtime dependencies**: Built purely on standard Web APIs (`fetch`, `FormData`, `AbortController`, `EventSource`).
- 🪶 **Ultra-lightweight footprint**: `< 10 KB` minified + gzipped.
- 🔒 **Pluggable & Reactive Auth**: `LocalAuthStore` (localStorage), `MemoryAuthStore` (Node/SSR/testing), and reactive `onChange` state subscriptions.
- 📦 **Fluent Record CRUD & Batch Pagination**: `getList`, `getFullList`, `getFirstListItem`, `create`, `update`, `delete`, `export`, and `import`.
- 🔍 **SQLite FTS5 Full-Text Search**: Embedded BM25 relevance ranking, keyword prefix matching, and contextual snippet highlighting.
- 🔔 **Outbound Webhooks Service**: Programmatic webhook registration, test dispatch, delivery inspection, and HMAC-SHA256 signature verification (`client.webhooks`).
- 📁 **File Uploads & Protected File URLs**: Seamless `FormData` file uploads and URL generation with automatic token appending.
- 📡 **Multiplexed Realtime SSE**: Single persistent connection with auto-handshake (`NS_CONNECT`), dynamic subscription sync, and automatic reconnection.
- 🎯 **100% Type Safety**: Works seamlessly with `nodestack typegen` and `GET /api/types.d.ts` for autocompleted collection names and typed record returns.
- 🌐 **Isomorphic**: Modern Browsers, React / Next.js (SSR + Client), Vue, Svelte, Node.js (18+ / 22+), Bun, Deno, and React Native.

---

## 📦 Installation

```bash
npm install nodestack-client
```

Or using Yarn / PNPM / Bun:
```bash
pnpm add nodestack-client
# or
bun add nodestack-client
```

---

## ⚡ Quick Start

```typescript
import { NodeStackClient } from 'nodestack-client';

// Initialize client
const client = new NodeStackClient('http://127.0.0.1:8090');

// Fetch paginated records
const result = await client.collection('posts').getList(1, 20, {
  filter: "status = 'published' && views >= 10",
  sort: '-created',
});

console.log(`Found ${result.totalItems} posts:`, result.items);
```

---

## 🔐 Authentication

### Authenticate as an Auth Collection User (e.g. `users`)
```typescript
const authData = await client.collection('users').authWithPassword('alice@example.com', 'password123');

console.log('Logged in user:', client.authStore.model);
console.log('JWT Token:', client.authStore.token);
console.log('Is valid:', client.authStore.isValid);
```

### Authenticate as a Superuser / Admin
```typescript
const adminAuth = await client.admins.authWithPassword('admin@nodestack.io', 'MySecretAdminPassword');
console.log('Logged in superuser:', adminAuth.admin.email);
```

### Reactive Auth State Changes
```typescript
// Subscribe to login / logout events (ideal for React, Vue, Svelte stores)
const unbind = client.authStore.onChange((token, model) => {
  console.log('Auth state changed:', { token, model });
});

// Logout
client.authStore.clear();

// Unsubscribe listener
unbind();
```

### SSR & Node.js Environments (`MemoryAuthStore`)
In Node.js scripts or server-side rendering where `window.localStorage` is unavailable:
```typescript
import { NodeStackClient, MemoryAuthStore } from 'nodestack-client';

const serverClient = new NodeStackClient('http://127.0.0.1:8090', {
  authStore: new MemoryAuthStore(),
});
```

---

## 📋 Record Operations (CRUD)

### 1. Fetch Paginated Records (`getList`)
```typescript
const result = await client.collection('posts').getList(1, 10, {
  filter: "category = 'Tech' && price <= 50",
  sort: '-created,title',
  expand: 'author,comments',
});

console.log(result.page, result.totalPages, result.items);
```

### 2. Full-Text Search with BM25 Scoring & Snippets (`search`)
Query records using embedded SQLite FTS5 with BM25 relevance ranking and keyword highlight snippets:
```typescript
const searchResults = await client.collection('posts').getList(1, 10, {
  search: 'distributed systems',
  snippetTag: 'mark',     // Highlight tag (default: <mark>)
  snippetLength: 25,       // Max words per snippet excerpt
});

console.log(searchResults.items[0]._score);    // BM25 relevance score
console.log(searchResults.items[0]._snippet);  // Best matching snippet excerpt
console.log(searchResults.items[0]._snippets); // Per-field snippet map: { title: "...", content: "..." }
```

### 3. Fetch All Records Across Pages (`getFullList`)
Auto-paginates in batches and returns all matching records as a single array:
```typescript
const allPosts = await client.collection('posts').getFullList({
  batch: 200,
  filter: "published = true",
});
```

### 4. Find First Matching Record (`getFirstListItem`)
```typescript
// Throws ClientResponseError(404) if no match is found
const post = await client.collection('posts').getFirstListItem("slug = 'hello-world'");
```

### 5. Create Record (JSON or File Uploads)
```typescript
// Plain JSON
const newPost = await client.collection('posts').create({
  title: 'My First Post',
  published: true,
});

// Multipart Form Data (File Upload)
const formData = new FormData();
formData.append('title', 'Post with Cover Photo');
formData.append('coverImage', fileInput.files[0]);

const postWithImage = await client.collection('posts').create(formData);
```

### 6. Update & Delete Records
```typescript
// Update
const updated = await client.collection('posts').update('rec_123', {
  title: 'Updated Title',
});

// Delete
await client.collection('posts').delete('rec_123');
```

---

## 📁 File URLs Helper

NodeStack provides protected and public file serving at `/api/files/:collection/:recordId/:filename`. Construct fully-qualified URLs easily:

```typescript
const record = await client.collection('posts').getOne('rec_123');

// 1. Standard URL for <img> tags
const imageUrl = client.files.getUrl(record, record.coverImage);

// 2. Trigger browser download dialog
const downloadUrl = client.files.getUrl(record, record.attachment, {
  download: true,
});

// 3. Attach authentication token for protected files
const protectedUrl = client.files.getUrl(record, record.secretDoc, {
  token: true, // Uses active authStore token
});
```

---

## 📡 Realtime Subscriptions (SSE)

NodeStack uses Server-Sent Events (SSE) with an initial `NS_CONNECT` handshake and multiplexed collection channels. `nodestack-client` manages this with automatic reconnection and topic synchronization:

```typescript
// 1. Subscribe to all changes in a collection
const unsubscribe = await client.collection('posts').subscribe('*', (event) => {
  console.log(`Action: ${event.action}`); // 'create' | 'update' | 'delete'
  console.log('Record:', event.record);
});

// 2. Subscribe to a specific record by ID
const unbindRecord = await client.collection('posts').subscribe('rec_123', (event) => {
  console.log('Record updated:', event.record);
});

// 3. Clean up subscriptions when unmounting
await unsubscribe();
await unbindRecord();
```

---

## 🎯 End-to-End Type Safety

Pair `nodestack-client` with `nodestack typegen`:

```bash
# Generate TypeScript definitions from your running server
npx nodestack typegen > src/types/nodestack.ts
```

Then supply your `SchemaCollections` dictionary to `NodeStackClient`:

```typescript
import { NodeStackClient } from 'nodestack-client';
import { SchemaCollections } from './types/nodestack';

const client = new NodeStackClient<SchemaCollections>('http://127.0.0.1:8090');

// Autocomplete for collection names: 'posts' | 'users' | 'orders'
// Return types are automatically inferred as PostRecord, UserRecord, etc.
const posts = await client.collection('posts').getList();
posts.items[0].title; // Fully typed!
```

---

## 🛡️ Error Handling

When NodeStack returns an error (4xx or 5xx), a `ClientResponseError` is thrown:

```typescript
import { ClientResponseError } from 'nodestack-client';

try {
  await client.collection('posts').getOne('missing_id');
} catch (err) {
  if (err instanceof ClientResponseError) {
    console.error('Status:', err.status);     // e.g. 404
    console.error('Message:', err.message);   // e.g. "Record not found"
    console.error('Data:', err.data);         // Raw response JSON
    console.error('Is Aborted:', err.isAbort);
  }
}
```

---

## ⚡ Latency & Chaos Simulation (For Testing Frontend States)

Test your frontend loading spinners, skeleton states, error toasts, and retry mechanisms against simulated network conditions:

```typescript
// 1. Query-level simulation
const posts = await client.collection('posts').getList({
  mock_delay: 1500, // 1.5s mobile 3G delay to test loading skeletons
});

// 2. Simulate network drops & HTTP errors
try {
  await client.collection('posts').getList({
    mock_error: 500, // Or ?mock_fail_rate=0.2 for random 20% drops
  });
} catch (err) {
  if (err instanceof ClientResponseError) {
    showToast(`Server error (${err.status}): ${err.message}`);
  }
}

// 3. App-wide chaos simulation toggle (useful during frontend development)
client.setChaos({
  delay: 1000,     // 1000ms delay on all requests
  failRate: 0.15,  // 15% random network drop rate
  errorStatus: 503 // Return 503 on failure
});

// Disable chaos
client.setChaos(null);
```

---

## 🔔 Outbound Webhooks Management & Signature Verification

Manage outbound webhook subscriptions, inspect delivery logs, and cryptographically verify incoming webhook payloads:

```typescript
// 1. Create a webhook subscription
const webhook = await client.webhooks.create({
  name: 'Slack Order Dispatcher',
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

// 4. Retry a failed delivery attempt
if (deliveries.items.length > 0) {
  await client.webhooks.retryDelivery(deliveries.items[0].id);
}

// 5. Verify HMAC-SHA256 signature in your receiving server/microservice
const isValid = client.webhooks.verifySignature(
  rawRequestBodyString,
  requestHeaders['x-nodestack-signature'],
  'whsec_9948a8cf38b1e42c'
);
```

---

## 📄 License

MIT © NodeStack Contributors

