import React, { useState, useEffect, useMemo, useRef } from 'react';
import { client } from './lib/nodestack';
import { Category, Product, Review } from './lib/types';
import { Navbar } from './components/Navbar';
import { HeroBanner } from './components/HeroBanner';
import { CategoryFilter } from './components/CategoryFilter';
import { ProductCard } from './components/ProductCard';
import { ProductModal } from './components/ProductModal';
import { CartDrawer } from './components/CartDrawer';
import { CheckoutModal } from './components/CheckoutModal';
import { OrdersModal } from './components/OrdersModal';
import { FavoritesModal } from './components/FavoritesModal';
import { AuthModal } from './components/AuthModal';
import { Sparkles, Server, Database, ExternalLink, RefreshCw, Layers } from 'lucide-react';

export const App: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);

  // Filters & Search
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('-created');
  const [inStockOnly, setInStockOnly] = useState(false);

  // Modals state
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);

  // Products grid reference for scrolling
  const catalogRef = useRef<HTMLDivElement>(null);

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
          setProducts((prev) =>
            prev.map((p) => (p.id === e.record.id ? { ...p, ...e.record } : p))
          );
        } else if (e.action === 'create') {
          setProducts((prev) => [e.record as unknown as Product, ...prev]);
        } else if (e.action === 'delete') {
          setProducts((prev) => prev.filter((p) => p.id !== e.record.id));
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
  }, []);

  // Filtered & sorted products computed client-side for ultra-fast instant feedback
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Category filter
      if (selectedCategory && p.category !== selectedCategory) {
        return false;
      }
      // In stock filter
      if (inStockOnly && (p.status === 'out_of_stock' || p.stock <= 0)) {
        return false;
      }
      // Search filter (name, description, slug)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesDesc = p.description.toLowerCase().includes(q);
        const matchesCat = p.expand?.category?.name.toLowerCase().includes(q);
        if (!matchesName && !matchesDesc && !matchesCat) {
          return false;
        }
      }
      return true;
    }).sort((a, b) => {
      if (sortBy === 'price') return a.price - b.price;
      if (sortBy === '-price') return b.price - a.price;
      if (sortBy === '-rating') return (b.rating || 0) - (a.rating || 0);
      return 0; // default order
    });
  }, [products, selectedCategory, searchQuery, inStockOnly, sortBy]);

  const scrollToCatalog = () => {
    catalogRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
      
      {/* Navbar */}
      <Navbar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onOpenAuth={() => setIsAuthOpen(true)}
        onOpenOrders={() => setIsOrdersOpen(true)}
        onOpenFavorites={() => setIsFavoritesOpen(true)}
      />

      {/* Backend connection banner if unreachable */}
      {backendConnected === false && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 py-3 text-center text-xs sm:text-sm text-rose-800 font-semibold flex items-center justify-center gap-2">
          <span>⚠️ Could not reach NodeStack at <strong>http://localhost:8090</strong>. Start it with:</span>
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

      {/* Hero Banner */}
      <HeroBanner onExplore={scrollToCatalog} />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full pb-16" ref={catalogRef}>
        
        {/* Filters */}
        <CategoryFilter
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          sortBy={sortBy}
          onSortChange={setSortBy}
          inStockOnly={inStockOnly}
          onToggleInStock={setInStockOnly}
        />

        {/* Results Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Layers className="w-4 h-4 text-brand-600" />
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

        {/* Product Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => (
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
              Try adjusting your search keywords, clear category filters, or uncheck "In Stock Only".
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory(null);
                setInStockOnly(false);
              }}
              className="px-4 py-2 text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-full transition-colors"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onOpenDetails={setActiveProduct}
              />
            ))}
          </div>
        )}

      </main>

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
              href="http://localhost:8090/_/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 transition-colors"
            >
              <Server className="w-3.5 h-3.5 text-brand-600" />
              <span>NodeStack Admin Dashboard</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>

            <a
              href="http://localhost:8090/_/docs"
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
      <CartDrawer onProceedToCheckout={() => setIsCheckoutOpen(true)} />

      {/* Product Detail & Reviews Modal */}
      <ProductModal
        product={activeProduct}
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
        onReviewProduct={(product) => setActiveProduct(product)}
      />

      {/* Favorites Modal */}
      <FavoritesModal
        isOpen={isFavoritesOpen}
        onClose={() => setIsFavoritesOpen(false)}
        products={products}
        onOpenDetails={setActiveProduct}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
      />

    </div>
  );
};
