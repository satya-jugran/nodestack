---
sidebar_position: 2
id: session-revocation
title: Superusers & Session Revocation
description: Master administration and immediate token invalidation
---

️ Superusers & Session Revocation

NodeStack distinguishes between standard application users and administrative Superusers.

---

## Superusers

Superusers have administrative control over the backend:
* Full access to the Web Admin UI (`/_/`).
* Schema design, collection deletion, and index management.
* Raw SQL query runner in the console.
* Bypasses all collection access rules.

### CLI Management

Create a superuser from your terminal:

```bash
npx @nodestackapp/server superuser create admin@example.com MySecretPassword123!
```

---

## Instant Session Revocation

Unlike naive JWT architectures where tokens remain valid until their expiration timestamp, NodeStack maintains an embedded token revocation table:

* **Password Change**: Changing an account password immediately revokes all existing active tokens for that user.
* **Administrative Kill Switch**: A superuser can invalidate all active sessions for a compromised account with a single click in the Admin UI.
* **High Performance**: Revocation checks are performed against an in-memory Bloom filter and cached SQLite token index with sub-millisecond overhead.
