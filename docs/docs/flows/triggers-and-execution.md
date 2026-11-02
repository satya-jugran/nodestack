---
sidebar_position: 3
id: triggers-and-execution
title: Triggers, Execution & Observability
description: Triggering flows via HTTP and Database Lifecycle Events, execution options, and step-level audit observability
---

# Triggers, Execution & Observability

NodeStack Function Flows can be invoked automatically in response to database mutations or on-demand via direct HTTP endpoints. Every execution is tracked with granular step logs.

---

## Trigger Types

When creating or updating a flow, configure its `triggerType`:

```json
{
  "name": "process-new-order",
  "triggerType": "event",
  "eventTrigger": "orders:afterCreate",
  "definition": { ... }
}
```

### 1. `event` (Database Lifecycle Trigger)
Executes automatically when records are created, updated, or deleted in any collection.

* **Format**: `<collection>:<event>`
* **Supported Events**:
  * `afterCreate`: Fires immediately after a new record is saved (e.g. `orders:afterCreate`).
  * `afterUpdate`: Fires immediately after an existing record is modified (e.g. `users:afterUpdate`).
  * `afterDelete`: Fires immediately after a record is deleted (e.g. `products:afterDelete`).

#### Event Input Payload
When triggered by a database event, NodeStack populates the flow's initial context `input` with:

```json
{
  "action": "create",
  "collection": "orders",
  "record": {
    "id": "ord_102",
    "total": 129.99,
    "status": "pending",
    "customer": "usr_55"
  },
  "originalRecord": null,
  "auth": {
    "id": "usr_55",
    "role": "user"
  }
}
```

For `update` actions, `originalRecord` contains the pre-mutation state of the record for difference evaluation.

---

### 2. `http` (REST API Trigger)
Enables external services or client applications to trigger the flow by calling its execution endpoint.

#### Default Tenant
```http
POST /api/flows/:idOrName/execute
Content-Type: application/json

{
  "cartId": "cart_998",
  "coupon": "SUMMER10"
}
```

#### Multi-Tenant Application
```http
POST /api/apps/:slug/flows/:idOrName/execute
Content-Type: application/json

{ ... }
```

Alternatively, pass the header `x-nodestack-app: <slug>` to route the request to a specific application tenant.

---

### 3. `manual` (Admin Portal Trigger)
Designed for administrative workflows, data backfills, and testing. It can only be triggered explicitly by an administrator through the Admin UI or via the REST API with superuser credentials.

---

## Execution Options

When executing a flow via the REST API, you can customize runtime parameters:

```http
POST /api/flows/order-pipeline/execute
Content-Type: application/json

{
  "orderId": "ord_8841"
}
```

### Execution Response Format
By default, the endpoint executes synchronously and returns the complete `FlowExecution` summary:

```json
{
  "id": "exec_1730531200_abc123",
  "flowId": "flow_881",
  "flowName": "order-pipeline",
  "status": "succeeded",
  "durationMs": 42,
  "input": {
    "orderId": "ord_8841"
  },
  "output": {
    "orderId": "ord_8841",
    "fulfillment": { "tracking": "TRK_99182" }
  },
  "stepLogs": [
    {
      "step": "ValidateOrder",
      "type": "Task",
      "input": { "orderId": "ord_8841" },
      "output": { "valid": true },
      "status": "succeeded",
      "durationMs": 14,
      "timestamp": "2026-11-02T10:00:01.120Z"
    },
    {
      "step": "ChargeCard",
      "type": "Task",
      "input": { "valid": true },
      "output": { "status": "approved" },
      "status": "succeeded",
      "durationMs": 28,
      "timestamp": "2026-11-02T10:00:01.134Z"
    }
  ],
  "actorId": "usr_admin",
  "startedAt": "2026-11-02T10:00:01.120Z",
  "finishedAt": "2026-11-02T10:00:01.162Z"
}
```

---

## Execution History & Observability

NodeStack persists detailed execution metadata in the `_flow_executions` table.

### Querying Executions via REST API

#### 1. List Recent Executions across All Flows
```http
GET /api/flows/executions?limit=20&status=failed
```

#### 2. List Executions for a Specific Flow
```http
GET /api/flows/:id/executions?limit=50
```

#### 3. Inspect a Single Execution Detail
```http
GET /api/flows/executions/:executionId
```

#### 4. Clear Execution History (Superuser)
```http
DELETE /api/flows/:id/executions
```

### Admin UI Execution Inspector

The Admin UI under **Flows &rarr; Executions** provides interactive visual debugging:
* **Timeline Waterfall**: Visual representation of step latency and execution sequence.
* **Step Diffs**: Click any step card to inspect exact JSON input, JSON output, captured error traces, and retry attempts.
* **Status Filtering**: Filter past runs by `succeeded`, `failed`, `timeout`, or `running`.
* **Re-run Execution**: Re-trigger any past execution with the identical input payload for reproducible debugging.
