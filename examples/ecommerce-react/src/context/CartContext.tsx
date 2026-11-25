import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { CartItem, Product, ProductVariant, AppliedCoupon } from '../lib/types';
import { client } from '../lib/nodestack';
import {
  findMatchingVariant,
  findVariantById,
  getCartLineKey,
  getDefaultSelectedOptions,
  getEffectiveStock,
  getEffectiveUnitPrice,
  hasProductVariants,
} from '../lib/variants';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

interface CartContextType {
  items: CartItem[];
  addToCart: (product: Product, quantity?: number, variant?: ProductVariant) => void;
  removeFromCart: (lineKeyOrProductId: string) => void;
  updateQuantity: (lineKeyOrProductId: string, quantity: number) => void;
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
  meetsMinSpend: boolean;
}

export const KNOWN_COUPON_MIN_TOTALS: Record<string, number> = {
  WELCOME10: 0,
  SAVE20: 75,
  FLAT50: 150,
  FREESHIP: 0,
  VIP30: 200,
};

const CartContext = createContext<CartContextType | undefined>(undefined);

const GUEST_CART_KEY = 'nodestack_ecommerce_guest_cart';
const COUPON_STORAGE_KEY = 'nodestack_ecommerce_coupon';

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
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
              const variantId = typeof item.variantId === 'string' && item.variantId ? item.variantId : undefined;
              const matchedVariant = variantId ? findVariantById(product, variantId) : undefined;
              let parsedOpts: Record<string, string> | undefined = matchedVariant?.options;
              if (!parsedOpts && item.variantOptions) {
                if (typeof item.variantOptions === 'string') {
                  try {
                    parsedOpts = JSON.parse(item.variantOptions);
                  } catch {}
                } else if (typeof item.variantOptions === 'object') {
                  parsedOpts = item.variantOptions;
                }
              }
              const lineKey = getCartLineKey(product.id, variantId);
              loadedItems.push({
                product,
                quantity: Number(item.quantity) || 1,
                variantId,
                variantLabel: item.variantLabel || matchedVariant?.label || undefined,
                variantOptions: parsedOpts,
                variant: matchedVariant,
              });
              rMap[lineKey] = item.id;
            }
          }

          // 2. Check if any guest items in localStorage should be merged into the user's backend cart
          try {
            const savedGuest = localStorage.getItem(GUEST_CART_KEY);
            if (savedGuest) {
              const guestItems: CartItem[] = JSON.parse(savedGuest);
              const unmergedItems: CartItem[] = [];

              for (const gItem of guestItems) {
                try {
                  const gKey = getCartLineKey(gItem.product.id, gItem.variantId);
                  const existingIdx = loadedItems.findIndex(
                    (it) => getCartLineKey(it.product.id, it.variantId) === gKey
                  );
                  if (existingIdx >= 0) {
                    const newQty = loadedItems[existingIdx].quantity + gItem.quantity;
                    const rId = rMap[gKey];
                    if (rId) {
                      await client.collection('cart_items').update(rId, { quantity: newQty });
                    }
                    loadedItems[existingIdx].quantity = newQty;
                  } else {
                    const created = await client.collection('cart_items').create({
                      user: user.id,
                      product: gItem.product.id,
                      quantity: gItem.quantity,
                      ...(gItem.variantId ? { variantId: gItem.variantId } : {}),
                      ...(gItem.variantLabel ? { variantLabel: gItem.variantLabel } : {}),
                      ...(gItem.variantOptions ? { variantOptions: gItem.variantOptions } : {}),
                    });
                    rMap[gKey] = created.id;
                    loadedItems.push(gItem);
                  }
                } catch (itemErr) {
                  console.warn(`Failed to merge guest cart item "${gItem.product?.name || gItem.product?.id}":`, itemErr);
                  unmergedItems.push(gItem);
                }
              }

              if (unmergedItems.length === 0) {
                localStorage.removeItem(GUEST_CART_KEY);
              } else {
                localStorage.setItem(GUEST_CART_KEY, JSON.stringify(unmergedItems));
              }
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

  const matchesLineKey = (item: CartItem, lineKeyOrProductId: string): boolean => {
    const key = getCartLineKey(item.product.id, item.variantId);
    return key === lineKeyOrProductId || item.product.id === lineKeyOrProductId;
  };

  const addToCart = async (product: Product, quantity: number = 1, variant?: ProductVariant) => {
    const resolvedVariant =
      variant ||
      (hasProductVariants(product)
        ? findMatchingVariant(product, getDefaultSelectedOptions(product))
        : undefined);
    const variantId = resolvedVariant?.id;
    const variantLabel = resolvedVariant?.label;
    const variantOptions = resolvedVariant?.options;
    const lineKey = getCartLineKey(product.id, variantId);
    const maxStock = getEffectiveStock(product, resolvedVariant);

    if (maxStock <= 0) {
      toast.warning(
        'Out of stock',
        variantLabel ? `${product.name} (${variantLabel}) is currently unavailable.` : `${product.name} is out of stock.`,
        { dedupeKey: `cart-oos:${lineKey}` }
      );
      return;
    }

    const existingItem = items.find((item) => getCartLineKey(item.product.id, item.variantId) === lineKey);
    const currentQty = existingItem?.quantity || 0;
    const clampedNewQty = Math.min(maxStock, currentQty + quantity);
    const addedQty = clampedNewQty - currentQty;

    setIsCartOpen(true);
    if (addedQty <= 0) {
      toast.info(
        'Stock limit reached',
        `Only ${maxStock} ${maxStock === 1 ? 'unit' : 'units'} available${variantLabel ? ` for ${variantLabel}` : ''}.`,
        { dedupeKey: `cart-max:${lineKey}` }
      );
      return;
    }

    const itemTitle = variantLabel ? `${product.name} (${variantLabel})` : product.name;
    toast.success(
      'Added to cart',
      addedQty > 1 ? `${addedQty} × ${itemTitle}` : itemTitle,
      { dedupeKey: `cart-add:${lineKey}` }
    );

    if (isAuthenticated && user) {
      // Optimistic UI update
      setItems((prev) => {
        const exists = prev.find((item) => getCartLineKey(item.product.id, item.variantId) === lineKey);
        if (exists) {
          return prev.map((item) =>
            getCartLineKey(item.product.id, item.variantId) === lineKey
              ? { ...item, quantity: clampedNewQty, variant: resolvedVariant || item.variant }
              : item
          );
        }
        return [
          ...prev,
          {
            product,
            quantity: clampedNewQty,
            variantId,
            variantLabel,
            variantOptions,
            variant: resolvedVariant,
          },
        ];
      });

      try {
        const existingRecordId = recordIdMap[lineKey];
        if (existingRecordId) {
          await client.collection('cart_items').update(existingRecordId, { quantity: clampedNewQty });
        } else {
          const created = await client.collection('cart_items').create({
            user: user.id,
            product: product.id,
            quantity: clampedNewQty,
            ...(variantId ? { variantId } : {}),
            ...(variantLabel ? { variantLabel } : {}),
            ...(variantOptions ? { variantOptions } : {}),
          });
          setRecordIdMap((prev) => ({ ...prev, [lineKey]: created.id }));
        }
      } catch (err) {
        console.error('Failed to sync added cart item to NodeStack backend:', err);
      }
    } else {
      // Guest mode
      setItems((prev) => {
        const existing = prev.find((item) => getCartLineKey(item.product.id, item.variantId) === lineKey);
        const next = existing
          ? prev.map((item) =>
              getCartLineKey(item.product.id, item.variantId) === lineKey
                ? { ...item, quantity: clampedNewQty, variant: resolvedVariant || item.variant }
                : item
            )
          : [
              ...prev,
              {
                product,
                quantity: clampedNewQty,
                variantId,
                variantLabel,
                variantOptions,
                variant: resolvedVariant,
              },
            ];
        try {
          localStorage.setItem(GUEST_CART_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    }
  };

  const removeFromCart = async (lineKeyOrProductId: string) => {
    const removed = items.find((item) => matchesLineKey(item, lineKeyOrProductId));
    const resolvedKey = removed
      ? getCartLineKey(removed.product.id, removed.variantId)
      : lineKeyOrProductId;
    setItems((prev) => prev.filter((item) => getCartLineKey(item.product.id, item.variantId) !== resolvedKey));
    if (removed) {
      toast.info(
        'Removed from cart',
        removed.variantLabel ? `${removed.product.name} (${removed.variantLabel})` : removed.product.name,
        { dedupeKey: `cart-remove:${resolvedKey}` }
      );
    }

    if (isAuthenticated && user) {
      const recordId = recordIdMap[resolvedKey];
      if (recordId) {
        setRecordIdMap((prev) => {
          const copy = { ...prev };
          delete copy[resolvedKey];
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

  const updateQuantity = async (lineKeyOrProductId: string, quantity: number) => {
    const targetItem = items.find((item) => matchesLineKey(item, lineKeyOrProductId));
    const resolvedKey = targetItem
      ? getCartLineKey(targetItem.product.id, targetItem.variantId)
      : lineKeyOrProductId;

    if (quantity <= 0) {
      await removeFromCart(resolvedKey);
      return;
    }

    const maxStock = targetItem ? getEffectiveStock(targetItem.product, targetItem.variant) : quantity;
    const clampedQty = maxStock > 0 ? Math.min(quantity, maxStock) : quantity;

    setItems((prev) =>
      prev.map((item) =>
        getCartLineKey(item.product.id, item.variantId) === resolvedKey
          ? { ...item, quantity: clampedQty }
          : item
      )
    );

    if (isAuthenticated && user) {
      const recordId = recordIdMap[resolvedKey];
      if (recordId) {
        try {
          await client.collection('cart_items').update(recordId, { quantity: clampedQty });
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
    (sum, item) => sum + getEffectiveUnitPrice(item.product, item.variant) * item.quantity,
    0
  );

  // Dynamic calculation based on current cart subtotal and minimum order requirements
  const couponMinTotal = coupon?.minTotal ?? (coupon?.code ? (KNOWN_COUPON_MIN_TOTALS[coupon.code] ?? 0) : 0);
  const meetsMinSpend = Boolean(coupon && subtotal >= couponMinTotal && items.length > 0);

  let calculatedDiscount = 0;
  if (coupon && meetsMinSpend) {
    if (coupon.type === 'percent') {
      calculatedDiscount = Math.round(subtotal * (coupon.discountPercent / 100) * 100) / 100;
    } else if (coupon.type === 'fixed') {
      calculatedDiscount = Math.min(subtotal, coupon.discountAmount);
    }
  }

  // Free shipping reached at $100 or with qualifying FREESHIP coupon
  const FREE_SHIPPING_THRESHOLD = 100;
  const isFreeShipping = (coupon?.freeShipping && meetsMinSpend) || subtotal >= FREE_SHIPPING_THRESHOLD || items.length === 0;
  const shippingCost = isFreeShipping ? 0 : 9.99;
  const orderTotal = Math.max(0, Math.round((subtotal - calculatedDiscount + shippingCost) * 100) / 100);

  // Revalidate coupon minimum spend when cart items/subtotal change
  useEffect(() => {
    if (!coupon) return;

    if (items.length === 0) {
      setCoupon(null);
      setCouponError(null);
      return;
    }

    const minSpend = coupon.minTotal ?? (KNOWN_COUPON_MIN_TOTALS[coupon.code] ?? 0);
    if (subtotal < minSpend) {
      const shortfall = (minSpend - subtotal).toFixed(2);
      setCouponError(
        `Coupon "${coupon.code}" requires a minimum order of $${minSpend.toFixed(2)} (add $${shortfall} more to qualify).`
      );
    } else {
      // Clear error once cart qualifies again
      setCouponError((prev) => (prev?.includes(coupon.code) ? null : prev));
    }
  }, [subtotal, items.length, coupon?.code, coupon?.minTotal]);

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
      toast.warning('Enter a coupon code', 'Please enter a promo code to apply.', {
        dedupeKey: 'coupon',
      });
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
          price: getEffectiveUnitPrice(i.product, i.variant),
          quantity: i.quantity,
          ...(i.variantId ? { variantId: i.variantId } : {}),
          ...(i.variantLabel ? { variantLabel: i.variantLabel } : {}),
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
        const minSpend = typeof res.minTotal === 'number'
          ? res.minTotal
          : (KNOWN_COUPON_MIN_TOTALS[res.code] ?? 0);

        const applied: AppliedCoupon = {
          code: res.code,
          type: res.type,
          description: res.description,
          discountPercent: res.discountPercent || 0,
          discountAmount: res.discountAmount || 0,
          freeShipping: Boolean(res.freeShipping),
          minTotal: minSpend,
        };
        setCoupon(applied);
        setCouponError(null);

        const qualifies = items.length > 0 && subtotal >= minSpend;
        let appliedDiscount = 0;
        if (qualifies) {
          if (applied.type === 'percent') {
            appliedDiscount = Math.round(subtotal * (applied.discountPercent / 100) * 100) / 100;
          } else if (applied.type === 'fixed') {
            appliedDiscount = Math.min(subtotal, applied.discountAmount);
          }
        }

        if (qualifies) {
          if (appliedDiscount > 0) {
            toast.success(
              `Coupon ${applied.code} applied (-$${appliedDiscount.toFixed(2)})`,
              applied.description,
              { dedupeKey: 'coupon' }
            );
          } else if (applied.freeShipping) {
            toast.success(
              `Coupon ${applied.code} applied (Free Shipping)`,
              applied.description,
              { dedupeKey: 'coupon' }
            );
          } else {
            toast.success(`Coupon ${applied.code} applied`, applied.description, {
              dedupeKey: 'coupon',
            });
          }
        } else {
          const shortfall = Math.max(0, minSpend - subtotal).toFixed(2);
          toast.warning(
            `Coupon ${applied.code} saved`,
            `Add $${shortfall} more to unlock ${applied.description || 'your discount'}.`,
            { dedupeKey: 'coupon' }
          );
        }

        return { success: true, message: res.message || 'Coupon applied successfully!' };
      } else {
        const msg = res?.message || `Coupon "${code}" could not be applied.`;
        setCouponError(msg);
        toast.error('Coupon not applied', msg, { dedupeKey: 'coupon' });
        return { success: false, message: msg };
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to calculate coupon discount.';
      setCouponError(msg);
      toast.error('Coupon error', msg, { dedupeKey: 'coupon' });
      return { success: false, message: msg };
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const removeCoupon = () => {
    const removedCode = coupon?.code;
    setCoupon(null);
    setCouponError(null);
    if (removedCode) {
      toast.info(`Coupon ${removedCode} removed`, undefined, { dedupeKey: 'coupon' });
    }
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
        meetsMinSpend,
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
