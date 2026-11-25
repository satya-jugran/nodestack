import { describe, it, expect } from 'vitest';
import {
  RECENTLY_VIEWED_STORAGE_KEY,
  StorageLike,
  clearRecentlyViewedIds,
  getCustomersAlsoBoughtProducts,
  getRecentlyViewedIds,
  recordRecentlyViewedId,
  resolveRecentlyViewedProducts,
} from '../examples/ecommerce-react/src/lib/recentlyViewed';
import { Product } from '../examples/ecommerce-react/src/lib/types';

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

const catalog: Product[] = [
  {
    id: 'p1',
    name: 'Studio Headphones',
    slug: 'studio-headphones',
    description: 'Wireless ANC headphones',
    price: 299.99,
    stock: 15,
    category: 'cat_audio',
    image: 'p1.svg',
    rating: 4.9,
    reviewCount: 24,
    isFeatured: true,
    status: 'in_stock',
  },
  {
    id: 'p2',
    name: 'USB-C DAC Amp',
    slug: 'usbc-dac-amp',
    description: 'Portable audio DAC',
    price: 129.0,
    stock: 8,
    category: 'cat_audio',
    image: 'p2.svg',
    rating: 4.6,
    reviewCount: 12,
    isFeatured: false,
    status: 'in_stock',
  },
  {
    id: 'p3',
    name: 'Mechanical Keyboard',
    slug: 'mechanical-keyboard',
    description: 'Tactile wireless keyboard',
    price: 189.0,
    originalPrice: 229.0,
    stock: 10,
    category: 'cat_desk',
    image: 'p3.svg',
    rating: 4.7,
    reviewCount: 18,
    isFeatured: true,
    status: 'in_stock',
  },
  {
    id: 'p4',
    name: 'Canvas Tote',
    slug: 'canvas-tote',
    description: 'Everyday carry bag',
    price: 45.0,
    stock: 0,
    category: 'cat_bags',
    image: 'p4.svg',
    rating: 4.1,
    reviewCount: 3,
    isFeatured: false,
    status: 'out_of_stock',
  },
];

describe('recentlyViewed helpers', () => {
  it('returns empty array when storage is empty or malformed', () => {
    const empty = createMemoryStorage();
    expect(getRecentlyViewedIds(empty)).toEqual([]);

    const malformed = createMemoryStorage({ [RECENTLY_VIEWED_STORAGE_KEY]: '{not-json' });
    expect(getRecentlyViewedIds(malformed)).toEqual([]);
  });

  it('records most recently viewed IDs first, deduplicates, and caps at maxItems', () => {
    const storage = createMemoryStorage();

    expect(recordRecentlyViewedId('p1', storage, 3)).toEqual(['p1']);
    expect(recordRecentlyViewedId('p2', storage, 3)).toEqual(['p2', 'p1']);
    expect(recordRecentlyViewedId('p3', storage, 3)).toEqual(['p3', 'p2', 'p1']);
    // Re-viewing p1 moves it to the front without duplicating
    expect(recordRecentlyViewedId('p1', storage, 3)).toEqual(['p1', 'p3', 'p2']);
    // Viewing p4 evicts the oldest (p2)
    expect(recordRecentlyViewedId('p4', storage, 3)).toEqual(['p4', 'p1', 'p3']);
    expect(getRecentlyViewedIds(storage, 3)).toEqual(['p4', 'p1', 'p3']);
  });

  it('clears stored IDs', () => {
    const storage = createMemoryStorage();
    recordRecentlyViewedId('p1', storage);
    expect(clearRecentlyViewedIds(storage)).toEqual([]);
    expect(getRecentlyViewedIds(storage)).toEqual([]);
  });

  it('resolves products in recency order and skips missing IDs', () => {
    const resolved = resolveRecentlyViewedProducts(catalog, ['p3', 'missing-id', 'p1']);
    expect(resolved.map((p) => p.id)).toEqual(['p3', 'p1']);
  });

  it('prioritizes same-category recommendations in Customers Also Bought and excludes viewed/cart items', () => {
    const recs = getCustomersAlsoBoughtProducts(catalog, ['p1'], ['p3'], 5);
    expect(recs.map((p) => p.id)).toEqual(['p2', 'p4']);
    // p2 shares cat_audio with viewed p1, so it ranks above p4
    expect(recs[0].id).toBe('p2');
  });
});
