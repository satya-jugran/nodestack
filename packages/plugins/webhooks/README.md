# @nodestackapp/plugin-webhooks

Official Discord & Slack realtime database mutation alerts and webhook audit logger for [NodeStack](https://github.com/satya-jugran/nodebase).

## Features

- **Automated Webhook Audit Log**: Auto-creates `_webhook_logs` system collection in SQLite.
- **Discord & Slack Support**: Instant dispatching of rich formatted embed cards on record changes.
- **Mutation Filters**: Filter triggers by event (`create`, `update`, `delete`) and targeted collections.
- **Embedded Admin UI Dashboard**: Dedicated webhooks view with active channels and dispatch counts.
- **Zero Runtime Dependencies**: Ultra-lightweight and compiled for dual CommonJS + ESM.

## Installation

```bash
npm install @nodestackapp/plugin-webhooks
```

*(Ensure `nodestack` is installed as a peer dependency: `npm install nodestack`)*

## Usage

```typescript
import { NodeStack } from 'nodestack';
import { webhookPlugin } from '@nodestackapp/plugin-webhooks';

const app = new NodeStack();

app.use(webhookPlugin({
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
  collections: ['orders', 'users', 'invoices'],
  events: ['create', 'delete'],
}));

await app.start(3000);
```

## Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `discordWebhookUrl` | `string` | `undefined` | Discord incoming webhook URL |
| `slackWebhookUrl` | `string` | `undefined` | Slack incoming webhook URL |
| `collections` | `string[]` | `[]` | Collections to observe (empty = all) |
| `events` | `Array<'create' \| 'update' \| 'delete'>` | `['create', 'update', 'delete']` | Mutation events to trigger on |
| `collectionName` | `string` | `'_webhook_logs'` | Custom SQLite collection name for logs |

## License

MIT
