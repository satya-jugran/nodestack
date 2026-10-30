import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConfigService } from '../core/config/ConfigService';
import { AppError, NotFoundError } from '../core/errors/AppError';
import { FieldOptions } from '../schema/models/Field';

export interface SavedFileMeta {
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
}

export class FileStorageService {
  constructor(private config: ConfigService, private customStorageDir?: string) {}

  public get storageDir(): string {
    return this.customStorageDir || this.config.storageDir;
  }

  private sanitizeId(id: string, name = 'ID'): string {
    if (!id || typeof id !== 'string') {
      throw new AppError(`Invalid ${name}`, 400);
    }
    const safe = id.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(safe)) {
      throw new AppError(`Invalid ${name} format: '${id}' contains prohibited path traversal characters`, 400);
    }
    return safe;
  }

  private isContained(targetPath: string): boolean {
    const resolvedBase = path.resolve(this.storageDir);
    const resolvedTarget = path.resolve(targetPath);
    const resolvedBaseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
    const rel = path.relative(resolvedBase, resolvedTarget);
    return (
      (resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBaseWithSep)) &&
      !rel.startsWith('..') &&
      !path.isAbsolute(rel)
    );
  }

  /**
   * Save a buffer or stream to the storage directory
   */
  public async saveFile(
    collectionId: string,
    recordId: string,
    originalName: string,
    buffer: Buffer,
    mimeType: string,
    options?: FieldOptions
  ): Promise<SavedFileMeta> {
    // Validate size
    if (options?.maxSize && buffer.length > options.maxSize) {
      throw new AppError(`File exceeds maximum allowed size of ${options.maxSize} bytes`, 400);
    }

    // Validate mime type
    if (options?.mimeTypes && options.mimeTypes.length > 0) {
      if (!options.mimeTypes.includes(mimeType)) {
        throw new AppError(`Invalid file mime type: ${mimeType}. Allowed: ${options.mimeTypes.join(', ')}`, 400);
      }
    }

    const safeCol = this.sanitizeId(collectionId, 'collectionId');
    const safeRec = this.sanitizeId(recordId, 'recordId');
    const dir = path.join(this.storageDir, safeCol, safeRec);
    if (!this.isContained(dir)) {
      throw new AppError('Path traversal detected in record storage directory', 400);
    }
    await fs.promises.mkdir(dir, { recursive: true });

    const ext = path.extname(originalName) || '';
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const safeBaseName = path
      .basename(originalName, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 30);
    const filename = `${safeBaseName}_${randomSuffix}${ext}`;

    const filePath = path.join(dir, filename);
    if (!this.isContained(filePath)) {
      throw new AppError('Path traversal detected in target file path', 400);
    }
    await fs.promises.writeFile(filePath, buffer);

    return {
      filename,
      originalName,
      size: buffer.length,
      mimeType,
    };
  }

  /**
   * Directly write a file to a record's storage directory (e.g., dynamically generated avatars or assets)
   * with strict ID validation and containment checking.
   */
  public async writeRecordFile(
    collectionId: string,
    recordId: string,
    filename: string,
    buffer: Buffer
  ): Promise<string> {
    const safeCol = this.sanitizeId(collectionId, 'collectionId');
    const safeRec = this.sanitizeId(recordId, 'recordId');
    const safeFilename = path.basename(filename);
    if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
      throw new AppError('Invalid filename', 400);
    }

    const dir = path.join(this.storageDir, safeCol, safeRec);
    const filePath = path.join(dir, safeFilename);
    if (!this.isContained(filePath)) {
      throw new AppError('Path traversal detected in record file path', 400);
    }

    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
    return filePath;
  }

  /**
   * Get the absolute path to a stored file
   */
  public getFilePath(collectionId: string, recordId: string, filename: string): string {
    const safeCol = this.sanitizeId(collectionId, 'collectionId');
    const safeRec = this.sanitizeId(recordId, 'recordId');
    const safeFilename = path.basename(filename);
    const filePath = path.join(this.storageDir, safeCol, safeRec, safeFilename);
    if (!this.isContained(filePath) || !fs.existsSync(filePath)) {
      throw new NotFoundError(`File '${filename}' not found`);
    }
    return filePath;
  }

  /**
   * Delete a stored file
   */
  public async deleteFile(collectionId: string, recordId: string, filename: string): Promise<void> {
    const safeCol = this.sanitizeId(collectionId, 'collectionId');
    const safeRec = this.sanitizeId(recordId, 'recordId');
    const safeFilename = path.basename(filename);
    const filePath = path.join(this.storageDir, safeCol, safeRec, safeFilename);
    if (this.isContained(filePath) && fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }

  /**
   * Delete all files for a record
   */
  public async deleteRecordFiles(collectionId: string, recordId: string): Promise<void> {
    const safeCol = this.sanitizeId(collectionId, 'collectionId');
    const safeRec = this.sanitizeId(recordId, 'recordId');
    const dir = path.join(this.storageDir, safeCol, safeRec);
    if (this.isContained(dir) && fs.existsSync(dir)) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Delete all files for an entire collection
   */
  public async deleteCollectionFiles(collectionId: string): Promise<void> {
    const safeCol = this.sanitizeId(collectionId, 'collectionId');
    const dir = path.join(this.storageDir, safeCol);
    if (this.isContained(dir) && fs.existsSync(dir)) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }
}
