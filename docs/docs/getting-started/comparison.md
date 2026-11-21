---
sidebar_position: 2
id: comparison
title: NodeStack vs. PocketBase
description: Comprehensive architectural comparison of NodeStack and PocketBase (the TypeScript alternative).
---

# NodeStack vs. PocketBase

Choosing the right backend architecture is a critical engineering decision. While **PocketBase** has popularized single-binary embedded SQLite simplicity for Go developers, **NodeStack** bridges the gap specifically for modern **TypeScript and Node.js** teams.

This guide provides an objective architectural comparison to help you evaluate when NodeStack is the best fit for your application, and how it compares to PocketBase (and where enterprise suites like Supabase fit).

---

## Architectural Philosophy

* **NodeStack:** A self-hosted, single-process Backend-as-a-Service (BaaS) built natively for **Node.js (>=24)** and **TypeScript**. It combines embedded SQLite (`node:sqlite`), multi-database flexibility (PostgreSQL, MSSQL), instant REST/SSE endpoints, isolated multi-app tenancy in one process, sandboxed QuickJS-Wasm serverless functions, durable SQLite background queues, visual workflow state machines, and deep npm ecosystem integration.
* **PocketBase:** A self-hosted, single-process BaaS written in **Go**. It delivers an ultra-compact binary with minimal memory footprint and embedded SQLite. Programmatic extensibility requires compiling custom Go binaries or using a constrained JavaScript interpreter (Goja).
* **Where does Supabase fit?** Supabase is an enterprise distributed platform composed of **10+ microservice containers** (PostgreSQL, Kong, GoTrue, Realtime, Studio). It is optimized for multi-terabyte relational datasets, pgvector, and managed cloud hosting—making it an excellent choice for large distributed teams, but heavy overkill for developers seeking a lightweight, single-process embedded backend.

---

## The Master Comparison Matrix

<p align="center">
  <img width="850" alt="NodeStack vs. PocketBase Architectural Comparison" src="/img/comparison-matrix.png" />
</p>


> **Legend**: Exactly **one bold cell per row** indicates the standout category leader for that specific dimension.

| Feature / Dimension | 🚀 **NodeStack** | 📦 **PocketBase** |
| :--- | :--- | :--- |
| **1. RUNTIME & DEPLOYMENT ARCHITECTURE** | | |
| **Primary Ecosystem** | **TypeScript & Node.js (npm native)** | Go ecosystem |
| **Deployment Simplicity** | **Single binary or `npx` ($5 VPS)** | Single binary on a $5 VPS |
| **Zero-Install CLI Velocity** | **Instant via `npx` (Zero downloads needed)** | Manual binary download & extract |
| **Binary Self-Containment** | Standalone Binary (Win, macOS, Linux) | **Ultra-Compact Binary (< 20MB Go)** |
| **Lowest Resource Footprint** | Low (~40–80 MB RAM) | **Ultra-Low (~20–40 MB RAM)** |
| **2. DATABASE & MULTI-TENANCY** | | |
| **Process Multi-Tenancy** | **Native Multi-App in 1 Process (Isolated DBs)** | Single tenant per process (Separate ports) |
| **Multi-Database Support** | **SQLite + PostgreSQL + MSSQL** | SQLite only (No external engines) |
| **Embedded Full-Text Search** | **Native SQLite FTS5 (BM25 + Snippets)** | Basic SQL `LIKE '%query%'` scans |
| **Application Snapshots & Rollback** | **Atomic checkpoints, drift detection & 1-click restore** | Manual ZIP archive file backups |
| **3. SECURITY, GOVERNANCE & AUDITING** | | |
| **Unified RBAC & Key Security** | **Cross-System RBAC + Key Simulator** | Basic collection rules only |
| **Database-Level Rules & RLS** | **Visual Rules + Custom SQL Expressions** | Filter expressions (Constrained) |
| **Immutable Audit Trail** | **Field-level `{ old, new }` diffs & actor attribution** | HTTP access request logs only |
| **4. BACKEND COMPUTE & WORKFLOWS** | | |
| **Embedded Serverless IDE** | **QuickJS-Wasm (Sub-ms cold starts & Web IDE)** | Legacy ES5 interpreter (Goja VM) |
| **Workflow Orchestration** | **Embedded Visual State Machines (Flows & DSL)** | None (Manual Go code) |
| **Background Job Queues** | **Embedded SQLite (FIFO, DLQ, Functions)** | None (Manual in-memory goroutines) |
| **Realtime Event Streams** | **Lightweight SSE Streams + Multi-Tenant** | Lightweight SSE Streams |
| **5. DEVELOPER EXPERIENCE & TOOLING** | | |
| **Dual-Mode Usage** | **Standalone CLI + Importable npm Library** | Standalone Binary (Go-only library) |
| **Live HTTP Type Safety** | **Live dynamic `GET /_/types.d.ts` endpoint** | Requires external CLI tool (`pocketbase-typegen`) |
| **Interactive API Documentation** | **Built-in Scalar & Swagger UI (`/_/docs`)** | Static external documentation |
| **Starter Templates & Mock Data** | **1-Click templates (E-comm, CRM) + Faker engine** | Empty database on initialization |

---

## Detailed Dimension Analysis

### 1. Developer Ecosystem & Language Alignment

* **NodeStack** is written 100% in TypeScript on top of modern Node.js (`node:sqlite`). Frontend developers and Node engineers do not need to learn Go or compile custom binaries. You have unrestricted access to millions of npm packages directly in hooks, plugins, and custom routes.
* **PocketBase** requires Go if you want to write server hooks, add custom routes, or compile custom binaries. Its embedded JS engine (Goja) is a legacy ES5/ES6 interpreter with no direct access to npm packages.

### 2. Multi-Tenancy Architecture

* **NodeStack** introduces native **Multi-Application Tenancy** within a single process. You can host completely isolated client apps (each with its own SQLite database, auth users, uploaded assets, and realtime SSE buses) without needing separate server instances or ports.
* **PocketBase** is strictly single-tenant per process. Running multiple apps requires managing separate processes, ports, and directories.

### 3. State Checkpoints & Point-in-Time Snapshots

* **NodeStack** features an integrated `SnapshotService` that captures atomic transactional checkpoints of the database, uploaded assets, and schema definitions. It detects live schema drift and enables 1-click non-destructive rollbacks directly from the Admin UI or CLI.
* **PocketBase** supports database file backups as zip archives, but lacks schema drift analysis, granular rollbacks, or non-destructive state branching.

### 4. Search & Content Discovery

* **NodeStack** embeds SQLite FTS5 natively. Every text field can be indexed for high-performance BM25 relevance ranking, contextual snippet extraction (`<mark>`), and token prefix matching out-of-the-box.
* **PocketBase** relies on standard SQL `LIKE '%query%'` scans, which do not scale well for large text collections and lack relevance ranking.

### 5. Workflow Orchestration & Business Logic

* **NodeStack** includes an embedded state machine engine (**Function Flows**). You can visually build or define JSON state machines with 9 state types (`Task`, `Choice`, `Map`, `Parallel`, `Loop`, `Pass`, `Wait`, `Succeed`, `Fail`), trigger them synchronously via HTTP or asynchronously on database lifecycle events (`<collection>:afterCreate`), and leverage automated retries and function-flow referential integrity protection.
* **PocketBase** has no workflow orchestration subsystem; multi-step business logic requires writing custom Go code or procedural JavaScript hooks with manual error recovery.

### 6. Background Job Queuing & Asynchronous Workers

* **NodeStack** includes an embedded transactional message queue engine (**NodeStack Queues**). It provides atomic claiming, worker leases, heartbeats (`touch`), retries with exponential backoff, dead-letter queues (DLQ), and strict partition FIFO ordering without Redis or external queue daemons. Dual sync and async queue engines seamlessly support SQLite, PostgreSQL, and MSSQL. You can bind queues directly to QuickJS serverless functions or consume them externally with `nodestack-client`.
* **PocketBase** has no persistent queue subsystem; asynchronous processing requires in-memory goroutines or external message brokers.

### 7. Multi-Database Architecture & Live Migration

* **NodeStack** natively supports **SQLite**, **PostgreSQL**, and **Microsoft SQL Server**. Switch engines per tenant with one click in the Admin UI or via `nodestack db switch`, execute live schema and data migrations with atomic transactions, run multi-engine FTS search, and inspect per-schema storage metrics.
* **PocketBase** is tied strictly to SQLite.

### 8. Unified RBAC Authorization & Hardened Plugin Sandboxing (v2.6.0)

* **NodeStack** provides a unified RBAC engine spanning collections, records, flows, serverless functions, and queues. Features include automatic wildcard removal on role downgrade, service boundary flow authorization, atomic key quota enforcement, an interactive API key permissions tester across Admin UI, CLI, and client SDK, and strict Principle of Least Privilege (PoLP) plugin container isolation.
* **PocketBase** relies on basic API rules and has no unified cross-subsystem RBAC or plugin DI containment.

### 9. Built-in Job Scheduler & Cron Engine (v2.7.0)

* **NodeStack** includes an embedded recurring task scheduler with standard 5-field cron parsing, macros, priority wake-up wheel, missed-run catchup policies, execution history logging, and direct execution of serverless Functions, visual Flows, and Snapshots—with zero external daemons or worker services.
* **PocketBase** has no built-in cron scheduling or visual workflow automation.

---

## Decision Framework: When to Choose What

### Choose NodeStack if:
1. **Your team lives in TypeScript/Node.js:** You want to write backend hooks, validation rules, and custom endpoints in TypeScript with full access to npm.
2. **You want single-process multi-tenancy:** You need to host multiple isolated client databases (e.g. for SaaS tenants, clients, or staging environments) inside a single lightweight process.
3. **You want zero-install developer velocity:** Running `npx @nodestackapp/server start` gives you an instant backend, admin dashboard, and REST API in seconds without downloading binaries or configuring Docker.
4. **You need built-in state snapshots & audit trails:** You want atomic checkpoints with drift detection and field-level diff auditing without installing external tools.
5. **You need built-in workflow orchestration:** You want to coordinate multi-step transactional logic, conditional branching, and background tasks visually without external services or third-party queue infrastructure.
6. **You need embedded background queues:** You want durable background job processing, strict partition FIFO ordering, and dead-letter queues directly in your database without running Redis or RabbitMQ.
7. **You want database engine flexibility:** You want to develop rapidly with zero-config embedded SQLite and scale into production PostgreSQL or Microsoft SQL Server with live one-click migrations.
8. **You require unified RBAC & secure plugins:** You want cross-subsystem authorization (collections, flows, functions, queues), live API key simulation, and isolated plugin containers with zero external IAM services.
9. **You need automated cron scheduling:** You want reliable recurring job execution, missed-run catchup policies, and scheduled workflows directly in your backend without external cron jobs or BullMQ daemons.

### Choose PocketBase if:
1. **Minimal binary footprint is paramount:** You need a single < 20MB standalone Go binary with ~20MB of idle RAM.
2. **You prefer Go for backend extensions:** You enjoy compiling Go code and writing Go server hooks.
3. **You are building a single-app appliance:** You only need one application database per running process.

### Choose Supabase if:
1. **You need enterprise PostgreSQL scale:** Your app requires complex relational joins, PostGIS spatial queries, or multi-terabyte datasets.
2. **You rely on pgvector for AI workflows:** You want to store high-dimensional embeddings directly in PostgreSQL.
3. **You prefer a fully managed cloud platform:** You want auto-scaling database infrastructure managed for you by Supabase Cloud.