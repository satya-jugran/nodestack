---
sidebar_position: 2
id: querying-records
title: Querying Records
description: Fluent record querying, CRUD, and full-text search with nodestack-client
---

Querying Records

The `client.collection('<name>')` service provides a fluent, type-safe API for querying and mutating collection records.

---

## 1. Paginated List (`getList`)

```typescript
const result = await client.collection('posts').getList(1, 10, {
  filter: "status = 'active' && views >= 10",
  sort: '-created',
  expand: 'author',
});

console.log('Current page:', result.page);
console.log('Total pages:', result.totalPages);
console.log('Records:', result.items);
```

---

## 2. Full-Text Search with BM25 Scoring & Snippets

Query records using SQLite FTS5:

```typescript
const searchResults = await client.collection('posts').getList(1, 10, {
  search: 'distributed systems',
  snippetTag: 'mark',     // Highlight tag (default: <mark>)
  snippetLength: 25,       // Max words per excerpt
});

// Each returned item includes FTS scores and highlights:
console.log('Score:', searchResults.items[0]._score);
console.log('Snippet:', searchResults.items[0]._snippet);
console.log('Field snippets:', searchResults.items[0]._snippets);
```

---

## 3. Fetch All Records Across Pages (`getFullList`)

Automatically traverses all pages in batches and returns a single array:

```typescript
const allPosts = await client.collection('posts').getFullList({
  batch: 200,
  sort: '-created',
});

console.log(`Fetched all ${allPosts.length} posts`);
```

---

## 4. Find First Matching Record (`getFirstListItem`)

```typescript
// Throws ClientResponseError (404) if no record matches
const post = await client.collection('posts').getFirstListItem("slug = 'hello-world'");
```

---

## 5. Create Record (JSON or File Upload)

### JSON Record
```typescript
const newPost = await client.collection('posts').create({
  title: 'My First Post',
  content: 'Hello NodeStack!',
  status: 'published',
});
```

### Multipart File Upload
```typescript
const formData = new FormData();
formData.append('title', 'Avatar Update');
formData.append('avatar', fileInput.files[0]);

const updatedUser = await client.collection('users').create(formData);
```

---

## 6. Update & Delete Records

```typescript
// Partial Update (PATCH)
const updated = await client.collection('posts').update('rec_123', {
  status: 'archived',
});

// Delete
await client.collection('posts').delete('rec_123');
```
