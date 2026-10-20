---
sidebar_position: 3
id: configuration
title: Configuration & Environment
description: Environment variables and startup flags for NodeStack
---

️ Configuration & Environment

NodeStack can be configured via environment variables or CLI flags.

---

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `NODESTACK_DATA_DIR` | `./nodestack_data` | Directory where SQLite database and uploaded files are stored. |
| `NODESTACK_PORT` | `8090` | HTTP port for the API server and Web Admin UI. |
| `NODESTACK_HOST` | `127.0.0.1` | Network interface to bind to (`0.0.0.0` for all interfaces/containers). |
| `NODESTACK_JWT_SECRET` | Auto-generated | Secret key used to sign and verify authentication tokens. |
| `NODESTACK_APP_NAME` | `NodeStack` | Application name displayed in the Web Admin UI and OpenAPI docs. |
| `NODESTACK_MAX_UPLOAD_SIZE` | `52428800` (50MB) | Maximum file size in bytes for multipart uploads. |
| `NODESTACK_CORS_ORIGIN` | `*` | Allowed CORS origins for browser clients. |
| `NODESTACK_LOG_LEVEL` | `info` | Logging verbosity (`fatal`, `error`, `warn`, `info`, `debug`, `trace`). |

---

## CLI Flags

You can pass configuration flags directly when launching NodeStack:

```bash
# Launch on custom port and host
npx nodestack start --port 3000 --host 0.0.0.0

# Specify a custom data directory
npx nodestack start --dir /var/data/nodestack

# Enable debug logging
npx nodestack start --log-level debug
```

---

## Programmatic Configuration

When using NodeStack as a library in TypeScript:

```typescript
import { NodeStack } from 'nodestack';

const app = new NodeStack({
  dataDir: './my_app_data',
  port: 8090,
  host: '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'super-secret-key-32-chars-min',
  appName: 'My Custom App',
  cors: {
    origin: ['https://myapp.com', 'http://localhost:3000'],
    credentials: true,
  },
});

await app.start();
```
