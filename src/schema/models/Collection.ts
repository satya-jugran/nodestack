import { SchemaField } from './Field';

export type CollectionType = 'base' | 'auth' | 'view';

export type ViewDialect = 'sqlite' | 'postgres' | 'mssql';

export interface CollectionOptions {
  viewQueries?: Partial<Record<ViewDialect, string>>;
  [key: string]: any;
}

export interface CollectionModel {
  id: string;
  name: string;
  type: CollectionType;
  system: boolean;
  schema: SchemaField[];
  indexes: string[];
  listRule: string | null;
  viewRule: string | null;
  createRule: string | null;
  updateRule: string | null;
  deleteRule: string | null;
  options: CollectionOptions;
  created: string;
  updated: string;
}

export interface CreateCollectionDto {
  id?: string;
  name: string;
  type?: CollectionType;
  system?: boolean;
  schema?: SchemaField[];
  indexes?: string[];
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
  options?: CollectionOptions;
}

export interface UpdateCollectionDto {
  name?: string;
  schema?: SchemaField[];
  indexes?: string[];
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
  options?: CollectionOptions;
  force?: boolean;
  cascade?: boolean;
}
