# @nodestackapp/plugin-resend

Official Resend transactional email delivery and dispatch audit logging plugin for [NodeStack](https://github.com/satya-jugran/nodebase).

## Features

- **Automated Email Logs**: Auto-creates `_email_logs` system collection in SQLite tracking all outgoing emails.
- **Embedded Admin UI Dashboard**: Dedicated Resend status & activity overview directly in the NodeStack Admin UI.
- **Direct HTTP API**: `POST /api/resend/send` endpoint for sending emails with customizable templates.
- **IoC Container Integration**: Injects `ResendEmailService` directly into the NodeStack container for service-level access.
- **Zero Runtime Dependencies**: Ultra-lightweight and compiled for dual CommonJS + ESM.

## Installation

```bash
npm install @nodestackapp/plugin-resend
```

*(Ensure `nodestack` is installed as a peer dependency: `npm install nodestack`)*

## Usage

```typescript
import { NodeStack } from 'nodestack';
import { resendPlugin, ResendEmailService } from '@nodestackapp/plugin-resend';

const app = new NodeStack();

app.use(resendPlugin({
  apiKey: process.env.RESEND_API_KEY!,
  from: 'Acme <onboarding@yourdomain.com>',
}));

// In your application hooks or custom route handlers:
app.onRecordAfterCreate('users', async ({ record }) => {
  const resend = app.container.get<ResendEmailService>(Symbol.for('ResendEmailService'));
  await resend.sendEmail({
    to: record.email,
    subject: 'Welcome to NodeStack!',
    html: '<h1>Welcome aboard!</h1><p>Your account is ready.</p>',
  });
});

await app.start(3000);
```

## Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `apiKey` | `string` | *(required)* | Resend API key (`re_...`) |
| `from` | `string` | `'noreply@nodestack.io'` | Default sender address |
| `collectionName` | `string` | `'_email_logs'` | Custom collection name for email logs |

## License

MIT
