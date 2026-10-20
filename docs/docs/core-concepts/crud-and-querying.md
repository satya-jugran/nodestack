---
sidebar_position: 3
id: crud-and-querying
title: CRUD & Querying Syntax
description: Query syntax for filtering, sorting, pagination, and expanding relations
---

CRUD & Querying Syntax

NodeStack provides a clean, declarative query parameter syntax for all collection endpoints.

---

## Standard Endpoints

For any collection named `<collection>`:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/collections/:collection/records` | Paginated list of records with filters & search. |
| `GET` | `/api/collections/:collection/records/:id` | Retrieve a single record by ID. |
| `POST` | `/api/collections/:collection/records` | Create a new record (JSON or multipart). |
| `PATCH` | `/api/collections/:collection/records/:id` | Partially update an existing record. |
| `DELETE` | `/api/collections/:collection/records/:id` | Delete a record. |

---

## Query Parameters

### 1. Pagination (`page` & `perPage`)

* `?page=1` (Default: `1`)
* `?perPage=20` (Default: `20`, Max: `500`)

```bash
GET /api/collections/posts/records?page=2&perPage=50
```

Response structure:
```json
{
  "page": 2,
  "perPage": 50,
  "totalItems": 142,
  "totalPages": 3,
  "items": [ ... ]
}
```

---

### 2. Sorting (`sort`)

Sort by one or more fields. Prefix with `-` for descending, or `+` (or nothing) for ascending:

* `?sort=-created`: Newest first.
* `?sort=title,-views`: Ascending by title, descending by views.

```bash
GET /api/collections/posts/records?sort=-created,title
```

---

### 3. Filtering (`filter`)

Filter records using SQL-like logical expressions:

* Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `~` (LIKE / contains), `!~` (NOT LIKE).
* Logical connectors: `&&` (AND), `||` (OR).
* Grouping: `( )` parentheses.

```bash
# Only active posts with at least 100 views
GET /api/collections/posts/records?filter=(status = 'active' && views >= 100)

# Substring pattern match
GET /api/collections/posts/records?filter=title ~ 'typescript'
```

---

### 4. Expanding Relations (`expand`)

Resolve relation fields and embed the foreign record inside an `expand` object:

```bash
GET /api/collections/posts/records?expand=author,category
```

Returned record:
```json
{
  "id": "rec_001",
  "title": "Hello World",
  "author": "usr_999",
  "expand": {
    "author": {
      "id": "usr_999",
      "name": "Jane Doe",
      "email": "jane@example.com"
    }
  }
}
```
