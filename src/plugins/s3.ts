import * as crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { INodeStackPlugin, NodeStackPluginContext, AdminNavItem, AdminCustomView } from '../core/plugins/types';

export interface S3StoragePluginOptions {
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  collectionName?: string;
  /** Authentication policy for presigned upload URLs: 'admin' (default), 'adminOrInitial', 'user', or 'public' */
  authPolicy?: 'admin' | 'adminOrInitial' | 'user' | 'public';
}

export class S3StorageService {
  public options: S3StoragePluginOptions;

  constructor(options: S3StoragePluginOptions = {}) {
    this.options = { ...options };
  }

  public isConfigured(): boolean {
    const bucket = this.options.bucket?.trim();
    return Boolean(bucket && bucket !== '');
  }

  public updateOptions(newOpts: Partial<S3StoragePluginOptions>): void {
    this.options = { ...this.options, ...newOpts };
  }

  public getBucketEndpoint(): string {
    const isPathStyle =
      this.options.forcePathStyle !== undefined
        ? this.options.forcePathStyle
        : Boolean(this.options.endpoint);

    if (this.options.endpoint) {
      const endpoint = this.options.endpoint.replace(/\/+$/, '');
      if (isPathStyle) {
        return `${endpoint}/${this.options.bucket}`;
      }
      try {
        const u = new URL(endpoint);
        const basePath = u.pathname.replace(/\/+$/, '');
        return `${u.protocol}//${this.options.bucket}.${u.host}${basePath}`;
      } catch {
        return `${endpoint}/${this.options.bucket}`;
      }
    }

    if (isPathStyle) {
      return `https://s3.${this.options.region}.amazonaws.com/${this.options.bucket}`;
    }
    return `https://${this.options.bucket}.s3.${this.options.region}.amazonaws.com`;
  }

  public getObjectUrl(key: string): string {
    const cleanKey = key.replace(/^\/+/, '');
    return `${this.getBucketEndpoint()}/${cleanKey}`;
  }

  public getPresignedUploadUrl(
    filename: string,
    mimeType?: string,
    options?: {
      expiresIn?: number;
      method?: 'PUT' | 'GET';
      key?: string;
    }
  ) {
    const bucket = this.options.bucket?.trim() || '';
    if (!bucket) {
      const err: any = new Error(
        'S3 bucket name is not configured. Please set a bucket name in extension settings or S3_BUCKET environment variable before generating presigned URLs.'
      );
      err.status = 400;
      throw err;
    }

    const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
    const safeBase = filename.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
    const key =
      options?.key ||
      `uploads/${Date.now()}_${safeBase}_${crypto.randomBytes(4).toString('hex')}${ext}`;

    const accessKeyId =
      this.options.accessKeyId || process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || 'AKIAIOSFODNN7EXAMPLE';
    const secretAccessKey =
      this.options.secretAccessKey ||
      process.env.AWS_SECRET_ACCESS_KEY ||
      process.env.S3_SECRET_ACCESS_KEY ||
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const region = this.options.region || 'us-east-1';
    const expiresIn = options?.expiresIn || 3600;
    const method = options?.method || 'PUT';

    // Format ISO8601 basic timestamps for SigV4
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    // Resolve host & canonical URI path based on endpoint and path-style
    let protocol = 'https:';
    let host = '';
    let canonicalUri = '';

    if (this.options.endpoint) {
      const u = new URL(this.options.endpoint);
      protocol = u.protocol;
      const isPathStyle = this.options.forcePathStyle ?? true;

      if (isPathStyle) {
        host = u.host;
        const basePath = u.pathname.replace(/\/+$/, '');
        canonicalUri = `${basePath}/${encodeURIComponent(bucket)}/${key
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`;
      } else {
        host = `${bucket}.${u.host}`;
        const basePath = u.pathname.replace(/\/+$/, '');
        canonicalUri = `${basePath}/${key.split('/').map(encodeURIComponent).join('/')}`;
      }
    } else {
      const isPathStyle = this.options.forcePathStyle ?? false;
      if (isPathStyle) {
        host = `s3.${region}.amazonaws.com`;
        canonicalUri = `/${encodeURIComponent(bucket)}/${key
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`;
      } else {
        host = `${bucket}.s3.${region}.amazonaws.com`;
        canonicalUri = `/${key.split('/').map(encodeURIComponent).join('/')}`;
      }
    }

    if (!canonicalUri.startsWith('/')) {
      canonicalUri = '/' + canonicalUri;
    }

    // Query parameters for SigV4 query-string authentication (sorted alphabetically)
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const queryParams: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresIn),
      'X-Amz-SignedHeaders': 'host',
    };

    const canonicalQueryString = Object.keys(queryParams)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
      .join('&');

    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = 'host';
    const payloadHash = 'UNSIGNED-PAYLOAD';

    // Canonical request
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');

    // String to sign
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      hashedCanonicalRequest,
    ].join('\n');

    // SigV4 signing key calculation
    const kDate = crypto.createHmac('sha256', 'AWS4' + secretAccessKey).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    const signingKey = crypto.createHmac('sha256', kService).update('aws4_request').digest();

    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const uploadUrl = `${protocol}//${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;

    return {
      key,
      uploadUrl,
      bucket,
      region,
      mimeType: mimeType || 'application/octet-stream',
      expiresIn,
    };
  }
}

export function s3StoragePlugin(options: S3StoragePluginOptions = {}): INodeStackPlugin {
  const initialBucket = options?.bucket || process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || '';
  const initialRegion = options?.region || process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
  const collectionName = options?.collectionName || '_s3_uploads';
  const s3Service = new S3StorageService({ ...options, bucket: initialBucket, region: initialRegion });
  let currentContext: NodeStackPluginContext | null = null;

  const buildAdminView = (currentBucket: string, currentRegion: string): AdminCustomView => {
    const isConfigured = Boolean(currentBucket && currentBucket.trim() !== '');
    return {
      title: 'S3-Compatible Storage Provider',
      description: isConfigured
        ? `Connected to bucket "${currentBucket}" in region ${currentRegion}`
        : `Unconfigured — No S3 bucket specified (Default Region: ${currentRegion})`,
      html: `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem;">
          <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Bucket Name</div>
            <div style="font-size: 13px; font-weight: 700; color: ${isConfigured ? '#60a5fa' : '#f59e0b'}; font-family: monospace; margin-top: 4px;">${escapeHtml(currentBucket || '(Not Configured)')}</div>
          </div>
          <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Region</div>
            <div style="font-size: 13px; font-weight: 700; color: #34d399; font-family: monospace; margin-top: 4px;">${escapeHtml(currentRegion)}</div>
          </div>
          <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Tracking Collection</div>
            <div style="font-size: 13px; font-weight: 700; color: #eab308; font-family: monospace; margin-top: 4px;">${escapeHtml(collectionName)}</div>
          </div>
        </div>
      `,
    };
  };

  const navItem: AdminNavItem = {
    id: 's3-storage',
    title: 'S3 Storage',
    badge: s3Service.isConfigured() ? (s3Service.options.region || 'us-east-1').toUpperCase() : 'UNCONFIGURED',
    badgeVariant: s3Service.isConfigured() ? 'info' : 'warning',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`,
    view: buildAdminView(s3Service.options.bucket || '', s3Service.options.region || 'us-east-1'),
  };

  return {
    name: 's3-storage',
    version: '1.0.0',
    description: 'S3-compatible cloud storage adapter, presigned URLs & asset synchronization',

        codeOptions: { ...(options || {}) },
    buildAdminNavItems(cfg: Record<string, any>) {
      const bucket = cfg.bucket !== undefined ? cfg.bucket : (options?.bucket || '');
      const region = cfg.region || options?.region || 'us-east-1';
      const isConfigured = Boolean(bucket && String(bucket).trim() !== '');
      return [{
        id: 's3-storage',
        title: 'S3 Storage',
        badge: isConfigured ? String(region).toUpperCase() : 'UNCONFIGURED',
        badgeVariant: isConfigured ? 'info' : 'warning',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`,
        view: buildAdminView(bucket, region),
      }];
    },
    configSchema: {
      fields: [
        {
          name: 'bucket',
          label: 'S3 Bucket Name',
          type: 'text',
          envKey: 'S3_BUCKET',
          placeholder: 'my-bucket',
          description: 'Target AWS S3 or compatible object storage bucket name',
          required: true,
        },
        {
          name: 'region',
          label: 'AWS Region',
          type: 'text',
          envKey: 'S3_REGION',
          defaultValue: 'us-east-1',
          placeholder: 'us-east-1',
          description: 'AWS region code (e.g. us-east-1, eu-west-1, ap-south-1)',
          required: true,
        },
        {
          name: 'endpoint',
          label: 'Custom Endpoint',
          type: 'text',
          envKey: 'S3_ENDPOINT',
          placeholder: 'https://play.min.io or http://localhost:9000',
          description: 'Custom S3 endpoint for MinIO, Cloudflare R2, or LocalStack',
        },
        {
          name: 'forcePathStyle',
          label: 'Force Path Style',
          type: 'boolean',
          envKey: 'S3_FORCE_PATH_STYLE',
          defaultValue: false,
          description: 'Enable path-style addressing (endpoint/bucket) required by MinIO',
        },
        {
          name: 'accessKeyId',
          label: 'Access Key ID',
          type: 'text',
          envKey: 'AWS_ACCESS_KEY_ID',
          placeholder: 'AKIAIOSFODNN7EXAMPLE',
          description: 'IAM Access Key ID with S3 read/write permissions',
        },
        {
          name: 'secretAccessKey',
          label: 'Secret Access Key',
          type: 'password',
          envKey: 'AWS_SECRET_ACCESS_KEY',
          placeholder: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          description: 'IAM Secret Access Key for SigV4 request authorization',
        },
      ],
    },
    onConfigUpdate(newConfig) {
      s3Service.updateOptions(newConfig);
      const isConfigured = s3Service.isConfigured();
      const effectiveBucket = s3Service.options.bucket || '';
      const effectiveRegion = s3Service.options.region || 'us-east-1';
      navItem.badge = isConfigured ? effectiveRegion.toUpperCase() : 'UNCONFIGURED';
      navItem.badgeVariant = isConfigured ? 'info' : 'warning';
      navItem.view = buildAdminView(effectiveBucket, effectiveRegion);
    },

    collections: [
      {
        name: collectionName,
        type: 'base',
        system: true,
        schema: [
          { id: 'f_key', name: 'key', type: 'text', required: true, unique: true },
          { id: 'f_bucket', name: 'bucket', type: 'text', required: true },
          { id: 'f_size', name: 'size', type: 'number', required: false },
          { id: 'f_mimetype', name: 'mimeType', type: 'text', required: false },
          { id: 'f_etag', name: 'etag', type: 'text', required: false },
          { id: 'f_url', name: 'url', type: 'url', required: false },
        ],
      },
    ],

    adminNavItems: [navItem],

    register(ctx: NodeStackPluginContext) {
      currentContext = ctx;
      // 1. Bind service into container
      ctx.bindService(Symbol.for('S3StorageService'), s3Service);

      const getScopedS3 = (req: FastifyRequest) => {
        const targetDb = (req as any).appScope?.db;
        const records = (req as any).appScope?.records || ctx.app.records;
        if (!targetDb || !(ctx.app.plugins as any)?.getEffectiveConfig) {
          return { service: s3Service, records };
        }
        const appConfig = (ctx.app.plugins as any).getEffectiveConfig('s3-storage', targetDb);
        const scopedService = new S3StorageService({
          ...options,
          ...appConfig,
        });
        return { service: scopedService, records };
      };

      // 2. Register custom endpoints
      ctx.registerRoute('GET', '/api/s3/status', async (req, reply) => {
        const { service: activeS3 } = getScopedS3(req);
        const isConfigured = activeS3.isConfigured();
        const effectiveBucket = activeS3.options.bucket || '';
        const effectiveRegion = activeS3.options.region || 'us-east-1';

        if (!isConfigured) {
          return reply.status(400).send({
            statusCode: 400,
            configured: false,
            connected: false,
            bucket: '',
            region: effectiveRegion,
            message:
              'S3 Cloud Storage is not configured. Please configure your S3 Bucket Name in extension settings or S3_BUCKET environment variable.',
          });
        }

        return reply.status(200).send({
          configured: true,
          connected: true,
          bucket: effectiveBucket,
          region: effectiveRegion,
          endpoint: activeS3.getBucketEndpoint(),
          collection: collectionName,
        });
      });

      ctx.registerRoute(
        'POST',
        '/api/s3/sign-upload-url',
        async (req: FastifyRequest, reply: FastifyReply) => {
          const { service: activeS3, records } = getScopedS3(req);
          if (!activeS3.isConfigured()) {
            return reply.status(400).send({
              statusCode: 400,
              error: 'Bad Request',
              message:
                'S3 Cloud Storage is not configured. Please configure your S3 Bucket Name in extension settings or S3_BUCKET environment variable before generating presigned URLs.',
            });
          }

          const body = (req.body as any) || {};
          const filename = body.filename || `file_${Date.now()}.bin`;
          const mimeType = body.mimeType || 'application/octet-stream';

          try {
            const presigned = activeS3.getPresignedUploadUrl(filename, mimeType, {
              expiresIn: body.expiresIn ? Number(body.expiresIn) : undefined,
              key: body.key,
            });

            const effectiveBucket = activeS3.options.bucket || '';

            // Record entry in system collection
            try {
              await records.create(collectionName, {
                key: presigned.key,
                bucket: effectiveBucket,
                mimeType,
                url: activeS3.getObjectUrl(presigned.key),
              });
            } catch (e: any) {
              // ignore duplicate or non-fatal
            }

            return reply.status(200).send(presigned);
          } catch (err: any) {
            const statusCode =
              typeof err.status === 'number' && err.status >= 400 && err.status < 600
                ? err.status
                : 400;
            return reply.status(statusCode).send({
              statusCode,
              error: 'Bad Request',
              message: err.message || 'Failed to generate presigned upload URL',
            });
          }
        },
        { auth: options.authPolicy || 'admin' }
      );
    },

    onDestroy() {
      currentContext = null;
    },
  };
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const awsS3Plugin = s3StoragePlugin;
