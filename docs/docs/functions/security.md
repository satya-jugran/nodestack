---
sidebar_position: 4
id: security
title: Security & Guardrails
description: Anti-SSRF network firewall, authorization policies, sandboxing, and execution limits
---

# Security & Guardrails

NodeStack Functions are designed with a **defense-in-depth** security architecture. When running user-authored or dynamic code, NodeStack enforces strict network firewalls, runtime sandboxing, row-level database access rules, and resource limits.

---

## 1. Anti-SSRF Network Firewall (`SsrfGuard`)

Server-Side Request Forgery (SSRF) is a primary vulnerability when executing code that can make outbound HTTP requests. NodeStack functions run behind an integrated **Anti-SSRF Network Firewall** that inspects all URLs passed to `ctx.fetch()`.

### Blocked Target Destinations

Requests to the following destinations are automatically rejected with a security exception:

| Destination Type | Blocked Patterns | Security Rationale |
| :--- | :--- | :--- |
| **Loopback** | `localhost`, `127.0.0.1`, `::1`, `127.0.0.0/8` | Prevents attacking local services, redis, or the NodeStack server itself. |
| **Private LAN** | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7` | Prevents scanning or probing internal enterprise network infrastructure. |
| **Cloud Metadata** | `169.254.169.254`, `metadata.google.internal` | Prevents exfiltrating AWS IAM credentials, GCP service accounts, or Kubernetes pod tokens. |
| **Link-Local** | `169.254.0.0/16`, `fe80::/10` | Prevents accessing network device link configuration. |

### Egress Domain Allowlists (`allowedDomains`)

You can restrict a function's outbound network traffic to specific trusted hostnames or wildcard domains:

```javascript
// Configured allowedDomains:
["api.stripe.com", "*.resend.com", "api.github.com"]
```

* `https://api.stripe.com/v1/charges` → Allowed.
* `https://smtp.resend.com/emails` → Allowed (matches `*.resend.com`).
* `https://evil-server.com/exfiltrate` → **Blocked**: `Host 'evil-server.com' is not on the allowed outbound domain list.`

---

## 2. Authorization Policies (`authPolicy`)

Every function enforces an authentication gate before the code is executed:

| Policy | Required Credential | Use Case |
| :--- | :--- | :--- |
| **`public`** | None | Public webhooks, sign-up workflows, contact forms, open pricing APIs. |
| **`auth`** | User JWT (`Authorization: Bearer &lt;token&gt;`) | User-specific operations, profile calculations, cart checkout. |
| **`admin`** | Superuser Admin Token | Internal maintenance, system reports, sensitive admin utilities. |
| **`apiKey`** | Machine-to-Machine API Key (`x-api-key: nsk_live_...` or Bearer) | Automated cron jobs, microservice-to-microservice integrations. |

If a caller attempts to invoke a function without the necessary credentials, NodeStack returns `HTTP 401 Unauthorized` or `HTTP 403 Forbidden` before initializing the QuickJS sandbox.

---

## 3. Database Least Privilege & Elevated Service Role

By default, NodeStack functions run with **Least Privilege**:

### Standard Functions (Default)
When a function calls `ctx.records.get()`, `list()`, `create()`, `update()`, or `delete()`, the request passes through NodeStack's **RuleEngine**. The collection's row-level access rules (`listRule`, `viewRule`, etc.) are evaluated using the caller's identity (`ctx.request.auth`).
* Users can only see or modify records they are authorized to access.
* Unauthorized records are filtered out automatically.

### Elevated Service Role (`elevated: true`)
For administrative tasks, background sync jobs, or cross-tenant aggregations, enable **Elevated Service Role**:
* Bypasses collection access rules.
* Executes database operations with root superuser privileges.
* Visually marked with an **Elevated** security badge in the Admin Workbench.

---

## 4. Sandboxing & Hermetic Isolation

NodeStack functions execute inside WebAssembly virtual machines powered by QuickJS:

* **Zero Host Node.js Primitives**: The sandbox environment does **not** have access to `process`, `fs`, `child_process`, `os`, `net`, `http`, `cluster`, or Node's `require()`.
* **Zero Global Pollution**: Each function invocation runs in an isolated VM context. Global variables or modified prototypes cannot leak across requests.
* **Encrypted Secrets**: `ctx.env` injects only the secrets assigned to that specific function, encrypted at rest in SQLite.

---

## 5. Execution Limits (Timeout & Memory)

To protect the host process from denial-of-service, runaway recursions, and memory leaks:

* **Execution Timeout (`timeoutMs`)**: Configurable between 100ms and 15,000ms (default 1,000ms). If execution exceeds this threshold, the QuickJS interrupt handler immediately terminates the sandbox and returns `HTTP 504 Gateway Timeout`.
* **Memory Limit (`memoryLimitMb`)**: Configurable between 4MB and 128MB (default 32MB). Out-of-memory allocations are caught and isolated without affecting the host engine.
