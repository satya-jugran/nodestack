import { CollectionModel } from '../../schema/models/Collection';
import { SchemaField } from '../../schema/models/Field';

export interface FtsQueryOptions {
  snippetTag?: string;
  snippetLength?: number;
  snippetEllipsis?: string;
  ftsLanguage?: string;
}

export interface IFtsDriver {
  syncCollection(col: CollectionModel): Promise<void> | void;
  dropCollectionFts(collectionName: string): Promise<void> | void;
  rebuildIndex(collectionName: string, lang?: string): Promise<void> | void;
  hasFtsIndex(collectionName: string): Promise<boolean> | boolean;
  getFtsIndexColumns(collectionName: string): Promise<string[]> | string[];
  buildSnippetSelect(
    ftsTable: string,
    ftsFields: SchemaField[],
    options?: FtsQueryOptions
  ): string;
  buildSearchPredicate(
    ftsTable: string,
    ftsFields: SchemaField[],
    searchTerm: string,
    options?: FtsQueryOptions
  ): { clause: string; params: any[] };
}
