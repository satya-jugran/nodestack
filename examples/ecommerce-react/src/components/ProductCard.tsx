import React from 'react';
import { Product } from '../lib/types';
import { getProductImageUrl } from '../lib/nodestack';
import { Star, Heart, ShoppingBag, Check } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useFavorites } from '../context/FavoritesContext';

interface ProductCardProps {
  product: Product;
  onOpenDetails: (product: Product) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onOpenDetails }) => {
  const { addToCart, items } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();

  const isFav = isFavorite(product.id);
  const cartItem = items.find((i) => i.product.id === product.id);
  const inCart = Boolean(cartItem);

  const imageUrl = getProductImageUrl(product);

  const isOutOfStock = product.status === 'out_of_stock' || product.stock <= 0;

  return (
    <div className="group relative bg-white rounded-2xl border border-slate-200/80 hover:border-slate-300 hover:shadow-xl transition-all duration-300 flex flex-col overflow-hidden">
      
      {/* Thumbnail Container */}
      <div 
        className="relative aspect-square w-full bg-slate-100 overflow-hidden cursor-pointer flex items-center justify-center p-6"
        onClick={() => onOpenDetails(product)}
      >
        <img
          src={imageUrl}
          alt={product.name}
          className="w-full h-full object-contain group-hover:scale-108 transition-transform duration-300 drop-shadow-sm"
          loading="lazy"
        />

        {/* Favorite Heart Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(product);
          }}
          className={`absolute top-3 right-3 p-2 rounded-full backdrop-blur-md transition-all shadow-sm ${
            isFav
              ? 'bg-rose-50 text-rose-600 scale-110'
              : 'bg-white/80 text-slate-400 hover:text-rose-500 hover:bg-white'
          }`}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart className={`w-4 h-4 ${isFav ? 'fill-rose-500 text-rose-500' : ''}`} />
        </button>

        {/* Category badge */}
        {product.expand?.category && (
          <span className="absolute top-3 left-3 px-2.5 py-1 text-[11px] font-bold tracking-wide uppercase rounded-md bg-white/90 backdrop-blur-sm text-slate-700 shadow-xs">
            {product.expand.category.name}
          </span>
        )}

        {/* Out of Stock overlay */}
        {isOutOfStock && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center">
            <span className="bg-slate-900 text-white text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wider">
              Out of Stock
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between">
        <div className="space-y-1.5">
          {/* Rating */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            {product.reviewCount && product.reviewCount > 0 ? (
              <>
                <div className="flex items-center text-amber-400">
                  <Star className="w-3.5 h-3.5 fill-amber-400" />
                </div>
                <span className="font-bold text-slate-800">{product.rating ? product.rating.toFixed(1) : '5.0'}</span>
                <span className="text-slate-400">({product.reviewCount})</span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                <Star className="w-3.5 h-3.5 text-slate-300" />
                <span>No reviews yet</span>
              </span>
            )}
            <span className="text-slate-400">•</span>
            <span className="text-slate-400">
              {product.stock > 10 ? `${product.stock} in stock` : `${product.stock} left!`}
            </span>
          </div>

          {/* Title */}
          <h3
            onClick={() => onOpenDetails(product)}
            className="font-bold text-slate-900 text-sm sm:text-base line-clamp-1 group-hover:text-brand-600 transition-colors cursor-pointer"
            title={product.name}
          >
            {product.name}
          </h3>

          {/* Description excerpt */}
          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
            {product.description}
          </p>
        </div>

        {/* Price & Action */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <div>
            <span className="text-xs text-slate-400 block font-medium">Price</span>
            <span className="text-lg font-extrabold text-slate-900">
              ${product.price.toFixed(2)}
            </span>
          </div>

          <button
            onClick={() => addToCart(product, 1)}
            disabled={isOutOfStock}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 ${
              isOutOfStock
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : inCart
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                : 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-500/20'
            }`}
          >
            {inCart ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Added ({cartItem?.quantity})</span>
              </>
            ) : (
              <>
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>Add to Cart</span>
              </>
            )}
          </button>
        </div>
      </div>

    </div>
  );
};
