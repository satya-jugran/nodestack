import * as crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { INodeStackPlugin, NodeStackPluginContext } from '../core/plugins/types';

export interface AlgoliaPluginOptions {
  appId: string;
  apiKey: string;
  indexPrefix?: string;
  collections: string[];
  collectionName?: string;
  /** Authentication policy for reindex endpoint: 'admin' (default), 'adminOrInitial', 'user', or 'public' */
  authPolicy?: 'admin' | 'adminOrInitial' | 'user' | 'public';
}

export class AlgoliaSyncService {
  public syncedOperations: Array<{ action: string; collection: string; objectId: string; timestamp: string }> = [];

  constructor(public readonly options: AlgoliaPluginOptions) {}

  public getIndexName(collection: string): string {
    const prefix = this.options.indexPrefix || 'nodestack_';
    return `${prefix}${collection}`;
  }

  public recordSync(action: 'save' | 'delete', collection: string, objectId: string) {
    const entry = {
      action,
      collection,
      objectId,
      timestamp: new Date().toISOString(),
    };
    this.syncedOperations.push(entry);
    return entry;
  }
}

export function algoliaPlugin(options: AlgoliaPluginOptions): INodeStackPlugin {
  if (!options || !options.appId || !options.apiKey) {
    throw new Error('[algoliaPlugin] Missing required options: appId and apiKey');
  }

  const algoliaService = new AlgoliaSyncService(options);
  const collectionName = options.collectionName || '_algolia_sync_queue';
  const targetCollections = options.collections || [];

  return {
    name: 'algolia',
    version: '1.0.0',
    description: 'Algolia search index synchronization & mutation indexing queue',

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
      // 1. Bind service into container
      ctx.bindService(Symbol.for('AlgoliaSyncService'), algoliaService);

      const handleIndex = async (action: 'save' | 'delete', e: any) => {
        if (!targetCollections.includes(e.collection)) return;
        const indexName = algoliaService.getIndexName(e.collection);
        const objectId = e.record?.id || '';

        algoliaService.recordSync(action, e.collection, objectId);

        try {
          await ctx.app.records.create(collectionName, {
            indexName,
            collection: e.collection,
            objectId,
            operation: action,
            status: 'queued',
          });
        } catch (err: any) {
          // non-fatal
        }
      };

      // 2. Lifecycle hooks
      ctx.registerHook('afterCreate', (e: any) => handleIndex('save', e));
      ctx.registerHook('afterUpdate', (e: any) => handleIndex('save', e));
      ctx.registerHook('afterDelete', (e: any) => handleIndex('delete', e));

      // 3. REST endpoints
      ctx.registerRoute('GET', '/api/algolia/status', async (_req, reply) => {
        return reply.send({
          appId: options.appId,
          collections: targetCollections,
          queueCollection: collectionName,
          syncedCount: algoliaService.syncedOperations.length,
        });
      });

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

          const countResult = ctx.app.db.get<any>(`SELECT COUNT(*) as cnt FROM "${col}"`);
          const total = countResult?.cnt || 0;

          return reply.status(200).send({
            success: true,
            collection: col,
            indexName: algoliaService.getIndexName(col),
            recordsQueued: total,
          });
        },
        { auth: options.authPolicy || 'admin' }
      );
    },
  };
}
