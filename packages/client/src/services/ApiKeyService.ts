import { BaseService } from './BaseService';
import type {
  ApiKeyModel,
  CreateApiKeyOptions,
  UpdateApiKeyOptions,
  ApiKeyListOptions,
  ApiKeySecretResult,
} from '../types';

/**
 * Service for managing scoped M2M API keys (Admin only).
 * Automatically respects the client's configured `app` slug via `x-nodestack-app`.
 */
export class ApiKeyService extends BaseService {
  public list = this.getList.bind(this);
  public get = this.getOne.bind(this);

  /**
   * Lists API keys (redacted metadata only; secret hashes and plaintext keys are never returned).
   */
  public async getList(options: ApiKeyListOptions = {}): Promise<ApiKeyModel[]> {
    const res = await this.send<ApiKeyModel[]>('/api/api-keys', {
      method: 'GET',
      query: options,
    });
    return Array.isArray(res) ? res : [];
  }

  /**
   * Retrieves a single API key's metadata by ID.
   */
  public async getOne(id: string): Promise<ApiKeyModel> {
    return this.send<ApiKeyModel>(`/api/api-keys/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  }

  /**
   * Creates a new API key and returns `{ apiKey, secretKey }` (plaintext `secretKey` is returned only once).
   */
  public async create(data: CreateApiKeyOptions): Promise<ApiKeySecretResult> {
    return this.send<ApiKeySecretResult>('/api/api-keys', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Updates an existing API key's metadata, role, scopes, allowed IPs, expiration, or status.
   */
  public async update(id: string, data: UpdateApiKeyOptions): Promise<ApiKeyModel> {
    return this.send<ApiKeyModel>(`/api/api-keys/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: data,
    });
  }

  /**
   * Rotates an API key's secret, immediately invalidating the previous secret and returning the new `secretKey` once.
   */
  public async rotate(id: string): Promise<ApiKeySecretResult> {
    return this.send<ApiKeySecretResult>(`/api/api-keys/${encodeURIComponent(id)}/rotate`, {
      method: 'POST',
      body: {},
    });
  }

  /**
   * Revokes an API key (`status: 'revoked'`) without deleting its audit record.
   */
  public async revoke(id: string): Promise<ApiKeyModel> {
    return this.update(id, { status: 'revoked' });
  }

  /**
   * Restores a previously revoked API key (`status: 'active'`).
   */
  public async restore(id: string): Promise<ApiKeyModel> {
    return this.update(id, { status: 'active' });
  }

  /**
   * Permanently deletes an API key by ID.
   */
  public async delete(id: string): Promise<boolean> {
    await this.send<void>(`/api/api-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return true;
  }
}
