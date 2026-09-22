# 🚀 NodeStack

> **The TypeScript-Native Embedded Backend Stack**
>
> A self-hosted, single-process Backend Stack built natively for Node.js and TypeScript.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%20%7C%2024-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🌟 Why NodeStack?

Building modern web and mobile apps often requires managing complex database servers, configuring containerized infrastructure, writing boilerplate CRUD APIs, and configuring authentication middleware.

**NodeStack delivers an instant, complete backend stack in a single Node.js process:**
- **Zero-compilation embedded SQLite**: Powered natively by Node.js (`node:sqlite`) with zero C++ compilation steps or external database servers.
- **Instant CRUD & Realtime SSE**: Automatically exposes REST endpoints and Server-Sent Events change streams for every collection.
- **Embedded Web Admin UI**: A sleek, reactive dashboard served directly from `http://localhost:8090/_/` without needing an external web server.
- **Built-in Auth & File Storage**: JWT authentication, bcrypt password hashing, auth collections (`users`), and multi-part file uploads.
- **Full TypeScript & npm Extensibility**: Write server hooks, custom routes, and business logic with direct access to the entire 2-million-package npm ecosystem (Stripe, OpenAI, Resend, Zod, etc.).
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
- **Realtime Feed**: Table automatically updates when changes occur on the server.
- **Traffic & Request Inspector**: Inspect HTTP method, status codes, request latency, and client IP in real time with quick URL copying.

### 7. Auto-Generated TypeScript Definitions
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

---

## 🛠️ CLI Reference

| Command | Description |
|---|---|
| `nodestack start` | Start the server and Web Admin UI (default) |
| `nodestack start -d ./data -h 0.0.0.0:8090` | Custom data directory and bind address |
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

Includes unit tests for IoC DI resolution, RuleEngine AST evaluation, SQL query filter parser, and full end-to-end integration tests for the REST API, Auth, File uploads, and Admin UI.

---

## 📄 License

MIT © NodeStack Contributors
