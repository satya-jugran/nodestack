import type { SendOptions } from '../types';
import type { BaseAuthStore } from '../auth/BaseAuthStore';

export interface ClientInterface {
  baseUrl: string;
  authStore: BaseAuthStore;
  send<T = any>(path: string, options?: SendOptions): Promise<T>;
}

/**
 * Base service class from which all specific domain services inherit.
 */
export abstract class BaseService {
  constructor(protected readonly client: ClientInterface) {}

  protected send<T = any>(path: string, options: SendOptions = {}): Promise<T> {
    return this.client.send<T>(path, options);
  }
}
