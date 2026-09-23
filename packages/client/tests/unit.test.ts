import { describe, it, expect, vi } from 'vitest';
import {
  decodeJwtPayload,
  BaseAuthStore,
  MemoryAuthStore,
  LocalAuthStore,
  ClientResponseError,
  FileService,
  RealtimeService,
} from '../src';

describe('nodestack-client Unit Tests', () => {
  describe('JWT Payload Decoding & AuthStore Expiration', () => {
    // Helper to generate a fake unverified JWT with given payload
    function createTestToken(payload: Record<string, any>): string {
      const buf = (globalThis as any).Buffer;
      const header = buf.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
      const body = buf.from(JSON.stringify(payload)).toString('base64');
      const signature = 'test_signature';
      return `${header}.${body}.${signature}`;
    }

    it('should decode payload correctly from valid JWT string', () => {
      const token = createTestToken({ sub: 'user_123', email: 'test@nodestack.io' });
      const payload = decodeJwtPayload(token);
      expect(payload).toBeDefined();
      expect(payload?.sub).toBe('user_123');
      expect(payload?.email).toBe('test@nodestack.io');
    });

    it('should return null for invalid or malformed tokens', () => {
      expect(decodeJwtPayload('')).toBeNull();
      expect(decodeJwtPayload('invalid.token')).toBeNull();
      expect(decodeJwtPayload('a.b.c.d')).toBeNull();
    });

    it('should accurately calculate isValid based on exp timestamp', () => {
      const store = new MemoryAuthStore();
      expect(store.isValid).toBe(false);

      // Future expiration (valid)
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validToken = createTestToken({ exp: futureExp });
      store.save(validToken, { id: 'u_1', created: '', updated: '' });
      expect(store.isValid).toBe(true);
      expect(store.token).toBe(validToken);
      expect(store.model?.id).toBe('u_1');

      // Past expiration (expired)
      const pastExp = Math.floor(Date.now() / 1000) - 3600;
      const expiredToken = createTestToken({ exp: pastExp });
      store.save(expiredToken);
      expect(store.isValid).toBe(false);

      // Token without exp claim is treated as valid
      const noExpToken = createTestToken({ sub: 'admin' });
      store.save(noExpToken);
      expect(store.isValid).toBe(true);

      // Clearing resets validity
      store.clear();
      expect(store.isValid).toBe(false);
      expect(store.token).toBe('');
      expect(store.model).toBeNull();
    });

    it('should notify onChange listeners when state changes and allow unbinding', () => {
      const store = new MemoryAuthStore();
      const listener = vi.fn();
      const unbind = store.onChange(listener);

      store.save('tok_123', { id: 'user_1', created: '', updated: '' });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('tok_123', expect.objectContaining({ id: 'user_1' }));

      store.clear();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith('', null);

      unbind();
      store.save('tok_456');
      expect(listener).toHaveBeenCalledTimes(2); // No further calls
    });
  });

  describe('LocalAuthStore with Mock Storage', () => {
    it('should synchronize state to and from storage', () => {
      const storageData: Record<string, string> = {};
      const mockStorage = {
        getItem: (k: string) => storageData[k] || null,
        setItem: (k: string, v: string) => {
          storageData[k] = v;
        },
        removeItem: (k: string) => {
          delete storageData[k];
        },
      };

      const store1 = new LocalAuthStore('test_key', mockStorage);
      store1.save('persisted_token', { id: 'rec_99', created: '', updated: '' });

      expect(storageData['test_key']).toBeDefined();
      expect(JSON.parse(storageData['test_key']).token).toBe('persisted_token');

      // Second store instance loads existing persisted data on init
      const store2 = new LocalAuthStore('test_key', mockStorage);
      expect(store2.token).toBe('persisted_token');
      expect(store2.model?.id).toBe('rec_99');

      store2.clear();
      expect(storageData['test_key']).toBeUndefined();
    });
  });

  describe('ClientResponseError', () => {
    it('should format error status, url, message, and toJSON properly', () => {
      const err = new ClientResponseError({
        url: 'http://localhost:8090/api/test',
        status: 404,
        data: { message: 'Item not found', code: 'NOT_FOUND' },
      });

      expect(err.name).toBe('ClientResponseError');
      expect(err.status).toBe(404);
      expect(err.url).toBe('http://localhost:8090/api/test');
      expect(err.message).toBe('Item not found');
      expect(err.isAbort).toBe(false);

      const json = err.toJSON();
      expect(json.status).toBe(404);
      expect(json.message).toBe('Item not found');
      expect(json.data.code).toBe('NOT_FOUND');
    });

    it('should detect abort errors', () => {
      const err = new ClientResponseError({
        isAbort: true,
        message: 'Request was aborted',
      });
      expect(err.isAbort).toBe(true);
      expect(err.message).toBe('Request was aborted');
    });
  });

  describe('FileService', () => {
    const mockClient: any = {
      baseUrl: 'http://127.0.0.1:8090',
      authStore: { token: 'jwt_admin_token' },
      send: vi.fn(),
    };

    const files = new FileService(mockClient);

    it('should build file URLs correctly from record object', () => {
      const url = files.getUrl(
        { id: 'rec_abc', collection: 'posts' },
        'sample.png'
      );
      expect(url).toBe('http://127.0.0.1:8090/api/files/posts/rec_abc/sample.png');
    });

    it('should support download and token options', () => {
      const url = files.getUrl(
        { id: 'rec_abc', collectionName: 'documents' },
        'report.pdf',
        { download: true, token: true }
      );
      expect(url).toBe(
        'http://127.0.0.1:8090/api/files/documents/rec_abc/report.pdf?download=1&token=jwt_admin_token'
      );
    });

    it('should support record ID string with collection option override', () => {
      const url = files.getUrl('rec_123', 'avatar.jpg', {
        collection: 'users',
        token: 'custom_token',
      });
      expect(url).toBe(
        'http://127.0.0.1:8090/api/files/users/rec_123/avatar.jpg?token=custom_token'
      );
    });

    it('should throw an error if collection or record ID is missing', () => {
      expect(() => files.getUrl('', 'test.png')).toThrow();
      expect(() => files.getUrl({ id: 'rec_1' }, 'test.png')).toThrow();
    });
  });

  describe('RealtimeService with Mock EventSource', () => {
    class MockEventSource {
      public listeners: Record<string, Function[]> = {};
      public url: string;
      public onerror: any = null;

      constructor(url: string) {
        this.url = url;
        // Simulate async handshake emission
        setTimeout(() => {
          this.emit('NS_CONNECT', { data: JSON.stringify({ clientId: 'cl_mock_123' }) });
        }, 10);
      }

      public addEventListener(type: string, listener: Function) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(listener);
      }

      public removeEventListener(type: string, listener: Function) {
        if (this.listeners[type]) {
          this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
        }
      }

      public emit(type: string, event: any) {
        if (this.listeners[type]) {
          for (const l of this.listeners[type]) {
            l(event);
          }
        }
      }

      public close() {}
    }

    it('should connect, complete handshake, register topic, and dispatch event', async () => {
      let registeredSubscriptions: any = null;

      const mockClient: any = {
        baseUrl: 'http://127.0.0.1:8090',
        authStore: { token: '' },
        send: vi.fn().mockImplementation(async (path: string, options: any) => {
          if (path === '/api/realtime' && options.method === 'POST') {
            registeredSubscriptions = options.body.subscriptions;
            return null;
          }
          return null;
        }),
      };

      const realtime = new RealtimeService(mockClient, MockEventSource);

      const receivedEvents: any[] = [];
      const unsubscribe = await realtime.subscribe('posts', (e) => {
        receivedEvents.push(e);
      });

      expect(realtime.isConnected).toBe(true);
      expect(registeredSubscriptions).toContain('posts');

      // Dispatch simulated event through the mock EventSource
      const es = (realtime as any).eventSource as MockEventSource;
      es.emit('posts', {
        data: JSON.stringify({
          action: 'create',
          record: { id: 'post_1', title: 'Realtime Post' },
        }),
      });

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].action).toBe('create');
      expect(receivedEvents[0].record.title).toBe('Realtime Post');

      // Unsubscribe
      await unsubscribe();
      expect((realtime as any).subscriptions.has('posts')).toBe(false);

      realtime.disconnect();
      expect(realtime.isConnected).toBe(false);
    });
  });
});
