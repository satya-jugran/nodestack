export interface SeedVariantOptionGroup {
  name: string;
  values: string[];
}

export interface SeedProductVariant {
  id: string;
  sku: string;
  label: string;
  options: Record<string, string>;
  stock: number;
  price?: number;
}

function slugifyVariantToken(val: string): string {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildSeedVariants(
  skuPrefix: string,
  optionGroups: SeedVariantOptionGroup[],
  stocks: number[],
  prices?: Record<string, number>
): { variantOptions: SeedVariantOptionGroup[]; variants: SeedProductVariant[]; totalStock: number } {
  let combos: Array<Record<string, string>> = [{}];
  for (const group of optionGroups) {
    const next: Array<Record<string, string>> = [];
    for (const combo of combos) {
      for (const val of group.values) {
        next.push({ ...combo, [group.name]: val });
      }
    }
    combos = next;
  }

  const variants: SeedProductVariant[] = combos.map((options, idx) => {
    const orderedVals = optionGroups.map((g) => options[g.name]);
    const id = `var_${orderedVals.map(slugifyVariantToken).join('_')}`;
    const label = orderedVals.join(' / ');
    const sku = `${skuPrefix}-${orderedVals.map((v) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '')).join('-')}`;
    const stock = Math.max(0, Number(stocks[idx] ?? 0));
    const priceOverride = prices?.[id];
    return {
      id,
      sku,
      label,
      options,
      stock,
      ...(typeof priceOverride === 'number' ? { price: priceOverride } : {}),
    };
  });

  const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
  return { variantOptions: optionGroups, variants, totalStock };
}

export const SEEDED_PRODUCT_VARIANTS: Record<
  string,
  { variantOptions: SeedVariantOptionGroup[]; variants: SeedProductVariant[] }
> = {
  prod_01: buildSeedVariants(
    'AURA-ANC',
    [{ name: 'Color', values: ['Slate', 'Amber', 'Navy'] }],
    [20, 10, 15]
  ),
  prod_02: buildSeedVariants(
    'KEY-LUM',
    [
      { name: 'Switch', values: ['Tactile', 'Linear'] },
      { name: 'Color', values: ['Slate', 'Navy'] },
    ],
    [10, 8, 9, 5]
  ),
  prod_06: buildSeedVariants(
    'NOMAD-24L',
    [{ name: 'Color', values: ['Slate', 'Navy'] }],
    [22, 16]
  ),
  prod_07: buildSeedVariants(
    'VANG-TI',
    [
      { name: 'Strap', values: ['Titanium', 'Leather'] },
      { name: 'Color', values: ['Slate', 'Amber'] },
    ],
    [5, 3, 4, 2]
  ),
  prod_11: buildSeedVariants(
    'MERINO-HD',
    [
      { name: 'Size', values: ['S', 'M', 'L'] },
      { name: 'Color', values: ['Slate', 'Amber', 'Navy'] },
    ],
    [5, 0, 2, 8, 4, 7, 6, 3, 7]
  ),
  prod_12: buildSeedVariants(
    'TERRA-SH',
    [
      { name: 'Size', values: ['8', '9', '10', '11'] },
      { name: 'Color', values: ['Slate', 'Amber', 'Navy'] },
    ],
    [3, 2, 0, 4, 3, 2, 5, 0, 3, 2, 1, 1]
  ),
  prod_13: buildSeedVariants(
    'AERO-TS',
    [
      { name: 'Size', values: ['S', 'M', 'L'] },
      { name: 'Color', values: ['Slate', 'Amber', 'Navy'] },
    ],
    [10, 6, 9, 14, 8, 12, 8, 0, 13]
  ),
  prod_14: buildSeedVariants(
    'URBAN-SN',
    [
      { name: 'Size', values: ['8', '9', '10', '11'] },
      { name: 'Color', values: ['Slate', 'Navy'] },
    ],
    [5, 4, 6, 5, 7, 4, 0, 4]
  ),
  prod_15: buildSeedVariants(
    'ZEN-CHR',
    [{ name: 'Color', values: ['Slate', 'Navy'] }],
    [5, 3]
  ),
};
