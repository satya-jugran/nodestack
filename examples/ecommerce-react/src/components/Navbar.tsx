import React, { useState } from 'react';
import { ShoppingBag, Heart, Search, User, LogOut, Package, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useFavorites } from '../context/FavoritesContext';

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

  return (
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

          {/* Search bar */}
          <div className="flex-1 max-w-lg hidden md:block">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search products by title, specs, category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-sm bg-slate-100 hover:bg-slate-50 focus:bg-white border border-transparent focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 rounded-full transition-all outline-none"
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
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                      <div className="px-4 py-2 border-b border-slate-100">
                        <p className="text-xs text-slate-400 font-medium">Signed in as</p>
                        <p className="text-sm font-bold text-slate-800 truncate">{user.email}</p>
                      </div>

                      <button
                        onClick={() => {
                          setUserDropdownOpen(false);
                          onOpenOrders();
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 font-medium"
                      >
                        <Package className="w-4 h-4 text-slate-400" /> Past Orders & Reviews
                      </button>

                      <button
                        onClick={() => {
                          setUserDropdownOpen(false);
                          onOpenFavorites();
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 font-medium"
                      >
                        <Heart className="w-4 h-4 text-slate-400" /> My Favorites ({favoriteCount})
                      </button>

                      <div className="border-t border-slate-100 mt-1 pt-1">
                        <button
                          onClick={() => {
                            setUserDropdownOpen(false);
                            logout();
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 font-medium"
                        >
                          <LogOut className="w-4 h-4" /> Sign Out
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={demoLogin}
                  className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-full transition-colors shadow-sm"
                  title="Instant 1-Click Login as Demo User"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  1-Click Demo Login
                </button>
                <button
                  onClick={onOpenAuth}
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 active:scale-95 rounded-full transition-all shadow-sm"
                >
                  Sign In
                </button>
              </div>
            )}

          </div>

        </div>

        {/* Mobile Search Input */}
        <div className="pb-3 md:hidden">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm bg-slate-100 focus:bg-white border border-transparent focus:border-brand-500 rounded-full outline-none"
            />
          </div>
        </div>
      </div>
    </header>
  );
};
