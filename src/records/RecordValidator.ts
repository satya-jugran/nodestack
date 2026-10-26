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

    if (field.type === 'number' && isNaN(Number(value))) {
      throw new ValidationError(`Field '${field.name}' must be a valid number`);
    }

    if (field.type === 'select' && field.options?.values) {
      if (!field.options.values.includes(String(value))) {
        throw new ValidationError(
          `Invalid value for select field '${field.name}'. Allowed: ${field.options.values.join(', ')}`
        );
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
      default:
        return String(value);
    }
  }
}
