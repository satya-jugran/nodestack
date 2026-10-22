import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { SchemaService } from '../../schema/SchemaService';
import { SchemaInferenceService, ImportJsonOptions } from '../../schema/SchemaInferenceService';
import { CreateCollectionDto, UpdateCollectionDto } from '../../schema/models/Collection';
import { FileStorageService } from '../../files/FileStorageService';
import { AppError } from '../../core/errors/AppError';

export class CollectionController extends BaseController {
  constructor(
    private schemaService: SchemaService,
    private schemaInferenceService?: SchemaInferenceService,
    private fileStorageService?: FileStorageService
  ) {
    super();
  }

  private getSchema(req: any): SchemaService {
    return req?.appScope?.schema || this.schemaService;
  }

  private getFiles(req: any): FileStorageService | undefined {
    return req?.appScope?.files || this.fileStorageService;
  }

  private getInference(req: any): SchemaInferenceService | undefined {
    if (req?.appScope) {
      return new SchemaInferenceService(req.appScope.db, req.appScope.schema, req.appScope.realtime);
    }
    return this.schemaInferenceService;
  }

  public async list(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const schema = this.getSchema(req);
    const collections = schema.getAllCollections();
    this.ok(reply, {
      items: collections,
      totalItems: collections.length,
    });
  }

  public async getOne(
    req: FastifyRequest<{ Params: { collection: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const schema = this.getSchema(req);
    const col = schema.getCollectionOrThrow(req.params.collection);
    this.ok(reply, col);
  }

  public async create(
    req: FastifyRequest<{ Body: CreateCollectionDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const schema = this.getSchema(req);
    const col = schema.createCollection(req.body);
    this.ok(reply, col, 201);
  }

  public async update(
    req: FastifyRequest<{ Params: { collection: string }; Body: UpdateCollectionDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const schema = this.getSchema(req);
    const col = schema.updateCollection(req.params.collection, req.body);
    this.ok(reply, col);
  }

  public async delete(
    req: FastifyRequest<{ Params: { collection: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    if (req.params.collection.startsWith('_')) {
      throw new AppError('Cannot delete system collection', 400);
    }
    const schema = this.getSchema(req);
    const files = this.getFiles(req);
    const col = schema.getCollectionOrThrow(req.params.collection);
    // Clean storage files before dropping the collection to prevent orphaned files
    if (files) {
      try {
        await files.deleteCollectionFiles(col.id);
      } catch (err: any) {
        throw new AppError(
          `Failed to delete storage files for collection '${req.params.collection}': ${err.message}. Aborting deletion to prevent orphaned data.`,
          500
        );
      }
    }
    schema.deleteCollection(req.params.collection);
    this.noContent(reply);
  }

  public async inferSchema(
    req: FastifyRequest<{ Body: { data: any } }>,
    reply: FastifyReply
  ): Promise<void> {
    const inference = this.getInference(req);
    if (!inference) {
      throw new Error('SchemaInferenceService is not initialized');
    }
    const result = inference.inferSchema(req.body?.data);
    this.ok(reply, result);
  }

  public async importJson(
    req: FastifyRequest<{ Body: ImportJsonOptions }>,
    reply: FastifyReply
  ): Promise<void> {
    const inference = this.getInference(req);
    if (!inference) {
      throw new Error('SchemaInferenceService is not initialized');
    }
    const result = await inference.importJson(req.body);
    this.ok(reply, result, 201);
  }
}
