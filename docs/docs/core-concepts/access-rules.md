---
sidebar_position: 5
id: access-rules
title: Visual Access Rules & Security
description: Row-level security rules and the visual clause builder
---

️ Access Rules & Security

NodeStack enforces granular Row-Level Security (RLS) on every collection action.

---

## The 5 Collection Actions

Each collection defines independent access rules for:
1. **List / Search**: Can the client query or search records?
2. **View**: Can the client fetch a single record by ID?
3. **Create**: Can the client insert a new record?
4. **Update**: Can the client modify an existing record?
5. **Delete**: Can the client remove a record?

---

## Rule States

Each action can have one of three rule states:

* **Locked (`null`)**: Only superusers and internal server-side code can execute this action. Blocked for regular users and public requests.
* **Public (`""` empty string)**: Anyone can execute this action, even without an authentication token.
* **Conditional Expression**: The action is only permitted if the rule expression evaluates to `true`.

---

## Rule Expression Syntax

Access rules can reference both the authenticated user (`@request.auth.*`) and the record data (`@request.data.*` or record fields):

| Preset / Rule | Description |
| :--- | :--- |
| `@request.auth.id != ""` | Must be logged in as any authenticated user. |
| `@request.auth.id = author` | Only the user who created the record can view/edit it. |
| `@request.auth.role = 'admin'` | Only users with `role == 'admin'` in their token. |
| `status = 'published'` | Only records where `status` is 'published' can be read. |
| `@request.auth.id = id` | Users can only modify their own user profile in `users`. |

---

## Visual Access Rule Builder

The Web Admin UI includes an interactive Visual Rule Builder:
* **Prebuilt Security Presets**: One-click configuration for "Public Read", "Authenticated Users Only", "Owner Only", or "Locked".
* **Live Syntax Validation**: Automatically checks your expression for syntax errors before saving.
* **Field Autocompletion**: Suggests collection fields and auth context variables.
