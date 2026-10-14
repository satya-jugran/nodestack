const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const PLUGINS = [
  {
    name: 'stripe',
    pkgDir: 'packages/plugins/stripe',
    sourceFile: 'src/plugins/stripe.ts',
    typesContent: `import type { INodeStackPlugin } from 'nodestack';

export interface StripePluginOptions {
  secretKey: string;
  webhookSecret?: string;
  currency?: string;
  customersCollection?: string;
  paymentsCollection?: string;
}

export declare class StripeService {
  readonly options: StripePluginOptions;
  constructor(options: StripePluginOptions);
  isTestMode(): boolean;
  createCheckoutSession(params: {
    email: string;
    amount: number;
    currency?: string;
    customerId?: string;
    successUrl?: string;
    cancelUrl?: string;
  }): {
    id: string;
    url: string;
    amount: number;
    currency: string;
    customerEmail: string;
  };
}

export declare function stripePlugin(options: StripePluginOptions): INodeStackPlugin;
`,
  },
  {
    name: 's3',
    pkgDir: 'packages/plugins/s3',
    sourceFile: 'src/plugins/s3.ts',
    typesContent: `import type { INodeStackPlugin } from 'nodestack';

export interface S3StoragePluginOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  collectionName?: string;
}

export declare class S3StorageService {
  readonly options: S3StoragePluginOptions;
  constructor(options: S3StoragePluginOptions);
  getBucketEndpoint(): string;
  getPresignedUploadUrl(filename: string, mimeType?: string): {
    key: string;
    uploadUrl: string;
    bucket: string;
    region: string;
    mimeType: string;
  };
}

export declare function s3StoragePlugin(options: S3StoragePluginOptions): INodeStackPlugin;
export declare const awsS3Plugin: typeof s3StoragePlugin;
`,
  },
  {
    name: 'resend',
    pkgDir: 'packages/plugins/resend',
    sourceFile: 'src/plugins/resend.ts',
    typesContent: `import type { INodeStackPlugin } from 'nodestack';

export interface ResendPluginOptions {
  apiKey: string;
  from?: string;
  collectionName?: string;
}

export declare class ResendEmailService {
  readonly options: ResendPluginOptions;
  constructor(options: ResendPluginOptions);
  sendEmail(params: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    from?: string;
  }): Promise<{
    id: string;
    from: string;
    to: string;
    subject: string;
    status: string;
    createdAt: string;
  }>;
}

export declare function resendPlugin(options: ResendPluginOptions): INodeStackPlugin;
`,
  },
  {
    name: 'webhooks',
    pkgDir: 'packages/plugins/webhooks',
    sourceFile: 'src/plugins/webhooks.ts',
    typesContent: `import type { INodeStackPlugin } from 'nodestack';

export interface WebhookPluginOptions {
  discordWebhookUrl?: string;
  slackWebhookUrl?: string;
  collections?: string[];
  events?: Array<'create' | 'update' | 'delete'>;
  collectionName?: string;
}

export declare class WebhookNotificationService {
  readonly options: WebhookPluginOptions;
  dispatched: Array<{
    platform: string;
    payload: any;
    timestamp: string;
  }>;
  constructor(options: WebhookPluginOptions);
  dispatch(platform: 'discord' | 'slack', payload: any): Promise<{
    id: string;
    platform: 'discord' | 'slack';
    payload: any;
    timestamp: string;
  }>;
}

export declare function webhookPlugin(options?: WebhookPluginOptions): INodeStackPlugin;
`,
  },
  {
    name: 'algolia',
    pkgDir: 'packages/plugins/algolia',
    sourceFile: 'src/plugins/algolia.ts',
    typesContent: `import type { INodeStackPlugin } from 'nodestack';

export interface AlgoliaPluginOptions {
  appId: string;
  apiKey: string;
  indexPrefix?: string;
  collections: string[];
  collectionName?: string;
}

export declare class AlgoliaSyncService {
  readonly options: AlgoliaPluginOptions;
  syncedOperations: Array<{
    action: string;
    collection: string;
    objectId: string;
    timestamp: string;
  }>;
  constructor(options: AlgoliaPluginOptions);
  getIndexName(collection: string): string;
  recordSync(action: 'save' | 'delete', collection: string, objectId: string): {
    action: 'delete' | 'save';
    collection: string;
    objectId: string;
    timestamp: string;
  };
}

export declare function algoliaPlugin(options: AlgoliaPluginOptions): INodeStackPlugin;
`,
  },
];

console.log('====================================================');
console.log(' Building Official @nodestackapp Plugin Packages   ');
console.log('====================================================');

for (const plugin of PLUGINS) {
  const pkgPath = path.resolve(rootDir, plugin.pkgDir);
  const distDir = path.resolve(pkgPath, 'dist');
  const sourcePath = path.resolve(rootDir, plugin.sourceFile);

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const pkgJsonPath = path.resolve(pkgPath, 'package.json');
  const pkgName = fs.existsSync(pkgJsonPath) ? JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).name : plugin.name;

  console.log(`\n📦 [${pkgName}]`);

  // 1. Build ESM
  const esmOut = path.resolve(distDir, 'index.mjs');
  execSync(
    `npx esbuild "${sourcePath}" --bundle --format=esm --target=es2022 --platform=node --outfile="${esmOut}" --sourcemap`,
    { stdio: 'inherit', cwd: rootDir }
  );

  // 2. Build CJS
  const cjsOut = path.resolve(distDir, 'index.cjs');
  execSync(
    `npx esbuild "${sourcePath}" --bundle --format=cjs --target=es2022 --platform=node --outfile="${cjsOut}" --sourcemap`,
    { stdio: 'inherit', cwd: rootDir }
  );

  // 3. Emit index.d.ts
  const dtsOut = path.resolve(distDir, 'index.d.ts');
  fs.writeFileSync(dtsOut, plugin.typesContent.trim() + '\n', 'utf8');

  const esmSize = (fs.statSync(esmOut).size / 1024).toFixed(2);
  const cjsSize = (fs.statSync(cjsOut).size / 1024).toFixed(2);
  const dtsSize = (fs.statSync(dtsOut).size / 1024).toFixed(2);

  console.log(`  ✓ ESM:  ${esmSize} KB -> ${plugin.pkgDir}/dist/index.mjs`);
  console.log(`  ✓ CJS:  ${cjsSize} KB -> ${plugin.pkgDir}/dist/index.cjs`);
  console.log(`  ✓ Types:${dtsSize} KB -> ${plugin.pkgDir}/dist/index.d.ts`);
}

console.log('\n✅ All @nodestackapp plugin packages built successfully!\n');
