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

  public async getFile(
    req: FastifyRequest<{
      Params: { collection: string; recordId: string; filename: string };
      Querystring: { download?: string; token?: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { collection, recordId, filename } = req.params;
    const col = this.schemaService.getCollectionOrThrow(collection);

    // Rule check: verify view access to the record owning this file
    const record = this.db.get<any>(`SELECT * FROM "${col.name}" WHERE id = ?`, [recordId]);
    if (!record) {
      throw new NotFoundError(`Record '${recordId}' not found`);
    }

    if (!this.ruleEngine.evaluate(col.viewRule, { auth: req.auth, record })) {
      throw new ForbiddenError('You are not allowed to view this file');
    }

    let filePath: string;
    try {
      filePath = this.fileStorageService.getFilePath(col.id, recordId, filename);
    } catch (err) {
      // Dynamic healing: If requested file is a mock avatar or image that was missed, generate and save it on-the-fly!
      if (filename.startsWith('avatar_') || filename.startsWith('image_')) {
        const safeName = record.name || record.title || filename;
        const isPng = filename.toLowerCase().endsWith('.png');
        const buf = isPng
          ? FakerEngine.generateLocalPngAvatar(safeName, filename)
          : FakerEngine.generateLocalSvgAvatar(safeName, filename);

        const dir = path.join(this.fileStorageService.storageDir, col.id, recordId);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const safeFilename = path.basename(filename);
        const targetPath = path.join(dir, safeFilename);
        fs.writeFileSync(targetPath, buf);
        filePath = targetPath;
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
