import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../database/DatabaseService';
import { SchemaService } from '../schema/SchemaService';
import { FileStorageService } from '../files/FileStorageService';
import { EventBus } from '../core/events/EventBus';
import { RealtimeService } from '../realtime/RealtimeService';
import { CollectionModel } from '../schema/models/Collection';
import { SchemaField } from '../schema/models/Field';
import { FakerEngine, FakerContext, GeneratedFilePayload } from './FakerEngine';
import { ValidationError, NotFoundError } from '../core/errors/AppError';

export interface MockGenerateOptions {
  count?: number;
  downloadFiles?: boolean;
  autoSeedRelations?: boolean;
}

export interface MockGenerateResult {
  success: boolean;
  count: number;
  collection: string;
  records: Array<Record<string, any>>;
}

export class MockDataService {
  constructor(
    private db: DatabaseService,
    private schemaService: SchemaService,
    private fileStorageService: FileStorageService,
    private eventBus: EventBus,
    private realtimeService: RealtimeService
  ) {}

  /**
   * Generates mock records for a given collection.
   */
  public async generate(
    collectionName: string,
    options: MockGenerateOptions = {},
    auth?: any,
    httpContext?: any,
    visitedCollections: Set<string> = new Set()
  ): Promise<MockGenerateResult> {
    const col = this.schemaService.getCollectionOrThrow(collectionName);
    const count = Math.max(1, Math.min(500, Number(options.count) || 25));
    const downloadFiles = options.downloadFiles !== false;
    const autoSeedRelations = options.autoSeedRelations !== false;

    visitedCollections.add(col.name);

    // 1. Build relation pool for all relation fields
    const relationPool = new Map<string, string[]>();
    for (const field of col.schema) {
      if (field.type === 'relation' && field.options?.collectionId) {
        const targetColIdOrName = field.options.collectionId;
        const targetCol = this.schemaService.getCollection(targetColIdOrName);

        if (targetCol) {
          // Fetch existing IDs from target collection
          let targetIds: string[] = [];
          try {
            const rows = this.db.all<{ id: string }>(
              `SELECT id FROM "${targetCol.name}" ORDER BY created DESC LIMIT 200`
            );
            targetIds = rows.map((r) => r.id);
          } catch {
            targetIds = [];
          }

          // If no records in referenced collection and autoSeedRelations is true, seed a small batch
          if (targetIds.length === 0 && autoSeedRelations && !visitedCollections.has(targetCol.name)) {
            try {
              const seedCount = Math.min(5, Math.max(3, Math.floor(count / 3)));
              const seedRes = await this.generate(
                targetCol.name,
                { count: seedCount, downloadFiles: false, autoSeedRelations: true },
                auth,
                httpContext,
                new Set(visitedCollections)
              );
              targetIds = seedRes.records.map((r) => r.id);
            } catch {
              targetIds = [];
            }
          }

          relationPool.set(targetCol.id, targetIds);
          relationPool.set(targetCol.name, targetIds);
          relationPool.set(targetColIdOrName, targetIds);
        }
      }
    }

    // 2. Synthesize records
    const preparedRecords: Array<{
      insertData: Record<string, any>;
      filePayloads: Array<{ fieldName: string; payload: GeneratedFilePayload }>;
    }> = [];

    const usedEmails = new Set<string>();

    for (let i = 0; i < count; i++) {
      const recordId = `r_${crypto.randomBytes(6).toString('hex')}`;
      const now = new Date(Date.now() - (count - i) * 60000).toISOString();

      const insertData: Record<string, any> = {
        id: recordId,
        created: now,
        updated: now,
      };

      const filePayloads: Array<{ fieldName: string; payload: GeneratedFilePayload }> = [];

      // Context for FakerEngine
      const context: FakerContext = {
        index: i,
        total: count,
        collectionName: col.name,
        recordId,
        downloadFiles,
        relationPool,
      };

      // Auth Collection Fields
      if (col.type === 'auth') {
        let email = FakerEngine.email();
        while (usedEmails.has(email)) {
          email = FakerEngine.email();
        }
        usedEmails.add(email);

        insertData.email = email;
        insertData.emailVisibility = 1;
        insertData.verified = 1;
        insertData.passwordHash = bcrypt.hashSync('NodeStack2026!', 10);
        insertData.tokenKey = crypto.randomBytes(16).toString('hex');
      }

      // Schema Fields
      for (const field of col.schema) {
        const { value, filePayload } = await FakerEngine.generateFieldValue(field, context, insertData);

        if (filePayload) {
          filePayloads.push({ fieldName: field.name, payload: filePayload });
          insertData[field.name] = null;
        } else {
          // Normalize value based on field type
          insertData[field.name] = this.normalizeFieldValue(field, value);
        }
      }

      preparedRecords.push({ insertData, filePayloads });
    }

    // 3. Process & save files via FileStorageService
    for (const item of preparedRecords) {
      for (const { fieldName, payload } of item.filePayloads) {
        const field = col.schema.find((f) => f.name === fieldName);
        try {
          const saved = await this.fileStorageService.saveFile(
            col.id,
            item.insertData.id,
            payload.originalName,
            payload.buffer,
            payload.mimeType,
            field?.options
          );
          item.insertData[fieldName] = saved.filename;
        } catch (err: any) {
          console.warn(`[MockDataService] Failed to save file '${payload.originalName}' for field '${fieldName}':`, err?.message);
          item.insertData[fieldName] = null;
        }
      }
    }

    // 4. Insert records into SQLite within a transaction for maximum speed
    const insertedRecords: Array<Record<string, any>> = [];
    this.db.transaction(() => {
      for (const item of preparedRecords) {
        const data = item.insertData;
        const columns = Object.keys(data).map((k) => `"${k}"`);
        const placeholders = Object.keys(data).map(() => '?');
        const values = Object.values(data);

        const sql = `INSERT INTO "${col.name}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
        this.db.run(sql, values);

        insertedRecords.push(this.sanitizeRecord(data, col));
      }
    });

    // 5. Broadcast realtime events & trigger hooks asynchronously
    for (const rec of insertedRecords) {
      this.eventBus.triggerRecordAfterCreate(col.name, rec, auth, httpContext).catch(() => {});
      this.realtimeService.broadcast('create', col.name, rec);
    }

    return {
      success: true,
      count: insertedRecords.length,
      collection: col.name,
      records: insertedRecords,
    };
  }

  private normalizeFieldValue(field: SchemaField, value: any): any {
    if (value === undefined || value === null) {
      if (field.type === 'bool') return 0;
      return field.defaultValue !== undefined ? field.defaultValue : null;
    }

    switch (field.type) {
      case 'bool':
        return value === true || value === 1 || value === 'true' ? 1 : 0;
      case 'number':
        return Number(value);
      case 'json':
        return typeof value === 'string' ? value : JSON.stringify(value);
      default:
        return String(value);
    }
  }

  private sanitizeRecord(raw: Record<string, any>, col: CollectionModel): Record<string, any> {
    const clean = { ...raw };

    for (const field of col.schema) {
      if (field.type === 'bool' && clean[field.name] !== undefined) {
        clean[field.name] = Boolean(clean[field.name]);
      }
      if (field.type === 'json' && typeof clean[field.name] === 'string') {
        try {
          clean[field.name] = JSON.parse(clean[field.name]);
        } catch {}
      }
    }

    if (col.type === 'auth') {
      delete clean.passwordHash;
      delete clean.tokenKey;
      clean.verified = Boolean(clean.verified);
      clean.emailVisibility = Boolean(clean.emailVisibility);
    }

    return clean;
  }
}
