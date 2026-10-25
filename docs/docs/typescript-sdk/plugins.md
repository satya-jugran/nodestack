---
sidebar_position: 4
id: plugins
title: Plugin System
description: Extending NodeStack with modular plugins
---

Plugin System

NodeStack includes a modular plugin architecture that allows packaging collections, hooks, custom routes, and admin UI widgets into reusable packages.

---

## Official Plugins

* **`@nodestack/plugin-stripe`**: Webhook listeners, customer sync, and checkout session helpers.
* **`@nodestack/plugin-s3`**: Offloads uploaded files from local disk to AWS S3, Cloudflare R2, or MinIO.
* **`@nodestack/plugin-email`**: SMTP and SendGrid transactional email service.
* **`@nodestack/plugin-algolia`**: Background synchronization to Algolia search indexes.

---

## Using a Plugin

```typescript
import { NodeStack } from '@nodestackapp/server';
import { s3StoragePlugin } from '@nodestack/plugin-s3';

const app = new NodeStack();

app.use(s3StoragePlugin({
  bucket: 'my-media-bucket',
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
}));

await app.start();
```

---

## Authoring a Custom Plugin

A plugin is simply a function that receives the `NodeStack` instance:

```typescript
import { NodeStackPlugin } from '@nodestackapp/server';

export const analyticsPlugin: NodeStackPlugin = (app, options) => {
  // 1. Hook into record creation
  app.onRecordAfterCreate('*', async (event) => {
    console.log(`[Analytics] Record created in ${event.collection}:`, event.record.id);
  });

  // 2. Add custom routes
  app.router.get('/api/analytics/summary', async () => {
    return { status: 'healthy', trackedEvents: 1024 };
  });
};
```
