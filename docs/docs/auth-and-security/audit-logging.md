---
sidebar_position: 3
id: audit-logging
title: Immutable Audit Logs (v1.3)
description: Field-level change diffs, actor attribution, and record history timeline
---

Immutable Audit Logs (v1.3)

NodeStack v1.3 introduces an automated, tamper-evident audit logging subsystem. Every data mutation (`create`, `update`, `delete`) can be audited with field-level diffs and actor attribution.

---

## What Is Recorded?

For each mutation event, NodeStack records:
* **`id`**: Unique audit entry ID (`aud_...`).
* **`collection`**: Name of the affected collection.
* **`recordId`**: Target record identifier.
* **`action`**: Operation type (`create`, `update`, `delete`).
* **`actorId`**: ID of the authenticated user or superuser who initiated the request.
* **`ip`**: Client IP address.
* **`timestamp`**: UTC timestamp of execution.
* **`diff`**: JSON structure containing field changes with previous (`old`) and new (`new`) values:
  ```json
  {
    "status": { "old": "draft", "new": "published" },
    "views": { "old": 15, "new": 16 }
  }
  ```

---

## Sensitive Field Masking

NodeStack automatically strips or hashes sensitive fields before persisting to audit tables:
* Passwords and password salts.
* Payment tokens or private API keys.
* Fields configured with `auditMask: true` in your schema.

---

## Record History Timeline Drawer

In the Web Admin UI:
1. Open the **Records** data grid for any collection.
2. Click on a record row to open details.
3. Click the **Audit History** button to reveal the chronological timeline drawer.
4. Inspect old vs new values formatted with visual diff highlights.
