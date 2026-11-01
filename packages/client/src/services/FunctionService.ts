import { BaseService } from './BaseService';
import type { SendOptions } from '../types';

export interface FunctionConfig {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  authPolicy: string;
  methods: string[];
  eventTrigger?: string | null;
  timeoutMs: number;
  memoryLimitMb: number;
  allowedDomains: string[];
  elevated: boolean;
  env: Record<string, string>;
  created: string;
  updated: string;
}

export interface FunctionExecutionResult<T = any> {
  status: 'success' | 'error' | 'timeout';
  statusCode: number;
  body?: T;
  headers?: Record<string, string>;
  durationMs: number;
  memoryUsedMb?: number;
  logs: string[];
  error?: string;
}

export class FunctionService extends BaseService {
  /**
   * Invokes a serverless function by name or ID.
   * Scoped to the client's configured application if specified.
   */
  public async invoke<TResponse = any, TBody = any>(
    name: string,
    body?: TBody,
    options: Omit<SendOptions, 'body'> = {}
  ): Promise<TResponse> {
    const encodedName = encodeURIComponent(name);
    const appPrefix = this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
    const path = `${appPrefix}/functions/${encodedName}/invoke`;

    return this.send<TResponse>(path, {
      method: options.method || 'POST',
      body,
      ...options,
    });
  }

  /**
   * Fetch all functions configured in the active application scope (requires admin auth).
   */
  public async getList(options?: { search?: string; enabled?: boolean }): Promise<FunctionConfig[]> {
    const appPrefix = this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
    return this.send<FunctionConfig[]>(`${appPrefix}/functions`, {
      method: 'GET',
      query: options,
    });
  }

  /**
   * Fetch a single function by ID or name (requires admin auth).
   */
  public async getOne(idOrName: string): Promise<FunctionConfig> {
    const appPrefix = this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
    return this.send<FunctionConfig>(`${appPrefix}/functions/${encodeURIComponent(idOrName)}`, {
      method: 'GET',
    });
  }

  /**
   * Test execute a function in sandboxed runner (requires admin auth).
   */
  public async test(id: string, testPayload: any = {}): Promise<FunctionExecutionResult> {
    const appPrefix = this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
    return this.send<FunctionExecutionResult>(`${appPrefix}/functions/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      body: testPayload,
    });
  }
}
