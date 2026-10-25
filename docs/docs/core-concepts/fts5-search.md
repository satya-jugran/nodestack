---
sidebar_position: 4
id: fts5-search
title: Native SQLite FTS5 Search
description: High-performance BM25 full-text search, keyword prefix matching, and snippets
---

# Native SQLite FTS5 Search

NodeStack includes an embedded Full-Text Search Subsystem (FTSS) powered by SQLite's native `FTS5` virtual table engine. It delivers Google-like search capabilities directly in-process without requiring external search engines like Elasticsearch, Meilisearch, or Algolia.

---

## Key Features

* **BM25 Relevance Scoring**: Results are ranked by statistical term frequency and inverse document frequency (`ORDER BY rank ASC`).
* **Automatic SQLite Triggers**: Synchronizes the `_fts_<collection>` virtual table atomically on `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE`.
* **Keyword Prefix Matching**: Searching `type*` matches "typescript", "typedef", and "types".
* **Contextual Snippets & Highlighting**: Returns extracted text excerpts with matching search terms wrapped in `<mark>` tags.
* **Safe Query Sanitization**: Automatic parsing and sanitization prevents malformed FTS syntax exceptions.

---

## Enabling FTS on a Collection

In the Web Admin UI, toggle **Enable FTS5** on any text field when editing a collection schema.

Programmatically, define `fts: true` on the field:

```typescript
{
  name: 'articles',
  fields: [
    { name: 'title', type: 'text', fts: true },
    { name: 'content', type: 'text', fts: true },
    { name: 'status', type: 'text' }
  ]
}
```

---

## Querying with Full-Text Search

Use the `search` query parameter on any collection endpoint:

```bash
# Basic FTS query
GET /api/collections/articles/records?search=typescript+embedded

# Custom snippet highlight tag and excerpt word length
GET /api/collections/articles/records?search=sqlite&snippetTag=mark&snippetLength=30
```

### Response Attributes

When a query includes `?search=...`, each record in `items` is automatically enriched with FTS metadata:

```json
{
  "id": "rec_12345",
  "title": "NodeStack Architecture",
  "content": "NodeStack is a TypeScript-native backend stack with embedded SQLite...",
  "_score": -0.8421,
  "_snippet": "NodeStack is a <mark>TypeScript</mark>-native backend stack with embedded <mark>SQLite</mark>...",
  "_snippets": {
    "title": "NodeStack Architecture",
    "content": "...backend stack with embedded <mark>SQLite</mark>..."
  }
}
```

* **`_score`**: The SQLite BM25 relevance score (lower / more negative numbers indicate higher relevance).
* **`_snippet`**: Best matching excerpt across all indexed fields.
* **`_snippets`**: Per-field snippet excerpts map.

---

## Using via `nodestack-client`

The TypeScript client SDK supports FTS queries directly:

```typescript
const result = await client.collection('articles').getList(1, 10, {
  search: 'distributed database',
  snippetTag: 'mark',
  snippetLength: 20,
});

for (const article of result.items) {
  console.log(`Title: ${article.title}`);
  console.log(`Relevance Score: ${article._score}`);
  console.log(`Snippet: ${article._snippet}`);
}
```
