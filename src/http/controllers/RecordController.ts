import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { RecordService, QueryOptions } from '../../records/RecordService';
import { CsvHelper } from '../../records/CsvHelper';
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

  public async exportRecords(
    req: FastifyRequest<{ Params: { collection: string; format?: string }; Querystring: QueryOptions & { format?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection } = req.params;
    const formatParam = (req.params.format || req.query.format || 'csv').toLowerCase();
    const format: 'csv' | 'json' = formatParam === 'json' ? 'json' : 'csv';

    const result = await this.recordService.exportRecords(collection, format, req.query, req.auth);

    reply.header('Content-Type', result.mimeType);
    reply.header('Content-Disposition', `attachment; filename="${result.filename}"`);
    return reply.send(result.data);
  }

  public async importRecords(
    req: FastifyRequest<{ Params: { collection: string }; Querystring: { continueOnError?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection } = req.params;
    let records: Array<Record<string, any>> = [];
    let continueOnError = req.query?.continueOnError !== 'false';

    if (req.isMultipart && req.isMultipart()) {
      const parts = req.parts();
      let csvContent = '';
      for await (const part of parts) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          csvContent = buf.toString('utf-8');
        } else if (part.fieldname === 'continueOnError') {
          continueOnError = part.value === 'true';
        } else if (part.fieldname === 'records') {
          try {
            records = JSON.parse(part.value as string);
          } catch {}
        }
      }
      if (csvContent) {
        records = CsvHelper.parse(csvContent);
      }
    } else if (typeof req.body === 'string') {
      records = CsvHelper.parse(req.body);
    } else if (Array.isArray(req.body)) {
      records = req.body;
    } else if (req.body && typeof req.body === 'object') {
      const body = req.body as any;
      if (Array.isArray(body.records)) {
        records = body.records;
      }
      if (body.options?.continueOnError !== undefined) {
        continueOnError = Boolean(body.options.continueOnError);
      }
    }

    const result = await this.recordService.importRecords(
      collection,
      records,
      req.auth,
      { continueOnError },
      req
    );

    this.ok(reply, result, 200);
  }
}
