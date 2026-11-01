import React, { useState } from 'react';
import {
  ShoppingBag,
  Heart,
  Search,
  User,
  LogOut,
  Package,
  Sparkles,
  Zap,
  ExternalLink,
  Layers,
  Cpu,
  GitBranch,
  X,
  CheckCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useFavorites } from '../context/FavoritesContext';
import { getAdminUrl } from '../lib/nodestack';

interface NavbarProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onOpenAuth: () => void;
  onOpenOrders: () => void;
  onOpenFavorites: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  searchQuery,
  setSearchQuery,
  onOpenAuth,
  onOpenOrders,
  onOpenFavorites,
}) => {
  const { user, isAuthenticated, logout, demoLogin } = useAuth();
  const { itemCount, setIsCartOpen } = useCart();
  const { favoriteCount } = useFavorites();
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [isArchitectureOpen, setIsArchitectureOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            
            {/* Logo */}
            <div className="flex items-center gap-3">
              <a href="#" className="flex items-center gap-2 group">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center text-white font-bold shadow-md shadow-brand-500/20 group-hover:scale-105 transition-transform">
                  <ShoppingBag className="w-5 h-5" />
                </div>
                <div className="flex flex-col">
                  <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                    NodeStack<span className="text-brand-600 font-black">Store</span>
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-600 tracking-wider uppercase -mt-1 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Live Backend
                  </span>
                </div>
              </a>
            </div>

            {/* NodeStack Capabilities Showcase Pill */}
            <button
              onClick={() => setIsArchitectureOpen(true)}
              className="hidden lg:flex items-center gap-2 px-3.5 py-1.5 bg-gradient-to-r from-brand-50 to-indigo-50 hover:from-brand-100 hover:to-indigo-100 text-brand-800 border border-brand-200/80 rounded-full text-xs font-bold transition-all shadow-xs group"
              title="View NodeStack Multi-App, Lambdas & Flows Architecture"
            >
              <Zap className="w-3.5 h-3.5 text-brand-600 animate-pulse" />
              <span>App: ecommerce-demo</span>
              <span className="text-slate-300">•</span>
              <span className="text-[11px] font-medium text-brand-700">Lambdas & Flows Active</span>
              <ExternalLink className="w-3 h-3 text-brand-500 opacity-60 group-hover:opacity-100 transition-opacity" />
            </button>

            {/* Search bar */}
            <div className="flex-1 max-w-xs md:max-w-sm hidden sm:block">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search products, categories..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-1.5 text-xs bg-slate-100 hover:bg-slate-50 focus:bg-white border border-transparent focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 rounded-full transition-all outline-none"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 hover:text-slate-600"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Favorites Icon */}
              <button
                onClick={onOpenFavorites}
                className="relative p-2.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors"
                title="Favorites"
              >
                <Heart className="w-5 h-5" />
                {favoriteCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-sm">
                    {favoriteCount}
                  </span>
                )}
              </button>

              {/* Cart Icon */}
              <button
                onClick={() => setIsCartOpen(true)}
                className="relative p-2.5 text-slate-600 hover:text-brand-600 hover:bg-brand-50 rounded-full transition-colors"
                title="Shopping Cart"
              >
                <ShoppingBag className="w-5 h-5" />
                {itemCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-brand-600 text-white text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-sm animate-scale-in">
                    {itemCount}
                  </span>
                )}
              </button>

              {/* User Account / Auth */}
              {isAuthenticated && user ? (
                <div className="relative">
                  <button
                    onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                    className="flex items-center gap-2 py-1.5 px-3 bg-slate-100 hover:bg-slate-200/80 rounded-full text-sm font-semibold text-slate-800 transition-colors"
                  >
                    <div className="w-6 h-6 rounded-full bg-brand-600 text-white flex items-center justify-center text-xs font-bold uppercase">
                      {user.name ? user.name[0] : user.email[0]}
                    </div>
                    <span className="max-w-[100px] truncate hidden sm:inline">
                      {user.name || user.email.split('@')[0]}
                    </span>
                  </button>

                  {userDropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setUserDropdownOpen(false)}
                      />
                      <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                        <div className="px-4 py-2 border-b border-slate-100">
                          <p className="text-xs font-bold text-slate-900 truncate">{user.name || 'Demo Customer'}</p>
                          <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
                        </div>

                        <button
                          onClick={() => {
                            setUserDropdownOpen(false);
                            onOpenOrders();
                          }}
                          className="w-full px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
                        >
                          <Package className="w-4 h-4 text-slate-400" />
                          <span>My Orders & Tracking</span>
                        </button>

                        <button
                          onClick={() => {
                            setUserDropdownOpen(false);
                            setIsArchitectureOpen(true);
                          }}
                          className="w-full px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
                        >
                          <Zap className="w-4 h-4 text-brand-600" />
                          <span>NodeStack Architecture</span>
                        </button>

                        <button
                          onClick={() => {
                            setUserDropdownOpen(false);
                            logout();
                          }}
                          className="w-full px-4 py-2 text-left text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-medium"
                        >
                          <LogOut className="w-4 h-4" />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={demoLogin}
                    className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-brand-700 bg-brand-50 hover:bg-brand-100 transition-colors border border-brand-200"
                    title="1-Click Login as Alex Vance"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-brand-600" />
                    <span>Demo Login</span>
                  </button>

                  <button
                    onClick={onOpenAuth}
                    className="p-2 sm:px-4 sm:py-2 rounded-full text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 transition-colors shadow-sm"
                  >
                    <span className="hidden sm:inline">Sign In</span>
                    <User className="w-4 h-4 sm:hidden" />
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      </header>

      {/* NodeStack Capabilities Architecture Modal */}
      {isArchitectureOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="fixed inset-0" onClick={() => setIsArchitectureOpen(false)} />

          <div className="relative bg-white rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl z-10 border border-slate-100 p-6 sm:p-8 space-y-5">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-slate-900">
                    NodeStack Capabilities Showcase
                  </h3>
                  <p className="text-xs text-slate-500">
                    Built-in Multi-App, Serverless Lambdas & Orchestration Flows
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsArchitectureOpen(false)}
                className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Multi-App Core */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-brand-600" />
                  <span>Multi-Application Architecture</span>
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  Active App: ecommerce-demo
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                NodeStack ships with <code>ecommerce-demo</code> pre-seeded alongside the clean <code>default</code> app. This storefront connects to <code>ecommerce-demo</code> with isolated SQLite storage, 6 collections, 20 products with SVG images, and verified reviews.
              </p>
            </div>

            {/* Serverless Functions */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-brand-600" />
                <span>6 Embedded Serverless Functions (QuickJS-WASM)</span>
              </span>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 pt-1">
                <div className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> <code>calculate-discount</code></div>
                <div className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> <code>validate-order</code></div>
                <div className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> <code>update-inventory</code></div>
                <div className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> <code>generate-tracking-label</code></div>
                <div className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> <code>grant-loyalty-points</code></div>
                <div className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> <code>send-order-notification</code></div>
              </div>
            </div>

            {/* Step-Function Flows */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-brand-600" />
                <span>2 Orchestration Flows</span>
              </span>
              <ul className="text-xs text-slate-600 space-y-1.5 pt-1">
                <li>
                  <strong>OrderFulfillmentFlow</strong> (Event: <code>orders:create</code>): State machine running validation, parallel inventory deduction & carrier tracking label generation, and VIP tier awards.
                </li>
                <li>
                  <strong>CheckoutPromotionFlow</strong> (HTTP): Multi-tier promo evaluator unlocking bundle perks for carts $150+.
                </li>
              </ul>
            </div>

            {/* Footer Admin Link */}
            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <a
                href={getAdminUrl('/_/')}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-3 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-brand-500/20"
              >
                <span>Open NodeStack Admin UI & Flow Visualizer</span>
                <ExternalLink className="w-4 h-4" />
              </a>
              <button
                onClick={() => setIsArchitectureOpen(false)}
                className="py-3 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
