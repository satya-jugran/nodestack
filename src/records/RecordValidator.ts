import { SchemaField } from '../schema/models/Field';
import { ValidationError } from '../core/errors/AppError';

export class RecordValidator {
  public static validateField(field: SchemaField, value: any): void {
    if (field.required && (value === undefined || value === null || value === '')) {
      throw new ValidationError(`Field '${field.name}' is required`);
    }

    if (value === undefined || value === null || value === '') {
      return;
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
      const strVal = String(value);
      if (field.options?.min !== undefined && strVal.length < field.options.min) {
        throw new ValidationError(`Field '${field.name}' must be at least ${field.options.min} characters`);
      }
      if (field.options?.max !== undefined && strVal.length > field.options.max) {
        throw new ValidationError(`Field '${field.name}' must be at most ${field.options.max} characters`);
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
  }

  public static normalizeFieldValue(field: SchemaField, value: any): any {
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
      case 'email':
        return String(value).trim().toLowerCase();
      default:
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
