import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { SchemaService } from './SchemaService';
import { RealtimeService } from '../realtime/RealtimeService';
import { CollectionModel, CollectionType } from './models/Collection';
import { SchemaField, FieldType } from './models/Field';
import { AppError, ConflictError, ValidationError } from '../core/errors/AppError';

/**
 * Checks whether a given string is a valid ISO 8601 or standard date string.
 */
export function isDateString(val: any): boolean {
  if (typeof val !== 'string') return false;
  const str = val.trim();
  if (str.length < 8 || str.length > 35) return false;
  // Disallow pure digits, e.g. "12345678" or decimal numbers
  if (/^\d+(\.\d+)?$/.test(str)) return false;
  // Regex for ISO 8601, YYYY-MM-DD, YYYY/MM/DD, etc.
  const dateRegex = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;
  if (!dateRegex.test(str)) return false;
  const parsed = Date.parse(str);
  return !isNaN(parsed);
}

/**
 * Infers the NodeStack FieldType (text, number, bool, date, json)
 * from a list of collected values for a specific field.
 */
export function inferFieldType(values: any[]): FieldType {
  const nonNull = values.filter((v) => v !== undefined && v !== null && v !== '');
  if (nonNull.length === 0) {
    return 'text';
  }

  // 1. JSON: if any non-null value is an object or array
  const hasObjectOrArray = nonNull.some((v) => typeof v === 'object');
  if (hasObjectOrArray) {
    return 'json';
  }

  // 2. Bool: if all values are booleans (or strict boolean strings)
  const allBool = nonNull.every((v) => typeof v === 'boolean' || v === 'true' || v === 'false');
  if (allBool) {
    return 'bool';
  }

  // 3. Number: if all values are finite numbers or clean numeric values
  const allNumber = nonNull.every((v) => {
    if (typeof v === 'number') {
      return !isNaN(v) && isFinite(v);
    }
    if (typeof v === 'string') {
      const s = v.trim();
      return /^-?\d+(\.\d+)?$/.test(s) && !/^0\d+/.test(s);
    }
    return false;
  });
  if (allNumber) {
    return 'number';
  }

  // 4. Date: if all values are valid date strings
  const allDate = nonNull.every((v) => isDateString(v));
  if (allDate) {
    return 'date';
  }

  // 5. Default to text
  return 'text';
}

/**
 * Cleans a raw JSON key into a valid SQLite / NodeStack field identifier.
 */
export function sanitizeFieldName(rawKey: string, existingNames: Set<string>): string {
  let clean = rawKey
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');

  if (!clean) {
    clean = 'field';
  }

  if (/^[0-9]/.test(clean)) {
    clean = `f_${clean}`;
  }

  let finalName = clean;
  let counter = 1;
  while (existingNames.has(finalName.toLowerCase())) {
    counter++;
    finalName = `${clean}_${counter}`;
  }

  existingNames.add(finalName.toLowerCase());
  return finalName;
}

export interface ParsedPayload {
  records: Array<Record<string, any>>;
  suggestedName?: string;
}

/**
 * Parses raw JSON string or object/array, automatically unwrapping common wrapper structures.
 */
export function parsePayload(data: any): ParsedPayload {
  let parsed = data;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) {
      throw new ValidationError('JSON payload cannot be empty');
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch (e: any) {
      throw new ValidationError(`Invalid JSON format: ${e.message}`);
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ValidationError('JSON payload must be an object or an array of objects');
  }

  // Handle direct array
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new ValidationError('JSON array must contain at least one item');
    }
    const nonObjects = parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item));
    if (nonObjects) {
      throw new ValidationError('JSON array items must be objects, not primitives or arrays');
    }
    return { records: parsed };
  }

  // Handle single object
  const keys = Object.keys(parsed);
  if (keys.length === 0) {
    throw new ValidationError('JSON object cannot be empty');
  }

  // Check if one of the properties is an array of objects (e.g. { data: [...] }, { items: [...] }, { products: [...] })
  const wrapperCandidates = ['data', 'items', 'records', 'results', 'rows', 'list', 'itemsList'];
  for (const candidate of wrapperCandidates) {
    if (Array.isArray(parsed[candidate]) && parsed[candidate].length > 0 && typeof parsed[candidate][0] === 'object') {
      return {
        records: parsed[candidate],
        suggestedName: parsed.collection || parsed.name || undefined,
      };
    }
  }

  // If there is a single key whose value is an array of objects (e.g. { "products": [ {...} ] })
  const arrayKeys = keys.filter(
    (k) => Array.isArray(parsed[k]) && parsed[k].length > 0 && typeof parsed[k][0] === 'object'
  );
  if (arrayKeys.length === 1) {
    const key = arrayKeys[0];
    return {
      records: parsed[key],
      suggestedName: key.toLowerCase(),
    };
  }

  // Otherwise, the object itself is a single record
  return {
    records: [parsed],
  };
}

export interface InferredSchemaResult {
  suggestedName?: string;
  fields: SchemaField[];
  recordCount: number;
  records: Array<Record<string, any>>;
  sampleRecords: Array<Record<string, any>>;
  rawKeyToFieldMap: Record<string, string>;
}

export interface ImportJsonOptions {
  name: string;
  data: any;
  type?: CollectionType;
  schemaOverrides?: Partial<SchemaField>[];
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
}

export interface ImportJsonResult {
  success: boolean;
  collection: CollectionModel;
  recordCount: number;
  records: Array<Record<string, any>>;
  inferredFields: SchemaField[];
  durationMs: number;
}

export class SchemaInferenceService {
  constructor(
    private db: DatabaseService,
    private schemaService: SchemaService,
    private realtime?: RealtimeService
  ) {}

  /**
   * Automatically inspects JSON data (object or array) and infers field names and types
   * (text, number, bool, date, json).
   */
  public inferSchema(data: any): InferredSchemaResult {
    const { records, suggestedName } = parsePayload(data);

    const rawKeys: string[] = [];
    const seenRawKeys = new Set<string>();

    for (const rec of records) {
      if (typeof rec === 'object' && rec !== null && !Array.isArray(rec)) {
        for (const k of Object.keys(rec)) {
          if (!seenRawKeys.has(k)) {
            seenRawKeys.add(k);
            rawKeys.push(k);
          }
        }
      }
    }

    const fields: SchemaField[] = [];
    const existingFieldNames = new Set<string>(['id', 'created', 'updated']);
    const rawKeyToFieldMap: Record<string, string> = {};

    for (const rawKey of rawKeys) {
      const lower = rawKey.toLowerCase().trim();
      // Skip system fields in collection schema (they are managed automatically by SQLite/NodeStack)
      if (lower === 'id' || lower === 'created' || lower === 'updated') {
        rawKeyToFieldMap[rawKey] = lower;
        continue;
      }

      const cleanName = sanitizeFieldName(rawKey, existingFieldNames);
      rawKeyToFieldMap[rawKey] = cleanName;

      const values: any[] = [];
      for (const rec of records) {
        if (rec[rawKey] !== undefined) {
          values.push(rec[rawKey]);
        }
      }

      const inferredType = inferFieldType(values);

      fields.push({
        id: `f_${crypto.randomBytes(4).toString('hex')}`,
        name: cleanName,
        type: inferredType,
        required: false,
        unique: false,
      });
    }

    return {
      suggestedName,
      fields,
      recordCount: records.length,
      records,
      sampleRecords: records.slice(0, 5),
      rawKeyToFieldMap,
    };
  }

  /**
   * "Paste JSON → Instant API": Infers schema, creates collection and SQLite columns,
   * and populates all records within 1 second.
   */
  public async importJson(options: ImportJsonOptions): Promise<ImportJsonResult> {
    const rawName = (options.name || '').trim();
    if (!rawName) {
      throw new ValidationError('Collection name is required');
    }

    const cleanName = rawName.toLowerCase();
    if (!/^[a-zA-Z0-9_]+$/.test(cleanName)) {
      throw new AppError('Collection name must only contain alphanumeric characters and underscores', 400);
    }
    if (cleanName.startsWith('_')) {
      throw new AppError('Custom collection names cannot start with underscore (_)', 400);
    }

    const existing = this.schemaService.getCollection(cleanName);
    if (existing) {
      throw new ConflictError(`Collection with name '${cleanName}' already exists`);
    }

    const startTime = Date.now();

    // 1. Infer schema and extract records
    const inference = this.inferSchema(options.data);
    let fields = inference.fields;

    // Fallback if no user fields were inferred
    if (fields.length === 0) {
      fields.push({
        id: `f_${crypto.randomBytes(4).toString('hex')}`,
        name: 'title',
        type: 'text',
        required: false,
      });
    }

    // 2. Apply optional schema overrides from user/client
    if (options.schemaOverrides && Array.isArray(options.schemaOverrides)) {
      for (const override of options.schemaOverrides) {
        const target = fields.find((f) => f.name === override.name || f.id === override.id);
        if (target) {
          if (override.type) target.type = override.type as FieldType;
          if (override.name) target.name = override.name;
          if (override.required !== undefined) target.required = Boolean(override.required);
          if (override.unique !== undefined) target.unique = Boolean(override.unique);
        }
      }
    }

    // 3. Prepare normalized records
    const now = new Date().toISOString();
    const preparedRows: Array<Record<string, any>> = [];

    for (const raw of inference.records) {
      const row: Record<string, any> = {};

      // System ID handling
      if (raw.id && String(raw.id).trim()) {
        row.id = String(raw.id).trim();
      } else {
        row.id = `r_${crypto.randomBytes(6).toString('hex')}`;
      }

      // Timestamps
      if (raw.created && !isNaN(Date.parse(raw.created))) {
        row.created = new Date(raw.created).toISOString();
      } else {
        row.created = now;
      }

      if (raw.updated && !isNaN(Date.parse(raw.updated))) {
        row.updated = new Date(raw.updated).toISOString();
      } else {
        row.updated = row.created;
      }

      // Fields
      for (const field of fields) {
        let val = raw[field.name];

        if (val === undefined) {
          // Check original mapped key
          for (const [rawK, cleanK] of Object.entries(inference.rawKeyToFieldMap)) {
            if (cleanK === field.name && raw[rawK] !== undefined) {
              val = raw[rawK];
              break;
            }
          }
        }

        row[field.name] = this.normalizeValueForSql(field, val);
      }

      preparedRows.push(row);
    }

    // 4. Create collection & table via SchemaService
    const collection = this.schemaService.createCollection({
      name: cleanName,
      type: options.type || 'base',
      schema: fields,
      listRule: options.listRule !== undefined ? options.listRule : '',
      viewRule: options.viewRule !== undefined ? options.viewRule : '',
      createRule: options.createRule !== undefined ? options.createRule : null,
      updateRule: options.updateRule !== undefined ? options.updateRule : null,
      deleteRule: options.deleteRule !== undefined ? options.deleteRule : null,
    });

    // 5. Populate records inside a high-speed SQLite transaction
    const colNames = ['id', ...fields.map((f) => f.name), 'created', 'updated'];
    const placeholders = colNames.map(() => '?').join(', ');
    const insertSql = `INSERT INTO "${cleanName}" (${colNames.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
    const insertStmt = this.db.prepare(insertSql);

    try {
      this.db.transaction(() => {
        for (const row of preparedRows) {
          const params = colNames.map((c) => (row[c] !== undefined ? row[c] : null));
          insertStmt.run(...params);
        }
      });
    } catch (err: any) {
      // If insertion fails, rollback table creation
      try {
        this.schemaService.deleteCollection(cleanName);
      } catch {
        // ignore cleanup error
      }
      throw err;
    }

    const durationMs = Date.now() - startTime;

    // 6. Build sanitized response records
    const sanitizedRecords = preparedRows.map((r) => this.sanitizeOutputRecord(r, fields));

    // 7. Realtime broadcast for newly populated collection
    if (this.realtime) {
      for (const rec of sanitizedRecords.slice(0, 10)) {
        this.realtime.broadcast('create', cleanName, rec);
      }
    }

    return {
      success: true,
      collection,
      recordCount: preparedRows.length,
      records: sanitizedRecords,
      inferredFields: fields,
      durationMs,
    };
  }

  private normalizeValueForSql(field: SchemaField, val: any): any {
    if (val === undefined || val === null) {
      return null;
    }

    switch (field.type) {
      case 'bool':
        return val === true || val === 1 || val === 'true' ? 1 : 0;
      case 'number':
        return isNaN(Number(val)) ? null : Number(val);
      case 'json':
        return typeof val === 'string' ? val : JSON.stringify(val);
      case 'date':
        return !isNaN(Date.parse(val)) ? new Date(val).toISOString() : String(val);
      default:
        return String(val);
    }
  }

  private sanitizeOutputRecord(raw: Record<string, any>, fields: SchemaField[]): Record<string, any> {
    const clean = { ...raw };
    for (const f of fields) {
      if (f.type === 'bool' && clean[f.name] !== undefined && clean[f.name] !== null) {
        clean[f.name] = Boolean(clean[f.name]);
      } else if (f.type === 'json' && typeof clean[f.name] === 'string') {
        try {
          clean[f.name] = JSON.parse(clean[f.name]);
        } catch {
          // keep as string
        }
      }
    }
    return clean;
  }
}
