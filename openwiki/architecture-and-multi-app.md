---
type: "Reference"
title: "Core Architecture & Multi-Application Engine"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-05T17:08:40.212Z
sources:
  - id: openwiki-source-b4b029988cbb0f1f8db7496e
    resource: repo://src/NodeStack.ts
generated: { by: "antigravity", at: "2026-11-05T17:08:40.212Z" }
---

# Core Architecture & Multi-Application Engine

NodeStack is architected around a central orchestrator (`NodeStack`) backed by a lightweight Inversion of Control (IoC) container (`Container`), an asynchronous lifecycle and event dispatcher (`EventBus`), an exclusive maintenance gate (`MaintenanceGate`), and a multi-tenant application isolation engine (`AppRegistry`, `AppManager`, and `AppScope`).

---

## High-Level Architecture

At startup, a single `NodeStack` instance initializes global infrastructure—configuration (`ConfigService`), the system database registry (`AppRegistry`), the multi-application manager (`AppManager`), the Fastify HTTP server (`HttpServer`), and the plugin manager (`PluginManager`)—while delegating tenant-specific state and services to isolated `AppScope` instances.

```
NodeStack (Root Orchestrator & Facade)
 ├── ConfigService (Environment & Directory Paths)
 ├── Container (IoC Dependency Injection via TOKENS)
 ├── AppRegistry (system.db: Global _apps & _admins tables)
 ├── AppManager (Lifecycle & Cache of per-tenant AppScopes)
 │    ├── AppScope ["default"]  ──► apps/default/data.db & apps/default/storage/
 │    ├── AppScope ["ecommerce-demo"] ──► apps/ecommerce-demo/data.db & storage/
 │    └── AppScope ["<slug>"]   ──► apps/<slug>/data.db & apps/<slug>/storage/
 ├── HttpServer (Fastify Server, Controllers & Middlewares)
 │    └── AppResolutionMiddleware (Routes requests to target AppScope)
 └── PluginManager (Global & App-Scoped Plugin Lifecycle)
```

For backwards compatibility, `NodeStack` and `NodeStackOptions` are also exported under the aliases `NodeBase` and `NodeBaseOptions` (`src/NodeStack.ts`, `src/NodeBase.ts`).

---

## Inversion of Control (`Container` & `TOKENS`)

NodeStack uses a zero-decorator dependency injection container (`src/core/container/Container.ts`) keyed by `ServiceIdentifier<T>` (symbols, strings, or class constructors). Canonical service symbols are defined in `TOKENS` (`src/core/container/Tokens.ts`).

### Binding and Resolution

`Container` supports three binding strategies:

- **`bindInstance(token, instance)`**: Registers a pre-constructed singleton instance directly into both the bindings map and singleton cache.
- **`bindFactory(token, factory, isSingleton = true)`**: Registers a factory function `(container: Container) => T`. When `isSingleton` is `true`, the created value is cached after its first resolution.
- **`bindClass(token, ctor, dependencies = [], isSingleton = true)`**: Registers a class constructor along with an array of dependency tokens. Upon `.get(token)`, each dependency token is recursively resolved via `this.get(dep)` and passed to `new ctor(...resolvedDeps)`.

### Container Disposal

Calling `await container.dispose()` iterates through all cached singleton instances and awaits `instance.dispose()` on any service that implements a `dispose` method, then clears both internal maps.

---

## Configuration & Environment Loading (`ConfigService` & `EnvLoader`)

### `.env` Loading (`loadEnvFile`)

Before resolving configuration properties, `ConfigService` invokes `loadEnvFile()` (`src/core/config/EnvLoader.ts`).
- `loadEnvFile(explicitPath?)` checks for a `.env` file (defaulting to `path.resolve(process.cwd(), '.env')`).
- It prefers Node.js native `process.loadEnvFile(targetPath)` when available, with a fallback line-by-line parser that supports `export KEY=VAL`, strips matching outer single or double quotes, ignores `#` comments, and **never overwrites** variables already present in `process.env`.

### `ConfigService` Options and Directory Layout

`ConfigService` (`src/core/config/ConfigService.ts`) merges constructor options (`NodeStackConfigOptions`) with `NODESTACK_*` (and legacy `NODEBASE_*`) environment variables:

| Option / Property | Env Variable(s) | Default | Description |
|---|---|---|---|
| `dataDir` | `NODESTACK_DATA_DIR`, `NODEBASE_DATA_DIR` | `./nodestack_data` | Root directory for all system and app data |
| `port` | `NODESTACK_PORT`, `NODEBASE_PORT` | `8090` | HTTP server listen port |
| `host` | `NODESTACK_HOST`, `NODEBASE_HOST` | `'0.0.0.0'` | HTTP server bind address |
| `jwtSecret` | `NODESTACK_JWT_SECRET`, `NODEBASE_JWT_SECRET` | Auto-generated | 32-byte hex secret persisted to `<dataDir>/.secret` |
| `dev` | `NODE_ENV !== 'production'` | `true` (non-prod) | Enables development features |
| `chaosEnabled` | `NODESTACK_CHAOS_ENABLED`, `NODESTACK_ENABLE_CHAOS` | `this.dev` | Enables Chaos simulation middleware |
| `maxMockDelayMs` | `NODESTACK_MAX_MOCK_DELAY`, `NODESTACK_MAX_DELAY` | `15000` | Maximum allowed chaos latency in ms |
| `queueJobRetentionDays` | `QUEUE_JOB_RETENTION_DAYS`, `NODESTACK_QUEUE_RETENTION_DAYS` | `7` | Retention window for completed/failed queue jobs |

Upon initialization, `ConfigService` ensures `<dataDir>`, `<dataDir>/apps`, and `<dataDir>/storage` exist on disk and provides helper methods for per-application paths:
- `systemDbPath`: `<dataDir>/system.db`
- `getAppDir(slug)`: `<dataDir>/apps/<slug>`
- `getAppDbPath(slug)`: `<dataDir>/apps/<slug>/data.db`
- `getAppStorageDir(slug)`: `<dataDir>/apps/<slug>/storage`
- `getAppSnapshotDir(slug)`: `<dataDir>/apps/<slug>/.snapshots`

---

## Event Bus & Lifecycle Hooks (`EventBus`)

Each `AppScope` owns an isolated `EventBus` (`src/core/events/EventBus.ts`), and the root `NodeStack` instance exposes convenience registration methods (`onRecordBeforeCreate`, `onRecordAfterCreate`, etc.) bound to `defaultApp.eventBus`.

### Hook Categories

1. **Record Before Hooks (`onRecordBeforeCreate`, `onRecordBeforeUpdate`, `onRecordBeforeDelete`)**:
   - Accept either a global handler `(ctx) => ...` or a collection-filtered handler `(collectionName, (ctx) => ...)`.
   - Receive a `RecordBeforeEventContext` containing `{ collection, record, auth, httpContext, isCanceled, cancel(reason?) }`.
   - For `create` and `update`, hooks receive a shallow clone of `record` and can mutate fields in place before persistence; the mutated `ctx.record` is returned to `RecordService`.
   - Calling `ctx.cancel(reason)` sets `isCanceled = true` and immediately aborts execution by throwing an `AppError(reason || 'Operation canceled by hook', 400)`.
2. **Record After Hooks (`onRecordAfterCreate`, `onRecordAfterUpdate`, `onRecordAfterDelete`)**:
   - Receive `RecordAfterEventContext` (`{ collection, record, originalRecord?, auth, httpContext }`).
   - Used internally by `AppScope` to wire up `AuditLogService`, `WebhookService`, and `FunctionService` triggers.
3. **Server Lifecycle Hooks (`onBeforeServe`, `onAfterServe`)**:
   - Triggered in `NodeStack.start()` immediately before and after `HttpServer.listen(port, host)` with `ServeEventContext` (`{ server, port, host }`).
4. **Auth Hooks (`onRecordAuthRequest`)**:
   - Triggered via `triggerAuthRequest(ctx)` with `AuthEventContext` (`{ collection, identity, record, token }`).
5. **Custom Events (`on`, `off`, `emit`)**:
   - Generic string-keyed asynchronous event emitter used for system events such as `snapshot:create`, `snapshot:restore`, and `snapshot:delete`.

All registration methods (`on*`) return an unsubscribe function `() => void`.

---

## Error Hierarchy (`AppError`)

`src/core/errors/AppError.ts` defines structured HTTP-aware errors that `HttpServer` serializes into standardized JSON error responses:

- **`AppError`**: Base class with `statusCode` (default `400`) and optional `data?: Record<string, any>`.
- **`UnauthorizedError`**: Status `401` (`'Unauthorized request'`).
- **`ForbiddenError`**: Status `403` (`'Access denied: insufficient permissions'`).
- **`NotFoundError`**: Status `404` (`'Resource not found'`).
- **`ConflictError`**: Status `409` (`'Resource already exists'`).
- **`ValidationError`**: Status `422` (`'Validation failed'`).
- **`ServiceUnavailableError`**: Status `503` (`'Service temporarily unavailable'`).

---

## Exclusive Operations & Request Draining (`MaintenanceGate`)

`MaintenanceGate` (`src/core/maintenance/MaintenanceGate.ts`) coordinates destructive or exclusive filesystem/database operations—such as snapshot restores and demo resets—with concurrent HTTP traffic.

### Lifecycle of `executeExclusive(action)`

1. **Concurrency Guard**: If `isExecutingExclusive` is already `true`, throws a `409 ConflictError`.
2. **Gate Activation**: Sets `isGated = true` and `isExecutingExclusive = true`.
3. **Request Queuing (`trackRequestStart`)**: Any new non-exempt HTTP request arriving while `isGated` is `true` is held in an in-memory `waitingQueue`. If the gate does not open within `requestQueueTimeoutMs` (default `10000` ms), the queued request rejects with `503 ServiceUnavailableError`. Exempt routes (such as the snapshot reset endpoint itself or SSE streams) bypass the queue.
4. **In-Flight Draining (`drainInFlightRequests`)**: Waits until all currently tracked `activeRequests` finish via `trackRequestEnd(requestId)`, or until `drainTimeoutMs` (default `5000` ms) elapses.
5. **Exclusive Execution & Flush**: Executes `await action()` with zero in-flight database queries, then resets `isGated = false` and resolves all queued requests in FIFO order.

---

## Multi-Application Engine

NodeStack supports hosting multiple isolated applications within a single server process. Each application has its own SQLite database file, file storage directory, snapshots directory, schema, event bus, realtime hub, and background queue.

### 1. System Registry (`AppRegistry`)

`AppRegistry` (`src/apps/AppRegistry.ts`) manages `<dataDir>/system.db`, which stores two global tables:
- **`_apps`**: Stores application metadata (`id`, `name`, `slug` UNIQUE, `description`, `icon`, `isDefault`, `created`, `updated`).
- **`_admins`**: Stores global super-admin accounts (`id`, `email` UNIQUE, `passwordHash`, `tokenKey`, `avatar`, `created`, `updated`).

On initialization, `AppRegistry.init()` ensures two built-in applications are registered in `_apps`:
1. **`default`** (`id: 'app_default'`, `isDefault: 1`): The primary default application, which cannot be deleted (`deleteApp` throws a `400 AppError`).
2. **`ecommerce-demo`** (`id: 'app_ecommerce_demo'`, `isDefault: 0`): The pre-seeded showcase storefront application.

### 2. Application Scope (`AppScope`)

An `AppScope` (`src/apps/AppScope.ts`) encapsulates the complete service stack for a single tenant application:
- Dedicated `DatabaseService` (`apps/<slug>/data.db`), `FileStorageService` (`apps/<slug>/storage`), and `SnapshotService` (`apps/<slug>/.snapshots`).
- Dedicated `MaintenanceGate`, `EventBus`, `FtsService`, `SchemaService`, `TypeGenerator`, `OpenApiGenerator`, `RuleEngine`, `AuthService`, `ApiKeyService`, `RealtimeService`, `LogService`, `RecordService`, `MockDataService`, `AnalyticsService`, `AuditLogService`, `WebhookService`, `FunctionService`, `QueueService`, `FlowService`, and `TemplateService`.
- **Event Wiring**: `AppScope` automatically binds `EventBus` record hooks (`onRecordBefore*` / `onRecordAfter*`) to `AuditLogService.handleRecordEvent`, `WebhookService.handleRecordEvent`, and `FunctionService.handleRecordEvent`, and listens to `snapshot:restore` to reinitialize flow tables and reconcile queues.
- **Legacy Migration (`migrateLegacyDefault`)**: When creating the `default` scope for the first time, if a legacy `<dataDir>/data.db` exists and `<appsDir>/.legacy_migrated` is absent, `AppScope` migrates tables, storage files, and `_admins` records into `apps/default/data.db` and `system.db`.
- **Teardown (`close` / `closeAsync`)**: Disposes the `QueueService`, disconnects all SSE clients on `RealtimeService`, disposes `LogService` and `ApiKeyService`, clears `EventBus` listeners, resets `MaintenanceGate`, and runs a WAL checkpoint before closing the SQLite database driver.

### 3. Application Manager (`AppManager`)

`AppManager` (`src/apps/AppManager.ts`) orchestrates the creation, lazy instantiation, caching, and teardown of `AppScope` instances:
- **`get(slugOrId = 'default')`**: Resolves an `AppScope` by slug or ID from `appCache`. If not yet instantiated, it looks up the `AppModel` in `AppRegistry`, constructs the `AppScope` via `AppScope.create(...)`, caches it under both `slug` and `id`, starts its `QueueService`, and invokes any registered `onScopeInit` callbacks (used by `PluginManager` to wire plugins into newly opened scopes).
- **`create(dto)`**: Creates the metadata record in `AppRegistry`, initializes the `AppScope`, starts its queue, and optionally applies a starter template (`dto.template`) via `scope.templates.apply(...)`.
- **`delete(slugOrId)`**: Closes the cached `AppScope` (terminating SSE connections and closing SQLite handles), deletes the `_apps` entry from `AppRegistry`, and removes `<dataDir>/apps/<slug>` from disk.
- **`ensureDemoAppInitialized()`**: Called during `NodeStack.start()` to idempotently apply the `ecommerce` template, create a baseline snapshot (`ecommerce-demo-baseline`), seed the demo customer account (`alex.vance@nodestack.dev`), and provision the `cart_items` collection on the `ecommerce-demo` scope.

### 4. Request Routing (`AppResolutionMiddleware`)

Incoming HTTP requests are mapped to their target `AppScope` by `AppResolutionMiddleware` (`src/http/middleware/AppResolutionMiddleware.ts`) in the following precedence order:

1. **Route Parameter or URL Path Prefix**: `req.params.appId` or URL matching `/^\/api\/apps\/([^/?#]+)/`.
2. **HTTP Headers**: `x-nodestack-app` or `x-app-id`.
3. **Query String Parameters**: `?app=<slug>` or `?appId=<slug>`.
4. **Default Fallback**: Falls back to `'default'` when no app identifier is provided.

Once resolved, the middleware attaches `req.appScope` and `req.appContext = { app, slug, id }` to the Fastify request object. If a requested application does not exist, API routes receive a `404 Not Found` JSON response, while Admin UI and Docs viewer routes (`/_/` and `/_/docs`) gracefully fall back to the `default` application scope.
