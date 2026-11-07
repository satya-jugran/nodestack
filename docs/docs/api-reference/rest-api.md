---
sidebar_position: 1
id: rest-api
title: REST API & OpenAPI Reference
description: Complete REST endpoints reference and OpenAPI 3.0 specification
---

# REST API & OpenAPI Reference

NodeStack dynamically generates an OpenAPI 3.0 specification and serves interactive documentation explorers.

---

## Interactive Documentation Viewers

When your NodeStack instance is running, navigate to:

```
http://localhost:8090/_/docs
```

By default, NodeStack renders **Scalar**, a modern, responsive API reference viewer with:
* Live API request playground (Try It Out).
* Code snippet generators in TypeScript, cURL, Python, Go, and PHP.
* Dark / Light mode toggle.

To view with **Swagger UI**, append `?ui=swagger`:
```
http://localhost:8090/_/docs?ui=swagger
```

---

## OpenAPI 3.0 JSON Specification

Download the complete JSON schema spec for tools like Postman, Insomnia, or custom code generators:

```
GET /api/openapi.json
GET /_/openapi.json
```

---

## Core REST Endpoints Summary

### Collection Records
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/collections/:collection/records` | Query, filter, sort, and paginate records. |
| `POST` | `/api/collections/:collection/records` | Insert a new record (JSON or multipart). |
| `GET` | `/api/collections/:collection/records/:id` | Retrieve single record by ID. |
| `PATCH` | `/api/collections/:collection/records/:id` | Update record fields. |
| `DELETE` | `/api/collections/:collection/records/:id` | Delete record. |

### Authentication & OAuth2
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/collections/:collection/auth-with-password` | Authenticate user with identity & password. |
| `GET` | `/api/collections/:collection/auth-methods` | List active OAuth2 providers with PKCE challenge and auth URLs. |
| `POST` | `/api/collections/:collection/auth-with-oauth2` | Exchange OAuth2 code and PKCE codeVerifier for session JWT. |
| `GET` | `/api/collections/:collection/records/:id/external-auths` | List linked social identities for an authenticated user. |
| `DELETE` | `/api/collections/:collection/records/:id/external-auths/:provider` | Unlink an external social identity. |
| `POST` | `/api/collections/users/request-password-reset` | Send password reset email. |
| `POST` | `/api/collections/users/confirm-password-reset` | Complete password reset with token. |
| `POST` | `/api/collections/users/auth-refresh` | Refresh an active JWT session. |

### API Keys & Machine-to-Machine (M2M) Tokens (Superuser)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/api-keys` | List all API keys with redacted tokens and usage stats. |
| `POST` | `/api/api-keys` | Generate a new scoped API key. |
| `GET` | `/api/api-keys/:id` | Retrieve metadata for a single API key. |
| `PATCH` | `/api/api-keys/:id` | Update key name, scopes, IP allowlist, or expiration. |
| `DELETE` | `/api/api-keys/:id` | Revoke and delete an API key. |
| `POST` | `/api/api-keys/:id/rotate` | Rotate secret key entropy. |

### Realtime & Files
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/realtime` | Open Server-Sent Events (SSE) stream. |
| `POST` | `/api/realtime` | Submit topic subscriptions. |
| `GET` | `/api/files/:collection/:recordId/:filename` | Stream uploaded binary file. |

### Webhooks
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/webhooks` | List registered webhooks. |
| `POST` | `/api/webhooks` | Register a new webhook endpoint. |
| `POST` | `/api/webhooks/:id/test` | Dispatch a test payload. |
| `GET` | `/api/webhooks/:id/deliveries` | Retrieve delivery logs. |
| `POST` | `/api/webhooks/deliveries/:deliveryId/retry` | Retry failed delivery. |

### Serverless Functions
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/functions` | List all registered serverless functions (Superuser). |
| `GET` | `/api/functions/stats` | Retrieve aggregate metrics: total functions, active count, executions, success rate. |
| `POST` | `/api/functions` | Create a new serverless function (`name`, `code`, `authPolicy`, `timeoutMs`, etc.) (Superuser). |
| `GET` | `/api/functions/:idOrName` | Retrieve details, configuration, and source code for a function. |
| `PATCH` | `/api/functions/:id` | Update code, metadata, lifecycle hook triggers, limits, or env secrets (Superuser). |
| `DELETE` | `/api/functions/:id` | Delete a serverless function and execution logs. Returns `409 Conflict` if referenced by active flows unless `?force=true` is passed (Superuser). |
| `ANY` | `/api/functions/:name/invoke` | Invoke a serverless function via HTTP (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`). |
| `POST` | `/api/functions/:id/test` | Live test runner: execute function isolated in sandbox and inspect output (Superuser). |
| `GET` | `/api/functions/logs` | Query paginated execution logs across all functions with status filter. |
| `GET` | `/api/functions/:id/logs` | Query execution logs for a specific function. |
| `DELETE` | `/api/functions/logs` | Clear execution history logs (Superuser). |
| `ANY` | `/api/apps/:appId/functions/:name/invoke` | Invoke a serverless function scoped to a specific tenant application. |

### Function Flows & State Machines
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/flows` | List all registered state machine flows (Superuser). |
| `POST` | `/api/flows` | Create a new flow (`name`, `triggerType`, `eventTrigger`, `definition`) (Superuser). |
| `GET` | `/api/flows/:id` | Retrieve flow details, triggers, and JSON state machine definition (Superuser). |
| `PATCH` | `/api/flows/:id` | Update flow metadata, triggers, enabled state, or definition (Superuser). |
| `DELETE` | `/api/flows/:id` | Delete a flow and its execution history (Superuser). |
| `POST` | `/api/flows/:id/execute` | Execute a flow with an input payload (`:id` can be flow ID or unique name). |
| `GET` | `/api/flows/executions` | List recent executions across all flows with optional status filter (Superuser). |
| `GET` | `/api/flows/:id/executions` | Query execution history and step-level metrics for a specific flow (Superuser). |
| `GET` | `/api/flows/executions/:executionId` | Inspect complete details and step logs for an individual execution (Superuser). |
| `DELETE` | `/api/flows/:id/executions` | Clear execution history records for a specific flow (Superuser). |
| Any | `/api/apps/:appId/flows/*` | Access flow management and execution endpoints scoped to a tenant application. |

### Queues & Background Workers
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/queues` | List all registered queues with concurrency, lease timeouts, and strict order settings (Superuser). |
| `POST` | `/api/queues` | Create or update a queue configuration (`name`, `concurrency`, `visibilityTimeoutSeconds`, `maxAttempts`, `targetFunction`, `strictOrder`) (Superuser). |
| `GET` | `/api/queues/:name` | Retrieve configuration and metadata for a specific queue (Superuser). |
| `DELETE` | `/api/queues/:name` | Delete a queue and purge its messages (Superuser). |
| `GET` | `/api/queues/stats` | Retrieve aggregate queue metrics: queued, processing, completed, failed, and dead-letter counts. |
| `GET` | `/api/queues/messages` | Query paginated messages across all queues with status and queue filters (Superuser). |
| `GET` | `/api/queues/messages/:id` | Retrieve detailed payload, status, attempts, and execution logs for a message. |
| `POST` | `/api/queues/:name/messages` | Publish / enqueue a new message (`payload`, `groupKey`, `delaySeconds`, `priority`, `maxAttempts`). |
| `GET` | `/api/queues/:name/messages` | List paginated messages for a specific queue. |
| `POST` | `/api/queues/:name/messages/:id/ack` | Acknowledge job completion (`result`, `claimToken`). |
| `POST` | `/api/queues/:name/messages/:id/nack` | Mark job failure to schedule retry or dead-letter (`error`, `claimToken`). |
| `POST` | `/api/queues/:name/messages/:id/touch` | Extend lease visibility timeout heartbeat for an active worker (`claimToken`). |
| `POST` | `/api/queues/:name/messages/:id/skip` | Force-skip a failed or blocking message in a strict FIFO partition. |
| `POST` | `/api/queues/:name/messages/:id/retry` | Manually retry a failed or dead-letter message. |
| `POST` | `/api/queues/:name/dlq/retry` | Re-drive all dead-letter messages back into the active queue. |
| `DELETE` | `/api/queues/:name/messages/:id` | Delete a specific queue message. |
| `DELETE` | `/api/queues/:name/purge` | Purge all messages from a queue (Superuser). |
| Any | `/api/apps/:appId/queues/*` | Route any queue operation to a specific application tenant. |

### Applications & Multi-Tenancy
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/apps` | List all applications (Superuser). |
| `POST` | `/api/apps` | Create a new application with optional template (Superuser). |
| `GET` | `/api/apps/:id` | Get details for an application by ID or slug (Superuser). |
| `PATCH` | `/api/apps/:id` | Update application name or metadata (Superuser). |
| `DELETE` | `/api/apps/:id` | Delete an application, its database, and files (`default` app is protected) (Superuser). |
| Any | `/api/apps/:appId/*` | Route any collection, auth, file, or search request to a specific application tenant. |

> [!TIP]
> Clients can also route requests to any application without changing URLs by passing the `x-nodestack-app: <appId-or-slug>` HTTP header. See the [Multi-Application Platform Guide](../core-concepts/multi-application.md).

### Application Snapshots
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/snapshots` | List all snapshots, capacity status, and schema drift (Superuser). |
| `POST` | `/api/snapshots` | Create an atomic state snapshot checkpoint (`{ label, description, evictOldest }`) (Superuser). |
| `GET` | `/api/snapshots/:id` | Get details and metadata for a specific snapshot (Superuser). |
| `POST` | `/api/snapshots/:id/restore` | Non-destructively restore application state to this checkpoint (Superuser). |
| `DELETE` | `/api/snapshots/:id` | Delete a snapshot checkpoint (Superuser). |
| `POST` | `/api/snapshots/clear` | Delete all snapshots for the active application (Superuser). |
| `GET` | `/api/snapshots/status` | Retrieve snapshot count, 10-snapshot limit, and capacity warnings (Superuser). |
| Any | `/api/apps/:appId/snapshots/*` | Route any snapshot operation to a specific application tenant. |
