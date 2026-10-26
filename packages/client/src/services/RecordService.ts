import { BaseService, ClientInterface } from './BaseService';
import { ClientResponseError } from '../errors/ClientResponseError';
import { PkceUtil } from '../auth/PkceUtil';
import type {
  ListResult,
  QueryOptions,
  RecordModel,
  RecordAuthResponse,
  RecordOAuthResponse,
  AuthMethodsList,
  OAuth2AuthOptions,
  ExternalAuthModel,
  ImportResult,
  RealtimeCallback,
  UnsubscribeFunc,
} from '../types';

export interface ClientWithRealtime extends ClientInterface {
  realtime: {
    subscribe<R = any>(topic: string, callback: RealtimeCallback<R>): Promise<UnsubscribeFunc>;
    unsubscribe(topic?: string, callback?: RealtimeCallback<any>): Promise<void>;
  };
}

/**
 * Service for managing CRUD, authentication, file handling, and subscriptions
 * for a specific collection.
 */
export class RecordService<T = RecordModel> extends BaseService {
  constructor(
    client: ClientWithRealtime,
    public readonly collectionName: string
  ) {
    super(client);
  }

  private get clientWithRealtime(): ClientWithRealtime {
    return this.client as ClientWithRealtime;
  }

  /**
   * Returns a paginated list of records matching the query options.
   */
  public async getList(options?: QueryOptions): Promise<ListResult<T>>;
  public async getList(
    page?: number,
    perPage?: number,
    options?: QueryOptions
  ): Promise<ListResult<T>>;
  public async getList(
    pageOrOptions: number | QueryOptions = 1,
    perPage = 30,
    options: QueryOptions = {}
  ): Promise<ListResult<T>> {
    let pageNum = 1;
    let perPageNum = perPage;
    let queryOpts: QueryOptions = options;

    if (typeof pageOrOptions === 'object' && pageOrOptions !== null) {
      queryOpts = pageOrOptions;
      pageNum = typeof queryOpts.page === 'number' ? queryOpts.page : 1;
      perPageNum = typeof queryOpts.perPage === 'number' ? queryOpts.perPage : 30;
    } else if (typeof pageOrOptions === 'number') {
      pageNum = pageOrOptions;
    }

    return this.send<ListResult<T>>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/records`,
      {
        method: 'GET',
        query: {
          page: pageNum,
          perPage: perPageNum,
          ...queryOpts,
        },
      }
    );
  }

  /**
   * Fetches and aggregates all records in the collection across multiple pages.
   */
  public async getFullList(
    options: QueryOptions & { batch?: number } = {}
  ): Promise<T[]> {
    const batch = Math.max(1, Math.min(500, options.batch || 200));
    const query = { ...options };
    delete query.batch;

    const firstPage = await this.getList(1, batch, query);
    const items: T[] = [...firstPage.items];

    if (firstPage.totalPages <= 1) {
      return items;
    }

    for (let page = 2; page <= firstPage.totalPages; page++) {
      const result = await this.getList(page, batch, query);
      items.push(...result.items);
    }

    return items;
  }

  /**
   * Returns the first record matching the specified filter expression.
   * Throws ClientResponseError(404) if no record matches.
   */
  public async getFirstListItem(
    filter: string,
    options: QueryOptions = {}
  ): Promise<T> {
    const list = await this.getList(1, 1, {
      ...options,
      filter,
    });

    if (!list.items || list.items.length === 0) {
      throw new ClientResponseError({
        status: 404,
        url: `/api/collections/${this.collectionName}/records`,
        message: `The requested record was not found in collection '${this.collectionName}'.`,
      });
    }

    return list.items[0];
  }

  /**
   * Retrieves a single record by its ID.
   */
  public async getOne(id: string, options: QueryOptions = {}): Promise<T> {
    return this.send<T>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/records/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        query: options,
      }
    );
  }

  /**
   * Creates a new record in the collection.
   * Accepts a plain object or FormData (for file uploads).
   */
  public async create(
    data: Record<string, any> | FormData,
    options: QueryOptions = {}
  ): Promise<T> {
    return this.send<T>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/records`,
      {
        method: 'POST',
        body: data,
        query: options,
      }
    );
  }

  /**
   * Updates an existing record by its ID.
   * Accepts a plain object or FormData (for file updates).
   */
  public async update(
    id: string,
    data: Record<string, any> | FormData,
    options: QueryOptions = {}
  ): Promise<T> {
    return this.send<T>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/records/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: data,
        query: options,
      }
    );
  }

  /**
   * Deletes a record by its ID.
   */
  public async delete(id: string): Promise<boolean> {
    await this.send<void>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/records/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    );
    return true;
  }

  /**
   * Authenticates against an auth collection using identity/email and password.
   * On success, automatically persists the token and record to authStore.
   */
  public async authWithPassword(
    identity: string,
    password: string
  ): Promise<RecordAuthResponse<T>> {
    const result = await this.send<RecordAuthResponse<T>>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/auth-with-password`,
      {
        method: 'POST',
        body: { identity, password },
      }
    );

    if (result && result.token) {
      this.client.authStore.save(result.token, result.record as any);
    }

    return result;
  }

  /**
   * Returns a list of configured and enabled OAuth2 authentication providers.
   */
  public async listAuthMethods(redirectUri?: string): Promise<AuthMethodsList> {
    return this.send<AuthMethodsList>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/auth-methods`,
      {
        method: 'GET',
        query: redirectUri ? { redirectUri } : undefined,
      }
    );
  }

  /**
   * Authenticates against an auth collection using OAuth2 with PKCE code exchange.
   * On success, automatically persists the token and record to authStore.
   */
  public async authWithOAuth2(
    options: OAuth2AuthOptions
  ): Promise<RecordOAuthResponse<T>> {
    let code = options.code;
    let codeVerifier = options.codeVerifier;

    if ((options.urlCallback || options.popup || (typeof window !== 'undefined' && !code && !codeVerifier)) && (!code || !codeVerifier)) {
      const authMethods = await this.listAuthMethods(options.redirectUrl);
      const provider = authMethods.authProviders.find(
        (p) => p.name.toLowerCase() === options.provider.toLowerCase()
      );

      if (!provider) {
        throw new Error(`OAuth provider '${options.provider}' is not enabled or configured.`);
      }

      codeVerifier = provider.codeVerifier;
      const expectedState = provider.state;

      let expectedOrigin: string | null = null;
      if (typeof window !== 'undefined' && window.location) {
        if (options.redirectUrl) {
          try {
            expectedOrigin = new URL(options.redirectUrl, window.location.href).origin;
          } catch {
            expectedOrigin = window.location.origin;
          }
        } else {
          expectedOrigin = window.location.origin;
        }
      }

      let popup: Window | null = options.popup || null;
      if (options.urlCallback) {
        const cbResult = options.urlCallback(provider.authUrl);
        if (!popup && cbResult && typeof (cbResult as any).postMessage === 'function') {
          popup = cbResult as Window;
        }
      } else if (typeof window !== 'undefined' && typeof window.open === 'function') {
        popup = window.open(provider.authUrl, '_blank', 'width=600,height=700');
        if (!popup) {
          throw new Error('Failed to open OAuth popup window. It may have been blocked by the browser.');
        }
      }

      return new Promise<RecordOAuthResponse<T>>((resolve, reject) => {
        if (typeof window !== 'undefined' && window.addEventListener) {
          let pollTimer: any = null;

          const cleanup = () => {
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
            if (typeof window !== 'undefined' && window.removeEventListener) {
              window.removeEventListener('message', handler);
            }
          };

          const handler = async (event: MessageEvent) => {
            // 1. Validate payload structure
            if (!event.data || typeof event.data !== 'object' || event.data.type !== 'nodestack_oauth_callback') {
              return;
            }

            // 2. Restrict messages to the expected redirect origin
            if (expectedOrigin && event.origin !== expectedOrigin) {
              return;
            }

            // 3. Restrict messages to the popup/source window associated with this request
            if (popup) {
              if (event.source !== popup) {
                return;
              }
            } else if (event.source === window) {
              return;
            }

            // 4. Bind message to the expected state before exchanging it
            if (expectedState && event.data.state !== expectedState) {
              return;
            }

            // Valid matching message received; clean up listener and poll timer
            cleanup();

            if (popup && typeof popup.close === 'function') {
              try {
                popup.close();
              } catch {}
            }

            if (event.data.error) {
              const errMsg = typeof event.data.error === 'string'
                ? event.data.error
                : (event.data.error.message || event.data.error_description || JSON.stringify(event.data.error));
              return reject(new Error(errMsg));
            }

            if (!event.data.code) {
              return reject(new Error('OAuth callback message is missing authorization code.'));
            }

            try {
              const res = await this.authWithOAuth2({
                provider: options.provider,
                code: event.data.code,
                codeVerifier,
                redirectUrl: options.redirectUrl,
                createData: options.createData,
                state: expectedState,
              });
              resolve(res);
            } catch (err) {
              reject(err);
            }
          };

          window.addEventListener('message', handler);

          if (popup) {
            pollTimer = setInterval(() => {
              if (popup && popup.closed) {
                cleanup();
                reject(new Error('The OAuth popup window was closed before completing authentication.'));
              }
            }, 500);
          }
        } else {
          reject(new Error('urlCallback requires code and codeVerifier in non-browser environments.'));
        }
      });
    }

    if (!code || !codeVerifier) {
      throw new Error('Both code and codeVerifier are required for OAuth2 authentication');
    }

    const result = await this.send<RecordOAuthResponse<T>>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/auth-with-oauth2`,
      {
        method: 'POST',
        body: {
          provider: options.provider,
          code,
          codeVerifier,
          state: options.state,
          redirectUrl: options.redirectUrl,
          createData: options.createData,
        },
      }
    );

    if (result && result.token) {
      this.client.authStore.save(result.token, result.record as any);
    }

    return result;
  }

  /**
   * Lists external social identities linked to a specific record.
   */
  public async listExternalAuths(recordId: string): Promise<ExternalAuthModel[]> {
    return this.send<ExternalAuthModel[]>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/records/${encodeURIComponent(recordId)}/external-auths`,
      {
        method: 'GET',
      }
    );
  }

  /**
   * Unlinks an external social identity from a record.
   */
  public async unlinkExternalAuth(recordId: string, provider: string): Promise<boolean> {
    await this.send<void>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/records/${encodeURIComponent(recordId)}/external-auths/${encodeURIComponent(provider)}`,
      {
        method: 'DELETE',
      }
    );
    return true;
  }

  /**
   * Exports records from the collection as CSV or JSON.
   */
  public async export(
    format: 'csv' | 'json' = 'csv',
    options: QueryOptions = {}
  ): Promise<string> {
    return this.send<string>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/export`,
      {
        method: 'GET',
        query: {
          ...options,
          format,
        },
      }
    );
  }

  /**
   * Imports records into the collection.
   */
  public async import(
    data: any[] | FormData | Blob | string,
    options: { continueOnError?: boolean } = {}
  ): Promise<ImportResult> {
    return this.send<ImportResult>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/import`,
      {
        method: 'POST',
        body: data,
        query: options,
      }
    );
  }

  /**
   * Subscribes to realtime events on this collection or a specific record ID.
   *
   * Example:
   *   // Listen to all records in collection:
   *   client.collection('posts').subscribe('*', (e) => console.log(e.action, e.record));
   *
   *   // Listen to single record changes:
   *   client.collection('posts').subscribe('record_id_123', (e) => console.log(e.action, e.record));
   */
  public async subscribe(
    topicOrCallback: string | RealtimeCallback<T>,
    callback?: RealtimeCallback<T>
  ): Promise<UnsubscribeFunc> {
    let topic = '*';
    let cb: RealtimeCallback<T>;

    if (typeof topicOrCallback === 'function') {
      topic = '*';
      cb = topicOrCallback;
    } else {
      topic = topicOrCallback;
      cb = callback!;
    }

    const fullTopic = topic === '*' ? this.collectionName : `${this.collectionName}/${topic}`;
    return this.clientWithRealtime.realtime.subscribe<T>(fullTopic, cb);
  }

  /**
   * Unsubscribes from realtime events for this collection.
   */
  public async unsubscribe(topic?: string): Promise<void> {
    const fullTopic = !topic || topic === '*' ? this.collectionName : `${this.collectionName}/${topic}`;
    return this.clientWithRealtime.realtime.unsubscribe(fullTopic);
  }
}
