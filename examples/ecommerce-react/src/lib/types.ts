export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  image?: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  image: string;
  rating?: number;
  reviewCount?: number;
  isFeatured?: boolean;
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'pre_order';
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
  created?: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  image?: string;
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
}

export interface CartItemRecord {
  id: string;
  user: string;
  product: string;
  quantity: number;
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
}
