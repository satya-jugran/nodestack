---
sidebar_position: 2
id: scheduled-jobs
title: Managing Scheduled Jobs
description: Programmatic management with TypeScript Client SDK, REST API endpoints, and Admin UI workflows
---

# Managing Scheduled Jobs

NodeStack provides multiple ways to create, monitor, and manage recurring cron schedules: via the **Admin UI Dashboard**, the **TypeScript Client SDK (`nodestack-client`)**, or the **REST API**.

---

## 1. Using the Client SDK (`nodestack-client`)

The `@nodestack/client` SDK exports the full-featured `client.cron` service.

### Initializing and Previewing Schedules

You can preview the next run dates and validate an expression before persisting:

```typescript
import NodeStackClient from 'nodestack-client';

const client = new NodeStackClient('http://localhost:8090');
await client.admins.authWithPassword('admin@nodestack.dev', 'password123');

// Preview next 5 run dates in specific timezone
const preview = await client.cron.preview('0 9 * * 1-5', 'America/New_York', 5);
console.log('Valid:', preview.valid);
console.log('Next runs:', preview.nextRuns);
```

### Creating a Scheduled Function

```typescript
const schedule = await client.cron.createSchedule({
  name: 'Nightly Ingestion Sync',
  targetType: 'function',
  targetId: 'sync-inbound-leads',
  cronExpression: '0 2 * * *', // Daily at 2:00 AM
  timezone: 'UTC',
  missedRunPolicy: 'catch_up_once',
  payload: { batchSize: 500 },
  maxRetries: 3,
  autoPauseAfterFailures: 5,
});

console.log('Schedule created with ID:', schedule.id);
```

### Scheduling a Visual Workflow Flow

```typescript
const flowSchedule = await client.cron.createSchedule({
  name: 'Weekly User Re-engagement',
  targetType: 'flow',
  targetId: 'user-onboarding-flow',
  cronExpression: '0 8 * * 1', // Mondays at 8:00 AM
  timezone: 'Europe/London',
  missedRunPolicy: 'skip',
});
```

### Triggering Manual Runs & Inspecting Logs

```typescript
// Trigger an immediate execution
const run = await client.cron.triggerSchedule(schedule.id);
console.log('Execution Status:', run.status);

// Query execution run history
const runs = await client.cron.getRuns({
  scheduleId: schedule.id,
  page: 1,
  perPage: 20,
});

runs.items.forEach((log) => {
  console.log(`[${log.startedAt}] Status: ${log.status} (Duration: ${log.durationMs}ms)`);
});
```

---

## 2. REST API Reference

All schedule endpoints require admin authorization (`Authorization: Bearer <token>`) or a scoped API Key (`x-api-key: <key>`).

### Endpoint Summary

| Method | Endpoint | Description | Scope Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/cron/preview` | Validate a cron expression and preview upcoming execution slots. | `cron:read` |
| `GET` | `/api/cron/stats` | Retrieve aggregate metrics (active schedules, success/failure counts). | `cron:read` |
| `GET` | `/api/cron/schedules` | List configured schedules with optional filtering (`targetType`, `enabled`). | `cron:read` |
| `POST` | `/api/cron/schedules` | Create a new recurring schedule. | `cron:write` |
| `GET` | `/api/cron/schedules/:id` | Retrieve schedule details by ID. | `cron:read` |
| `PATCH` | `/api/cron/schedules/:id` | Update schedule properties, timing, or toggle `enabled` state. | `cron:write` |
| `DELETE` | `/api/cron/schedules/:id` | Delete a schedule and optionally purge associated run logs. | `cron:write` |
| `POST` | `/api/cron/schedules/:id/trigger` | Trigger an immediate manual execution of the schedule. | `cron:run` |
| `GET` | `/api/cron/runs` | Retrieve paginated execution logs with filters (`status`, `scheduleId`). | `cron:read` |
| `DELETE` | `/api/cron/runs` | Clear historical execution logs. | `cron:write` |

:::tip Multi-Tenant Routing
For multi-tenant environments, prefix endpoints with `/api/apps/:appId/cron/*` to manage schedules within a specific application tenant.
:::

---

## 3. Admin UI Dashboard

NodeStack includes a dedicated visual manager accessible via the **Schedules** navigation item in the Admin Dashboard (`http://localhost:8090/_/`):

1. **Visual Schedule Designer**: Build cron expressions visually or type standard 5-field strings with real-time human-readable translations and upcoming execution forecasts.
2. **Interactive Payloads**: Attach structured JSON arguments directly to serverless function and flow triggers.
3. **Execution Timeline & Logs**: Inspect real-time execution duration, outputs, error stacks, and retry counts.
4. **Instant Action Triggers**: Run jobs on-demand with one click to test logic before scheduled execution.
5. **Flows & Functions Integration**: Quickly bind schedules directly from the Functions Workbench or Flows Visual Designer.
