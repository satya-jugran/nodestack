import type { RecordModel, AdminModel } from '../types';

export type AuthChangeListener = (token: string, model: RecordModel | AdminModel | null) => void;

/**
 * Lightweight helper to decode JWT payload without external dependencies.
 */
export function decodeJwtPayload(token: string): Record<string, any> | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) {
      b64 += '=';
    }

    let jsonStr: string;
    const globalObj: any =
      typeof globalThis !== 'undefined'
        ? globalThis
        : typeof window !== 'undefined'
          ? window
          : typeof self !== 'undefined'
            ? self
            : {};

    if (typeof globalObj.atob === 'function') {
      jsonStr = decodeURIComponent(
        Array.prototype.map
          .call(globalObj.atob(b64), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
    } else if (typeof globalObj.Buffer !== 'undefined') {
      jsonStr = globalObj.Buffer.from(b64, 'base64').toString('utf8');
    } else {
      return null;
    }

    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Base abstract class for authentication stores.
 */
export abstract class BaseAuthStore {
  protected _token: string = '';
  protected _model: RecordModel | AdminModel | null = null;
  private _listeners: Set<AuthChangeListener> = new Set();

  public get token(): string {
    return this._token;
  }

  public get model(): RecordModel | AdminModel | null {
    return this._model;
  }

  /**
   * Returns true if a token exists and has not yet expired.
   */
  public get isValid(): boolean {
    if (!this._token) {
      return false;
    }

    const payload = decodeJwtPayload(this._token);
    if (!payload) {
      return false;
    }

    if (payload.exp && typeof payload.exp === 'number') {
      const now = Math.floor(Date.now() / 1000);
      return payload.exp > now;
    }

    return true;
  }

  /**
   * Saves the token and associated user or admin model.
   */
  public save(token: string, model?: RecordModel | AdminModel | null): void {
    this._token = token || '';
    this._model = model || null;
    this.notify();
  }

  /**
   * Clears the current authentication state.
   */
  public clear(): void {
    this._token = '';
    this._model = null;
    this.notify();
  }

  /**
   * Subscribes to changes in authentication state (token or model).
   * Returns an unbind function.
   */
  public onChange(callback: AuthChangeListener, fireImmediately = false): () => void {
    this._listeners.add(callback);
    if (fireImmediately) {
      try {
        callback(this._token, this._model);
      } catch (err) {
        console.error('[AuthStore] Error in immediate onChange listener:', err);
      }
    }

    return () => {
      this._listeners.delete(callback);
    };
  }

  /**
   * Triggers all subscribed change listeners.
   */
  protected notify(): void {
    for (const listener of this._listeners) {
      try {
        listener(this._token, this._model);
      } catch (err) {
        console.error('[AuthStore] Error in onChange listener:', err);
      }
    }
  }
}
