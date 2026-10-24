# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-10-23

Release v2.0.0 is a milestone major release introducing complete **Multi-Application Support** across the entire NodeStack ecosystem, upgrading to **TypeScript 7.0** and **Node.js 24+**, introducing generic **Application Snapshots & Checkpoints**, and delivering a 1-click application lifecycle in the Web Admin Dashboard.

### ⚠️ Breaking Changes
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

#### 5. Security & Row-Level Access Rule Enforcement
* **Server-Side Row-Level List Rule Enforcement (`RecordService.getList`, `exportRecords`)**:
  * Implemented `RuleEngine.buildListFilter()` to dynamically resolve declarative access rules (e.g. `@request.auth.id != "" && user = @request.auth.id`) into parameterized SQL WHERE clauses against authenticated callers.
  * Replaced client-side privacy filters with strict server-side boundary enforcement: unauthenticated callers are blocked at the request gate, and authenticated clients cannot view, list, or export records belonging to other users even if custom client filters are submitted.
  * Fixed an empty-parenthesis syntax generation bug in `QueryFilterParser` when sub-filters on unauthorized fields are omitted.
* **E-Commerce Starter Template Hardening**:
  * Updated `orders` and `favorites` collections to enforce owner-scoped access rules (`listRule`, `viewRule`, `updateRule`, `deleteRule`: `@request.auth.id != "" && user = @request.auth.id`).
  * Updated `examples/ecommerce-react` (`OrdersModal.tsx`, `ProductModal.tsx`) to remove unsafe unauthenticated order querying and align with server-side owner scoping.

---

## [1.3.0] - 2026-10-20

Release v1.3.0 delivers three major backend subsystems: Native SQLite FTS5 Full-Text Search (FTSS), an Outbound Webhooks & Delivery Log Engine, and an Immutable Audit Logging subsystem with visual record timeline diffs. It also introduces an official Docusaurus-powered developer documentation site, in-server static docs serving, and Client SDK integrations for webhooks and search.

### Added

#### 1. Native SQLite FTS5 Full-Text Search Subsystem (FTSS)
* **Embedded Virtual Table Indexing**:
  * Automatically provisions `_fts_<collection>` SQLite virtual tables utilizing SQLite's native `FTS5` engine.
  * Real-time index synchronization via atomic SQLite `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` database triggers.
  * Schema-level configurable toggle (`fts: true` or `fts: false`) on any text field.
* **BM25 Relevance Scoring & Ranking**:
  * Real-time BM25 statistical ranking (`ORDER BY rank ASC`) returning an enriched `_score` attribute on query items.
* **Keyword Matching & Highlighting**:
  * Prefix matching (e.g. `type*` matches "typescript", "typedef", "types"), phrase searches (`"exact phrase"`), and multi-token intersections.
  * Contextual highlight snippets (`_snippet`, `_snippets`) with configurable excerpt word length (`snippetLength`) and HTML wrapper tags (`snippetTag`).
* **Query Sanitization**:
  * `sanitizeFtsQuery()` cleanses raw user search input into valid FTS5 MATCH expressions, preventing malformed syntax errors.

#### 2. Outbound Webhooks & Delivery Retries
* **Automated Webhook Subsystem (`WebhookService`)**:
  * Automated HTTP callback dispatch triggered by collection mutations (`create`, `update`, `delete`, or wildcard `*`).
  * Cryptographic HMAC-SHA256 signature generation sent in the `x-nodestack-signature` HTTP request header for downstream verification.
  * Exponential backoff retry engine for failed delivery attempts (status 500+ or network timeouts).
* **Webhooks Management REST API (`/api/webhooks`)**:
  * Full administrative CRUD for registering webhook endpoints, setting secret tokens, and toggling active status.
  * Test payload dispatch endpoint (`POST /api/webhooks/:id/test`) with latency and status code reporting.
  * Delivery audit history inspection (`GET /api/webhooks/deliveries`, `GET /api/webhooks/:id/deliveries`) and manual delivery retry (`POST /api/webhooks/deliveries/:id/retry`).
* **Webhooks Manager in Web Admin UI**:
  * Visual interface for creating webhooks, testing connectivity, and inspecting chronological delivery attempt drawers.
* **Client SDK Integration (`client.webhooks`)**:
  * Methods for `create`, `update`, `delete`, `test`, `getDeliveries`, `retryDelivery`, and `verifySignature(rawBody, signature, secret)`.

#### 3. Immutable Audit Logs & Record History
* **Mutation Audit Engine (`AuditLogService`)**:
  * Automatic capture of all collection mutation operations (`create`, `update`, `delete`) in the `_audit_logs` system collection.
  * Deep field-level `{ old, new }` diff computation identifying exact attribute modifications.
  * Actor attribution tracking (`actorId`, auth collection, client IP, timestamp).
  * Sensitive data masking: automatic password redaction and support for `auditMask: true` on private fields.
* **Record History Timeline Drawer in Admin UI**:
  * Chronological visual audit trail drawer accessible directly from any record in the data grid.
  * Formatted visual diffs highlighting added, modified, and removed attributes.
* **Audit API**:
  * Administrative query endpoints (`GET /api/audit-logs`, `GET /api/collections/:collection/records/:id/history`) and retention pruning (`POST /api/audit-logs/prune`).

#### 4. Developer Documentation & In-App Server Serving
* **Docusaurus v3 Documentation Portal (`docs/`)**:
  * Complete documentation site with Getting Started, Core Concepts, Auth & Security, Realtime, File Storage, Webhooks, TypeScript Server SDK, Client SDK, and Deployment guides.
  * Offline client-side full-text search powered by `@easyops-cn/docusaurus-search-local`.
  * GitHub Pages automated deployment workflow (`.github/workflows/deploy-docs.yml`).
* **In-App Static Documentation Serving (`/documentation/`)**:
  * NodeStack server directly serves the compiled static documentation portal at `http://localhost:8090/documentation/` via `@fastify/static`.
  * Sidebar link in the Web Admin Dashboard for one-click access to the full documentation site.

### Changed
* **Client SDK (`nodestack-client@1.3.0`)**:
  * Added `search`, `snippetTag`, and `snippetLength` parameters to `collection.getList()` for FTS5 queries.
  * Added first-class `client.webhooks` service for endpoint management and HMAC-SHA256 signature verification.
* **Schema Designer**:
  * Added "Enable FTS5" toggle for text fields in the visual Schema Designer.
* **OpenAPI 3.0 Generation**:
  * Dynamic inclusion of Webhooks and Audit Log schemas, request/response models, and parameter descriptions.

### Fixed
* **SQL Query Filter & Search**: Fixed table qualification, namespaced internal SQL column aliases, and query string escaping.
* **Lifecycle Normalization**: Ensured clean EventBus unsubscription and lifecycle hook normalization when disabling extensions.
* **Route Validation**: Added strict HTTP method validation and resolved route shadowing between dynamic plugin routes and core endpoints.

---

## [1.2.0] - 2026-10-14

Release v1.2.0 introduces a modular Plugin Architecture with official community extensions (Stripe, S3, Resend, Webhooks, Algolia), comprehensive Admin UI usability improvements (multi-column search, interactive sorting, command palette, schema drag-and-drop reordering, and action-aware rule summaries), enhanced modal forms with keyboard shortcuts, and responsive layout refinements.

### Added

#### 1. Modular Plugin Architecture & Official Extensions
* **Core Plugin Engine (`PluginManager`, `nodestack.use(plugin)`)**:
  * Chainable plugin registration lifecycle for extending NodeStack capabilities with zero core bloat.
  * Register custom HTTP routes with granular authentication enforcement (`auth: 'admin' | 'user' | 'public'`).
  * Register database mutation lifecycle hooks (`beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, etc.).
  * Register isolated system collections and custom Admin UI navigation items and views.
  * Duplicate plugin registration safeguards and collision rejection preventing accidental alteration of user collections.
* **Official First-Party Plugin Packages (`@nodestackapp/plugin-*`)**:
  * **Stripe (`plugin-stripe`)**: Seamless Stripe checkout sessions, customer portal links, webhook signature verification (`stripe-signature`), and payment events.
  * **S3 Storage (`plugin-s3`)**: Cloud storage backend for AWS S3 and S3-compatible providers (MinIO, Cloudflare R2, LocalStack) with presigned upload/download URLs and `forcePathStyle` path-resolution.
  * **Resend (`plugin-resend`)**: Transactional email delivery via Resend API with automated delivery logging in system collections.
  * **Webhooks (`plugin-webhooks`)**: Outbound webhook dispatches for Discord, Slack, and custom HTTP endpoints triggered on database record mutations, complete with dispatch logs and failure tracking.
  * **Algolia (`plugin-algolia`)**: Automatic search index synchronization on database record mutations, reindexing queues, and batch sync endpoints.
* **Plugin Tooling & CI/CD**:
  * Dedicated build pipeline (`scripts/build-plugins.js`) for ESM, CJS, and `.d.ts` declaration generation.
  * Automated publish utility (`scripts/publish-plugins.js`) with npm auth validation and idempotent version detection.
  * GitHub Actions automated publishing workflow (`.github/workflows/publish.yml`).
* **In-Context Slide-Over Plugin Tester Drawer**:
  * Native interactive testing drawer integrated directly into the Admin UI for all active official extensions.
  * 1-click **`Test Plugin`** trigger in the plugin dashboard, Plugins Hub, and catalog cards that slides open a contextual developer testing workbench.
  * Tailored testing suites for each plugin: Stripe checkout sessions & webhook simulators, S3/MinIO SigV4 presigned upload generators, Resend email dispatchers, Discord/Slack mutation webhook dispatches, and Algolia collection reindexing.
  * Real-time formatted JSON response inspector with latency measurements and direct links to inspect audit collections (`_stripe_payments`, `_s3_uploads`, `_email_logs`, `_webhook_logs`, `_algolia_sync_queue`).


#### 2. Navigation, Spatial Awareness & Command Palette
* **Sidebar Organization & Filtering**:
  * Categorization of collections into collapsible "User Collections" and "System Tables" (`_admins`).
  * Real-time search filter in the sidebar for rapid collection discovery.
* **Breadcrumb Navigation**:
  * Dynamic breadcrumb trail (`Dashboard / Collections / <collection> / Records` or `Schema & Rules`) with clickable ancestor navigation.
* **Global Command Palette (`Ctrl+K` / `Cmd+K`)**:
  * Quick-search modal with keyboard navigation (arrow keys, Enter to jump, isolated ESC handling).
  * Direct actions: jump to collections, navigate views (Analytics, Snapshots, Settings), create collections, and export data.
  * Full ARIA accessibility support and screen reader announcement integration.

#### 3. Records Data Grid Usability
* **Multi-Column Search**: Search across all text, email, and URL fields simultaneously using compound `||` filter expressions.
* **Clickable Column Sorting**: Interactive table header sorting (ascending / descending) with visual sort indicators.
* **Configurable Pagination**: Flexible page size selectors (25, 50, 100 rows per page), page count bounds, and fast page navigation.
* **Auth Collection Support**: Full search and sorting support across authentication collections (`users` email, verified).
* **Slide-Over Record Drawer**: Focus trap management, ESC key dismissal, and ARIA attributes for enhanced record inspection.

#### 4. Schema Designer & Access Rules UX
* **Drag-and-Drop Reordering**: Visual drag handles (`⋮⋮`) and up/down buttons (▲ / ▼) for reordering schema fields.
* **Field Type Visuals & Configurator**: Visual type badges, icons, target collection dropdown for `relation` fields, and allowed-options builder for `select` fields.
* **Action-Aware Rule Builder Summaries**: Natural language rule explanations tailored to specific CRUD operations (`list`, `view`, `create`, `update`, `delete`).

#### 5. Form Validation & Modal Ergonomics
* **Validation & Submit Controls**: Field-level validation messages, disabled submit buttons, and loading states to prevent duplicate submissions.
* **Keyboard Shortcuts**: `Escape` dismissal for all modals, `Ctrl+Enter` / `Cmd+Enter` quick submit from input fields.
* **Autofocus**: Automatic focus on the first editable input upon opening modals.
* **Multipart Form-Data Normalization**: Automatic ISO 8601 normalization for date fields, whitespace trimming for JSON payloads, and graceful empty string handling for blank optional fields.

#### 6. Dashboard Layout & Quick Tools Refinements
* **Responsive Layout Reflow**: CSS grid breakpoints (`repeat(auto-fit, minmax(...))`) for Home KPI vitals and tools cards on mobile and narrow viewports.
* **Quick Action Recipe Launchers**: Direct one-click launcher buttons for starter templates (E-Commerce, Blog, CRM) and Instant JSON Import.
* **Developer Quick Tools**: Streamlined TypeScript TypeGen cards and copyable REST / SSE base URL widgets.

### Security & Reliability Improvements
* **Filter Codec & Escaping**: Implemented shared `FilterCodec` (`QueryFilterParser`) to safely escape quotes, backslashes, and literals in query filters.
* **DOM Attribute Sanitization**: Hardened `renderSortableTh` and `getRecordFileUrl` to prevent injection in dynamic UI attributes.
* **Plugin Isolation**: Guaranteed non-interference of system collection registrations with user collections.

---

## [1.1.0] - 2026-10-04

Release v1.1.0 delivers major developer experience and testing enhancements, introducing one-click mock data generation, automatic schema inference from raw JSON, configurable network chaos simulation, out-of-the-box database starter recipes, and zero-downtime demo state management.

### Added

#### 1. One-Click Mock Data Generator
* **Schema-Aware Generation Engine (`MockDataService`, `FakerEngine`)**:
  * Intelligently generates realistic contextual dummy records based on field types and naming patterns (e.g., names, emails, avatars, addresses, phone numbers, prices, timestamps, status values, markdown content).
  * **Relational Foreign Key Resolution**: Automatically links records to existing rows in referenced collections, or cascades mock generation when target collections are empty.
  * **Auth Collection Support**: Creates authentic auth records with unique emails, pre-verified status, and standard credentials.
  * **Dynamic SVG File Generation**: On-the-fly generation of stylized avatars and placeholder images (`avatar_*.svg`, `image_*.svg`) served seamlessly via `/api/files/:collection/:recordId/:filename`.
  * **Security Gating**: File generation is strictly restricted to declared file field values on records to prevent arbitrary disk filling.
  * **Admin UI & CLI**: Generates mock records directly from the Admin UI collection view or using `nodestack mock <collection> [count]` and `POST /api/collections/:collection/generate-mock`.

#### 2. Instant API From JSON
* **Automatic Schema Inference (`SchemaInferenceService`)**:
  * Ingests arbitrary raw JSON payloads, arrays, or wrapped object formats (`data`, `items`, `records`, `results`, `rows`, `list`, `itemsList`) and instantly infers an optimized schema.
  * Detects data types accurately: `text`, `number`, `bool`, `email`, `url`, `date`, `select` (with inferred enum options), and nested `json`.
  * **Flexible Customization**: Supports field renaming, type overrides (`schemaOverrides`), auto-batching, and index configuration.
  * **Preserved Field Mappings**: Accurately maps renamed fields to original raw JSON keys with collision validation.
  * **Auth Collection Ingestion**: Supports creating auth collections from JSON with automated generation of required auth system columns (`passwordHash`, `tokenKey`).
  * **Admin UI & CLI**: Dedicated "Instant API / Import JSON" modal with live schema preview, and CLI command `nodestack import <file>`.

#### 3. Frontend Latency and Chaos Simulation
* **Network & Failure Simulation Middleware (`ChaosMiddleware`)**:
  * Enables realistic frontend resilience testing by injecting artificial latency, jitter, and network failures into backend responses.
  * **Configurable Parameters**:
    * `mock_delay`: Artificial response delay in milliseconds, supporting ranges (e.g. `100-300`) and duration units (`150ms`, `0.5s`).
    * `mock_jitter`: Random variance applied to base delays.
    * `mock_fail_rate`: Drop/failure rate between `0.0` and `1.0` (or percentages like `20%`).
    * `mock_error`: HTTP error code (e.g. `400`, `401`, `403`, `404`, `500`, `502`, `503`, `504`) or raw TCP socket destruction (`drop`).
  * **Request-Level & Global Control**: Accessible via query parameters (`?mock_delay=...`), HTTP headers (`x-mock-delay`), CLI flags (`--mock-delay`, `--mock-fail-rate`), or the `NodeStackClient` SDK (`client.setChaos(...)`).
  * **Short-Circuit Lifecycle**: Socket drops immediately halt request execution to prevent unintended database mutations.
  * **Production Protection**: Strictly disabled in production mode unless explicitly enabled (`NODESTACK_CHAOS_ENABLED=true`), with automated latency clamping (`maxMockDelayMs`) and safety bypasses for critical paths (`/api/health`, admin authentication).

#### 4. Database Starter Templates Feature
* **Production-Ready Recipes (`TemplateService`)**:
  * One-click starter blueprints with rich schemas, relations, indexes, API access rules, and pre-seeded sample data.
  * **Available Templates**:
    * **E-Commerce (`ecommerce`)**: 4 collections, 48 records, 25 procedural product and category SVG images (Products, Categories, Orders, Reviews).
    * **Blog / Content Platform (`blog`)**: 4 collections, 28 records, 12 procedural SVG covers and avatars (Authors, Tags, Posts, Comments).
    * **SaaS CRM Pipeline (`crm`)**: 4 collections, 26 records, 6 vector logos (Companies, Leads with lead scoring, Deals with pipeline stages, Activities).
  * **Procedural SVG Media Generator (`TemplateImageGenerator`)**: Generates crisp, colorful SVG assets for product thumbnails, avatars, and company branding on disk.
  * **Admin UI & CLI Integration**: Apply templates via the Admin UI Templates modal, CLI command `nodestack template <name> [--overwrite]`, or server startup flag `nodestack start --template <name>`.

#### 5. Demo State Reset Feature
* **Zero-Downtime State Baseline & Reset (`DemoService`)**:
  * Freezes a pristine demo baseline snapshot of the SQLite database and uploaded storage directory (`nodestack demo snapshot`).
  * **Non-Disruptive Maintenance Gate (`MaintenanceGate`)**: Safely drains in-flight requests, pauses and queues incoming HTTP requests, swaps the database file and storage assets, and seamlessly resumes requests against restored state with zero dropped connections.
  * **Drift & Tamper Detection**: Evaluates live changes against snapshot metadata using collection/record/file counts and content state hashing (`isModified`).
  * **Admin UI & CLI**: Quick-action "Reset Demo State" button in the Admin UI navigation bar, REST endpoints (`POST /api/demo/reset`, `GET /api/demo/status`, `POST /api/demo/snapshot`), and CLI command `nodestack demo [status|snapshot|reset|clear]`.

### Security & Reliability Improvements
* **Storage Cleanup Before Schema Drop**: Ensured `deleteCollectionFiles` cleans up physical file storage before dropping SQLite tables, propagating filesystem errors to prevent orphaned storage assets.
* **Short-Circuit on Destroyed Sockets**: Ensured `ChaosMiddleware` drops immediately terminate Fastify request lifecycles without downstream route processing.
* **Deterministic Test Harness**: Enhanced chaos simulation tests with RNG injection to guarantee consistent test runs across CI environments.

---

## [1.0.0] - 2026-03-01

### Added
* Initial release of **NodeStack**, the TypeScript-native backend stack.
* Embedded SQLite database engine with Write-Ahead Logging (WAL) and automated migrations.
* High-performance HTTP server built on Fastify.
* Instant dynamic CRUD endpoints for base and auth collections.
* JWT authentication and token management with password hashing via bcryptjs.
* Realtime Server-Sent Events (SSE) subscriptions for record creations, updates, and deletions.
* File storage service supporting single and multi-file uploads with image preview generation.
* Single-file standalone Admin UI dashboard for collection management, schema editing, and record browsing.
* Interactive OpenAPI 3.0 documentation viewer and JSON export.
* TypeScript type generator (`TypeGenerator`) for compiling collection schemas into end-to-end type definitions.
* Visual Rule Builder and filter expression engine for granular row-level access control.
* Embedded metrics, log streaming, and operational analytics dashboard.
* Official lightweight client SDK (`nodestack-client`).
