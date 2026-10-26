---
sidebar_position: 3
id: api-keys
title: API Keys & M2M Tokens
description: Scoped machine-to-machine service account tokens for microservices, background workers, and CI/CD
---

# API Keys & Machine-to-Machine (M2M) Tokens

NodeStack provides high-entropy API Keys for headless services, automated workers, serverless functions, and CI/CD pipelines.

---

## Key Format & Security Architecture

API keys follow a structured, cryptographically secure format:

```
Format:  nsk_<env>_<keyId>_<secretEntropy>
Example: nsk_live_k8f9a2_9e3d81b2c45f7801a34b82c1e7d904ab92d4ef0a8c12...
         └──┬──┘ └──┬──┘  └──┬───┘  └──────────────────┬─────────────────┘
          Prefix   Env     Key ID               Secret Entropy (48 hex)
```

* **Zero Plaintext Storage**: The full key is displayed **only once** upon generation. The database stores only an indexed lookup prefix (`nsk_live_k8f9a2`), a redacted hint, and a SHA-256 hash.
* **Side-Channel Protection**: Hashes are verified using constant-time `crypto.timingSafeEqual`.
* **In-Memory Cache**: Active keys are cached in memory with a short TTL for sub-millisecond request verification.

---

## Creating & Managing API Keys

### Via REST API (Superuser)

#### Create an API Key
```bash
curl -X POST http://localhost:8090/api/api-keys \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Inventory Worker",
    "description": "Background sync daemon",
    "role": "service",
    "scopes": ["orders:read", "products:*"],
    "allowedIps": ["10.0.0.0/24", "127.0.0.1"],
    "expiresInDays": 90
  }'
```

Response:
```json
{
  "apiKey": {
    "id": "key_k8f9a2_31107e",
    "name": "Inventory Worker",
    "keyPrefix": "nsk_live_k8f9a2",
    "redactedKey": "nsk_live_k8f9a2...04ab",
    "role": "service",
    "scopes": ["orders:read", "products:*"],
    "status": "active",
    "expiresAt": "2027-01-23T12:00:00.000Z"
  },
  "secretKey": "nsk_live_k8f9a2_9e3d81b2c45f7801a34b82c1e7d904ab..."
}
```

#### Rotate an API Key
Atomically invalidates the old secret, generates new secret entropy, and returns the new key:
```bash
curl -X POST http://localhost:8090/api/api-keys/key_k8f9a2_31107e/rotate \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

#### Revoke / Delete an API Key
```bash
curl -X DELETE http://localhost:8090/api/api-keys/key_k8f9a2_31107e \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

---

## Granular Read/Write ACL & Scoping Syntax

Scopes use the format `<resource>:<action>`:

| Scope Pattern | Permissions Granted |
| :--- | :--- |
| `*` or `admin:*` | Full unrestricted superuser access (bypasses all collection rules). |
| `orders:*` | Full access (`list`, `view`, `create`, `update`, `delete`, `export`, `import`) on `orders`. |
| `orders:read` | Read-only access (`list`, `view`, `export`) on `orders`. |
| `orders:write` | Mutation access (`create`, `update`, `delete`, `import`) on `orders`. |
| `orders:create` | Only permitted to create new records in `orders`. |

If a key attempts an operation outside its assigned scopes, NodeStack returns `403 Forbidden` with a detailed error message:
```json
{
  "statusCode": 403,
  "message": "API Key missing required scope for 'orders:create'"
}
```

---

## Using API Keys in Client Applications

### With `nodestack-client`
Pass the `apiKey` directly when instantiating `NodeStackClient`:

```typescript
import { NodeStackClient } from 'nodestack-client';

const client = new NodeStackClient('https://api.yourdomain.com', {
  apiKey: process.env.NODESTACK_API_KEY, // 'nsk_live_...'
});

// Authorized operations
const order = await client.collection('orders').create({
  item: 'Server Blade',
  amount: 2500,
});

const products = await client.collection('products').getList(1, 10);
```

### With Raw HTTP Requests
Attach the key using either standard header:

**Option 1: Authorization Header**
```bash
curl https://api.yourdomain.com/api/collections/orders/records \
  -H "Authorization: Bearer nsk_live_k8f9a2_..."
```

**Option 2: X-API-Key Header**
```bash
curl https://api.yourdomain.com/api/collections/orders/records \
  -H "X-API-Key: nsk_live_k8f9a2_..."
```

---

## REST API Reference

All management endpoints require superuser (`admin`) authorization:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/api-keys` | List all API keys with redacted tokens, scopes, and usage stats. |
| `POST` | `/api/api-keys` | Generate a new API key. Full secret is returned only in this response. |
| `GET` | `/api/api-keys/:id` | Retrieve metadata for a single API key. |
| `PATCH` | `/api/api-keys/:id` | Update key name, scopes, IP allowlist, status, or expiration. |
| `DELETE` | `/api/api-keys/:id` | Revoke and delete an API key. |
| `POST` | `/api/api-keys/:id/rotate` | Atomically rotate the key secret. |
