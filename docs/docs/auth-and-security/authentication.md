---
sidebar_position: 1
id: authentication
title: Authentication & JWT
description: User authentication, password hashing, and token issuance
---

Authentication & JWT

NodeStack provides native authentication with zero external dependencies.

---

## Auth Collections (`users`)

The `users` collection is a specialized auth collection with built-in:
* Email address validation and uniqueness enforcement.
* Password hashing with `bcryptjs` (salt rounds: 12).
* Session token issuance with signed JSON Web Tokens (JWT).
* Password reset and email change flows.

---

## Authenticating with Password

### Via REST API

Send a `POST` request to `/api/collections/users/auth-with-password`:

```bash
curl -X POST http://localhost:8090/api/collections/users/auth-with-password \
  -H "Content-Type: application/json" \
  -d '{
    "identity": "user@example.com",
    "password": "UserSecretPassword123!"
  }'
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "record": {
    "id": "usr_9x8172ab",
    "email": "user@example.com",
    "created": "2026-10-15T08:00:00.000Z",
    "updated": "2026-10-15T08:00:00.000Z"
  }
}
```

### Passing the Token in Subsequent Requests

Add the `Authorization` header to protected requests:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Using `nodestack-client`

The TypeScript client handles token storage and auto-header injection automatically:

```typescript
import NodeStackClient from 'nodestack-client';

const client = new NodeStackClient('http://localhost:8090');

// Login
const authData = await client.collection('users').authWithPassword(
  'user@example.com',
  'UserSecretPassword123!'
);

console.log('Logged in user ID:', client.authStore.record.id);
console.log('Valid token:', client.authStore.isValid);

// Logout
client.authStore.clear();
```

---

## Registration & Email Verification Security (v2.6.0)

NodeStack v2.6.0 includes comprehensive hardening for user registration and email verification workflows:

* **Cryptographic Token Binding**: Verification tokens are bound directly to the recipient's email address and tenant scope, preventing cross-tenant token replay attacks.
* **Token Redaction in API Responses**: Verification and reset tokens are strictly redacted from HTTP response payloads to prevent leakage across client logs and proxies.
* **Self-Verification Exploit Prevention**: User record update payloads (`PATCH /api/collections/users/records/:id`) cannot mutate `verified` status directly; verification state transitions require authenticated verification tokens or superuser authorization.
* **Enforced Verification Persistence**: Verification states are written synchronously to the database and persisted in the registry with connection leak prevention.
