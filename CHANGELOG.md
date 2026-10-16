# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
