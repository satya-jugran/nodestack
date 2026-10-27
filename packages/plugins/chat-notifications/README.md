# @nodestackapp/plugin-chat-notifications

Official Discord & Slack realtime database mutation alerts and notification audit logger for [NodeStack](https://github.com/satya-jugran/nodestack).

## Features

- **Automated Notification Audit Log**: Auto-creates `_chat_notification_logs` system collection in SQLite.
- **Discord & Slack Support**: Instant dispatching of rich formatted embed cards on record changes.
- **Mutation Filters**: Filter triggers by event (`create`, `update`, `delete`) and targeted collections.
- **Embedded Admin UI Dashboard**: Dedicated chat notifications view with active channels, dispatch counts, and interactive developer tester.
- **Zero Runtime Dependencies**: Ultra-lightweight and compiled for dual CommonJS + ESM.

## Installation

```bash
npm install @nodestackapp/plugin-chat-notifications
```

*(Ensure `@nodestackapp/server` is installed as a peer dependency: `npm install @nodestackapp/server`)*

## Usage

```typescript
import { NodeStack } from '@nodestackapp/server';
import { chatNotificationsPlugin } from '@nodestackapp/plugin-chat-notifications';

const app = new NodeStack();

app.use(chatNotificationsPlugin({
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
| `enableDiscord` | `boolean` | `true` | Enable or pause Discord notifications |
| `slackWebhookUrl` | `string` | `undefined` | Slack incoming webhook URL |
| `enableSlack` | `boolean` | `true` | Enable or pause Slack notifications |
| `collections` | `string[]` | `[]` | Collections to observe (empty = all) |
| `events` | `Array<'create' \| 'update' \| 'delete'>` | `['create', 'update', 'delete']` | Mutation events to trigger on |
| `collectionName` | `string` | `'_chat_notification_logs'` | Custom SQLite collection name for logs |
| `dryRun` | `boolean` | `false` | Audit notifications without outbound HTTP calls |

## Migration from `@nodestackapp/plugin-webhooks`

`@nodestackapp/plugin-webhooks` has been renamed to `@nodestackapp/plugin-chat-notifications` to prevent route collision with NodeStack's core Webhooks Manager engine.

To migrate:
1. Replace `"@nodestackapp/plugin-webhooks"` with `"@nodestackapp/plugin-chat-notifications"` in your `package.json`.
2. Update imports:
```typescript
// Before
import { webhookPlugin } from '@nodestackapp/plugin-webhooks';

// After
import { chatNotificationsPlugin } from '@nodestackapp/plugin-chat-notifications';
```
`webhookPlugin` is still exported as a backward-compatible alias.

## License

MIT
