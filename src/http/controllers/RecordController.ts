import * as crypto from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { RecordService, QueryOptions } from '../../records/RecordService';
import { CsvHelper } from '../../records/CsvHelper';
import { FileStorageService } from '../../files/FileStorageService';
import { SchemaService } from '../../schema/SchemaService';
import { MockDataService, MockGenerateOptions } from '../../records/MockDataService';

export class RecordController extends BaseController {
  constructor(
    private recordService: RecordService,
    private schemaService: SchemaService,
    private fileStorageService: FileStorageService,
    private mockDataService?: MockDataService
  ) {
    super();
  }

  private getRecords(req: any): RecordService {
    return req?.appScope?.records || this.recordService;
  }

  private getSchema(req: any): SchemaService {
    return req?.appScope?.schema || this.schemaService;
  }

  private getFiles(req: any): FileStorageService {
    return req?.appScope?.files || this.fileStorageService;
  }

  private getMockData(req: any): MockDataService | undefined {
    return req?.appScope?.mockData || this.mockDataService;
  }

  public async getList(
    req: FastifyRequest<{ Params: { collection: string }; Querystring: QueryOptions }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection } = req.params;
    const records = this.getRecords(req);
    const result = await records.getList(collection, req.query, req.auth);
    this.ok(reply, result);
  }

  public async getOne(
    req: FastifyRequest<{ Params: { collection: string; id: string }; Querystring: QueryOptions }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection, id } = req.params;
    const records = this.getRecords(req);
    const record = await records.getOne(collection, id, req.query, req.auth);
    this.ok(reply, record);
  }

  public async create(
    req: FastifyRequest<{ Params: { collection: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection } = req.params;
    const schema = this.getSchema(req);
    const files = this.getFiles(req);
    const records = this.getRecords(req);
    const col = schema.getCollectionOrThrow(collection);

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
      const tempId = data.id && /^[a-zA-Z0-9_-]+$/.test(String(data.id))
        ? String(data.id)
        : `r_${crypto.randomBytes(4).toString('hex')}`;
      data.id = tempId;

      // Process uploaded files
      for (const file of filesToProcess) {
        const schemaField = col.schema.find((f) => f.name === file.fieldName);
        const savedMeta = await files.saveFile(
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

    const record = await records.create(collection, data, req.auth, req);
    this.ok(reply, record, 201);
  }

  public async update(
    req: FastifyRequest<{ Params: { collection: string; id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection, id } = req.params;
    const schema = this.getSchema(req);
    const files = this.getFiles(req);
    const records = this.getRecords(req);
    const col = schema.getCollectionOrThrow(collection);

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
        const savedMeta = await files.saveFile(
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

    const record = await records.update(collection, id, data, req.auth, req);
    this.ok(reply, record);
  }

  public async delete(
    req: FastifyRequest<{ Params: { collection: string; id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection, id } = req.params;
    const records = this.getRecords(req);
    await records.delete(collection, id, req.auth, req);
    this.noContent(reply);
  }

  public async exportRecords(
    req: FastifyRequest<{ Params: { collection: string; format?: string }; Querystring: QueryOptions & { format?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection } = req.params;
    const records = this.getRecords(req);
    const formatParam = (req.params.format || req.query.format || 'csv').toLowerCase();
    const format: 'csv' | 'json' = formatParam === 'json' ? 'json' : 'csv';

    const result = await records.exportRecords(collection, format, req.query, req.auth);

    reply.header('Content-Type', result.mimeType);
    reply.header('Content-Disposition', `attachment; filename="${result.filename}"`);
    return reply.send(result.data);
  }

  public async importRecords(
    req: FastifyRequest<{ Params: { collection: string }; Querystring: { continueOnError?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection } = req.params;
    const records = this.getRecords(req);
    let rows: Array<Record<string, any>> = [];
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
            rows = JSON.parse(part.value as string);
          } catch {}
        }
      }
      if (csvContent) {
        rows = CsvHelper.parse(csvContent);
      }
    } else if (typeof req.body === 'string') {
      rows = CsvHelper.parse(req.body);
    } else if (Array.isArray(req.body)) {
      rows = req.body;
    } else if (req.body && typeof req.body === 'object') {
      const body = req.body as any;
      if (Array.isArray(body.records)) {
        rows = body.records;
      }
      if (body.options?.continueOnError !== undefined) {
        continueOnError = Boolean(body.options.continueOnError);
      }
    }

    const result = await records.importRecords(
      collection,
      rows,
      req.auth,
      { continueOnError },
      req
    );

    this.ok(reply, result, 200);
  }

  public async generateMock(
    req: FastifyRequest<{
      Params: { collection: string };
      Body: { count?: number; options?: MockGenerateOptions } | null;
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const mockData = this.getMockData(req);
    if (!mockData) {
      return reply.status(500).send({ message: 'MockDataService is not initialized' });
    }

    const { collection } = req.params;
    const targetCol = this.getSchema(req).getCollection(collection);
    if (targetCol?.system || collection.startsWith('_')) {
      return this.error(reply, `Mock data generation is not allowed for system collection '${collection}'`, 400);
    }
    const body = (req.body as any) || {};
    const count = typeof body.count === 'number' ? body.count : Number(body.count) || 25;
    const options: MockGenerateOptions = {
      count,
      downloadFiles: body.options?.downloadFiles ?? body.downloadFiles ?? true,
      autoSeedRelations: body.options?.autoSeedRelations ?? body.autoSeedRelations ?? true,
    };

    const result = await mockData.generate(
      collection,
      options,
      req.auth,
      req
    );

    this.ok(reply, result, 201);
  }
}
