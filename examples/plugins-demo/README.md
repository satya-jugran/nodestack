# NodeStack Plugins Showcase & Interactive Demo

A zero-configuration, interactive demonstration and testing suite showcasing NodeStack's 5 official community extension plugins:
- 💳 **Stripe** (`@nodestackapp/plugin-stripe`)
- ☁️ **S3 / MinIO / Cloudflare R2** (`@nodestackapp/plugin-s3`)
- 📧 **Resend** (`@nodestackapp/plugin-resend`)
- 🔔 **Discord & Slack Webhooks** (`@nodestackapp/plugin-webhooks`)
- 🔍 **Algolia Search** (`@nodestackapp/plugin-algolia`)

---

## ⚡ Quick Start

From the root of the repository, execute:

```bash
npm run demo:plugins
```

The unified demo server will start on **`http://localhost:8090`**.

### 🌟 What Opens Up

1. **User-Facing Interactive Demo Portal**:
   👉 **[`http://localhost:8090/demo/`](http://localhost:8090/demo/)**
   - Interactive widgets for triggering checkout sessions, generating S3 presigned URLs, sending emails, dispatching Discord/Slack webhooks, and syncing Algolia search indices.
   - Live activity feed showing realtime API responses, payloads, and execution results.
   - Automatic admin session authentication (`admin@nodestack.io`).

2. **Admin UI Control Panel**:
   👉 **[`http://localhost:8090/_/`](http://localhost:8090/_/)**
   - **Plugin Sidebar Navigation**: All 5 plugins register custom menu items and direct links in the Admin sidebar (under `#sidebar-plugins-group`).
   - **Interactive Plugin Dashboards**: Custom HTML views rendered directly within the Admin UI for each plugin.
   - **SQLite Audit Collections**: Live inspection of plugin tracking tables:
     - `_stripe_payments`: Tracks payment status, sessions, and amounts.
     - `_s3_uploads`: Tracks file uploads, keys, sizes, and MIME types.
     - `_email_logs`: Tracks transactional emails, recipients, subjects, and delivery status.
     - `_webhook_logs`: Tracks dispatched Discord and Slack notifications and HTTP responses.
     - `_algolia_sync_queue`: Tracks pending and completed search indexing tasks.

---

## 🔑 Pre-Seeded Default Credentials & Loopback Security

To ensure safety when running locally with known default credentials, the demo server strictly binds to **`127.0.0.1` (loopback)** by default, preventing accidental exposure of the administrative account to the local network or Wi-Fi.

| Field | Default Value | Environment Override |
|---|---|---|
| **Interface Binding** | `127.0.0.1` | `HOST` (e.g. `127.0.0.1`) |
| **Port** | `8090` | `PORT` |
| **Admin Email** | `admin@nodestack.io` | `DEMO_ADMIN_EMAIL` |
| **Password** | `Password123!` | `DEMO_ADMIN_PASSWORD` |
| **Admin Portal** | `http://localhost:8090/_/` | |

> 🔒 **Security Notice**: If `HOST` is configured to a non-loopback address (such as `0.0.0.0`), provide a custom `DEMO_ADMIN_PASSWORD` to protect the admin portal from unauthorized network access.

---

## 🛠️ Interactive Features & Plugin Testing

### 1. Stripe Plugin (`@nodestackapp/plugin-stripe`)
- **Checkout Sessions**: Select a pre-seeded product (e.g. Mechanical Keyboard Pro, $149) or enter custom amounts to initiate Stripe Checkout sessions via `/api/stripe/create-checkout-session`.
- **Webhook Simulator**: Test `checkout.session.completed` lifecycle events. NodeStack validates and logs payment records to `_stripe_payments` and triggers application event bus notifications.

### 2. S3 Storage Plugin (`@nodestackapp/plugin-s3`)
- **SigV4 Presigned Upload URLs**: Generate signed PUT URLs on-demand for S3, MinIO, or Cloudflare R2 via `/api/s3/sign-upload-url`.
- **Path-Style vs Virtual-Hosted Addressing**: Supports `forcePathStyle: true` for MinIO/local S3 setups.
- **Upload Tracking**: Inspect uploaded assets directly in `_s3_uploads`.

### 3. Resend Plugin (`@nodestackapp/plugin-resend`)
- **Email Dispatch**: Send HTML/text transactional emails via `/api/resend/send`.
- **Safe Dry-Run Mode**: By default, runs with `dryRun: true` so no real API key is required. All emails are captured, validated, and logged to `_email_logs`.

### 4. Discord & Slack Webhooks (`@nodestackapp/plugin-webhooks`)
- **Mutation Webhooks**: Create a new Support Ticket (e.g., "Urgent checkout issue") in the demo UI. NodeStack's `onRecordAfterCreate` hook automatically dispatches formatted notifications to both Discord and Slack.
- **Manual Test Dispatch**: Send immediate test payloads via `/api/webhooks/test`.
- **Per-Platform Audit Logging**: Each dispatched platform creates a distinct audit row in `_webhook_logs` with HTTP status and payload details.

### 5. Algolia Search Plugin (`@nodestackapp/plugin-algolia`)
- **Automatic Queue Sync**: Record creations, updates, and deletions on monitored collections (`products`) automatically queue indexing jobs in `_algolia_sync_queue`.
- **Manual Indexing**: Trigger full re-indexing of collections on-demand via `/api/algolia/reindex`.
- **Queue Worker**: Periodically processes queued operations in background intervals.

---

## ⚙️ Environment Configuration (Optional)

By default, the demo runs in **mock/dry-run mode** with zero configuration required. If you wish to test against real live third-party services, provide standard environment variables when starting:

```bash
# Stripe
export STRIPE_SECRET_KEY="sk_test_..."
export STRIPE_WEBHOOK_SECRET="whsec_..."

# S3 / MinIO / R2
export AWS_ACCESS_KEY_ID="AKIA..."
export AWS_SECRET_ACCESS_KEY="..."
export S3_BUCKET="my-bucket"
export S3_REGION="us-east-1"
export S3_ENDPOINT="https://s3.amazonaws.com"

# Resend
export RESEND_API_KEY="re_..."

# Webhooks
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."

# Algolia
export ALGOLIA_APP_ID="..."
export ALGOLIA_API_KEY="..."

# Run demo
npm run demo:plugins
```

---

## 📁 Directory Structure

```
examples/plugins-demo/
├── README.md               # This documentation
├── server.ts               # Demo server bootstrapping, plugin registration & seeding
├── public/
│   └── index.html          # Interactive client demo UI (single page application)
└── demo_data/              # SQLite database and storage created on launch (gitignored)
```
