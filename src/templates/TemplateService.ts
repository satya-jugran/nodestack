import { DatabaseService } from '../database/DatabaseService';
import { SchemaService } from '../schema/SchemaService';
import { FileStorageService } from '../files/FileStorageService';
import { EventBus } from '../core/events/EventBus';
import { RealtimeService } from '../realtime/RealtimeService';
import { NotFoundError } from '../core/errors/AppError';
import { STARTER_TEMPLATES } from './definitions';
import {
  TemplateDefinition,
  TemplateSummary,
  ApplyTemplateOptions,
  ApplyTemplateResult,
  TemplateSeedContext,
  SeedRecordResult,
} from './types';

export class TemplateService {
  constructor(
    private db: DatabaseService,
    private schemaService: SchemaService,
    private fileStorageService: FileStorageService,
    private eventBus: EventBus,
    private realtimeService: RealtimeService
  ) {}

  /**
   * Returns list of all available starter templates
   */
  public list(): TemplateSummary[] {
    return STARTER_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      tagline: t.tagline,
      description: t.description,
      icon: t.icon,
      badge: t.badge,
      aliases: t.aliases,
      collections: t.collections.map((c) => c.name),
      stats: t.stats,
    }));
  }

  /**
   * Find a template by id or alias (case-insensitive)
   */
  public get(idOrAlias: string): TemplateDefinition | undefined {
    if (!idOrAlias) return undefined;
    const clean = idOrAlias.trim().toLowerCase().replace(/[\s_-]+/g, '');
    return STARTER_TEMPLATES.find((t) => {
      const matchId = t.id.toLowerCase().replace(/[\s_-]+/g, '') === clean;
      const matchAlias = t.aliases.some(
        (a) => a.toLowerCase().replace(/[\s_-]+/g, '') === clean
      );
      return matchId || matchAlias;
    });
  }

  /**
   * Find a template or throw NotFoundError
   */
  public getOrThrow(idOrAlias: string): TemplateDefinition {
    const template = this.get(idOrAlias);
    if (!template) {
      const available = STARTER_TEMPLATES.map((t) => t.id).join(', ');
      throw new NotFoundError(
        `Starter template '${idOrAlias}' not found. Available templates: ${available}`
      );
    }
    return template;
  }

  /**
   * Apply a starter template: creates collections, schemas, access rules, files, and seeded records
   */
  public async apply(
    idOrAlias: string,
    options: ApplyTemplateOptions = {}
  ): Promise<ApplyTemplateResult> {
    const startTime = Date.now();
    const template = this.getOrThrow(idOrAlias);

    const targetCollectionNames = template.collections.map((c) => c.name);

    // 1. Check existing collections
    const existingCollections = targetCollectionNames.map((name) =>
      this.schemaService.getCollection(name)
    );
    const allExist = existingCollections.every((c) => c !== undefined);

    if (allExist && !options.overwrite) {
      return {
        success: true,
        skipped: true,
        template: template.id,
        templateName: template.name,
        collections: targetCollectionNames,
        totalRecords: 0,
        totalImages: 0,
        durationMs: Date.now() - startTime,
        message: `Template '${template.name}' is already applied. Use overwrite option to re-create.`,
      };
    }

    // 2. If overwrite is requested, drop existing collections in reverse order
    if (options.overwrite) {
      for (const colDef of [...template.collections].reverse()) {
        const existing = this.schemaService.getCollection(colDef.name);
        if (existing) {
          try {
            await this.fileStorageService.deleteRecordFiles(existing.id, '');
          } catch {}
          try {
            this.schemaService.deleteCollection(existing.name);
          } catch {}
        }
      }
    }

    // 3. Create collections and build collectionIdMap
    const collectionIdMap = new Map<string, string>();

    for (const colDef of template.collections) {
      let col = this.schemaService.getCollection(colDef.name);

      if (!col) {
        // Clone DTO
        const dto = {
          ...colDef.dto,
          schema: (colDef.dto.schema || []).map((f) => {
            const fieldCopy = { ...f, options: { ...f.options } };
            // If field references a relation, resolve actual ID if available
            if (
              fieldCopy.type === 'relation' &&
              fieldCopy.options?.collectionId &&
              collectionIdMap.has(fieldCopy.options.collectionId)
            ) {
              fieldCopy.options.collectionId = collectionIdMap.get(
                fieldCopy.options.collectionId
              )!;
            }
            return fieldCopy;
          }),
        };

        col = this.schemaService.createCollection(dto);
      }

      collectionIdMap.set(colDef.name, col.id);
      collectionIdMap.set(col.id, col.id);
    }

    // 4. Seed records & files
    const seededRecordsMap = new Map<string, Array<Record<string, any>>>();
    const seedContext: TemplateSeedContext = {
      collectionIdMap,
      seededRecordsMap,
    };

    let totalRecords = 0;
    let totalImages = 0;

    for (const colDef of template.collections) {
      const col = this.schemaService.getCollectionOrThrow(colDef.name);

      // Check if table already has rows (skip seeding this collection if not overwriting)
      const existingCountRow = this.db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM "${col.name}"`
      );
      if (existingCountRow && existingCountRow.count > 0 && !options.overwrite) {
        const existingRows = this.db.all<any>(`SELECT * FROM "${col.name}" LIMIT 200`);
        seededRecordsMap.set(col.name, existingRows);
        continue;
      }

      const seedData = await colDef.seed(seedContext);
      const preparedRows: Array<Record<string, any>> = [];

      for (let i = 0; i < seedData.length; i++) {
        const item = seedData[i];
        let record: Record<string, any>;
        let files: Array<{ fieldName: string; filename: string; buffer: Buffer; mimeType: string }> = [];

        if ('record' in item) {
          record = { ...(item as SeedRecordResult).record };
          files = (item as SeedRecordResult).files || [];
        } else {
          record = { ...(item as Record<string, any>) };
        }

        const now = new Date(Date.now() - (seedData.length - i) * 60000).toISOString();
        if (!record.created) record.created = now;
        if (!record.updated) record.updated = now;

        // Process file assets
        for (const file of files) {
          try {
            const saved = await this.fileStorageService.saveFile(
              col.id,
              record.id,
              file.filename,
              file.buffer,
              file.mimeType
            );
            record[file.fieldName] = saved.filename;
            totalImages++;
          } catch (err: any) {
            console.warn(
              `[TemplateService] Could not save file '${file.filename}' for '${col.name}.${record.id}':`,
              err?.message
            );
          }
        }

        preparedRows.push(record);
      }

      // High-speed SQLite transaction insert
      if (preparedRows.length > 0) {
        const sampleRow = preparedRows[0];
        const columns = Object.keys(sampleRow);
        const placeholders = columns.map(() => '?').join(', ');
        const insertSql = `INSERT INTO "${col.name}" (${columns
          .map((c) => `"${c}"`)
          .join(', ')}) VALUES (${placeholders})`;
        const insertStmt = this.db.prepare(insertSql);

        this.db.transaction(() => {
          for (const row of preparedRows) {
            const values = columns.map((colName) =>
              row[colName] !== undefined ? row[colName] : null
            );
            insertStmt.run(...values);
          }
        });

        // Trigger events & SSE broadcast
        for (const rec of preparedRows) {
          this.eventBus.triggerRecordAfterCreate(col.name, rec).catch(() => {});
          this.realtimeService.broadcast('create', col.name, rec);
        }

        totalRecords += preparedRows.length;
        seededRecordsMap.set(col.name, preparedRows);
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      success: true,
      skipped: false,
      template: template.id,
      templateName: template.name,
      collections: targetCollectionNames,
      totalRecords,
      totalImages,
      durationMs,
      message: `Template '${template.name}' applied successfully (${targetCollectionNames.length} collections, ${totalRecords} records, ${totalImages} images in ${durationMs}ms)`,
    };
  }
}
