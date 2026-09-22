import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../database/DatabaseService';
import { SchemaService } from '../schema/SchemaService';
import { RuleEngine } from '../rules/RuleEngine';
import { EventBus } from '../core/events/EventBus';
import { RealtimeService } from '../realtime/RealtimeService';
import { FileStorageService } from '../files/FileStorageService';
import { QueryFilterParser } from './QueryFilterParser';
import { CsvHelper } from './CsvHelper';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../core/errors/AppError';
import { CollectionModel } from '../schema/models/Collection';
import { SchemaField } from '../schema/models/Field';

export interface ListResult<T = any> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

export interface QueryOptions {
  page?: number;
  perPage?: number;
  sort?: string;
  filter?: string;
  expand?: string;
  fields?: string;
}

export interface ExportResult {
  data: string;
  mimeType: string;
  filename: string;
}

export interface ImportOptions {
  continueOnError?: boolean;
}

export interface ImportResult {
  success: boolean;
  total: number;
  imported: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
}

export class RecordService {
  constructor(
    private db: DatabaseService,
    private schemaService: SchemaService,
    private ruleEngine: RuleEngine,
    private eventBus: EventBus,
    private realtimeService: RealtimeService,
    private fileStorageService: FileStorageService
  ) {}

  public async getList(
    collectionName: string,
    options: QueryOptions = {},
    auth?: any
  ): Promise<ListResult> {
    const col = this.schemaService.getCollectionOrThrow(collectionName);

    // Rule check: listRule
    if (!this.ruleEngine.evaluate(col.listRule, { auth, query: options })) {
      throw new ForbiddenError(`You are not allowed to list records in '${collectionName}'`);
    }

    const page = Math.max(1, Number(options.page) || 1);
    const perPage = Math.min(500, Math.max(1, Number(options.perPage) || 30));
    const offset = (page - 1) * perPage;

    const allowedFields = new Set(col.schema.map((f) => f.name));
    const { clause: whereClause, params: filterParams } = QueryFilterParser.parseFilter(
      options.filter,
      allowedFields
    );
    const orderClause = QueryFilterParser.parseSort(options.sort, allowedFields);

    // Count query
    const countSql = `SELECT COUNT(*) as count FROM "${col.name}" ${whereClause}`;
    const totalRow = this.db.get<any>(countSql, filterParams);
    const totalItems = totalRow?.count || 0;
    const totalPages = Math.ceil(totalItems / perPage);

    // Records query
    const querySql = `SELECT * FROM "${col.name}" ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
    const queryParams = [...filterParams, perPage, offset];
    const rawItems = this.db.all<any>(querySql, queryParams);

    // Sanitize and expand
    const items = await Promise.all(
      rawItems.map(async (item) => {
        const clean = this.sanitizeRecord(item, col, auth);
        if (options.expand) {
          await this.expandRecord(clean, col, options.expand, auth);
        }
        return clean;
      })
    );

    return {
      page,
      perPage,
      totalItems,
      totalPages,
      items,
    };
  }

  public async getOne(
    collectionName: string,
    id: string,
    options: QueryOptions = {},
    auth?: any
  ): Promise<Record<string, any>> {
    const col = this.schemaService.getCollectionOrThrow(collectionName);
    const raw = this.db.get<any>(`SELECT * FROM "${col.name}" WHERE id = ?`, [id]);

    if (!raw) {
      throw new NotFoundError(`Record with id '${id}' not found in '${collectionName}'`);
    }

    // Rule check: viewRule
    if (!this.ruleEngine.evaluate(col.viewRule, { auth, record: raw, query: options })) {
      throw new ForbiddenError(`You are not allowed to view this record in '${collectionName}'`);
    }

    const clean = this.sanitizeRecord(raw, col, auth);
    if (options.expand) {
      await this.expandRecord(clean, col, options.expand, auth);
    }

    return clean;
  }

  public async create(
    collectionName: string,
    data: Record<string, any>,
    auth?: any,
    httpContext?: any
  ): Promise<Record<string, any>> {
    const col = this.schemaService.getCollectionOrThrow(collectionName);

    // Rule check: createRule
    if (!this.ruleEngine.evaluate(col.createRule, { auth, data })) {
      throw new ForbiddenError(`You are not allowed to create records in '${collectionName}'`);
    }

    // Lifecycle hook: onRecordBeforeCreate
    const processedData = await this.eventBus.triggerRecordBeforeCreate(
      col.name,
      data,
      auth,
      httpContext
    );

    const id = processedData.id || `r_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    // Prepare fields
    const recordToInsert: Record<string, any> = {
      id,
      created: now,
      updated: now,
    };

    // Auth collection specific fields
    if (col.type === 'auth') {
      if (!processedData.email) {
        throw new ValidationError('Email is required for auth records');
      }
      if (!processedData.password || processedData.password.length < 8) {
        throw new ValidationError('Password must be at least 8 characters long');
      }

      // Check unique email
      const existing = this.db.get<any>(`SELECT id FROM "${col.name}" WHERE email = ?`, [
        processedData.email.trim().toLowerCase(),
      ]);
      if (existing) {
        throw new ConflictError(`Email '${processedData.email}' is already registered`);
      }

      recordToInsert.email = processedData.email.trim().toLowerCase();
      recordToInsert.emailVisibility = processedData.emailVisibility ? 1 : 0;
      recordToInsert.verified = processedData.verified ? 1 : 0;
      recordToInsert.passwordHash = await bcrypt.hash(processedData.password, 10);
      recordToInsert.tokenKey = crypto.randomBytes(16).toString('hex');
    }

    // Validate and map schema fields
    for (const field of col.schema) {
      const val = processedData[field.name];
      this.validateField(field, val);
      recordToInsert[field.name] = this.normalizeFieldValue(field, val);
    }

    // Insert into DB
    const columns = Object.keys(recordToInsert).map((k) => `"${k}"`);
    const placeholders = Object.keys(recordToInsert).map(() => '?');
    const values = Object.values(recordToInsert);

    const sql = `INSERT INTO "${col.name}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;

    this.db.run(sql, values);

    const insertedRecord = this.sanitizeRecord(recordToInsert, col, auth, true);

    // Lifecycle hook: onRecordAfterCreate
    await this.eventBus.triggerRecordAfterCreate(col.name, insertedRecord, auth, httpContext);

    // Broadcast realtime event
    this.realtimeService.broadcast('create', col.name, insertedRecord);

    return insertedRecord;
  }

  public async update(
    collectionName: string,
    id: string,
    data: Record<string, any>,
    auth?: any,
    httpContext?: any
  ): Promise<Record<string, any>> {
    const col = this.schemaService.getCollectionOrThrow(collectionName);
    const current = this.db.get<any>(`SELECT * FROM "${col.name}" WHERE id = ?`, [id]);

    if (!current) {
      throw new NotFoundError(`Record '${id}' not found in '${collectionName}'`);
    }

    // Rule check: updateRule
    if (!this.ruleEngine.evaluate(col.updateRule, { auth, record: current, data })) {
      throw new ForbiddenError(`You are not allowed to update this record in '${collectionName}'`);
    }

    // Lifecycle hook: onRecordBeforeUpdate
    const processedData = await this.eventBus.triggerRecordBeforeUpdate(
      col.name,
      { ...current, ...data },
      auth,
      httpContext
    );

    const now = new Date().toISOString();
    const updates: Record<string, any> = {
      updated: now,
    };

    // Auth fields update
    if (col.type === 'auth') {
      if (processedData.password) {
        if (processedData.password.length < 8) {
          throw new ValidationError('Password must be at least 8 characters long');
        }
        updates.passwordHash = await bcrypt.hash(processedData.password, 10);
        updates.tokenKey = crypto.randomBytes(16).toString('hex');
      }
      if (processedData.email && processedData.email !== current.email) {
        const cleanEmail = processedData.email.trim().toLowerCase();
        const existing = this.db.get<any>(`SELECT id FROM "${col.name}" WHERE email = ? AND id != ?`, [
          cleanEmail,
          id,
        ]);
        if (existing) {
          throw new ConflictError(`Email '${cleanEmail}' is already registered`);
        }
        updates.email = cleanEmail;
      }
      if (processedData.emailVisibility !== undefined) {
        updates.emailVisibility = processedData.emailVisibility ? 1 : 0;
      }
      if (processedData.verified !== undefined) {
        updates.verified = processedData.verified ? 1 : 0;
      }
    }

    // Schema fields update
    for (const field of col.schema) {
      if (Object.prototype.hasOwnProperty.call(processedData, field.name)) {
        const val = processedData[field.name];
        this.validateField(field, val);
        updates[field.name] = this.normalizeFieldValue(field, val);
      }
    }

    const setClauses = Object.keys(updates).map((k) => `"${k}" = ?`);
    const values = [...Object.values(updates), id];
    const sql = `UPDATE "${col.name}" SET ${setClauses.join(', ')} WHERE id = ?`;

    this.db.run(sql, values);

    const updatedRaw = this.db.get<any>(`SELECT * FROM "${col.name}" WHERE id = ?`, [id]);
    const updatedRecord = this.sanitizeRecord(updatedRaw, col, auth);

    // Lifecycle hook: onRecordAfterUpdate
    await this.eventBus.triggerRecordAfterUpdate(col.name, updatedRecord, auth, httpContext);

    // Broadcast realtime event
    this.realtimeService.broadcast('update', col.name, updatedRecord);

    return updatedRecord;
  }

  public async delete(
    collectionName: string,
    id: string,
    auth?: any,
    httpContext?: any
  ): Promise<void> {
    const col = this.schemaService.getCollectionOrThrow(collectionName);
    const current = this.db.get<any>(`SELECT * FROM "${col.name}" WHERE id = ?`, [id]);

    if (!current) {
      throw new NotFoundError(`Record '${id}' not found in '${collectionName}'`);
    }

    // Rule check: deleteRule
    if (!this.ruleEngine.evaluate(col.deleteRule, { auth, record: current })) {
      throw new ForbiddenError(`You are not allowed to delete this record in '${collectionName}'`);
    }

    // Lifecycle hook: onRecordBeforeDelete
    await this.eventBus.triggerRecordBeforeDelete(col.name, current, auth, httpContext);

    // Remove record files
    await this.fileStorageService.deleteRecordFiles(col.id, id);

    this.db.run(`DELETE FROM "${col.name}" WHERE id = ?`, [id]);

    const deletedRecord = this.sanitizeRecord(current, col, auth);

    // Lifecycle hook: onRecordAfterDelete
    await this.eventBus.triggerRecordAfterDelete(col.name, deletedRecord, auth, httpContext);

    // Broadcast realtime event
    this.realtimeService.broadcast('delete', col.name, deletedRecord);
  }

  public async exportRecords(
    collectionName: string,
    format: 'csv' | 'json',
    options: QueryOptions = {},
    auth?: any
  ): Promise<ExportResult> {
    const col = this.schemaService.getCollectionOrThrow(collectionName);

    // Rule check: listRule
    if (!this.ruleEngine.evaluate(col.listRule, { auth, query: options })) {
      throw new ForbiddenError(`You are not allowed to export records from '${collectionName}'`);
    }

    const allowedFields = new Set(col.schema.map((f) => f.name));
    const { clause: whereClause, params: filterParams } = QueryFilterParser.parseFilter(
      options.filter,
      allowedFields
    );
    const orderClause = QueryFilterParser.parseSort(options.sort, allowedFields);

    const querySql = `SELECT * FROM "${col.name}" ${whereClause} ${orderClause}`;
    const rawItems = this.db.all<any>(querySql, filterParams);

    const items = await Promise.all(
      rawItems.map(async (item) => {
        const clean = this.sanitizeRecord(item, col, auth);
        if (options.expand) {
          await this.expandRecord(clean, col, options.expand, auth);
        }
        return clean;
      })
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'csv') {
      const headers: string[] = ['id'];
      if (col.type === 'auth') {
        headers.push('email', 'verified', 'emailVisibility');
      }
      for (const field of col.schema) {
        headers.push(field.name);
      }
      headers.push('created', 'updated');

      const csvData = CsvHelper.serialize(headers, items);

      return {
        data: csvData,
        mimeType: 'text/csv; charset=utf-8',
        filename: `${col.name}_${timestamp}.csv`,
      };
    } else {
      return {
        data: JSON.stringify(items, null, 2),
        mimeType: 'application/json; charset=utf-8',
        filename: `${col.name}_${timestamp}.json`,
      };
    }
  }

  public async importRecords(
    collectionName: string,
    records: Array<Record<string, any>>,
    auth?: any,
    options: ImportOptions = {},
    httpContext?: any
  ): Promise<ImportResult> {
    const col = this.schemaService.getCollectionOrThrow(collectionName);

    // Rule check: createRule
    if (!this.ruleEngine.evaluate(col.createRule, { auth })) {
      throw new ForbiddenError(`You are not allowed to create records in '${collectionName}'`);
    }

    if (!Array.isArray(records) || records.length === 0) {
      return {
        success: true,
        total: 0,
        imported: 0,
        failed: 0,
        errors: [],
      };
    }

    const continueOnError = options.continueOnError ?? true;
    const errors: Array<{ row: number; error: string }> = [];
    const validPreparedRecords: Array<{ rawData: Record<string, any>; insertData: Record<string, any> }> = [];

    // Pre-validate records
    for (let i = 0; i < records.length; i++) {
      const rowNumber = i + 1;
      const data = records[i];

      if (!data || typeof data !== 'object') {
        errors.push({ row: rowNumber, error: 'Row is not a valid object' });
        if (!continueOnError) {
          throw new ValidationError(`Row ${rowNumber}: Invalid record format`);
        }
        continue;
      }

      try {
        const id = data.id && String(data.id).trim() ? String(data.id).trim() : `r_${crypto.randomBytes(6).toString('hex')}`;
        const now = new Date().toISOString();
        const created = data.created && !isNaN(Date.parse(data.created)) ? new Date(data.created).toISOString() : now;
        const updated = data.updated && !isNaN(Date.parse(data.updated)) ? new Date(data.updated).toISOString() : now;

        const recordToInsert: Record<string, any> = {
          id,
          created,
          updated,
        };

        if (col.type === 'auth') {
          if (!data.email || !String(data.email).trim()) {
            throw new ValidationError('Email is required for auth records');
          }
          const email = String(data.email).trim().toLowerCase();
          // Check unique email in DB
          const existing = this.db.get<any>(`SELECT id FROM "${col.name}" WHERE email = ?`, [email]);
          if (existing && existing.id !== id) {
            throw new ConflictError(`Email '${email}' is already registered`);
          }

          // Check duplicate in the current import batch
          const alreadyInBatch = validPreparedRecords.some((r) => r.insertData.email === email);
          if (alreadyInBatch) {
            throw new ConflictError(`Duplicate email '${email}' in import batch`);
          }

          recordToInsert.email = email;
          recordToInsert.emailVisibility =
            data.emailVisibility === true || data.emailVisibility === 'true' || data.emailVisibility === 1 ? 1 : 0;
          recordToInsert.verified =
            data.verified === true || data.verified === 'true' || data.verified === 1 ? 1 : 0;
          const password = data.password ? String(data.password) : crypto.randomBytes(8).toString('hex');
          recordToInsert.passwordHash = bcrypt.hashSync(password, 10);
          recordToInsert.tokenKey = crypto.randomBytes(16).toString('hex');
        }

        // Validate and normalize schema fields
        for (const field of col.schema) {
          const val = data[field.name];
          this.validateField(field, val);
          recordToInsert[field.name] = this.normalizeFieldValue(field, val);
        }

        validPreparedRecords.push({ rawData: data, insertData: recordToInsert });
      } catch (err: any) {
        errors.push({ row: rowNumber, error: err.message || String(err) });
        if (!continueOnError) {
          throw err;
        }
      }
    }

    if (validPreparedRecords.length === 0) {
      return {
        success: errors.length === 0,
        total: records.length,
        imported: 0,
        failed: errors.length,
        errors,
      };
    }

    // Insert inside SQLite transaction for speed and integrity
    const insertedRecords: Array<Record<string, any>> = [];
    this.db.transaction(() => {
      for (const item of validPreparedRecords) {
        const recordToInsert = item.insertData;
        const columns = Object.keys(recordToInsert).map((k) => `"${k}"`);
        const placeholders = Object.keys(recordToInsert).map(() => '?');
        const values = Object.values(recordToInsert);

        const sql = `INSERT INTO "${col.name}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
        this.db.run(sql, values);

        const sanitized = this.sanitizeRecord(recordToInsert, col, auth, true);
        insertedRecords.push(sanitized);
      }
    });

    // Trigger lifecycle hooks & broadcast realtime
    for (const rec of insertedRecords) {
      this.eventBus.triggerRecordAfterCreate(col.name, rec, auth, httpContext).catch(() => {});
      this.realtimeService.broadcast('create', col.name, rec);
    }

    return {
      success: errors.length === 0,
      total: records.length,
      imported: insertedRecords.length,
      failed: errors.length,
      errors,
    };
  }

  private validateField(field: SchemaField, value: any): void {
    if (field.required && (value === undefined || value === null || value === '')) {
      throw new ValidationError(`Field '${field.name}' is required`);
    }

    if (value === undefined || value === null || value === '') {
      return;
    }

    if (field.type === 'number' && isNaN(Number(value))) {
      throw new ValidationError(`Field '${field.name}' must be a valid number`);
    }

    if (field.type === 'select' && field.options?.values) {
      if (!field.options.values.includes(String(value))) {
        throw new ValidationError(`Invalid value for select field '${field.name}'. Allowed: ${field.options.values.join(', ')}`);
      }
    }
  }

  private normalizeFieldValue(field: SchemaField, value: any): any {
    if (value === undefined || value === null || (value === '' && field.type !== 'text')) {
      if (field.type === 'bool') {
        return field.defaultValue ? 1 : 0;
      }
      return field.defaultValue !== undefined ? field.defaultValue : null;
    }

    switch (field.type) {
      case 'bool':
        return value === true || value === 'true' || value === 1 || value === '1' ? 1 : 0;
      case 'number':
        return Number(value);
      case 'json':
        return typeof value === 'string' ? value : JSON.stringify(value);
      default:
        return String(value);
    }
  }

  private sanitizeRecord(
    raw: Record<string, any>,
    col: CollectionModel,
    auth?: any,
    isOwner = false
  ): Record<string, any> {
    const clean = { ...raw };

    // Format booleans
    for (const field of col.schema) {
      if (field.type === 'bool' && clean[field.name] !== undefined) {
        clean[field.name] = Boolean(clean[field.name]);
      }
      if (field.type === 'json' && typeof clean[field.name] === 'string') {
        try {
          clean[field.name] = JSON.parse(clean[field.name]);
        } catch {
          // keep as string
        }
      }
    }

    // Hide auth internal fields
    if (col.type === 'auth') {
      delete clean.passwordHash;
      delete clean.tokenKey;
      clean.verified = Boolean(clean.verified);
      clean.emailVisibility = Boolean(clean.emailVisibility);

      // If emailVisibility is false and not owner or admin, mask email
      if (!clean.emailVisibility && !isOwner && auth?.id !== clean.id && !auth?.isAdmin) {
        delete clean.email;
      }
    }

    return clean;
  }

  private async expandRecord(
    record: Record<string, any>,
    col: CollectionModel,
    expandStr: string,
    auth?: any
  ): Promise<void> {
    const expandFields = expandStr.split(',').map((s) => s.trim()).filter(Boolean);
    const expandMap: Record<string, any> = {};

    for (const fieldName of expandFields) {
      const field = col.schema.find((f) => f.name === fieldName);
      if (field && field.type === 'relation' && field.options?.collectionId) {
        const relatedCol = this.schemaService.getCollection(field.options.collectionId);
        const relatedId = record[fieldName];
        if (relatedCol && relatedId) {
          try {
            const relRecord = await this.getOne(relatedCol.name, relatedId, {}, auth);
            expandMap[fieldName] = relRecord;
          } catch {
            // ignore if relation is inaccessible
          }
        }
      }
    }

    if (Object.keys(expandMap).length > 0) {
      record.expand = expandMap;
    }
  }
}
