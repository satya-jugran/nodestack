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
  private _baseDir?: string;

  constructor(
    private config?: ConfigService | { storageDir: string } | string,
    private customStorageDir?: string
  ) {
    if (typeof config === 'string') {
      this._baseDir = config;
    }
  }

  public get baseDir(): string {
    if (this._baseDir) {
      return this._baseDir;
    }
    if (this.customStorageDir) {
      return this.customStorageDir;
    }
    if (this.config) {
      if (typeof this.config === 'string') {
        return this.config;
      }
      if (typeof (this.config as any).storageDir === 'string') {
        return (this.config as any).storageDir;
      }
    }
    return '';
  }

  public set baseDir(dir: string) {
    this._baseDir = dir;
    this.customStorageDir = dir;
  }

  public get storageDir(): string {
    return this.baseDir;
  }

  public validatePathComponent(component: string, name = 'Path component'): string {
    if (component === undefined || component === null || typeof component !== 'string') {
      throw new AppError(`Invalid ${name}: must be a non-empty string`, 400);
    }
    if (
      component.includes('\0') ||
      component.includes('/') ||
      component.includes('\\') ||
      component === '.' ||
      component === '..' ||
      component.includes('..')
    ) {
      throw new AppError(
        `Invalid ${name} format: '${component}' contains prohibited path traversal characters`,
        400
      );
    }
    const safe = component.trim();
    if (safe === '') {
      throw new AppError(`Invalid ${name}: cannot be empty`, 400);
    }
    return safe;
  }

  private sanitizeId(id: string, name = 'ID'): string {
    this.validatePathComponent(id, name);
    const safe = id.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(safe)) {
      throw new AppError(`Invalid ${name} format: '${id}' contains prohibited path traversal characters`, 400);
    }
    return safe;
  }

  private isContained(targetPath: string): boolean {
    if (typeof targetPath !== 'string' || targetPath.includes('\0')) {
      return false;
    }
    const resolvedBase = path.resolve(this.baseDir);
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
   * Safely retrieve a stored file buffer with strict path traversal validation.
   */
  public async retrieve(
    appId: string,
    collection: string,
    recordId: string,
    filename: string
  ): Promise<Buffer>;
  public async retrieve(
    collection: string,
    recordId: string,
    filename: string
  ): Promise<Buffer>;
  public async retrieve(
    arg1: string,
    arg2: string,
    arg3: string,
    arg4?: string
  ): Promise<Buffer> {
    const components = arg4 !== undefined ? [arg1, arg2, arg3, arg4] : [arg1, arg2, arg3];
    const componentNames =
      arg4 !== undefined
        ? ['appId', 'collection', 'recordId', 'filename']
        : ['collection', 'recordId', 'filename'];

    // 1. Validate all path components for /, \, .., null bytes
    for (let i = 0; i < components.length; i++) {
      this.validatePathComponent(components[i], componentNames[i]);
    }

    // 2. Use path.resolve() and verify the result starts with this.baseDir
    const resolvedBase = path.resolve(this.baseDir);
    const filePath = path.resolve(this.baseDir, ...components);
    const resolvedBaseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;

    if (filePath !== resolvedBase && !filePath.startsWith(resolvedBaseWithSep)) {
      throw new AppError('Path traversal detected in target file path', 400);
    }

    const rel = path.relative(resolvedBase, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new AppError('Path traversal detected in target file path', 400);
    }

    if (!fs.existsSync(filePath)) {
      throw new NotFoundError(`File '${components[components.length - 1]}' not found`);
    }

    return fs.promises.readFile(filePath);
  }

  /**
   * Safely store a file buffer with strict path traversal validation.
   */
  public async store(
    appId: string,
    collection: string,
    recordId: string,
    filename: string,
    data: Buffer | string
  ): Promise<string>;
  public async store(
    collection: string,
    recordId: string,
    filename: string,
    data: Buffer | string
  ): Promise<string>;
  public async store(
    arg1: string,
    arg2: string,
    arg3: string,
    arg4: Buffer | string | string,
    arg5?: Buffer | string
  ): Promise<string> {
    let components: string[];
    let componentNames: string[];
    let data: Buffer | string;

    if (arg5 !== undefined) {
      components = [arg1, arg2, arg3, arg4 as string];
      componentNames = ['appId', 'collection', 'recordId', 'filename'];
      data = arg5;
    } else {
      components = [arg1, arg2, arg3];
      componentNames = ['collection', 'recordId', 'filename'];
      data = arg4 as (Buffer | string);
    }

    // 1. Validate all path components for /, \, .., null bytes
    for (let i = 0; i < components.length; i++) {
      this.validatePathComponent(components[i], componentNames[i]);
    }

    // 2. Use path.resolve() and verify the result starts with this.baseDir
    const resolvedBase = path.resolve(this.baseDir);
    const filePath = path.resolve(this.baseDir, ...components);
    const resolvedBaseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;

    if (filePath !== resolvedBase && !filePath.startsWith(resolvedBaseWithSep)) {
      throw new AppError('Path traversal detected in target file path', 400);
    }

    const rel = path.relative(resolvedBase, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new AppError('Path traversal detected in target file path', 400);
    }

    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, data);

    return filePath;
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
    this.validatePathComponent(filename, 'filename');
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
    this.validatePathComponent(filename, 'filename');
    const safeFilename = path.basename(filename);
    if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
      throw new NotFoundError(`File '${filename}' not found`);
    }
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
    try {
      const safeCol = this.sanitizeId(collectionId, 'collectionId');
      const safeRec = this.sanitizeId(recordId, 'recordId');
      this.validatePathComponent(filename, 'filename');
      const safeFilename = path.basename(filename);
      const filePath = path.join(this.storageDir, safeCol, safeRec, safeFilename);
      if (this.isContained(filePath) && fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err: any) {
      if (err instanceof AppError && err.statusCode === 400) {
        return;
      }
      throw err;
    }
  }

  /**
   * Delete all files for a record
   */
  public async deleteRecordFiles(collectionId: string, recordId: string): Promise<void> {
    try {
      const safeCol = this.sanitizeId(collectionId, 'collectionId');
      const safeRec = this.sanitizeId(recordId, 'recordId');
      const dir = path.join(this.storageDir, safeCol, safeRec);
      if (this.isContained(dir) && fs.existsSync(dir)) {
        await fs.promises.rm(dir, { recursive: true, force: true });
      }
    } catch (err: any) {
      if (err instanceof AppError && err.statusCode === 400) {
        return;
      }
      throw err;
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
