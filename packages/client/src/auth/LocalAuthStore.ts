import { BaseAuthStore } from './BaseAuthStore';
import type { RecordModel, AdminModel } from '../types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DEFAULT_STORAGE_KEY = 'nodestack_auth';

/**
 * Storage-backed AuthStore that syncs token and model with localStorage
 * (or any custom StorageLike object, such as sessionStorage or AsyncStorage).
 * Safely degrades to memory if storage is not available.
 */
export class LocalAuthStore extends BaseAuthStore {
  private storageKey: string;
  private storage?: StorageLike;

  constructor(storageKey: string = DEFAULT_STORAGE_KEY, customStorage?: StorageLike) {
    super();
    this.storageKey = storageKey;

    if (customStorage) {
      this.storage = customStorage;
    } else if (typeof window !== 'undefined' && window.localStorage) {
      this.storage = window.localStorage;
    }

    this.loadInitial();
  }

  private loadInitial(): void {
    if (!this.storage) return;

    try {
      const raw = this.storage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.token === 'string') {
          this._token = parsed.token;
          this._model = parsed.model || null;
        }
      }
    } catch {
      // Ignore parse or storage errors
    }
  }

  public override save(token: string, model?: RecordModel | AdminModel | null): void {
    super.save(token, model);

    if (this.storage) {
      try {
        this.storage.setItem(
          this.storageKey,
          JSON.stringify({
            token: this._token,
            model: this._model,
          })
        );
      } catch {
        // Storage might be full or disabled
      }
    }
  }

  public override clear(): void {
    super.clear();

    if (this.storage) {
      try {
        this.storage.removeItem(this.storageKey);
      } catch {
        // Ignore storage error
      }
    }
  }
}
