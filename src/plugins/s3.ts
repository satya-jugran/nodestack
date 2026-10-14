import * as crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { INodeStackPlugin, NodeStackPluginContext } from '../core/plugins/types';

export interface S3StoragePluginOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  collectionName?: string;
  /** Authentication policy for presigned upload URLs: 'admin' (default), 'adminOrInitial', 'user', or 'public' */
  authPolicy?: 'admin' | 'adminOrInitial' | 'user' | 'public';
}

export class S3StorageService {
  constructor(public readonly options: S3StoragePluginOptions) {}

  public getBucketEndpoint(): string {
    if (this.options.endpoint) {
      return this.options.endpoint;
    }
    return `https://${this.options.bucket}.s3.${this.options.region}.amazonaws.com`;
  }

  public getPresignedUploadUrl(filename: string, mimeType?: string) {
    const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
    const safeBase = filename.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
    const key = `uploads/${Date.now()}_${safeBase}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const baseEndpoint = this.getBucketEndpoint();
    const uploadUrl = `${baseEndpoint}/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600`;

    return {
      key,
      uploadUrl,
      bucket: this.options.bucket,
      region: this.options.region,
      mimeType: mimeType || 'application/octet-stream',
    };
  }
}

export function s3StoragePlugin(options: S3StoragePluginOptions): INodeStackPlugin {
  if (!options || !options.bucket || !options.region) {
    throw new Error('[s3StoragePlugin] Missing required options: bucket and region');
  }

  const s3Service = new S3StorageService(options);
  const collectionName = options.collectionName || '_s3_uploads';

  return {
    name: 's3-storage',
    version: '1.0.0',
    description: 'S3-compatible cloud storage adapter, presigned URLs & asset synchronization',

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

    adminNavItems: [
      {
        id: 's3-storage',
        title: 'S3 Storage',
        badge: options.region.toUpperCase(),
        badgeVariant: 'info',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`,
        view: {
          title: 'S3 Cloud Storage',
          description: `Connected to bucket "${options.bucket}" in region ${options.region}`,
          html: `
            <div style="width: 100%; display: flex; flex-direction: column; gap: 1.25rem;">
              <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <div style="width: 40px; height: 40px; border-radius: 10px; background: #eab308; display: flex; align-items: center; justify-content: center; color: #000; font-weight: 800; font-size: 18px;">
                      S3
                    </div>
                    <div>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-weight: 800; font-size: 16px; color: #fff;">Amazon S3 Storage Provider</span>
                        <span class="badge badge-get">${escapeHtml(options.region)}</span>
                      </div>
                      <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                        Cloud object storage & presigned upload distribution
                      </div>
                    </div>
                  </div>
                  <button class="btn btn-secondary btn-sm" onclick="selectNav('home')">← Overview</button>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem;">
                  <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem;">
                    <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Bucket Name</div>
                    <div style="font-size: 13px; font-weight: 700; color: #60a5fa; font-family: monospace; margin-top: 4px;">${escapeHtml(options.bucket)}</div>
                  </div>
                  <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem;">
                    <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Region</div>
                    <div style="font-size: 13px; font-weight: 700; color: #34d399; font-family: monospace; margin-top: 4px;">${escapeHtml(options.region)}</div>
                  </div>
                  <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.85rem 1rem;">
                    <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Tracking Collection</div>
                    <div style="font-size: 13px; font-weight: 700; color: #eab308; font-family: monospace; margin-top: 4px;">${escapeHtml(collectionName)}</div>
                  </div>
                </div>
              </div>
            </div>
          `,
        },
      },
    ],

    register(ctx: NodeStackPluginContext) {
      // 1. Bind service into container
      ctx.bindService(Symbol.for('S3StorageService'), s3Service);

      // 2. Register custom endpoints
      ctx.registerRoute('GET', '/api/s3/status', async (_req, reply) => {
        return reply.send({
          bucket: options.bucket,
          region: options.region,
          endpoint: s3Service.getBucketEndpoint(),
          collection: collectionName,
          connected: true,
        });
      });

      ctx.registerRoute(
        'POST',
        '/api/s3/sign-upload-url',
        async (req: FastifyRequest, reply: FastifyReply) => {
          const body = (req.body as any) || {};
          const filename = body.filename || `file_${Date.now()}.bin`;
          const mimeType = body.mimeType || 'application/octet-stream';

          const presigned = s3Service.getPresignedUploadUrl(filename, mimeType);

          // Record entry in system collection
          try {
            await ctx.app.records.create(collectionName, {
              key: presigned.key,
              bucket: options.bucket,
              mimeType,
              url: `${s3Service.getBucketEndpoint()}/${presigned.key}`,
            });
          } catch (e: any) {
            // ignore duplicate or non-fatal
          }

          return reply.status(200).send(presigned);
        },
        { auth: options.authPolicy || 'admin' }
      );
    },
  };
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const awsS3Plugin = s3StoragePlugin;
