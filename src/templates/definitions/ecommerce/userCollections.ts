import { TemplateCollectionDef, TemplateSeedContext } from '../../types';

const AUTH_OWNER_RULE = '@request.auth.id != "" && user = @request.auth.id';

export const favoritesCollection: TemplateCollectionDef = {
  name: 'favorites',
  dto: {
    name: 'favorites',
    type: 'base',
    listRule: AUTH_OWNER_RULE,
    viewRule: AUTH_OWNER_RULE,
    createRule: AUTH_OWNER_RULE,
    updateRule: AUTH_OWNER_RULE,
    deleteRule: AUTH_OWNER_RULE,
    schema: [
      {
        id: 'f_fav_user',
        name: 'user',
        type: 'relation',
        required: true,
        options: { collectionId: 'users' },
      },
      {
        id: 'f_fav_prod',
        name: 'product',
        type: 'relation',
        required: true,
        options: { collectionId: 'products' },
      },
    ],
  },
  seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => [],
};

export const cartItemsCollection: TemplateCollectionDef = {
  name: 'cart_items',
  dto: {
    name: 'cart_items',
    type: 'base',
    listRule: AUTH_OWNER_RULE,
    viewRule: AUTH_OWNER_RULE,
    createRule: AUTH_OWNER_RULE,
    updateRule: AUTH_OWNER_RULE,
    deleteRule: AUTH_OWNER_RULE,
    schema: [
      {
        id: 'f_cart_user',
        name: 'user',
        type: 'relation',
        required: true,
        options: { collectionId: 'users' },
      },
      {
        id: 'f_cart_prod',
        name: 'product',
        type: 'relation',
        required: true,
        options: { collectionId: 'products' },
      },
      {
        id: 'f_cart_qty',
        name: 'quantity',
        type: 'number',
        required: true,
      },
      { id: 'f_cart_var_id', name: 'variantId', type: 'text' },
      { id: 'f_cart_var_label', name: 'variantLabel', type: 'text' },
      { id: 'f_cart_var_opts', name: 'variantOptions', type: 'json' },
    ],
  },
  seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => [],
};
