import { BaseService, ClientInterface } from './BaseService';
import type { RealtimeEvent, RealtimeCallback, UnsubscribeFunc } from '../types';

/**
 * Multiplexed Realtime Server-Sent Events (SSE) service.
 * Manages a single persistent SSE connection and dispatches events to subscribed listeners.
 */
export class RealtimeService extends BaseService {
  private eventSource: any = null;
  private clientId: string = '';
  private isConnecting: boolean = false;
  private connectPromise: Promise<string> | null = null;
  private reconnectTimeout: any = null;
  private reconnectAttempts: number = 0;
  private customEventSource?: any;

  // Map of topic -> Set of callbacks
  private subscriptions: Map<string, Set<RealtimeCallback<any>>> = new Map();

  // Set of registered event names on the active EventSource
  private registeredEventNames: Set<string> = new Set();

  constructor(client: ClientInterface, customEventSource?: any) {
    super(client);
    this.customEventSource = customEventSource;
  }

  /**
   * Returns whether there is an active EventSource connection.
   */
  public get isConnected(): boolean {
    return Boolean(this.eventSource && this.clientId);
  }

  /**
   * Resolves the EventSource constructor available in the current environment.
   */
  private getEventSourceConstructor(): any {
    if (this.customEventSource) {
      return this.customEventSource;
    }
    if (typeof window !== 'undefined' && (window as any).EventSource) {
      return (window as any).EventSource;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).EventSource) {
      return (globalThis as any).EventSource;
    }
    throw new Error(
      '[RealtimeService] EventSource is not supported natively in this environment. ' +
        'Please pass an EventSource polyfill to ClientOptions (e.g. from the "eventsource" package).'
    );
  }

  /**
   * Connects to the SSE stream if not already connected.
   * Returns the connected clientId.
   */
  public async connect(): Promise<string> {
    if (this.clientId && this.eventSource) {
      return this.clientId;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<string>((resolve, reject) => {
      try {
        const EventSourceClass = this.getEventSourceConstructor();
        const base = (this.client.baseUrl || '').replace(/\/+$/, '');
        let url = `${base}/api/realtime`;

        if (this.client.authStore.token) {
          url += `?token=${encodeURIComponent(this.client.authStore.token)}`;
        }

        this.eventSource = new EventSourceClass(url);

        const handleConnect = async (event: any) => {
          try {
            const data = JSON.parse(event.data);
            this.clientId = data.clientId;
            this.reconnectAttempts = 0;

            // Re-apply any existing subscriptions on the server
            await this.syncSubscriptions();

            resolve(this.clientId);
          } catch (err) {
            reject(err);
          }
        };

        this.eventSource.addEventListener('NS_CONNECT', handleConnect);
        this.eventSource.addEventListener('NB_CONNECT', handleConnect);

        this.eventSource.onerror = (err: any) => {
          if (!this.clientId) {
            reject(err);
          }
          this.handleDisconnect();
        };

        // Bind listeners for all known collection topics
        this.bindActiveTopics();
      } catch (err) {
        this.connectPromise = null;
        reject(err);
      }
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  /**
   * Subscribes to realtime updates for a collection or record.
   *
   * @param topic - Collection name ('posts'), wildcard ('*'), or specific record ('posts/rec_123')
   * @param callback - Event listener callback
   * @returns Unsubscribe function
   */
  public async subscribe<T = any>(
    topic: string,
    callback: RealtimeCallback<T>
  ): Promise<UnsubscribeFunc> {
    const cleanTopic = (topic || '*').trim();

    if (!this.subscriptions.has(cleanTopic)) {
      this.subscriptions.set(cleanTopic, new Set());
    }

    this.subscriptions.get(cleanTopic)!.add(callback);

    // If connected, sync subscriptions with server
    if (this.isConnected) {
      this.bindTopicListener(cleanTopic);
      await this.syncSubscriptions();
    } else {
      // Connect and sync
      await this.connect();
    }

    return () => this.unsubscribe(cleanTopic, callback);
  }

  /**
   * Unsubscribes from a topic or specific callback.
   */
  public async unsubscribe(topic?: string, callback?: RealtimeCallback<any>): Promise<void> {
    if (!topic) {
      // Unsubscribe all
      this.subscriptions.clear();
      if (this.isConnected) {
        await this.syncSubscriptions();
      }
      return;
    }

    const cleanTopic = topic.trim();
    if (!this.subscriptions.has(cleanTopic)) {
      return;
    }

    if (callback) {
      this.subscriptions.get(cleanTopic)!.delete(callback);
      if (this.subscriptions.get(cleanTopic)!.size === 0) {
        this.subscriptions.delete(cleanTopic);
      }
    } else {
      this.subscriptions.delete(cleanTopic);
    }

    if (this.isConnected) {
      await this.syncSubscriptions();
    }
  }

  /**
   * Closes the SSE connection and clears state.
   */
  public disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {}
      this.eventSource = null;
    }

    this.clientId = '';
    this.registeredEventNames.clear();
  }

  /**
   * Synchronizes active subscriptions with the backend via POST /api/realtime.
   */
  private async syncSubscriptions(): Promise<void> {
    if (!this.clientId) return;

    const topics = Array.from(this.subscriptions.keys());

    try {
      await this.client.send('/api/realtime', {
        method: 'POST',
        body: {
          clientId: this.clientId,
          subscriptions: topics.length > 0 ? topics : ['__noop__'],
        },
      });
    } catch (err) {
      console.warn('[RealtimeService] Failed to sync subscriptions with server:', err);
    }
  }

  /**
   * Binds an EventSource listener for the collection corresponding to a topic.
   */
  private bindTopicListener(topic: string): void {
    if (!this.eventSource) return;

    // Determine collection name
    const collectionName = topic.includes('/') ? topic.split('/')[0] : topic;

    if (this.registeredEventNames.has(collectionName)) {
      return;
    }

    this.registeredEventNames.add(collectionName);

    this.eventSource.addEventListener(collectionName, (event: any) => {
      try {
        const payload: RealtimeEvent<any> = JSON.parse(event.data);
        this.dispatchEvent(collectionName, payload);
      } catch (err) {
        console.error(`[RealtimeService] Error handling event for ${collectionName}:`, err);
      }
    });
  }

  private bindActiveTopics(): void {
    for (const topic of this.subscriptions.keys()) {
      this.bindTopicListener(topic);
    }
  }

  /**
   * Dispatches received SSE events to matching subscribed listeners.
   */
  private dispatchEvent(collectionName: string, event: RealtimeEvent<any>): void {
    const recordId = event.record?.id;

    // Check wildcard subscription '*'
    this.triggerListeners('*', event);

    // Check collection subscription e.g. 'posts' or 'posts/*'
    this.triggerListeners(collectionName, event);
    this.triggerListeners(`${collectionName}/*`, event);

    // Check record-specific subscription e.g. 'posts/rec_123'
    if (recordId) {
      this.triggerListeners(`${collectionName}/${recordId}`, event);
    }
  }

  private triggerListeners(topic: string, event: RealtimeEvent<any>): void {
    const callbacks = this.subscriptions.get(topic);
    if (!callbacks || callbacks.size === 0) return;

    for (const cb of callbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error(`[RealtimeService] Error in realtime listener for ${topic}:`, err);
      }
    }
  }

  /**
   * Handles disconnections and schedules automatic reconnection.
   */
  private handleDisconnect(): void {
    if (this.reconnectTimeout) return;

    this.disconnect();

    // Exponential backoff up to 10 seconds
    const delay = Math.min(10000, 500 * Math.pow(1.5, this.reconnectAttempts));
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.subscriptions.size > 0) {
        this.connect().catch(() => {});
      }
    }, delay);
  }
}
