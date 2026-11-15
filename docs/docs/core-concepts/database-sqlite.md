---
sidebar_position: 2
id: database-sqlite
title: Database Engines & Multi-Database Architecture
description: Zero-compilation embedded SQLite, PostgreSQL, and Microsoft SQL Server with live migrations
---

# 🗄️ Database Engines & Multi-Database Architecture

NodeStack runs on embedded **SQLite** by default (powered natively by Node.js `node:sqlite`), and in **v2.5.0** introduces first-class multi-database architecture supporting **PostgreSQL** and **Microsoft SQL Server (MSSQL)**.

---

## Supported Database Engines

| Provider | Engine Type | Use Cases | Snapshots Supported |
| :--- | :--- | :--- | :--- |
| `sqlite` (Default) | Embedded (`node:sqlite`) | Local development, edge deployments, single-VPS hosting | ✅ Atomic Checkpoints |
| `postgres` | Remote client (`pg`) | High-concurrency production, distributed services, cloud RDS | Managed cloud backups |
| `mssql` | Remote client (`mssql`) | Enterprise Microsoft infrastructure, Azure SQL | Managed cloud backups |

---

## Why Native `node:sqlite` by Default?

Traditional Node.js SQLite drivers (such as `better-sqlite3` or `sqlite3`) require `node-gyp`, Python, and a C++ compiler installed on the host machine. This frequently causes build failures in Docker, minimal Alpine images, and Windows environments.

NodeStack leverages Node's native embedded SQLite module:
* **Zero Compilation**: No C++ build tools or native binaries needed.
* **Instant Start**: Boots in milliseconds.
* **Zero External Services**: No external database servers to manage or configure for initial development.

---

## PostgreSQL & MSSQL Support (v2.5.0)

For production scale and enterprise environments, NodeStack allows switching database engines per tenant/app scope:

* **Dialect Abstraction**: Specialized dialect engines (`ISqlDialect`, `SqliteDialect`, `PostgresDialect`, `MssqlDialect`) handle query rendering, camelCase identifier quoting, boolean record normalization, and upserts.
* **Multi-Engine Full-Text Search**: Seamless BM25 FTS across engines using `SqliteFts5Driver`, `PostgresFtsDriver` (`tsvector`), and `MssqlFtsDriver` (`CONTAINSTABLE`).
* **Dual Queue Execution**: Synchronous queue processing for SQLite (`SyncQueueEngine`) and asynchronous execution for remote pools (`AsyncQueueEngine`).
* **Strict SSL Verification**: PostgreSQL connections support strict CA certificate validation for secure cloud database hosting.

---

## Live Engine Migration & CLI

You can inspect, test, configure, and switch database providers directly via the Admin UI (**Database** view) or using the NodeStack CLI:

```bash
# Check current database status and latency
nodestack db status

# Test connection to a remote PostgreSQL or MSSQL database
nodestack db test postgres "postgres://user:pass@db.example.com:5432/myapp?ssl=true"
nodestack db test mssql "mssql://user:pass@db.example.com:1433/myapp"

# Switch provider with live schema & data migration
nodestack db switch postgres "postgres://user:pass@db.example.com:5432/myapp?ssl=true" --migrate --confirm migrate
```

---

## Performance & WAL Mode (SQLite)

When running on SQLite, NodeStack configures SQLite for high-throughput concurrent workloads:

* **WAL Mode (Write-Ahead Logging)**:
  ```sql
  PRAGMA journal_mode = WAL;
  ```
  Allows simultaneous concurrent readers while a write is occurring, eliminating read-write contention.
* **Synchronous Normal**:
  ```sql
  PRAGMA synchronous = NORMAL;
  ```
  Provides strong durability while avoiding expensive disk sync operations on every query.
* **Foreign Keys**:
  ```sql
  PRAGMA foreign_keys = ON;
  ```
  Enforces relational integrity across collections.
* **Cache Size**:
  Configured to store pages in memory for lightning-fast repeated queries.

---

## File Layout (SQLite)

When using SQLite, database files live in your configured `dataDir`:

```
nodestack_data/
├── data.db          # Main database file
├── data.db-shm      # Shared-memory index
└── data.db-wal      # Write-ahead log
```
