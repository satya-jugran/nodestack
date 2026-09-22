export type FieldType =
  | 'text'
  | 'number'
  | 'bool'
  | 'email'
  | 'url'
  | 'date'
  | 'select'
  | 'json'
  | 'file'
  | 'relation';

export interface FieldOptions {
  maxSelect?: number;
  maxSize?: number;
  mimeTypes?: string[];
  values?: string[]; // for select
  collectionId?: string; // for relation
  cascadeDelete?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  [key: string]: any;
}

export interface SchemaField {
  id: string;
  name: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  defaultValue?: any;
  options?: FieldOptions;
}
