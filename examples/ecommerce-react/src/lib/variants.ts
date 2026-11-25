import { Product, ProductVariant, VariantOptionGroup } from './types';

function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function parseVariantOptions(product: Pick<Product, 'variantOptions'>): VariantOptionGroup[] {
  return parseJsonArray<VariantOptionGroup>(product.variantOptions).filter(
    (g) => g && typeof g.name === 'string' && Array.isArray(g.values) && g.values.length > 0
  );
}

export function parseProductVariants(product: Pick<Product, 'variants'>): ProductVariant[] {
  return parseJsonArray<ProductVariant>(product.variants).filter(
    (v) => v && typeof v.id === 'string' && v.options && typeof v.options === 'object'
  );
}

export function hasProductVariants(product: Pick<Product, 'variants'>): boolean {
  return parseProductVariants(product).length > 0;
}

export function getTotalVariantStock(variants: ProductVariant[]): number {
  return variants.reduce((sum, v) => sum + Math.max(0, Number(v.stock) || 0), 0);
}

export function slugifyVariantToken(val: string): string {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function formatVariantLabel(
  options: Record<string, string>,
  optionOrder?: string[]
): string {
  const keys = optionOrder && optionOrder.length > 0 ? optionOrder : Object.keys(options);
  return keys
    .map((k) => options[k])
    .filter((v) => Boolean(v))
    .join(' / ');
}

export function getDefaultSelectedOptions(product: Product): Record<string, string> {
  const variants = parseProductVariants(product);
  if (variants.length === 0) return {};
  const firstInStock = variants.find((v) => (Number(v.stock) || 0) > 0);
  return { ...(firstInStock || variants[0]).options };
}

export function findMatchingVariant(
  product: Product,
  selectedOptions: Record<string, string>
): ProductVariant | undefined {
  const variants = parseProductVariants(product);
  const entries = Object.entries(selectedOptions).filter(([, v]) => Boolean(v));
  if (variants.length === 0 || entries.length === 0) return undefined;

  return variants.find((v) =>
    entries.every(([k, val]) => v.options?.[k] === val)
  );
}

export function findVariantById(
  product: Product,
  variantId?: string
): ProductVariant | undefined {
  if (!variantId) return undefined;
  return parseProductVariants(product).find((v) => v.id === variantId);
}

export function getEffectiveUnitPrice(product: Product, variant?: ProductVariant): number {
  if (variant && typeof variant.price === 'number' && Number.isFinite(variant.price) && variant.price > 0) {
    return variant.price;
  }
  return Number(product.price) || 0;
}

export function getEffectiveStock(product: Product, variant?: ProductVariant): number {
  if (variant) {
    return Math.max(0, Number(variant.stock) || 0);
  }
  const variants = parseProductVariants(product);
  if (variants.length > 0) {
    return getTotalVariantStock(variants);
  }
  return Math.max(0, Number(product.stock) || 0);
}

export function getCartLineKey(productId: string, variantId?: string): string {
  return variantId ? `${productId}::${variantId}` : productId;
}

export function isOptionValueAvailable(
  product: Product,
  optionName: string,
  optionValue: string,
  currentSelection: Record<string, string>
): boolean {
  const variants = parseProductVariants(product);
  if (variants.length === 0) return (Number(product.stock) || 0) > 0;

  const exactMatch = variants.find((v) => {
    if (v.options?.[optionName] !== optionValue) return false;
    return Object.entries(currentSelection).every(([k, val]) =>
      k === optionName ? true : v.options?.[k] === val
    );
  });

  if (exactMatch) {
    return (Number(exactMatch.stock) || 0) > 0;
  }

  return variants.some(
    (v) => v.options?.[optionName] === optionValue && (Number(v.stock) || 0) > 0
  );
}

export function buildVariantMatrix(
  optionGroups: VariantOptionGroup[],
  existingVariants: ProductVariant[] = [],
  defaultStock = 10,
  skuPrefix = 'SKU'
): ProductVariant[] {
  const validGroups = optionGroups
    .map((g) => ({
      name: g.name.trim(),
      values: g.values.map((v) => v.trim()).filter(Boolean),
    }))
    .filter((g) => g.name && g.values.length > 0);

  if (validGroups.length === 0) return [];

  let combos: Array<Record<string, string>> = [{}];
  for (const group of validGroups) {
    const next: Array<Record<string, string>> = [];
    for (const combo of combos) {
      for (const val of group.values) {
        next.push({ ...combo, [group.name]: val });
      }
    }
    combos = next;
  }

  const cleanPrefix = (skuPrefix || 'SKU')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'SKU';

  return combos.map((options) => {
    const orderedVals = validGroups.map((g) => options[g.name]);
    const id = `var_${orderedVals.map(slugifyVariantToken).join('_')}`;
    const label = orderedVals.join(' / ');
    const existing = existingVariants.find(
      (ev) =>
        ev.id === id ||
        (ev.options &&
          validGroups.every((g) => ev.options[g.name] === options[g.name]) &&
          Object.keys(ev.options).length === validGroups.length)
    );

    return {
      id,
      sku:
        existing?.sku ||
        `${cleanPrefix}-${orderedVals.map((v) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '')).join('-')}`,
      label,
      options,
      stock: existing ? Math.max(0, Number(existing.stock) || 0) : Math.max(0, defaultStock),
      ...(typeof existing?.price === 'number' && existing.price > 0
        ? { price: existing.price }
        : {}),
    };
  });
}

const COLOR_SWATCH_MAP: Record<string, string> = {
  slate: '#475569',
  amber: '#d97706',
  navy: '#1e3a8a',
  black: '#0f172a',
  white: '#f8fafc',
  charcoal: '#334155',
  olive: '#4d7c0f',
  forest: '#166534',
  sand: '#d6d3d1',
  crimson: '#be123c',
  cobalt: '#2563eb',
  silver: '#cbd5e1',
  titanium: '#64748b',
  leather: '#78350f',
};

export function getColorSwatchHex(value: string): string | null {
  const key = value.trim().toLowerCase();
  return COLOR_SWATCH_MAP[key] || null;
}
