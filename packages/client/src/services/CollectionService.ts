import { BaseService } from './BaseService';

/**
 * Service for managing collection schema definitions (Admin only).
 */
export class CollectionService extends BaseService {
  /**
   * Retrieves all collection schema models.
   */
  public async getList(): Promise<any[]> {
    const res = await this.send<{ items: any[]; totalItems: number } | any[]>('/api/collections', {
      method: 'GET',
    });
    return Array.isArray(res) ? res : res?.items || [];
  }

  /**
   * Retrieves a single collection schema by name or ID.
   */
  public async getOne(nameOrId: string): Promise<any> {
    return this.send<any>(`/api/collections/${encodeURIComponent(nameOrId)}`, {
      method: 'GET',
    });
  }

  /**
   * Creates a new collection schema.
   */
  public async create(data: any): Promise<any> {
    return this.send<any>('/api/collections', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Updates an existing collection schema.
   */
  public async update(nameOrId: string, data: any): Promise<any> {
    return this.send<any>(`/api/collections/${encodeURIComponent(nameOrId)}`, {
      method: 'PATCH',
      body: data,
    });
  }

  /**
   * Deletes a collection schema and its corresponding SQLite table.
   */
  public async delete(nameOrId: string): Promise<boolean> {
    await this.send<void>(`/api/collections/${encodeURIComponent(nameOrId)}`, {
      method: 'DELETE',
    });
    return true;
  }

  /**
   * Infers schema fields, field types, and sample records from raw JSON (object or array).
   */
  public async inferSchema(data: any): Promise<{
    suggestedName?: string;
    fields: any[];
    recordCount: number;
    sampleRecords: any[];
  }> {
    return this.send('/api/collections/infer-schema', {
      method: 'POST',
      body: { data },
    });
  }

  /**
   * "Paste JSON → Instant API": Infers field types, creates collection and SQLite columns,
   * and populates all records within 1 second.
   */
  public async importJson(
    name: string,
    data: any,
    options: {
      type?: 'base' | 'auth';
      schemaOverrides?: any[];
      listRule?: string | null;
      viewRule?: string | null;
      createRule?: string | null;
      updateRule?: string | null;
      deleteRule?: string | null;
    } = {}
  ): Promise<{
    success: boolean;
    collection: any;
    recordCount: number;
    records: any[];
    inferredFields: any[];
    durationMs: number;
  }> {
    return this.send('/api/collections/import-json', {
      method: 'POST',
      body: {
        name,
        data,
        ...options,
      },
    });
  }
}
