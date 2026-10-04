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

  public async list(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const collections = this.schemaService.getAllCollections();
    this.ok(reply, {
      items: collections,
      totalItems: collections.length,
    });
  }

  public async getOne(
    req: FastifyRequest<{ Params: { collection: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const col = this.schemaService.getCollectionOrThrow(req.params.collection);
    this.ok(reply, col);
  }

  public async create(
    req: FastifyRequest<{ Body: CreateCollectionDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const col = this.schemaService.createCollection(req.body);
    this.ok(reply, col, 201);
  }

  public async update(
    req: FastifyRequest<{ Params: { collection: string }; Body: UpdateCollectionDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const col = this.schemaService.updateCollection(req.params.collection, req.body);
    this.ok(reply, col);
  }

  public async delete(
    req: FastifyRequest<{ Params: { collection: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    if (req.params.collection.startsWith('_')) {
      throw new AppError('Cannot delete system collection', 400);
    }
    const col = this.schemaService.getCollectionOrThrow(req.params.collection);
    this.schemaService.deleteCollection(req.params.collection);
    if (this.fileStorageService) {
      await this.fileStorageService.deleteCollectionFiles(col.id).catch(() => {});
    }
    this.noContent(reply);
  }


  public async inferSchema(
    req: FastifyRequest<{ Body: { data: any } }>,
    reply: FastifyReply
  ): Promise<void> {
    if (!this.schemaInferenceService) {
      throw new Error('SchemaInferenceService is not initialized');
    }
    const result = this.schemaInferenceService.inferSchema(req.body?.data);
    this.ok(reply, result);
  }

  public async importJson(
    req: FastifyRequest<{ Body: ImportJsonOptions }>,
    reply: FastifyReply
  ): Promise<void> {
    if (!this.schemaInferenceService) {
      throw new Error('SchemaInferenceService is not initialized');
    }
    const result = await this.schemaInferenceService.importJson(req.body);
    this.ok(reply, result, 201);
  }
}
