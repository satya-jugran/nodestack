---
type: "Reference"
title: "HTTP Server, REST Controllers & Admin UI"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-07T08:27:51.831Z
sources:
  - id: openwiki-source-4bb0492330e9cc8fed4432fd
    resource: repo://src/admin/AdminUIBundler.ts
  - id: openwiki-source-ce6bb6cefe565349b9ae252b
    resource: repo://src/admin/AdminUIService.ts
  - id: openwiki-source-4b46e95a236dd9d00dd0594e
    resource: repo://src/admin/DocsService.ts
  - id: openwiki-source-acead45f06ae0f2780006fee
    resource: repo://src/http/controllers/BaseController.ts
  - id: openwiki-source-826ff3541ab14fed6324dbe6
    resource: repo://src/http/controllers/CollectionController.ts
  - id: openwiki-source-cf690a7623423bc73c1b63dc
    resource: repo://src/http/controllers/RecordController.ts
  - id: openwiki-source-6f6bf6e0619bd66be0c02283
    resource: repo://src/http/HttpServer.ts
  - id: openwiki-source-09877ebcd4536b9a1620c44f
    resource: repo://src/http/middleware/AppResolutionMiddleware.ts
  - id: openwiki-source-3e62e37659aa60446b558759
    resource: repo://src/http/middleware/ChaosMiddleware.ts
generated: { by: "antigravity", at: "2026-11-05T17:08:40.212Z" }
---

# HTTP Server, REST Controllers & Admin UI

NodeStack's HTTP layer is built on Fastify (`HttpServer`) and exposes dual-scoped REST endpoints (`/api/...` for the default application and `/api/apps/:appId/...` for multi-app workspaces), a request pipeline with multi-app resolution and chaos simulation, an embedded single-file Admin Dashboard (`/_/`), and interactive OpenAPI documentation (`/_/docs`).

---

## Fastify HTTP Server (`HttpServer`)

`HttpServer` (`src/http/HttpServer.ts`) initializes the Fastify instance (`logger: false`) and configures plugins, lifecycle hooks, route groups, and error handlers.

### Plugins & Content-Type Parsers

- **CORS (`@fastify/cors`)**: Configured with `origin: true`, `credentials: true`, methods `['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']`, and exposed chaos headers (`x-simulated-delay`, `x-simulated-chaos`, `x-simulated-error`, `x-simulated-fail-rate`).
- **Multipart Uploads (`@fastify/multipart`)**: Configured with a `100 MB` file size limit (`fileSize: 100 * 1024 * 1024`).
- **CSV & Plain Text Parsing**: Registers a custom content-type parser for `text/csv` and `text/plain` (`parseAs: 'string'`) to support direct CSV record imports.

### Request Lifecycle Hooks (`setupHooks`)

1. **`onRequest`**:
   - Assigns a high-resolution start timestamp (`process.hrtime()`) and request ID (`req.id`, `x-request-id`, or `req_<random>`).
   - **Multi-App Scope Resolution**: Invokes `AppResolutionMiddleware.resolve()` to populate `req.appScope` and `req.appContext`.
   - **Maintenance Gate Coordination**: Calls `gate.trackRequestStart(reqId, isExempt)` on the resolved `MaintenanceGate` (exempting snapshot restore and `/api/realtime` SSE routes). If a snapshot restore is locked, immediately returns `503 Service Unavailable`.
   - **Authentication Extraction**: Runs `AuthMiddleware.handle(req)` to populate `req.auth` before downstream checks.
   - **Chaos Simulation**: Invokes `ChaosMiddleware.handle(req, reply)`, short-circuiting route execution if a simulated error or socket drop occurs.
   - **Dynamic Plugin Fast-Path**: Dispatches `GET /api/webhooks/status` to `PluginManager`'s `dynamicRouteHandler` when registered.
2. **`preParsing`**:
   - For non-multipart requests matching a dynamic plugin route (`dynamicRouteMatcher`), buffers the request stream into `(req as any).rawBody` (enabling HMAC signature verification for Stripe/GitHub webhook plugins) and runs any plugin-supplied `preParsing` hooks.
3. **`onResponse` & `onError`**:
   - Releases the in-flight request from `MaintenanceGate` (`gate.trackRequestEnd(reqId)`).
   - Computes request duration in milliseconds and logs the request to the active `AppScope`'s `LogService` (as well as the root `LogService` with `skipConsole: true` when scoped to a non-default app).

### Error & Not-Found Handling (`setupErrorHandler`)

- **`setErrorHandler`**: Maps `AppError` instances directly to `{ statusCode, message, data }` JSON responses; defaults unhandled errors to HTTP `500`.
- **`setNotFoundHandler`**:
  1. First delegates to `dynamicRouteHandler` so runtime-registered plugin routes can handle the request.
  2. Serves the Admin UI SPA (`adminUiService.getHtml()`) for any unmatched `/_/*` path.
  3. Returns a standard `404 Not Found` JSON payload for all other unmatched routes.

---

## Request Middlewares

### `AppResolutionMiddleware`

`AppResolutionMiddleware` (`src/http/middleware/AppResolutionMiddleware.ts`) resolves which `AppScope` handles an incoming request using a 4-tier priority order:

1. **URL Parameter / Path Prefix**: `req.params.appId` or `/^\/api\/apps\/([^\/?#]+)/`.
2. **HTTP Headers**: `x-nodestack-app` or `x-app-id`.
3. **Query String**: `?app=<slug>` or `?appId=<slug>`.
4. **Default Fallback**: Falls back to `'default'`.

Once resolved via `appManager.get(targetApp)`, it attaches `req.appScope` and `req.appContext = { app, slug, id }`. If an unknown app slug is requested on `/_/` or `/_/docs`, it gracefully falls back to the `'default'` app; on `/api/...` routes, it returns `404 Application '<targetApp>' not found`.

### `ChaosMiddleware`

`ChaosMiddleware` (`src/http/middleware/ChaosMiddleware.ts`) simulates mobile network latency, jitter, HTTP 4xx/5xx failures, and raw TCP socket drops so frontend applications can test loading states, error boundaries, and retry logic against local SQLite.

- **Security & Protected Paths**:
  - Request-driven chaos parameters are only honored if the caller is an authenticated admin (`req.auth?.isAdmin === true`) **or** `chaosEnabled` is enabled (true in development mode, false when `NODE_ENV === 'production'`).
  - Critical endpoints (`PROTECTED_PATHS`: `/api/health`, `/api/settings`, `/api/admins/*`, `/api/snapshots/*`, `/api/apps/:appId/snapshots/*`, `/api/realtime`, and `OPTIONS` preflight requests) are strictly immune to chaos injection.
- **Parameter Resolution (`resolveParams`)**: Reads from query parameters (highest priority), request headers, or global `ConfigService` defaults:
  - **Delay (`mock_delay` / `x-mock-delay`)**: Supports numbers (`1500`), duration strings (`"1.5s"`, `"500ms"`), and random ranges (`"500-1500"` or `"500..1500"`), clamped to `maxMockDelayMs` (default `15000` ms). Emits `x-simulated-delay`.
  - **Jitter (`mock_jitter` / `x-mock-jitter`)**: Adds `±jitter` ms variance to the resolved delay.
  - **Fail Rate (`mock_fail_rate` / `x-mock-fail-rate`)**: Probability between `0.0` and `1.0` (or percentage strings like `"20%"`).
  - **Error Status (`mock_error` / `x-mock-error`)**: Any HTTP status `400..599` (emitting `x-simulated-chaos: true` and `x-simulated-error`), or `'drop'` / `'hangup'` / `'reset'` to call `reply.hijack()` and `req.raw.destroy()` to simulate an abrupt TCP connection reset.

---

## REST Controllers

All controllers inherit from `BaseController` (`src/http/controllers/BaseController.ts`), which provides `ok(reply, data, statusCode = 200)`, `noContent(reply)` (`204`), and `error(reply, message, statusCode = 400, data?)`. Each controller resolves its backing services from `req.appScope` first before falling back to the default app's injected service instance.

| Controller | Key Endpoints (available at `/api/...` and `/api/apps/:appId/...`) | Responsibility |
| :--- | :--- | :--- |
| `AppController` | `GET/POST /api/apps`, `GET/PATCH/DELETE /api/apps/:appId` | Super-admin CRUD for multi-tenant `AppScope` workspaces. |
| `CollectionController` | `GET/POST/PATCH/DELETE .../collections`, `POST .../collections/infer-schema`, `POST .../collections/import-json` | Manages collection schemas (`SchemaService`), cleans up collection storage files via `FileStorageService.deleteCollectionFiles()` prior to dropping tables, and runs JSON schema inference/import (`SchemaInferenceService`). |
| `RecordController` | `GET/POST/PATCH/DELETE .../collections/:collection/records`, `GET .../export/:format?`, `POST .../import`, `POST .../generate-mock` | Handles JSON and `multipart/form-data` record CRUD (saving uploaded files via `FileStorageService.saveFile()`), CSV/JSON export and import (`CsvHelper`), and synthetic mock data generation (`MockDataService`). |
| `AuthController` | `POST /api/admins/auth-with-password`, `POST /api/admins/create-initial`, `POST .../collections/:collection/auth-with-password`, `POST .../auth-with-oauth2` | Admin and collection user authentication, OAuth2 code exchange, and external auth linking. |
| `ApiKeyController` | `GET/POST/PATCH/DELETE .../api-keys`, `POST .../api-keys/:id/rotate` | Scoped M2M API key management and rotation. |
| `FunctionController` | `GET/POST/PATCH/DELETE .../functions`, `POST .../functions/:id/test`, `ALL .../functions/:name/invoke` | Serverless function CRUD, execution logs/stats, admin test runner, and public/authenticated HTTP invocation. |
| `FlowController` | `GET/POST/PATCH/DELETE .../flows`, `POST .../flows/:id/execute`, `POST .../flows/executions/:executionId/resume\|abort` | Workflow state machine CRUD, synchronous/asynchronous execution, checkpoint resumption, and cancellation. |
| `QueueController` | `GET/POST/DELETE .../queues`, `POST/GET .../queues/:name/messages`, `POST .../ack\|nack\|touch\|retry`, `POST .../dlq/retry` | Queue configuration, message enqueue/claim/ack/nack/touch, dead-letter queue replay, and retention cleanup. |
| `WebhookController` | `GET/POST/PATCH/DELETE .../webhooks`, `POST .../webhooks/:id/test`, `GET/DELETE .../webhooks/deliveries`, `POST .../deliveries/:id/retry` | Outbound webhook subscription management, test pings, and delivery log inspection/retry. |
| `SnapshotController` | `GET/POST/DELETE .../snapshots`, `POST .../snapshots/:id/restore` | Point-in-time SQLite + storage snapshot creation and restoration. |
| `RealtimeController` | `GET/POST .../realtime` | Server-Sent Events (SSE) connection establishment and topic subscription management. |
| `FileController` | `GET .../files/:collection/:recordId/:filename` | Streams stored record files with MIME type detection and path traversal protection. |
| `AuditLogController` | `GET .../audit-logs`, `GET .../collections/:collection/records/:id/history`, `POST .../audit-logs/prune` | Queries global and per-record data mutation audit trails. |
| `LogController` / `AnalyticsController` / `HealthController` / `TemplateController` | `GET/DELETE .../logs`, `GET .../metrics`, `GET /api/health`, `GET /api/settings`, `GET/POST .../templates` | Request logs, system/latency analytics, health probes, TypeScript definitions (`/api/types.d.ts`), and starter template installation. |

---

## Embedded Admin UI (`AdminUIService` & `AdminUIBundler`)

### `AdminUIBundler`

`AdminUIBundler.bundle(uiDir)` (`src/admin/AdminUIBundler.ts`) compiles the modular frontend source tree under `src/admin/ui/` into a single, self-contained HTML string with zero external local asset dependencies:

1. Reads `src/admin/ui/index.html`.
2. Concatenates and inlines the 6 CSS stylesheets from `src/admin/ui/css/` (`codemirror.css`, `main.css`, `rules.css`, `analytics.css`, `webhooks.css`, `flows.css`) into a `<style>` block before `</head>`.
3. Concatenates and inlines the 27 JavaScript modules from `src/admin/ui/js/` (`codemirror.js`, `state.js`, `theme.js`, `api.js`, `apps.js`, `rules.js`, `schema.js`, `records.js`, `modals.js`, `snapshots.js`, `analytics.js`, `views.js`, `collections.js`, `plugins.js`, `plugin-tester.js`, `command-palette.js`, `webhooks.js`, `functions.js`, `functions-tester.js`, `functions-workbench.js`, `flows.js`, `flows-designer.js`, `flows-designer-forms.js`, `flows-designer-modal.js`, `flows-designer-diagram.js`, `queues.js`, `app.js`) into a `<script>` block before `</body>`.

### `AdminUIService`

`AdminUIService` (`src/admin/AdminUIService.ts`) serves the Admin Dashboard and manages dynamic plugin UI extensions:

- **SEA & Live-Reload Support**:
  - When running inside a Node.js Single Executable Application (`node:sea`), `AdminUIService` loads `admin.html` and `icon.svg` directly from embedded SEA assets (`sea.getAsset()`).
  - In non-production mode (`NODE_ENV !== 'production'`), `getHtml()` re-bundles `src/admin/ui/` on each request for instant live reload.
- **XSS-Safe Script Injection (`serializeForScript`)**:
  - Injects `window.__NODESTACK_PLUGINS__`, `window.__NODESTACK_NAV_ITEMS__`, and `window.__NODESTACK_PLUGIN_CATALOG__` into `<head>`, escaping `<`, `>`, `&`, `\u2028`, and `\u2029` to prevent `<script>` breakout XSS.
- **Routes**:
  - Redirects `/` and `/_` to `/_/`, serves the SPA at `/_/` and `/_/*`, serves brand icons at `/icon.svg` and `/_/icon.svg`, and exposes `/api/admin/nav-items` and `/api/plugins` (plus app-scoped variants).

---

## Interactive Documentation (`DocsService`)

`DocsService` (`src/admin/DocsService.ts`) registers three documentation surfaces on the Fastify instance:

1. **OpenAPI 3.0.3 JSON Specification**:
   - Served at `/api/openapi.json`, `/api/openapi`, `/_/openapi.json`, and `/api/apps/:appId/openapi.json`, dynamically generated from the active `AppScope`'s schema via `OpenApiGenerator`.
2. **Interactive API Reference (`/_/docs`)**:
   - Supports switching between **Scalar** (`/_/docs`, default) and **Swagger UI** (`/_/docs?ui=swagger`), as well as switching between multi-tenant apps via an app selector dropdown (`/_/docs?app=<slug>`).
   - Automatically reads the administrator's session JWT from `localStorage.getItem('nodestack_token')` (or `nb_token`) and pre-authorizes `BearerAuth` for interactive "Try It" requests, displaying an **Admin Token Active** badge in the top bar.
   - Includes a fallback notice (`#offline-notice`) with direct links to `/api/openapi.json` and `/api/types.d.ts` if the CDN is unreachable.
3. **Compiled Docusaurus Portal (`/documentation/`)**:
   - If `docs/build/index.html` exists, mounts `@fastify/static` at `/documentation/` (with redirects from `/docs` and `/_/documentation`); otherwise renders a helpful instructions page (`renderDocsNotBuiltHtml()`) showing how to run `npm run docs:build` or `npm run docs`.
