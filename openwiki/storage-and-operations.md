---
type: "Reference"
title: "Files, Realtime, Webhooks, Snapshots & Observability"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-07T08:27:51.831Z
sources:
  - id: openwiki-source-f89e861107ff41a995cce15a
    resource: repo://src/analytics/AnalyticsService.ts
  - id: openwiki-source-2ccc7e12ed11c50bb5e85be0
    resource: repo://src/audit/AuditLogService.ts
  - id: openwiki-source-ee5eb1de1211c4928c69bce0
    resource: repo://src/files/FileStorageService.ts
  - id: openwiki-source-f02d9bdda69dabfe6d92f766
    resource: repo://src/logger/LogService.ts
  - id: openwiki-source-6c0b721a8d0cf209afc7a368
    resource: repo://src/realtime/RealtimeService.ts
  - id: openwiki-source-58ef957edcb17f4848a92688
    resource: repo://src/snapshots/SnapshotService.ts
  - id: openwiki-source-42775f04299d5f47c666d7ad
    resource: repo://src/webhooks/WebhookService.ts
generated: { by: "antigravity", at: "2026-11-05T17:08:40.212Z" }
---

# Files, Realtime, Webhooks, Snapshots & Observability

This page documents NodeStack's per-app storage, event streaming, outbound webhook delivery, point-in-time snapshot management, audit logging, and operational analytics/logging subsystems.

## Overview

Each `AppContext` provisions dedicated instances of these operational services scoped to its data directory (`dataDir`):

| Subsystem | Service Class | Source File | Purpose |
| :--- | :--- | :--- | :--- |
| **File Storage** | `FileStorageService` | `src/files/FileStorageService.ts` | Local file persistence, size/MIME validation, and path traversal protection |
| **Realtime (SSE)** | `RealtimeService` | `src/realtime/RealtimeService.ts` | Server-Sent Events streaming with topic subscriptions and per-client `viewRule` checks |
| **Webhooks** | `WebhookService` | `src/webhooks/WebhookService.ts` | Outbound HTTP webhook dispatch, HMAC-SHA256 signing, SSRF protection, and delivery history |
| **Snapshots** | `SnapshotService` | `src/snapshots/SnapshotService.ts` | Point-in-time database + file storage snapshots, drift detection, and atomic restores |
| **Audit Logs** | `AuditLogService` | `src/audit/AuditLogService.ts` | Immutable record-level mutation history with field diffs and secret redaction |
| **Analytics** | `AnalyticsService` | `src/analytics/AnalyticsService.ts` | Database storage sizing, collection counts, 24-hour traffic buckets, and process metrics |
| **Request Logs** | `LogService` | `src/logger/LogService.ts` | Buffered SQLite HTTP access logging (`_logs`) and console formatting |

---

## Local File Storage (`FileStorageService`)

`FileStorageService` (`src/files/FileStorageService.ts`) manages uploaded record attachments under `<dataDir>/storage/<collectionId>/<recordId>/<filename>`.

### Security & Path Containment

- **Identifier Sanitization (`sanitizeId`)**: Both `collectionId` and `recordId` must match `/^[a-zA-Z0-9_-]+$/`. Any other character throws a `400 BadRequestError` (`Invalid path segment`).
- **Filename Sanitization**: Base filenames have non-alphanumeric characters (other than `._-`) replaced with `_`, and `writeRecordFile()` rejects `.` and `..` filenames or mismatches with `path.basename(fileName)`.
- **Containment Verification (`isContained`)**: Every read, write, and delete resolves the target path via `path.resolve()` and checks `path.relative(parentDir, targetPath)` to ensure the path does not start with `..` or resolve outside the expected record, collection, or root storage directory.

### File Operations

- **`saveFile(collectionId, recordId, file, options)`**:
  - Enforces `options.maxSize` (in bytes) and `options.mimeTypes` allowlists when configured on a `file` schema field.
  - Generates a collision-resistant filename by appending an 8-character random hex suffix before the extension (`<safeBaseName>_<8hex><ext>`).
  - Writes the file buffer to `<storageDir>/<collectionId>/<recordId>/<finalFileName>` and returns `finalFileName`.
- **`writeRecordFile(collectionId, recordId, fileName, data)`**: Writes a named file directly inside a record directory without appending a random suffix (used by programmatic plugins and helpers).
- **`getFilePath(collectionId, recordId, fileName)`**: Returns the absolute path if the file exists and passes containment checks, or `null` otherwise.
- **`deleteFile` / `deleteRecordFiles` / `deleteCollectionFiles`**: Removes an individual file (cleaning up its parent record directory if empty), an entire record directory, or an entire collection directory.

---

## Realtime Subscriptions (`RealtimeService`)

`RealtimeService` (`src/realtime/RealtimeService.ts`) provides Server-Sent Events (SSE) over `/api/realtime`.

### Connection Lifecycle

1. **`addClient(res, auth?)`**:
   - Generates a unique client ID (`cl_<16hex>`).
   - Writes SSE response headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`).
   - Immediately sends `event: NS_CONNECT` and `event: NB_CONNECT` (for backward compatibility) with `data: {"clientId":"..."}`.
   - Registers a 25-second interval timer that writes `:keepalive\n\n` comments to prevent idle proxy timeouts.
   - Removes the client and clears its keepalive timer on `res.on('close')` or when `closeAll()` is called during shutdown.
2. **`setSubscriptions(clientId, subscriptions)`**:
   - Replaces the client's active subscription set and optionally updates the client's `auth` context.

### Subscription Topics & Rule-Checked Broadcasts

Clients can subscribe to any combination of topic patterns:

| Pattern | Matches |
| :--- | :--- |
| `*` | All records across all collections |
| `<collection>` or `<collection>/*` | All records in `<collection>` |
| `<collection>/<recordId>` | A specific record in `<collection>` |

When `broadcast(action, collectionName, record)` is triggered (`action` is `'create' | 'update' | 'delete'`):

1. The service looks up the collection schema via `collectionService.getCollection(collectionName)`.
2. For each connected client whose subscription set matches the collection or record:
   - It evaluates `RuleEngine.evaluate(collection.viewRule, { auth: client.auth, record })`.
   - If the client is authorized by `viewRule`, the server writes `event: <collectionName>\ndata: {"action":...,"record":...}\n\n`.
   - If `viewRule` denies access, the event is silently skipped for that client.

`broadcastSystemEvent(event, data)` streams system-level notifications (such as `SNAPSHOT_CREATE`, `SNAPSHOT_RESTORE`, `SNAPSHOT_DELETE`, and `SNAPSHOT_CLEAR`) to all connected SSE clients.

---

## Outbound Webhooks (`WebhookService`)

`WebhookService` (`src/webhooks/WebhookService.ts`) dispatches HTTP webhooks in response to record lifecycle and custom events, storing configurations in `_webhooks` and delivery history in `_webhook_deliveries`.

### Configuration & Event Matching

Each webhook configuration in `_webhooks` contains:
- `id`, `name`, `url`, `event`, `collection`, `action`
- `method`: One of `POST`, `PUT`, `PATCH`, `DELETE`, `GET`, `HEAD` (`ALLOWED_WEBHOOK_METHODS`, validated in `normalizeMethod()`).
- `headers`: JSON-encoded custom HTTP headers.
- `secret`: Optional shared secret used for HMAC-SHA256 request signing.
- `enabled`: Boolean toggle (`1` or `0` in SQLite).

`WebhookService` subscribes to the global wildcard event (`eventBus.on('*', ...)`), ignoring internal `webhook:*` events. `matchesEvent()` supports:
- Exact event matches or wildcard `*`.
- Flexible collection and action matching across colon- and dot-separated conventions (`posts:create` vs `post.created`), automatically normalizing singular/plural collection names (`normalizeCollectionToken`) and past/present action verbs (`create`/`created`, `update`/`updated`, `delete`/`deleted`).

### Dispatch, Signing & SSRF Protection

When a webhook triggers (`executeDelivery`):
1. **Payload Construction**: Builds a JSON payload containing `{ event, collection, action, record, timestamp }`.
   - For methods with bodies (`POST`, `PUT`, `PATCH`, `DELETE`), the JSON payload is sent as the request body with `Content-Type: application/json`.
   - For body-free methods (`GET`, `HEAD`), `event`, `collection`, `action`, `recordId`, and `timestamp` are appended as URL query parameters.
2. **HMAC-SHA256 Signature (`computeSignature`)**: If `webhook.secret` is non-empty, computes `sha256=<hex>` using `crypto.createHmac('sha256', secret)` over the request body (or over `targetUrl.searchParams.toString()` for `GET`/`HEAD`) and attaches it in the `X-NodeStack-Signature` header.
3. **SSRF Guard**: Dispatches the HTTP request via `SsrfGuard.createGuardedFetch()` with a configurable `requestTimeoutMs` (default `10,000` ms) to block private/loopback IP ranges and DNS rebinding attacks.
4. **Delivery Logging**: Records the delivery outcome (`status: 'success' | 'failed'`, `statusCode`, `duration`, `attempt`, request headers/body, and response body truncated at `10,000` characters) in `_webhook_deliveries`.

Additional management methods include `retryDelivery(deliveryId)` (which increments `attempt` and re-sends the recorded request payload), `testWebhook(webhookId)` (which fires a synthetic `webhook.test` payload), and `clearDeliveries(olderThanDays?)`.

---

## Point-in-Time Snapshots (`SnapshotService`)

`SnapshotService` (`src/snapshots/SnapshotService.ts`) manages up to `MAX_SNAPSHOTS` (`10`) point-in-time snapshots of both the SQLite database and uploaded files under `<dataDir>/.snapshots/`.

### Storage Layout & Legacy Migration

- `<dataDir>/.snapshots/manifest.json`: Stores `{ version: 2, activeSnapshotId, snapshots: SnapshotEntry[] }`.
- `<dataDir>/.snapshots/<snapshotId>/data.db`: Consistent SQLite snapshot created via `VACUUM INTO`.
- `<dataDir>/.snapshots/<snapshotId>/storage/`: Recursive copy of `<dataDir>/storage`.
- On startup (`migrateLegacySnapshot()`), if a legacy `<dataDir>/.demo_snapshot` directory exists and `.snapshots/manifest.json` does not, `SnapshotService` automatically migrates it into a v2 snapshot named `"Initial Snapshot"`.

### Concurrency & Deterministic State Hashing

All snapshot mutations (`createSnapshot`, `restoreSnapshot`, `deleteSnapshot`, `clearAllSnapshots`) run inside `MaintenanceGate.executeExclusive()` so concurrent HTTP requests are paused during database replacement or checkpointing.

`computeStateHash()` computes a deterministic SHA-256 fingerprint across:
1. All collections sorted by name (`name`, `type`, sorted `schema`, rules, `options`).
2. All user collection records sorted by `id` with deterministically ordered keys (`canonicalizeRow`).
3. All `_admins` rows sorted by `id` (`id`, `email`, `passwordHash`).
4. A recursive file manifest of `storageDir` containing relative paths, byte sizes, and MD5 file hashes.

### Operations

- **`createSnapshot(options)`**:
  - Enforces the 10-snapshot limit (`MAX_SNAPSHOTS = 10`). If full and `evictOldest` is not `true`, throws a `409 ConflictError` with `code: 'SNAPSHOT_LIMIT_REACHED'`. If `evictOldest: true`, removes the oldest snapshot first.
  - Flushes the SQLite WAL via `db.checkpoint('TRUNCATE')` and executes `VACUUM INTO '<snapDir>/data.db'`.
  - Copies `storageDir` into `<snapDir>/storage`, records collection/record/file counts and `contentHash`, sets `activeSnapshotId` to the new snapshot, and emits `snapshot:create` / `SNAPSHOT_CREATE`.
- **`restoreSnapshot(targetSnapshotId?)`**:
  - Defaults to `activeSnapshotId` (or the latest snapshot).
  - Inside `maintenanceGate.executeExclusive()`: calls `db.lock()`, checkpoints WAL, closes the live SQLite connection (`db.close()`), copies `<snapDir>/data.db` over `db.getDbPath()`, deletes stale `-wal` and `-shm` files, replaces `storageDir` with `<snapDir>/storage`, and in a `finally` block calls `db.reconnect()` and `db.unlock()`.
  - Updates `activeSnapshotId` without deleting newer snapshots (allowing forward and backward jumping across snapshots) and emits `snapshot:restore` / `SNAPSHOT_RESTORE`.
- **`getStatus(targetSnapshotId?)`**:
  - Compares live collection counts, record counts, file counts/bytes, and `computeStateHash()` against the target or active snapshot to report `collectionsDelta`, `recordsDelta`, `filesDelta`, `contentChanged`, and `isModified`.

---

## Audit Logging (`AuditLogService`)

`AuditLogService` (`src/audit/AuditLogService.ts`) hooks into `eventBus` (`afterCreate`, `afterUpdate`, `afterDelete`) to maintain an immutable audit trail in the `_audit_logs` system table.

### Diff Computation & Redaction

- **Sensitive Field Redaction (`REDACTED_FIELDS`)**: Any field named `password`, `passwordHash`, `tokenKey`, `secret`, `apiKey`, or `token` has its value replaced with `'[REDACTED]'` via `sanitizeRecord()` before diffing or storage.
- **Ignored Metadata (`IGNORED_DIFF_FIELDS`)**: `updated`, `passwordHash`, and `tokenKey` are excluded when computing update diffs.
- **Zero-Diff Suppression**: On `update` events, `computeDiff(oldRecord, newRecord)` compares JSON-serialized values across all keys. If `changedFields.length === 0`, no audit log entry is written.
- **Actor Attribution (`AuditActor`)**: Captures `authId`, `authEmail`, `authCollection`, `isAdmin`, client `ip`, and `userAgent` passed in the event payload.
- **Querying & Pruning**: Provides `getRecordHistory(collection, recordId)`, `getGlobalLogs()` (with filters for `collection`, `recordId`, `action`, `actorId`, `fromDate`, `toDate`, and search across `recordId`/`actorEmail`/`changedFields`), and `pruneLogs(olderThanDays)`.

---

## Analytics & Request Logging

### `LogService` (`src/logger/LogService.ts`)

`LogService` records HTTP requests into the `_logs` table while minimizing SQLite write contention:
- **In-Memory Write Buffer**: `logRequest(entry)` pushes `LogEntry` items (`id`, `method`, `url`, `status`, `duration`, `ip`, `userAgent`, `created`) into an in-memory buffer and prints color-coded output to stdout (skipping static `/_/` UI asset requests).
- **Batch Flushing**: A background timer flushes the buffer inside a single SQLite transaction (`BEGIN IMMEDIATE ... COMMIT`) every `250ms` (`flushIntervalMs`) or immediately when the buffer reaches `50` entries (`maxBufferSize`).
- **Read Consistency**: `getLogs()` and `AnalyticsService.getMetrics()` call `flush()` before querying `_logs` so recent requests are immediately visible.
- **Maintenance**: Supports `pruneLogs(olderThanDays)` and `clearLogs(olderThanDays?)`.

### `AnalyticsService` (`src/analytics/AnalyticsService.ts`)

`AnalyticsService.getMetrics()` aggregates operational metrics for the Admin UI dashboard:
- **`database`**: Sums the on-disk byte sizes of `data.db`, `data.db-wal`, and `data.db-shm` (`totalSizeBytes` and formatted `totalSizeFormatted`), total user collections count, total records count, and per-collection record counts (`collectionsBreakdown` sorted descending by count).
- **`realtime`**: Active SSE client count via `realtimeService.getConnectedClientsCount()`.
- **`traffic24h`**: Queries `_logs` over the last 24 hours (`datetime('now', '-23 hours')`) grouped by hour (`strftime('%Y-%m-%d %H:00:00', created)`), zero-filling missing hours to return 24 contiguous hourly buckets along with `totalRequests`, `errorRequests` (`status >= 400`), `successRequests`, `errorRate`, `avgDuration`, and `peakHourRequests`.
- **`system`**: Node.js `process.uptime()`, `memoryUsage.rss`, `memoryUsage.heapTotal`, and `memoryUsage.heapUsed` (both raw bytes and human-readable strings).
