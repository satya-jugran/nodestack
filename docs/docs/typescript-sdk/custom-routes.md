---
sidebar_position: 3
id: custom-routes
title: Custom Routes & Fastify Extensions
description: Adding custom HTTP routes, handlers, and Fastify plugins
---

️ Custom Routes & Fastify Extensions

NodeStack's underlying HTTP layer is powered by **Fastify**, the fastest web framework in the Node.js ecosystem. You have direct access to register custom routes and plugins.

---

## Registering Custom Endpoints

Use the `router` property on your `NodeStack` instance:

```typescript
import { NodeStack } from 'nodestack';

const app = new NodeStack();

// Standard GET endpoint
app.router.get('/api/health', async (request, reply) => {
  return {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
});

// Authenticated POST endpoint with JSON body
app.router.post('/api/checkout', async (request, reply) => {
  const body = request.body as { cartId: string };
  
  // Custom business logic
  return {
    success: true,
    orderId: 'ord_987654',
  };
});

await app.start();
```

---

## Accessing Fastify Directly

You can also register official Fastify plugins (e.g. rate limiting, compression):

```typescript
import fastifyRateLimit from '@fastify/rate-limit';

const server = app.server; // Direct FastifyInstance

await server.register(fastifyRateLimit, {
  max: 100,
  timeWindow: '1 minute',
});
```
