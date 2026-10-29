# ==============================================================================
# NodeStack Production Dockerfile
# Multi-stage build with Node.js 24 Alpine
# ==============================================================================

# Stage 1: Build & Compile
FROM node:24-alpine AS builder

WORKDIR /app

# Copy root package manifests and workspace packages
COPY package*.json ./
COPY packages ./packages
COPY examples ./examples

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy TypeScript configs and source code
COPY tsconfig.json ./
COPY src ./src
COPY bin ./bin
COPY scripts ./scripts

# Build TypeScript server and bundle Admin UI
RUN npm run build:server

# Remove devDependencies to minimize image size
RUN npm prune --omit=dev

# ==============================================================================
# Stage 2: Minimal Production Runner
# ==============================================================================
FROM node:24-alpine AS runner

LABEL maintainer="NodeStack Team"
LABEL description="NodeStack — The TypeScript-Native Backend Stack"

WORKDIR /app

ENV NODE_ENV=production
ENV NODESTACK_HOST=0.0.0.0
ENV NODESTACK_PORT=8090
ENV NODESTACK_DATA_DIR=/app/nodestack_data

# Copy production artifacts from builder
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/packages ./packages

# Expose default HTTP port
EXPOSE 8090

# Persistent volume for SQLite database and uploaded files
VOLUME ["/app/nodestack_data"]

# Start NodeStack server
CMD ["node", "bin/nodestack.js", "start"]
