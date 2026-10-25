---
sidebar_position: 1
id: collections
title: Collections & Fields
description: Defining schemas and data models in NodeStack
---

Collections & Fields

Collections in NodeStack correspond directly to tables in SQLite, with built-in schema validation, access rules, triggers, and full-text search indexing.

---

## System Collections

When NodeStack initializes, it automatically provisions system collections prefixed with `_`:

* **`users` (`_auth`)**: Handles user authentication, email addresses, password hashes, and token invalidation.
* **`_superusers`**: Master administrators with unrestricted access to the Web Admin UI and system APIs.
* **`_audit_logs`**: Immutable record of field-level data mutations, actor IDs, timestamps, and old-to-new diffs.
* **`_webhooks`**: Outbound webhook endpoint registrations, action triggers, and secrets.
* **`_webhook_deliveries`**: Outbound HTTP dispatch attempt logs, response status codes, latency, and retry counts.

---

## Supported Field Types

Every field in a collection is backed by an SQLite data type and validated at runtime:

| Field Type | SQLite Type | Validation & Behavior |
| :--- | :--- | :--- |
| **`text`** | `TEXT` | Plain text strings, min/max length checks, regex patterns. Can be indexed for FTS5 full-text search. |
| **`number`** | `REAL` / `INTEGER` | Floating point or integers, with optional `min` and `max` constraints. |
| **`bool`** | `INTEGER` | Boolean `0` or `1`. Normalized automatically from JSON booleans. |
| **`email`** | `TEXT` | RFC 5322 email validation. |
| **`url`** | `TEXT` | URL format validation. |
| **`date`** | `TEXT` | ISO 8601 UTC date/time strings (`YYYY-MM-DDTHH:mm:ss.sssZ`). |
| **`select`** | `TEXT` | Single or multi-choice dropdown with custom option values. |
| **`json`** | `TEXT` | Arbitrary JSON objects and arrays validated with JSON parser. |
| **`file`** | `TEXT` (filename) | Multipart file attachments with MIME validation and size limits. |
| **`relation`** | `TEXT` (ID) | Foreign key pointing to another collection's record ID. Supports expanding. |

---

## Schema Inference (`schema:infer`)

NodeStack supports automatic schema inference. If you have existing JSON records or CSV data, the CLI can automatically infer the optimal column types:

```bash
npx @nodestackapp/server schema infer ./sample-data.json --collection products
```

---

## Automatic Timestamps & IDs

Every record created in NodeStack automatically includes:
* **`id`**: 15-character nano-ID unique string (e.g. `rec_7x9k2p8mq1`).
* **`created`**: ISO 8601 UTC timestamp of creation.
* **`updated`**: ISO 8601 UTC timestamp of the latest mutation.
