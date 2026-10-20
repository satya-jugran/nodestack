---
sidebar_position: 1
id: realtime-sse
title: Realtime Server-Sent Events (SSE)
description: High-performance real-time change stream using standard HTTP SSE
---

Realtime Server-Sent Events (SSE)

NodeStack provides real-time event distribution via standard HTTP Server-Sent Events (SSE).

---

## Why SSE Instead of WebSockets?

* **Standard HTTP/2 & HTTP/1.1**: Operates over standard HTTP without protocol upgrade issues across proxies, corporate firewalls, and CDNs.
* **Built-in Browser Reconnection**: Browsers automatically attempt reconnection if a connection drops.
* **Lightweight**: Minimal memory footprint per open connection.

---

## The Handshake Protocol (`NS_CONNECT`)

1. The client opens an `EventSource` connection to:
   ```
   GET /api/realtime
   ```
2. The server acknowledges the connection by sending an initial handshake event containing a unique client ID:
   ```
   event: NS_CONNECT
   data: {"clientId": "cl_8f910a2b"}
   ```
3. The client submits subscription requests by `POST`ing topics (collections or specific record IDs) to `/api/realtime`:
   ```bash
   POST /api/realtime
   Content-Type: application/json

   {
     "clientId": "cl_8f910a2b",
     "subscriptions": ["posts", "orders/rec_12345"]
   }
   ```

---

## Using via `nodestack-client`

The TypeScript client SDK handles connection multiplexing, handshakes, authorization, and reconnection automatically:

```typescript
import NodeStackClient from 'nodestack-client';

const client = new NodeStackClient('http://localhost:8090');

// Subscribe to all changes in the 'posts' collection
const unsubscribe = await client.collection('posts').subscribe('*', (event) => {
  console.log('Action:', event.action); // 'create' | 'update' | 'delete'
  console.log('Record:', event.record);
});

// Subscribe to a specific single record
await client.collection('posts').subscribe('rec_12345', (event) => {
  console.log('Post 12345 updated:', event.record);
});

// Clean up subscription when no longer needed
unsubscribe();
```

---

## Access Rule Enforcement

Real-time subscriptions strictly respect collection **Access Rules**:
* When a record is mutated, NodeStack re-evaluates the collection's **View Rule** against each connected client's auth context.
* If a client does not have permission to view the updated record, the event is silently suppressed for that connection.
