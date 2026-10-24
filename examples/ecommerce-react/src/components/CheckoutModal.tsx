import React, { useState } from 'react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { client } from '../lib/nodestack';
import { X, CheckCircle2, ShieldCheck, CreditCard, Sparkles, ArrowRight, Package } from 'lucide-react';

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
  const { items, subtotal, clearCart } = useCart();
  const { user, isAuthenticated } = useAuth();

  const [customerName, setCustomerName] = useState(user?.name || (isAuthenticated && user?.email ? user.email.split('@')[0] : ''));
  const [customerEmail, setCustomerEmail] = useState(user?.email || '');
  const [shippingAddress, setShippingAddress] = useState('742 Evergreen Terrace, Austin, TX 78701');
  const [cardNumber, setCardNumber] = useState('4242 •••• •••• 4242');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedOrderNumber, setConfirmedOrderNumber] = useState<string | null>(null);

  // Sync customer details when user changes or modal opens
  React.useEffect(() => {
    if (user) {
      setCustomerName(user.name || (user.email ? user.email.split('@')[0] : ''));
      setCustomerEmail(user.email || '');
    }
  }, [user, isOpen]);

  if (!isOpen) return null;

  const FREE_SHIPPING_THRESHOLD = 100;
  const shippingCost = subtotal >= FREE_SHIPPING_THRESHOLD || items.length === 0 ? 0 : 9.99;
  const orderTotal = subtotal + shippingCost;

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
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
        status: 'processing',
        total: orderTotal,
        items: JSON.stringify(orderItems),
        shippingAddress: shippingAddress.trim(),
        paymentStatus: 'paid',
      });

      // Save to local session orders
      try {
        const sessionOrders = JSON.parse(localStorage.getItem('nodestack_session_orders') || '[]');
        sessionOrders.unshift(created);
        localStorage.setItem('nodestack_session_orders', JSON.stringify(sessionOrders));
      } catch {}

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
          /* Confirmation Screen */
          <div className="text-center py-6 space-y-5">
            <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                Order Placed Successfully
              </span>
              <h2 className="text-2xl font-black text-slate-900">
                Thank You for Your Order!
              </h2>
              <p className="text-sm text-slate-600">
                Your order <strong className="text-slate-900 font-mono">#{confirmedOrderNumber}</strong> is stored in NodeStack SQLite backend.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-left space-y-1.5 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>Confirmation sent to:</span>
                <strong className="text-slate-800">{customerEmail}</strong>
              </div>
              <div className="flex justify-between">
                <span>Shipping to:</span>
                <strong className="text-slate-800">{shippingAddress}</strong>
              </div>
              <div className="flex justify-between">
                <span>Amount Paid:</span>
                <strong className="text-emerald-700 font-extrabold text-sm">${orderTotal.toFixed(2)}</strong>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => {
                  onClose();
                  onViewOrders();
                }}
                className="flex-1 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-slate-900/10"
              >
                <Package className="w-4 h-4" /> View in Past Orders
              </button>

              <button
                onClick={onClose}
                className="px-6 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
              >
                Continue Shopping
              </button>
            </div>
          </div>
        ) : (
          /* Checkout Form */
          <form onSubmit={handlePlaceOrder} className="space-y-6">
            <div className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-brand-600">
                Instant Demo Checkout
              </span>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                Complete Your Order
              </h2>
              <p className="text-xs text-slate-500">
                Orders are committed directly to NodeStack's SQLite database.
              </p>
            </div>

            {/* Customer Information */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wide">
                1. Customer & Shipping
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 mb-1 block">Full Name</label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="e.g. Alex Vance"
                    className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 mb-1 block">Email</label>
                  <input
                    type="email"
                    required
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="alex@example.com"
                    className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 mb-1 block">Delivery Address</label>
                <input
                  type="text"
                  required
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  placeholder="Street, City, State, ZIP"
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 outline-none"
                />
              </div>
            </div>

            {/* Payment Method */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wide">
                  2. Payment Method
                </h3>
                <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" /> Simulated Demo Gateway
                </span>
              </div>

              <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">Demo Credit Card</p>
                    <p className="text-[11px] text-slate-500 font-mono">{cardNumber}</p>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-slate-600 bg-white px-2.5 py-1 rounded-md border border-slate-200">
                  Pre-filled
                </span>
              </div>
            </div>

            {/* Summary */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Items ({items.reduce((s, i) => s + i.quantity, 0)})</span>
                <span className="font-semibold text-slate-800">${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Shipping</span>
                <span className="font-semibold text-slate-800">
                  {shippingCost === 0 ? 'FREE' : `$${shippingCost.toFixed(2)}`}
                </span>
              </div>
              <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-2 border-t border-slate-200">
                <span>Total Due</span>
                <span>${orderTotal.toFixed(2)}</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 rounded-xl bg-brand-600 hover:bg-brand-700 active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand-500/25 disabled:bg-slate-300"
            >
              {isSubmitting ? (
                <span>Writing to Database...</span>
              ) : (
                <>
                  <span>Pay & Place Order • ${orderTotal.toFixed(2)}</span>
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
