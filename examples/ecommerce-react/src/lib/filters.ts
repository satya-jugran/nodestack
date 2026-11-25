import { FlashSaleState, Product } from './types';

export const PRICE_SLIDER_MIN = 10;
export const PRICE_SLIDER_MAX = 500;
export const DEFAULT_PRICE_RANGE: [number, number] = [PRICE_SLIDER_MIN, PRICE_SLIDER_MAX];

export interface RatingFilterOption {
  value: number | null;
  label: string;
  shortLabel: string;
}

export const RATING_FILTER_OPTIONS: RatingFilterOption[] = [
  { value: null, label: 'All Ratings', shortLabel: 'All' },
  { value: 4.5, label: '4.5★ & above', shortLabel: '4.5★+' },
  { value: 4, label: '4★ & above', shortLabel: '4★+' },
  { value: 3, label: '3★ & above', shortLabel: '3★+' },
  { value: 2, label: '2★ & above', shortLabel: '2★+' },
];

export interface CatalogFilterState {
  selectedCategory: string | null;
  searchQuery: string;
  priceRange: [number, number];
  minRating: number | null;
  featuredOnly: boolean;
  discountedOnly: boolean;
  inStockOnly: boolean;
}

export interface ProductDiscountInfo {
  isDiscounted: boolean;
  originalPrice: number | null;
  discountPercent: number;
}

/**
 * Computes whether a product is discounted either via product-level originalPrice
 * or an active Flash Sale, returning its effective original price and discount %.
 */
export function getProductDiscount(
  product: Product,
  flashSale?: FlashSaleState
): ProductDiscountInfo {
  const itemOriginal =
    typeof product.originalPrice === 'number' && Number.isFinite(product.originalPrice)
      ? product.originalPrice
      : 0;
  const flashOriginal =
    flashSale?.isActive &&
    flashSale.originalPrices &&
    typeof flashSale.originalPrices[product.id] === 'number'
      ? flashSale.originalPrices[product.id]
      : 0;

  const effectiveOriginal = Math.max(itemOriginal, flashOriginal);
  if (effectiveOriginal > product.price + 0.005) {
    const rawPercent = ((effectiveOriginal - product.price) / effectiveOriginal) * 100;
    return {
      isDiscounted: true,
      originalPrice: effectiveOriginal,
      discountPercent: Math.max(1, Math.round(rawPercent)),
    };
  }

  return {
    isDiscounted: false,
    originalPrice: null,
    discountPercent: 0,
  };
}

/**
 * Clamps and normalizes a [min, max] price range within [$10, $500].
 */
export function clampPriceRange(
  range: [number, number],
  bounds: [number, number] = DEFAULT_PRICE_RANGE
): [number, number] {
  const [boundMin, boundMax] = bounds;
  const rawMin = Number.isFinite(range[0]) ? Math.round(range[0]) : boundMin;
  const rawMax = Number.isFinite(range[1]) ? Math.round(range[1]) : boundMax;
  const clampedMin = Math.min(boundMax, Math.max(boundMin, rawMin));
  const clampedMax = Math.min(boundMax, Math.max(boundMin, rawMax));
  return clampedMin <= clampedMax ? [clampedMin, clampedMax] : [clampedMax, clampedMin];
}

export function isPriceRangeFiltered(
  priceRange: [number, number],
  bounds: [number, number] = DEFAULT_PRICE_RANGE
): boolean {
  return priceRange[0] > bounds[0] || priceRange[1] < bounds[1];
}

export function isProductInStock(product: Product): boolean {
  return product.status !== 'out_of_stock' && product.stock > 0;
}

/**
 * Checks whether a product matches the provided catalog filters.
 * Allows skipping a single facet key so faceted counts can reflect the remaining active filters.
 */
export function matchesCatalogFilters(
  product: Product,
  filters: CatalogFilterState,
  flashSale?: FlashSaleState,
  omitFacet?: keyof Omit<CatalogFilterState, 'searchQuery'>
): boolean {
  if (omitFacet !== 'selectedCategory' && filters.selectedCategory && product.category !== filters.selectedCategory) {
    return false;
  }

  if (omitFacet !== 'inStockOnly' && filters.inStockOnly && !isProductInStock(product)) {
    return false;
  }

  if (omitFacet !== 'featuredOnly' && filters.featuredOnly && !Boolean(product.isFeatured)) {
    return false;
  }

  if (omitFacet !== 'discountedOnly' && filters.discountedOnly && !getProductDiscount(product, flashSale).isDiscounted) {
    return false;
  }

  if (omitFacet !== 'minRating' && filters.minRating !== null && filters.minRating > 0) {
    if ((product.rating ?? 0) < filters.minRating) {
      return false;
    }
  }

  if (omitFacet !== 'priceRange' && isPriceRangeFiltered(filters.priceRange)) {
    if (product.price < filters.priceRange[0] || product.price > filters.priceRange[1]) {
      return false;
    }
  }

  if (filters.searchQuery.trim()) {
    const q = filters.searchQuery.toLowerCase();
    const matchesName = product.name.toLowerCase().includes(q);
    const matchesDesc = (product.description || '').toLowerCase().includes(q);
    const matchesCat = product.expand?.category?.name.toLowerCase().includes(q);
    if (!matchesName && !matchesDesc && !matchesCat) {
      return false;
    }
  }

  return true;
}

export function sortCatalogProducts(products: Product[], sortBy: string): Product[] {
  return [...products].sort((a, b) => {
    if (sortBy === 'price') return a.price - b.price;
    if (sortBy === '-price') return b.price - a.price;
    if (sortBy === '-rating') return (b.rating || 0) - (a.rating || 0);
    return 0;
  });
}

export function countActiveFacetFilters(filters: CatalogFilterState): number {
  let count = 0;
  if (isPriceRangeFiltered(filters.priceRange)) count += 1;
  if (filters.minRating !== null && filters.minRating > 0) count += 1;
  if (filters.featuredOnly) count += 1;
  if (filters.discountedOnly) count += 1;
  if (filters.inStockOnly) count += 1;
  return count;
}
