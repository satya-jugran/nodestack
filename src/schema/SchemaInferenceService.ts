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

/**
 * Checks if a value is a valid record object (non-null, non-array object).
 */
export function isRecordObject(item: any): item is Record<string, any> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
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
    const nonObjects = parsed.some((item) => !isRecordObject(item));
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
  const ENVELOPE_METADATA_KEYS = new Set([
    'collection',
    'name',
    'total',
    'totalitems',
    'total_items',
    'page',
    'perpage',
    'per_page',
    'totalpages',
    'total_pages',
    'count',
    'status',
    'statuscode',
    'status_code',
    'success',
    'message',
    'meta',
    'metadata',
    'limit',
    'offset',
  ]);

  for (const candidate of wrapperCandidates) {
    if (candidate in parsed && Array.isArray(parsed[candidate])) {
      const arr = parsed[candidate];
      const otherKeys = keys.filter((k) => k !== candidate);
      const isEnvelope =
        candidate === 'data' ||
        otherKeys.length === 0 ||
        otherKeys.every((k) => ENVELOPE_METADATA_KEYS.has(k.toLowerCase())) ||
        (arr.length > 0 && arr.some((item: any) => isRecordObject(item)));

      if (isEnvelope) {
        if (arr.length === 0) {
          throw new ValidationError('JSON array must contain at least one item');
        }
        for (const item of arr) {
          if (!isRecordObject(item)) {
            throw new ValidationError('JSON array items must be objects, not primitives or arrays');
          }
        }
        return {
          records: arr,
          suggestedName: parsed.collection || parsed.name || undefined,
        };
      }
    }
  }

  // If there is a single key whose value is an array (e.g. { "products": [ {...} ] })
  if (keys.length === 1 && Array.isArray(parsed[keys[0]])) {
    const key = keys[0];
    const arr = parsed[key];
    if (arr.length === 0) {
      throw new ValidationError('JSON array must contain at least one item');
    }
    for (const item of arr) {
      if (!isRecordObject(item)) {
        throw new ValidationError('JSON array items must be objects, not primitives or arrays');
      }
    }
    return {
      records: arr,
      suggestedName: key.toLowerCase(),
    };
  }

  // Check if exactly one key is an array of non-null, non-array objects
  const arrayKeys = keys.filter(
    (k) =>
      Array.isArray(parsed[k]) &&
      parsed[k].length > 0 &&
      parsed[k].every((item: any) => isRecordObject(item))
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

export interface ImportSchemaOverride extends Partial<SchemaField> {
  oldName?: string;
  originalName?: string;
  from?: string;
  to?: string;
}

export interface ImportJsonOptions {
  name: string;
  data: any;
  type?: CollectionType;
  schemaOverrides?: ImportSchemaOverride[];
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
        if (rec && typeof rec === 'object' && rec[rawKey] !== undefined) {
          values.push(rec[rawKey]);
        }
      }

      const inferredType = inferFieldType(values);
      const fieldHash = crypto.createHash('sha256').update(cleanName.toLowerCase()).digest('hex').substring(0, 8);

      fields.push({
        id: `f_${fieldHash}`,
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
        let target = fields.find((f) => override.id && f.id === override.id);
        if (!target && (override as any).oldName) {
          target = fields.find((f) => f.name.toLowerCase() === String((override as any).oldName).toLowerCase());
        }
        if (!target && (override as any).originalName) {
          target = fields.find((f) => f.name.toLowerCase() === String((override as any).originalName).toLowerCase());
        }
        if (!target && (override as any).from) {
          target = fields.find((f) => f.name.toLowerCase() === String((override as any).from).toLowerCase());
        }
        if (!target && override.name) {
          target = fields.find((f) => f.name.toLowerCase() === String(override.name).toLowerCase());
        }

        if (!target) {
          throw new ValidationError(
            `Schema override target '${override.name || override.id || (override as any).oldName || (override as any).originalName}' does not match any inferred field`
          );
        }

        if (override.type) target.type = override.type as FieldType;
        if (override.required !== undefined) target.required = Boolean(override.required);
        if (override.unique !== undefined) target.unique = Boolean(override.unique);

        const rawNewName = (override.name || (override as any).to || '').trim();
        if (rawNewName && rawNewName !== target.name) {
          const oldName = target.name;

          // 1. Validate field name syntax
          if (!/^[a-zA-Z0-9_]+$/.test(rawNewName)) {
            throw new ValidationError(
              `Field name '${rawNewName}' must only contain alphanumeric characters and underscores`
            );
          }
          if (/^[0-9]/.test(rawNewName)) {
            throw new ValidationError(`Field name '${rawNewName}' cannot start with a number`);
          }

          // 2. Validate against reserved system fields
          const reserved = new Set(['id', 'created', 'updated']);
          if (options.type === 'auth') {
            reserved.add('email');
            reserved.add('emailvisibility');
            reserved.add('verified');
            reserved.add('passwordhash');
            reserved.add('tokenkey');
          }
          if (reserved.has(rawNewName.toLowerCase())) {
            throw new ConflictError(`Field name '${rawNewName}' collides with reserved system field`);
          }

          // 3. Validate collisions with other fields in collection schema
          const collision = fields.find(
            (f) => f.id !== target.id && f.name.toLowerCase() === rawNewName.toLowerCase()
          );
          if (collision) {
            throw new ConflictError(`Field name collision: field '${rawNewName}' already exists in schema`);
          }

          // 4. Update field name on target
          target.name = rawNewName;

          // 5. Preserve original-key mapping in rawKeyToFieldMap so imported values are preserved
          for (const [rawK, mappedField] of Object.entries(inference.rawKeyToFieldMap)) {
            if (mappedField.toLowerCase() === oldName.toLowerCase()) {
              inference.rawKeyToFieldMap[rawK] = rawNewName;
            }
          }
          inference.rawKeyToFieldMap[oldName] = rawNewName;
          if ((override as any).oldName) {
            inference.rawKeyToFieldMap[(override as any).oldName] = rawNewName;
          }
          if ((override as any).originalName) {
            inference.rawKeyToFieldMap[(override as any).originalName] = rawNewName;
          }
          if ((override as any).from) {
            inference.rawKeyToFieldMap[(override as any).from] = rawNewName;
          }
        }
      }
    }

    // 3. Prepare normalized records
    const now = new Date().toISOString();
    const preparedRows: Array<Record<string, any>> = [];

    for (const raw of inference.records) {
      if (!isRecordObject(raw)) {
        throw new ValidationError('Import records must be non-null, non-array objects');
      }
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
            if (cleanK.toLowerCase() === field.name.toLowerCase() && raw[rawK] !== undefined) {
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
