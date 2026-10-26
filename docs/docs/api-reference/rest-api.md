---
sidebar_position: 1
id: rest-api
title: REST API & OpenAPI Reference
description: Complete REST endpoints reference and OpenAPI 3.0 specification
---

REST API & OpenAPI Reference

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

### Applications & Multi-Tenancy (v2.0)
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

### Application Snapshots (v2.0)
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
