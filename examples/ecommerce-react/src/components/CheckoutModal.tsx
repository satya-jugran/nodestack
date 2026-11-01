import React, { useState } from 'react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { client } from '../lib/nodestack';
import {
  X,
  CheckCircle2,
  ShieldCheck,
  CreditCard,
  Sparkles,
  ArrowRight,
  Package,
  Tag,
  Zap,
} from 'lucide-react';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewOrders: () => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  onViewOrders,
}) => {
  const { items, subtotal, coupon, discountAmount, shippingCost, orderTotal, clearCart } = useCart();
  const { user, isAuthenticated } = useAuth();

  const [customerName, setCustomerName] = useState(
    user?.name || (isAuthenticated && user?.email ? user.email.split('@')[0] : '')
  );
  const [customerEmail, setCustomerEmail] = useState(user?.email || '');
  const [shippingAddress, setShippingAddress] = useState('742 Evergreen Terrace, Austin, TX 78701');
  const [cardNumber, setCardNumber] = useState('4242 •••• •••• 4242');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedOrderNumber, setConfirmedOrderNumber] = useState<string | null>(null);

  React.useEffect(() => {
    if (user) {
      setCustomerName(user.name || (user.email ? user.email.split('@')[0] : ''));
      setCustomerEmail(user.email || '');
    }
  }, [user, isOpen]);

  if (!isOpen) return null;

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated || !user) {
      alert('Please sign in or use 1-Click Demo Login to place this order.');
      return;
    }
    if (!customerEmail || !customerName || !shippingAddress) return;

    setIsSubmitting(true);
    const orderNumber = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

    const orderItems = items.map((i) => ({
      productId: i.product.id,
      name: i.product.name,
      quantity: i.quantity,
      price: i.product.price,
      image: i.product.image,
    }));

    try {
      const created = await client.collection('orders').create({
        orderNumber,
        user: user?.id || undefined,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        status: 'pending',
        total: orderTotal,
        discount: discountAmount,
        couponCode: coupon?.code || undefined,
        items: JSON.stringify(orderItems),
        shippingAddress: shippingAddress.trim(),
        paymentStatus: 'paid',
      });

      setConfirmedOrderNumber(orderNumber);
      clearCart();
    } catch (err: any) {
      alert(`Checkout failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl z-10 border border-slate-100 p-6 sm:p-8">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {confirmedOrderNumber ? (
          <div className="text-center py-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="w-20 h-20 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div>
              <span className="text-xs font-bold tracking-widest text-emerald-600 uppercase bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                Order Confirmed
              </span>
              <h2 className="text-2xl font-black text-slate-900 mt-2">
                Thank You for Your Order!
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Order reference: <strong className="text-slate-800 font-mono">{confirmedOrderNumber}</strong>
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-left text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-slate-800">
                <Zap className="w-4 h-4 text-brand-600" />
                <span>NodeStack OrderFulfillmentFlow Triggered</span>
              </div>
              <p className="text-slate-500 text-[11px] leading-relaxed">
                Your order just triggered an event-driven <strong>Flow State Machine</strong> in NodeStack. It validates items, decrements inventory in SQLite, and generates a carrier tracking number in real time.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => {
                  onClose();
                  onViewOrders();
                }}
                className="flex-1 py-3 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-brand-500/20"
              >
                <Package className="w-4 h-4" />
                <span>View My Orders & Tracking</span>
              </button>
              <button
                onClick={onClose}
                className="py-3 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-sm transition-colors"
              >
                Continue Shopping
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handlePlaceOrder} className="space-y-6">
            <div>
              <div className="flex items-center gap-2 text-brand-600 mb-1">
                <CreditCard className="w-5 h-5" />
                <span className="text-xs font-bold uppercase tracking-wider">Fast Checkout</span>
              </div>
              <h2 className="text-xl font-black text-slate-900">
                Complete Your Order
              </h2>
              <p className="text-xs text-slate-400">
                Review items, shipping destination, and discount before payment.
              </p>
            </div>

            {/* Customer Details */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                1. Contact & Shipping
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Shipping Address</label>
                <input
                  type="text"
                  required
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500"
                />
              </div>
            </div>

            {/* Simulated Payment */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  2. Payment Method
                </h3>
                <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                  Demo Mode
                </span>
              </div>

              <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-7 rounded bg-slate-800 text-white flex items-center justify-center font-bold text-[10px] tracking-widest">
                    VISA
                  </div>
                  <div>
                    <input
                      type="text"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      className="text-xs font-mono font-bold text-slate-800 bg-transparent border-none p-0 focus:outline-none"
                    />
                    <p className="text-[10px] text-slate-400">Expires 12/28 • CVC 888</p>
                  </div>
                </div>
                <ShieldCheck className="w-4 h-4 text-slate-400" />
              </div>
            </div>

            {/* Order Summary & Pricing Breakdown */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal ({items.reduce((s, i) => s + i.quantity, 0)} items)</span>
                <span className="font-semibold text-slate-700">${subtotal.toFixed(2)}</span>
              </div>

              {discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600 font-bold">
                  <span className="flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5" />
                    Coupon Discount ({coupon?.code})
                  </span>
                  <span>-${discountAmount.toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between text-slate-500">
                <span>Shipping</span>
                <span className="font-semibold text-slate-700">
                  {shippingCost === 0 ? 'FREE' : `$${shippingCost.toFixed(2)}`}
                </span>
              </div>

              <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-2 border-t border-slate-200/60">
                <span>Total Due</span>
                <span className="text-brand-600">${orderTotal.toFixed(2)}</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || items.length === 0}
              className="w-full py-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-slate-900/20"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Processing Order...</span>
                </>
              ) : (
                <>
                  <span>Place Order • ${orderTotal.toFixed(2)}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

      </div>
    </div>
  );
};
