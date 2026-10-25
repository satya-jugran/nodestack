---
sidebar_position: 1
id: programmatic-usage
title: Programmatic Usage
description: Using NodeStack as an embedded framework inside your Node.js app
---

Programmatic Usage

In addition to running as a standalone CLI server, NodeStack is an importable TypeScript framework.

---

## Installation

```bash
npm install @nodestackapp/server
```

---

## Basic Server Setup

Create an `index.ts` file:

```typescript
import { NodeStack } from '@nodestackapp/server';

const app = new NodeStack({
  dataDir: './nodestack_data',
  port: 8090,
  host: '127.0.0.1',
});

// Start the server
await app.start();

console.log('NodeStack backend running at http://127.0.0.1:8090');
console.log('Admin UI available at http://127.0.0.1:8090/_/');
```

---

## Inversion of Control & Dependency Injection

NodeStack is built with Clean Architecture and an Inversion of Control container:

```typescript
// Access internal services via the container
const db = app.container.resolve('DatabaseService');
const config = app.container.resolve('ConfigService');
const realtime = app.container.resolve('RealtimeService');

// Execute raw SQL if needed
const result = db.prepare('SELECT COUNT(*) as count FROM users').get();
console.log('Total registered users:', result.count);
```

---

## Graceful Shutdown

NodeStack handles termination signals (`SIGINT`, `SIGTERM`) automatically, flushing SQLite WAL logs and closing open SSE connections cleanly:

```typescript
// Manual shutdown if needed
await app.stop();
```
