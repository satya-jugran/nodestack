import { SchemaField } from './Field';

export type CollectionType = 'base' | 'auth' | 'view';

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
  options: Record<string, any>;
  created: string;
  updated: string;
}

export interface CreateCollectionDto {
  id?: string;
  name: string;
  type?: CollectionType;
  schema?: SchemaField[];
  indexes?: string[];
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
  options?: Record<string, any>;
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
  options?: Record<string, any>;
}
