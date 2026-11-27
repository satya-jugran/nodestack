export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  image?: string;
}

export interface VariantOptionGroup {
  name: string;
  values: string[];
}

export interface ProductVariant {
  id: string;
  sku?: string;
  label: string;
  options: Record<string, string>;
  stock: number;
  price?: number;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  originalPrice?: number;
  stock: number;
  category: string;
  image: string;
  rating?: number;
  reviewCount?: number;
  verifiedReviewCount?: number;
  helpfulVotesTotal?: number;
  favoriteCount?: number;
  isFeatured?: boolean;
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'pre_order';
  variantOptions?: VariantOptionGroup[] | string | null;
  variants?: ProductVariant[] | string | null;
  created?: string;
  updated?: string;
  expand?: {
    category?: Category;
  };
}

export interface Review {
  id: string;
  product: string;
  user?: string;
  author: string;
  rating: number;
  title?: string;
  content: string;
  verifiedPurchase?: boolean | number;
  helpfulVotes?: number;
  created?: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  image?: string;
  variantId?: string;
  variantLabel?: string;
  variantOptions?: Record<string, string>;
}

export interface Order {
  id: string;
  orderNumber: string;
  user?: string;
  customerName: string;
  customerEmail: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  total: number;
  items: string | OrderItem[]; // stringified JSON in sqlite
  shippingAddress: string;
  paymentStatus: 'paid' | 'pending' | 'refunded' | 'failed';
  discount?: number;
  couponCode?: string;
  trackingNumber?: string;
  carrier?: string;
  loyaltyPoints?: number;
  created?: string;
  updated?: string;
}

export interface Favorite {
  id: string;
  user: string;
  product: string;
  created?: string;
  expand?: {
    product?: Product;
  };
}

export interface User {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  created?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  variantId?: string;
  variantLabel?: string;
  variantOptions?: Record<string, string>;
  variant?: ProductVariant;
}

export interface CartItemRecord {
  id: string;
  user: string;
  product: string;
  quantity: number;
  variantId?: string;
  variantLabel?: string;
  variantOptions?: Record<string, string> | string;
  created?: string;
  updated?: string;
  expand?: {
    product?: Product;
  };
}

export interface AppliedCoupon {
  code: string;
  type: 'percent' | 'fixed' | 'shipping';
  description: string;
  discountPercent: number;
  discountAmount: number;
  freeShipping: boolean;
  minTotal?: number;
}

export type ViewMode = 'shopper' | 'manager';

export interface FlashSaleState {
  isActive: boolean;
  discountPercent: number;
  endsAt?: number;
  originalPrices?: Record<string, number>;
}

export interface ProductSocialProof {
  id: string;
  name: string;
  slug: string;
  category: string;
  price: number;
  originalPrice?: number;
  stock: number;
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'pre_order';
  isFeatured?: boolean | number;
  discountPercent: number;
  reviewCount: number;
  avgRating: number;
  verifiedReviewCount: number;
  helpfulVotesTotal: number;
  favoriteCount: number;
}

export interface ManagerOrderInsight {
  id: string;
  status: string;
  paymentStatus: string;
  couponCode: string;
  orderCount: number;
  grossRevenue: number;
  totalDiscount: number;
  avgOrderValue: number;
  loyaltyPointsIssued: number;
}

export interface ManagerCatalogInsight {
  id: string;
  name: string;
  slug: string;
  category: string;
  categoryName: string;
  price: number;
  originalPrice?: number;
  stock: number;
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'pre_order';
  inventoryValue: number;
  reviewCount: number;
  avgRating: number;
  helpfulVotesTotal: number;
  favoriteCount: number;
  inCartUnits: number;
  cartShoppersCount: number;
}

export interface SimulatedOrderEvent {
  id: string;
  customerName: string;
  productName: string;
  productId: string;
  variantLabel?: string;
  newStock: number;
  timestamp: number;
}

