import React, { useState } from 'react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { getProductImageUrl } from '../lib/nodestack';
import {
  X,
  Trash2,
  ArrowRight,
  ShoppingBag,
  ShieldCheck,
  Tag,
  Sparkles,
  Gift,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react';

interface CartDrawerProps {
  onProceedToCheckout: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({ onProceedToCheckout }) => {
  const { isAuthenticated } = useAuth();
  const {
    items,
    itemCount,
    subtotal,
    isCartOpen,
    setIsCartOpen,
    updateQuantity,
    removeFromCart,
    coupon,
    bundlePerk,
    isApplyingCoupon,
    couponError,
    applyCoupon,
    removeCoupon,
    discountAmount,
    shippingCost,
    orderTotal,
  } = useCart();

  const [inputCode, setInputCode] = useState('');

  if (!isCartOpen) return null;

  const FREE_SHIPPING_THRESHOLD = 100;
  const freeShippingReached = subtotal >= FREE_SHIPPING_THRESHOLD || coupon?.freeShipping;
  const remainingForFreeShipping = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
  const progressPercent = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);

  const handleApply = async (codeToUse?: string) => {
    const code = codeToUse || inputCode;
    if (!code.trim()) return;
    const res = await applyCoupon(code);
    if (res.success) {
      setInputCode('');
    }
  };

  const QUICK_COUPONS = [
    { code: 'SAVE20', label: '20% Off (> $75)' },
    { code: 'WELCOME10', label: '10% Off' },
    { code: 'FLAT50', label: '$50 Off (> $150)' },
    { code: 'FREESHIP', label: 'Free Shipping' },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity"
        onClick={() => setIsCartOpen(false)}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col justify-between">
          
          {/* Header */}
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-brand-600" />
              <h2 className="font-extrabold text-lg text-slate-900">
                Your Cart ({itemCount})
              </h2>
            </div>
            <button
              onClick={() => setIsCartOpen(false)}
              className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Free Shipping Meter */}
          {items.length > 0 && (
            <div className="px-6 py-3 bg-brand-50/60 border-b border-brand-100 space-y-1.5">
              <div className="flex justify-between text-xs font-semibold">
                {freeShippingReached ? (
                  <span className="text-emerald-700 font-bold flex items-center gap-1">
                    🎉 You unlocked FREE Shipping!
                  </span>
                ) : (
                  <span className="text-brand-900">
                    Add <strong className="text-brand-600">${remainingForFreeShipping.toFixed(2)}</strong> more for Free Shipping
                  </span>
                )}
                <span className="text-brand-500 font-bold">{Math.round(progressPercent)}%</span>
              </div>
              <div className="w-full h-1.5 bg-brand-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-600 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Bundle Perk Notification */}
          {bundlePerk && (
            <div className="px-6 py-2.5 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-200/60 flex items-center gap-2 text-xs text-amber-900 font-medium animate-in fade-in duration-200">
              <Gift className="w-4 h-4 text-amber-600 shrink-0" />
              <span><strong>VIP Flow Reward:</strong> {bundlePerk}</span>
            </div>
          )}

          {/* Items List */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-3 text-slate-400">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-300">
                  <ShoppingBag className="w-8 h-8" />
                </div>
                <p className="font-bold text-slate-700">Your cart is currently empty</p>
                <p className="text-xs max-w-xs text-slate-400">
                  Browse products and pick items to add to your order.
                </p>
              </div>
            ) : (
              items.map((item) => {
                const img = getProductImageUrl(item.product);
                return (
                  <div
                    key={item.product.id}
                    className="flex items-center gap-4 p-3 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors"
                  >
                    <div className="w-16 h-16 rounded-xl bg-white border border-slate-100 p-2 flex items-center justify-center shrink-0">
                      <img
                        src={img}
                        alt={item.product.name}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-sm text-slate-900 truncate">
                        {item.product.name}
                      </h4>
                      <p className="text-xs font-extrabold text-brand-600 mt-0.5">
                        ${item.product.price.toFixed(2)}
                      </p>

                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden text-xs">
                          <button
                            onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                            className="px-2 py-0.5 text-slate-500 hover:bg-slate-100 font-bold"
                          >
                            -
                          </button>
                          <span className="px-2 font-bold text-slate-800">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                            className="px-2 py-0.5 text-slate-500 hover:bg-slate-100 font-bold"
                          >
                            +
                          </button>
                        </div>

                        <button
                          onClick={() => removeFromCart(item.product.id)}
                          className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                          title="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="font-extrabold text-sm text-slate-900">
                        ${(item.product.price * item.quantity).toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}

            {/* Promo Code & Serverless Lambda Section */}
            {items.length > 0 && (
              <div className="mt-6 pt-4 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-brand-600" />
                    <span>Promo Code (Serverless Lambda)</span>
                  </label>
                  <span className="text-[10px] text-slate-400 font-medium">QuickJS Sandbox</span>
                </div>

                {coupon ? (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center">
                        <Check className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-extrabold text-emerald-900">
                          {coupon.code} Applied
                        </p>
                        <p className="text-[11px] text-emerald-700">
                          {coupon.description}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={removeCoupon}
                      className="p-1 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-100 rounded-lg transition-colors text-xs font-bold"
                      title="Remove coupon"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Try SAVE20 or WELCOME10"
                        value={inputCode}
                        onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleApply();
                          }
                        }}
                        disabled={isApplyingCoupon}
                        className="flex-1 px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500 uppercase tracking-wider"
                      />
                      <button
                        onClick={() => handleApply()}
                        disabled={isApplyingCoupon || !inputCode.trim()}
                        className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-sm"
                      >
                        {isApplyingCoupon ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        <span>Apply</span>
                      </button>
                    </div>

                    {couponError && (
                      <p className="text-[11px] text-rose-500 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span>{couponError}</span>
                      </p>
                    )}

                    {/* Quick Demo Coupon Chips */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {QUICK_COUPONS.map((q) => (
                        <button
                          key={q.code}
                          type="button"
                          onClick={() => {
                            setInputCode(q.code);
                            handleApply(q.code);
                          }}
                          className="px-2.5 py-1 text-[10px] font-bold bg-slate-100 hover:bg-brand-50 hover:text-brand-700 text-slate-600 rounded-lg transition-colors border border-slate-200/60"
                        >
                          {q.code} ({q.label})
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Checkout Summary */}
          {items.length > 0 && (
            <div className="p-6 border-t border-slate-100 bg-white space-y-4">
              <div className="space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-bold text-slate-800">${subtotal.toFixed(2)}</span>
                </div>

                {discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-600 font-bold">
                    <span className="flex items-center gap-1">
                      <Tag className="w-3 h-3" />
                      Discount ({coupon?.code})
                    </span>
                    <span>-${discountAmount.toFixed(2)}</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span>Shipping</span>
                  <span className="font-bold text-slate-800">
                    {freeShippingReached ? 'FREE' : `$${shippingCost.toFixed(2)}`}
                  </span>
                </div>

                <div className="flex justify-between text-base font-extrabold text-slate-900 pt-2 border-t border-slate-100">
                  <span>Total</span>
                  <span className="text-brand-600">${orderTotal.toFixed(2)}</span>
                </div>
              </div>

              <button
                onClick={() => {
                  setIsCartOpen(false);
                  onProceedToCheckout();
                }}
                className="w-full py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-slate-900/20"
              >
                <span>{isAuthenticated ? 'Proceed to Checkout' : 'Sign In & Checkout'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {!isAuthenticated && (
                <div className="text-center text-[11px] text-slate-500 font-medium">
                  1-Click Demo Sign In available at checkout
                </div>
              )}

              <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>Auto-triggers OrderFulfillmentFlow Pipeline</span>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
