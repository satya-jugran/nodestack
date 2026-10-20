---
sidebar_position: 1
id: docker
title: Docker & Container Deployment
description: Deploying NodeStack in Docker with persistent volume mounts
---

Docker Deployment

Because NodeStack has zero native C++ compilation steps, deploying with Docker is lightweight and fast.

---

## Minimal Dockerfile

Create a `Dockerfile`:

```dockerfile
FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY . .

# Expose port and mount point
EXPOSE 8090
VOLUME ["/app/nodestack_data"]

ENV NODESTACK_PORT=8090
ENV NODESTACK_HOST=0.0.0.0
ENV NODESTACK_DATA_DIR=/app/nodestack_data

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
