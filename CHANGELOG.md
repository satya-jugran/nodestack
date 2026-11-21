# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.7.0] - 2026-11-21

Release v2.7.0 introduces the native **Job Scheduler & Cron Engine** across the core runtime, HTTP API, Admin UI, and TypeScript Client SDK—enabling durable recurring job scheduling with priority timer wheel wake-ups, configurable missed-run policies (`skip`, `catch_up_once`, `catch_up_all`), concurrency constraints, and direct multi-target dispatching to serverless Functions, visual Flows, and automatic Snapshots; establishes **Fail-Closed Multi-Database Resilience** to eliminate split-brain data corruption when remote databases are unreachable; adds dynamic driver dependency resolution via `DriverPackageLoader`; hardens **Application Snapshot Eviction** and snapshot schedules; and expands the Admin UI with a dedicated visual **Schedules Workbench**.

### Added

#### 1. Native Job Scheduler & Cron Engine
* **Core Scheduler & 5-Field Cron Parser**:
  * Implemented `CronParser` with comprehensive 5-field syntax validation, range evaluation, lists, step intervals (`*/n`), and standard macro shortcuts (`@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`).
  * Engineered `CronService` with an in-memory priority timer wheel avoiding CPU busy loops, dynamic next-run recalculation, timezone offset handling, and automatic wake-up on job expiration.
  * Added configurable missed-run recovery policies (`skip`, `catch_up_once`, `catch_up_all`) to safely manage server reboots and temporary maintenance outages.
  * Supported multi-target execution dispatching:
    * Serverless Functions (`targetType: 'function'`): Executes registered QuickJS WebAssembly functions or inline JavaScript code with custom payload binding.
    * Visual Workflow Flows (`targetType: 'flow'`): Triggers state machine workflows with structured input parameters.
    * Automatic Snapshots (`targetType: 'snapshot'`): Generates point-in-time state checkpoints on recurring schedules with configurable retention (`keepLast`).
  * Embedded durable persistence in `_cron_jobs` and `_cron_runs` system tables with execution latency tracking, status reporting, error logging, and retry backoff.
* **Client SDK & REST API**:
  * Added `CronService` to `@nodestack/client` with methods for schedule creation, updates, deletions, dry-run previews (`client.cron.preview`), manual triggers, and execution log queries.
  * Exposed REST endpoints via `CronController` (`/api/cron/*` and app-scoped `/api/apps/:slug/cron/*`).
  * Integrated dedicated RBAC permission scopes: `cron:read`, `cron:write`, `cron:run`, and `cron:*`.
* **Admin UI Dashboard & Workbench**:
  * Added a dedicated **Schedules** navigation panel (`cron.js`) featuring visual cron expression construction, real-time upcoming execution previews, and comprehensive run log drawers.
  * Deeply integrated scheduling capabilities into the **Functions Workbench** and **Visual Flows Designer**, allowing one-click recurring schedule creation directly from function and flow editors.
  * Added command palette navigation actions for rapid jump-to access (`⌘K` / `Ctrl+K`).

#### 2. Multi-Database Fail-Closed Safety & Dynamic Driver Loading
* **Fail-Closed Resilience on Unreachable Remote Database**:
  * Implemented strict fail-closed partition protection when a configured external database (PostgreSQL/MSSQL) is unreachable or fails connection tests (`ping()`) at startup.
  * Automatically locks the affected app scope (`scope.db.lock(reason)`), halts background queues and cron loops for that tenant, and returns 503 Service Unavailable to prevent split-brain data corruption.
  * Added visual connection alert banners in the Admin UI Database view and diagnostic status reporting via `/api/system/database/status`.
* **Dynamic Driver Resolution (`DriverPackageLoader`)**:
  * Created `DriverPackageLoader` for dynamic resolution of optional external database drivers (`pg`, `mssql`), providing actionable installation instructions when missing.
  * Added protection against circular database migrations when target SQLite paths match the currently active database.

### Fixed

* **Snapshot Eviction & Retention Hardening**:
  * Hardened `SnapshotService` to reject partial evictions, preventing corrupted snapshot states when storage retention limits are reached.
  * Added cron job configuration retention and restoration during snapshot import/export.
* **Cron Execution Lifecycle Edge Cases**:
  * Deferred cron service startup until after database driver initialization and scope unlocking.
  * Preserved inline cron payloads and validated inline function targets during updates.
  * Guarded against concurrent race conditions during cron execution completion status updates.

---

## [2.6.0] - 2026-11-19

Release v2.6.0 delivers the **Unified RBAC Authorization Engine & API Key Ecosystem**—extending fine-grained role-based and scope-based authorization across collections, records, flows, serverless functions, and queues, backed by an interactive real-time API Key Permissions Tester across Admin UI, CLI, and client SDK; establishes the **Plugin Principle of Least Privilege (PoLP)** security architecture with DI container token locking, allowlisted service capabilities, and fault-tolerant EventBus boundaries; introduces a comprehensive **Registration & Verification Hardening Overhaul** eliminating cross-tenant token replay, redacting sensitive verification tokens, and enforcing registry persistence; strengthens **Full-Text Search (FTS)** with equal-cardinality drift detection and dynamic index rebuilds on tokenizer/language changes; supports **Apple OAuth `form_post`** and user payload propagation; hardens **Maintenance Gate Distributed Locks** with liveness awareness and shutdown connection draining; and refactors the serverless functions **Observability Logger API** (`core.observability.logger`).

### Added

#### 1. Unified RBAC Authorization Engine & API Key Ecosystem (PR #45)
* **Unified RBAC Authorization Engine**:
  * Implemented centralized, cross-subsystem authorization enforcing granular read, write, and execute permissions across collections, records, serverless functions, workflow flows, and background queues.
  * Enforced authorization at service boundaries (`FlowService`, `FlowController`) with strict actor identity validation (`actor` check on flows).
  * Enforced explicit `read` scope requirements for queue claim operations (`queues:claim`).
* **Automatic Role Downgrade Safeguards**:
  * Automatically strips wildcard permissions (`*`, `admin:*`) when an API key or actor role is downgraded, eliminating retained administrative privileges.
* **Interactive API Key Permissions Tester**:
  * **Admin UI**: Added interactive permission testing and real-time access simulation workbench in `api-keys.js` with matched scope details, reason codes, and ready-to-run `curl` commands.
  * **CLI (`nodestack api-keys test`)**: Added `nodestack api-keys test <id> -s <subsystem> -r <resource> -x <action> [--ip <ip>] [--json]` simulation command in `cli.ts`.
  * **Client SDK**: Added `client.apiKeys.simulate(options)` to `nodestack-client` (`ApiKeyService.ts`).
  * **REST Endpoints**: Added `POST /api/api-keys/simulate` and `POST /api/api-keys/:id/simulate` (and tenant-scoped `/api/apps/:appId/api-keys/simulate`).
* **Atomic Quota & Pagination Sanitization**:
  * Enforced atomic quota checks and balance deductions for API keys.
  * Validated integer parameters for `limit` and `offset` pagination to prevent invalid query payloads.

#### 2. Apple OAuth `form_post` & User Metadata Support (PR #42, #43)
* **Apple `response_mode=form_post` Support**:
  * Added first-class support in `AppleProvider` and `HttpServer` for Apple's form-post OAuth callback mode.
  * Accurately propagated and stored Apple's one-time user profile payload (`firstName`, `lastName`, `email`) on first sign-in.

### Security

#### 1. Plugin Sandboxing & Principle of Least Privilege (PoLP) (PR #40)
* **Container & Token Locking**:
  * Sealed DI container tokens prior to autoloading third-party plugins in `Container.ts` and restricted `PluginManager` to an isolated application facade.
* **Service Allowlisting & Tenant Isolation**:
  * Implemented strict service token allowlisting, preventing plugins from resolving tenant-scoped bindings or accessing internal database handles directly.
  * Scoped plugin configurations to isolated tenant boundaries.
* **EventBus Fault-Tolerance**:
  * Isolated EventBus listener errors so exceptions thrown by third-party plugin handlers do not disrupt the event dispatch loop or other listeners.
  * Added queue in-flight callback awaits to prevent unhandled background rejections.

#### 2. Registration & Email Verification Hardening (PR #41)
* **Cross-Tenant Replay Prevention**:
  * Verification tokens are cryptographically bound to the recipient's email address and tenant scope, preventing token reuse across tenants.
* **Token Redaction & Persistence**:
  * Redacted verification tokens from public HTTP response bodies.
  * Persisted admin verification state directly in `AppRegistry` with database write confirmation and eliminated connection leak vectors.
* **Self-Verification Exploit Mitigation**:
  * Blocked unauthorized self-verification exploits on record update payloads (`PATCH /api/collections/users/records/:id`).

#### 3. Distributed Maintenance Gate & Liveness Locking (PR #43, #44)
* **Atomic & Liveness-Aware Locks**:
  * Implemented atomic maintenance lock acquisition with liveness-aware heartbeat timeouts in `MaintenanceGate.ts` to prevent deadlocks and stale lock holding.
  * Verified caller lock ownership prior to lock release to eliminate out-of-order unlocks.
* **Graceful Shutdown Draining**:
  * Ensured active HTTP requests and background queue workers drain completely before entering maintenance mode.

### Changed & Refactored

#### 1. Core Observability Logger API
* **Structured Logger in Functions Runtime (`1363509`)**:
  * Refactored serverless function observability to use `core.observability.logger` (`log`, `info`, `warn`, `error`) and `core.observability.metric(name, value, tags)` across `QuickJsWasmRuntime`, CodeMirror workbench, and starter templates.
  * Maintained seamless redirection for `console.log` into execution audit logs.

#### 2. Full-Text Search (FTS) Rebuilds & Drift Detection (PR #42, #44)
* **Equal-Cardinality Drift Detection**:
  * Detected and resolved subtle cardinality drift between collection records and underlying FTS virtual tables in `FtsService.ts`.
* **Dynamic Rebuilds on Tokenizer/Language Changes**:
  * Automatically drops and recreates FTS indexes when schema tokenizers or language settings change across SQLite FTS5, PostgreSQL FTS, and MSSQL FTS drivers, preserving custom language options on rebuild.
  * Ensured synchronous FTS error propagation.

#### 3. Core Stability & Concurrency Fixes (PR #43, #44)
* **Race Condition Fixes**:
  * Resolved race conditions on concurrent duplicate ID record insertions.
* **Relation Expansion Validation**:
  * Strictly rejected non-ID relation items in `RecordValidator.ts`.
* **Flow State Reachability**:
  * Added support for `catch` transitions during state machine flow reachability analysis.
* **Dev Mode Localhost CORS (`d0ed5b4`)**:
  * Fixed localhost CORS preflight handling for local Vite/React development servers.

---

## [2.5.0] - 2026-11-15

Release v2.5.0 introduces **Native Multi-Database Support**—expanding NodeStack beyond SQLite to include first-class support for **PostgreSQL** and **Microsoft SQL Server (MSSQL)** with dynamic driver hot-swapping, zero-downtime live migrations, multi-engine Full-Text Search (FTS), and dual synchronous/asynchronous background queue engines; adds a dedicated **Admin UI Database Manager** and `nodestack db` CLI commands; delivers an extensive **Security Hardening Overhaul** addressing initial setup authorization, tenant privilege escalation, API key HMAC-SHA256 hashing, granular API key scopes, cryptographically validated OAuth state sessions with SSRF protection, wildcard CORS credential reflection mitigation, PostgreSQL SSL certificate enforcement, and realtime SSE subscriber privacy; and wraps all schema migrations in atomic database transactions with concurrency race condition prevention.

### Added

#### 1. Multi-Database Architecture (PostgreSQL, MSSQL, SQLite)
* **Unified Dialect Engine (`ISqlDialect`, `DriverRegistry`)**:
  * Implemented an extensible SQL dialect architecture with `SqliteDialect`, `PostgresDialect`, and `MssqlDialect` handling engine-specific query rendering, camelCase identifier quoting, boolean record normalization, and upsert semantics.
  * Added optional peer dependencies for `pg` (^8.11.0) and `mssql` (^10.0.0 || ^11.0.0 || ^12.0.0).
  * Maintained control plane system tables on embedded SQLite while allowing independent, per-tenant data store routing to PostgreSQL and MSSQL.
* **Multi-Engine Full-Text Search (FTS)**:
  * Implemented dedicated FTS drivers: `SqliteFts5Driver` (SQLite FTS5 / BM25), `PostgresFtsDriver` (PostgreSQL `to_tsvector` / `ts_rank_cd`), and `MssqlFtsDriver` (MSSQL `CONTAINSTABLE`).
  * Unified search predicates, snippet generation, and reserved field handling across all supported database engines.
* **Dual Queue Engine Architecture (`SyncQueueEngine`, `AsyncQueueEngine`)**:
  * Refactored `SqliteQueueDriver` into specialized queue engines: `SyncQueueEngine` for synchronous in-process SQLite execution and `AsyncQueueEngine` for asynchronous connection pooling in PostgreSQL and MSSQL.
  * Preserved full transactional queue guarantees, strict partition FIFO ordering, lease renewals, and dead-letter queue (DLQ) isolation across all engines.
* **Cross-Engine Snapshots & Portable Migration**:
  * Added `LogicalSnapshotDriver` and `SqliteToRemoteSnapshotDriver` for portable schema and record export/import across heterogeneous database engines.
  * Confined physical raw binary snapshots strictly to SQLite to prevent snapshot corruption.
* **Per-Schema Storage Metrics**:
  * Added real-time calculation and reporting of database storage size broken down per schema and collection table.

#### 2. Database Management in Admin UI & CLI
* **Admin UI Database View (`database.js`)**:
  * Added a dedicated Database pageview in the Admin Portal displaying active provider, connection health, live latency, and storage analytics.
  * Added interactive connection test utilities for PostgreSQL and MSSQL prior to cutover.
  * Real-time progress bar and phase reporting during live database migrations.
* **Database Management CLI (`nodestack db`)**:
  * Added `nodestack db status`, `nodestack db test`, `nodestack db configure`, and `nodestack db switch` CLI commands with interactive progress rendering and confirmation safety gates.

#### 3. Documentation & Developer Guides
* **Roles & Permissions Guide**: Published comprehensive documentation at `docs/docs/auth-and-security/roles-and-permissions.md`.
* **Database Management API Reference**: Documented `/api/system/database/*` endpoints in the official REST API reference.

### Security

#### 1. Authentication, Tenant Isolation & Privilege Escalation
* **Initial Setup Authorization Bypass & Admin Creation Race (PR #34)**:
  * Resolved an authorization bypass vulnerability on the initial setup endpoint (`/api/setup`).
  * Eliminated race conditions during initial superuser/admin account creation.
* **Tenant Admin & API Key Privilege Escalation Prevention (PR #33)**:
  * Enforced strict tenant boundary validation to prevent tenant-scoped admins and tenant API keys from escalating to global superuser privileges.
  * Restricted global API key fallback when accessing tenant-scoped resources.
  * Enforced tenant-scoped admin creation and response schema compliance.

#### 2. API Key Security & Granular Scopes (PR #37, `0ac15f3`)
* **HMAC-SHA256 Key Hashing**:
  * Migrated API key storage from reversible representations to salted HMAC-SHA256 hashing.
  * Resolved key rotation migration race conditions.
  * Enforced granular API key scopes across queue endpoints and serverless functions.
  * Rejected invalid tokens with standard 401 Unauthorized status and prevented fallback on empty keys.

#### 3. OAuth2 State Validation & SSRF Guard (PR #36, `ebe19ec`)
* **Session-Scoped State & Cookie Validation**:
  * Enforced cryptographically secure OAuth state validation with session-scoped, provider-specific state cookies.
  * Synchronized OAuth state store invalidation across concurrent requests.
  * Validated OAuth callback collection binding and applied per-request OAuth scopes.
* **OAuth Avatar SSRF Mitigation**:
  * Guarded against Server-Side Request Forgery (SSRF) when fetching user avatars from external OAuth identity providers.

#### 4. CORS Hardening & Credential Protection (PR #32, `e1eeb6a`)
* **Wildcard CORS Reflection Fix**:
  * Fixed credential reflection vulnerability when wildcard origins are requested.
  * Explicitly disabled credentials for wildcard origin arrays and excluded `*` from trusted CORS origin sets.
  * Made CORS RegExp origin matching strictly stateless and honored explicit `origin: false`.

#### 5. Realtime SSE Privacy & Subscription Hardening (PR #35)
* **Email Data Leakage Fix**:
  * Prevented user email addresses and sensitive profile attributes from leaking through realtime SSE event payloads.
* **Realtime Scopes & Dynamic Revalidation**:
  * Enforced API key realtime scopes on SSE subscription endpoints.
  * Implemented dynamic session revocation and revalidation for active realtime event streams.

#### 6. Network, Filesystem & Execution Safety
* **Postgres SSL Verification (PR #38)**:
  * Enforced strict Postgres SSL certificate verification with CA validation by default.
* **Webhook SSRF & DNS Rebinding Protection**:
  * Enforced strict target URL validation before webhook delivery with DNS rebinding defenses.
* **Filesystem Containment**:
  * Confined SQLite database file paths within project data boundaries to eliminate arbitrary file writing and path traversal.
  * Prevented directory path traversal in file handling and sanitized `Content-Disposition` headers.
  * Fixed stored XSS vulnerabilities during file downloads.
* **Sandboxed Runner & Rule Hardening**:
  * Enforced hard process interruption when QuickJS serverless functions exceed execution timeouts.
  * Eliminated Time-Of-Check to Time-Of-Use (TOCTOU) race conditions in secret management.
  * Sanitized sort field names against query injection and rejected unauthenticated variables in `RuleEngine`.
  * Automatically stripped sensitive authentication headers on cross-origin redirects.

### Fixed
* **Atomic Database Migrations (PR #39)**:
  * Wrapped schema and data migrations in atomic database transactions with automatic rollback on error.
  * Synchronized SQLite transaction depth tracking and prevented concurrent migration race conditions on multi-instance boots.
* **Dialect & Database Queries**:
  * Fixed MSSQL queue polling queries and full-text search predicates.
  * Normalized boolean record representations and quoted camelCase column identifiers in PostgreSQL.
  * Fixed dialect-specific upserts for administrative accounts.
  * Fixed relation record expansion for multi-select relation fields.
* **Snapshot Driver Integrity**:
  * Cleared target tables correctly when restoring snapshots from empty source schemas.
  * Preserved active driver instances on snapshot restore and reconnect.

---

## [2.4.0] - 2026-11-07

Release v2.4.0 introduces **NodeStack Queues**—an embedded, transactional background message queue and worker subsystem backed by SQLite with atomic claiming, lease renewal, retries, dead-letter queues (DLQ), strict partition FIFO ordering, and direct serverless function binding; delivers **Flow Execution Concurrency Throttling** using system queues; adds an interactive **Admin UI Queues Manager** with system queue filtering, payload drawers, and DLQ re-drive; exposes `client.queue(name)` in `nodestack-client` and `core.sdk.queue` inside QuickJS sandboxes; introduces an **Agent OpenWiki Evidence Index** for AI developer tooling; decommissions the legacy demo state subsystem in favor of the unified `SnapshotService`; and hardens security, execution state consistency, and path traversal protections.

### Added

#### 1. Transactional Queues Subsystem (`QueueService.ts`, `SqliteQueueDriver.ts`, `IQueueDriver.ts`)
* **SQLite Queue Driver Engine**:
  * Embedded, persistent queue architecture powered by SQLite tables (`_queues`, `_queue_messages`) with full ACID transactions.
  * Lock-free atomic message claiming with configurable lease timeouts (`visibilityTimeoutSeconds`).
  * Automatic orphan worker recovery and dead worker reclamation on server startup.
  * Configurable exponential retry backoff (`backoffDelayMs`) and Dead-Letter Queue (`deadLetterQueue`) isolation when `maxAttempts` is reached.
* **Strict FIFO Partition Ordering (`partitionKey` / `groupKey`)**:
  * Implemented strict sequential FIFO partition ordering to ensure messages within the same partition key process strictly in series.
  * Guarantees head-of-line ordering without blocking independent partitions.
  * Added `forceSkip` API to unblock partitions on persistent poison messages when necessary.
* **Worker Security & Leases**:
  * Cryptographic `claimToken` generated per claimed lease, preventing unauthorized mutations or completions from expired or foreign workers.
  * Worker lease extension via the `touch` API for long-running batch operations.

#### 2. Serverless Function Queue Binding & QuickJS Sandbox Bridge
* **Function-Queue Event Consumers (`targetFunction`)**:
  * Direct queue-to-function binding for automatic message execution in sandboxed QuickJS WebAssembly runtimes.
  * Automatic `ack` on clean returns (saving function output to `message.result`) and `nack` with exponential backoff on exceptions.
  * Function capacity coordination with worker claiming to respect function concurrency.
  * Automatic synchronization of `targetFunction` when serverless functions are renamed.
* **QuickJS Bridge Integration (`QuickJsWasmRuntime.ts`)**:
  * Exposed `core.sdk.queue(name)` and `core.queue` methods (`enqueue`, `getMessage`, etc.) inside function guest sandboxes.
  * Added system queue protection to prevent guest code from tampering with internal orchestration queues.

#### 3. Flow Execution Concurrency Throttling & Lifecycle Safety
* **Queue-Backed Flow Concurrency Limits (`FlowService.ts`)**:
  * Added concurrency throttling for Function Flows using per-flow system queues (`_flow_{flowId}`).
  * Automatic draining of queued executions upon concurrency limit removal or increase.
  * Transparent routing of paused and resumed executions through queue workers.
* **Flow State Integrity**:
  * Aborts pending queued executions prior to deleting execution history.
  * Suppressed post-completion writes and reconciliations for already-deleted running executions.
  * Preserved subflow error identity and causal trace hierarchy on nested flow failures.
  * Preserved root loop condition paths in complex flows.
  * Hardened `FlowPathMapper` against path traversal and unsafe path manipulation.

#### 4. Admin UI Queues Manager & Overview Dashboards (`queues.js`)
* **Live Queues Dashboard**:
  * Dedicated Queues view in the Admin UI with live metrics for active, queued, processing, completed, failed, and dead-letter jobs.
  * System queue toggle to inspect internal flow throttling queues alongside user queues.
  * Interactive message drawer with raw JSON payload formatting, execution logs, and timing metrics.
  * One-click Dead-Letter Queue (DLQ) re-drive, message retry, and job deletion.
* **Overview Dashboard Metrics**:
  * Added real-time summary status cards for active Flows and Queues on the main Overview page.
* **Spatial Navigation Polish**:
  * Top-level sidebar navigation resets route and tab states cleanly to default views.

#### 5. First-Party Client SDK Support (`nodestack-client`)
* **Typed Queue Service (`packages/client/src/services/QueueService.ts`)**:
  * Added `client.queue(name)` for producing and consuming background messages.
  * Full support for `send()`, `claim()`, `ack()` / `complete()`, `nack()` / `fail()`, `touch()`, `forceSkip()`, `retry()`, `getConfig()`, and `delete()`.

#### 6. Agent OpenWiki Evidence Index & Documentation
* **OpenWiki Integration (`openwiki/`, `AGENTS.md`)**:
  * Added verifiable architecture and domain claim indices for AI coding agents and developer tooling.
* **Official Queues Documentation**:
  * Published [Queues Overview](docs/docs/queues/overview.md) and [Workers & Function Integration](docs/docs/queues/workers-and-functions.md).
  * Updated REST API Reference (`docs/docs/api-reference/rest-api.md`) with all `/api/queues` endpoints.

### Changed
* **Decommissioned Legacy Demo State Subsystem**:
  * Completely removed deprecated `DemoService`, `DemoController`, and `/api/demo/*` endpoints in favor of the formal, atomic `SnapshotService` (`/api/snapshots/*`).
  * Removed `client.demo` from `nodestack-client` and updated Admin UI scripts from `demo.js` to `snapshots.js`.
* **QuickJS Exports Normalization**:
  * Normalized function export resolution to prioritize standard CommonJS (`module.exports`) exports over legacy named helpers.

### Fixed
* **Snapshot Restore Protection & Queue Reconciliation**:
  * Protected snapshot restore endpoints from `ChaosMiddleware` disruptions.
  * Reconciles queue state and restarts workers cleanly following a snapshot rollback.
* **Function Test Token Verification**:
  * Enforced server-side verification of function test runner authorization tokens.
* **Execution & Worker Bug Fixes**:
  * Prevented DLQ retry duplication and reclaimed dead workers on initial startup.
  * Defaulted implicit queue concurrency to 0 to prevent unconfigured runaway claiming.
  * Aligned test runner recursion guard behavior in function workbenches.

---

## [2.3.0] - 2026-11-03

Release v2.3.0 introduces **Serverless Function Flows**—an embedded, high-performance workflow orchestration and state machine subsystem executing directly within the NodeStack engine without external dependencies; delivers a dedicated **Visual Flow Designer & Declarative Code DSL** with real-time two-way synchronization in the Admin Portal; adds **Referential Integrity Enforcement** between flows and serverless functions; upgrades `nodestack-client` with full flow execution support; and enhances Admin UI accessibility and light theme contrast across all confirmation dialogs.

### Added

#### 1. Serverless Function Flows Orchestration Engine
* **Embedded QuickJS State Machine Engine (`FlowEngine.ts`, `FlowService.ts`)**:
  * Implemented an in-engine workflow orchestrator executing state machines defined in a clean, JSON-compatible DSL.
  * Sub-millisecond state transitions running in-process without AWS Step Functions, Temporal, or external cloud workers.
  * **9 Supported State Types**:
    * `Task`: Executes QuickJS WebAssembly serverless functions with parameter mapping, `elevated` database permissions, and `serviceRole` privileges.
    * `Choice`: Conditional branching evaluating comparisons (`stringEquals`, `numericEquals`, `numericGreaterThan`, `numericLessThan`, `numericGreaterThanEquals`, `numericLessThanEquals`, `booleanEquals`, `isPresent`) and compound logic (`and`, `or`, `not`).
    * `Map`: High-throughput array iteration with configurable `maxConcurrency` over dynamic item paths.
    * `Parallel`: Concurrent multi-branch execution with synchronized output aggregation.
    * `Loop`: Bounded while/until iterations with safety loop guards (`maxIterations`).
    * `Pass`: Payload injection, shaping, and mock state testing.
    * `Wait`: Configurable time delays before subsequent step dispatch.
    * `Succeed` & `Fail`: Explicit terminal status nodes with error classification and cause reporting.
  * **JSONPath Data Filtering & Mapping**:
    * Granular state context transformations using `inputPath` (input extraction), `resultPath` (result injection), and `outputPath` (output shaping).
  * **Declarative Error Handling & Retries**:
    * Automatic retries with exponential backoff (`intervalSeconds`, `maxAttempts`, `backoffRate`, `errorEquals`).
    * Structured `catch` blocks routing matching errors to dedicated fallback recovery states.

#### 2. Dual-Mode Flow Designer (Visual Canvas & Code DSL)
* **Interactive Visual Graph (`src/admin/ui/js/flows-designer.js`, `flows.css`)**:
  * Interactive canvas with directional step connectors, state type color badges (`Task`, `Choice`, `Map`, `Parallel`, etc.), and step drag-and-drop reordering.
  * State inspector for configuring target serverless functions, retry policies, catch handlers, wait times, and branching rules.
* **Code DSL Editor (`src/admin/ui/js/flows.js`)**:
  * Built-in CodeMirror JSON state machine editor with real-time schema validation and instantaneous two-way sync with the visual designer.
* **Live Test Runner & Step Waterfall**:
  * Dedicated runner to execute flows with custom test payloads and inspect step latency, duration waterfalls, input/output diffs, and execution logs.

#### 3. Dual Triggering System & Observability
* **Database Lifecycle Event Triggers**:
  * Automatically dispatch flows on collection events: `<collection>:afterCreate`, `<collection>:afterUpdate`, `<collection>:afterDelete`, with full pre- and post-mutation record context.
* **REST Execution API & Multi-Tenancy**:
  * Added `/api/flows` endpoints for flow management and executions (`POST /api/flows/:id/execute`), fully isolated per tenant application (`/api/apps/:slug/flows`).
* **Persistent Execution Audit Logs**:
  * Stored in SQLite (`_flow_executions` table) with granular step-by-step logs (`stepLogs`), input snapshots, output payloads, actor identity, and duration metrics.

#### 4. Function-Flow Referential Integrity Protection
* **Fail-Closed Dependency Inspection (`FunctionService.deleteFunction`)**:
  * Protects active production workflows by scanning all registered flows before deleting any serverless function.
  * Rejects deletions with `HTTP 409 Conflict` and details all referencing flow names and IDs.
  * Supports explicit override via `DELETE /api/functions/:id?force=true`.
  * Warns users in the Admin UI with a high-contrast modal detailing dependent flows and requiring explicit confirmation before force-deletion.

#### 5. First-Party Client SDK Support (`nodestack-client`)
* **Typed Flow Service (`packages/client/src/services/FlowService.ts`)**:
  * Added `client.flows.execute(flowIdOrName, input, options)` supporting synchronous and background dispatch.
  * Added `client.flows.getList()`, `client.flows.getOne()`, and `client.flows.getExecutions()`.

#### 6. Official Documentation
* **Comprehensive Function Flows Guides**:
  * Published [Function Flows Overview](docs/docs/flows/overview.md), [State Machine Specification](docs/docs/flows/state-machine.md), [Triggers & Observability](docs/docs/flows/triggers-and-execution.md), and [Serverless Function Integration](docs/docs/flows/function-integration.md).
  * Added Function Flows to the documentation sidebar navigation (`docs/sidebars.ts`).
  * Updated REST API Reference (`docs/docs/api-reference/rest-api.md`) with the complete `/api/flows` specification.

### Changed
* **Accessible Confirmation Dialogs (`src/admin/ui/js/state.js`, `main.css`)**:
  * Replaced native browser `alert()` and `confirm()` dialogs across all Admin UI views (webhooks, functions, flows, snapshots, logs) with accessible, theme-aware HTML confirmation dialogs (`showConfirmDialog`).
* **Light Theme High-Contrast Polish**:
  * Enhanced WCAG AAA color contrast tokens in light mode for callout banners, error boxes, and danger action buttons.

### Fixed
* **Security & Inline JS Hardening**:
  * Eliminated inline JavaScript handler string breakout vulnerabilities by binding click listeners dynamically with raw in-memory values instead of interpolated HTML attributes.
* **Fail-Closed Integrity Error Handling**:
  * Fixed flow dependency checks in `FunctionService` and `FlowService` to fail closed on malformed flow JSON or query failures instead of falling open.

---

## [2.2.0] - 2026-10-30

Release v2.2.0 delivers **Cross-Platform Standalone Binary Builds** using Node.js Single Executable Applications (SEA); introduces **1-Click Cloud & In-Browser Deployments** (Docker, Railway, and Dev Containers); publishes an in-depth **Feature & Architecture Comparison Matrix**; and hardens security, concurrency, session caching, and record processing across the core backend stack.

### Added

#### 1. Cross-Platform Standalone Binary Builds (Node.js SEA)
* **Zero-Dependency Executables**:
  * Added Single Executable Application (SEA) bundling (`scripts/build-sea.js`, `sea-config.json`, `src/cli/sea-entry.ts`) compiling NodeStack into standalone binary executables for Linux (x64), macOS (ARM64/x64), and Windows (x64).
  * Direct Admin UI bundling within the executable binary (`AdminUIService.ts`) with runtime asset extraction and fallback resolution from embedded code.
  * Added automated GitHub Actions release workflow (`.github/workflows/build-binaries.yml`) for multi-platform compilation.
  * Added native Windows binary icon asset (`src/admin/ui/icon.ico`).

#### 2. 1-Click Cloud & In-Browser Deployments
* **Production Containerization & Blueprints**:
  * Multi-stage production `Dockerfile` and `.dockerignore` for minimal, lightweight container images.
  * Native Railway deployment blueprint configuration (`railway.json`).
  * VS Code Remote Containers & GitHub Codespaces devcontainer configuration (`.devcontainer/devcontainer.json`).
  * 1-Click deployment badges for Railway and Render in project documentation.
  * Automatic `PORT` and `HOST` environment variable resolution in the CLI (`src/cli/cli.ts`) for seamless cloud hosting.
  * Comprehensive Docker deployment guide (`docs/docs/deployment/docker.md`).

#### 3. Architecture & Ecosystem Comparison Matrix
* **Platform Comparison Guide**:
  * In-depth comparison matrix (`docs/docs/getting-started/comparison.md`, `assets/comparison-matrix.png`, `assets/comparison-card.html`) evaluating NodeStack against PocketBase, Supabase, Strapi, and Firebase across runtime models, language support, RLS rule engines, reactivity, plugin extensibility, and binary footprint.
  * Added comparison link to the official documentation sidebar navigation.

### Changed
* **License & Attribution Structure**: Restored a clean, standard MIT license header in `LICENSE` and relocated project attribution and disclaimers to [`NOTICE.md`](NOTICE.md).

### Fixed
* **Security & Anti-SSRF Guardrails**: Hardened `WebhookService` with redirect-aware, DNS-rebinding-safe `SsrfGuard` validation, prevented storage path traversal in file uploads, and centralized OAuth abort timeouts.
* **Database Concurrency & Transactions**: Enforced `BEGIN IMMEDIATE` write transactions in SQLite to eliminate busy contention, added nested savepoints (`SAVEPOINT nodestack_tx_*`), and rejected async transaction callbacks before invocation.
* **Authentication & Token Caching**: Promoted token cache entries on read hits for true LRU eviction, and immediately invalidated cached tokens upon email-based session revocation.
* **Performance & Record Processing**: Streamed JSON/CSV exports in 500-record chunks to prevent memory spikes, switched batch password hashing to non-blocking async bcrypt, and serialized request logs defensively against circular references and BigInt values.
* **HTTP Validation & OpenAPI Contract**: Guarded log pruning (`olderThanDays`) with finite-number validation to prevent date RangeErrors, and documented query parameters and response schemas for `DELETE /api/logs`.

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
