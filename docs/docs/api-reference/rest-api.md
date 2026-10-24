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

### Authentication
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/collections/users/auth-with-password` | Authenticate user with email & password. |
| `POST` | `/api/collections/users/request-password-reset` | Send password reset email. |
| `POST` | `/api/collections/users/confirm-password-reset` | Complete password reset with token. |
| `POST` | `/api/collections/users/auth-refresh` | Refresh an active JWT session. |

### Realtime & Files
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/realtime` | Open Server-Sent Events (SSE) stream. |
| `POST` | `/api/realtime` | Submit topic subscriptions. |
| `GET` | `/api/files/:collection/:recordId/:filename` | Stream uploaded binary file. |

### Webhooks (v1.3)
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
