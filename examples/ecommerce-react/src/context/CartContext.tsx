import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { CartItem, Product, AppliedCoupon } from '../lib/types';
import { client } from '../lib/nodestack';
import { useAuth } from './AuthContext';

interface CartContextType {
  items: CartItem[];
  addToCart: (product: Product, quantity?: number) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  itemCount: number;
  subtotal: number;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  // Coupon & Discount states
  coupon: AppliedCoupon | null;
  bundlePerk: string | null;
  isApplyingCoupon: boolean;
  couponError: string | null;
  applyCoupon: (code: string) => Promise<{ success: boolean; message: string }>;
  removeCoupon: () => void;
  discountAmount: number;
  shippingCost: number;
  orderTotal: number;
  isLoading: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const GUEST_CART_KEY = 'nodestack_ecommerce_guest_cart';
const COUPON_STORAGE_KEY = 'nodestack_ecommerce_coupon';

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  // Map productId -> backend cart_items record id
  const [recordIdMap, setRecordIdMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

  const [coupon, setCoupon] = useState<AppliedCoupon | null>(() => {
    try {
      const saved = localStorage.getItem(COUPON_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [bundlePerk, setBundlePerk] = useState<string | null>(null);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Synchronize cart whenever auth state changes (login / logout)
  useEffect(() => {
    let isMounted = true;

    async function loadCart() {
      if (isAuthenticated && user) {
        setIsLoading(true);
        try {
          // 1. Fetch user's cart records from NodeStack SQLite backend
          const res = await client.collection('cart_items').getList(1, 100, {
            filter: `user = "${user.id}"`,
            expand: 'product',
          });

          // Fetch products catalog if needed for expansion
          let catalogMap: Record<string, Product> | null = null;
          const needCatalogLookup = res.items.some((item: any) => !item.expand?.product);
          if (needCatalogLookup) {
            try {
              const pRes = await client.collection('products').getList(1, 100);
              catalogMap = {};
              for (const p of pRes.items) {
                catalogMap[p.id] = p as unknown as Product;
              }
            } catch {}
          }

          if (!isMounted) return;

          const loadedItems: CartItem[] = [];
          const rMap: Record<string, string> = {};

          for (const item of res.items as any[]) {
            const product: Product = item.expand?.product || catalogMap?.[item.product];
            if (product) {
              loadedItems.push({
                product,
                quantity: Number(item.quantity) || 1,
              });
              rMap[product.id] = item.id;
            }
          }

          // 2. Check if any guest items in localStorage should be merged into the user's backend cart
          try {
            const savedGuest = localStorage.getItem(GUEST_CART_KEY);
            if (savedGuest) {
              const guestItems: CartItem[] = JSON.parse(savedGuest);
              for (const gItem of guestItems) {
                const existingIdx = loadedItems.findIndex((it) => it.product.id === gItem.product.id);
                if (existingIdx >= 0) {
                  const newQty = loadedItems[existingIdx].quantity + gItem.quantity;
                  loadedItems[existingIdx].quantity = newQty;
                  const rId = rMap[gItem.product.id];
                  if (rId) {
                    await client.collection('cart_items').update(rId, { quantity: newQty });
                  }
                } else {
                  loadedItems.push(gItem);
                  const created = await client.collection('cart_items').create({
                    user: user.id,
                    product: gItem.product.id,
                    quantity: gItem.quantity,
                  });
                  rMap[gItem.product.id] = created.id;
                }
              }
              localStorage.removeItem(GUEST_CART_KEY);
            }
          } catch (mergeErr) {
            console.warn('Guest cart merge note:', mergeErr);
          }

          if (isMounted) {
            setItems(loadedItems);
            setRecordIdMap(rMap);
          }
        } catch (err) {
          console.warn('Backend cart load notice:', err);
          if (isMounted) loadGuestCart();
        } finally {
          if (isMounted) setIsLoading(false);
        }
      } else {
        // User logged out: clear record map and load guest cart from localStorage
        setRecordIdMap({});
        loadGuestCart();
      }
    }

    function loadGuestCart() {
      try {
        const saved = localStorage.getItem(GUEST_CART_KEY);
        setItems(saved ? JSON.parse(saved) : []);
      } catch {
        setItems([]);
      }
    }

    loadCart();

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, user?.id]);

  // Persist coupon to localStorage
  useEffect(() => {
    try {
      if (coupon) {
        localStorage.setItem(COUPON_STORAGE_KEY, JSON.stringify(coupon));
      } else {
        localStorage.removeItem(COUPON_STORAGE_KEY);
      }
    } catch (e) {
      console.error('Failed to save coupon to localStorage', e);
    }
  }, [coupon]);

  const addToCart = async (product: Product, quantity: number = 1) => {
    setIsCartOpen(true);

    if (isAuthenticated && user) {
      const existing = items.find((item) => item.product.id === product.id);
      const newQty = existing ? existing.quantity + quantity : quantity;

      // Optimistic UI update
      setItems((prev) => {
        const exists = prev.find((item) => item.product.id === product.id);
        if (exists) {
          return prev.map((item) =>
            item.product.id === product.id ? { ...item, quantity: item.quantity + quantity } : item
          );
        }
        return [...prev, { product, quantity }];
      });

      try {
        const existingRecordId = recordIdMap[product.id];
        if (existingRecordId) {
          await client.collection('cart_items').update(existingRecordId, { quantity: newQty });
        } else {
          const created = await client.collection('cart_items').create({
            user: user.id,
            product: product.id,
            quantity: newQty,
          });
          setRecordIdMap((prev) => ({ ...prev, [product.id]: created.id }));
        }
      } catch (err) {
        console.error('Failed to sync added cart item to NodeStack backend:', err);
      }
    } else {
      // Guest mode
      setItems((prev) => {
        const existing = prev.find((item) => item.product.id === product.id);
        const next = existing
          ? prev.map((item) => (item.product.id === product.id ? { ...item, quantity: item.quantity + quantity } : item))
          : [...prev, { product, quantity }];
        try {
          localStorage.setItem(GUEST_CART_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    }
  };

  const removeFromCart = async (productId: string) => {
    setItems((prev) => prev.filter((item) => item.product.id !== productId));

    if (isAuthenticated && user) {
      const recordId = recordIdMap[productId];
      if (recordId) {
        setRecordIdMap((prev) => {
          const copy = { ...prev };
          delete copy[productId];
          return copy;
        });
        try {
          await client.collection('cart_items').delete(recordId);
        } catch (err) {
          console.error('Failed to remove cart item from NodeStack backend:', err);
        }
      }
    } else {
      setItems((current) => {
        try {
          localStorage.setItem(GUEST_CART_KEY, JSON.stringify(current));
        } catch {}
        return current;
      });
    }
  };

  const updateQuantity = async (productId: string, quantity: number) => {
    if (quantity <= 0) {
      await removeFromCart(productId);
      return;
    }

    setItems((prev) =>
      prev.map((item) => (item.product.id === productId ? { ...item, quantity } : item))
    );

    if (isAuthenticated && user) {
      const recordId = recordIdMap[productId];
      if (recordId) {
        try {
          await client.collection('cart_items').update(recordId, { quantity });
        } catch (err) {
          console.error('Failed to update cart item quantity in NodeStack backend:', err);
        }
      }
    } else {
      setItems((current) => {
        try {
          localStorage.setItem(GUEST_CART_KEY, JSON.stringify(current));
        } catch {}
        return current;
      });
    }
  };

  const clearCart = async () => {
    setItems([]);
    setCoupon(null);
    setBundlePerk(null);
    try {
      localStorage.removeItem(GUEST_CART_KEY);
      localStorage.removeItem(COUPON_STORAGE_KEY);
    } catch {}

    if (isAuthenticated && user) {
      const idsToDelete = Object.values(recordIdMap);
      setRecordIdMap({});
      for (const rId of idsToDelete) {
        try {
          await client.collection('cart_items').delete(rId);
        } catch (err) {
          console.warn('Failed to delete cart item on clearCart:', err);
        }
      }
    }
  };

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );

  // Dynamic calculation based on current cart subtotal
  let calculatedDiscount = 0;
  if (coupon) {
    if (coupon.type === 'percent') {
      calculatedDiscount = Math.round(subtotal * (coupon.discountPercent / 100) * 100) / 100;
    } else if (coupon.type === 'fixed') {
      calculatedDiscount = Math.min(subtotal, coupon.discountAmount);
    }
  }

  // Free shipping reached at $100 or with FREESHIP coupon
  const FREE_SHIPPING_THRESHOLD = 100;
  const isFreeShipping = (coupon?.freeShipping) || subtotal >= FREE_SHIPPING_THRESHOLD || items.length === 0;
  const shippingCost = isFreeShipping ? 0 : 9.99;
  const orderTotal = Math.max(0, Math.round((subtotal - calculatedDiscount + shippingCost) * 100) / 100);

  // Check bundle perk if order reaches $150
  useEffect(() => {
    if (subtotal >= 150) {
      setBundlePerk('Free Premium Express Packaging + $15 Gift Credit');
    } else {
      setBundlePerk(null);
    }
  }, [subtotal]);

  // Apply Coupon via Step-Function Flow: CheckoutPromotionFlow
  const applyCoupon = async (rawCode: string): Promise<{ success: boolean; message: string }> => {
    const code = rawCode.trim().toUpperCase();
    if (!code) {
      setCouponError('Please enter a coupon code.');
      return { success: false, message: 'Please enter a coupon code.' };
    }

    setIsApplyingCoupon(true);
    setCouponError(null);

    try {
      const payload = {
        couponCode: code,
        cartTotal: subtotal,
        items: items.map((i) => ({
          productId: i.product.id,
          name: i.product.name,
          price: i.product.price,
          quantity: i.quantity,
        })),
      };

      // 1. Execute NodeStack Step-Function Flow: CheckoutPromotionFlow
      let res: any = null;
      try {
        const execution = await client.flows.execute<{
          status: string;
          output?: {
            discountResult?: any;
            bundlePerk?: {
              unlockedPerk?: string;
              giftCredit?: number;
            };
          };
        }>('CheckoutPromotionFlow', payload, { wait: true });

        if (execution?.output?.discountResult) {
          res = execution.output.discountResult;
          if (execution.output.bundlePerk?.unlockedPerk) {
            setBundlePerk(execution.output.bundlePerk.unlockedPerk);
          }
        }
      } catch (flowErr) {
        console.warn('CheckoutPromotionFlow fallback to lambda:', flowErr);
      }

      // 2. Fallback to direct lambda invocation if flow did not return discountResult
      if (!res) {
        res = await client.functions.invoke<{
          valid: boolean;
          code: string;
          type: 'percent' | 'fixed' | 'shipping';
          description: string;
          discountPercent: number;
          discountAmount: number;
          freeShipping: boolean;
          message: string;
        }>('calculate-discount', payload);
      }

      if (res && res.valid) {
        const applied: AppliedCoupon = {
          code: res.code,
          type: res.type,
          description: res.description,
          discountPercent: res.discountPercent || 0,
          discountAmount: res.discountAmount || 0,
          freeShipping: Boolean(res.freeShipping),
        };
        setCoupon(applied);
        setCouponError(null);
        return { success: true, message: res.message || 'Coupon applied successfully!' };
      } else {
        const msg = res?.message || `Coupon "${code}" could not be applied.`;
        setCouponError(msg);
        return { success: false, message: msg };
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to calculate coupon discount.';
      setCouponError(msg);
      return { success: false, message: msg };
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const removeCoupon = () => {
    setCoupon(null);
    setCouponError(null);
  };

  return (
    <CartContext.Provider
      value={{
        items,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        itemCount,
        subtotal,
        isCartOpen,
        setIsCartOpen,
        coupon,
        bundlePerk,
        isApplyingCoupon,
        couponError,
        applyCoupon,
        removeCoupon,
        discountAmount: calculatedDiscount,
        shippingCost,
        orderTotal,
        isLoading,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
