import { describe, it, expect } from 'vitest';
import {
  buildVariantMatrix,
  findMatchingVariant,
  findVariantById,
  formatVariantLabel,
  getCartLineKey,
  getDefaultSelectedOptions,
  getEffectiveStock,
  getEffectiveUnitPrice,
  getTotalVariantStock,
  hasProductVariants,
  isOptionValueAvailable,
  parseProductVariants,
  parseVariantOptions,
} from '../examples/ecommerce-react/src/lib/variants';
import {
  DEFAULT_PRICE_RANGE,
  isProductInStock,
  matchesCatalogFilters,
} from '../examples/ecommerce-react/src/lib/filters';
import { Product } from '../examples/ecommerce-react/src/lib/types';

const hoodieProduct: Product = {
  id: 'prod_hoodie',
  name: 'Merino Wool Hoodie',
  slug: 'merino-wool-hoodie',
  description: '260gsm New Zealand merino',
  price: 125,
  stock: 13,
  category: 'cat_apparel',
  image: 'hoodie.svg',
  status: 'in_stock',
  variantOptions: [
    { name: 'Size', values: ['S', 'M', 'L'] },
    { name: 'Color', values: ['Slate', 'Amber', 'Navy'] },
  ],
  variants: [
    { id: 'var_s_slate', sku: 'HOOD-S-SLATE', label: 'S / Slate', options: { Size: 'S', Color: 'Slate' }, stock: 0 },
    { id: 'var_s_amber', sku: 'HOOD-S-AMBER', label: 'S / Amber', options: { Size: 'S', Color: 'Amber' }, stock: 4 },
    { id: 'var_m_navy', sku: 'HOOD-M-NAVY', label: 'M / Navy', options: { Size: 'M', Color: 'Navy' }, stock: 9, price: 135 },
  ],
};

describe('E-Commerce Product Variants & Options Helpers', () => {
  it('parses variant options and variants from arrays or serialized JSON strings', () => {
    expect(hasProductVariants(hoodieProduct)).toBe(true);
    expect(parseVariantOptions(hoodieProduct)).toHaveLength(2);
    expect(parseProductVariants(hoodieProduct)).toHaveLength(3);

    const stringified: Product = {
      ...hoodieProduct,
      variantOptions: JSON.stringify(hoodieProduct.variantOptions),
      variants: JSON.stringify(hoodieProduct.variants),
    };
    expect(parseVariantOptions(stringified)).toHaveLength(2);
    expect(parseProductVariants(stringified)).toHaveLength(3);
  });

  it('selects the first in-stock variant by default and resolves matching variants', () => {
    const defaults = getDefaultSelectedOptions(hoodieProduct);
    expect(defaults).toEqual({ Size: 'S', Color: 'Amber' });

    const matched = findMatchingVariant(hoodieProduct, { Size: 'M', Color: 'Navy' });
    expect(matched?.id).toBe('var_m_navy');
    expect(getEffectiveUnitPrice(hoodieProduct, matched)).toBe(135);
    expect(getEffectiveStock(hoodieProduct, matched)).toBe(9);

    const oosMatched = findVariantById(hoodieProduct, 'var_s_slate');
    expect(getEffectiveUnitPrice(hoodieProduct, oosMatched)).toBe(125);
    expect(getEffectiveStock(hoodieProduct, oosMatched)).toBe(0);
    expect(getTotalVariantStock(parseProductVariants(hoodieProduct))).toBe(13);
  });

  it('checks option availability relative to currently selected sibling options', () => {
    expect(isOptionValueAvailable(hoodieProduct, 'Color', 'Slate', { Size: 'S' })).toBe(false);
    expect(isOptionValueAvailable(hoodieProduct, 'Color', 'Amber', { Size: 'S' })).toBe(true);
    expect(isOptionValueAvailable(hoodieProduct, 'Size', 'M', { Color: 'Navy' })).toBe(true);
  });

  it('builds Cartesian variant matrices while preserving existing stock and price overrides', () => {
    const matrix = buildVariantMatrix(
      [
        { name: 'Size', values: ['S', 'M', 'L'] },
        { name: 'Color', values: ['Slate', 'Amber', 'Navy'] },
      ],
      parseProductVariants(hoodieProduct),
      5,
      'MERINO'
    );

    expect(matrix).toHaveLength(9);
    expect(matrix.find((v) => v.id === 'var_s_slate')?.stock).toBe(0);
    expect(matrix.find((v) => v.id === 'var_s_amber')?.stock).toBe(4);
    expect(matrix.find((v) => v.id === 'var_m_navy')?.price).toBe(135);
    expect(matrix.find((v) => v.id === 'var_l_navy')?.stock).toBe(5);
    expect(formatVariantLabel({ Size: 'L', Color: 'Navy' }, ['Size', 'Color'])).toBe('L / Navy');
  });

  it('generates distinct cart line keys per product variant', () => {
    expect(getCartLineKey('prod_11')).toBe('prod_11');
    expect(getCartLineKey('prod_11', 'var_s_amber')).toBe('prod_11::var_s_amber');
    expect(getCartLineKey('prod_11', 'var_m_navy')).toBe('prod_11::var_m_navy');
  });

  it('supports variant-aware stock checks and search filtering in catalog filters', () => {
    expect(isProductInStock(hoodieProduct)).toBe(true);

    const allOut: Product = {
      ...hoodieProduct,
      stock: 0,
      variants: [
        { id: 'var_s_slate', label: 'S / Slate', options: { Size: 'S', Color: 'Slate' }, stock: 0 },
      ],
    };
    expect(isProductInStock(allOut)).toBe(false);

    const matchColor = matchesCatalogFilters(hoodieProduct, {
      selectedCategory: null,
      searchQuery: 'Amber',
      priceRange: DEFAULT_PRICE_RANGE,
      minRating: null,
      featuredOnly: false,
      discountedOnly: false,
      inStockOnly: true,
    });
    expect(matchColor).toBe(true);
  });
});
