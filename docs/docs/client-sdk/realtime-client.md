---
sidebar_position: 3
id: realtime-client
title: Realtime Client Subscriptions
description: Listening to live database mutations in web and mobile apps
---

Realtime Client Subscriptions

`nodestack-client` establishes a single persistent SSE connection to the server and multiplexes subscriptions over it.

---

## Subscribing to an Entire Collection

Listen for all mutations (`create`, `update`, `delete`) in a collection:

```typescript
const unsubscribe = await client.collection('messages').subscribe('*', (e) => {
  if (e.action === 'create') {
    console.log('New message received:', e.record);
  } else if (e.action === 'update') {
    console.log('Message edited:', e.record);
  } else if (e.action === 'delete') {
    console.log('Message removed:', e.record.id);
  }
});

// To stop listening later:
unsubscribe();
```

---

## Subscribing to a Single Record

Listen for changes to a specific record ID:

```typescript
const unsubscribe = await client.collection('orders').subscribe('rec_987654', (e) => {
  console.log('Order status changed:', e.record.status);
});
```

---

## React Hook Pattern

Using real-time subscriptions inside a React component:

```tsx
import { useEffect, useState } from 'react';
import client from './nodestack';

export function ChatRoom() {
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    // 1. Initial fetch
    client.collection('messages').getList(1, 50, { sort: 'created' }).then(res => {
      setMessages(res.items);
    });

    // 2. Realtime listener
    let unsubscribe: () => void;
    client.collection('messages').subscribe('*', (e) => {
      if (e.action === 'create') {
        setMessages(prev => [...prev, e.record]);
      }
    }).then(unsub => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>{m.text}</div>
      ))}
    </div>
  );
}
```
