import React, { useState, useEffect, useMemo, useRef } from 'react';
import { client, getAdminUrl, getBackendUrl } from './lib/nodestack';
import { Category, Product, Review, ViewMode, FlashSaleState, SimulatedOrderEvent } from './lib/types';
import { useAuth } from './context/AuthContext';
import { useCart } from './context/CartContext';
import { useToast } from './context/ToastContext';
import { Navbar } from './components/Navbar';
import { HeroBanner } from './components/HeroBanner';
import { CategoryFilter } from './components/CategoryFilter';
import { FacetedFilters, FacetCounts } from './components/FacetedFilters';
import { ProductCard } from './components/ProductCard';
import { ProductModal } from './components/ProductModal';
import { CartDrawer } from './components/CartDrawer';
import { CheckoutModal } from './components/CheckoutModal';
import { OrdersModal } from './components/OrdersModal';
import { FavoritesModal } from './components/FavoritesModal';
import { AuthModal } from './components/AuthModal';
import { ManagerAuthModal } from './components/ManagerAuthModal';
import { StoreManagerView } from './components/StoreManagerView';
import { ProductFormModal } from './components/ProductFormModal';
import { FlashSaleController } from './components/FlashSaleController';
import { FlashSaleBanner } from './components/FlashSaleBanner';
import { ProductCarousel } from './components/ProductCarousel';
import {
  clearRecentlyViewedIds,
  getCustomersAlsoBoughtProducts,
  getRecentlyViewedIds,
  recordRecentlyViewedId,
  resolveRecentlyViewedProducts,
} from './lib/recentlyViewed';
import {
  DEFAULT_PRICE_RANGE,
  RATING_FILTER_OPTIONS,
  CatalogFilterState,
  countActiveFacetFilters,
  getProductDiscount,
  isPriceRangeFiltered,
  isProductInStock,
  matchesCatalogFilters,
  sortCatalogProducts,
} from './lib/filters';
import { Sparkles, Server, Database, ExternalLink, RefreshCw, Layers, X } from 'lucide-react';

export const App: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);

  // Filters & Search
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('-created');
  const [priceRange, setPriceRange] = useState<[number, number]>(DEFAULT_PRICE_RANGE);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [discountedOnly, setDiscountedOnly] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  const { isAuthenticated, isStoreManager } = useAuth();
  const { items: cartItems } = useCart();
  const { toast } = useToast();
  const [pendingCheckoutAfterAuth, setPendingCheckoutAfterAuth] = useState(false);

  // View Mode: Shopper vs Store Manager
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('mode') === 'manager' || urlParams.get('view') === 'manager') {
        return 'manager';
      }
      return (localStorage.getItem('nodestack_store_view_mode') as ViewMode) || 'shopper';
    }
    return 'shopper';
  });

  // Save view mode
  useEffect(() => {
    try {
      localStorage.setItem('nodestack_store_view_mode', viewMode);
    } catch {}
  }, [viewMode]);

  // If user is not manager and on manager view, fallback to shopper
  useEffect(() => {
    if (viewMode === 'manager' && !isStoreManager) {
      setViewMode('shopper');
    }
  }, [isStoreManager, viewMode]);

  // Modals state
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>(() =>
    getRecentlyViewedIds()
  );

  const handleOpenProduct = (product: Product) => {
    setActiveProduct(product);
    setRecentlyViewedIds(recordRecentlyViewedId(product.id));
  };

  const handleClearRecentlyViewed = () => {
    setRecentlyViewedIds(clearRecentlyViewedIds());
  };

  const recentlyViewedProducts = useMemo(
    () => resolveRecentlyViewedProducts(products, recentlyViewedIds),
    [products, recentlyViewedIds]
  );

  const alsoBoughtProducts = useMemo(
    () =>
      getCustomersAlsoBoughtProducts(
        products,
        recentlyViewedIds,
        cartItems.map((item) => item.product.id)
      ),
    [products, recentlyViewedIds, cartItems]
  );
  const resolvedActiveProduct = useMemo(
    () => (activeProduct ? products.find((p) => p.id === activeProduct.id) || activeProduct : null),
    [activeProduct, products]
  );
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [isManagerAuthOpen, setIsManagerAuthOpen] = useState(false);
  const [isProductFormOpen, setIsProductFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Realtime highlight & Flash Sale / Rush simulator
  const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null);
  const [flashSale, setFlashSale] = useState<FlashSaleState>({ isActive: false, discountPercent: 0 });
  const [isRushActive, setIsRushActive] = useState(false);
  const [latestSimulatedOrder, setLatestSimulatedOrder] = useState<SimulatedOrderEvent | null>(null);

  const handleProceedToCheckout = () => {
    if (isAuthenticated) {
      setIsCheckoutOpen(true);
    } else {
      setPendingCheckoutAfterAuth(true);
      setIsAuthOpen(true);
    }
  };

  useEffect(() => {
    if (isAuthenticated && pendingCheckoutAfterAuth) {
      setPendingCheckoutAfterAuth(false);
      setIsCheckoutOpen(true);
    }
  }, [isAuthenticated, pendingCheckoutAfterAuth]);

  // Products grid reference for scrolling & latest catalog ref for SSE comparisons
  const catalogRef = useRef<HTMLDivElement>(null);
  const productsRef = useRef<Product[]>(products);
  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  // Fetch initial catalog
  const loadData = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch categories
      const catRes = await client.collection('categories').getFullList();
      setCategories(catRes as unknown as Category[]);

      // 2. Fetch all reviews to compute live dynamic product ratings
      let allReviews: Review[] = [];
      try {
        const revRes = await client.collection('reviews').getFullList();
        allReviews = revRes as unknown as Review[];
      } catch {}

      // 3. Fetch products and apply dynamic ratings from reviews
      const prodRes = await client.collection('products').getList(1, 100, {
        expand: 'category',
        sort: sortBy,
      });

      const prodsWithDynamicRatings = (prodRes.items as unknown as Product[]).map((p) => {
        const pReviews = allReviews.filter((r) => r.product === p.id);
        if (pReviews.length > 0) {
          const avg = pReviews.reduce((sum, r) => sum + r.rating, 0) / pReviews.length;
          return {
            ...p,
            rating: Number(avg.toFixed(1)),
            reviewCount: pReviews.length,
          };
        }
        return {
          ...p,
          rating: 0,
          reviewCount: 0,
        };
      });

      setProducts(prodsWithDynamicRatings);
      setBackendConnected(true);
    } catch (err) {
      console.error('Failed to connect to NodeStack backend:', err);
      setBackendConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Setup Realtime SSE subscriptions for live updates
    let unsubscribeProducts: (() => void) | undefined;
    try {
      client.collection('products').subscribe('*', (e) => {
        if (e.action === 'update') {
          const incoming = e.record as unknown as Partial<Product>;
          const prevProduct = productsRef.current.find((p) => p.id === e.record.id);

          setRecentlyUpdatedId(e.record.id);
          setTimeout(() => setRecentlyUpdatedId(null), 1500);
          setProducts((prev) =>
            prev.map((p) => (p.id === e.record.id ? { ...p, ...e.record } : p))
          );

          if (prevProduct) {
            const productName = incoming.name || prevProduct.name;
            if (typeof incoming.stock === 'number' && incoming.stock !== prevProduct.stock) {
              toast.realtime(
                'Realtime: Stock updated',
                incoming.stock <= 0
                  ? `${productName} is now Out of Stock`
                  : `${productName} • ${incoming.stock} ${incoming.stock === 1 ? 'unit' : 'units'} left`,
                { dedupeKey: `stock:${e.record.id}` }
              );
            } else if (typeof incoming.price === 'number' && incoming.price !== prevProduct.price) {
              toast.realtime(
                'Realtime: Price updated',
                `${productName} • $${incoming.price.toFixed(2)}`,
                { dedupeKey: `price:${e.record.id}` }
              );
            }
          }
        } else if (e.action === 'create') {
          const alreadyExists = productsRef.current.some((p) => p.id === e.record.id);
          setRecentlyUpdatedId(e.record.id);
          setTimeout(() => setRecentlyUpdatedId(null), 1500);
          setProducts((prev) => {
            if (prev.some((p) => p.id === e.record.id)) {
              return prev.map((p) => (p.id === e.record.id ? { ...p, ...e.record } : p));
            }
            return [e.record as unknown as Product, ...prev];
          });
          if (!alreadyExists) {
            toast.realtime(
              'Realtime: Product added',
              (e.record as unknown as Partial<Product>).name || 'New catalog item',
              { dedupeKey: `create:${e.record.id}` }
            );
          }
        } else if (e.action === 'delete') {
          const removed = productsRef.current.find((p) => p.id === e.record.id);
          setProducts((prev) => prev.filter((p) => p.id !== e.record.id));
          if (removed) {
            toast.realtime('Realtime: Product removed', removed.name, {
              dedupeKey: `delete:${e.record.id}`,
            });
          }
        }
      }).then((unsub) => {
        unsubscribeProducts = unsub;
      }).catch((err) => {
        console.warn('Realtime subscription not active yet:', err);
      });
    } catch {}

    return () => {
      if (unsubscribeProducts) unsubscribeProducts();
    };
  }, [toast]);

  const filterState: CatalogFilterState = useMemo(
    () => ({
      selectedCategory,
      searchQuery,
      priceRange,
      minRating,
      featuredOnly,
      discountedOnly,
      inStockOnly,
    }),
    [
      selectedCategory,
      searchQuery,
      priceRange,
      minRating,
      featuredOnly,
      discountedOnly,
      inStockOnly,
    ]
  );

  // Filtered & sorted products computed client-side for ultra-fast instant feedback
  const filteredProducts = useMemo(() => {
    const matching = products.filter((p) =>
      matchesCatalogFilters(p, filterState, flashSale)
    );
    return sortCatalogProducts(matching, sortBy);
  }, [products, filterState, flashSale, sortBy]);

  // Facet counts computed with the target facet omitted so shoppers see real option counts
  const facetCounts: FacetCounts = useMemo(() => {
    const rating: Record<string, number> = {};
    const productsWithoutRating = products.filter((p) =>
      matchesCatalogFilters(p, filterState, flashSale, 'minRating')
    );
    for (const opt of RATING_FILTER_OPTIONS) {
      const key = opt.value === null ? 'all' : String(opt.value);
      rating[key] =
        opt.value === null
          ? productsWithoutRating.length
          : productsWithoutRating.filter((p) => (p.rating ?? 0) >= opt.value!).length;
    }

    const featured = products.filter(
      (p) =>
        Boolean(p.isFeatured) &&
        matchesCatalogFilters(p, filterState, flashSale, 'featuredOnly')
    ).length;

    const discounted = products.filter(
      (p) =>
        getProductDiscount(p, flashSale).isDiscounted &&
        matchesCatalogFilters(p, filterState, flashSale, 'discountedOnly')
    ).length;

    const inStock = products.filter(
      (p) =>
        isProductInStock(p) &&
        matchesCatalogFilters(p, filterState, flashSale, 'inStockOnly')
    ).length;

    return { rating, featured, discounted, inStock };
  }, [products, filterState, flashSale]);

  // Category pill counts reflecting active facet filters
  const { categoryCounts, totalUnfilteredCategoryCount } = useMemo(() => {
    const productsWithoutCategory = products.filter((p) =>
      matchesCatalogFilters(p, filterState, flashSale, 'selectedCategory')
    );
    const counts: Record<string, number> = {};
    for (const cat of categories) {
      counts[cat.id] = productsWithoutCategory.filter((p) => p.category === cat.id).length;
    }
    return {
      categoryCounts: counts,
      totalUnfilteredCategoryCount: productsWithoutCategory.length,
    };
  }, [products, categories, filterState, flashSale]);

  const activeFacetCount = useMemo(
    () => countActiveFacetFilters(filterState),
    [filterState]
  );

  const hasAnyActiveFilter =
    activeFacetCount > 0 || selectedCategory !== null || searchQuery.trim().length > 0;

  const resetFacetFilters = () => {
    setPriceRange(DEFAULT_PRICE_RANGE);
    setMinRating(null);
    setFeaturedOnly(false);
    setDiscountedOnly(false);
    setInStockOnly(false);
  };

  const resetAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory(null);
    resetFacetFilters();
  };

  const scrollToCatalog = () => {
    catalogRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
      
      {/* Global Flash Sale Banner & Simulated Order Toasts */}
      <FlashSaleBanner
        flashSale={flashSale}
        latestSimulatedOrder={latestSimulatedOrder}
      />

      {/* Navbar with Store Manager Switcher */}
      <Navbar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onOpenAuth={() => setIsAuthOpen(true)}
        onOpenOrders={() => setIsOrdersOpen(true)}
        onOpenFavorites={() => setIsFavoritesOpen(true)}
        viewMode={viewMode}
        onToggleViewMode={() => {
          if (viewMode === 'shopper') {
            if (isStoreManager) {
              setViewMode('manager');
            } else {
              setIsManagerAuthOpen(true);
            }
          } else {
            setViewMode('shopper');
          }
        }}
        onOpenManagerAuth={() => setIsManagerAuthOpen(true)}
      />

      {/* Backend connection banner if unreachable */}
      {backendConnected === false && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 py-3 text-center text-xs sm:text-sm text-rose-800 font-semibold flex items-center justify-center gap-2">
          <span>⚠️ Could not reach NodeStack at <strong>{getBackendUrl()}</strong>. Start it with:</span>
          <code className="bg-rose-100 px-2 py-0.5 rounded text-rose-900 font-mono">
            npm start -- --template ecommerce
          </code>
          <button
            onClick={loadData}
            className="ml-2 underline text-rose-950 font-bold flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {/* Main Content: Store Manager View vs Shopper View */}
      {viewMode === 'manager' && isStoreManager ? (
        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full py-8 space-y-6">
          <FlashSaleController
            products={products}
            flashSale={flashSale}
            setFlashSale={setFlashSale}
            isRushActive={isRushActive}
            setIsRushActive={setIsRushActive}
            onSimulatedOrder={(evt) => setLatestSimulatedOrder(evt)}
          />

          <StoreManagerView
            products={products}
            categories={categories}
            onOpenAddProduct={() => {
              setEditingProduct(null);
              setIsProductFormOpen(true);
            }}
            onEditProduct={(p) => {
              setEditingProduct(p);
              setIsProductFormOpen(true);
            }}
            onDeleteProduct={async (p) => {
              if (!window.confirm(`Are you sure you want to delete "${p.name}"?`)) return;
              try {
                await client.collection('products').delete(p.id);
                setProducts((prev) => prev.filter((item) => item.id !== p.id));
                toast.success('Product deleted', `"${p.name}" removed from catalog.`, {
                  dedupeKey: `delete:${p.id}`,
                });
              } catch (err: any) {
                console.error('Failed to delete product:', err);
                toast.error(
                  'Failed to delete product',
                  err?.message || 'Ensure you are signed in as Store Manager.'
                );
              }
            }}
            onRefresh={loadData}
            onSwitchToShopper={() => setViewMode('shopper')}
            recentlyUpdatedId={recentlyUpdatedId}
            flashSaleActive={flashSale.isActive}
          />
        </main>
      ) : (
        <>
          {/* Hero Banner */}
          <HeroBanner onExplore={scrollToCatalog} />

          {/* Main Content Area: Shopper Catalog */}
          <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full pb-16" ref={catalogRef}>
            
            {/* Category Pills & Sort Bar */}
            <CategoryFilter
              categories={categories}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
              categoryCounts={categoryCounts}
              totalProductCount={totalUnfilteredCategoryCount}
              sortBy={sortBy}
              onSortChange={setSortBy}
              activeFilterCount={activeFacetCount}
              isMobileFiltersOpen={isMobileFiltersOpen}
              onToggleMobileFilters={() => setIsMobileFiltersOpen((prev) => !prev)}
            />

            {/* Mobile Collapsible Faceted Filters */}
            {isMobileFiltersOpen && (
              <div className="lg:hidden mb-6">
                <FacetedFilters
                  priceRange={priceRange}
                  onPriceRangeChange={setPriceRange}
                  minRating={minRating}
                  onMinRatingChange={setMinRating}
                  featuredOnly={featuredOnly}
                  onFeaturedOnlyChange={setFeaturedOnly}
                  discountedOnly={discountedOnly}
                  onDiscountedOnlyChange={setDiscountedOnly}
                  inStockOnly={inStockOnly}
                  onInStockOnlyChange={setInStockOnly}
                  facetCounts={facetCounts}
                  activeFilterCount={activeFacetCount}
                  onResetAll={resetFacetFilters}
                />
              </div>
            )}

            {/* Desktop 2-Column Faceted Storefront Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8 items-start">
              {/* Desktop Sticky Faceted Filter Sidebar */}
              <aside className="hidden lg:block sticky top-20" aria-label="Product filters">
                <FacetedFilters
                  priceRange={priceRange}
                  onPriceRangeChange={setPriceRange}
                  minRating={minRating}
                  onMinRatingChange={setMinRating}
                  featuredOnly={featuredOnly}
                  onFeaturedOnlyChange={setFeaturedOnly}
                  discountedOnly={discountedOnly}
                  onDiscountedOnlyChange={setDiscountedOnly}
                  inStockOnly={inStockOnly}
                  onInStockOnlyChange={setInStockOnly}
                  facetCounts={facetCounts}
                  activeFilterCount={activeFacetCount}
                  onResetAll={resetFacetFilters}
                />
              </aside>

              {/* Results & Product Grid Column */}
              <div className="min-w-0">
                {/* Results Header */}
                <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                  <div
                    className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    <Layers className="w-4 h-4 text-brand-600" aria-hidden="true" />
                    <span>
                      {selectedCategory
                        ? categories.find((c) => c.id === selectedCategory)?.name
                        : 'All Products'}{' '}
                      ({filteredProducts.length})
                    </span>
                  </div>

                  {searchQuery && (
                    <span className="text-xs text-slate-500">
                      Filtering by: <strong className="text-slate-800 font-medium">"{searchQuery}"</strong>
                    </span>
                  )}
                </div>

                {/* Active Filter Chips */}
                {hasAnyActiveFilter && (
                  <div className="flex items-center flex-wrap gap-2 mb-5">
                    {selectedCategory && (
                      <button
                        type="button"
                        onClick={() => setSelectedCategory(null)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                      >
                        <span>
                          Category: {categories.find((c) => c.id === selectedCategory)?.name}
                        </span>
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}

                    {isPriceRangeFiltered(priceRange) && (
                      <button
                        type="button"
                        onClick={() => setPriceRange(DEFAULT_PRICE_RANGE)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100 transition-colors"
                      >
                        <span>
                          Price: ${priceRange[0]} – ${priceRange[1]}
                        </span>
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}

                    {minRating !== null && (
                      <button
                        type="button"
                        onClick={() => setMinRating(null)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors"
                      >
                        <span>{minRating}★ &amp; above</span>
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}

                    {featuredOnly && (
                      <button
                        type="button"
                        onClick={() => setFeaturedOnly(false)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors"
                      >
                        <span>Featured Only</span>
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}

                    {discountedOnly && (
                      <button
                        type="button"
                        onClick={() => setDiscountedOnly(false)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors"
                      >
                        <span>Discounted</span>
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}

                    {inStockOnly && (
                      <button
                        type="button"
                        onClick={() => setInStockOnly(false)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                      >
                        <span>In Stock Only</span>
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}

                    {searchQuery.trim() && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 transition-colors"
                      >
                        <span>Search: "{searchQuery.trim()}"</span>
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={resetAllFilters}
                      className="text-xs font-bold text-slate-500 hover:text-slate-900 underline px-1.5 py-1 transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                )}

                {/* Product Grid */}
                {isLoading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                    {[...Array(6)].map((_, i) => (
                      <div
                        key={i}
                        className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 animate-pulse"
                      >
                        <div className="aspect-square bg-slate-100 rounded-xl"></div>
                        <div className="h-4 bg-slate-100 rounded w-3/4"></div>
                        <div className="h-3 bg-slate-100 rounded w-1/2"></div>
                        <div className="h-8 bg-slate-100 rounded"></div>
                      </div>
                    ))}
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="text-center py-20 bg-white rounded-3xl border border-slate-200/80 p-8 space-y-3">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                      <Sparkles className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">No matching products found</h3>
                    <p className="text-sm text-slate-500 max-w-sm mx-auto">
                      Try widening your price range, lowering the rating threshold, or clearing active toggles.
                    </p>
                    <button
                      type="button"
                      onClick={resetAllFilters}
                      className="px-4 py-2 text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-full transition-colors"
                    >
                      Reset All Filters
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredProducts.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        flashSale={flashSale}
                        onOpenDetails={handleOpenProduct}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {!isLoading && (
              <ProductCarousel
                recentlyViewedProducts={recentlyViewedProducts}
                alsoBoughtProducts={alsoBoughtProducts}
                flashSale={flashSale}
                onOpenDetails={handleOpenProduct}
                onClearRecentlyViewed={handleClearRecentlyViewed}
              />
            )}

          </main>
        </>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-slate-500">
          
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-brand-600 text-white flex items-center justify-center font-bold text-xs">
              NS
            </div>
            <div>
              <p className="font-bold text-slate-800">NodeStack E-Commerce Demo Storefront</p>
              <p className="text-slate-400">Single-process TypeScript backend with embedded SQLite & Fastify</p>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <a
              href={getAdminUrl('/_/')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 transition-colors"
            >
              <Server className="w-3.5 h-3.5 text-brand-600" />
              <span>NodeStack Admin Dashboard</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>

            <a
              href={getAdminUrl('/_/docs')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 transition-colors"
            >
              <Database className="w-3.5 h-3.5 text-emerald-600" />
              <span>API OpenAPI Docs</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
          </div>

        </div>
      </footer>

      {/* Slide-out Cart Drawer */}
      <CartDrawer onProceedToCheckout={handleProceedToCheckout} />

      {/* Product Detail & Reviews Modal */}
      <ProductModal
        product={resolvedActiveProduct}
        flashSale={flashSale}
        onClose={() => setActiveProduct(null)}
        onOpenAuth={() => setIsAuthOpen(true)}
        onReviewSubmitted={(productId, newRating, newCount) => {
          setProducts((prev) =>
            prev.map((p) =>
              p.id === productId
                ? { ...p, rating: newRating, reviewCount: newCount }
                : p
            )
          );
          if (activeProduct && activeProduct.id === productId) {
            setActiveProduct((prev) =>
              prev ? { ...prev, rating: newRating, reviewCount: newCount } : null
            );
          }
        }}
      />

      {/* Checkout Modal */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        onViewOrders={() => setIsOrdersOpen(true)}
      />

      {/* Past Orders Modal */}
      <OrdersModal
        isOpen={isOrdersOpen}
        onClose={() => setIsOrdersOpen(false)}
        onOpenAuth={() => setIsAuthOpen(true)}
        onReviewProduct={handleOpenProduct}
      />

      {/* Favorites Modal */}
      <FavoritesModal
        isOpen={isFavoritesOpen}
        onClose={() => setIsFavoritesOpen(false)}
        products={products}
        onOpenDetails={handleOpenProduct}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => {
          setIsAuthOpen(false);
          setPendingCheckoutAfterAuth(false);
        }}
        title={pendingCheckoutAfterAuth ? 'Sign In to Complete Checkout' : undefined}
        subtitle={
          pendingCheckoutAfterAuth
            ? 'Sign in or use 1-click demo access to place your order and stream live tracking.'
            : undefined
        }
      />

      {/* Manager Access Restriction Modal */}
      <ManagerAuthModal
        isOpen={isManagerAuthOpen}
        onClose={() => setIsManagerAuthOpen(false)}
        onSuccess={() => {
          setViewMode('manager');
        }}
      />

      {/* Create & Edit Product Modal */}
      <ProductFormModal
        isOpen={isProductFormOpen}
        onClose={() => {
          setIsProductFormOpen(false);
          setEditingProduct(null);
        }}
        product={editingProduct}
        categories={categories}
        onSuccess={(savedProduct, isNew) => {
          setProducts((prev) => {
            const exists = prev.some((p) => p.id === savedProduct.id);
            if (exists) {
              return prev.map((p) => (p.id === savedProduct.id ? { ...p, ...savedProduct } : p));
            }
            return [savedProduct, ...prev];
          });
          toast.success(
            isNew ? 'Product created' : 'Product updated',
            savedProduct.name,
            { dedupeKey: isNew ? `create:${savedProduct.id}` : `update:${savedProduct.id}` }
          );
        }}
        onDelete={(productId) => {
          setProducts((prev) => prev.filter((p) => p.id !== productId));
        }}
      />

    </div>
  );
};
