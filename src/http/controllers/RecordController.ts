import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { RecordService, QueryOptions } from '../../records/RecordService';
import { FileStorageService } from '../../files/FileStorageService';
import { SchemaService } from '../../schema/SchemaService';

export class RecordController extends BaseController {
  constructor(
    private recordService: RecordService,
    private schemaService: SchemaService,
    private fileStorageService: FileStorageService
  ) {
    super();
  }

  public async getList(
    req: FastifyRequest<{ Params: { collection: string }; Querystring: QueryOptions }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection } = req.params;
    const result = await this.recordService.getList(collection, req.query, req.auth);
    this.ok(reply, result);
  }

  public async getOne(
    req: FastifyRequest<{ Params: { collection: string; id: string }; Querystring: QueryOptions }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection, id } = req.params;
    const record = await this.recordService.getOne(collection, id, req.query, req.auth);
    this.ok(reply, record);
  }

  public async create(
    req: FastifyRequest<{ Params: { collection: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection } = req.params;
    const col = this.schemaService.getCollectionOrThrow(collection);

    let data: Record<string, any> = {};

    if (req.isMultipart && req.isMultipart()) {
      const parts = req.parts();
      const filesToProcess: Array<{ fieldName: string; filename: string; buffer: Buffer; mimetype: string }> = [];

      for await (const part of parts) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          if (part.filename && buffer.length > 0) {
            filesToProcess.push({
              fieldName: part.fieldname,
              filename: part.filename,
              buffer,
              mimetype: part.mimetype,
            });
          }
        } else {
          data[part.fieldname] = part.value;
        }
      }

      // Generate temp id or let recordService generate it
      const tempId = data.id || `r_${Math.random().toString(36).substring(2, 10)}`;
      data.id = tempId;

      // Process uploaded files
      for (const file of filesToProcess) {
        const schemaField = col.schema.find((f) => f.name === file.fieldName);
        const savedMeta = await this.fileStorageService.saveFile(
          col.id,
          tempId,
          file.filename,
          file.buffer,
          file.mimetype,
          schemaField?.options
        );
        data[file.fieldName] = savedMeta.filename;
      }
    } else {
      data = (req.body as any) || {};
    }

    const record = await this.recordService.create(collection, data, req.auth, req);
    this.ok(reply, record, 201);
  }

  public async update(
    req: FastifyRequest<{ Params: { collection: string; id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection, id } = req.params;
    const col = this.schemaService.getCollectionOrThrow(collection);

    let data: Record<string, any> = {};

    if (req.isMultipart && req.isMultipart()) {
      const parts = req.parts();
      const filesToProcess: Array<{ fieldName: string; filename: string; buffer: Buffer; mimetype: string }> = [];

      for await (const part of parts) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          if (part.filename && buffer.length > 0) {
            filesToProcess.push({
              fieldName: part.fieldname,
              filename: part.filename,
              buffer,
              mimetype: part.mimetype,
            });
          }
        } else {
          data[part.fieldname] = part.value;
        }
      }

      // Process uploaded files
      for (const file of filesToProcess) {
        const schemaField = col.schema.find((f) => f.name === file.fieldName);
        const savedMeta = await this.fileStorageService.saveFile(
          col.id,
          id,
          file.filename,
          file.buffer,
          file.mimetype,
          schemaField?.options
        );
        data[file.fieldName] = savedMeta.filename;
      }
    } else {
      data = (req.body as any) || {};
    }

    const record = await this.recordService.update(collection, id, data, req.auth, req);
    this.ok(reply, record);
  }

  public async delete(
    req: FastifyRequest<{ Params: { collection: string; id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection, id } = req.params;
    await this.recordService.delete(collection, id, req.auth, req);
    this.noContent(reply);
  }
}
