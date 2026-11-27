import { TemplateCollectionDef, TemplateSeedContext, SeedRecordResult } from '../../types';
import { TemplateImageGenerator } from '../../TemplateImageGenerator';
import { getStoreManagerRule } from './access';
import { SEEDED_PRODUCT_VARIANTS } from './variants';
import { RAW_PRODUCTS_PART_1 } from './productsSeedPart1';
import { RAW_PRODUCTS_PART_2 } from './productsSeedPart2';

export const productsCollection: TemplateCollectionDef = {
  name: 'products',
  dto: {
    name: 'products',
    type: 'base',
    listRule: '',
    viewRule: '',
    get createRule() {
      return getStoreManagerRule();
    },
    get updateRule() {
      return getStoreManagerRule();
    },
    get deleteRule() {
      return getStoreManagerRule();
    },
    schema: [
      { id: 'f_prod_name', name: 'name', type: 'text', required: true },
      { id: 'f_prod_slug', name: 'slug', type: 'text', required: true, unique: true },
      { id: 'f_prod_desc', name: 'description', type: 'text' },
      { id: 'f_prod_price', name: 'price', type: 'number', required: true },
      { id: 'f_prod_orig_price', name: 'originalPrice', type: 'number' },
      { id: 'f_prod_stock', name: 'stock', type: 'number', required: true },
      {
        id: 'f_prod_cat',
        name: 'category',
        type: 'relation',
        options: { collectionId: 'categories' },
      },
      { id: 'f_prod_img', name: 'image', type: 'file', required: true },
      { id: 'f_prod_rating', name: 'rating', type: 'number' },
      { id: 'f_prod_featured', name: 'isFeatured', type: 'bool' },
      {
        id: 'f_prod_status',
        name: 'status',
        type: 'select',
        options: { values: ['in_stock', 'low_stock', 'out_of_stock', 'pre_order'] },
      },
      { id: 'f_prod_var_opts', name: 'variantOptions', type: 'json' },
      { id: 'f_prod_variants', name: 'variants', type: 'json' },
    ],
  },
  seed: async (ctx: TemplateSeedContext): Promise<SeedRecordResult[]> => {
    const catMap = ctx.collectionIdMap;
    void (catMap.get('categories') || 'categories');

    const rawProducts = [...RAW_PRODUCTS_PART_1, ...RAW_PRODUCTS_PART_2];

    return rawProducts.map((p, idx) => {
      const variantSpec = SEEDED_PRODUCT_VARIANTS[p.id];
      const computedStock = variantSpec
        ? variantSpec.variants.reduce((sum, v) => sum + v.stock, 0)
        : p.stock;
      const buffer = TemplateImageGenerator.generateProductSvg(
        {
          title: p.name,
          category: p.category.replace('cat_', ''),
          price: p.price,
          icon: p.icon,
        },
        idx
      );
      const filename = `${p.slug}.svg`;

      return {
        record: {
          id: p.id,
          name: p.name,
          slug: p.slug,
          description: p.description,
          price: p.price,
          ...(typeof p.originalPrice === 'number' ? { originalPrice: p.originalPrice } : {}),
          stock: computedStock,
          category: p.category,
          image: filename,
          rating: p.rating,
          isFeatured: p.isFeatured ? 1 : 0,
          status: p.status,
          variantOptions: variantSpec ? JSON.stringify(variantSpec.variantOptions) : null,
          variants: variantSpec ? JSON.stringify(variantSpec.variants) : null,
        },
        files: [
          {
            fieldName: 'image',
            filename,
            buffer,
            mimeType: 'image/svg+xml',
          },
        ],
      };
    });
  },
};
