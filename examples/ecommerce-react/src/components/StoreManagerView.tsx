import React, { useState, useMemo } from 'react';
import { Product, Category } from '../lib/types';
import { client, getProductImageUrl } from '../lib/nodestack';
import {
  getEffectiveStock,
  getEffectiveUnitPrice,
  getTotalVariantStock,
  parseProductVariants,
} from '../lib/variants';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { StoreManagerInsights } from './StoreManagerInsights';
import {
  Package,
  Plus,
  Search,
  Filter,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Zap,
  TrendingDown,
  RefreshCw,
  Edit2,
  Trash2,
  Star,
  ExternalLink,
  Sliders,
  Flame,
  Info,
  ChevronDown,
  ChevronUp,
  Layers,
  BarChart3,
} from 'lucide-react';

interface StoreManagerViewProps {
  products: Product[];
  categories: Category[];
  onOpenAddProduct: () => void;
  onEditProduct: (product: Product) => void;
  onDeleteProduct: (product: Product) => void;
  onRefresh: () => Promise<void>;
  onSwitchToShopper: () => void;
  recentlyUpdatedId?: string | null;
  flashSaleActive?: boolean;
}

export const StoreManagerView: React.FC<StoreManagerViewProps> = ({
  products,
  categories,
  onOpenAddProduct,
  onEditProduct,
  onDeleteProduct,
  onRefresh,
  onSwitchToShopper,
  recentlyUpdatedId,
  flashSaleActive = false,
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'in_stock' | 'low_stock' | 'out_of_stock'>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isResettingAll, setIsResettingAll] = useState(false);
  const [expandedVariants, setExpandedVariants] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'inventory' | 'insights'>('inventory');
  const [insightsRefreshSignal, setInsightsRefreshSignal] = useState(0);

  // Metrics
  const metrics = useMemo(() => {
    const total = products.length;
    const outOfStock = products.filter(
      (p) => getEffectiveStock(p) <= 0 || p.status === 'out_of_stock'
    ).length;
    const lowStock = products.filter((p) => {
      const s = getEffectiveStock(p);
      return s > 0 && s <= 5;
    }).length;
    const inStock = total - outOfStock - lowStock;
    const totalUnits = products.reduce((sum, p) => sum + getEffectiveStock(p), 0);
    return { total, outOfStock, lowStock, inStock, totalUnits };
  }, [products]);

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const effectiveStock = getEffectiveStock(product);
      if (categoryFilter !== 'all' && product.category !== categoryFilter) {
        return false;
      }
      if (stockStatusFilter === 'out_of_stock' && effectiveStock > 0 && product.status !== 'out_of_stock') {
        return false;
      }
      if (stockStatusFilter === 'low_stock' && (effectiveStock <= 0 || effectiveStock > 5)) {
        return false;
      }
      if (stockStatusFilter === 'in_stock' && (effectiveStock <= 5 || product.status === 'out_of_stock')) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          product.name.toLowerCase().includes(q) ||
          product.slug.toLowerCase().includes(q) ||
          product.description?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [products, categoryFilter, stockStatusFilter, searchQuery]);

  // Determine automatic status based on stock count
  const calculateStatus = (stock: number): 'out_of_stock' | 'low_stock' | 'in_stock' => {
    if (stock <= 0) return 'out_of_stock';
    if (stock <= 5) return 'low_stock';
    return 'in_stock';
  };

  // Distribute a target total stock evenly across variants when adjusting at product level
  const buildDistributedVariants = (product: Product, targetTotal: number) => {
    const variants = parseProductVariants(product);
    if (variants.length === 0) return null;
    if (targetTotal <= 0) {
      return variants.map((v) => ({ ...v, stock: 0 }));
    }
    const base = Math.floor(targetTotal / variants.length);
    let rem = targetTotal % variants.length;
    return variants.map((v) => {
      const extra = rem > 0 ? 1 : 0;
      if (rem > 0) rem -= 1;
      return { ...v, stock: base + extra };
    });
  };

  // Live stock update function
  const handleUpdateStock = async (product: Product, newStock: number) => {
    const clampedStock = Math.max(0, Math.floor(newStock));
    const newStatus = calculateStatus(clampedStock);
    const variants = parseProductVariants(product);
    let nextVariants: ReturnType<typeof parseProductVariants> | null = null;

    if (variants.length > 0) {
      const currentTotal = getTotalVariantStock(variants);
      const delta = clampedStock - currentTotal;
      if (clampedStock === 0) {
        nextVariants = variants.map((v) => ({ ...v, stock: 0 }));
      } else if (delta === 1) {
        nextVariants = variants.map((v, idx) =>
          idx === 0 ? { ...v, stock: Math.max(0, Number(v.stock) || 0) + 1 } : { ...v }
        );
      } else if (delta === -1) {
        let deducted = false;
        nextVariants = variants.map((v) => {
          const s = Math.max(0, Number(v.stock) || 0);
          if (!deducted && s > 0) {
            deducted = true;
            return { ...v, stock: s - 1 };
          }
          return { ...v };
        });
      } else {
        nextVariants = buildDistributedVariants(product, clampedStock);
      }
    }

    setUpdatingId(product.id);
    try {
      await client.collection('products').update(product.id, {
        stock: clampedStock,
        status: newStatus,
        ...(nextVariants ? { variants: nextVariants } : {}),
      });
      toast.success(
        `Stock updated: ${product.name}`,
        `${clampedStock} ${clampedStock === 1 ? 'unit' : 'units'} available`,
        { dedupeKey: `stock:${product.id}` }
      );
      setInsightsRefreshSignal((s) => s + 1);
    } catch (err: any) {
      console.error('Failed to update stock:', err);
      toast.error(
        'Stock update failed',
        err?.message || 'Failed to update stock (Unauthorized)',
        { dedupeKey: `stock:${product.id}` }
      );
    } finally {
      setUpdatingId(null);
    }
  };

  // Variant-specific live stock update
  const handleUpdateVariantStock = async (
    product: Product,
    variantId: string,
    newVariantStock: number
  ) => {
    const variants = parseProductVariants(product);
    if (variants.length === 0) return;

    const clampedVariantStock = Math.max(0, Math.floor(newVariantStock));
    const nextVariants = variants.map((v) =>
      v.id === variantId ? { ...v, stock: clampedVariantStock } : { ...v }
    );
    const totalStock = getTotalVariantStock(nextVariants);
    const newStatus = calculateStatus(totalStock);
    const targetVariant = nextVariants.find((v) => v.id === variantId);

    setUpdatingId(`${product.id}:${variantId}`);
    try {
      await client.collection('products').update(product.id, {
        stock: totalStock,
        status: newStatus,
        variants: nextVariants,
      });
      toast.success(
        `Variant stock updated: ${product.name}`,
        `${targetVariant?.label || variantId}: ${clampedVariantStock} units (Total: ${totalStock})`,
        { dedupeKey: `stock:${product.id}:${variantId}` }
      );
    } catch (err: any) {
      console.error('Failed to update variant stock:', err);
      toast.error(
        'Variant stock update failed',
        err?.message || 'Failed to update stock (Unauthorized)',
        { dedupeKey: `stock:${product.id}:${variantId}` }
      );
    } finally {
      setUpdatingId(null);
    }
  };

  // Reset all products stock to standard 45 for easy demo testing
  const handleResetAllStock = async () => {
    if (!window.confirm('Reset all product stock levels to 45 units for testing?')) return;
    setIsResettingAll(true);
    try {
      for (const p of products) {
        const distributed = buildDistributedVariants(p, 45);
        await client.collection('products').update(p.id, {
          stock: 45,
          status: 'in_stock',
          ...(distributed ? { variants: distributed } : {}),
        });
      }
      toast.success('All product stocks reset', 'Every catalog item is now set to 45 units.');
    } catch (err: any) {
      toast.error('Error resetting stocks', err?.message || 'Please try again.');
    } finally {
      setIsResettingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Multi-Tab Testing Guide */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Store Manager View • Live SSE Active
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">
              Inventory & Catalog Control Center
            </h1>
            <p className="text-xs text-slate-300 max-w-xl">
              Real-time stock steppers emit immediate updates via SQLite change streams. All modifications propagate live to shoppers in other browser tabs without refreshing.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={onOpenAddProduct}
              className="px-4 py-2.5 rounded-xl font-bold text-xs bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-600/30 flex items-center gap-2 transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Product</span>
            </button>

            <button
              onClick={handleResetAllStock}
              disabled={isResettingAll}
              className="px-3.5 py-2.5 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              title="Reset all catalog products to 45 stock for repeatable demo testing"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isResettingAll ? 'animate-spin' : ''}`} />
              <span>Reset Stocks (45)</span>
            </button>

            <button
              onClick={onSwitchToShopper}
              className="px-3.5 py-2.5 rounded-xl font-semibold text-xs bg-white/10 hover:bg-white/20 text-white border border-white/15 flex items-center gap-1.5 transition-colors"
            >
              <span>View as Shopper</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-300" />
            </button>
          </div>
        </div>

        {/* Live SSE Multi-Tab Helper Box */}
        <div className="mt-5 pt-4 border-t border-white/10 flex items-center gap-3 text-xs text-slate-300 bg-white/5 p-3 rounded-2xl">
          <Info className="w-4 h-4 text-brand-400 shrink-0" />
          <span>
            <strong>Multi-Tab Realtime Demo:</strong> Open another browser tab at{' '}
            <code className="bg-black/30 px-1.5 py-0.5 rounded text-brand-300 font-mono">
              http://localhost:5173
            </code>{' '}
            in <strong>Shopper View</strong>. Click <strong>[+]</strong> or <strong>[-]</strong> below, and watch the stock counter and "Out of Stock" overlays change instantly in the shopper tab!
          </span>
        </div>
      </div>

      {/* Manager Workspace Tab Switcher */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div
          role="tablist"
          aria-label="Store Manager sections"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              const nextTab = activeTab === 'inventory' ? 'insights' : 'inventory';
              setActiveTab(nextTab);
              const targetId = nextTab === 'inventory' ? 'manager-tab-inventory' : 'manager-tab-insights';
              document.getElementById(targetId)?.focus();
            }
          }}
          className="inline-flex items-center p-1 rounded-2xl bg-slate-200/70 border border-slate-200 overflow-x-auto max-w-full"
        >
          <button
            type="button"
            id="manager-tab-inventory"
            role="tab"
            aria-selected={activeTab === 'inventory'}
            tabIndex={activeTab === 'inventory' ? 0 : -1}
            onClick={() => setActiveTab('inventory')}
            className={`store-tab inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              activeTab === 'inventory'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Package className="w-3.5 h-3.5 text-brand-600" aria-hidden="true" />
            <span>Inventory</span>
          </button>

          <button
            type="button"
            id="manager-tab-insights"
            role="tab"
            aria-selected={activeTab === 'insights'}
            tabIndex={activeTab === 'insights' ? 0 : -1}
            onClick={() => {
              setActiveTab('insights');
              setInsightsRefreshSignal((s) => s + 1);
            }}
            className={`store-tab inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              activeTab === 'insights'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-brand-600" aria-hidden="true" />
            <span>Store Insights</span>
          </button>
        </div>
      </div>

      {/* Store Insights Panel */}
      <div
        role="tabpanel"
        aria-labelledby="manager-tab-insights"
        hidden={activeTab !== 'insights'}
      >
        {activeTab === 'insights' && (
          <StoreManagerInsights
            refreshSignal={insightsRefreshSignal}
            onRestockProduct={async (productId, nextStock) => {
              const target = products.find((p) => p.id === productId);
              if (!target) {
                await client.collection('products').update(productId, {
                  stock: nextStock,
                  status: calculateStatus(nextStock),
                });
                await onRefresh();
                return;
              }
              await handleUpdateStock(target, nextStock);
            }}
          />
        )}
      </div>

      {/* Inventory Panel */}
      <div
        role="tabpanel"
        aria-labelledby="manager-tab-inventory"
        hidden={activeTab !== 'inventory'}
        className="space-y-6"
      >

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Total Catalog Items
            </span>
            <span className="text-2xl font-black text-slate-900">{metrics.total}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-bold">
            <Package className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">
              In Stock Units
            </span>
            <span className="text-2xl font-black text-emerald-600">{metrics.totalUnits}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <CheckCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider block">
              Low Stock Items (&le; 5)
            </span>
            <span className="text-2xl font-black text-amber-600">{metrics.lowStock}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-rose-600 uppercase tracking-wider block">
              Out of Stock (0)
            </span>
            <span className="text-2xl font-black text-rose-600">{metrics.outOfStock}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
            <XCircle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        
        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name, slug or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-700 outline-none font-medium"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setStockStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                stockStatusFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              All ({products.length})
            </button>
            <button
              onClick={() => setStockStatusFilter('low_stock')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                stockStatusFilter === 'low_stock' ? 'bg-amber-100 text-amber-900 font-bold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Low Stock ({metrics.lowStock})
            </button>
            <button
              onClick={() => setStockStatusFilter('out_of_stock')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                stockStatusFilter === 'out_of_stock' ? 'bg-rose-100 text-rose-900 font-bold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Out of Stock ({metrics.outOfStock})
            </button>
          </div>
        </div>

      </div>

      {/* Live Stock Editor Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500">
                <th className="py-3.5 px-4">Product</th>
                <th className="py-3.5 px-4">Category</th>
                <th className="py-3.5 px-4">Price</th>
                <th className="py-3.5 px-4 text-center">Live Stock Counter (+ / -)</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No products match the filter criteria.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => {
                  const variants = parseProductVariants(product);
                  const hasVariants = variants.length > 0;
                  const isExpanded = Boolean(expandedVariants[product.id]);
                  const effectiveStock = getEffectiveStock(product);
                  const isUpdating = updatingId === product.id;
                  const isRecentlyUpdated = recentlyUpdatedId === product.id;
                  const isOut = effectiveStock <= 0 || product.status === 'out_of_stock';
                  const isLow = !isOut && effectiveStock <= 5;
                  const categoryName = categories.find((c) => c.id === product.category)?.name || 'General';

                  return (
                    <React.Fragment key={product.id}>
                      <tr
                        className={`hover:bg-slate-50/80 transition-all duration-300 ${
                          isRecentlyUpdated ? 'bg-emerald-50/70 ring-2 ring-emerald-400/50' : ''
                        }`}
                      >
                        {/* Product details */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={getProductImageUrl(product)}
                              alt={product.name}
                              className="w-11 h-11 rounded-xl object-contain bg-slate-100 p-1 border border-slate-200/60 shrink-0"
                            />
                            <div className="space-y-0.5 max-w-xs">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-900 truncate">{product.name}</span>
                                {product.isFeatured && (
                                  <span title="Featured Item">
                                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-[11px] font-mono text-slate-400 truncate">{product.slug}</p>
                                {hasVariants && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedVariants((prev) => ({
                                        ...prev,
                                        [product.id]: !prev[product.id],
                                      }))
                                    }
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100 transition-colors"
                                  >
                                    <Layers className="w-3 h-3" />
                                    <span>{variants.length} variants</span>
                                    {isExpanded ? (
                                      <ChevronUp className="w-3 h-3" />
                                    ) : (
                                      <ChevronDown className="w-3 h-3" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Category */}
                        <td className="py-3 px-4 text-slate-600 font-medium">
                          <span className="px-2.5 py-1 rounded-md bg-slate-100 text-[11px] font-semibold text-slate-700">
                            {categoryName}
                          </span>
                        </td>

                        {/* Price */}
                        <td className="py-3 px-4 font-black text-slate-900">
                          ${product.price.toFixed(2)}
                        </td>

                        {/* Live Stock Stepper */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col items-center gap-1.5">
                            {/* Counter pill */}
                            <div className="inline-flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-xs">
                              <button
                                onClick={() => handleUpdateStock(product, effectiveStock - 1)}
                                disabled={isUpdating || effectiveStock <= 0}
                                className="w-8 h-8 rounded-xl bg-white hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 shadow-xs"
                                title="Decrease stock by 1"
                              >
                                -
                              </button>

                              <input
                                type="number"
                                min="0"
                                value={effectiveStock}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  if (!isNaN(val)) {
                                    handleUpdateStock(product, val);
                                  }
                                }}
                                className="w-14 text-center font-mono font-black text-sm bg-transparent outline-none text-slate-900"
                              />

                              <button
                                onClick={() => handleUpdateStock(product, effectiveStock + 1)}
                                disabled={isUpdating}
                                className="w-8 h-8 rounded-xl bg-white hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 shadow-xs"
                                title="Increase stock by 1"
                              >
                                +
                              </button>
                            </div>

                            {/* Quick preset chips */}
                            <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                              <button
                                onClick={() => handleUpdateStock(product, 0)}
                                className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-rose-100 hover:text-rose-700 transition-colors"
                                title="Set to 0 (Out of stock)"
                              >
                                Out (0)
                              </button>
                              <button
                                onClick={() => handleUpdateStock(product, effectiveStock + 5)}
                                className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 transition-colors"
                                title="Add 5 units"
                              >
                                +5
                              </button>
                              <button
                                onClick={() => handleUpdateStock(product, effectiveStock + 20)}
                                className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 transition-colors"
                                title="Add 20 units"
                              >
                                +20
                              </button>
                              <button
                                onClick={() => handleUpdateStock(product, 50)}
                                className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 transition-colors"
                                title="Reset to 50 units"
                              >
                                50
                              </button>
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3 px-4">
                          {isOut ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                              Out of Stock
                            </span>
                          ) : isLow ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                              Low Stock ({effectiveStock})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              In Stock ({effectiveStock})
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => onEditProduct(product)}
                              className="p-2 rounded-xl text-slate-500 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                              title="Edit Product Details"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => onDeleteProduct(product)}
                              className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              title="Delete Product"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>

                      </tr>

                      {/* Expandable Variant-Specific Stock Sub-Row */}
                      {hasVariants && isExpanded && (
                        <tr className="bg-slate-50/90">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="bg-white rounded-2xl border border-slate-200/80 p-3.5 space-y-2.5">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                                  <Layers className="w-3.5 h-3.5 text-brand-600" />
                                  Variant Stock Matrix ({variants.length} SKUs • Total: {effectiveStock})
                                </span>
                                <span className="text-slate-400">
                                  Live SSE updates per variant
                                </span>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                {variants.map((variant) => {
                                  const vStock = Math.max(0, Number(variant.stock) || 0);
                                  const isVarUpdating = updatingId === `${product.id}:${variant.id}`;
                                  const vPrice = getEffectiveUnitPrice(product, variant);

                                  return (
                                    <div
                                      key={variant.id}
                                      className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-xs ${
                                        vStock === 0
                                          ? 'bg-rose-50/50 border-rose-200'
                                          : vStock <= 3
                                          ? 'bg-amber-50/50 border-amber-200'
                                          : 'bg-slate-50/70 border-slate-200/80'
                                      }`}
                                    >
                                      <div className="min-w-0">
                                        <p className="font-bold text-slate-800 truncate">{variant.label}</p>
                                        <p className="text-[10px] text-slate-400 font-mono truncate">
                                          {variant.sku || variant.id} • ${vPrice.toFixed(2)}
                                        </p>
                                      </div>

                                      <div className="inline-flex items-center bg-white border border-slate-200 rounded-xl p-0.5 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateVariantStock(product, variant.id, vStock - 1)}
                                          disabled={isVarUpdating || vStock <= 0}
                                          className="w-6 h-6 rounded-lg hover:bg-slate-100 font-bold text-slate-700 disabled:opacity-40"
                                          title="Decrease variant stock"
                                        >
                                          -
                                        </button>
                                        <input
                                          type="number"
                                          min="0"
                                          value={vStock}
                                          onChange={(e) => {
                                            const val = parseInt(e.target.value, 10);
                                            if (!isNaN(val)) {
                                              handleUpdateVariantStock(product, variant.id, val);
                                            }
                                          }}
                                          className="w-10 text-center font-mono font-bold text-xs bg-transparent outline-none text-slate-900"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateVariantStock(product, variant.id, vStock + 1)}
                                          disabled={isVarUpdating}
                                          className="w-6 h-6 rounded-lg hover:bg-slate-100 font-bold text-slate-700 disabled:opacity-40"
                                          title="Increase variant stock"
                                        >
                                          +
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      </div>

    </div>
  );
};
