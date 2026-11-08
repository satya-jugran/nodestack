import { CollectionModel } from '../../schema/models/Collection';
import { SchemaField } from '../../schema/models/Field';

export interface FtsQueryOptions {
  snippetTag?: string;
  snippetLength?: number;
  snippetEllipsis?: string;
}

export interface IFtsDriver {
  syncCollection(col: CollectionModel): Promise<void>;
  dropCollectionFts(collectionName: string): Promise<void>;
  rebuildIndex(collectionName: string): Promise<void>;
  hasFtsIndex(collectionName: string): Promise<boolean>;
  getFtsIndexColumns(collectionName: string): Promise<string[]>;
  buildSnippetSelect(
    ftsTable: string,
    ftsFields: SchemaField[],
    options?: FtsQueryOptions
  ): string;
}
