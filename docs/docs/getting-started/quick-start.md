---
sidebar_position: 2
id: quick-start
title: Quick Start
description: Get up and running with NodeStack in under 60 seconds
---

Quick Start

Get a complete backend running on your machine in less than a minute.

---

## 1. Instant Launch with NPX

Run the following command in any terminal:

```bash
npx nodestack start
```

This immediately:
1. Provisions embedded SQLite database files in `./nodestack_data/`.
2. Starts the HTTP Fastify server on `http://127.0.0.1:8090`.
3. Serves the embedded Web Admin Dashboard at `http://127.0.0.1:8090/_/`.

---

## 2. First-Run Admin Onboarding

1. Open your browser and navigate to:
   ```
   http://localhost:8090/_/
   ```
2. You will be greeted by the **First-Run Setup Screen**.
3. Create your initial Superuser credentials (email and password).

Alternatively, you can create the first superuser directly via the CLI:

```bash
npx nodestack superuser create admin@example.com MySecretPassword123!
```

---

## 3. Create Your First Collection

Inside the Web Admin Dashboard:
1. Click **+ New Collection** in the left sidebar.
2. Enter a collection name (e.g. `articles`).
3. Add fields:
   * `title` (Text)
   * `content` (Text, toggle **Enable FTS5** for full-text search)
   * `published` (Bool)
   * `cover` (File)
4. Click **Create Collection**.

NodeStack immediately creates:
* The SQLite table `articles`.
* The SQLite FTS5 index `_fts_articles` (if FTS is enabled).
* REST endpoints: `GET`, `POST`, `PATCH`, `DELETE` at `/api/collections/articles/records`.
* Real-time SSE change subscription channel at `/api/realtime`.

---

## 4. Query Records via REST API

Create a record with `cURL`:

```bash
curl -X POST http://localhost:8090/api/collections/articles/records \
  -H "Content-Type: application/json" \
  -d '{"title": "Getting Started with NodeStack", "content": "NodeStack is fast and simple."}'
```

Query records with search and pagination:

```bash
curl "http://localhost:8090/api/collections/articles/records?page=1&perPage=10&search=NodeStack"
```

---

## 5. Next Steps

* Connect using the [First-Party Client SDK](../client-sdk/overview).
* Configure [Visual Access Rules](../core-concepts/access-rules) to secure your collections.
* Set up [Outbound Webhooks](../webhooks/outbound-webhooks) to notify third-party services.
