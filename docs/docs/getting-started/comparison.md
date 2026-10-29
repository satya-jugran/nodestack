---
sidebar_position: 2
id: comparison
title: NodeStack vs. Alternatives
description: Comprehensive architectural comparison of NodeStack, PocketBase, and Supabase.
---

# NodeStack vs. Alternatives

Choosing the right backend architecture is a critical engineering decision. While **PocketBase** has popularized single-binary embedded SQLite simplicity and **Supabase** has become the benchmark for managed PostgreSQL suites, **NodeStack** bridges the gap specifically for modern **TypeScript and Node.js** teams.

This guide provides an objective architectural comparison to help you evaluate when NodeStack is the best fit for your application.

---

## Architectural Philosophy

* **NodeStack:** A self-hosted, single-process Backend-as-a-Service (BaaS) built natively for **Node.js (>=24)** and **TypeScript**. It combines embedded SQLite (`node:sqlite`), instant REST/SSE endpoints, isolated multi-app tenancy, sandboxed QuickJS-Wasm serverless functions, and deep npm integration.
* **PocketBase:** A self-hosted, single-process BaaS written in **Go**. It delivers an ultra-compact binary with minimal memory footprint and embedded SQLite. Programmatic extensibility requires writing Go or using a constrained JavaScript VM (Goja).
* **Supabase:** An enterprise-scale, distributed open-source Firebase alternative composed of **10+ microservice containers** (PostgreSQL, PostgREST, GoTrue, Realtime, Kong, Studio). It is optimized for heavy relational workflows, pgvector, and cloud hosting.

---

## The Master Comparison Matrix

<p align="center">
  <img width="850" alt="NodeStack vs. PocketBase vs. Supabase Architectural Comparison" src="/img/comparison-matrix.png" />
</p>


> **Legend**: Exactly **one bold cell per row** indicates the standout category leader for that specific dimension.

| Feature / Dimension | 🚀 **NodeStack** | 📦 **PocketBase** | ⚡ **Supabase** |
| :--- | :--- | :--- | :--- |
| **Primary Ecosystem** | **TypeScript & Node.js (npm native)** | Go | Polyglot (Elixir / Go / SQL) |
| **Relational Database Scale** | Embedded SQLite (WAL) | Embedded SQLite (WAL) | **PostgreSQL (ACID, pgvector, PostGIS)** |
| **Lowest Resource Footprint** | Low (~40–80 MB RAM) | **Ultra-Low (~20–40 MB RAM)** | Heavy (2–4 GB+ RAM) |
| **Zero-Install CLI Velocity** | **Instant via `npx` (Zero downloads needed)** | Manual binary download | Requires Docker or Cloud account |
| **Binary Self-Containment** | Standalone Binary (Win, macOS, Linux) | **Ultra-Compact Binary (< 20MB Go)** | Multi-container Docker suite |
| **Dual-Mode Usage** | **Standalone CLI + Importable npm Library** | Standalone Binary (Go-only library) | Standalone Service (Cannot embed) |
| **Single-Process Multi-Tenancy** | **Native Multi-App (Isolated DBs in 1 process)** | Single tenant per process | Cloud platform (or multi-cluster) |
| **Deployment Simplicity** | **Single binary or `npx` on a $5 VPS** | Single binary on a $5 VPS | Complex self-hosting (10+ Docker containers) |
| **Embedded Full-Text Search** | **Native SQLite FTS5 (BM25 + Snippets)** | Basic SQL `LIKE` queries | Postgres `tsvector` (Manual schema setup) |
| **Realtime Scale & Presence** | Lightweight SSE Streams | Lightweight SSE Streams | **WebSockets + Presence (Phoenix Engine)** |
| **Database-Level RLS Security** | Visual Rules + SQL expressions | Filter expressions | **PostgreSQL Native RLS (In-kernel)** |
| **Embedded Serverless IDE** | **QuickJS-Wasm (Sub-ms cold starts & Web IDE)** | Basic JS (via Goja VM) | External Deno Edge Functions |
| **Application Snapshots & Rollback** | **Atomic checkpoints, drift detection & 1-click restore** | Manual ZIP file backups | Sequential SQL migrations only |
| **Immutable Audit Trail** | **Field-level `{ old, new }` diffs & actor attribution** | HTTP access request logs only | Requires custom triggers or pgAudit |
| **Live HTTP Type Safety** | **Live dynamic `GET /_/types.d.ts` endpoint** | Community CLI tools (`pocketbase-typegen`) | CLI typegen (`supabase gen types`) |
| **Interactive API Documentation** | **Built-in Scalar & Swagger UI (`/_/docs`)** | Static external documentation | Supabase Studio / PostgREST spec |
| **Starter Templates & Mock Data** | **1-Click templates (E-comm, CRM) + Faker engine** | Empty database | Empty database (or Cloud samples) |

---

## Detailed Dimension Analysis

### 1. Developer Ecosystem & Language Alignment

* **NodeStack** is written 100% in TypeScript on top of modern Node.js (`node:sqlite`). Frontend developers and Node engineers do not need to learn Go or configure Docker microservices. You have unrestricted access to millions of npm packages directly in hooks, plugins, and custom routes.
* **PocketBase** requires Go if you want to write server hooks, add custom routes, or compile custom binaries. Its embedded JS engine (Goja) is a legacy ES5/ES6 interpreter with no direct access to npm packages.
* **Supabase** is polyglot—its services are built in Elixir, Go, TypeScript, and SQL. Custom backend logic is typically written as PostgreSQL PL/pgSQL functions or external Deno Edge Functions.

### 2. Multi-Tenancy Architecture

* **NodeStack (v2.0+)** introduces native **Multi-Application Tenancy** within a single process. You can host completely isolated client apps (each with its own SQLite database, auth users, uploaded assets, and realtime SSE buses) without needing separate server instances or ports.
* **PocketBase** is strictly single-tenant per process. Running multiple apps requires managing separate processes, ports, and directories.
* **Supabase** provides multi-tenancy in its managed cloud platform, but self-hosting multi-tenant Supabase requires deploying separate Docker Compose stacks for each tenant.

### 3. State Checkpoints & Point-in-Time Snapshots

* **NodeStack** features an integrated `SnapshotService` that captures atomic transactional checkpoints of the database, uploaded assets, and schema definitions. It detects live schema drift and enables 1-click non-destructive rollbacks directly from the Admin UI or CLI.
* **PocketBase** supports database file backups as zip archives, but lacks schema drift analysis, granular rollbacks, or non-destructive state branching.
* **Supabase** relies on forward SQL migration files. Rolling back state requires writing down-migrations or restoring PostgreSQL dumps.

### 4. Search & Content Discovery

* **NodeStack** embeds SQLite FTS5 natively. Every text field can be indexed for high-performance BM25 relevance ranking, contextual snippet extraction (`<mark>`), and token prefix matching out-of-the-box.
* **PocketBase** relies on standard SQL `LIKE '%query%'` scans, which do not scale well for large text collections and lack relevance ranking.
* **Supabase** provides PostgreSQL's powerful `tsvector` full-text search and `pgvector` extensions, but requires configuring database triggers, tsvector columns, and custom GIN indices.

---

## Decision Framework: When to Choose What

### Choose NodeStack if:
1. **Your team lives in TypeScript/Node.js:** You want to write backend hooks, validation rules, and custom endpoints in TypeScript with full access to npm.
2. **You want single-process multi-tenancy:** You need to host multiple isolated client databases (e.g. for SaaS tenants, clients, or staging environments) inside a single lightweight process.
3. **You want zero-install developer velocity:** Running `npx @nodestackapp/server start` gives you an instant backend, admin dashboard, and REST API in seconds without downloading binaries or configuring Docker.
4. **You need built-in state snapshots & audit trails:** You want atomic checkpoints with drift detection and field-level diff auditing without installing external tools.

### Choose PocketBase if:
1. **Minimal binary footprint is paramount:** You need a single < 20MB standalone Go binary with ~20MB of idle RAM.
2. **You prefer Go for backend extensions:** You enjoy compiling Go code and writing Go server hooks.
3. **You are building a single-app appliance:** You only need one application database per running process.

### Choose Supabase if:
1. **You need enterprise PostgreSQL scale:** Your app requires complex relational joins, PostGIS spatial queries, or multi-terabyte datasets.
2. **You rely on pgvector for AI workflows:** You want to store high-dimensional embeddings directly in PostgreSQL.
3. **You prefer a fully managed cloud platform:** You want auto-scaling database infrastructure managed for you by Supabase Cloud.
