# @nodestackapp/plugin-algolia

Official Algolia instant search synchronization and automated index pipeline plugin for [NodeStack](https://github.com/satya-jugran/nodestack).

## Features

- **Automated Sync Audit Log**: Auto-creates `_algolia_sync_queue` system collection in SQLite tracking all index operations.
- **Realtime Mutations**: Automatically pushes created/updated records to Algolia and deletes removed documents.
- **Reindex HTTP Endpoint**: `POST /api/algolia/reindex` to trigger bulk reindexing across configured collections.
- **Embedded Admin UI Dashboard**: Algolia application status, index names, and sync metrics directly in the NodeStack Admin UI.
- **Zero Runtime Dependencies**: Ultra-lightweight and compiled for dual CommonJS + ESM.

## Installation

```bash
npm install @nodestackapp/plugin-algolia
```

*(Ensure `@nodestackapp/server` is installed as a peer dependency: `npm install @nodestackapp/server`)*

## Usage

```typescript
import { NodeStack } from '@nodestackapp/server';
import { algoliaPlugin } from '@nodestackapp/plugin-algolia';

const app = new NodeStack();

app.use(algoliaPlugin({
  appId: process.env.ALGOLIA_APP_ID!,
  apiKey: process.env.ALGOLIA_API_KEY!,
  indexPrefix: 'prod_',
  collections: ['products', 'articles', 'faqs'],
}));

await app.start(3000);
```

## Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `appId` | `string` | *(required)* | Algolia Application ID |
| `apiKey` | `string` | *(required)* | Algolia Admin API key |
| `collections` | `string[]` | *(required)* | Array of collection names to sync |
| `indexPrefix` | `string` | `'nodestack_'` | Prefix for index names (`${prefix}${collection}`) |
| `collectionName` | `string` | `'_algolia_sync_queue'` | Custom collection name for sync queue and logs |

## License

MIT
