---
type: "Reference"
title: "Plugins, Starter Templates & Client SDK"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-05T17:08:40.212Z
sources:
  - id: openwiki-source-986c92d89ee5ef388488c0d6
    resource: repo://packages/client/src/auth/BaseAuthStore.ts
  - id: openwiki-source-6a1976513cbe16c8c7d07da3
    resource: repo://packages/client/src/auth/PkceUtil.ts
  - id: openwiki-source-6d68a07b601766bf1c2eeadc
    resource: repo://packages/client/src/Client.ts
  - id: openwiki-source-a4100e72564758f137d4b3ad
    resource: repo://packages/client/src/index.ts
  - id: openwiki-source-378098442bd8cb9dc82ef06a
    resource: repo://src/core/plugins/PluginManager.ts
  - id: openwiki-source-ac1c684b759e2a9c401bbb85
    resource: repo://src/core/plugins/types.ts
  - id: openwiki-source-6cae1b001e47416d9edf6ebb
    resource: repo://src/plugins/index.ts
  - id: openwiki-source-32f68ac341ec06cb0c2bf36b
    resource: repo://src/templates/definitions/index.ts
  - id: openwiki-source-f4bcb5d2f79ee77a9f0d95d3
    resource: repo://src/templates/TemplateImageGenerator.ts
  - id: openwiki-source-830900714b998dab2d6de1b4
    resource: repo://src/templates/TemplateService.ts
generated: { by: "antigravity", at: "2026-11-05T17:08:40.212Z" }
---

# Plugins, Starter Templates & Client SDK

NodeStack is extensible through a first-class plugin system (`PluginManager`), 1-click starter templates (`TemplateService`), and an isomorphic TypeScript Client SDK (`@nodestackapp/client`).

---

## Plugin System (`PluginManager`)

`PluginManager` (`src/core/plugins/PluginManager.ts`) manages plugin registration, dependency resolution, dynamic route mounting, multi-app scope provisioning, and configuration persistence in `_plugin_settings`.

### Plugin Lifecycle & `NodeStackPluginContext`

Plugins can be registered programmatically via `app.use(plugin)` (or `app.plugins.use(plugin)`) as either an `INodeStackPlugin` object or a `NodeStackPluginFunction` (`(context: NodeStackPluginContext) => void | Promise<void>`).

1. **Duplicate & Dependency Validation**: `PluginManager.use()` rejects duplicate plugin registrations and verifies that any `dependencies: string[]` are already registered.
2. **Declarative & Imperative Capabilities (`NodeStackPluginContext`)**:
   - **System Collections (`collections` / `context.registerSystemCollection`)**: Declares `_`-prefixed system collections (`system: true`) in `SchemaService`.
   - **Routes (`routes` / `context.registerRoute` / `context.router`)**: Registers routes on both `/api/...` and `/api/apps/:appId/...`. Uses an internal `find-my-way` `dynamicRouter` (`handleDynamicRoute`) so plugins can be enabled or disabled at runtime **after** Fastify has booted and started listening. Supports `auth` policies (`'admin'`, `'adminOrInitial'`, `'auth'`, `'user'`, `'public'`) and Fastify route hooks (`preParsing`, `preValidation`, `preHandler`, `preSerialization`, `onSend`, `onResponse`, `onError`).
   - **Lifecycle Hooks (`context.registerHook`)**: Subscribes to `EventBus` record hooks (`beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete`, `afterDelete`), server hooks (`beforeServe`, `afterServe`), or custom events. Hook unsubscribers are tracked per plugin and per `AppScope` so disabling a plugin cleanly detaches all listeners.
   - **Admin UI Extensions (`adminNavItems` / `buildAdminNavItems` / `context.registerAdminNav`)**: Injects custom sidebar navigation items and views into the Admin Dashboard.
   - **Lifecycle Callbacks**: `register(context)`, `init(context)` (awaited by `ensureInitialized()` before `app.start()` binds the HTTP port), `onBeforeServe`, `onAfterServe`, and `onDestroy(context)`.

### Configuration Precedence & Secret Masking ("Option B")

Plugins can declare a `configSchema` (`PluginConfigSchema` in `src/core/plugins/types.ts`) with typed fields (`'text' | 'password' | 'number' | 'boolean' | 'select'`). `PluginManager.getPluginConfig()` and `getEffectiveConfig()` resolve each field using a strict 4-tier precedence order:

1. **Environment Variable (`source: 'env'`, `isLocked: true`)**: If `field.envKey` is non-empty in `process.env`, the field is locked (`lockReason: "Managed by environment variable (<ENV_KEY>)"`) and cannot be modified via `PUT /api/plugins/:name/config`.
2. **Database Settings (`source: 'db'`, `isLocked: false`)**: Stored per app in the SQLite `_plugin_settings` table.
3. **Code Options (`source: 'code'`, `isLocked: false`)**: Passed programmatically when constructing the plugin (`plugin.codeOptions`).
4. **Schema Default (`source: 'default'`, `isLocked: false`)**: `field.defaultValue`.

**Write-Only Password Security**: For fields with `type: 'password'`, `getPluginConfig()` never returns the raw secret (`value: undefined`, `hasValue: true`, `maskedValue: '••••••••'`). When `updatePluginConfig()` receives `''`, `undefined`, or `'••••••••'` for a password field, it preserves the existing stored secret unchanged; when a new non-empty string is supplied, it updates `_plugin_settings` and triggers `plugin.onConfigUpdate(effectiveConfig)`.

### Official First-Party Plugins (`OFFICIAL_PLUGINS`)

NodeStack ships with 5 official catalog plugins in `src/plugins/` (also published under `packages/plugin-*`) that can be enabled or disabled per app at runtime via `POST /api/plugins/:name/enable` and `POST /api/plugins/:name/disable`:

| Plugin ID (`packageName`) | System Collection | Capabilities |
| :--- | :--- | :--- |
| `stripe` (`@nodestackapp/plugin-stripe`) | `_stripe_payments` | Creates Stripe Checkout sessions, customer billing portal sessions, and verifies incoming Stripe webhook signatures using `req.rawBody` with audit logs in `_stripe_payments`. |
| `s3-storage` (`@nodestackapp/plugin-s3`) | `_s3_uploads` | Integrates AWS S3, Cloudflare R2, and MinIO with zero-dependency AWS Signature Version 4 (`SigV4`) presigned upload/download URLs and upload tracking in `_s3_uploads`. |
| `resend` (`@nodestackapp/plugin-resend`) | `_email_logs` | Sends transactional emails via the Resend REST API with an automatic dry-run simulation mode (when no API key is configured) and delivery logs in `_email_logs`. |
| `chat-notifications` / `webhooks` (`@nodestackapp/plugin-chat-notifications`) | `_chat_notification_logs` | Dispatches real-time outbound notifications to Discord and Slack webhooks on collection record mutations (`create`, `update`, `delete`) with delivery logs in `_chat_notification_logs`. |
| `algolia` (`@nodestackapp/plugin-algolia`) | `_algolia_sync_queue` | Synchronizes collection records to Algolia search indices on record mutations, maintaining a sync queue and supporting batch re-indexing. |

---

## Starter Templates (`TemplateService` & `TemplateImageGenerator`)

`TemplateService` (`src/templates/TemplateService.ts`) and `STARTER_TEMPLATES` (`src/templates/definitions/index.ts`) provide 1-click backend provisioning for prototyping and full-stack demos.

### Built-In Starter Templates

| Template ID (Aliases) | Collections Created | Seeded Assets |
| :--- | :--- | :--- |
| `ecommerce` (`e-commerce`, `shop`, `store`) | `categories`, `products`, `orders`, `reviews`, `favorites`, `cart_items` (6 collections) | 48 records, 25 custom SVG product/category images, 6 serverless functions, and 2 state-machine flows. |
| `blog` (`content`, `editorial`, `news`) | `authors`, `tags`, `posts`, `comments` (4 collections) | 28 records and 12 SVG author avatars and editorial cover images. |
| `crm` (`saas`, `pipeline`, `sales`) | `companies`, `contacts`, `deals`, `activities` (4 collections) | 26 records and 6 SVG company brand logos. |

### How `TemplateService.apply()` Works

1. **Idempotency & Overwrite Control**: If all target collections already exist and `options.overwrite` is `false`, `apply()` ensures any missing template functions/flows are registered and returns `{ skipped: true }`. When `overwrite: true`, existing template collections and their stored files are dropped in reverse dependency order before recreating.
2. **Relational ID Resolution**: Creates collections in order and maps symbolic relation targets (`fieldCopy.options.collectionId`) to the newly generated collection IDs via `collectionIdMap`.
3. **Zero-Dependency SVG Asset Generation (`TemplateImageGenerator`)**: `TemplateImageGenerator` (`src/templates/TemplateImageGenerator.ts`) synthesizes high-resolution SVG buffers (`generateProductSvg`, `generateCategorySvg`, `generateAvatarSvg`, `generateBlogCoverSvg`, `generateCompanyLogoSvg`) and saves them through `FileStorageService.saveFile()`.
4. **Transactional Bulk Seeding**: Inserts all seeded rows per collection inside a single SQLite `db.transaction()`, emits `afterCreate` on `EventBus`, broadcasts `'create'` events to `RealtimeService`, and registers template serverless functions (`FunctionService.createFunction`) and workflows (`FlowService.createFlow`).

---

## TypeScript Client SDK (`@nodestackapp/client`)

The `@nodestackapp/client` package (`packages/client/src/Client.ts` and `packages/client/src/index.ts`) is a lightweight, zero-dependency isomorphic SDK for browsers, Node.js, React Native, and edge runtimes.

### `NodeStackClient` Core Features

- **Type-Safe Collection Access (`client.collection<T>(name)`)**: Accepts a generated `SchemaCollections` map (`new NodeStackClient<SchemaCollections>(baseUrl)`) so `client.collection('products')` automatically infers record types.
- **Multi-Tenant App Scoping (`client.app(slug)`)**: Returns a lightweight scoped `NodeStackClient` clone that automatically attaches the `x-nodestack-app: <slug>` header to every HTTP request and SSE connection while sharing the parent `authStore`.
- **Automatic Auth & API Key Injection (`client.send`)**:
  - Injects `Authorization: Bearer <apiKey>` when `options.apiKey` is configured, or `Authorization: Bearer <authStore.token>` when authenticated.
  - Automatically strips `Content-Type` when sending `FormData` so the runtime attaches multipart boundaries, and serializes plain objects as `application/json`.
  - Wraps non-2xx HTTP responses and network/abort errors in `ClientResponseError` (`url`, `status`, `data`, `isAbort`, `originalError`).
- **Client-Side Chaos Simulation (`client.setChaos`)**: Injects `x-mock-delay`, `x-mock-error`, `x-mock-fail-rate`, `x-mock-jitter`, and `x-mock-error-message` headers per request or globally on the client instance.

### Authentication Stores & PKCE Utilities

- **`BaseAuthStore` (`packages/client/src/auth/BaseAuthStore.ts`)**: Manages `token` and `model`, decodes JWT `exp` claims via `decodeJwtPayload()` to compute `isValid`, and notifies subscribers via `onChange(callback, fireImmediately)`.
  - **`LocalAuthStore`**: Persists auth state in `localStorage` (falling back to in-memory storage in Node.js/SSR environments).
  - **`MemoryAuthStore`**: Ephemeral in-memory store for server-side or isolated test contexts.
- **`PkceUtil` (`packages/client/src/auth/PkceUtil.ts`)**: Generates cryptographically random RFC 7636 `code_verifier` strings (`generateVerifier`) and SHA-256 `S256` base64url `code_challenge` hashes (`generateChallenge`) using Web Crypto (`crypto.subtle`) or `node:crypto`.

### SDK Service Modules

| Client Property / Method | Service Class | Key Methods |
| :--- | :--- | :--- |
| `client.collection(name)` | `RecordService` | `getList`, `getFullList`, `getOne`, `getFirstListItem`, `create`, `update`, `delete`, `authWithPassword`, `listAuthMethods`, `authWithOAuth2Code`, `listExternalAuths`, `unlinkExternalAuth`, `subscribe`, `unsubscribe`. |
| `client.queue(name)` | `QueueService` | `send`, `sendBatch`, `claim`, `ack` / `complete`, `nack` / `fail`, `touch`, `getJob`, `listJobs`, `retryJob`, `cancelJob`, `retryDlq`, `purge`, `getStats`. |
| `client.functions` | `FunctionService` | `list`, `getOne`, `create`, `update`, `delete`, `invoke`, `test`, `getLogs`, `clearLogs`, `getStats`. |
| `client.flows` | `FlowService` | `list`, `getOne`, `create`, `update`, `delete`, `execute`, `listExecutions`, `getExecution`, `resumeExecution`, `abortExecution`, `recoverExecutions`, `clearExecutions`. |
| `client.realtime` | `RealtimeService` | `subscribe(topic, callback)`, `unsubscribe(topic?)` over Server-Sent Events (`EventSource`) with automatic subscription sync via `POST /api/realtime`. |
| `client.files` | `FileService` | `getUrl(record, filename, options)` for constructing file download URLs with optional token/download parameters. |
| `client.admins` / `client.collections` / `client.apps` | `AdminService`, `CollectionService`, `AppService` | Admin login/setup, collection schema CRUD + JSON schema inference (`inferSchema`, `importJson`), and multi-app workspace CRUD. |
| `client.snapshots` / `client.webhooks` | `SnapshotService`, `WebhookService` | Database snapshot create/restore and webhook subscription CRUD + HMAC signature verification helpers (`computeWebhookSignature`, `verifyWebhookSignature`). |
