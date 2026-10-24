import React from 'react';
import { Product } from '../lib/types';
import { getProductImageUrl } from '../lib/nodestack';
import { useFavorites } from '../context/FavoritesContext';
import { useCart } from '../context/CartContext';
import { X, Heart, ShoppingBag, Trash2 } from 'lucide-react';

interface FavoritesModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onOpenDetails: (product: Product) => void;
}

export const FavoritesModal: React.FC<FavoritesModalProps> = ({
  isOpen,
  onClose,
  products,
  onOpenDetails,
}) => {
  const { favoriteProductIds, toggleFavorite } = useFavorites();
  const { addToCart } = useCart();

  if (!isOpen) return null;

  const favProducts = products.filter((p) => favoriteProductIds.includes(p.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative bg-white rounded-3xl max-w-xl w-full max-h-[85vh] overflow-y-auto shadow-2xl z-10 border border-slate-100 p-6 sm:p-8 flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Heart className="w-5 h-5 fill-rose-500 text-rose-500" />
            </div>
            <div>
              <h2 className="font-extrabold text-xl text-slate-900">
                Your Favorites ({favProducts.length})
              </h2>
              <p className="text-xs text-slate-500">
                Saved items synced with NodeStack backend
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
        <div className="flex-1 py-4 space-y-3">
          {favProducts.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm space-y-2">
              <Heart className="w-10 h-10 mx-auto text-slate-300" />
              <p className="font-bold text-slate-700">No favorite items yet</p>
              <p className="text-xs">Click the heart icon on any product to save it here.</p>
            </div>
          ) : (
            favProducts.map((prod) => {
              const img = getProductImageUrl(prod);

              return (
                <div
                  key={prod.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors"
                >
                  <div
                    className="flex items-center gap-3 cursor-pointer min-w-0"
                    onClick={() => {
                      onClose();
                      onOpenDetails(prod);
                    }}
                  >
                    <div className="w-14 h-14 rounded-xl bg-white border border-slate-100 p-2 flex items-center justify-center shrink-0">
                      <img
                        src={img}
                        alt={prod.name}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <div className="min-w-0 truncate">
                      <h4 className="font-bold text-sm text-slate-900 truncate hover:text-brand-600">
                        {prod.name}
                      </h4>
                      <p className="text-xs font-bold text-brand-600 mt-0.5">
                        ${prod.price.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => addToCart(prod, 1)}
                      className="px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 active:scale-95 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm"
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>

                    <button
                      onClick={() => toggleFavorite(prod)}
                      className="p-2 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 transition-colors"
                      title="Remove from favorites"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

      </div>
    </div>
  );
};
