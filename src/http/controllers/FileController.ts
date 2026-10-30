import { FastifyRequest, FastifyReply } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { BaseController } from './BaseController';
import { FileStorageService } from '../../files/FileStorageService';
import { SchemaService } from '../../schema/SchemaService';
import { RuleEngine } from '../../rules/RuleEngine';
import { DatabaseService } from '../../database/DatabaseService';
import { ForbiddenError, NotFoundError } from '../../core/errors/AppError';
import { FakerEngine } from '../../records/FakerEngine';

export class FileController extends BaseController {
  constructor(
    private fileStorageService: FileStorageService,
    private schemaService: SchemaService,
    private ruleEngine: RuleEngine,
    private db: DatabaseService
  ) {
    super();
  }

  private getFiles(req: any): FileStorageService {
    return req?.appScope?.files || this.fileStorageService;
  }

  private getSchema(req: any): SchemaService {
    return req?.appScope?.schema || this.schemaService;
  }

  private getRuleEngine(req: any): RuleEngine {
    return req?.appScope?.ruleEngine || this.ruleEngine;
  }

  private getDb(req: any): DatabaseService {
    return req?.appScope?.db || this.db;
  }

  public async getFile(
    req: FastifyRequest<{
      Params: { collection: string; recordId: string; filename: string };
      Querystring: { download?: string; token?: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection, recordId, filename } = req.params;
    const schema = this.getSchema(req);
    const db = this.getDb(req);
    const ruleEngine = this.getRuleEngine(req);
    const files = this.getFiles(req);

    // Validate parameters at boundary
    if (!recordId || !/^[a-zA-Z0-9_-]+$/.test(recordId.trim())) {
      throw new NotFoundError(`Record '${recordId}' not found`);
    }

    const safeFilename = path.basename(filename);
    if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
      throw new NotFoundError(`File '${filename}' not found`);
    }

    const col = schema.getCollectionOrThrow(collection);

    // Rule check: verify view access to the record owning this file
    const record = db.get<any>(`SELECT * FROM "${col.name}" WHERE id = ?`, [recordId]);
    if (!record) {
      throw new NotFoundError(`Record '${recordId}' not found`);
    }

    if (!ruleEngine.evaluate(col.viewRule, { auth: req.auth, record })) {
      throw new ForbiddenError('You are not allowed to view this file');
    }

    // Collect all filenames declared in file fields on this record
    const declaredFilenames = new Set<string>();
    const fileFields = col.schema.filter((f) => f.type === 'file');

    for (const field of fileFields) {
      const val = record[field.name];
      if (!val) continue;

      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                if (typeof item === 'string' && item) {
                  declaredFilenames.add(path.basename(item));
                }
              }
            }
          } catch {
            declaredFilenames.add(path.basename(trimmed));
          }
        } else {
          declaredFilenames.add(path.basename(trimmed));
        }
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string' && item) {
            declaredFilenames.add(path.basename(item));
          }
        }
      }
    }

    if (typeof record.avatar === 'string' && record.avatar) {
      declaredFilenames.add(path.basename(record.avatar.trim()));
    }

    const isDeclared = declaredFilenames.has(safeFilename);

    let filePath: string;
    try {
      filePath = files.getFilePath(col.id, recordId, filename);
    } catch (err) {
      // Dynamic healing: ONLY heal if requested filename matches a declared file field on this record!
      if (isDeclared && (safeFilename.startsWith('avatar_') || safeFilename.startsWith('image_'))) {
        const safeName = record.name || record.title || safeFilename;
        const isPng = safeFilename.toLowerCase().endsWith('.png');
        const buf = isPng
          ? FakerEngine.generateLocalPngAvatar(safeName, safeFilename)
          : FakerEngine.generateLocalSvgAvatar(safeName, safeFilename);

        filePath = await files.writeRecordFile(col.id, recordId, safeFilename, buf);
      } else {
        throw err;
      }
    }

    if (req.query.download === '1') {
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    }

    const ext = filename.lastIndexOf('.') !== -1 ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.json': 'application/json',
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
    };
    if (mimeMap[ext]) {
      reply.type(mimeMap[ext]);
    }

    const stream = fs.createReadStream(filePath);
    return reply.send(stream);
  }
}
