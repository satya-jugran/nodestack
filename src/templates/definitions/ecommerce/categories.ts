import { TemplateCollectionDef, TemplateSeedContext, SeedRecordResult } from '../../types';
import { TemplateImageGenerator } from '../../TemplateImageGenerator';
import { getStoreManagerRule } from './access';

export const categoriesCollection: TemplateCollectionDef = {
  name: 'categories',
  dto: {
    name: 'categories',
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
      { id: 'f_cat_name', name: 'name', type: 'text', required: true },
      { id: 'f_cat_slug', name: 'slug', type: 'text', required: true, unique: true },
      { id: 'f_cat_desc', name: 'description', type: 'text' },
      { id: 'f_cat_icon', name: 'icon', type: 'text' },
      { id: 'f_cat_img', name: 'image', type: 'file' },
    ],
  },
  seed: async (_ctx: TemplateSeedContext): Promise<SeedRecordResult[]> => {
    const categoriesData = [
      {
        id: 'cat_electronics',
        name: 'Electronics',
        slug: 'electronics',
        description: 'Next-gen audio, mechanical peripherals, visual displays & creative hardware',
        icon: 'headphones',
      },
      {
        id: 'cat_accessories',
        name: 'Accessories & EDC',
        slug: 'accessories',
        description: 'Engineered backpacks, horology timepieces, titanium optics & leather goods',
        icon: 'backpack',
      },
      {
        id: 'cat_apparel',
        name: 'Footwear & Apparel',
        slug: 'apparel',
        description: 'Merino performance wear, trail running silhouettes & daily technical basics',
        icon: 'shoe',
      },
      {
        id: 'cat_homeliving',
        name: 'Home & Living',
        slug: 'home-living',
        description: 'Ergonomic workstations, artisan coffee drippers, ambient glow & desktop craft',
        icon: 'chair',
      },
      {
        id: 'cat_wellness',
        name: 'Beauty & Wellness',
        slug: 'wellness',
        description: 'Botanical night serums, clean self-care remedies & artisanal fragrance notes',
        icon: 'bottle',
      },
    ];

    return categoriesData.map((cat, idx) => {
      const buffer = TemplateImageGenerator.generateCategorySvg(cat.name, cat.icon, idx);
      const filename = `${cat.slug}_hero.svg`;
      return {
        record: {
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          icon: cat.icon,
          image: filename,
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
