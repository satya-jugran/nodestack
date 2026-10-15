import * as crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { INodeStackPlugin, NodeStackPluginContext } from '../core/plugins/types';

export interface AlgoliaPluginOptions {
  appId?: string;
  apiKey?: string;
  indexPrefix?: string;
  collections?: string[];
  collectionName?: string;
  /** Authentication policy for reindex endpoint: 'admin' (default), 'adminOrInitial', 'user', or 'public' */
  authPolicy?: 'admin' | 'adminOrInitial' | 'user' | 'public';
  /** Optional custom base endpoint (e.g. proxy or mock server) */
  endpoint?: string;
  /** Custom fetch implementation (defaults to globalThis.fetch) */
  fetch?: typeof fetch;
  /** Run in dry-run mode without making outbound network calls */
  dryRun?: boolean;
  /** Background worker polling interval in milliseconds (default: 0 = disabled) */
  autoProcessIntervalMs?: number;
}

export interface AlgoliaOperationResult {
  success: boolean;
  taskId?: number | string;
  objectID?: string;
  error?: string;
}

export class AlgoliaSyncService {
  public options: AlgoliaPluginOptions;
  public syncedOperations: Array<{
    action: string;
    collection: string;
    objectId: string;
    timestamp: string;
    status: 'synced' | 'failed' | 'queued';
    taskId?: string | number;
    error?: string;
  }> = [];
  public isProcessingQueue: boolean = false;

  constructor(options: AlgoliaPluginOptions = {}) {
    this.options = { ...options };
  }

  public updateOptions(newOpts: Partial<AlgoliaPluginOptions>): void {
    this.options = { ...this.options, ...newOpts };
  }

  public getIndexName(collection: string): string {
    const prefix = this.options.indexPrefix || 'nodestack_';
    return `${prefix}${collection}`;
  }

  public getBaseUrl(): string {
    if (this.options.endpoint) {
      return this.options.endpoint.replace(/\/+$/, '');
    }
    return `https://${this.options.appId || 'app'}-dsn.algolia.net`;
  }

  public getHeaders(): Record<string, string> {
    return {
      'X-Algolia-Application-Id': this.options.appId || '',
      'X-Algolia-API-Key': this.options.apiKey || '',
      'Content-Type': 'application/json',
    };
  }

  public async request<T = any>(path: string, method: string = 'GET', body?: any): Promise<T> {
    if (this.options.dryRun) {
      return {
        taskID: Math.floor(Math.random() * 1000000),
        objectID: body?.objectID || (Array.isArray(body?.requests) ? body.requests.length : 1),
        updatedAt: new Date().toISOString(),
      } as any;
    }

    const fetchFn = this.options.fetch || globalThis.fetch;
    if (!fetchFn) {
      throw new Error('[AlgoliaSyncService] Global fetch is not available');
    }

    const url = `${this.getBaseUrl()}${path.startsWith('/') ? path : '/' + path}`;
    const res = await fetchFn(url, {
      method,
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Algolia API error (${res.status} ${res.statusText}): ${errText}`);
    }

    return (await res.json()) as T;
  }

  public async saveObject(
    indexName: string,
    objectId: string,
    record: Record<string, any>
  ): Promise<AlgoliaOperationResult> {
    const cleanRecord = { ...record };
    delete cleanRecord.passwordHash;
    delete cleanRecord.tokenKey;

    try {
      const res = await this.request(
        `/1/indexes/${encodeURIComponent(indexName)}/${encodeURIComponent(objectId)}`,
        'PUT',
        { ...cleanRecord, objectID: objectId }
      );
      return { success: true, taskId: res?.taskID, objectID: objectId };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  public async deleteObject(indexName: string, objectId: string): Promise<AlgoliaOperationResult> {
    try {
      const res = await this.request(
        `/1/indexes/${encodeURIComponent(indexName)}/${encodeURIComponent(objectId)}`,
        'DELETE'
      );
      return { success: true, taskId: res?.taskID, objectID: objectId };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  public async batch(
    indexName: string,
    requests: Array<{ action: 'updateObject' | 'addObject' | 'deleteObject'; body?: any; objectID?: string }>
  ): Promise<{ success: boolean; taskId?: any; processed: number; error?: string }> {
    if (!requests || requests.length === 0) {
      return { success: true, processed: 0 };
    }

    try {
      const res = await this.request(
        `/1/indexes/${encodeURIComponent(indexName)}/batch`,
        'POST',
        { requests }
      );
      return { success: true, taskId: res?.taskID, processed: requests.length };
    } catch (err: any) {
      return { success: false, processed: 0, error: err.message || String(err) };
    }
  }

  public recordSync(
    action: 'save' | 'delete',
    collection: string,
    objectId: string,
    status: 'synced' | 'failed' | 'queued' = 'queued',
    details?: { taskId?: string | number; error?: string }
  ) {
    const entry = {
      action,
      collection,
      objectId,
      status,
      timestamp: new Date().toISOString(),
      ...(details || {}),
    };
    this.syncedOperations.push(entry);
    return entry;
  }

  public async submitMutation(
    action: 'save' | 'delete',
    collection: string,
    objectId: string,
    record?: Record<string, any>
  ): Promise<AlgoliaOperationResult> {
    const indexName = this.getIndexName(collection);
    let result: AlgoliaOperationResult;

    if (action === 'delete') {
      result = await this.deleteObject(indexName, objectId);
    } else {
      result = await this.saveObject(indexName, objectId, record || { id: objectId });
    }

    this.recordSync(
      action,
      collection,
      objectId,
      result.success ? 'synced' : 'failed',
      { taskId: result.taskId, error: result.error }
    );

    return result;
  }

  public async processQueue(app: any, limit: number = 50): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (this.isProcessingQueue) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }
    this.isProcessingQueue = true;
    try {
      const queueCollection = this.options.collectionName || '_algolia_sync_queue';
      let items: any[] = [];
      try {
        items =
          app.db.all(
            `SELECT * FROM "${queueCollection}" WHERE status IN ('queued', 'failed') ORDER BY created ASC LIMIT ?`,
            [limit]
          ) || [];
      } catch {
        return { processed: 0, succeeded: 0, failed: 0 };
      }

      let succeeded = 0;
      let failed = 0;

      for (const item of items) {
        let record: any = null;
        if (item.operation !== 'delete') {
          try {
            record = app.db.get(`SELECT * FROM "${item.collection}" WHERE id = ?`, [item.objectId]);
            if (!record) {
              item.operation = 'delete';
            }
          } catch {
            // ignore
          }
        }

        const result = await this.submitMutation(
          item.operation as 'save' | 'delete',
          item.collection,
          item.objectId,
          record
        );

        try {
          await app.records.update(queueCollection, item.id, {
            status: result.success ? 'synced' : 'failed',
            error: result.error || null,
            taskId: result.taskId ? String(result.taskId) : null,
          });
        } catch {
          // ignore
        }

        if (result.success) {
          succeeded++;
        } else {
          failed++;
        }
      }

      return { processed: items.length, succeeded, failed };
    } finally {
      this.isProcessingQueue = false;
    }
  }
}

export function algoliaPlugin(options: AlgoliaPluginOptions = {}): INodeStackPlugin {
  const appId = options?.appId || process.env.ALGOLIA_APP_ID || '';
  const apiKey = options?.apiKey || process.env.ALGOLIA_API_KEY || '';
  const algoliaService = new AlgoliaSyncService({ ...options, appId, apiKey });
  const collectionName = options?.collectionName || '_algolia_sync_queue';
  const targetCollections = options?.collections || [];
  let timer: any = null;
  let currentContext: NodeStackPluginContext | null = null;
  let currentIntervalMs: number =
    options?.autoProcessIntervalMs !== undefined
      ? Number(options.autoProcessIntervalMs)
      : (process.env.ALGOLIA_SYNC_INTERVAL_MS ? Number(process.env.ALGOLIA_SYNC_INTERVAL_MS) : 0);

  const reconcileTimer = (interval?: number) => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const ms = interval !== undefined ? Number(interval) : currentIntervalMs;
    currentIntervalMs = Number.isFinite(ms) ? ms : 0;

    if (currentContext && currentIntervalMs > 0) {
      timer = setInterval(() => {
        algoliaService.processQueue(currentContext!.app).catch(() => {});
      }, currentIntervalMs);
      if (timer.unref) {
        timer.unref();
      }
    }
  };

  return {
    name: 'algolia',
    version: '1.0.0',
    description: 'Algolia search index synchronization & mutation indexing queue',

    codeOptions: { ...(options || {}) },
    configSchema: {
      fields: [
        {
          name: 'appId',
          label: 'Application ID',
          type: 'text',
          envKey: 'ALGOLIA_APP_ID',
          placeholder: 'latency or DEMO_APP',
          description: 'Algolia unique Application ID',
          required: true,
        },
        {
          name: 'apiKey',
          label: 'Admin API Key',
          type: 'password',
          envKey: 'ALGOLIA_API_KEY',
          placeholder: 'Write/Admin API Key',
          description: 'Algolia Admin API key with write permissions',
          required: true,
        },
        {
          name: 'indexPrefix',
          label: 'Index Prefix',
          type: 'text',
          envKey: 'ALGOLIA_INDEX_PREFIX',
          defaultValue: 'nodestack_',
          placeholder: 'nodestack_',
          description: 'Prefix prepended to collection names for index naming',
        },
        {
          name: 'autoProcessIntervalMs',
          label: 'Sync Queue Interval (ms)',
          type: 'number',
          envKey: 'ALGOLIA_SYNC_INTERVAL_MS',
          defaultValue: 5000,
          description: 'Background polling interval in ms for syncing mutation queues',
        },
        {
          name: 'dryRun',
          label: 'Dry Run Mode',
          type: 'boolean',
          defaultValue: false,
          description: 'Track operations in SQLite queue without sending outbound requests to Algolia',
        },
      ],
    },
    onConfigUpdate(newConfig) {
      algoliaService.updateOptions(newConfig);
      if (newConfig && newConfig.autoProcessIntervalMs !== undefined) {
        reconcileTimer(newConfig.autoProcessIntervalMs);
      }
    },

    collections: [
      {
        name: collectionName,
        type: 'base',
        system: true,
        schema: [
          { id: 'f_index', name: 'indexName', type: 'text', required: true },
          { id: 'f_col', name: 'collection', type: 'text', required: true },
          { id: 'f_obj_id', name: 'objectId', type: 'text', required: true },
          { id: 'f_op', name: 'operation', type: 'text', required: true },
          { id: 'f_status', name: 'status', type: 'text', required: true },
          { id: 'f_error', name: 'error', type: 'text', required: false },
          { id: 'f_task_id', name: 'taskId', type: 'text', required: false },
        ],
      },
    ],

    adminNavItems: [
      {
        id: 'algolia',
        title: 'Algolia Search',
        badge: 'SYNC',
        badgeVariant: 'primary',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
        view: {
          title: 'Algolia Search Sync',
          description: `Indexing collections: ${targetCollections.join(', ')}`,
        },
      },
    ],

    register(ctx: NodeStackPluginContext) {
      currentContext = ctx;
      // 1. Bind service into container
      ctx.bindService(Symbol.for('AlgoliaSyncService'), algoliaService);

      const handleIndex = async (action: 'save' | 'delete', e: any) => {
        if (!targetCollections.includes(e.collection)) return;
        const indexName = algoliaService.getIndexName(e.collection);
        const objectId = e.record?.id || '';

        // 1. Create durable queue entry
        let queueRecord: any = null;
        try {
          queueRecord = await ctx.app.records.create(collectionName, {
            indexName,
            collection: e.collection,
            objectId,
            operation: action,
            status: 'queued',
          });
        } catch (err: any) {
          // non-fatal
        }

        // 2. Submit mutation to Algolia
        const result = await algoliaService.submitMutation(action, e.collection, objectId, e.record);

        // 3. Update durable queue entry status
        if (queueRecord?.id) {
          try {
            await ctx.app.records.update(collectionName, queueRecord.id, {
              status: result.success ? 'synced' : 'failed',
              error: result.error || null,
              taskId: result.taskId ? String(result.taskId) : null,
            });
          } catch (err: any) {
            // non-fatal
          }
        }
      };

      // 2. Lifecycle hooks
      ctx.registerHook('afterCreate', (e: any) => handleIndex('save', e));
      ctx.registerHook('afterUpdate', (e: any) => handleIndex('save', e));
      ctx.registerHook('afterDelete', (e: any) => handleIndex('delete', e));

      // 3. Background durable queue consumer
      reconcileTimer(currentIntervalMs);

      // 4. REST endpoints
      ctx.registerRoute('GET', '/api/algolia/status', async (_req, reply) => {
        return reply.send({
          appId: algoliaService.options.appId,
          collections: targetCollections,
          queueCollection: collectionName,
          syncedCount: algoliaService.syncedOperations.length,
          endpoint: algoliaService.getBaseUrl(),
          autoProcessIntervalMs: currentIntervalMs,
          workerActive: timer !== null,
        });
      });

      ctx.registerRoute(
        'POST',
        '/api/algolia/process-queue',
        async (_req: FastifyRequest, reply: FastifyReply) => {
          const result = await algoliaService.processQueue(ctx.app);
          return reply.status(200).send({
            success: true,
            ...result,
          });
        },
        { auth: options.authPolicy || 'admin' }
      );

      ctx.registerRoute(
        'POST',
        '/api/algolia/reindex',
        async (req: FastifyRequest, reply: FastifyReply) => {
          const body = (req.body as any) || {};
          const col = body.collection;
          if (!col || !targetCollections.includes(col)) {
            return reply.status(400).send({
              statusCode: 400,
              message: `collection must be one of: ${targetCollections.join(', ')}`,
            });
          }

          const records = ctx.app.db.all<any>(`SELECT * FROM "${col}"`) || [];
          const indexName = algoliaService.getIndexName(col);

          if (records.length === 0) {
            return reply.status(200).send({
              success: true,
              collection: col,
              indexName,
              recordsQueued: 0,
              recordsSynced: 0,
            });
          }

          // Build batch payload for Algolia
          const batchRequests = records.map((record) => {
            const safeRecord = { ...record };
            delete safeRecord.passwordHash;
            delete safeRecord.tokenKey;
            return {
              action: 'updateObject' as const,
              body: {
                ...safeRecord,
                objectID: record.id,
              },
            };
          });

          // Create queued entries in durable queue
          for (const record of records) {
            try {
              await ctx.app.records.create(collectionName, {
                indexName,
                collection: col,
                objectId: record.id,
                operation: 'save',
                status: 'queued',
              });
            } catch {
              // ignore
            }
          }

          // Submit batch to Algolia
          const batchResult = await algoliaService.batch(indexName, batchRequests);

          // Update status of queued items in DB
          if (batchResult.success) {
            try {
              ctx.app.db.prepare(
                `UPDATE "${collectionName}" SET status = 'synced', taskId = ? WHERE collection = ? AND status = 'queued'`
              ).run(batchResult.taskId ? String(batchResult.taskId) : null, col);
            } catch {
              // ignore
            }
            for (const r of records) {
              algoliaService.recordSync('save', col, r.id, 'synced', { taskId: batchResult.taskId });
            }
          } else {
            try {
              ctx.app.db.prepare(
                `UPDATE "${collectionName}" SET status = 'failed', error = ? WHERE collection = ? AND status = 'queued'`
              ).run(batchResult.error || 'Batch sync failed', col);
            } catch {
              // ignore
            }
          }

          return reply.status(200).send({
            success: batchResult.success,
            collection: col,
            indexName,
            recordsQueued: records.length,
            recordsSynced: batchResult.success ? records.length : 0,
            taskId: batchResult.taskId,
            error: batchResult.error,
          });
        },
        { auth: options.authPolicy || 'admin' }
      );
    },

    onDestroy() {
      reconcileTimer(0);
      currentContext = null;
    },
  };
}
