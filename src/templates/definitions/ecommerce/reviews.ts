import { TemplateCollectionDef, TemplateSeedContext } from '../../types';
import { REVIEWS_SEED_PART_1 } from './reviewsSeedPart1';
import { REVIEWS_SEED_PART_2 } from './reviewsSeedPart2';

export const reviewsCollection: TemplateCollectionDef = {
  name: 'reviews',
  dto: {
    name: 'reviews',
    type: 'base',
    listRule: '',
    viewRule: '',
    createRule: '@request.auth.id != "" && user = @request.auth.id',
    updateRule: '@request.auth.id != "" && user = @request.auth.id',
    deleteRule: '@request.auth.id != "" && user = @request.auth.id',
    schema: [
      {
        id: 'f_rev_prod',
        name: 'product',
        type: 'relation',
        options: { collectionId: 'products' },
      },
      { id: 'f_rev_user', name: 'user', type: 'relation', options: { collectionId: 'users' } },
      { id: 'f_rev_author', name: 'author', type: 'text', required: true },
      { id: 'f_rev_rating', name: 'rating', type: 'number', required: true },
      { id: 'f_rev_title', name: 'title', type: 'text' },
      { id: 'f_rev_content', name: 'content', type: 'text', required: true },
      { id: 'f_rev_verified', name: 'verifiedPurchase', type: 'bool' },
      { id: 'f_rev_helpful', name: 'helpfulVotes', type: 'number' },
    ],
  },
  seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => {
    return [...REVIEWS_SEED_PART_1, ...REVIEWS_SEED_PART_2];
  },
};
