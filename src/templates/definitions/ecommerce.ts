import { TemplateDefinition } from '../types';
import { getStoreManagerEmail, getStoreManagerRule } from './ecommerce/access';
import {
  SEEDED_PRODUCT_VARIANTS,
  SeedVariantOptionGroup,
  SeedProductVariant,
} from './ecommerce/variants';
import { categoriesCollection } from './ecommerce/categories';
import { productsCollection } from './ecommerce/products';
import { ordersCollection } from './ecommerce/orders';
import { reviewsCollection } from './ecommerce/reviews';
import { favoritesCollection, cartItemsCollection } from './ecommerce/userCollections';
import { productSocialProofView } from './ecommerce/views/productSocialProof';
import { managerOrderInsightsView } from './ecommerce/views/managerOrderInsights';
import { managerCatalogInsightsView } from './ecommerce/views/managerCatalogInsights';
import { calculateDiscountFunction } from './ecommerce/functions/calculateDiscount';
import { validateOrderFunction } from './ecommerce/functions/validateOrder';
import { updateInventoryFunction } from './ecommerce/functions/updateInventory';
import {
  generateTrackingLabelFunction,
  grantLoyaltyPointsFunction,
  sendOrderNotificationFunction,
} from './ecommerce/functions/fulfillmentHelpers';
import { upvoteReviewFunction } from './ecommerce/functions/engagementFunctions';
import { ecommerceFlows } from './ecommerce/flows';

export {
  getStoreManagerEmail,
  getStoreManagerRule,
  SEEDED_PRODUCT_VARIANTS,
  SeedVariantOptionGroup,
  SeedProductVariant,
};

export const ecommerceTemplate: TemplateDefinition = {
  id: 'ecommerce',
  name: 'E-Commerce',
  tagline: 'Instant storefront with products, categories, orders, reviews, favorites & cart',
  description:
    'Full-featured retail schema pre-seeded with 20 realistic products, custom generated SVG product images, relational categories, customer orders, verified reviews, user favorites, and shopping cart.',
  icon: '🛒',
  badge: '20 Items & Images',
  aliases: ['ecommerce', 'e-commerce', 'shop', 'store'],
  stats: {
    collections: 9,
    records: 48,
    images: 25,
    functions: 6,
    flows: 2,
  },
  collections: [
    categoriesCollection,
    productsCollection,
    ordersCollection,
    reviewsCollection,
    favoritesCollection,
    cartItemsCollection,
    productSocialProofView,
    managerOrderInsightsView,
    managerCatalogInsightsView,
  ],
  functions: [
    calculateDiscountFunction,
    validateOrderFunction,
    updateInventoryFunction,
    generateTrackingLabelFunction,
    grantLoyaltyPointsFunction,
    sendOrderNotificationFunction,
    upvoteReviewFunction,
  ],
  flows: ecommerceFlows,
};
