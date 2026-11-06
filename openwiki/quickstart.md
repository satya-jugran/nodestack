---
type: "Reference"
title: "Quickstart & Repository Overview"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-05T17:08:40.212Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-12bfee6a9502bbf40408cc73
    resource: repo://src/cli/cli.ts
  - id: openwiki-source-fe3a0494484969183d43cce8
    resource: repo://src/cli/sea-entry.ts
  - id: openwiki-source-c942457dceafcb8999d7c078
    resource: repo://src/core/config/ConfigService.ts
  - id: openwiki-source-7e1b43beadfd69a26784c63e
    resource: repo://src/core/config/EnvLoader.ts
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
  - id: openwiki-source-b4b029988cbb0f1f8db7496e
    resource: repo://src/NodeStack.ts
  - id: openwiki-source-6ef2b73e0eabdb84d8cc7283
    resource: repo://tests/nodestack.test.ts
generated: { by: "antigravity", at: "2026-11-05T17:08:40.212Z" }
---

# Quickstart & Repository Overview

NodeStack (`nodestack` v2.3.0) is a TypeScript-native embedded backend stack built on `better-sqlite3` and Node's native HTTP server. It combines dynamic SQLite collections, JWT authentication, collection access rules, serverless functions, workflow automation flows, durable background queues, realtime SSE, outbound webhooks, point-in-time snapshots, and a bundled React Admin UI into a single package and CLI.

---

## Documentation Index

- **[Core Architecture & Multi-App Isolation](./architecture-and-multi-app.md)**: `NodeStack` facade, `AppContext` service container, `AppManager` multi-tenant lifecycle, `MaintenanceGate`, and `ConfigService`/`EnvLoader`.
- **[Database, Collections & Record Engine](./database-and-records.md)**: `DatabaseService` (SQLite WAL & system tables), `SchemaService` (`base`/`auth`/`view` collections), `RecordService` CRUD/hooks, `QueryParser` filters, `TypeGeneratorService`, and `SchemaInferenceService`.
- **[Authentication, Security & Access Rules](./auth-and-rules.md)**: `AuthService` (admins, auth collections, OAuth2, OTP/MFA), `RuleEngine` access expressions, `CryptoService` (`scrypt`, HS256 JWTs, AES-256-GCM), `RateLimiter`, and `SsrfGuard`.
- **[Serverless Functions, Automation Flows & Queues](./functions-flows-and-queues.md)**: `FunctionService` VM sandbox (`ctx`), `CronScheduler`, `FlowService` DAG execution, and SQLite-backed `QueueService` jobs and dead-letter queue.
- **[HTTP Server, REST API & Admin Dashboard](./http-and-admin-ui.md)**: `HttpServer`, `Router`, REST endpoint routes (`/api/...` and `/api/apps/:appSlug/...`), OpenAPI 3.0 generation, and the React Admin UI (`ui/`).
- **[Plugins, Starter Templates & Client SDK](./plugins-templates-and-client-sdk.md)**: `PluginManager` and `PluginSdkContext`, built-in plugins (`s3-storage`, `smtp-email`, `stripe-payments`, `openai-assistant`, `csv-exporter`), starter templates (`ecommerce`, `blog`, `crm`), `MockDataService`, and `@nodestackapp/client`.
- **[Files, Realtime, Webhooks, Snapshots & Observability](./storage-and-operations.md)**: `FileStorageService`, `RealtimeService` (SSE), `WebhookService`, `SnapshotService`, `AuditLogService`, `AnalyticsService`, and `LogService`.

---

## Workspace & Repository Layout

| Path | Description |
| :--- | :--- |
| `src/index.ts` | Public library entrypoint exporting `NodeStack`, core services, error classes, and types |
| `src/NodeStack.ts` | Top-level `NodeStack` class orchestrating `AppManager`, `HttpServer`, lifecycle hooks, and multi-app routing |
| `src/cli/cli.ts` | Commander-based CLI (`nodestack`) implementing `start`, `superuser`, `typegen`, `openapi`, `mock`, `import-json`, `template`, `collection`, and `snapshots` |
| `src/cli/sea-entry.ts` | Entrypoint for the bundled Node.js Single Executable Application (`nodestack.exe` / binary) |
| `src/core/` | Core infrastructure: `AppContext`, `AppManager`, `MaintenanceGate`, `EventBus`, `ConfigService`, `EnvLoader`, `CryptoService`, `RateLimiter`, `SsrfGuard` |
| `src/db/`, `src/schema/`, `src/records/`, `src/query/` | SQLite connection layer (`DatabaseService`), collection DDL (`SchemaService`), record CRUD (`RecordService`), and filter parser (`QueryParser`) |
| `src/auth/`, `src/rules/` | Authentication (`AuthService`, `OAuthService`) and rule evaluation (`RuleEngine`) |
| `src/functions/`, `src/flows/`, `src/queues/` | Sandboxed functions (`FunctionService`, `CronScheduler`), automation DAGs (`FlowService`), and durable queues (`QueueService`) |
| `src/files/`, `src/realtime/`, `src/webhooks/`, `src/snapshots/` | Local file storage, SSE subscriptions, outbound webhooks, and point-in-time snapshots |
| `src/audit/`, `src/analytics/`, `src/logger/` | Audit logs (`AuditLogService`), system/traffic analytics (`AnalyticsService`), and buffered HTTP request logs (`LogService`) |
| `src/plugins/`, `src/templates/`, `src/mock/`, `src/typegen/`, `src/docs/` | Plugin catalog & SDK, starter templates, Faker mock generator, TypeScript generator, and OpenAPI 3.0 generator |
| `ui/` | Vite + React 19 + Tailwind CSS Admin UI (`/_/`), built into `dist/ui/` |
| `packages/client/` | Official isomorphic TypeScript/JavaScript SDK (`@nodestackapp/client`) |
| `examples/ecommerce-storefront/` | Reference e-commerce storefront powered by NodeStack and the `ecommerce` template |
| `tests/` | Vitest end-to-end and unit test suites |

---

## CLI Quickstart (`npx nodestack`)

The CLI entrypoint (`src/cli/cli.ts`, exposed as the `nodestack` binary in `package.json`) starts the server or runs offline database management tasks against `--dir <path>` (default `./nodestack_data`).

### Starting the Server

```bash
# Start server on 0.0.0.0:8090 with default ./nodestack_data directory
npx nodestack start

# Start on a custom host/port with a pre-seeded starter template (ecommerce, blog, crm)
npx nodestack start --http 127.0.0.1:8090 --dir ./my_data --template ecommerce

# Enable development mode and chaos/latency simulation
npx nodestack start --dev --mock-delay 500 --mock-fail-rate 0.1 --mock-error 503
```

Once running:
- **REST API**: `http://localhost:8090/api`
- **Admin UI Dashboard**: `http://localhost:8090/_/`
- **Interactive Swagger Docs**: `http://localhost:8090/api/docs/ui`

### CLI Commands Reference

| Command | Aliases | Description |
| :--- | :--- | :--- |
| `nodestack start` | `serve` (default) | Starts the HTTP server and Admin UI (`-d, --dir`, `-h, --http`, `--dev`, `-t, --template`, `--overwrite`, `--mock-delay`, `--mock-fail-rate`, `--mock-error`, `--mock-jitter`) |
| `nodestack superuser create [email] [password]` | `admin create` | Creates a superuser/admin account (prompts interactively if arguments are omitted) |
| `nodestack superuser reset-password [email] [newPassword]` | `admin passwd` | Resets an existing superuser's password |
| `nodestack typegen` | `types` | Generates TypeScript interface definitions from the SQLite collection schemas (`-o, --out <path>`) |
| `nodestack openapi` | `docs`, `swagger` | Generates an OpenAPI 3.0 JSON specification from the SQLite collection schemas (`-o, --out <path>`, `--compact`) |
| `nodestack mock <collection> [count]` | `seed` | Seeds realistic mock records (`default: 25`) using `MockDataService` (`--no-files`, `--no-relations`) |
| `nodestack import-json <collection> <source>` | `import` | Infers a collection schema from a JSON file or inline JSON string and imports its records |
| `nodestack template [name]` | `recipe` | Lists (`-l, --list`) or applies (`ecommerce`, `blog`, `crm`) starter templates (`--overwrite`) |
| `nodestack collection [action] [name]` | `collections` | Lists collections and record counts, or deletes a collection and its files (`delete` / `rm` / `drop`) |
| `nodestack snapshots [action] [target]` | — | Lists, creates (`create` / `take`), restores (`restore` / `reset`), deletes (`delete`), or clears (`clear`) point-in-time snapshots |

---

## Configuration & Environment Variables

On startup, `NodeStack` calls `EnvLoader.load()` (`src/core/config/EnvLoader.ts`), which loads `.env` from the current working directory and `<dataDir>/.env` without overwriting existing `process.env` variables.

| Environment Variable | Constructor Option | Default | Description |
| :--- | :--- | :--- | :--- |
| `NODESTACK_DATA_DIR` | `dataDir` | `./nodestack_data` | Root directory for `data.db`, `storage/`, `.snapshots/`, `.jwt_secret`, `.master_key`, and multi-tenant `apps/` |
| `NODESTACK_HOST` or `HOST` | `host` | `0.0.0.0` | HTTP bind host |
| `NODESTACK_PORT` or `PORT` | `port` | `8090` | HTTP bind port |
| `JWT_SECRET` | `jwtSecret` | `<dataDir>/.jwt_secret` | Secret for signing HS256 JWTs (auto-generated and persisted with `0600` permissions if unset) |
| `NODESTACK_MASTER_KEY` | — | `<dataDir>/.master_key` | Secret used by `CryptoService` to derive AES-256-GCM encryption keys for `_secrets` and `_plugins` |

Runtime settings stored in the `_settings` table (managed via `ConfigService` in `src/core/config/ConfigService.ts` or `/api/settings`) support dot-notation keys (`app.name`, `app.url`, `rateLimit.enabled`, `rateLimit.maxRequests`, `rateLimit.windowMs`, `cors.allowedOrigins`, `auth.tokenExpiry`) and merge `NODESTACK_*` environment variable overrides.

---

## Programmatic Usage (Embedding NodeStack)

Import `NodeStack` from `nodestack` (or `src/index.ts`) to embed the backend directly inside a TypeScript/Node.js application:

```typescript
import { NodeStack } from 'nodestack';

async function main() {
  const app = new NodeStack({
    dataDir: './nodestack_data',
    port: 8090,
    dev: true,
  });

  // 1. Define a collection schema if it doesn't exist
  if (!app.schema.getCollection('posts')) {
    app.schema.createCollection({
      name: 'posts',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_views', name: 'views', type: 'number', defaultValue: 0 },
        { id: 'f_published', name: 'published', type: 'bool', defaultValue: false },
      ],
      listRule: '',   // Public read access
      viewRule: '',   // Public view access
      createRule: '@request.auth.id != ""', // Authenticated users only
    });
  }

  // 2. Register TypeScript record lifecycle hooks
  app.onRecordBeforeCreate('posts', async ({ record }) => {
    record.views = record.views ?? 0;
  });

  // 3. Register custom HTTP routes
  app.router.get('/api/custom-ping', async () => {
    return { message: 'pong', timestamp: Date.now() };
  });

  // 4. Start listening
  await app.start();
}

main();
```

---

## Building, Running & Testing from Source

Defined in `package.json`:

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `npm run dev` | `tsx watch src/cli/cli.ts start --dev` | Runs the backend server in watch mode |
| `npm run dev:ui` | `cd ui && npm run dev` | Runs the Vite React Admin UI dev server |
| `npm run build` | `npm run build:server && npm run build:ui` | Compiles backend TypeScript (`tsc`) and bundles the Admin UI into `dist/ui` |
| `npm test` | `vitest run` | Runs the full Vitest test suite (`tests/*.test.ts`) |
| `npm run demo` | `node scripts/start-demo.cjs` | Starts both the backend with the `ecommerce` template and the reference e-commerce storefront |
| `npm run build:exe` | `node scripts/build-sea.mjs` | Bundles the server, UI, and native SQLite addon into a standalone Node.js Single Executable Application (`src/cli/sea-entry.ts`) |
