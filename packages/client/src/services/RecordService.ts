import { BaseService, ClientInterface } from './BaseService';
import { ClientResponseError } from '../errors/ClientResponseError';
import type {
  ListResult,
  QueryOptions,
  RecordModel,
  RecordAuthResponse,
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
  public async getList(
    page = 1,
    perPage = 30,
    options: QueryOptions = {}
  ): Promise<ListResult<T>> {
    return this.send<ListResult<T>>(
      `/api/collections/${encodeURIComponent(this.collectionName)}/records`,
      {
        method: 'GET',
        query: {
          page,
          perPage,
          ...options,
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
