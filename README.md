# 🚀 NodeStack

> **The TypeScript-Native Embedded Backend Stack**
>
> A self-hosted, single-process Backend Stack built natively for Node.js and TypeScript.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%20%7C%2024-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<img width="800" height="500" alt="image" src="https://github.com/user-attachments/assets/8ffc98a7-e5a6-4b9b-bdea-5ea57ab91d00" />

---

## 🌟 Why NodeStack?

Building modern web and mobile apps often requires managing complex database servers, configuring containerized infrastructure, writing boilerplate CRUD APIs, and configuring authentication middleware.

**NodeStack delivers an instant, complete backend stack in a single Node.js process:**
- **Zero-compilation embedded SQLite**: Powered natively by Node.js (`node:sqlite`) with zero C++ compilation steps or external database servers.
- **Instant CRUD & Realtime SSE**: Automatically exposes REST endpoints and Server-Sent Events change streams for every collection.
- **Embedded Web Admin UI**: A sleek, reactive dashboard served directly from `http://localhost:8090/_/` without needing an external web server.
- **Built-in Auth & File Storage**: JWT authentication, bcrypt password hashing, auth collections (`users`), and multi-part file uploads.
- **Auto-Generated TypeScript Definitions**: One-command type generation (`nodestack typegen`) and live HTTP type exports (`GET /_/types.d.ts`) for 100% end-to-end type safety.
- **Interactive OpenAPI 3.0 Reference**: Live Scalar and Swagger UI API documentation and dynamic spec generation at `/_/docs`.
- **One-Click CSV & JSON Import / Export**: RFC 4180-compliant import with auto-delimiter detection and filtered exports.
- **Visual Access Rule Builder**: Intuitive visual clause builder with prebuilt security presets and live syntax validation.
- **Realtime Analytics & Metrics Dashboard**: High-level KPI cards, 24-hour traffic throughput and error rate graphs, database disk usage, and client connection counts.
- **First-Party Client SDK (`nodestack-client`)**: Zero-dependency, lightweight (<10KB) TypeScript/JavaScript client for web apps, React/Next.js, React Native, Node.js, Bun, and Deno.
- **Full TypeScript & npm Extensibility**: Write server hooks, custom routes, and business logic with direct access to the entire 2-million-package npm ecosystem.
- **OOP Architecture with DI / IoC**: Built with Clean Architecture, Inversion of Control, and SOLID principles.

---

## ⚡ Quick Start

### 1. Launch with NPX (Instant Backend)

```bash
npx nodestack start
```

That's it! Visit **`http://localhost:8090/_/`** to complete the first-time admin setup and start designing your schema.

### 2. Create an Admin / Superuser via CLI

```bash
npx nodestack superuser create admin@example.com MySecretPassword123!
```

---

## 💻 Programmatic TypeScript SDK

NodeStack is also an importable framework. You can extend it with custom hooks, middleware, and routes:

```typescript
import { NodeStack } from 'nodestack';

const app = new NodeStack({
  dataDir: './nodestack_data',
  port: 8090,
});

// Custom Lifecycle Hook: Before creating a record
app.onRecordBeforeCreate('posts', async (event) => {
  const { record } = event;
  
  // Custom validation or transformation
  if (!record.title) {
    throw new Error('Post title cannot be blank');
  }

  // Auto-generate slug
  record.slug = record.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  
  // Access any npm package directly!
  console.log(`Creating post with slug: ${record.slug}`);
});

// Custom Lifecycle Hook: After creating a record
app.onRecordAfterCreate('orders', async (event) => {
  // Call Stripe, trigger webhooks, or send push notifications
  console.log('Order created:', event.record.id);
});

// Custom REST API Endpoint
app.router.get('/api/v1/stats', async (req, reply) => {
  return {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    serverTime: new Date().toISOString(),
  };
});

// Start the server
await app.start(8090);
```

---

## 🌐 First-Party Client SDK (`nodestack-client`)

[![npm version](https://img.shields.io/npm/v/nodestack-client.svg?color=blue)](https://www.npmjs.com/package/nodestack-client)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/nodestack-client)](https://www.npmjs.com/package/nodestack-client)

Connect frontend web apps (React, Vue, Svelte, Angular, Solid), mobile apps (React Native / Expo), backend scripts (Node.js, Bun, Deno), and Edge workers to NodeStack using the official lightweight client SDK ([`nodestack-client` on npm](https://www.npmjs.com/package/nodestack-client)):

```bash
npm install nodestack-client
```

### Quick Example

```typescript
import { NodeStackClient } from 'nodestack-client';

const client = new NodeStackClient('http://localhost:8090');

// 1. Authenticate user
await client.collection('users').authWithPassword('user@example.com', 'password123');

// 2. Fetch paginated records with filtering & sorting
const posts = await client.collection('posts').getList(1, 20, {
  filter: "status = 'published' && views >= 10",
  sort: '-created',
});

// 3. Create record with file upload (multipart/form-data)
const formData = new FormData();
formData.append('title', 'My First Post');
formData.append('coverImage', fileInput.files[0]);
const newPost = await client.collection('posts').create(formData);

// 4. File URL helper
const imageUrl = client.files.getUrl(newPost, newPost.coverImage);

// 5. Multiplexed Realtime SSE subscriptions
const unsubscribe = await client.collection('posts').subscribe('*', (event) => {
  console.log(`Action: ${event.action}`, event.record);
});

// 6. 100% End-to-End Type Safety with nodestack typegen
// import { SchemaCollections } from './types/nodestack';
// const typedClient = new NodeStackClient<SchemaCollections>('http://localhost:8090');
// const typedPosts = await typedClient.collection('posts').getList(); // fully typed!
```

> 📖 For full SDK reference, authentication stores, and reactive subscriptions, check out the [`nodestack-client` documentation](packages/client/README.md).

---

## 📦 Features Overview

### 1. Embedded SQLite Relational Engine
- Uses Node 22/24's built-in `node:sqlite` (`DatabaseSync`).
- Runs in **WAL (Write-Ahead Logging)** mode for high concurrency.
- Enforces foreign keys and busy timeouts.
- Pluggable driver interface (`IDatabaseDriver`).

### 2. Instant Dynamic CRUD API
For every collection created, NodeStack automatically generates:
- `GET /api/collections/:collection/records` — Paginated list with filtering & sorting
- `GET /api/collections/:collection/records/:id` — View single record
- `POST /api/collections/:collection/records` — Create record (supports JSON & multi-part file uploads)
- `PATCH /api/collections/:collection/records/:id` — Update record
- `DELETE /api/collections/:collection/records/:id` — Delete record
- `GET /api/collections/:collection/export?format=csv|json` — One-click record export
- `POST /api/collections/:collection/import` — Batch record import (CSV or JSON)

#### Advanced Query Syntax:
- **Pagination**: `?page=1&perPage=25`
- **Sorting**: `?sort=-created,title` (`-` for descending, `+` for ascending)
- **Filtering**: `?filter=(status = 'active' && views >= 100)`
- **Search (Like)**: `?filter=title ~ 'node'`
- **Expand Relations**: `?expand=author,category`

### 3. Collection Access Rules
Control read and write permissions per collection using flexible rule expressions:
- `""` (empty string) → Publicly accessible
- `null` → Admin-only access
- `@request.auth.id != ""` → Authenticated users only
- `id = @request.auth.id` → Users can only view/edit their own profile
- `@request.auth.role = 'editor'` → Role-based authorization

### 4. Realtime Subscriptions (SSE)
- Subscribe to real-time events via Server-Sent Events (`/api/realtime`).
- Handshake and client subscriptions via `NS_CONNECT`.
- Events (`create`, `update`, `delete`) are automatically checked against the user's `viewRule` permissions before broadcast.

### 5. Multi-part File Uploads & Protected Storage
- Direct file uploads via `multipart/form-data`.
- Automatically stored in `${dataDir}/storage/:collectionId/:recordId/:filename`.
- Secure file serving at `/api/files/:collection/:recordId/:filename`.
- MIME type and file size validation defined directly in the collection schema.

### 6. Embedded Web Admin UI
Served directly at `/_/`:
- **First-run onboarding**: Create the first superuser account in seconds.
- **Schema Designer**: Visual table designer with text, number, bool, email, url, date, select, json, file, and relation fields.
- **Data Grid / Record Explorer**: Search, filter, edit, delete, and add records.
- **Visual Access Rule Builder**: Interactive rule builder with security presets and live syntax validation.
- **Analytics & Metrics Dashboard**: Visual KPI cards and 24-hour traffic charts.
- **CSV & JSON Import / Export**: Drag-and-drop CSV importer and one-click filtered dataset exporter.
- **Traffic & Request Inspector**: Inspect HTTP method, status codes, request latency, client IP in real time with quick URL copying.

### 7. Auto-Generated TypeScript Definitions (`nodestack typegen`)
Get 100% end-to-end type safety in frontend and full-stack apps with zero manual maintenance:
- **CLI Generation**:
  ```bash
  npx nodestack typegen > nodestack-types.ts
  # Or write directly to file
  npx nodestack typegen -o ./src/types/nodestack.ts
  ```
- **Live API Endpoint**:
  Fetch real-time schema definitions directly via HTTP:
  - `GET /_/types.d.ts`
  - `GET /api/types.d.ts`
- **What's Generated**:
  - Exact TypeScript interfaces for all collections (`<Name>Record`) and responses (`<Name>Response`).
  - Relation expansion types (`<Name>Expand`) automatically mapped to related collections.
  - Select options literal unions (e.g. `PostsStatusOptions = 'draft' | 'published'`).
  - System collections (auth `UsersRecord` extending `AuthSystemFields`).
  - Top-level schema dictionaries (`Collections`, `CollectionResponses`, `TypedRecord<T>`).

### 8. Interactive OpenAPI 3.0 (Scalar / Swagger) Documentation
Test and inspect endpoints directly in your browser without writing code:
- **Embedded API Viewer**:
  - `GET /_/docs` — Modern, dark-mode **Scalar** reference with multi-language code snippets (cURL, JS, TS, Python, Go) and interactive API sandbox.
  - `GET /_/docs?ui=swagger` — Instant toggle to **Swagger UI**.
- **Live OpenAPI 3.0 Spec**:
  - `GET /api/openapi.json` or `GET /_/openapi.json` — Dynamically updated whenever collection schemas change.
- **CLI Generation**:
  ```bash
  npx nodestack openapi > openapi.json
  # Or write directly to file
  npx nodestack openapi -o ./openapi.json
  ```

### 9. CSV & JSON Import / Export Engine
Easily migrate, backup, and sync collection data:
- **RFC 4180 Compliant CSV Parser**:
  - Auto-delimiter detection (comma `,`, semicolon `;`, or tab `\t`).
  - Full support for multi-line values, escaped quotes (`""`), and UTF-8 BOM sanitization.
- **Batch Import API (`POST /api/collections/:collection/import`)**:
  - Upload CSV files via `multipart/form-data`, send raw `text/csv`, or post a JSON array of records.
  - Automatic type coercion (numbers, booleans, parsed JSON arrays/objects).
  - Transactional safety: atomic inserts with configurable `continueOnError: false` rollback or `continueOnError: true` error reporting.
  - Auth collection support: automatic bcrypt password hashing for imported user records.
- **One-Click Export API (`GET /api/collections/:collection/export?format=csv|json`)**:
  - Direct browser downloads with `Content-Disposition: attachment; filename="<collection>_<timestamp>.csv"`.
  - Respects active filter expressions (e.g. export only `status = 'active'`).
  - Automatic security filtering: sensitive fields like `passwordHash` and `tokenKey` are never exported.

### 10. Visual Access Rule Builder
Design granular permission models without memorizing syntax:
- **Quick-Access Security Presets**:
  - 🔒 **Admin Only (`null`)** — Restricted strictly to authenticated superusers.
  - 🌐 **Public (`""`)** — Accessible to anyone without authentication.
  - 🔑 **Authenticated Users (`@request.auth.id != ""`)** — Requires a valid user JWT.
  - ⚡ **Custom** — Build compound multi-field permission logic.
- **Interactive Visual Clause Builder**:
  - Dropdown selector for collection schema fields and auth variables (`@request.auth.id`, `@request.auth.role`, `@request.auth.email`, `@request.auth.isAdmin`).
  - Supported operators: `=` (Equals), `!=` (Not equals), `>` (Greater than), `>=` (Greater or equal), `<` (Less than), `<=` (Less or equal), `~` (Contains / Like).
  - Flexible logic combining with `AND (&&)` or `OR (||)`.
- **Dual Visual & Formula Modes**:
  - Switch freely between the Visual UI builder and Raw Formula text input.
  - Real-time syntax and parentheses balancing validation.

### 11. Realtime Analytics & Metrics Dashboard
Monitor system health, database load, and traffic in real time:
- **Live KPI Overview**:
  - **Active Records Count**: Total records stored across all collections.
  - **Database Disk Footprint**: Live file size monitoring of the main SQLite database, WAL file, and SHM index.
  - **Realtime Clients**: Count of currently connected Server-Sent Events (SSE) subscribers.
  - **24-Hour Traffic Volume & Error Rate**: Total requests, failed requests percentage, and average latency.
- **Interactive Visual Timeline**:
  - Hourly request volume breakdown over the last 24 hours.
  - Visual error rate markers and peak request hour tracking.
- **Per-Collection Storage Breakdown**:
  - Record distribution and table density visual bars for every collection.
- **Metrics API (`GET /api/metrics`)**:
  - Returns complete JSON analytics payload (requires superuser authorization).

### 12. Latency & Chaos Simulation (For Testing Frontend States)
**The Problem:** When building frontends locally against embedded SQLite, responses return in 0.5ms. You never get to see loading spinners, skeleton states, or error toasts.

**The Solution:** NodeStack features built-in network condition simulation via query parameters, HTTP headers, CLI options, and SDK methods:

- **Simulate Mobile & Network Latency:**
  ```http
  GET /api/collections/posts/records?mock_delay=1500
  ```
  *(Delays response by 1.5 seconds so you can verify loading spinners and skeleton loaders)*
  - Supports ranges for variable mobile latency/jitter: `?mock_delay=500-1500` or `?mock_delay=1.5s`
  - Jitter support: `?mock_delay=1000&mock_jitter=250`

- **Simulate HTTP Server Errors (e.g. 500, 503, 429):**
  ```http
  GET /api/collections/posts/records?mock_error=500
  GET /api/collections/posts/records?mock_error=503&mock_error_message=Service+Unavailable
  ```

- **Simulate Flaky Connections & Random Network Drops:**
  ```http
  GET /api/collections/posts/records?mock_fail_rate=0.2
  ```
  *(Simulates random 20% network drops to test frontend error toasts, retry logic, and error boundaries)*

- **Header-Based Simulation:**
  Works with any HTTP client or browser fetch without changing URL paths:
  ```http
  x-mock-delay: 1500
  x-mock-error: 500
  x-mock-fail-rate: 0.2
  ```

- **Global CLI Simulation:**
  Launch NodeStack with simulated conditions applied across all requests:
  ```bash
  nodestack start --mock-delay 1500 --mock-fail-rate 0.2
  ```

- **First-Party Client SDK Support (`nodestack-client`):**
  ```typescript
  // Per-query simulation
  const posts = await client.collection('posts').getList({ mock_delay: 1500 });

  // App-wide simulation toggle
  client.setChaos({ delay: 1000, failRate: 0.2, errorStatus: 500 });
  ```

### 13. "Reset to Demo State" & Snapshot Baseline (For Live Client Demos & Investor Pitches)

When presenting a live client demo or investor pitch, you create, edit, and delete records to show off features. For the next demo, your data is messy and out of order.

NodeStack includes a built-in **"Snapshot Demo State"** and **"Reset Demo Data"** feature:
- **Freeze the clean state**: Compacts and snapshots the exact SQLite transactional database and uploaded files.
- **Let prospects test freely**: Evaluators can modify rows, upload images, delete entries, and experiment with the app.
- **1-Click instantaneous restore**: Click one button (or call the API/CLI) to restore the exact clean state in `<50ms` before the next presentation.

#### Admin UI Controls
- **Top Bar Widget**: Always-visible demo state indicator with `📸 Snapshot` and `↺ Reset Demo` buttons.
- **Dashboard Overview**: Dedicated **Live Presentation & Demo Mode** card showing baseline snapshot info and real-time live drift detection (`⚠️ +7 records modified during demo`).
- **Confirmation Modals**: Interactive previews of restored collections and records with instant UI refresh via Server-Sent Events (`DEMO_RESET`).

#### CLI Commands
```bash
# Freeze current database and files as demo baseline
npx nodestack demo snapshot -n "Investor Pitch V1"

# Check demo baseline status & live drift
npx nodestack demo status

# 1-Click restore clean baseline before the next pitch
npx nodestack demo reset

# Clear demo snapshot
npx nodestack demo clear
```

#### REST API Endpoints
- `GET /api/demo/status` — Current snapshot metadata and live drift metrics
- `POST /api/demo/snapshot` — Freezes clean demo state (Admin required)
- `POST /api/demo/reset` — 1-click restore to clean demo state (Admin required)
- `DELETE /api/demo/snapshot` — Clears the saved snapshot (Admin required)

#### Client SDK (`nodestack-client`)
```typescript
import { NodeStackClient } from 'nodestack-client';

const client = new NodeStackClient('http://localhost:8090');

// Freeze baseline
await client.demo.snapshot({ name: 'Clean Showcase State' });

// Check drift status
const status = await client.demo.getStatus();
console.log(status.liveStats?.drift.isModified); // true/false

// 1-Click reset from your own frontend demo app!
await client.demo.reset();
```

---

## 🛠️ CLI Reference

| Command | Description |
|---|---|
| `nodestack start` | Start the server and Web Admin UI (default) |
| `nodestack start -d ./data -h 0.0.0.0:8090` | Custom data directory and bind address |
| `nodestack start --mock-delay 1500` | Start with global 1.5s simulated network latency |
| `nodestack start --mock-fail-rate 0.2` | Start with 20% random network drop simulation |
| `nodestack demo snapshot` | Freeze current state as demo baseline (alias: `freeze`) |
| `nodestack demo reset` | Restore exact clean demo state (alias: `restore`) |
| `nodestack demo status` | Inspect demo snapshot metadata & live record drift |
| `nodestack demo clear` | Clear saved demo snapshot |
| `nodestack superuser create` | Interactively create a superuser / admin account |
| `nodestack superuser create <email> <password>` | Create a superuser non-interactively |
| `nodestack typegen` | Generate TypeScript definitions to stdout (alias: `types`) |
| `nodestack typegen -o <path>` | Generate TypeScript definitions directly to a file |
| `nodestack openapi` | Generate OpenAPI 3.0 specification JSON to stdout (alias: `docs`) |
| `nodestack openapi -o <path>` | Generate OpenAPI 3.0 specification JSON directly to a file |

---

## 🏛️ Architecture & Principles

- **Object-Oriented Programming (OOP)**: Clean controller, service, repository, and driver classes.
- **Inversion of Control (IoC) & Dependency Injection (DI)**: Built with a lightweight, type-safe DI container (`Container`, `TOKENS`).
- **Event-Driven Lifecycle**: Interceptable async hooks with cancellation support (`event.cancel('Reason')`).
- **Clean Error Handling**: Semantic error hierarchy (`NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ValidationError`).

---

## 🧪 Running Tests

```bash
npm test
```

Includes 90+ tests across 11 test suites covering IoC DI resolution, RuleEngine AST evaluation, Visual Rule Builder, SQL query filter parser, CSV/JSON import & export, OpenAPI generation, TypeScript typegen, Analytics metrics, REST API, Auth, File uploads, and the Web Admin UI.

---

## 📄 License

MIT © NodeStack Contributors
