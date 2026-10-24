# NodeStack

> **The TypeScript-Native Embedded Backend Stack**  
> A self-hosted, single-process backend with embedded SQLite, instant CRUD, Auth, Realtime, Files, FTS5 Search, Webhooks, and Web Admin UI.

[![TypeScript](https://img.shields.io/badge/TypeScript-7.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.5-green.svg)](https://nodejs.org/)
[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/satya-jugran/nodestack/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Documentation](https://img.shields.io/badge/docs-online-blue.svg)](https://satya-jugran.github.io/nodestack/)

<p align="center">
  <img width="800" height="500" alt="NodeStack Admin Dashboard" src="https://github.com/user-attachments/assets/0bcb7416-1cd0-4955-8a87-337bc9aebb12" />
</p>

<p align="center">
  <a href="https://satya-jugran.github.io/nodestack/"><strong>Documentation</strong></a> ·
  <a href="https://satya-jugran.github.io/nodestack/getting-started/quick-start"><strong>Quick Start</strong></a> ·
  <a href="https://satya-jugran.github.io/nodestack/client-sdk/overview"><strong>Client SDK</strong></a> ·
  <a href="https://satya-jugran.github.io/nodestack/api-reference/rest-api"><strong>REST API</strong></a> ·
  <a href="./CHANGELOG.md"><strong>Changelog</strong></a>
</p>

---

## Why NodeStack?

Building modern web and mobile apps often requires managing external database servers, Redis caches, authentication microservices, and boilerplate CRUD route handlers.

NodeStack delivers an instant, complete backend stack in a **single Node.js process**:

* **Zero-Compilation Embedded SQLite**: Powered natively by Node.js (`node:sqlite`). Zero C++ compilers, Python, or external database daemon installations required.
* **Multi-Application Platform (v2.0)**: Host multiple completely isolated application tenants within a single process—with separate SQLite databases, file storage directories, auth collections, realtime SSE buses, and 1-click app deletion.
* **Instant CRUD & Realtime SSE**: Automatically exposes REST endpoints and Server-Sent Events change streams for every collection.
* **Embedded Web Admin Dashboard**: A sleek, reactive dashboard served directly from `http://localhost:8090/_/` without needing an external web server.
* **Native SQLite FTS5 Full-Text Search (v1.3)**: High-performance BM25 relevance scoring, prefix queries, and highlighted snippet excerpts without external search services.
* **Outbound Webhooks Engine (v1.3)**: Event-driven HTTP callbacks with HMAC-SHA256 signature verification and automated retries.
* **Immutable Audit Logs (v1.3)**: Field-level `{ old, new }` diff computation, actor attribution, sensitive field masking, and visual record timeline.
* **Built-in Auth & File Storage**: JWT tokens, bcrypt password hashing, auth collections (`users`), and multipart file uploads with MIME validation.
* **End-to-End Type Safety**: One-command type generation (`nodestack typegen`) and live HTTP type exports (`GET /_/types.d.ts`).
* **First-Party Client SDK (`nodestack-client`)**: Lightweight (<10KB), zero-dependency TypeScript/JavaScript client for web apps, React, Next.js, React Native, Node.js, Bun, and Deno.
* **Full TypeScript Extensibility**: Write server lifecycle hooks, custom routes, and business logic with direct access to npm.

---

## Quick Start

### 1. Launch with NPX (Instant Backend)

```bash
npx nodestack start
```

Visit **`http://localhost:8090/_/`** to complete the first-time admin setup and start designing your schema.

### 2. Create an Admin / Superuser via CLI

```bash
npx nodestack superuser create admin@example.com MySecretPassword123!
```

---

## Programmatic TypeScript SDK

NodeStack is also an importable framework that integrates into your application:

```typescript
import { NodeStack } from 'nodestack';

const app = new NodeStack({
  dataDir: './nodestack_data',
  port: 8090,
});

// Intercept record creation
app.onRecordBeforeCreate('posts', async (event) => {
  const { record } = event;
  if (!record.title) {
    throw new Error('Title cannot be blank');
  }
  record.slug = record.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
});

// Custom REST API endpoint
app.router.get('/api/health', async () => {
  return { status: 'healthy', uptime: process.uptime() };
});

await app.start();
```

---

## First-Party Client SDK (`nodestack-client`)

Connect frontend applications to NodeStack with zero external dependencies:

```bash
npm install nodestack-client
```

```typescript
import NodeStackClient from 'nodestack-client';

const client = new NodeStackClient('http://localhost:8090');

// 1. Authenticate
await client.collection('users').authWithPassword('user@example.com', 'secret');

// 2. Query with FTS5 Full-Text Search & BM25 Scoring
const results = await client.collection('posts').getList(1, 10, {
  search: 'distributed systems',
  snippetTag: 'mark',
});

// 3. Multi-Application Scoping (v2.0)
const shopClient = client.app('shop'); // Automatically scopes headers, SSE, and file URLs
const products = await shopClient.collection('products').getList(1, 10);

// 4. Realtime Server-Sent Events (SSE)
client.collection('posts').subscribe('*', (event) => {
  console.log('Post changed:', event.action, event.record);
});
```

---

## 🛒 Example Applications

### Official React E-Commerce Storefront (`examples/ecommerce-react`)

A modern, full-featured retail storefront showcasing NodeStack's multi-tenancy, authentication, instant CRUD, and real-time capabilities:

* **Authentication & Profiles**: Registration, JWT sessions with `LocalAuthStore`, and 1-click demo login (`alex.vance@nodestack.dev`).
* **Product Catalog & Images**: 20 products across 5 categories with SVG hero imagery served directly via NodeStack file storage.
* **Faceted Search & Filters**: Live search, category pills, price range, in-stock filters, and dynamic star rating computation.
* **Wishlist / Favorites**: Real-time heart toggles synced to the backend `favorites` collection.
* **Cart & Checkout**: Slide-out cart drawer, free shipping threshold progress meter, and order submission to the `orders` collection.
* **Order Tracking & Reviews**: Visual status stepper (`Pending` → `Processing` → `Shipped` → `Delivered`) and verified buyer review forms with live average score updates.
* **Multi-App Scoping**: Configure `VITE_NODESTACK_APP` in `.env.local` to connect seamlessly to isolated tenant databases.

```bash
# 1. Start the NodeStack backend with e-commerce template (Port 8090)
# Instant NPX (no cloning required):
npx @nodestackapp/server start --template ecommerce

# Or locally from this repo:
npm run demo:backend

# 2. Start the React storefront (Port 5173 - requires cloning repo)
npm run demo:frontend
```

---

## Documentation

Full documentation, guides, and tutorials are available on the [Official Documentation Portal](https://satya-jugran.github.io/nodestack/):

| Guide | Description |
| :--- | :--- |
| [**Overview & Architecture**](https://satya-jugran.github.io/nodestack/getting-started/overview) | Single-process architecture, storage engine, and design principles. |
| [**Quick Start**](https://satya-jugran.github.io/nodestack/getting-started/quick-start) | Step-by-step setup in under 60 seconds. |
| [**Collections & Schema**](https://satya-jugran.github.io/nodestack/core-concepts/collections) | Field types, validation, and automated schema inference. |
| [**SQLite FTS5 Search**](https://satya-jugran.github.io/nodestack/core-concepts/fts5-search) | Embedded BM25 relevance scoring and snippet highlighting. |
| [**Visual Access Rules**](https://satya-jugran.github.io/nodestack/core-concepts/access-rules) | Row-level security model and the visual clause builder. |
| [**Multi-Application Platform**](https://satya-jugran.github.io/nodestack/core-concepts/multi-application) | Multi-tenancy, isolated SQLite databases, asset storage, and app scoping. |
| [**Auth & Security**](https://satya-jugran.github.io/nodestack/auth-and-security/authentication) | JWT tokens, bcrypt password hashing, and session revocation. |
| [**Immutable Audit Logs**](https://satya-jugran.github.io/nodestack/auth-and-security/audit-logging) | Field-level diff computation, actor attribution, and timeline drawer. |
| [**Realtime SSE**](https://satya-jugran.github.io/nodestack/realtime/realtime-sse) | Server-Sent Events engine and topic subscriptions. |
| [**Outbound Webhooks**](https://satya-jugran.github.io/nodestack/webhooks/outbound-webhooks) | Automated HTTP callbacks and HMAC-SHA256 signature verification. |
| [**Server SDK & Hooks**](https://satya-jugran.github.io/nodestack/typescript-sdk/lifecycle-hooks) | Database lifecycle hooks and custom Fastify route extensions. |
| [**Client SDK**](https://satya-jugran.github.io/nodestack/client-sdk/overview) | Complete `nodestack-client` usage guide and TypeScript typegen. |
| [**REST API Reference**](https://satya-jugran.github.io/nodestack/api-reference/rest-api) | Interactive Scalar/Swagger UI API docs and OpenAPI 3.0 spec. |
| [**Docker & Deployment**](https://satya-jugran.github.io/nodestack/deployment/docker) | Dockerfile, Docker Compose, systemd unit, and reverse proxies. |

---

## License

MIT © [NodeStack Contributors](https://github.com/satya-jugran/nodestack)
