import { CreateCollectionDto } from '../schema/models/Collection';

export interface GeneratedFileAsset {
  fieldName: string;
  filename: string;
  buffer: Buffer;
  mimeType: string;
}

export interface SeedRecordResult {
  record: Record<string, any>;
  files?: GeneratedFileAsset[];
}

export interface TemplateSeedContext {
  collectionIdMap: Map<string, string>; // collection name -> collection id
  seededRecordsMap: Map<string, Array<Record<string, any>>>; // collection name -> records
}

export interface TemplateCollectionDef {
  name: string;
  dto: CreateCollectionDto;
  seed: (context: TemplateSeedContext) => Promise<Array<Record<string, any>> | SeedRecordResult[]>;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  badge: string;
  aliases: string[];
  collections: TemplateCollectionDef[];
  stats: {
    collections: number;
    records: number;
    images: number;
  };
}

export interface TemplateSummary {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  badge: string;
  aliases: string[];
  collections: string[];
  stats: {
    collections: number;
    records: number;
    images: number;
  };
}

export interface ApplyTemplateOptions {
  overwrite?: boolean;
}

export interface ApplyTemplateResult {
  success: boolean;
  skipped?: boolean;
  template: string;
  templateName: string;
  collections: string[];
  totalRecords: number;
  totalImages: number;
  durationMs: number;
  message: string;
}
