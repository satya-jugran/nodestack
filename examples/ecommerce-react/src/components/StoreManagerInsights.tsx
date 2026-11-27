import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { client } from '../lib/nodestack';
import { ManagerCatalogInsight, ManagerOrderInsight } from '../lib/types';
import {
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  Heart,
  Layers,
  PackagePlus,
  RefreshCw,
  ShoppingCart,
  Star,
  Tag,
} from 'lucide-react';

interface StoreManagerInsightsProps {
  onRestockProduct: (productId: string, nextStock: number) => Promise<void>;
  refreshSignal?: number;
}

export const StoreManagerInsights: React.FC<StoreManagerInsightsProps> = ({
  onRestockProduct,
  refreshSignal = 0,
}) => {
  const [orderInsights, setOrderInsights] = useState<ManagerOrderInsight[]>([]);
  const [catalogInsights, setCatalogInsights] = useState<ManagerCatalogInsight[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [tableSort, setTableSort] = useState<'demand' | 'saves' | 'stock_asc' | 'value'>('demand');

  const fetchInsights = useCallback(async (showFullLoader = false) => {
    if (showFullLoader) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);
    try {
      const [ordersRes, catalogRes] = await Promise.all([
        client.collection('manager_order_insights').getList(1, 200),
        client.collection('manager_catalog_insights').getList(1, 200),
      ]);
      setOrderInsights(ordersRes.items as unknown as ManagerOrderInsight[]);
      setCatalogInsights(catalogRes.items as unknown as ManagerCatalogInsight[]);
    } catch (err: any) {
      setError(err?.message || 'Unable to load store insights.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchInsights(orderInsights.length === 0 && catalogInsights.length === 0);
  }, [fetchInsights, refreshSignal]);

  const orderSummary = useMemo(() => {
    let totalOrders = 0;
    let totalRevenue = 0;
    let paidRevenue = 0;
    let pendingRevenue = 0;
    let pendingOrders = 0;
    let totalDiscount = 0;
    let loyaltyPointsIssued = 0;

    const couponMap = new Map<
      string,
      { couponCode: string; orderCount: number; grossRevenue: number; totalDiscount: number }
    >();

    for (const row of orderInsights) {
      const count = Number(row.orderCount || 0);
      const rev = Number(row.grossRevenue || 0);
      const disc = Number(row.totalDiscount || 0);
      const pts = Number(row.loyaltyPointsIssued || 0);

      totalOrders += count;
      totalRevenue += rev;
      totalDiscount += disc;
      loyaltyPointsIssued += pts;

      if (row.paymentStatus === 'paid') {
        paidRevenue += rev;
      } else if (row.paymentStatus === 'pending' || row.status === 'pending') {
        pendingRevenue += rev;
        pendingOrders += count;
      }

      const code = row.couponCode || 'none';
      const existing = couponMap.get(code) || {
        couponCode: code,
        orderCount: 0,
        grossRevenue: 0,
        totalDiscount: 0,
      };
      existing.orderCount += count;
      existing.grossRevenue += rev;
      existing.totalDiscount += disc;
      couponMap.set(code, existing);
    }

    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const couponBreakdown = Array.from(couponMap.values()).sort((a, b) => {
      if (a.couponCode === 'none' && b.couponCode !== 'none') return 1;
      if (a.couponCode !== 'none' && b.couponCode === 'none') return -1;
      return b.grossRevenue - a.grossRevenue;
    });

    return {
      totalOrders,
      totalRevenue,
      paidRevenue,
      pendingRevenue,
      pendingOrders,
      avgOrderValue,
      totalDiscount,
      loyaltyPointsIssued,
      couponBreakdown,
    };
  }, [orderInsights]);

  const restockAlerts = useMemo(() => {
    return [...catalogInsights]
      .filter((item) => Number(item.stock || 0) <= 5 || Number(item.inCartUnits || 0) > Number(item.stock || 0))
      .sort((a, b) => {
        const demandA = Number(a.inCartUnits || 0) * 10 + Number(a.favoriteCount || 0);
        const demandB = Number(b.inCartUnits || 0) * 10 + Number(b.favoriteCount || 0);
        if (demandB !== demandA) return demandB - demandA;
        return Number(a.stock || 0) - Number(b.stock || 0);
      });
  }, [catalogInsights]);

  const categoryValuation = useMemo(() => {
    const byCategory = new Map<
      string,
      {
        categoryName: string;
        skuCount: number;
        totalUnits: number;
        inventoryValue: number;
        inCartUnits: number;
        favoriteCount: number;
      }
    >();

    for (const item of catalogInsights) {
      const name = item.categoryName || 'General';
      const existing = byCategory.get(name) || {
        categoryName: name,
        skuCount: 0,
        totalUnits: 0,
        inventoryValue: 0,
        inCartUnits: 0,
        favoriteCount: 0,
      };
      existing.skuCount += 1;
      existing.totalUnits += Number(item.stock || 0);
      existing.inventoryValue += Number(item.inventoryValue || 0);
      existing.inCartUnits += Number(item.inCartUnits || 0);
      existing.favoriteCount += Number(item.favoriteCount || 0);
      byCategory.set(name, existing);
    }

    const list = Array.from(byCategory.values()).sort((a, b) => b.inventoryValue - a.inventoryValue);
    const totalValue = list.reduce((sum, c) => sum + c.inventoryValue, 0);
    return { list, totalValue };
  }, [catalogInsights]);

  const sortedCatalogHealth = useMemo(() => {
    return [...catalogInsights].sort((a, b) => {
      if (tableSort === 'demand') {
        const diff = Number(b.inCartUnits || 0) - Number(a.inCartUnits || 0);
        if (diff !== 0) return diff;
        return Number(b.favoriteCount || 0) - Number(a.favoriteCount || 0);
      }
      if (tableSort === 'saves') {
        const diff = Number(b.favoriteCount || 0) - Number(a.favoriteCount || 0);
        if (diff !== 0) return diff;
        return Number(b.reviewCount || 0) - Number(a.reviewCount || 0);
      }
      if (tableSort === 'stock_asc') {
        return Number(a.stock || 0) - Number(b.stock || 0);
      }
      return Number(b.inventoryValue || 0) - Number(a.inventoryValue || 0);
    });
  }, [catalogInsights, tableSort]);

  const handleQuickRestock = async (item: ManagerCatalogInsight) => {
    setRestockingId(item.id);
    try {
      await onRestockProduct(item.id, Math.max(0, Number(item.stock || 0)) + 20);
      await fetchInsights(false);
    } finally {
      setRestockingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 animate-pulse">
              <div className="h-3 bg-slate-100 rounded w-1/2" />
              <div className="h-7 bg-slate-100 rounded w-2/3" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-3xl border border-slate-200 p-6 h-64 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-bold text-rose-900">Could not load Store Insights</h2>
          <p className="text-xs text-rose-700">{error}</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchInsights(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Refresh Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-600" aria-hidden="true" />
            <span>Store Performance &amp; Merchandising Insights</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Live revenue breakdown, promo redemptions, restock demand alerts, and category valuation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchInsights(false)}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors disabled:opacity-60 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh Insights'}</span>
        </button>
      </div>

      {/* 1. Revenue & Promo KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold text-emerald-700 uppercase tracking-wider">
            <span>Paid Revenue</span>
            <DollarSign className="w-4 h-4 text-emerald-600" aria-hidden="true" />
          </div>
          <p className="text-2xl font-black text-slate-900 tabular-nums">
            ${orderSummary.paidRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] text-slate-500">
            Across {orderSummary.totalOrders} total orders
          </p>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold text-amber-700 uppercase tracking-wider">
            <span>Pending Orders</span>
            <Clock className="w-4 h-4 text-amber-500" aria-hidden="true" />
          </div>
          <p className="text-2xl font-black text-slate-900 tabular-nums">
            ${orderSummary.pendingRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] text-slate-500">
            {orderSummary.pendingOrders} awaiting payment or processing
          </p>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold text-brand-700 uppercase tracking-wider">
            <span>Avg Order Value</span>
            <Tag className="w-4 h-4 text-brand-600" aria-hidden="true" />
          </div>
          <p className="text-2xl font-black text-slate-900 tabular-nums">
            ${orderSummary.avgOrderValue.toFixed(2)}
          </p>
          <p className="text-[11px] text-slate-500">
            ${orderSummary.totalDiscount.toFixed(2)} in promo discounts
          </p>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold text-indigo-700 uppercase tracking-wider">
            <span>Loyalty Issued</span>
            <Award className="w-4 h-4 text-indigo-600" aria-hidden="true" />
          </div>
          <p className="text-2xl font-black text-slate-900 tabular-nums">
            {orderSummary.loyaltyPointsIssued.toLocaleString()} pts
          </p>
          <p className="text-[11px] text-slate-500">
            Catalog value ${categoryValuation.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      {/* 2. Restock Priority Alerts & Promo Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Restock Priority Alerts */}
        <section className="lg:col-span-7 bg-white rounded-3xl border border-slate-200/80 shadow-xs p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
                <span>Restock Priority Alerts</span>
              </h3>
              <p className="text-xs text-slate-500">
                Low-stock items (&le; 5 units) ranked by live cart &amp; wishlist shopper demand.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
              {restockAlerts.length} {restockAlerts.length === 1 ? 'alert' : 'alerts'}
            </span>
          </div>

          {restockAlerts.length === 0 ? (
            <div className="py-8 px-4 rounded-2xl bg-emerald-50/70 border border-emerald-200/70 text-center space-y-1.5">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto" aria-hidden="true" />
              <p className="text-xs font-bold text-emerald-900">All products are comfortably stocked</p>
              <p className="text-[11px] text-emerald-700">
                No catalog items have 5 or fewer units remaining or unfulfilled cart demand.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {restockAlerts.map((item) => {
                const hasDemand = item.inCartUnits > 0 || item.favoriteCount > 0;
                const isRestocking = restockingId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      item.stock <= 0
                        ? 'bg-rose-50/60 border-rose-200'
                        : hasDemand
                          ? 'bg-amber-50/70 border-amber-200'
                          : 'bg-slate-50/80 border-slate-200'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-extrabold text-slate-900 truncate">
                          {item.name}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white text-slate-600 border border-slate-200">
                          {item.categoryName}
                        </span>
                        {hasDemand && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                            High Shopper Demand
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-600 flex-wrap">
                        <span className="font-bold text-slate-800">
                          {item.stock} {item.stock === 1 ? 'unit' : 'units'} left
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <ShoppingCart className="w-3 h-3 text-brand-600" aria-hidden="true" />
                          {item.inCartUnits} in {item.cartShoppersCount}{' '}
                          {item.cartShoppersCount === 1 ? 'cart' : 'carts'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Heart className="w-3 h-3 text-rose-500" aria-hidden="true" />
                          {item.favoriteCount} saved
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleQuickRestock(item)}
                      disabled={isRestocking}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-brand-600 text-white text-xs font-bold transition-colors disabled:opacity-50 shrink-0"
                    >
                      <PackagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{isRestocking ? 'Restocking...' : 'Restock (+20)'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Promo & Coupon Performance */}
        <section className="lg:col-span-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs p-5 space-y-4">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <Tag className="w-4 h-4 text-brand-600" aria-hidden="true" />
              <span>Promo &amp; Coupon Usage</span>
            </h3>
            <p className="text-xs text-slate-500">
              Order volume, gross revenue, and discounts by promotion code.
            </p>
          </div>

          <div className="space-y-2.5">
            {orderSummary.couponBreakdown.map((promo) => (
              <div
                key={promo.couponCode}
                className="p-3 rounded-2xl bg-slate-50/80 border border-slate-200/70 flex items-center justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                        promo.couponCode === 'none'
                          ? 'bg-slate-200/80 text-slate-700'
                          : 'bg-brand-100 text-brand-800 font-mono'
                      }`}
                    >
                      {promo.couponCode === 'none' ? 'Standard Checkout' : promo.couponCode}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {promo.orderCount} {promo.orderCount === 1 ? 'order' : 'orders'}
                    </span>
                  </div>
                  {promo.totalDiscount > 0 && (
                    <p className="text-[11px] text-rose-600 font-semibold">
                      -${promo.totalDiscount.toFixed(2)} discounted
                    </p>
                  )}
                </div>

                <div className="text-right">
                  <span className="text-sm font-black text-slate-900 tabular-nums">
                    ${promo.grossRevenue.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 3. Category Stock & Valuation */}
      <section className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-brand-600" aria-hidden="true" />
              <span>Category Stock &amp; Valuation</span>
            </h3>
            <p className="text-xs text-slate-500">
              Retail inventory value and shopper interest grouped by storefront category.
            </p>
          </div>
          <div className="text-xs font-bold text-slate-700">
            Total Retail Valuation:{' '}
            <span className="text-slate-900 font-black tabular-nums">
              ${categoryValuation.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {categoryValuation.list.map((cat) => {
            const sharePct =
              categoryValuation.totalValue > 0
                ? Math.round((cat.inventoryValue / categoryValuation.totalValue) * 100)
                : 0;
            return (
              <div
                key={cat.categoryName}
                className="p-4 rounded-2xl bg-slate-50/70 border border-slate-200/80 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-slate-900">{cat.categoryName}</span>
                  <span className="text-[11px] font-bold text-slate-500">
                    {cat.skuCount} SKUs • {cat.totalUnits} units
                  </span>
                </div>

                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-black text-slate-900 tabular-nums">
                    ${cat.inventoryValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[11px] font-bold text-brand-700">{sharePct}% of value</span>
                </div>

                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-600 transition-all"
                    style={{ width: `${Math.max(4, sharePct)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                  <span>{cat.inCartUnits} units in carts</span>
                  <span>{cat.favoriteCount} wishlist saves</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. Demand & Review Health Table */}
      <section className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 id="demand-health-caption" className="text-sm font-extrabold text-slate-900">
              Demand &amp; Review Health
            </h3>
            <p className="text-xs text-slate-500">
              Live per-SKU inventory, active cart demand, wishlist saves, and customer review ratings.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="insights-table-sort" className="text-xs font-semibold text-slate-500">
              Sort by:
            </label>
            <select
              id="insights-table-sort"
              value={tableSort}
              onChange={(e) => setTableSort(e.target.value as typeof tableSort)}
              className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-slate-700 outline-none focus:border-brand-500"
            >
              <option value="demand">Cart Demand</option>
              <option value="saves">Wishlist Saves</option>
              <option value="stock_asc">Lowest Stock</option>
              <option value="value">Inventory Value</option>
            </select>
          </div>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby="demand-health-caption"
          className="insights-table-wrapper p-0 sm:p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <table className="insights-table text-left text-xs">
            <caption className="sr-only">
              Catalog demand, wishlist saves, review health, and retail inventory valuation per product
            </caption>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500">
                <th scope="col" className="py-3.5 px-4 bg-slate-50 border-b border-slate-200">
                  Product
                </th>
                <th scope="col" className="py-3.5 px-4 bg-slate-50 border-b border-slate-200">
                  Category
                </th>
                <th scope="col" className="py-3.5 px-4 bg-slate-50 border-b border-slate-200">
                  Stock
                </th>
                <th scope="col" className="py-3.5 px-4 bg-slate-50 border-b border-slate-200">
                  In Carts
                </th>
                <th scope="col" className="py-3.5 px-4 bg-slate-50 border-b border-slate-200">
                  Saved
                </th>
                <th scope="col" className="py-3.5 px-4 bg-slate-50 border-b border-slate-200">
                  Reviews
                </th>
                <th scope="col" className="py-3.5 px-4 bg-slate-50 border-b border-slate-200 text-right">
                  Inventory Value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedCatalogHealth.map((row) => {
                const isLow = row.stock > 0 && row.stock <= 5;
                const isOut = row.stock <= 0 || row.status === 'out_of_stock';
                return (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <th scope="row" className="py-3 px-4 font-bold text-slate-900 text-left">
                      <div className="max-w-[240px] truncate" title={row.name}>
                        {row.name}
                      </div>
                    </th>
                    <td className="py-3 px-4 text-slate-600 font-medium">{row.categoryName}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${
                          isOut
                            ? 'bg-rose-50 text-rose-700'
                            : isLow
                              ? 'bg-amber-50 text-amber-800'
                              : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {row.stock}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-700 tabular-nums">
                      {row.inCartUnits > 0
                        ? `${row.inCartUnits} (${row.cartShoppersCount} ${
                            row.cartShoppersCount === 1 ? 'shopper' : 'shoppers'
                          })`
                        : '0'}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-700 tabular-nums">
                      {row.favoriteCount}
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      {row.reviewCount > 0 ? (
                        <span className="inline-flex items-center gap-1 font-bold tabular-nums">
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                          {Number(row.avgRating || 0).toFixed(1)}
                          <span className="text-slate-400 font-normal">({row.reviewCount})</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">No reviews</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-black text-slate-900 tabular-nums">
                      ${Number(row.inventoryValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
