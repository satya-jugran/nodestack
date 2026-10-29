---
sidebar_position: 1
id: docker
title: Docker & Container Deployment
description: Deploying NodeStack in Docker and Railway with persistent volume mounts
---

# Docker & Container Deployment

Because NodeStack has zero native C++ compilation steps and uses Node's embedded SQLite engine, deploying with Docker is lightweight, fast, and secure.

---

## 1-Click Railway Deployment

You can deploy NodeStack directly to Railway with zero configuration:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2Fsatya-jugran%2Fnodestack)

Railway will automatically build the container via `Dockerfile`, attach persistent volume storage to `/app/nodestack_data`, and provide a production HTTPS domain.

---

## Production Multi-Stage Dockerfile

A production `Dockerfile` is included at the repository root:

```dockerfile
# Stage 1: Build & Compile
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages ./packages
COPY examples ./examples

RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY bin ./bin
COPY scripts ./scripts

RUN npm run build:server
RUN npm prune --omit=dev

# Stage 2: Minimal Production Runner
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NODESTACK_HOST=0.0.0.0
ENV NODESTACK_PORT=8090
ENV NODESTACK_DATA_DIR=/app/nodestack_data

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/packages ./packages

EXPOSE 8090
VOLUME ["/app/nodestack_data"]

CMD ["node", "bin/nodestack.js", "start"]
```

---

## Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  nodestack:
    image: nodestack:latest
    build: .
    restart: unless-stopped
    ports:
      - "8090:8090"
    environment:
      - NODESTACK_PORT=8090
      - NODESTACK_HOST=0.0.0.0
      - NODESTACK_DATA_DIR=/app/nodestack_data
      - NODESTACK_JWT_SECRET=${JWT_SECRET}
    volumes:
      - nodestack_volume:/app/nodestack_data

volumes:
  nodestack_volume:
```

Launch with:
```bash
docker compose up -d
```
