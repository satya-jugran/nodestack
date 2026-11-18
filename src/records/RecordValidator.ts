import { SchemaField } from '../schema/models/Field';
import { ValidationError } from '../core/errors/AppError';

export class RecordValidator {
  public static readonly DEFAULT_MAX_TEXT_LENGTH = 1048576; // 1MB safe ceiling

  public static validateField(field: SchemaField, value: any): void {
    if (field.required && (value === undefined || value === null || value === '')) {
      throw new ValidationError(`Field '${field.name}' is required`);
    }

    if (value === undefined || value === null || value === '') {
      return;
    }

    // Boolean validation
    if (field.type === 'bool') {
      const isBoolType =
        typeof value === 'boolean' ||
        value === 1 ||
        value === 0 ||
        value === 'true' ||
        value === 'false' ||
        value === '1' ||
        value === '0';
      if (!isBoolType) {
        throw new ValidationError(`Field '${field.name}' must be a valid boolean`);
      }
    }

    // Number validation
    if (field.type === 'number') {
      const num = Number(value);
      if (isNaN(num)) {
        throw new ValidationError(`Field '${field.name}' must be a valid number`);
      }
      if (field.options?.min !== undefined && num < field.options.min) {
        throw new ValidationError(`Field '${field.name}' must be greater than or equal to ${field.options.min}`);
      }
      if (field.options?.max !== undefined && num > field.options.max) {
        throw new ValidationError(`Field '${field.name}' must be less than or equal to ${field.options.max}`);
      }
    }

    // Text / string validation (length constraints and pattern)
    if (field.type === 'text') {
      if (typeof value === 'object' && !(value instanceof Date) && !(value instanceof Buffer)) {
        throw new ValidationError(`Field '${field.name}' must be a string, received object`);
      }
      const strVal = String(value);
      if (field.options?.min !== undefined && strVal.length < field.options.min) {
        throw new ValidationError(`Field '${field.name}' must be at least ${field.options.min} characters`);
      }
      const maxLen = field.options?.max !== undefined ? field.options.max : RecordValidator.DEFAULT_MAX_TEXT_LENGTH;
      if (strVal.length > maxLen) {
        throw new ValidationError(`Field '${field.name}' must be at most ${maxLen} characters`);
      }
      if (field.options?.pattern) {
        try {
          const reg = new RegExp(field.options.pattern);
          if (!reg.test(strVal)) {
            throw new ValidationError(`Field '${field.name}' does not match required pattern`);
          }
        } catch (e: any) {
          if (e instanceof ValidationError) throw e;
        }
      }
    }

    // Date validation
    if (field.type === 'date') {
      const parsedTime = Date.parse(String(value));
      if (isNaN(parsedTime)) {
        throw new ValidationError(`Field '${field.name}' must be a valid date or timestamp`);
      }
    }

    // Email validation
    if (field.type === 'email') {
      const strVal = String(value).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal)) {
        throw new ValidationError(`Field '${field.name}' must be a valid email address`);
      }
    }

    // URL validation
    if (field.type === 'url') {
      const strVal = String(value).trim();
      if (!/^https?:\/\//i.test(strVal)) {
        throw new ValidationError(`Field '${field.name}' must be a valid URL`);
      }
    }

    // Select validation
    if (field.type === 'select' && field.options?.values) {
      if (!field.options.values.includes(String(value))) {
        throw new ValidationError(
          `Invalid value for select field '${field.name}'. Allowed: ${field.options.values.join(', ')}`
        );
      }
    }

    // JSON validation
    if (field.type === 'json' && typeof value === 'string') {
      try {
        JSON.parse(value);
      } catch {
        throw new ValidationError(`Field '${field.name}' must be valid JSON`);
      }
    }

    // Relation validation
    if (field.type === 'relation') {
      let items: any[] = [];
      if (Array.isArray(value)) {
        items = value;
      } else if (typeof value === 'string' && value.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) {
            items = parsed;
          } else {
            items = [value];
          }
        } catch {
          items = [value];
        }
      } else if (value !== undefined && value !== null) {
        items = [value];
      }
      for (const item of items) {
        if (typeof item === 'string' || typeof item === 'number') {
          RecordValidator.validateRecordId(item);
        }
      }
    }
  }

  /**
   * Coerce boolean-like input values to a native JavaScript boolean.
   */
  public static toBoolean(value: any): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
  }

  public static normalizeFieldValue(field: SchemaField, value: any): any {
    if (value === undefined || value === null || (value === '' && field.type !== 'text')) {
      if (field.type === 'bool') {
        return RecordValidator.toBoolean(field.defaultValue);
      }
      return field.defaultValue !== undefined ? field.defaultValue : null;
    }

    switch (field.type) {
      case 'bool':
        return RecordValidator.toBoolean(value);
      case 'number':
        return Number(value);
      case 'json':
        return typeof value === 'string' ? value : JSON.stringify(value);
      case 'email':
        return String(value).trim().toLowerCase();
      case 'date':
        return value instanceof Date ? value.toISOString() : String(value);
      case 'relation':
        return Array.isArray(value) ? JSON.stringify(value) : String(value);
      default:
        if (value instanceof Date) {
          return value.toISOString();
        }
        if (typeof value === 'object' && value !== null && !(value instanceof Buffer)) {
          return JSON.stringify(value);
        }
        return String(value);
    }
  }

  /**
   * Validate a record ID for any record-ingest path (create, import, inference, seed).
   * Throws ValidationError if the ID contains prohibited characters (must only contain alphanumeric characters, underscores, and hyphens).
   * Returns trimmed string, or undefined if not provided.
   */
  public static validateRecordId(id?: any): string | undefined {
    if (id === undefined || id === null) {
      return undefined;
    }
    const clean = String(id).trim();
    if (!clean) {
      return undefined;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(clean)) {
      throw new ValidationError(
        `Record ID must only contain alphanumeric characters, underscores, and hyphens (contains prohibited characters: '${id}')`
      );
    }
    return clean;
  }
}
