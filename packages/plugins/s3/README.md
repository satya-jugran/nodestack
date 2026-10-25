# @nodestackapp/plugin-s3

Official S3 & S3-compatible cloud storage plugin (AWS S3, Cloudflare R2, MinIO, Backblaze B2) for [NodeStack](https://github.com/satya-jugran/nodestack).

## Features

- **Automated Metadata Collection**: Auto-creates `_s3_uploads` system collection in SQLite to track uploads.
- **Presigned Upload URLs**: Direct browser-to-bucket uploads with `POST /api/s3/sign-upload-url`.
- **Embedded Admin UI Dashboard**: S3 storage status, active bucket info, and configuration overview directly in the NodeStack Admin UI.
- **S3-Compatible Support**: Full support for custom S3 endpoints (MinIO, Ceph, Cloudflare R2, DigitalOcean Spaces).
- **Zero Runtime Dependencies**: Ultra-lightweight and compiled for dual CommonJS + ESM.

## Installation

```bash
npm install @nodestackapp/plugin-s3
```

*(Ensure `@nodestackapp/server` is installed as a peer dependency: `npm install @nodestackapp/server`)*

## Usage

```typescript
import { NodeStack } from '@nodestackapp/server';
import { s3StoragePlugin } from '@nodestackapp/plugin-s3';

const app = new NodeStack();

app.use(s3StoragePlugin({
  bucket: 'my-production-bucket',
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
}));

await app.start(3000);
```

## Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `bucket` | `string` | *(required)* | S3 bucket name |
| `region` | `string` | *(required)* | AWS region (e.g. `us-east-1`) |
| `endpoint` | `string` | `undefined` | Custom S3 endpoint URL (for MinIO, R2, etc.) |
| `accessKeyId` | `string` | `undefined` | AWS access key |
| `secretAccessKey` | `string` | `undefined` | AWS secret access key |
| `forcePathStyle` | `boolean` | `false` | Use path-style bucket URLs (`http://s3/bucket`) |
| `collectionName` | `string` | `'_s3_uploads'` | Custom SQLite collection name for uploads |

## License

MIT
