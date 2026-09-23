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
}
