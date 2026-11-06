---
type: "Reference"
title: "Authentication, OAuth2, API Keys & Access Rules"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-05T17:08:40.212Z
sources:
  - id: openwiki-source-46bed1e718db2844a20df5a0
    resource: repo://src/auth/ApiKeyService.ts
  - id: openwiki-source-e9525919692ca5238c7e3a41
    resource: repo://src/auth/AuthService.ts
  - id: openwiki-source-94d321946f72e1f202d7e8ba
    resource: repo://src/auth/oauth/BaseOAuthProvider.ts
  - id: openwiki-source-ded818f3e89faeca9f8bf3b3
    resource: repo://src/auth/oauth/OAuthProviderRegistry.ts
  - id: openwiki-source-ec0155b88dc4ad58267aeaea
    resource: repo://src/http/middleware/AuthMiddleware.ts
  - id: openwiki-source-84a103e732850b1d05a970e4
    resource: repo://src/rules/RuleBuilder.ts
  - id: openwiki-source-b33c365fc1206172519c98b2
    resource: repo://src/rules/RuleEngine.ts
  - id: openwiki-source-74eae65818c1f5e9652413c7
    resource: repo://tests/api-keys.test.ts
  - id: openwiki-source-076ce4b9911ace3c4b36a1af
    resource: repo://tests/auth-session-revocation.test.ts
  - id: openwiki-source-4854b01a9372e0d1c6695efd
    resource: repo://tests/oauth2.test.ts
  - id: openwiki-source-2258755165bace71b390ce47
    resource: repo://tests/rule-builder.test.ts
  - id: openwiki-source-7a6d6991cdc34a8bbf49c67a
    resource: repo://tests/rules.test.ts
generated: { by: "antigravity", at: "2026-11-05T17:08:40.212Z" }
---

# Authentication, OAuth2, API Keys & Access Rules

NodeStack provides a multi-layered authentication and authorization subsystem consisting of JWT-based Admin and Collection authentication (`AuthService`), PKCE-backed OAuth2 social login (`OAuthProviderRegistry` and `BaseOAuthProvider` implementations), scoped Machine-to-Machine (M2M) API keys (`ApiKeyService`), request authentication middleware (`AuthMiddleware`), and a declarative row- and request-level access control engine (`RuleEngine` & `RuleBuilder`).

---

## Authentication & Session Revocation (`AuthService`)

`AuthService` (`src/auth/AuthService.ts`) manages password hashing, JWT issuance/verification, and instant session revocation for both global super-admins (`_admins`) and per-application `auth` collections (such as `users`).

### Password Hashing & JWT Issuance

- **Password Hashing**: `hashPassword(password)` hashes passwords with `bcryptjs` (salt rounds = `10`), and `verifyPassword(password, hash)` verifies candidate passwords. Admin passwords require a minimum length of 8 characters (`createAdmin`, `updateAdminPassword`).
- **Token Generation (`generateToken`)**: Signs an `AuthClaims` payload (`{ id, email, collection, tokenKey, isAdmin }`) using `ConfigService.jwtSecret`.
  - Admin sessions (`authenticateAdmin`) default to a `14d` expiration (`collection: '_admins'`, `isAdmin: true`).
  - Collection record sessions (`authenticateRecord` / `authenticateOAuth2`) default to a `7d` expiration (`collection: col.name`, `isAdmin: false`).
- **Sensitive Field Stripping**: `authenticateAdmin`, `authenticateRecord`, `authenticateOAuth2`, and `getAdminById` always strip `passwordHash` and `tokenKey` before returning records to callers.

### Stateful Session Revocation via `tokenKey`

Every admin row in `_admins` and every user row in an `auth` collection stores a random 16-byte hex `tokenKey` (`crypto.randomBytes(16).toString('hex')`), which is embedded into issued JWTs.

1. **Verification (`verifyToken`)**:
   - First verifies the cryptographic JWT signature and expiration against `config.jwtSecret`.
   - Then compares `decoded.tokenKey` against the current `tokenKey` stored in `_admins` (via `AppRegistry` or `db`) or the target `auth` collection table. If they differ, `verifyToken` throws `401 UnauthorizedError('Authentication token has been revoked or expired')`.
2. **LRU Token Key Cache**:
   - To avoid querying SQLite on every authenticated request, `AuthService` maintains an in-memory LRU `tokenKeyCache` keyed by `${collection}:${id}` with a 30-second TTL (`tokenKeyCacheTtlMs = 30000`) and a capacity of `5000` entries (`maxTokenKeyCacheSize = 5000`).
   - `AuthService` subscribes to `EventBus` `onRecordAfterUpdate` and `onRecordAfterDelete` hooks for `auth` collections to automatically call `invalidateTokenCache(col.name, ctx.record.id)`.
3. **Revocation Triggers**:
   - **Admin Password Reset (`updateAdminPassword`)**: Hashes the new password, generates a new `tokenKey` in both `AppRegistry` (`system.db`) and the local `_admins` table, and invalidates the cache entry.
   - **Explicit Admin Revocation (`revokeAdminSessions(idOrEmail)`)**: Rotates `tokenKey` for the admin and invalidates the cache.
   - **Collection Password Change (`RecordService.update`) & Explicit User Revocation (`revokeRecordSessions(collectionName, idOrEmail)`)**: Updating a user's `password` or calling `revokeRecordSessions` rotates `tokenKey` on the user record and invalidates `${col.name}:${id}` in `tokenKeyCache`, immediately invalidating all previously issued JWTs for that account.

---

## OAuth2 & PKCE Social Authentication

NodeStack supports OAuth2 authorization code flows secured with PKCE (`S256`) and stateful CSRF/replay protection via `OAuthProviderRegistry` (`src/auth/oauth/OAuthProviderRegistry.ts`) and `BaseOAuthProvider` (`src/auth/oauth/BaseOAuthProvider.ts`).

### Built-In OAuth2 Providers

`OAuthProviderRegistry` auto-registers providers from environment variables (`OAUTH_<PROVIDER>_CLIENT_ID` and `OAUTH_<PROVIDER>_CLIENT_SECRET`) or explicit `OAuthProviderConfig` objects:

| Provider | Class | Default Scopes | Profile & Verification Behavior |
|---|---|---|---|
| **Google** (`google`) | `GoogleProvider` | `openid`, `email`, `profile` | Appends `access_type=offline&prompt=consent` to auth URL; reads `email_verified` from OpenID userinfo endpoint. |
| **GitHub** (`github`) | `GitHubProvider` | `read:user`, `user:email` | Queries both `/user` and `/user/emails`; prefers a `primary && verified` email, falls back to matching verified email, and fails closed (`isEmailVerified = false`) if `/user/emails` fails. |
| **Discord** (`discord`) | `DiscordProvider` | `identify`, `email` | Appends `prompt=consent`; constructs CDN avatar URL and checks `data.verified`. |
| **Microsoft** (`microsoft`) | `MicrosoftProvider` | `openid`, `profile`, `email`, `User.Read` | Appends `prompt=select_account`; inspects Graph `/v1.0/me` and decoded `id_token` claims, requiring `email_verified === true` or Entra ID `xms_edov === '1'` for verification. |
| **Apple** (`apple`) | `AppleProvider` | `name`, `email` | Appends `response_mode=query`; fetches Apple's JWKS keys (`https://appleid.apple.com/auth/keys`, cached 1 hour) and cryptographically verifies the `RS256` `id_token` signature, `iss`, `aud`, and `nonce`. |

Passing `enabled: false` to `register()` or `registerFromConfig()` unregisters the provider and excludes it from discovery and login flows.

### PKCE Session Binding & Login Lifecycle

1. **Discovery (`listAuthMethods`)**:
   - Generates a 16-byte hex `state`, a 32-byte hex `codeVerifier`, and an `S256` `codeChallenge` (`base64url` SHA-256 digest of `codeVerifier`) for each enabled provider.
   - Stores a `PkceSession` (`{ state, provider, collection, codeChallenge, codeVerifier, redirectUri, expiresAt }`) with a 10-minute TTL in `OAuthProviderRegistry`.
2. **State & PKCE Validation (`validateAndConsumeState`)**:
   - Immediately deletes the session keyed by `state` upon first use to prevent replay attacks.
   - Verifies that the session has not expired, that `provider`, `collection`, and `redirectUri` match the session, and that `SHA256(codeVerifier)` matches the stored `codeChallenge`.
3. **Code Exchange & Identity Resolution (`authenticateOAuth2`)**:
   - Exchanges `code` and `codeVerifier` via `provider.exchangeCode(...)` (enforcing a default 10-second `AbortSignal.timeout(this.timeoutMs)`).
   - **Existing Link**: Looks up `_external_auths` by `(collection, provider, providerUserId)`. If found and the target user record still exists, updates the link timestamp and signs in.
   - **Auto-Linking by Email**: If no link exists in `_external_auths` but a record in the collection shares the same `email`, NodeStack checks `isEmailVerified`. If `isEmailVerified` is `false`, it rejects the login with a `400 AppError` to prevent pre-hijack / account takeover attacks. If verified, it links the identity in `_external_auths`.
   - **New User Provisioning**: If no matching user exists:
     1. Builds a new record with a random 32-byte hex password hash, populates `name` and `avatar` (downloading remote avatar files via `FileStorageService` if `avatar` is a `file` field), and merges non-reserved fields from `createData`.
     2. Triggers `onRecordBeforeCreate` hooks on `EventBus` (allowing hooks to mutate fields or cancel provisioning).
     3. Validates and normalizes all schema fields via `RecordValidator`.
     4. Evaluates the collection's `createRule` via `RuleEngine.evaluate(col.createRule, { auth: callerAuth, data: insertRecord })`, throwing `403 ForbiddenError` if disallowed.
     5. Inserts the user record and `_external_auths` link, triggers `onRecordAfterCreate` hooks, and broadcasts a `'create'` event on `RealtimeService`.

Users can inspect or unlink social identities via `getExternalAuths(collectionName, recordId)` and `unlinkExternalAuth(collectionName, recordId, provider)`.

---

## Scoped API Keys (`ApiKeyService`)

`ApiKeyService` (`src/auth/ApiKeyService.ts`) provides Machine-to-Machine (M2M) authentication backed by the `_api_keys` system table.

### Key Format & Cryptographic Storage

- **Structure**: Keys are generated with `createKey(dto)` in the format `nsk_<env>_<keyId>_<secretEntropy>`, where:
  - `<env>` defaults to `'test'` in dev mode (`config.dev === true`) or `'live'` in production.
  - `<keyId>` is 6 hex characters (`3` random bytes).
  - `<secretEntropy>` is 48 hex characters (`24` random bytes).
- **Storage**: The plaintext `secretKey` is returned **only once** upon creation or rotation (`rotateKey(id)`). The database stores only `keyPrefix` (`nsk_<env>_<keyId>`), `redactedKey` (`nsk_<env>_<keyId>...<last4>`), and `secretHash` (the SHA-256 hex digest of `secretKey`).
- **Verification (`verifyKey`)**:
  - Looks up the key by `keyPrefix` using a 10-second in-memory `keyCache` before querying `_api_keys`.
  - Compares the SHA-256 hash of the presented token with `secretHash` using `crypto.timingSafeEqual`.
  - Checks `status === 'active'`, validates `expiresAt` (automatically marking expired keys as `status = 'expired'` in SQLite), and checks client IP against `allowedIps` (supporting exact IPs, `*`, `localhost`/`::1`, trailing-dot prefixes like `192.168.1.`, and `/24` CIDR notation).
  - Buffers usage statistics (`lastUsedAt`, `lastUsedIp`, `totalRequests`) in memory and flushes them in a single SQLite transaction every 5 seconds (`usageFlushTimer`).

### Roles & Granular Scopes (`hasScope`)

API keys have a `role` (`'admin' | 'service' | 'custom'`) and an array of `scopes`:
- Keys with `role: 'admin'` automatically receive `['*']`.
- `hasScope(auth, resource, action)` evaluates permissions as follows:
  - Returns `true` if `auth.isAdmin` is `true`, or if `scopes` includes `'*'`, `'admin:*'`, `'${resource}:*'`, or exact `'${resource}:${action}'`.
  - **Read Rollup**: Actions `'list'`, `'view'`, and `'export'` are permitted by `'${resource}:read'` or `'*:read'`.
  - **Write Rollup**: Actions `'create'`, `'update'`, `'delete'`, and `'import'` are permitted by `'${resource}:write'` or `'*:write'`.
- **Interaction with Collection Rules**: Super-admin API keys (`role === 'admin'`, `scopes.includes('*')`, or `scopes.includes('admin:*')`) set `req.auth.isAdmin = true` and bypass collection rules. Non-admin `service` or `custom` API keys set `req.auth.isAdmin = false`; they must pass **both** the API key scope check (`requireScope`) and the target collection's `RuleEngine` access rules.

---

## Request Authentication Middleware (`AuthMiddleware`)

`AuthMiddleware` (`src/http/middleware/AuthMiddleware.ts`) populates `req.auth` (`AuthClaims | null`) on incoming Fastify requests and resolves the active tenant's `AuthService` and `ApiKeyService` from `req.appScope` when present.

1. **API Key Resolution**:
   - Checks `x-api-key` header, `Authorization: Bearer nsk_...`, or `Authorization: ApiKey nsk_...`.
   - If a valid key is verified, populates `req.auth` with `isApiKey: true`, `scopes`, `allowedIps`, and `isAdmin` (true only for admin/wildcard keys). If an `nsk_` token is invalid, `req.auth` remains `null` without falling back to JWT parsing.
2. **JWT Resolution**:
   - Extracts the token from `Authorization: Bearer <jwt>` or the `?token=<jwt>` query parameter.
   - Verifies the token against the request's scoped `AuthService` (`req.appScope.auth`), with a fallback to the root `AuthService` for global super-admin tokens (`adminClaims.isAdmin === true`).
3. **Route Guards**:
   - `requireAuth()`: Returns `401` if `req.auth` is `null`.
   - `requireAdmin()`: Returns `403` unless `req.auth.isAdmin` is `true` or the API key has `'*'` / `'admin:*'` scope.
   - `requireAdminOrInitialSetup()`: Allows unauthenticated access only when `hasAdmins()` is `false` (used for initial super-admin bootstrap), otherwise enforces `requireAdmin()`.
   - `requireScope(resource, action)`: Enforces `requireAuth()` and checks `hasScope(req.auth, resource, action)` for API keys, returning `403` on missing scope.

---

## Declarative Access Control (`RuleEngine` & `RuleBuilder`)

Every collection defines five access rules (`listRule`, `viewRule`, `createRule`, `updateRule`, `deleteRule`), each of which can be `null` (Admin Only), `""` (Public), or a filter expression string.

### Rule Evaluation (`RuleEngine`)

`RuleEngine` (`src/rules/RuleEngine.ts`) evaluates rules in two modes against a `RuleEvaluationContext` (`{ auth, record, data, query }`):

1. **Boolean Evaluation (`evaluate(rule, context)`)** — used for `view`, `create`, `update`, and `delete`:
   - If `context.auth?.isAdmin` is `true`, always returns `true`.
   - If `rule === null` or `undefined`, returns `false`.
   - If `rule.trim() === ''`, returns `true`.
   - Parses top-level `||` (OR) and `&&` (AND) operators respecting parentheses depth and escaped quotes, then evaluates binary comparisons (`!=`, `==`, `>=`, `<=`, `=`, `>`, `<`, `~`) or single boolean identifiers.
   - Resolves literals (quoted strings via `FilterCodec.decode`, numbers, `true`/`false`/`null`), context variables (`@request.auth.<prop>`, `@request.data.<prop>`, `@request.query.<prop>`), and bare field identifiers on `context.record` or `context.data` (enabling create rules like `@request.auth.id != "" && user = @request.auth.id` to validate incoming payload fields).
   - Normalizes SQLite integer booleans (`0` and `1`) when comparing against `true` or `false`.
2. **Row-Level List Filtering (`buildListFilter(rule, context, schemaFields)`)** — used for `list`:
   - Evaluates pure request-level comparisons (such as `@request.auth.id != ""`) immediately in memory. If a required request-level check fails, returns `{ allowed: false }` so the request is rejected with `403 ForbiddenError`.
   - For comparisons referencing collection `schemaFields` (such as `user = @request.auth.id`), substitutes `@request.auth.*` and `@request.query.*` variables using `FilterCodec.encode` and emits a SQL-compatible filter string `{ allowed: true, filter: "user = 'usr_123'" }` that `RecordService` combines with any client-supplied query filter.
   - If an unconditional `||` branch passes for the caller (e.g. `@request.auth.role = "manager" || user = @request.auth.id` for a manager), `buildListFilter` returns `{ allowed: true, filter: undefined }` so no row filter restricts the result set.

### Rule Parsing & Serialization (`RuleBuilder`)

`RuleBuilder` (`src/rules/RuleBuilder.ts`) powers the Admin UI visual rule editor and programmatic rule construction:
- **`parse(rule)`**: Classifies rules into `mode: 'admin'` (`null`), `'public'` (`""`), `'auth'` (`'@request.auth.id != ""'`), or `'custom'` (splitting top-level `||` or `&&` into `{ field, operator, value }` `RuleClause` objects).
- **`build(parsed, options?)`**: Reconstructs the canonical rule string from a `ParsedRule`, automatically quoting string literals while leaving numbers, booleans, `@request.*` variables, and known field identifiers (`DEFAULT_IDENTIFIER_FIELDS`, `*_id`, `*Id`, or `options.knownFields`) unquoted.
- **`validate(rule)`**: Verifies balanced parentheses and quotes before saving collection rules.
- **`getSummary(mode, action?)`**: Generates human-readable descriptions of the active rule mode for each CRUD operation.
