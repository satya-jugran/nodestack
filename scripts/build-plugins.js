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
  secretKey?: string;
  webhookSecret?: string;
  currency?: string;
  customersCollection?: string;
  paymentsCollection?: string;
  endpoint?: string;
  fetch?: typeof fetch;
  dryRun?: boolean;
}

export interface StripeCheckoutSessionResult {
  id: string;
  url: string;
  amount: number;
  currency: string;
  customerEmail: string;
  status?: string;
  livemode?: boolean;
}

export declare class StripeService {
  readonly options: StripePluginOptions;
  constructor(options?: StripePluginOptions);
  isTestMode(): boolean;
  getBaseUrl(): string;
  createCheckoutSession(params: {
    email: string;
    amount: number;
    currency?: string;
    customerId?: string;
    successUrl?: string;
    cancelUrl?: string;
    productName?: string;
  }): Promise<StripeCheckoutSessionResult>;
  verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string,
    secret?: string,
    toleranceSeconds?: number
  ): boolean;
  generateWebhookSignature(
    rawBody: string | Buffer,
    secret?: string,
    timestamp?: number
  ): string;
}

export declare function stripePlugin(options?: StripePluginOptions): INodeStackPlugin;
`,
  },
  {
    name: 's3',
    pkgDir: 'packages/plugins/s3',
    sourceFile: 'src/plugins/s3.ts',
    typesContent: `import type { INodeStackPlugin } from 'nodestack';

export interface S3StoragePluginOptions {
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  collectionName?: string;
  authPolicy?: 'admin' | 'adminOrInitial' | 'user' | 'public';
}

export declare class S3StorageService {
  readonly options: S3StoragePluginOptions;
  constructor(options?: S3StoragePluginOptions);
  getBucketEndpoint(): string;
  getObjectUrl(key: string): string;
  getPresignedUploadUrl(
    filename: string,
    mimeType?: string,
    options?: {
      expiresIn?: number;
      method?: 'PUT' | 'GET';
      key?: string;
    }
  ): {
    key: string;
    uploadUrl: string;
    bucket: string;
    region: string;
    mimeType: string;
    expiresIn: number;
  };
}

export declare function s3StoragePlugin(options?: S3StoragePluginOptions): INodeStackPlugin;
export declare const awsS3Plugin: typeof s3StoragePlugin;
`,
  },
  {
    name: 'resend',
    pkgDir: 'packages/plugins/resend',
    sourceFile: 'src/plugins/resend.ts',
    typesContent: `import type { INodeStackPlugin } from 'nodestack';

export interface ResendPluginOptions {
  apiKey?: string;
  from?: string;
  collectionName?: string;
  authPolicy?: 'admin' | 'adminOrInitial' | 'user' | 'public';
  endpoint?: string;
  fetch?: typeof fetch;
  dryRun?: boolean;
}

export interface ResendEmailResult {
  id: string;
  from: string;
  to: string;
  subject: string;
  status: 'sent' | 'delivered' | 'failed';
  createdAt: string;
  error?: string;
}

export declare class ResendEmailService {
  readonly options: ResendPluginOptions;
  constructor(options?: ResendPluginOptions);
  getBaseUrl(): string;
  sendEmail(params: {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    from?: string;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
  }): Promise<ResendEmailResult>;
}

export declare function resendPlugin(options?: ResendPluginOptions): INodeStackPlugin;
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
  authPolicy?: 'admin' | 'adminOrInitial' | 'user' | 'public';
  fetch?: typeof fetch;
  dryRun?: boolean;
}

export interface WebhookDispatchResult {
  id: string;
  platform: 'discord' | 'slack';
  payload: any;
  status: 'dispatched' | 'failed';
  statusCode?: number;
  error?: string;
  timestamp: string;
}

export declare class WebhookNotificationService {
  readonly options: WebhookPluginOptions;
  dispatched: Array<WebhookDispatchResult>;
  constructor(options?: WebhookPluginOptions);
  getWebhookUrl(platform: 'discord' | 'slack'): string | undefined;
  formatPayload(platform: 'discord' | 'slack', payload: any): Record<string, any>;
  dispatch(platform: 'discord' | 'slack', payload: any, customUrl?: string): Promise<WebhookDispatchResult>;
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
  appId?: string;
  apiKey?: string;
  indexPrefix?: string;
  collections?: string[];
  collectionName?: string;
  authPolicy?: 'admin' | 'adminOrInitial' | 'user' | 'public';
  endpoint?: string;
  fetch?: typeof fetch;
  dryRun?: boolean;
  autoProcessIntervalMs?: number;
}

export interface AlgoliaOperationResult {
  success: boolean;
  taskId?: number | string;
  objectID?: string;
  error?: string;
}

export declare class AlgoliaSyncService {
  readonly options: AlgoliaPluginOptions;
  syncedOperations: Array<{
    action: string;
    collection: string;
    objectId: string;
    timestamp: string;
    status: 'synced' | 'failed' | 'queued';
    taskId?: string | number;
    error?: string;
  }>;
  constructor(options?: AlgoliaPluginOptions);
  getIndexName(collection: string): string;
  getBaseUrl(): string;
  getHeaders(): Record<string, string>;
  request<T = any>(path: string, method?: string, body?: any): Promise<T>;
  saveObject(indexName: string, objectId: string, record: Record<string, any>): Promise<AlgoliaOperationResult>;
  deleteObject(indexName: string, objectId: string): Promise<AlgoliaOperationResult>;
  batch(indexName: string, requests: Array<{ action: 'updateObject' | 'addObject' | 'deleteObject'; body?: any; objectID?: string }>): Promise<{ success: boolean; taskId?: any; processed: number; error?: string }>;
  recordSync(action: 'save' | 'delete', collection: string, objectId: string, status?: 'synced' | 'failed' | 'queued', details?: { taskId?: string | number; error?: string }): any;
  submitMutation(action: 'save' | 'delete', collection: string, objectId: string, record?: Record<string, any>): Promise<AlgoliaOperationResult>;
  processQueue(app: any, limit?: number): Promise<{ processed: number; succeeded: number; failed: number }>;
}

export declare function algoliaPlugin(options?: AlgoliaPluginOptions): INodeStackPlugin;
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
