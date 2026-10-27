# @nodestackapp/plugin-webhooks (Deprecated)

> [!WARNING]
> **This package is DEPRECATED.** It has been renamed to [`@nodestackapp/plugin-chat-notifications`](https://www.npmjs.com/package/@nodestackapp/plugin-chat-notifications) to avoid route collisions with NodeStack's core Webhooks Manager engine (`/_/webhooks`).
> Please migrate to `@nodestackapp/plugin-chat-notifications`.

## Quick Migration

1. Uninstall old package:
```bash
npm uninstall @nodestackapp/plugin-webhooks
npm install @nodestackapp/plugin-chat-notifications
```

2. Update import:
```typescript
// Replace:
// import { webhookPlugin } from '@nodestackapp/plugin-webhooks';

// With:
import { chatNotificationsPlugin } from '@nodestackapp/plugin-chat-notifications';
```
`webhookPlugin` is still supported as a backward-compatible alias in `@nodestackapp/plugin-chat-notifications`.
