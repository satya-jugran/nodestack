import { BaseAuthStore } from './auth/BaseAuthStore';
import { LocalAuthStore } from './auth/LocalAuthStore';
import { ClientResponseError } from './errors/ClientResponseError';
import { RecordService } from './services/RecordService';
import { FileService } from './services/FileService';
import { RealtimeService } from './services/RealtimeService';
import { AdminService } from './services/AdminService';
import { CollectionService } from './services/CollectionService';
import type {
  ClientOptions,
  SendOptions,
  RecordModel,
} from './types';

/**
 * Main NodeStack Client SDK entry point.
 */
export class NodeStackClient<TCollections extends Record<string, any> = Record<string, RecordModel>> {
  public readonly baseUrl: string;
  public readonly authStore: BaseAuthStore;
  public readonly files: FileService;
  public readonly realtime: RealtimeService;
  public readonly admins: AdminService;
  public readonly collections: CollectionService;

  private customFetch?: typeof fetch;
  private defaultHeaders: Record<string, string>;
  private defaultTimeout: number;
  private recordServices: Map<string, RecordService<any>> = new Map();

  constructor(baseUrl: string = '/', options: ClientOptions = {}) {
    this.baseUrl = (baseUrl || '/').replace(/\/+$/, '');
    this.authStore = options.authStore || new LocalAuthStore();
    this.customFetch = options.fetch;
    this.defaultHeaders = options.headers || {};
    this.defaultTimeout = options.timeout || 120000; // 2 minutes default

    this.files = new FileService(this);
    this.realtime = new RealtimeService(this, options.EventSource);
    this.admins = new AdminService(this);
    this.collections = new CollectionService(this);
  }

  /**
   * Returns a RecordService for interacting with a specific collection.
   * If a schema map type is provided to NodeStackClient, collection names
   * and record response types are automatically inferred and type-safe.
   */
  public collection<K extends keyof TCollections>(name: K): RecordService<TCollections[K]>;
  public collection<T = RecordModel>(name: string): RecordService<T>;
  public collection(name: string): RecordService<any> {
    const colName = String(name);
    let service = this.recordServices.get(colName);
    if (!service) {
      service = new RecordService(this, colName);
      this.recordServices.set(colName, service);
    }
    return service;
  }

  /**
   * Sends an HTTP request to NodeStack with automatic authentication,
   * header injection, query serialization, and standardized error handling.
   */
  public async send<T = any>(path: string, options: SendOptions = {}): Promise<T> {
    const fetchFn = this.customFetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchFn) {
      throw new Error(
        '[NodeStackClient] fetch is not available in this environment. ' +
          'Please pass a custom fetch implementation to ClientOptions.'
      );
    }

    // 1. Build URL & Query parameters
    let url = path.startsWith('http://') || path.startsWith('https://')
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    if (options.query) {
      const searchParams = new URLSearchParams();
      for (const [key, val] of Object.entries(options.query)) {
        if (val === undefined || val === null) continue;
        searchParams.append(key, String(val));
      }
      const queryStr = searchParams.toString();
      if (queryStr) {
        url += (url.includes('?') ? '&' : '?') + queryStr;
      }
    }

    // 2. Prepare headers
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(options.headers || {}),
    };

    if (this.authStore.token && !headers['Authorization'] && !headers['authorization']) {
      headers['Authorization'] = `Bearer ${this.authStore.token}`;
    }

    // 3. Serialize body
    let body: any = options.body;
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const isBlob = typeof Blob !== 'undefined' && body instanceof Blob;

    if (body !== undefined && body !== null) {
      if (isFormData) {
        // Let the environment compute multipart boundary headers automatically
        delete headers['Content-Type'];
        delete headers['content-type'];
      } else if (isBlob || typeof body === 'string') {
        // Leave body as-is
      } else if (typeof body === 'object') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }
    }

    // 4. Handle abort signal & timeout
    let signal = options.signal;
    let timeoutId: any = null;

    if (!signal && this.defaultTimeout > 0 && typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      signal = controller.signal;
      timeoutId = setTimeout(() => controller.abort(), this.defaultTimeout);
    }

    try {
      const response = await fetchFn(url, {
        ...options,
        headers,
        body,
        signal,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return null as any;
      }

      const contentType = response.headers.get('content-type') || '';
      let data: any;

      if (contentType.includes('application/json')) {
        data = await response.json().catch(() => ({}));
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        throw new ClientResponseError({
          url,
          status: response.status,
          data,
          message: typeof data === 'object' && data?.message ? data.message : undefined,
        });
      }

      return data as T;
    } catch (err: any) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (err instanceof ClientResponseError) {
        throw err;
      }

      const isAbort =
        err?.name === 'AbortError' ||
        (signal && signal.aborted) ||
        Boolean(options.signal && options.signal.aborted);

      throw new ClientResponseError({
        url,
        status: isAbort ? 0 : 0,
        isAbort,
        originalError: err,
        message: isAbort ? 'Request was aborted' : err?.message || 'Network request failed',
      });
    }
  }

  /**
   * Checks backend system health.
   */
  public async health(): Promise<{ status: string; [key: string]: any }> {
    return this.send('/api/health', { method: 'GET' });
  }

  /**
   * Retrieves server runtime settings.
   */
  public async settings(): Promise<any> {
    return this.send('/api/settings', { method: 'GET' });
  }

  /**
   * Fetches request logs (Admin only).
   */
  public async logs(page = 1, perPage = 50): Promise<any> {
    return this.send('/api/logs', {
      method: 'GET',
      query: { page, perPage },
    });
  }

  /**
   * Fetches system metrics & analytics (Admin only).
   */
  public async metrics(): Promise<any> {
    return this.send('/api/metrics', { method: 'GET' });
  }
}
