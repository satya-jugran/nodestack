---
type: "Reference"
title: "Serverless Functions, Workflows & Queues"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-05T17:08:40.212Z
sources:
  - id: openwiki-source-e69860785030352a5a6b3062
    resource: repo://src/flows/FlowEngine.ts
  - id: openwiki-source-ffde96ba8e115daae50c0130
    resource: repo://src/flows/FlowService.ts
  - id: openwiki-source-ac1d3d669b7b6ba6c0a2190e
    resource: repo://src/flows/FlowValidator.ts
  - id: openwiki-source-fcfb78ab353c2b1acea5da52
    resource: repo://src/flows/runtime/ChoiceEvaluator.ts
  - id: openwiki-source-e59ad8a3f18b01d9eac8e0ab
    resource: repo://src/flows/runtime/StateHandlers.ts
  - id: openwiki-source-0a006c1830032c78b39f1a74
    resource: repo://src/flows/utils/FlowPathMapper.ts
  - id: openwiki-source-379788add8dfe125ec754446
    resource: repo://src/functions/FunctionService.ts
  - id: openwiki-source-fafaca0ff6b2f06f8bbafb59
    resource: repo://src/functions/runtime/QuickJsWasmRuntime.ts
  - id: openwiki-source-afc6d70f5a420b71f1f36c97
    resource: repo://src/functions/runtime/SandboxedRunner.ts
  - id: openwiki-source-621eeac248c22f071734ba3b
    resource: repo://src/functions/security/SsrfGuard.ts
  - id: openwiki-source-8cfad6f2b730a2efc7a93c16
    resource: repo://src/queue/drivers/SqliteQueueDriver.ts
  - id: openwiki-source-75c9cc054eb2d6fc3f07ef6a
    resource: repo://src/queue/QueueService.ts
generated: { by: "antigravity", at: "2026-11-05T17:08:40.212Z" }
---

# Serverless Functions, Workflows & Queues

NodeStack includes a sandboxed WebAssembly serverless functions runtime (`QuickJsWasmRuntime`), an Amazon States Language (ASL)-inspired workflow state machine (`FlowEngine` & `FlowService`), and a stateless SQLite-backed background job orchestrator (`QueueService` & `SqliteQueueDriver`).

---

## Serverless Functions (`FunctionService`)

`FunctionService` (`src/functions/FunctionService.ts`) manages the lifecycle, authorization, concurrency throttling, recursion protection, and execution logging of serverless JavaScript functions stored in `_functions` and `_function_logs`.

### Function Configuration & Auth Policies

Each function in `_functions` configures:

- **`authPolicy` (`ALLOWED_AUTH_POLICIES`)**:
  - `'public'`: Callable without authentication.
  - `'auth'`: Requires a valid user JWT or admin token (`auth.id` or `auth.isAdmin`).
  - `'admin'`: Requires superuser authorization (`auth.isAdmin`).
  - `'apiKey'`: Requires a valid service API key (`auth.isApiKey`) or admin token.
- **`methods`**: Allowed HTTP verbs (defaults to `['GET', 'POST']`, or `['*']` for all methods). Disallowed methods return `405`.
- **`elevated`**: When `true`, `buildFunctionContext()` executes SDK record operations under `{ isAdmin: true, id: 'service-role' }`, bypassing collection access rules. When `false`, SDK calls inherit the caller's `actor` context and enforce `RuleEngine` rules.
- **`timeoutMs` & `memoryLimitMb`**: Execution boundaries passed to `SandboxedRunner` (clamped to `100..15000` ms and `4..128` MB).
- **`allowedDomains` & `env`**: Per-function domain allowlist for `SsrfGuard` and key-value environment variables exposed on `ctx.env`.

### Triggers, Concurrency & Recursion Guards

1. **HTTP & Test Triggers**: `executeFunction()` and `testFunction()` execute functions directly and log results under `trigger: 'http'` or `'test'`.
2. **Lifecycle Hook Triggers (`handleRecordEvent`)**:
   - Triggered by `EventBus` on `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete`, and `afterDelete`.
   - Matches `eventTrigger` patterns `<collection>:<hook>`, `*:<hook>`, `*:*`, or `*`.
   - **`before*` Hook Mutations & Cancellation**: If a `before*` function returns `{ cancel: true, reason: '...' }`, the database write is aborted with HTTP `400`. If it returns `{ record: { ... } }`, the returned properties are merged onto the record before persistence.
3. **Queue Worker Triggers (`executeQueueJob`)**: Invokes a function bound as a queue's `targetFunction`, injecting job metadata headers (`x-queue-name`, `x-job-id`, `x-job-attempts`) and logging under `trigger: 'queue:<queueName>'`.
4. **Concurrency & Recursion Protection**:
   - Enforces a per-app active execution ceiling (`maxConcurrent`, default `15`), throwing `429 FunctionConcurrencyLimitError` when saturated and waking `QueueService` workers (`queueService.wakeAllWorkers()`) in `finally` blocks as slots free up.
   - Uses `AsyncLocalStorage` (`executionStorage`) to track call depth (`maxRecursionDepth`, default `5`) and the set of `activeFns` in the current call chain, throwing `508` on circular self-invocation or depth overflow.
5. **Deletion Safeguards (`deleteFunction`)**: Prevents deleting a function referenced by any flow (`getDependentFlows`) or bound as `targetFunction` on any queue (`getDependentQueues`) unless `{ force: true }` is passed. Renaming a function automatically updates `_queues.targetFunction`.

---

## QuickJS WebAssembly Sandbox (`SandboxedRunner` & `QuickJsWasmRuntime`)

- **`SandboxedRunner`** (`src/functions/runtime/SandboxedRunner.ts`) wraps an `IFunctionRuntime` implementation (defaulting to `QuickJsWasmRuntime`) and clamps `timeoutMs` (`100..15000` ms, default `1000` ms) and `memoryLimitMb` (`4..128` MB, default `32` MB).
- **`QuickJsWasmRuntime`** (`src/functions/runtime/QuickJsWasmRuntime.ts`) executes user code inside an isolated `quickjs-emscripten` WebAssembly VM context (`this.qjs.newContext()`):
  - Enforces heap limits via `vm.runtime.setMemoryLimit(memoryLimitBytes)` and CPU deadlines via `vm.runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline))`, returning `{ status: 'timeout', statusCode: 504 }` when interrupted.
  - Captures up to `50` console log lines (truncating individual entries at `500` characters).
  - Normalizes ES module (`export default async function(core, ctx)`), CommonJS (`module.exports = ...`), anonymous/arrow functions, and top-level return statements via `prepareUserCode()`.
  - Exposes a Promise-based host bridge (`__raw_host_invoke` / `__resolve_host_call`) inside the guest VM under `globalThis.core` and `globalThis.ctx`:
    - `core.sdk.collection(name).get / list / create / update / delete`
    - `core.sdk.queue` / `core.queue` / `ctx.queue` (`send`, `claim`, `complete`, `fail`, `touch`, `getJob` — blocking access to reserved `_system:*` queues from user functions)
    - `core.network.http.fetch / get / post` and global `fetch`
    - `core.observability.log / info / warn / error / metric` and global `console`

---

## SSRF Protection (`SsrfGuard`)

`SsrfGuard` (`src/functions/security/SsrfGuard.ts`) protects outbound network requests from serverless functions and webhooks against Server-Side Request Forgery (SSRF) and DNS rebinding (TOCTOU) attacks:

- **Protocol & Host Validation (`validateUrl`)**:
  - Permits only `http:` and `https:`.
  - Blocks cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`, `instance-data`), loopback (`localhost`, `127.0.0.0/8`, `::1`), RFC 1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), carrier-grade NAT (`100.64.0.0/10`), link-local (`169.254.0.0/16`, `fe80::/10`), IPv6 Unique Local (`fc00::/7`), and IPv4-mapped IPv6 addresses (`::ffff:...`).
  - Validates the hostname against `allowedDomains` (supporting exact domain matches and `*.example.com` / `.example.com` wildcards).
- **DNS Resolution & IP Pinning (`createGuardedFetch` & `executePinnedRequest`)**:
  - Resolves all DNS records via `dns.lookup(hostname, { all: true })` and verifies that **every** resolved IP is public before connecting.
  - Pins `pinnedAddress` and `pinnedFamily` onto the custom `lookup` callback passed to `http.request` / `https.request` (preserving `servername` for TLS SNI and `Host` headers) so the socket connects to the exact validated IP, defeating DNS rebinding.
  - Manually follows up to `5` HTTP `3xx` redirects, re-running `validateUrl()` on every redirect hop.

---

## State-Machine Workflows (`FlowService` & `FlowEngine`)

NodeStack's Flow Engine implements an Amazon States Language (ASL)-compatible workflow orchestrator backed by `_flows` and `_flow_executions`.

### State Types & Handlers (`StateHandlers`)

`FlowEngine` (`src/flows/FlowEngine.ts`) and `StateHandlers` (`src/flows/runtime/StateHandlers.ts`) support 9 state types:

| State Type | Handler | Behavior |
| :--- | :--- | :--- |
| `Task` | `TaskStateHandler` | Invokes a serverless function via `FunctionService.executeFunction()`. Enforces the target function's `authPolicy` against the flow `actor` unless `elevated: true` or `serviceRole: true` is set on the state. |
| `Choice` | `ChoiceStateHandler` | Evaluates ordered `ChoiceRule` branches via `ChoiceEvaluator` (`stringEquals`, `numericEquals`, `numericGreaterThan`, `numericLessThan`, `numericGreaterThanEquals`, `numericLessThanEquals`, `booleanEquals`, `isPresent`, and recursive `and`, `or`, `not` combinators) with an optional `default` fallback state. |
| `Map` | `MapStateHandler` | Extracts an array at `itemsPath` and executes an embedded sub-flow (`iterator`) over each item concurrently using `ConcurrencyPool.map()` (`maxConcurrency` default `5`). |
| `Loop` | `LoopStateHandler` | Increments a per-state counter in `loopCounters` (enforcing `maxIterations`, default `100`) and branches to `target` while `condition` evaluates to `true`, or proceeds to `next` / `end`. |
| `Parallel` | `ParallelStateHandler` | Executes an array of sub-flow `branches` concurrently via `Promise.all()` and merges the array of branch outputs via `resultPath`. |
| `Pass` | `PassStateHandler` | Transforms or injects static `result` data into the payload without invoking a function. |
| `Wait` | `WaitStateHandler` | Delays execution for `seconds` (clamped `0..60`s) while listening to `AbortSignal` for immediate cancellation. |
| `Succeed` | `SucceedStateHandler` | Immediately terminates the flow with `status: 'succeeded'`. |
| `Fail` | `FailStateHandler` | Immediately terminates the flow with `status: 'failed'` and `error` / `cause`. |

### JSONPath Data Flow, Retries & Catch Policies

- **`FlowPathMapper`** (`src/flows/utils/FlowPathMapper.ts`) processes state payloads through three stages using dot and bracket notation (e.g., `$.user.items[0].id`):
  1. `resolveInput(payload, inputPath)`: Selects the subset of the payload passed into the state.
  2. `applyResult(payload, result, resultPath)`: Merges the step output back into the payload (`null` or `''` discards the result; `'$'` or `undefined` replaces the root payload; `$.path` sets a nested key immutably).
  3. `resolveOutput(payload, outputPath)`: Selects the final payload passed to the next state.
- **Retries & Catch Transitions (`FlowEngine`)**:
  - `executeWithRetry()` evaluates state-level `retry` policies (`errorEquals` matching error names, message substrings, `'*'`, or `'States.ALL'`, with exponential backoff `intervalSeconds * backoffRate^(attempt - 1)` up to `maxAttempts`).
  - `tryCatchTransition()` intercepts unhandled state errors (excluding timeouts and cancellations), writes `{ error, message, statusCode }` into `resultPath`, and transitions to the recovery state (`policy.next`).
  - Enforces a safety ceiling of `500` step transitions per flow execution (`maxStepTransitions`).

### Validation, Checkpointing & Concurrency Admission (`FlowService`)

- **`FlowValidator`** (`src/flows/FlowValidator.ts`) validates state graphs on flow creation/update, checking `startAt`, state target existence, JSONPath syntax (`$`), choice operator types, nested `Map`/`Parallel` sub-flows, and event triggers (`<collection>:<action>` post-commit events only; rejecting `before*` hooks with guidance to use NodeStack Functions).
- **Per-Step Checkpointing & Crash Recovery**:
  - After every step transition, `FlowService.persistCheckpoint()` atomically updates `_flow_executions` with `stepLogs`, `output`, and a `checkpoint` (`currentStateName`, `currentPayload`, `stepCount`, `loopCounters`), guarded by `claimToken`.
  - On startup (`recoverOrphanedExecutions`), orphaned `'running'` executions are either marked `'aborted'` (when `recoveryStrategy === 'abort'`, the default) or resumed from their last checkpoint via `resumeExecution()` (`recoveryStrategy === 'resume'`).
- **System Queue Concurrency Throttling**:
  - When a flow configures `maxConcurrentExecutions >= 1`, `FlowService` provisions a dedicated system queue `_system:flow:<flowId>` in `QueueService` and registers a single `O(1)` prefix worker (`_system:flow:`).
  - Incoming executions are persisted with `status: 'queued'` and enqueued into `_system:flow:<flowId>`, with a 15-second lease heartbeat (`queueService.touch()`) while running.

---

## Persistent Background Queues (`QueueService` & `SqliteQueueDriver`)

`QueueService` (`src/queue/QueueService.ts`) and `SqliteQueueDriver` (`src/queue/drivers/SqliteQueueDriver.ts`) provide a stateless, database-driven background queue engine backed by `_queues` and `_queue_jobs`.

### Queue & Job Capabilities

- **Stateless DB-Driven Architecture**: All durable configuration (`concurrency`, `visibilityTimeoutSeconds`, `maxAttempts`, `backoffDelayMs`, `deadLetterQueue`, `targetFunction`) and job leases live in SQLite. Idle queues consume zero memory; `QueueService` only wakes queues that have due `'queued'` jobs (`getQueuesWithPendingJobs()`).
- **Atomic Claiming & Priority Ordering (`claim`)**:
  - Inside a SQLite transaction, `SqliteQueueDriver.claim()` checks active `'processing'` jobs with unexpired leases against `_queues.concurrency`, selects due `'queued'` candidates ordered by `priority DESC, availableAt ASC, rowid ASC`, assigns a unique `claimToken` (`crypto.randomUUID()`) and `leaseExpiresAt`, and increments `attempts`.
- **Deduplication & Delayed Jobs (`send` / `sendBatch`)**:
  - If `deduplicationId` is provided and an active (`'queued'` or `'processing'`) job with the same `(queue, deduplicationId)` already exists, `send()` returns the existing job without inserting a duplicate.
  - `delaySeconds` schedules future execution via `availableAt`, managed by a single coalesced timer (`scheduleDelayedAt`).
- **Serverless Function Worker Binding (`targetFunction`)**:
  - Queues can bind a serverless function by name via `targetFunction`. `QueueService.drainQueue()` coordinates claiming with `FunctionService`'s available concurrency capacity (`getMaxConcurrent() - getActiveExecutions()`).
  - If a job hits a `429 FunctionConcurrencyLimitError`, `QueueService` calls `driver.defer()` to reschedule the job without consuming its `attempts` budget.
- **Exponential Backoff & Dead-Letter Queues (`fail`, `reclaimOrphaned`, `retryDeadLetterJobs`)**:
  - When a job fails with `attempts < maxAttempts`, `fail()` reschedules it with exponential backoff: `baseBackoff * 2^(attempts - 1)`.
  - Once `attempts >= maxAttempts`, the job transitions to `status = 'dead_letter'`. If the queue configures a separate `deadLetterQueue`, `SqliteQueueDriver` also enqueues a linked copy (`originalJobId` / `forwardedToJobId`) into the DLQ.
  - Background sweepers periodically reclaim expired `'processing'` leases (`reclaimOrphaned`, default every `15s`) and prune terminal jobs older than `queueJobRetentionDays` (`cleanup`, default `7` days).
