import React, { useEffect, useState } from 'react';
import { Order, OrderItem, Product } from '../lib/types';
import { client, getProductImageUrl } from '../lib/nodestack';
import { useAuth } from '../context/AuthContext';
import {
  X,
  Package,
  Calendar,
  CheckCircle2,
  Clock,
  Truck,
  RotateCcw,
  Star,
  ExternalLink,
  Tag,
  Zap,
} from 'lucide-react';

interface OrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAuth: () => void;
  onReviewProduct: (product: Product) => void;
}

export const OrdersModal: React.FC<OrdersModalProps> = ({
  isOpen,
  onClose,
  onOpenAuth,
  onReviewProduct,
}) => {
  const { user, isAuthenticated } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [allProducts, setAllProducts] = useState<Record<string, Product>>({});

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    async function loadData() {
      setIsLoading(true);
      try {
        // 1. Load products catalog for cross-referencing
        const prodRes = await client.collection('products').getList(1, 100);
        const pMap: Record<string, Product> = {};
        for (const p of prodRes.items) {
          pMap[p.id] = p as unknown as Product;
        }
        if (isMounted) setAllProducts(pMap);

        // 2. Load orders directly from backend database (single source of truth)
        try {
          localStorage.removeItem('nodestack_session_orders');
        } catch {}

        let backendOrders: Order[] = [];
        if (isAuthenticated && user) {
          try {
            const filterExpr = `user = "${user.id}" || customerEmail = "${user.email}"`;
            const orderRes = await client.collection('orders').getList(1, 50, {
              filter: filterExpr,
              sort: '-created',
            });
            backendOrders = orderRes.items as unknown as Order[];
          } catch (err) {
            console.warn('Backend order lookup notice:', err);
          }
        }

        if (isMounted) setOrders(backendOrders);
      } catch (err) {
        console.error('Failed to load orders:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadData();

    // 3. Realtime SSE subscription for live OrderFulfillmentFlow updates
    let unsubscribe: (() => void) | undefined;
    try {
      client
        .collection('orders')
        .subscribe('*', (e: any) => {
          if (e.action === 'update' || e.action === 'create') {
            const incoming = e.record as Order;
            setOrders((prev) => {
              const idx = prev.findIndex(
                (o) => o.id === incoming.id || o.orderNumber === incoming.orderNumber
              );
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = { ...next[idx], ...incoming };
                return next;
              } else {
                return [incoming, ...prev];
              }
            });
          }
        })
        .then((unsub) => {
          unsubscribe = unsub;
        })
        .catch(() => {});
    } catch {}

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [isOpen, isAuthenticated, user?.email]);

  const parseOrderItems = (raw: string | OrderItem[]): OrderItem[] => {
    if (Array.isArray(raw)) return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'delivered':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Delivered
          </span>
        );
      case 'shipped':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Truck className="w-3.5 h-3.5 text-indigo-600" /> Shipped
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <RotateCcw className="w-3.5 h-3.5 text-blue-600 animate-spin" /> Processing
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600" /> Pending
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
            {status}
          </span>
        );
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl z-10 border border-slate-100 p-6 sm:p-8 flex flex-col justify-between">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-xl text-slate-900">
                Past Orders & Tracking
              </h2>
              <p className="text-xs text-slate-500">
                {isAuthenticated
                  ? `Showing order records for ${user?.email}`
                  : 'Showing sample starter orders (Sign in to view your personal history)'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 py-4 space-y-4">
          {!isAuthenticated && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3">
              <span>Sign in to access and track your own placed orders.</span>
              <button
                onClick={onOpenAuth}
                className="font-bold underline text-amber-950 shrink-0 hover:text-amber-700"
              >
                Sign In Now
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              Loading orders from NodeStack backend...
            </div>
          ) : orders.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm space-y-2">
              <Package className="w-10 h-10 mx-auto text-slate-300" />
              <p className="font-bold text-slate-700">No orders found</p>
              <p className="text-xs">Place an order through the store to see it here.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => {
                const itemsList = parseOrderItems(order.items);

                return (
                  <div
                    key={order.id}
                    className="p-5 rounded-2xl border border-slate-200/80 bg-slate-50/50 hover:bg-white transition-all space-y-4 shadow-xs"
                  >
                    {/* Top Order bar */}
                    <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-slate-900 text-sm">
                          {order.orderNumber}
                        </span>
                        <span className="text-slate-400">•</span>
                        <span className="text-slate-500 flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          {order.created ? new Date(order.created).toLocaleDateString() : 'Recent'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {getStatusBadge(order.status)}
                        <span className="font-extrabold text-slate-900 text-sm">
                          ${order.total.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* NodeStack Flow & Lambda Metadata Badges */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {order.trackingNumber && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 text-[11px] font-semibold">
                          <Truck className="w-3.5 h-3.5" />
                          <span>{order.carrier || 'Carrier'}: <strong>{order.trackingNumber}</strong></span>
                        </div>
                      )}

                      {order.loyaltyPoints !== undefined && order.loyaltyPoints > 0 && (
                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-100 text-amber-800 text-[11px] font-semibold">
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                          <span>VIP Points: +{order.loyaltyPoints.toLocaleString()}</span>
                        </div>
                      )}

                      {order.discount !== undefined && order.discount > 0 && (
                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-800 text-[11px] font-semibold">
                          <Tag className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Discount: -${order.discount.toFixed(2)} ({order.couponCode || 'PROMO'})</span>
                        </div>
                      )}
                    </div>

                    {/* Timeline stepper */}
                    <div className="grid grid-cols-4 gap-2 pt-1 pb-1">
                      {['pending', 'processing', 'shipped', 'delivered'].map((step, idx) => {
                        const statusWeights: Record<string, number> = {
                          pending: 0,
                          processing: 1,
                          shipped: 2,
                          delivered: 3,
                          cancelled: -1,
                        };
                        const currentWeight = statusWeights[order.status] ?? 0;
                        const isDone = currentWeight >= idx;
                        const isCurrent = currentWeight === idx;

                        return (
                          <div key={step} className="flex flex-col items-center text-center">
                            <div
                              className={`w-full h-1.5 rounded-full mb-1 transition-colors ${
                                isDone ? 'bg-emerald-500' : 'bg-slate-200'
                              }`}
                            />
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider ${
                                isCurrent
                                  ? 'text-emerald-700'
                                  : isDone
                                  ? 'text-slate-700'
                                  : 'text-slate-300'
                              }`}
                            >
                              {step}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Items Breakdown */}
                    <div className="space-y-2 pt-2 border-t border-slate-200/60">
                      {itemsList.map((item, idx) => {
                        const product = allProducts[item.productId];
                        const img = product ? getProductImageUrl(product) : item.image;

                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-xs py-1.5"
                          >
                            <div className="flex items-center gap-2.5">
                              {img && (
                                <img
                                  src={img}
                                  alt={item.name}
                                  className="w-8 h-8 rounded-lg object-contain bg-white border border-slate-200 p-0.5"
                                />
                              )}
                              <div>
                                <p className="font-bold text-slate-800 line-clamp-1">
                                  {item.name}
                                </p>
                                <p className="text-[10px] text-slate-400">
                                  Qty: {item.quantity} × ${item.price.toFixed(2)}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <span className="font-bold text-slate-800">
                                ${(item.price * item.quantity).toFixed(2)}
                              </span>

                              {product && (
                                <button
                                  onClick={() => {
                                    onClose();
                                    onReviewProduct(product);
                                  }}
                                  className="text-[10px] text-brand-600 hover:text-brand-800 font-bold hover:underline flex items-center gap-1"
                                >
                                  <Star className="w-3 h-3" />
                                  <span>Review</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Shipping Address */}
                    {order.shippingAddress && (
                      <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-100 flex items-center justify-between">
                        <span>Ships to: {order.shippingAddress}</span>
                        <span className="text-slate-300 font-mono text-[10px]">{order.id}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Zap className="w-3.5 h-3.5 text-brand-600" />
            <span>Realtime State Machine & Inventory Tracking</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
