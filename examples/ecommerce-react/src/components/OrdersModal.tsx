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

        // 2. Load orders for current customer
        const sessionOrders: Order[] = [];
        try {
          const raw = localStorage.getItem('nodestack_session_orders');
          if (raw) sessionOrders.push(...JSON.parse(raw));
        } catch {}

        let backendOrders: Order[] = [];
        try {
          if (isAuthenticated && user) {
            const filterExpr = `user = "${user.id}" || customerEmail = "${user.email}"`;
            const orderRes = await client.collection('orders').getList(1, 50, {
              filter: filterExpr,
              sort: '-created',
            });
            backendOrders = orderRes.items as unknown as Order[];
          } else {
            // For guests, check if they have public/sample orders
            const orderRes = await client.collection('orders').getList(1, 10, {
              sort: '-created',
            });
            backendOrders = orderRes.items as unknown as Order[];
          }
        } catch (err) {
          console.warn('Backend order lookup notice:', err);
        }

        // Merge orders deduplicating by orderNumber or id
        const mergedMap = new Map<string, Order>();
        for (const o of sessionOrders) {
          mergedMap.set(o.orderNumber || o.id, o);
        }
        for (const o of backendOrders) {
          mergedMap.set(o.orderNumber || o.id, o);
        }

        const combinedOrders = Array.from(mergedMap.values()).sort((a, b) => {
          const timeA = new Date(a.created || 0).getTime();
          const timeB = new Date(b.created || 0).getTime();
          return timeB - timeA;
        });

        if (isMounted) setOrders(combinedOrders);
      } catch (err) {
        console.error('Failed to load orders:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, isAuthenticated, user?.email]);

  if (!isOpen) return null;

  const getStatusBadge = (status: Order['status']) => {
    switch (status) {
      case 'delivered':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" /> Delivered
          </span>
        );
      case 'shipped':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200">
            <Truck className="w-3.5 h-3.5" /> Shipped
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3.5 h-3.5" /> Processing
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
            Pending
          </span>
        );
    }
  };

  const parseOrderItems = (rawItems: string | OrderItem[]): OrderItem[] => {
    if (Array.isArray(rawItems)) return rawItems;
    try {
      return JSON.parse(rawItems);
    } catch {
      return [];
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl z-10 border border-slate-100 p-6 sm:p-8 flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-xl text-slate-900">
                Past Orders & Reviews
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

                    {/* Items List */}
                    <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2 space-y-2">
                      {itemsList.map((item, idx) => {
                        const product = allProducts[item.productId];

                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-3 pt-2 text-xs"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 p-1 flex items-center justify-center shrink-0">
                                {product?.image ? (
                                  <img
                                    src={getProductImageUrl(product)}
                                    alt={item.name}
                                    className="max-w-full max-h-full object-contain"
                                  />
                                ) : (
                                  <Package className="w-4 h-4 text-slate-400" />
                                )}
                              </div>
                              <div className="min-w-0 truncate">
                                <p className="font-bold text-slate-800 truncate">{item.name}</p>
                                <p className="text-slate-400">Qty: {item.quantity} • ${item.price.toFixed(2)}</p>
                              </div>
                            </div>

                            {/* Review Action */}
                            {product && (
                              <button
                                onClick={() => {
                                  onClose();
                                  onReviewProduct(product);
                                }}
                                className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold text-[11px] flex items-center gap-1.5 transition-colors"
                              >
                                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                                <span>Write Review</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Address footer */}
                    {order.shippingAddress && (
                      <div className="text-[11px] text-slate-400 pt-1">
                        Shipping address: <span className="text-slate-600">{order.shippingAddress}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
