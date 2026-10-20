---
sidebar_position: 2
id: database-sqlite
title: Embedded SQLite Database
description: Zero-compilation embedded SQLite powered natively by Node.js
---

️ Embedded SQLite Database

NodeStack runs on SQLite powered natively by Node.js (`node:sqlite`).

---

## Why Native `node:sqlite`?

Traditional Node.js SQLite drivers (such as `better-sqlite3` or `sqlite3`) require `node-gyp`, Python, and a C++ compiler installed on the host machine. This frequently causes build failures in Docker, minimal Alpine images, and Windows environments.

NodeStack leverages Node's native embedded SQLite module:
* **Zero Compilation**: No C++ build tools or native binaries needed.
* **Instant Start**: Boots in milliseconds.
* **Zero External Services**: No PostgreSQL or MySQL servers to manage, connect, or maintain.

---

## Performance & WAL Mode

NodeStack configures SQLite for high-throughput concurrent workloads:

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

## File Layout

All database assets live in your configured `dataDir`:

```
nodestack_data/
├── data.db          # Main database file
├── data.db-shm      # Shared-memory index
└── data.db-wal      # Write-ahead log
```
