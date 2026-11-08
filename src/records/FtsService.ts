import { DatabaseService } from '../database/DatabaseService';
import { CollectionModel } from '../schema/models/Collection';
import { SchemaField } from '../schema/models/Field';
import { IFtsDriver, FtsQueryOptions } from './fts/IFtsDriver';
import { SqliteFts5Driver } from './fts/SqliteFts5Driver';
import { PostgresFtsDriver } from './fts/PostgresFtsDriver';
import { MssqlFtsDriver } from './fts/MssqlFtsDriver';

export { FtsQueryOptions } from './fts/IFtsDriver';
export const FTS_SCORE_ALIAS = '__fts_score';
export const FTS_SNIPPET_ALIAS = '__fts_snippet';
export const FTS_SNIPPET_FIELD_PREFIX = '__fts_snippet_';
export const RESERVED_FTS_FIELDS = ['_score', '_snippet', '_snippets'] as const;

export function isReservedFtsFieldName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const lower = name.toLowerCase().trim();
  if (lower === '_score' || lower === '_snippet' || lower === '_snippets') {
    return true;
  }
  if (lower.startsWith('_snippet_') || lower.startsWith('__fts_')) {
    return true;
  }
  return false;
}

export function isFtsField(field: SchemaField): boolean {
  const lower = (field.name || '').toLowerCase().trim();
  if (lower === 'rank' || lower === 'rowid' || isReservedFtsFieldName(field.name)) {
    return false;
  }
  if (field.fts === true || field.options?.fts === true) {
    return true;
  }
  if (field.fts === false || field.options?.fts === false) {
    return false;
  }
  return field.type === 'text';
}

export function getFtsFields(col: CollectionModel): SchemaField[] {
  if (!col || !Array.isArray(col.schema)) return [];
  return col.schema.filter(isFtsField);
}

export function getFtsTableName(collectionName: string): string {
  const clean = collectionName.trim().toLowerCase();
  return `_fts_${clean}`;
}

export function sanitizeFtsQuery(query: string): string {
  if (!query || typeof query !== 'string') return '';

  const normalized = query.replace(/\+/g, ' ').trim();
  if (!normalized) return '';

  const regex = /"([^"]+)"|(\S+)/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalized)) !== null) {
    if (match[1]) {
      const phrase = match[1].trim();
      if (phrase) {
        const cleanPhrase = phrase.replace(/"/g, '""');
        tokens.push(`"${cleanPhrase}"`);
      }
    } else if (match[2]) {
      let word = match[2].trim();
      const isPrefix = word.endsWith('*') && word.length > 1;
      if (isPrefix) {
        word = word.slice(0, -1);
      }
      const cleanWord = word.replace(/["*^:{}()[\]]/g, '').trim();
      if (cleanWord) {
        tokens.push(isPrefix ? `"${cleanWord}"*` : `"${cleanWord}"`);
      }
    }
  }

  return tokens.join(' ');
}

export class FtsService {
  private driver: IFtsDriver;
  private currentDialectName: string = '';

  constructor(private db: DatabaseService) {
    this.currentDialectName = this.db.dialect?.name || '';
    this.driver = this.createFtsDriver();
  }

  public refreshDriver(): void {
    this.currentDialectName = this.db.dialect?.name || '';
    this.driver = this.createFtsDriver();
  }

  private createFtsDriver(): IFtsDriver {
    const dialectName = this.db.dialect?.name;
    switch (dialectName) {
      case 'postgres':
        return new PostgresFtsDriver(this.db);
      case 'mssql':
        return new MssqlFtsDriver(this.db);
      case 'sqlite':
      default:
        return new SqliteFts5Driver(this.db);
    }
  }

  public getFtsDriver(): IFtsDriver {
    if (this.currentDialectName !== (this.db.dialect?.name || '')) {
      this.refreshDriver();
    }
    return this.driver;
  }

  public isFtsField(field: SchemaField): boolean {
    return isFtsField(field);
  }

  public getFtsFields(col: CollectionModel): SchemaField[] {
    return getFtsFields(col);
  }

  public getFtsTableName(collectionName: string): string {
    return getFtsTableName(collectionName);
  }

  public hasFtsIndex(collectionName: string): any {
    return this.getFtsDriver().hasFtsIndex(collectionName);
  }

  public getFtsIndexColumns(collectionName: string): any {
    return this.getFtsDriver().getFtsIndexColumns(collectionName);
  }

  public syncCollection(col: CollectionModel): any {
    return this.getFtsDriver().syncCollection(col);
  }

  public async syncAll(collections: CollectionModel[]): Promise<void> {
    for (const col of collections) {
      try {
        await this.syncCollection(col);
      } catch (err: any) {
        console.warn(`[FTS] Could not sync collection '${col.name}':`, err.message);
      }
    }
  }

  public dropCollectionFts(collectionName: string): any {
    return this.getFtsDriver().dropCollectionFts(collectionName);
  }

  public rebuildIndex(collectionName: string): any {
    return this.getFtsDriver().rebuildIndex(collectionName);
  }

  public sanitizeQuery(query: string): string {
    return sanitizeFtsQuery(query);
  }

  public buildSnippetSelect(
    ftsTable: string,
    ftsFields: SchemaField[],
    options: FtsQueryOptions = {}
  ): string {
    return this.getFtsDriver().buildSnippetSelect(ftsTable, ftsFields, options);
  }

  public buildSearchPredicate(
    ftsTable: string,
    ftsFields: SchemaField[],
    searchTerm: string
  ): { clause: string; params: any[] } {
    return this.getFtsDriver().buildSearchPredicate(ftsTable, ftsFields, searchTerm);
  }

  public attachSnippetsAndScore(rows: any[], ftsFields: SchemaField[]): void {
    for (const row of rows) {
      if (!row) continue;
      if (row[FTS_SCORE_ALIAS] !== undefined) {
        row._score = Number(row[FTS_SCORE_ALIAS]);
        delete row[FTS_SCORE_ALIAS];
      } else if (row._score !== undefined) {
        row._score = Number(row._score);
      }

      if (row[FTS_SNIPPET_ALIAS] !== undefined) {
        row._snippet = row[FTS_SNIPPET_ALIAS];
        delete row[FTS_SNIPPET_ALIAS];
      }

      const snippets: Record<string, string> = {};
      for (const field of ftsFields) {
        const namespacedKey = `${FTS_SNIPPET_FIELD_PREFIX}${field.name}`;
        const legacyKey = `_snippet_${field.name}`;
        if (row[namespacedKey] !== undefined) {
          snippets[field.name] = row[namespacedKey];
          delete row[namespacedKey];
        } else if (row[legacyKey] !== undefined) {
          snippets[field.name] = row[legacyKey];
          delete row[legacyKey];
        }
      }
      row._snippets = snippets;
    }
  }
}
