import { Product } from './types';

export const RECENTLY_VIEWED_STORAGE_KEY = 'nodestack_recently_viewed_ids';
export const MAX_RECENTLY_VIEWED = 12;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): StorageLike | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function normalizeIds(raw: unknown, maxItems = MAX_RECENTLY_VIEWED): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= maxItems) break;
  }
  return result;
}

/**
 * Reads recently viewed product IDs from localStorage (most recent first).
 */
export function getRecentlyViewedIds(
  storage: StorageLike | undefined = getDefaultStorage(),
  maxItems = MAX_RECENTLY_VIEWED
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENTLY_VIEWED_STORAGE_KEY);
    if (!raw) return [];
    return normalizeIds(JSON.parse(raw), maxItems);
  } catch {
    return [];
  }
}

/**
 * Records a viewed product ID at the front of the recently viewed list in localStorage.
 */
export function recordRecentlyViewedId(
  productId: string,
  storage: StorageLike | undefined = getDefaultStorage(),
  maxItems = MAX_RECENTLY_VIEWED
): string[] {
  const id = typeof productId === 'string' ? productId.trim() : '';
  const current = getRecentlyViewedIds(storage, maxItems);
  if (!id) return current;

  const updated = [id, ...current.filter((existing) => existing !== id)].slice(0, maxItems);
  if (storage) {
    try {
      storage.setItem(RECENTLY_VIEWED_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage quota / private mode errors
    }
  }
  return updated;
}

/**
 * Clears all recently viewed product IDs from localStorage.
 */
export function clearRecentlyViewedIds(
  storage: StorageLike | undefined = getDefaultStorage()
): string[] {
  if (storage) {
    try {
      storage.removeItem(RECENTLY_VIEWED_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
  return [];
}

/**
 * Resolves ordered recently viewed IDs against the loaded product catalog.
 */
export function resolveRecentlyViewedProducts(products: Product[], ids: string[]): Product[] {
  if (products.length === 0 || ids.length === 0) return [];
  const byId = new Map(products.map((product) => [product.id, product]));
  const resolved: Product[] = [];
  for (const id of ids) {
    const match = byId.get(id);
    if (match) resolved.push(match);
  }
  return resolved;
}

/**
 * Computes "Customers Also Bought" recommendations using category affinity from
 * recently viewed & cart items, combined with ratings, stock, and featured status.
 */
export function getCustomersAlsoBoughtProducts(
  products: Product[],
  recentlyViewedIds: string[],
  cartProductIds: string[] = [],
  limit = 10
): Product[] {
  if (products.length === 0 || limit <= 0) return [];

  const byId = new Map(products.map((product) => [product.id, product]));
  const excludedIds = new Set<string>([...recentlyViewedIds, ...cartProductIds]);

  const affinityCategories = new Set<string>();
  for (const id of excludedIds) {
    const product = byId.get(id);
    if (product?.category) {
      affinityCategories.add(product.category);
    }
  }

  const candidates = products.filter((product) => !excludedIds.has(product.id));
  const pool = candidates.length > 0 ? candidates : products;

  return [...pool]
    .map((product) => {
      let score = 0;
      if (product.category && affinityCategories.has(product.category)) {
        score += 50;
      }
      if (product.isFeatured) {
        score += 15;
      }
      if (product.status !== 'out_of_stock' && product.stock > 0) {
        score += 10;
      }
      if (typeof product.originalPrice === 'number' && product.originalPrice > product.price) {
        score += 5;
      }
      score += (product.rating ?? 0) * 4;
      score += Math.min(product.reviewCount ?? 0, 20) * 0.5;
      return { product, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.product.name.localeCompare(b.product.name);
    })
    .slice(0, limit)
    .map((entry) => entry.product);
}
