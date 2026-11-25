import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRICE_RANGE,
  CatalogFilterState,
  clampPriceRange,
  countActiveFacetFilters,
  getProductDiscount,
  isPriceRangeFiltered,
  matchesCatalogFilters,
  sortCatalogProducts,
} from '../examples/ecommerce-react/src/lib/filters';
import { FlashSaleState, Product } from '../examples/ecommerce-react/src/lib/types';

const sampleProducts: Product[] = [
  {
    id: 'p1',
    name: 'Studio Headphones',
    slug: 'studio-headphones',
    description: 'Wireless ANC',
    price: 299.99,
    stock: 15,
    category: 'cat_electronics',
    image: 'p1.svg',
    rating: 4.9,
    isFeatured: true,
    status: 'in_stock',
  },
  {
    id: 'p2',
    name: 'Mechanical Keyboard',
    slug: 'mechanical-keyboard',
    description: 'Hot-swappable switches',
    price: 189.5,
    originalPrice: 229.0,
    stock: 10,
    category: 'cat_electronics',
    image: 'p2.svg',
    rating: 4.2,
    isFeatured: true,
    status: 'in_stock',
  },
  {
    id: 'p3',
    name: 'Canvas Sneakers',
    slug: 'canvas-sneakers',
    description: 'Organic cotton',
    price: 79.0,
    originalPrice: 95.0,
    stock: 0,
    category: 'cat_apparel',
    image: 'p3.svg',
    rating: 3.4,
    isFeatured: false,
    status: 'out_of_stock',
  },
  {
    id: 'p4',
    name: 'Cedarwood Candle',
    slug: 'cedarwood-candle',
    description: 'Soy wax candle',
    price: 34.0,
    stock: 40,
    category: 'cat_homeliving',
    image: 'p4.svg',
    rating: 0,
    isFeatured: false,
    status: 'in_stock',
  },
];

const baseFilters: CatalogFilterState = {
  selectedCategory: null,
  searchQuery: '',
  priceRange: DEFAULT_PRICE_RANGE,
  minRating: null,
  featuredOnly: false,
  discountedOnly: false,
  inStockOnly: false,
};

describe('E-Commerce Faceted Filters & Pricing Helpers', () => {
  it('clamps and normalizes price ranges within $10 - $500', () => {
    expect(clampPriceRange([10, 500])).toEqual([10, 500]);
    expect(clampPriceRange([-20, 999])).toEqual([10, 500]);
    expect(clampPriceRange([250, 120])).toEqual([120, 250]);
    expect(isPriceRangeFiltered([10, 500])).toBe(false);
    expect(isPriceRangeFiltered([25, 500])).toBe(true);
    expect(isPriceRangeFiltered([10, 300])).toBe(true);
  });

  it('detects item-level discounts and active flash sale discounts', () => {
    expect(getProductDiscount(sampleProducts[0])).toEqual({
      isDiscounted: false,
      originalPrice: null,
      discountPercent: 0,
    });

    const itemDiscount = getProductDiscount(sampleProducts[1]);
    expect(itemDiscount.isDiscounted).toBe(true);
    expect(itemDiscount.originalPrice).toBe(229.0);
    expect(itemDiscount.discountPercent).toBe(17);

    const flashSale: FlashSaleState = {
      isActive: true,
      discountPercent: 25,
      originalPrices: { p1: 299.99 },
    };
    const discountedBySale: Product = { ...sampleProducts[0], price: 224.99 };
    const saleDiscount = getProductDiscount(discountedBySale, flashSale);
    expect(saleDiscount.isDiscounted).toBe(true);
    expect(saleDiscount.originalPrice).toBe(299.99);
    expect(saleDiscount.discountPercent).toBe(25);
  });

  it('filters by price range slider bounds ($10 - $500)', () => {
    const filters: CatalogFilterState = {
      ...baseFilters,
      priceRange: [50, 200],
    };
    const matched = sampleProducts.filter((p) => matchesCatalogFilters(p, filters));
    expect(matched.map((p) => p.id)).toEqual(['p2', 'p3']);
  });

  it('filters by minimum rating threshold (e.g. 4★ & above)', () => {
    const filters: CatalogFilterState = {
      ...baseFilters,
      minRating: 4,
    };
    const matched = sampleProducts.filter((p) => matchesCatalogFilters(p, filters));
    expect(matched.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('filters by Featured Only and Discounted quick toggles together', () => {
    const featuredOnly = sampleProducts.filter((p) =>
      matchesCatalogFilters(p, { ...baseFilters, featuredOnly: true })
    );
    expect(featuredOnly.map((p) => p.id)).toEqual(['p1', 'p2']);

    const discountedOnly = sampleProducts.filter((p) =>
      matchesCatalogFilters(p, { ...baseFilters, discountedOnly: true })
    );
    expect(discountedOnly.map((p) => p.id)).toEqual(['p2', 'p3']);

    const featuredAndDiscounted = sampleProducts.filter((p) =>
      matchesCatalogFilters(p, { ...baseFilters, featuredOnly: true, discountedOnly: true })
    );
    expect(featuredAndDiscounted.map((p) => p.id)).toEqual(['p2']);
  });

  it('counts active facet filters and sorts products cleanly', () => {
    expect(countActiveFacetFilters(baseFilters)).toBe(0);
    expect(
      countActiveFacetFilters({
        ...baseFilters,
        priceRange: [20, 400],
        minRating: 4,
        featuredOnly: true,
        discountedOnly: true,
        inStockOnly: true,
      })
    ).toBe(5);

    expect(sortCatalogProducts(sampleProducts, 'price').map((p) => p.id)).toEqual([
      'p4',
      'p3',
      'p2',
      'p1',
    ]);
    expect(sortCatalogProducts(sampleProducts, '-rating').map((p) => p.id)).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
    ]);
  });
});
