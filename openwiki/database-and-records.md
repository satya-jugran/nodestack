---
type: "Reference"
title: "Database, Schema & Record Management"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-05T17:08:40.212Z
sources:
  - id: openwiki-source-a7511f573894f05c34c471d2
    resource: repo://src/database/DatabaseService.ts
  - id: openwiki-source-c1a0db389c1099e5b0450593
    resource: repo://src/database/drivers/NodeSqliteDriver.ts
  - id: openwiki-source-fb3cd1ee4364ec2db05a0c4f
    resource: repo://src/database/migrations/SystemMigrations.ts
  - id: openwiki-source-c3bc035013aa43202a4a09fa
    resource: repo://src/records/FtsService.ts
  - id: openwiki-source-d1ad5b5fb148a59eb9ff6cce
    resource: repo://src/records/MockDataService.ts
  - id: openwiki-source-1833c5ded3dc4b98ad8c7a08
    resource: repo://src/records/QueryFilterParser.ts
  - id: openwiki-source-230b65563a29672b08dfb5a2
    resource: repo://src/records/RecordService.ts
  - id: openwiki-source-487748449986cdf7bdb3ee25
    resource: repo://src/schema/OpenApiGenerator.ts
  - id: openwiki-source-9a1df884859770de3ad8ed42
    resource: repo://src/schema/SchemaInferenceService.ts
  - id: openwiki-source-fe90713515d9b42f74cdeaf3
    resource: repo://src/schema/SchemaService.ts
  - id: openwiki-source-0135a8c502d832c59da98841
    resource: repo://src/schema/TypeGenerator.ts
generated: { by: "antigravity", at: "2026-11-05T17:08:40.212Z" }
---

# Database, Schema & Record Management

NodeStack provides a zero-dependency SQLite persistence layer, dynamic schema management with full-text search (FTS5), JSON schema inference, TypeScript/OpenAPI code generation, and a unified `RecordService` for CRUD, relational expansion, CSV/JSON import-export, and synthetic mock data generation.

---

## Database Layer (`DatabaseService` & `NodeSqliteDriver`)

### `NodeSqliteDriver`

`NodeSqliteDriver` (`src/database/drivers/NodeSqliteDriver.ts`) implements `IDatabaseDriver` (`src/database/drivers/IDatabaseDriver.ts`) on top of Node.js's built-in `node:sqlite` (`DatabaseSync`) module:

- **Initialization & PRAGMAs**: When `init()` opens the SQLite database file (creating parent directories if disk-backed and not `:memory:`), it executes:
  - `PRAGMA journal_mode = WAL;`
  - `PRAGMA foreign_keys = ON;`
  - `PRAGMA busy_timeout = 5000;`
- **Parameter Sanitization**: Before binding parameters to prepared statements (`query`, `get`, `run`), `sanitizeParams()` converts `undefined` to `null` and booleans (`true` / `false`) to `1` / `0`.
- **Nested Synchronous Transactions**: `transaction<T>(fn: () => T): T` manages transaction nesting via `transactionDepth`:
  - At depth `0`, it executes `BEGIN IMMEDIATE`, runs `fn()`, and issues `COMMIT` (or `ROLLBACK` on error).
  - At nested depths (`transactionDepth > 0`), it creates a savepoint (`SAVEPOINT sp_<depth>`), runs `fn()`, and issues `RELEASE SAVEPOINT sp_<depth>` (or `ROLLBACK TO SAVEPOINT sp_<depth>` on error).
  - Passing an `AsyncFunction` or returning a `Promise`/thenable inside `transaction()` throws a descriptive error (`DatabaseService.transaction() only supports synchronous functions`) so locks are never held across async ticks.

### `DatabaseService`

`DatabaseService` (`src/database/DatabaseService.ts`) wraps `IDatabaseDriver` and adds operational controls:

- **System Bootstrap**: `init()` initializes the underlying driver and runs `SystemMigrations.run(this.driver)`.
- **Maintenance Locking**: `lock()` and `unlock()` toggle an internal `isLocked` flag. While locked (e.g., during snapshot restores or database resets), `query`, `get`, `run`, `exec`, and `transaction` throw a `503 ServiceUnavailableError` (`Database is currently undergoing maintenance/reset. Please try again shortly.`).
- **WAL Checkpointing & Reconnection**:
  - `checkpoint()` executes `PRAGMA wal_checkpoint(TRUNCATE);` to flush the Write-Ahead Log back into the main database file.
  - `reconnect()` closes and re-initializes the underlying SQLite connection after file replacement operations.

### `SystemMigrations`

`SystemMigrations.run()` (`src/database/migrations/SystemMigrations.ts`) runs inside a single transaction during `DatabaseService.init()` and bootstraps all internal metadata tables:

| Table | Purpose |
| :--- | :--- |
| `_collections` | Stores collection definitions (`id`, `name`, `type`, `schema` JSON, `indexes` JSON, `system`, and access rules `listRule`, `viewRule`, `createRule`, `updateRule`, `deleteRule`, `options` JSON). |
| `_admins` | Stores administrator accounts (`id`, `email`, `passwordHash`, `tokenKey`). |
| `_logs` | Stores HTTP request and system logs (`level`, `message`, `data` JSON). |
| `_params` | Stores key-value system settings (`key`, `value` JSON). |
| `_audit_logs` | Stores immutable audit trail records (`actorId`, `actorType`, `actorEmail`, `action`, `collectionName`, `recordId`, `changes`, `metadata`). |
| `_webhooks` | Stores outbound webhook subscriptions (`collection`, `url`, `events`, `secret`, `active`, `retryCount`). |
| `_webhook_deliveries` | Tracks webhook delivery attempts, HTTP statuses, durations, and response bodies. |
| `_external_auths` | Links OAuth2 provider identities (`provider`, `providerId`) to local auth collection records (`collectionId`, `recordId`). |
| `_api_keys` | Stores scoped service API keys (`name`, `keyHash`, `keyPrefix`, `scopes`, `collections`, `expiresAt`, `lastUsedAt`). |

If no `users` collection exists, `SystemMigrations` seeds the default `users` `auth` collection (`id: 'c_users_default'`, with `name` text and `avatar` file fields, public `listRule`/`viewRule`/`createRule: ''`, and owner-only `updateRule`/`deleteRule: 'id = @request.auth.id'`) and creates the underlying `users` table.

---

## Schema Management (`SchemaService`)

`SchemaService` (`src/schema/SchemaService.ts`) manages collection lifecycles, SQLite DDL execution, and schema validation.

### Collection & Field Types

- **Collection Types (`CollectionType`)**:
  - `'base'`: Standard data table with system columns `id TEXT PRIMARY KEY`, `created TEXT NOT NULL`, `updated TEXT NOT NULL`.
  - `'auth'`: User authentication table that adds `email TEXT UNIQUE`, `emailVisibility INTEGER DEFAULT 0`, `verified INTEGER DEFAULT 0`, `passwordHash TEXT NOT NULL`, and `tokenKey TEXT NOT NULL` alongside user-defined fields.
  - `'view'`: Read-only or virtual collection definition.
- **Field Types (`FieldType`)**:
  - `'text'`, `'number'`, `'bool'`, `'email'`, `'url'`, `'date'`, `'select'`, `'json'`, `'file'`, `'relation'`.
  - **SQLite Column Type Mapping**: `number` maps to `NUMERIC`, `bool` maps to `INTEGER`, and all other field types map to `TEXT`.

### Schema Validation Rules

`SchemaService.validateSchemaFields()` enforces strict naming and structural invariants:

1. **System Table Prefix**: User-created collections cannot start with `_` (reserved for internal system tables registered via `registerSystemCollection()`).
2. **Valid Identifiers**: Field names cannot start with a digit (`0-9`) and cannot be duplicated within the same collection.
3. **Reserved System Fields**: Custom fields cannot use `id`, `created`, or `updated` (nor `email`, `emailVisibility`, `verified`, `password`, `passwordHash`, or `tokenKey` on `auth` collections).
4. **Reserved FTS Metadata Names**: Custom fields cannot be named `_score`, `_snippet`, `_snippets`, start with `_snippet_`, or start with `__fts_`.
5. **SQLite FTS5 Reserved Columns**: Enabling `fts: true` (or leaving `fts` enabled by default on a `text` field) on a field named `rank` or `rowid` is rejected to prevent SQLite FTS5 syntax collisions.

### Dynamic DDL & Schema Synchronization

- **`createCollection()`**: Validates fields, inserts the metadata row into `_collections`, executes `CREATE TABLE "<name>" (...)`, and builds the FTS5 index via `FtsService.syncCollection()`.
- **`updateCollection()`**:
  - Supports renaming tables via `ALTER TABLE "<old>" RENAME TO "<new>"` after verifying no target table collision exists.
  - Compares old and new `schema` arrays and dynamically issues `ALTER TABLE "<name>" ADD COLUMN "<field>" <SQLType>` for newly added fields.
  - Re-synchronizes FTS5 virtual tables and triggers via `FtsService.syncCollection()`.
- **`deleteCollection()`**: Refuses to delete collections marked `system: true`; otherwise drops FTS5 tables/triggers, removes the `_collections` entry, and executes `DROP TABLE IF EXISTS "<name>"`.

---

## Instant API: JSON Schema Inference (`SchemaInferenceService`)

`SchemaInferenceService` (`src/schema/SchemaInferenceService.ts`) powers the **"Paste JSON -> Instant API"** workflow via two primary methods:

1. **`inferSchema(rawJson, customCollectionName?)`**:
   - **Envelope Unwrapping (`parsePayload`)**: Accepts a JSON array, a single JSON object, or common wrapper envelopes (`data`, `items`, `records`, `results`, `rows`, `list`, `itemsList`, or any object containing a single array property such as `{ "products": [...] }`, using the wrapper key as the suggested collection name).
   - **Field Type Detection (`inferFieldType`)**: Samples up to 250 rows per column and classifies values into `'json'` (nested objects/arrays), `'bool'`, `'number'` (finite numbers), `'date'` (ISO-8601 and date strings validated by `isDateString()`), or `'text'` (default).
   - **Identifier Normalization**: Normalizes keys to lowercase `snake_case`, prefixes leading digits with `f_`, renames collisions with reserved system columns (`id`, `created`, `updated`, and auth columns) to `<name>_val`, and detects `required` and `unique` constraints.
2. **`importJson(rawJson, options)`**:
   - Applies optional `schemaOverrides` (supporting field renames via `oldName`/`originalName`/`from`/`to` while preserving `rawKeyToFieldMap`, as well as overriding `type`, `required`, and `unique`).
   - Validates and hashes passwords (`PasswordHasher.hashPassword`) when importing into an `'auth'` collection.
   - Creates the collection via `SchemaService.createCollection()` and bulk-inserts all records inside a single SQLite `transaction()`, serializing nested objects/arrays to JSON strings and coercing booleans to `1`/`0`. If insertion fails, the newly created collection is rolled back.
   - Emits `afterImport` on the `EventBus` and broadcasts up to 10 `'create'` events to `RealtimeService`.

---

## TypeScript & OpenAPI Code Generation

- **`TypeGenerator`** (`src/schema/TypeGenerator.ts`):
  - Generates end-to-end TypeScript definitions (`generateTypes()`) for all non-`_` collections.
  - Emits `BaseSystemFields`, `AuthSystemFields`, string literal union types for `'select'` fields (`<Col><Field>Options`), `<Pascal>Record`, `<Pascal>Expand` (for `'relation'` fields), `<Pascal>Response`, a master `SchemaCollections` registry, and the `TypedRecord<T>` helper type.
- **`OpenApiGenerator`** (`src/schema/OpenApiGenerator.ts`):
  - Generates an OpenAPI `3.0.3` specification (`generate(baseUrl, appName)` / `generateJson()`).
  - Automatically scopes paths to `/api` for the `default` app or `/api/apps/<appName>` for multi-tenant apps.
  - Excludes internal `_` collections and generates full CRUD schemas, `multipart/form-data` schemas for collections with `'file'` fields, FTS `search` and `highlightTag` parameters, chaos engineering query parameters (`_chaos_delay`, `_chaos_failRate`, `_chaos_status`), and system/auth/webhook endpoints.

---

## Record Management (`RecordService`)

`RecordService` (`src/records/RecordService.ts`) coordinates CRUD operations, access rules, hooks, file cleanup, real-time broadcasts, and bulk data movement.

### Core CRUD & Lifecycle Pipeline

| Operation | API Key Scope | Rule Checked | Hooks Emitted | Key Behavior |
| :--- | :--- | :--- | :--- | :--- |
| `getList(collection, params, context)` | `'list'` | `listRule` (SQL filter via `RuleEngine.buildListFilter`) | `beforeList`, `afterList` | Paginates (`page >= 1`, `perPage` clamped `1..500`, default `30`), combines user `filter`, rule SQL, and FTS5 `search`, orders by `sort` (or BM25 `_score`), and expands relations. |
| `getOne(collection, id, context, query)` | `'view'` | `viewRule` (`RuleEngine.evaluate`) | `beforeView`, `afterView` | Fetches record by `id`, evaluates `viewRule` against record data, sanitizes fields, and expands relations. |
| `create(collection, data, context, query)` | `'create'` | `createRule` (`RuleEngine.evaluate`) | `beforeCreate`, `afterCreate` | Validates via `RecordValidator`, generates 15-char ID (`IdGenerator.generate()`), hashes password on `auth` collections, inserts row, broadcasts `'create'` to `RealtimeService`, and triggers webhooks. |
| `update(collection, id, data, context, query)` | `'update'` | `updateRule` (`RuleEngine.evaluate`) | `beforeUpdate`, `afterUpdate` | Merges incoming fields with existing record, validates constraints, updates `tokenKey` if password changes on an `auth` record, updates row, and broadcasts `'update'`. |
| `delete(collection, id, context)` | `'delete'` | `deleteRule` (`RuleEngine.evaluate`) | `beforeDelete`, `afterDelete` | Evaluates `deleteRule`, deletes row, removes associated disk files via `FileStorageService.deleteRecordFiles()`, and broadcasts `'delete'`. |

### Record Sanitization & Relation Expansion

- **Record Sanitization (`sanitizeRecord`)**:
  - Converts boolean fields from SQLite `1`/`0` back to JavaScript `true`/`false` and parses `'json'` columns from JSON strings.
  - Strips `passwordHash` and `tokenKey` from `'auth'` collection records.
  - Masks `email` on `'auth'` records when `emailVisibility` is `false` and the caller is neither an admin nor the authenticated owner of that record (`context.auth.id === formatted.id`).
- **Single-Level Relation Expansion (`expandRecord`)**:
  - When `?expand=author,tags` is passed, `RecordService` resolves `'relation'` fields up to depth 1, populates `record.expand[fieldName]`, and verifies that the caller satisfies the target collection's `viewRule` before attaching each related record.

---

## Filtering, Full-Text Search & Bulk Data Tools

### `QueryFilterParser` & `FilterCodec`

- **`QueryFilterParser`** (`src/records/QueryFilterParser.ts`):
  - Compiles filter expressions (`=`, `!=`, `>`, `>=`, `<`, `<=`, `~`, `!~`, `&&`, `||`, parentheses) into parameterized SQL `WHERE` clauses (`{ sql, params }`).
  - Validates every referenced field name against `allowedFields` (system columns + collection schema fields) to prevent SQL injection.
  - Translates `~` and `!~` into `LIKE ? ESCAPE '\'` / `NOT LIKE ? ESCAPE '\'` (auto-wrapping literals in `%...%` when no `%` is present) and translates `= null` / `!= null` into `IS NULL` / `IS NOT NULL`.
  - `parseSort(sortStr, allowedFields)` converts comma-separated sort strings (e.g., `-created,title`) into validated `ORDER BY "created" DESC, "title" ASC` clauses.
- **`FilterCodec`** (`src/records/FilterCodec.ts`):
  - Safely encodes and decodes filter expressions for URL transport (`~b64~<base64url>`) so WAFs, proxies, and reverse proxies do not block comparison operators or quotes in query strings.

### Full-Text Search (`FtsService`)

`FtsService` (`src/records/FtsService.ts`) manages zero-configuration SQLite FTS5 indexing:

- **Automatic Indexing**: All `'text'` fields are indexed by default unless explicitly configured with `fts: false` (and other field types can opt in with `fts: true`).
- **Virtual Tables & Triggers**: For each collection with searchable fields, `syncCollection()` creates:
  - Virtual table `"_fts_<collection>" USING fts5(id UNINDEXED, <fields>, tokenize = 'porter unicode61')`.
  - Three synchronization triggers (`_fts_<collection>_ai`, `_fts_<collection>_au`, `_fts_<collection>_ad`) that keep the FTS index in sync on `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE`, wrapping column values in ` COALESCE(CAST(new."col" AS TEXT), '')`.
- **BM25 Ranking & Snippets**: `buildSearchJoin()` sanitizes user search queries into prefix-matched FTS5 tokens (`"token"*`), joins `"_fts_<collection>"` on `id`, computes relevance via `(bm25("_fts_<collection>") * -1.0) AS "_score"`, and extracts highlighted snippets via `snippet()` into `_snippet` and `_snippets.<field>` (defaulting to `<mark>...</mark>`).
- **Fallback Search**: If `search` is queried on a collection without an FTS5 index, `RecordService.getList()` automatically falls back to `LIKE` (`~`) across all `'text'`, `'email'`, and `'url'` fields.

### CSV & JSON Import/Export (`CsvHelper`)

- **`CsvHelper`** (`src/records/CsvHelper.ts`) implements an RFC 4180-compliant CSV parser and serializer with automatic delimiter detection (`,`, `;`, `\t`), UTF-8 BOM stripping, multiline quoted values, and `""` quote escaping.
- **`RecordService.exportRecords()`** exports filtered records as `'json'` or `'csv'` (respecting `listRule` and the `'export'` API key scope).
- **`RecordService.importRecords()`** bulk-imports CSV strings or JSON arrays inside a single database transaction (respecting `createRule` and the `'import'` API key scope), supporting `continueOnError` (default `true`) to collect row-level validation failures without aborting valid rows.

### Synthetic Mock Data (`MockDataService` & `FakerEngine`)

- **`MockDataService`** (`src/records/MockDataService.ts`) and **`FakerEngine`** (`src/records/FakerEngine.ts`) generate between `1` and `500` context-aware mock records per call:
  - **Relational Auto-Seeding**: If a collection has `'relation'` fields pointing to empty target collections, `autoSeedRelations()` automatically seeds 5 mock records in each target collection first.
  - **Heuristic Field Generation**: `FakerEngine` inspects field names (`email`, `price`, `avatar`, `title`, `bio`, `phone`, `city`, etc.) and field types to synthesize realistic values.
  - **Zero-Dependency Image Synthesis**: For `'file'` fields, `MockDataService` generates valid binary PNGs (constructed via raw `IHDR`, `IDAT` with `zlib.deflateSync`, and `IEND` chunks with CRC32 checksums) or SVG avatars/placeholders on disk via `FileStorageService`, with an optional 2.5-second DiceBear avatar fetch when `downloadFiles !== false`.
