# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.1.1] - 2026-10-30

Release v2.1.1 is a maintenance and stability release focused on bug fixes, concurrency hardening, anti-SSRF protections, and performance optimizations across the core backend stack.

### Fixed

#### 1. Security & Anti-SSRF Guardrails
* **Redirect-Aware SSRF Protection**: Hardened `WebhookService` delivery with pinned DNS resolution and redirect-aware `SsrfGuard` validation, preventing DNS rebinding or redirect bypasses to loopback, private IPv4/IPv6 networks, and cloud instance metadata endpoints (`169.254.169.254`).
* **File Storage Directory Traversal & ID Sanitization**: Hardened storage path containment checks to strictly prevent path traversal escapes; validated and preserved record IDs during multipart uploads and ingestion flows.
* **Centralized OAuth Request Timeouts**: Added abort timeout signals across secondary email retrieval requests in `GitHubProvider` and unified timeout protections across OAuth identity providers to avoid hanging authentication requests.

#### 2. Database Concurrency & Transactions
* **SQLite Write Concurrency (`BEGIN IMMEDIATE`)**: Upgraded SQLite write transactions in `NodeSqliteDriver` to `BEGIN IMMEDIATE` to prevent deadlock and write-lock contention under concurrent load.
* **Nested Savepoints**: Added nested transaction support utilizing SQLite savepoints (`SAVEPOINT nodestack_tx_*`).
* **Synchronous Transaction Contract Enforcement**: Guarded SQLite transaction execution by rejecting async Promise-returning callbacks before invocation, preserving synchronous transaction semantics and preventing out-of-transaction query leaks.
* **SQL LIKE Wildcard Escaping**: Properly escaped `%` and `_` wildcards in rule engine and search filter queries to prevent unintended table scans.

#### 3. Authentication & Caching
* **LRU Token Key Cache Eviction**: Corrected in-memory token cache access to promote entries on read hits, ensuring true LRU ordering under high concurrent identity counts.
* **Canonical Session Invalidation**: Resolved canonical record IDs during email-based session revocation (`revokeAdminSessions` and auth collection revocations), ensuring revoked tokens are evicted immediately rather than accepted until TTL expiry.

#### 4. Performance & Scalability
* **Chunked Batch Export**: Refactored `RecordService.exportRecords` to stream database records in 500-record chunks for JSON and CSV exports, eliminating memory spikes and event loop blockage on large datasets.
* **Non-Blocking Password Ingestion**: Switched batch record import password hashing to non-blocking async bcrypt routines.
* **Defensive Log Serialization**: Protected `LogService` request logging against circular references and `BigInt` values, guaranteeing logging errors never crash or interrupt request execution.

#### 5. HTTP & API Specifications
* **Finite Number Validation for Log Pruning**: Guarded `olderThanDays` parameter in `LogController.clearLogs` and `LogService.pruneLogs` with `Number.isFinite()`, returning `400 Bad Request` on `Infinity`, `-Infinity`, `1e309`, or `NaN` rather than triggering unhandled date parsing `RangeError`s.
* **OpenAPI 3.0 Contract Alignment**: Updated OpenAPI definition for `DELETE /api/logs` to document the `olderThanDays` query parameter and corresponding HTTP 200, 204, 400, 401, and 403 response schemas.

---

## [2.1.0] - 2026-10-28

Release v2.1.0 introduces **Embedded Serverless Functions ("NodeStack Functions")** with QuickJS-Wasm isolation, Anti-SSRF guardrails, database lifecycle hooks, and a dedicated 4-tab Admin UI Workbench; adds **OAuth 2.0 & Social Sign-In** with PKCE across 5 major identity providers; delivers **Machine-to-Machine (M2M) API Key Authentication**; and resolves platform stability issues with Windows SQLite connection teardown locks and test resource cleanup leaks.

### Added

#### 1. Embedded Serverless Functions ("NodeStack Functions")
* **QuickJS-Wasm Sandboxed Execution Runtime**:
  * Lightweight WebAssembly-based QuickJS engine (`QuickJsWasmRuntime`) providing isolated in-engine execution of JavaScript and TypeScript functions.
  * Deterministic execution limits: strictly enforced CPU execution timeouts and memory limit caps without blocking the Node.js event loop.
  * Isolated global scope: prevents access to Node.js `process`, `fs`, `child_process`, and host `require`.
* **Anti-SSRF Security Guardrails (`SsrfGuard`)**:
  * Comprehensive URL and IP validation for outbound requests (`ctx.fetch`).
  * Blocks loopback, private IPv4 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), cloud metadata endpoints (`169.254.169.254`), and IPv6 Unique Local Address ranges (`fc00::/7`, link-local, and IPv4-mapped addresses).
  * Enforces HTTP/HTTPS protocol restrictions and configurable per-function domain allowlists.
* **Context API (`ctx`)**:
  * `ctx.request`: Parsed HTTP request body, query parameters, headers, method, and authenticated caller identity (`auth`).
  * `ctx.records`: Scoped database operations (`get`, `list`, `create`, `update`, `delete`) with automatic `RuleEngine` row-level security enforcement or elevated service-role bypass (`elevated: true`).
  * `ctx.env`: Injected application environment secrets without exposing host environment variables.
  * `ctx.log`: In-sandbox console logging captured directly into execution traces.
* **Database Lifecycle Event Hooks**:
  * Execute functions automatically before or after record mutations (e.g. `orders:beforeCreate`, `users:afterUpdate`).
  * Validation and data enrichment: cancel operations by returning `{ cancel: true, reason: "..." }` or mutate records in-flight.
  * Circular recursion guardrails and concurrency admission limits.
* **Functions REST & Admin API**:
  * `ANY /api/functions/:name/invoke`: Dynamic invocation supporting `public`, `auth`, or `admin` authentication policies.
  * `POST /api/functions/:id/test`: Real-time sandboxed test execution with mock context.
  * `GET /api/functions/stats`: Aggregate execution metrics, success rates, and latency stats.
  * `GET /api/functions/logs` & `DELETE /api/functions/logs`: Execution audit logging and payload retention.

#### 2. Admin UI Dedicated Functions Workbench
* **4-Tab Workbench Interface**:
  * **Code & Context Reference**: Full-width minified CodeMirror editor with JavaScript/TypeScript syntax highlighting, automatic theme synchronization (Dark / Light), Ctrl+S save shortcut, starter recipes, and a collapsible Context Reference panel (`ctx.*`) with 1-click code snippets.
  * **Live Test Runner**: Real-time QuickJS sandbox execution runner with mock payload editor, header builder, caller auth selector, latency badges, and formatted response viewer.
  * **Configuration & Triggers**: General settings, authentication policies (`public`, `auth`, `admin`), hook trigger definitions, execution timeout/memory limits, domain allowlists, and scoped environment secrets.
  * **Function Logs & History**: Function-scoped invocation history table with formatted timestamps, status badges, latency metrics, and modal payload inspector for request/response bodies and console output.
* **Modular Component Architecture**:
  * Organized across dedicated companion modules: `functions.js` (overview table & state), `functions-workbench.js` (editor & configuration), and `functions-tester.js` (live sandbox tester & logs).

#### 3. OAuth 2.0 & Social Sign-In (Multi-Provider with PKCE)
* **Identity Provider Integrations**:
  * Built-in support for Google, GitHub, Microsoft, Apple, and Discord OAuth 2.0 providers.
  * RFC 7636 Proof Key for Code Exchange (PKCE) with SHA-256 code challenge generation.
* **Security & Verification Hardening**:
  * Strict email verification validation for GitHub and Microsoft providers.
  * Cryptographic Apple ID token claim verification.
  * Session-bound OAuth state and PKCE verifier protection.
  * Allowed collection authorization enforcement and disabled-provider filtering.
* **Client SDK Integration (`nodestack-client` v2.1.0)**:
  * Added `PkceUtil` for cryptographic verifier and challenge generation.
  * Added `client.collection(col).getOAuthUrl(provider, options)` and popup/redirect authentication handlers.

#### 4. Machine-to-Machine (M2M) Authentication & Scoped API Keys
* **`ApiKeyService` & Management API (`/api/api-keys`)**:
  * High-entropy SHA-256 hashed API keys with prefix identification (`nsk_live_*`).
  * Granular scope definitions, collection-level read/write permissions, role emulation, and expiration controls.
  * Integrated into Fastify `AuthMiddleware` for transparent header-based authentication (`Authorization: Bearer nsk_live_*`).

#### 5. Documentation
* **Functions Documentation Suite (`docs/docs/functions/`)**:
  * Complete developer guides covering Architecture & Overview, Context API reference, Lifecycle hooks, and Security / Anti-SSRF guardrails.
* **Authentication Guides (`docs/docs/auth-and-security/`)**:
  * Detailed setup guides for OAuth 2.0 social sign-in and M2M API Keys.
* Updated Docusaurus sidebar navigation and REST API references.

### Changed
* **Plugin Architecture**: Packaged `@nodestackapp/plugin-chat-notifications` as its own dedicated official plugin workspace, replacing `@nodestackapp/plugin-webhooks` to eliminate naming ambiguity and route collisions with the native Webhooks Manager.

### Deprecated
* **`@nodestackapp/plugin-webhooks`**: Formally deprecated in favor of `@nodestackapp/plugin-chat-notifications` for Discord/Slack chat notifications, and native core Webhooks (`/api/webhooks`) for generic HTTP webhook dispatching.

### Fixed
* **Windows SQLite Database Lock & Resource Leaks**:
  * Resolved `EBUSY: resource busy or locked` errors on Windows caused by dangling `AppRegistry` and `system.db` connections.
  * Added `NodeStack.prototype.close()` which cascades to `AppManager.closeAll()` to cleanly release both tenant database handles and `system.db`.
  * Replaced unclosed `app.db.close()` across CLI commands and test teardowns.
* **Temporary Directory Cleanup**:
  * Resolved unpurged test directories, completely eliminating leftover `tmp_typegen_test_*` and `.test_*` folders during CLI typegen operations and test runs.

---

## [2.0.0] - 2026-10-25

Release v2.0.0 is a milestone major release introducing complete **Multi-Application Support** across the entire NodeStack ecosystem, upgrading to **TypeScript 7.0** and **Node.js 24+**, introducing generic **Application Snapshots & Checkpoints**, complete **System, Light, and Dark Theming** in the Admin Portal, and delivering a 1-click application lifecycle in the Web Admin Dashboard.

### ⚠️ Breaking Changes
* **Package Scope & Version**: The server package is published under `@nodestackapp/server` at major version `2.0.0` (alongside `nodestack-client@2.0.0` and official plugins `@nodestackapp/plugin-*@2.0.0`).
* **Runtime Requirement: Node.js 24+**: NodeStack now requires Node.js v24.0.0 or higher to leverage native modern V8 features and `node:sqlite` enhancements (`"engines": { "node": ">=24.0.0" }`).
* **Toolchain: TypeScript 7.0**: Upgraded core, client SDK, and official plugins to TypeScript `^7.0.2` targeting `ES2024`.

### Added

#### 1. Multi-Application Platform Architecture
* **Tenant Isolation Across All Subsystems**:
  * Physical database file isolation: Every hosted application receives its own embedded SQLite database at `data/<app-id>/data.db`.
  * Physical file storage isolation: Uploaded media and assets are isolated in `data/<app-id>/storage/`.
  * Scoped Authentication: Dedicated user pools, password hashes, and JWT signatures per application.
  * Realtime SSE Isolation: Event streams (`/api/realtime?app=:slug`) deliver collection mutations exclusively to connected clients of that application.
  * Independent Audit Logs & Webhooks: Mutation diff histories and outbound webhook dispatchers are scoped per tenant.
* **App Routing & Dynamic Dispatch**:
  * Subpath routing via `/api/apps/:appId/...` for collections, auth, files, search, and realtime.
  * Request header routing via `x-nodestack-app: <appId-or-slug>` for transparent multi-tenancy without modifying API paths.
  * Query parameter routing via `?app=<appId-or-slug>` for browser EventSource SSE streams.
  * Backward compatibility: Existing single-app instances automatically migrate to the `default` app with zero breaking changes or migration scripts.
* **Application Management REST API (`/api/apps`)**:
  * Full administrative CRUD for listing, provisioning, updating, and deleting application instances.
  * Template-based application initialization supporting `saas`, `blog`, `ecommerce`, or `blank`.
  * Safety guards: The `default` application is protected and cannot be deleted.

#### 2. Web Admin Dashboard Multi-App Experience
* **App Switcher & Navigation**:
  * Reactive application switcher dropdown in the top navigation bar.
  * Real-time UI synchronization: Switching apps reloads collections, schema designer, records grid, audit timeline, and webhooks instantly.
* **1-Click Application Deletion**:
  * Integrated delete button in the App Switcher with safety confirmation modal.
  * Unloads tenant, flushes SQLite WAL files, cleans up directory storage, and smoothly switches the active dashboard back to `default`.
* **Command Palette Integration (`Ctrl + K` / `Cmd + K`)**:
  * Fast actions to switch applications, create new apps, or delete non-default apps directly via keyboard shortcuts.
* **Drawer & Modal Stacking Enhancements**:
  * Corrected z-index hierarchy (`z-index: 1300` for modals and `1400` for command palette) preventing record drawers from overlapping active dialogs.

#### 3. Client SDK (`nodestack-client` v2.0.0)
* **Application Scoping (`client.app(slug)`)**:
  * Returns an app-scoped client instance with automatic `x-nodestack-app` header injection.
  * Scoped Realtime SSE connections via `?app=slug`.
  * Scoped file URL generation (`/api/apps/:appId/files/...`).
* **Application Management Service (`client.apps`)**:
  * Administrative CRUD methods: `client.apps.getList()`, `client.apps.getOne()`, `client.apps.create()`, `client.apps.update()`, and `client.apps.delete()`.
* **Application Snapshots Service (`client.snapshots`)**:
  * Programmatic multi-snapshot management: `client.snapshots.list()`, `client.snapshots.create()`, `client.snapshots.get()`, `client.snapshots.restore()`, `client.snapshots.delete()`, and `client.snapshots.clear()`.
  * Capacity limit safeguard with FIFO eviction confirmation via `{ evictOldest: true }`.

#### 4. Official React E-Commerce Storefront Demo (`examples/ecommerce-react`)
* **Reference Architecture**:
  * Production-ready modern storefront built with React 18, Vite, Tailwind CSS, and the `nodestack-client` SDK.
  * Demonstrates full-stack integration with NodeStack's embedded SQLite backend, multipart file uploads, authentication, and real-time SSE streams.
* **Storefront Capabilities**:
  * **Authentication & Profiles**: User registration, login, JWT session persistence via `LocalAuthStore`, and a 1-click demo customer account (`alex.vance@nodestack.dev`).
  * **Dynamic Reviews & Live Rating Aggregation**: Real-time arithmetic mean computation directly from the `reviews` collection, automatic synchronization on review submission, and 'Verified Buyer' badging for previously purchased items.
  * **Wishlist / Favorites**: Persistent database-backed favorites using the `favorites` collection (`user`, `product`) with row-level security.
  * **Slide-Over Cart & Free Shipping Meter**: Slide-out cart drawer with quantity steppers, subtotal calculations, and a progress bar toward free shipping.
  * **Order Placement & Status Timeline**: Direct order checkout writing to `orders`, an interactive confirmation modal, and a past orders tracker with visual status stepper (`Pending` → `Processing` → `Shipped` → `Delivered`).
  * **Multi-App Scoping**: Built-in support for `VITE_NODESTACK_APP` in `.env.local` to connect seamlessly to tenant-isolated application databases.
* **Starter Template Updates (`src/templates/definitions/ecommerce.ts`)**:
  * Added `favorites` collection with strict row-level access rules (`@request.auth.id != "" && user = @request.auth.id`).
  * Linked relational `user` fields across `orders` and `reviews` for enhanced relational integrity and customer-scoped order querying.
* **Developer Tooling**:
  * Added `npm run demo:backend` and `npm run demo:frontend` scripts for instant development startup.

#### 5. Generic Application Snapshots & Multi-Checkpoint Restoration
* **Self-Contained State Checkpoints (`SnapshotService`)**:
  * Atomic transactional SQLite database snapshots (`VACUUM INTO`) paired with uploaded file storage backups, schema definitions, and deterministic cryptographic content hashes.
  * Multi-snapshot history: Create and retain multiple named or timestamped snapshots across any development, evaluation, or testing workflow.
  * Non-destructive restore: Restoring to an earlier snapshot safely preserves all subsequent checkpoints, allowing free traversal forward and backward across any point in time.
  * 10-snapshot capacity cap with FIFO eviction safeguard: Enforces a hard limit of 10 snapshots per application to prevent unbounded disk growth. Attempting an 11th snapshot requires explicit confirmation (`evictOldest: true`) to safely evict the oldest checkpoint (with HTTP 409 `SNAPSHOT_LIMIT_REACHED` protection).
  * Backward compatibility: Existing `DemoService` and `/api/demo/*` endpoints extend and alias directly to `SnapshotService`.
  * Multi-tenant snapshot isolation: Each hosted application supports its own isolated snapshot history via `/api/apps/:appId/snapshots`.
* **Admin Dashboard Snapshots Manager**:
  * Dedicated dashboard view displaying active baseline status, live drift monitoring, and a chronological history list with records and storage statistics.
  * Capacity limit warning and confirmation dialog when creating a snapshot at the 10-snapshot limit, showing the oldest snapshot's metadata before replacement.
  * Non-destructive 1-click restore modal.
  * Clean, developer-focused typography and interface with no tacky icon boxes or OS emojis.
* **CLI Tooling**:
  * Added `nodestack snapshots [list|create|restore|delete|clear]` with `--evict-oldest` flag support alongside backwards-compatible `nodestack demo` commands.

#### 6. Security & Row-Level Access Rule Enforcement
* **Server-Side Row-Level List Rule Enforcement (`RecordService.getList`, `exportRecords`)**:
  * Implemented `RuleEngine.buildListFilter()` to dynamically resolve declarative access rules (e.g. `@request.auth.id != "" && user = @request.auth.id`) into parameterized SQL WHERE clauses against authenticated callers.
  * Replaced client-side privacy filters with strict server-side boundary enforcement: unauthenticated callers are blocked at the request gate, and authenticated clients cannot view, list, or export records belonging to other users even if custom client filters are submitted.
  * Fixed an empty-parenthesis syntax generation bug in `QueryFilterParser` when sub-filters on unauthorized fields are omitted.
* **E-Commerce Starter Template Hardening**:
  * Updated `orders` and `favorites` collections to enforce owner-scoped access rules (`listRule`, `viewRule`, `updateRule`, `deleteRule`: `@request.auth.id != "" && user = @request.auth.id`).
  * Updated `examples/ecommerce-react` (`OrdersModal.tsx`, `ProductModal.tsx`) to remove unsafe unauthenticated order querying and align with server-side owner scoping.

#### 7. Admin Portal Appearance & Theming (System, Light, Dark)
* **Tri-State Theme Switcher (`ThemeManager`)**:
  * Seamless runtime switching between **Light** (☀️), **Dark** (🌙), and **System** (💻 Auto) modes.
  * Persistent user preferences stored in `localStorage` (`nodestack_theme`) with automatic OS color-scheme synchronization via `window.matchMedia('(prefers-color-scheme: dark)')`.
  * Dedicated 3-way segmented theme selector in the sidebar bottom navigation.
  * Global Command Palette (`Ctrl + K` / `Cmd + K`) quick commands: `Theme: Light Mode`, `Theme: Dark Mode`, and `Theme: System (Auto)`.
* **Zero-Flicker Loading (Anti-FOUC)**:
  * Inlined `<head>` resolution script ensuring zero flash of unstyled content by resolving stored preferences and system settings prior to DOM paint and stylesheet execution.
* **Dual-Palette Semantic Token Design System**:
  * Dual semantic CSS variable palettes (`:root` / `html.dark` and `html.light`) providing WCAG-compliant high-contrast readability across all surfaces, cards, inputs, dialogs, and slide-over drawers.
  * Light-mode optimized navigation states, high-contrast badges for HTTP verbs (`GET`, `POST`, `PATCH`, `DELETE`), system tables, application indicators, and JSON schema field types.
* **Theme-Reactive SVG Analytics Charts**:
  * Real-time chart re-rendering listening to custom `nodestack-theme-changed` events, updating axes, gridlines, data points, and tooltips dynamically without page reloads.

---

### Historical Archives
* For legacy `v1.x` release notes, see [CHANGELOG-v1.md](docs/changelogs/CHANGELOG-v1.md).
