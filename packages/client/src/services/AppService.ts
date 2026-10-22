import { BaseService } from './BaseService';
import type {
  AppModel,
  AppCreateOptions,
  AppUpdateOptions,
} from '../types';

/**
 * Service for managing NodeStack applications / MVPs.
 */
export class AppService extends BaseService {
  public list = this.getList.bind(this);
  public get = this.getOne.bind(this);

  /**
   * Retrieves all configured applications.
   */
  public async getList(): Promise<AppModel[]> {
    const res = await this.send<{ items: AppModel[]; totalItems: number }>('/api/apps', {
      method: 'GET',
    });
    return Array.isArray(res) ? res : (res?.items || []);
  }

  /**
   * Retrieves a single application by ID or slug.
   */
  public async getOne(appId: string): Promise<AppModel> {
    return this.send<AppModel>(`/api/apps/${encodeURIComponent(appId)}`, {
      method: 'GET',
    });
  }

  /**
   * Creates a new application.
   */
  public async create(data: AppCreateOptions): Promise<AppModel> {
    return this.send<AppModel>('/api/apps', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Updates an existing application.
   */
  public async update(appId: string, data: AppUpdateOptions): Promise<AppModel> {
    return this.send<AppModel>(`/api/apps/${encodeURIComponent(appId)}`, {
      method: 'PATCH',
      body: data,
    });
  }

  /**
   * Deletes an application by ID or slug.
   */
  public async delete(appId: string): Promise<boolean> {
    await this.send<void>(`/api/apps/${encodeURIComponent(appId)}`, {
      method: 'DELETE',
    });
    return true;
  }
}
