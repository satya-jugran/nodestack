import React from 'react';
import { FlashSaleState, Product } from '../lib/types';
import { getProductImageUrl } from '../lib/nodestack';
import { getProductDiscount } from '../lib/filters';
import {
  getColorSwatchHex,
  getEffectiveStock,
  parseProductVariants,
  parseVariantOptions,
} from '../lib/variants';
import { Star, Heart, ShoppingBag, Check, Sparkles, Sliders } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useFavorites } from '../context/FavoritesContext';

interface ProductCardProps {
  product: Product;
  flashSale?: FlashSaleState;
  onOpenDetails: (product: Product) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  flashSale,
  onOpenDetails,
}) => {
  const { addToCart, items } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();

  const isFav = isFavorite(product.id);
  const productCartQty = items
    .filter((i) => i.product.id === product.id)
    .reduce((sum, i) => sum + i.quantity, 0);
  const inCart = productCartQty > 0;

  const optionGroups = parseVariantOptions(product);
  const variants = parseProductVariants(product);
  const hasVariants = variants.length > 0 && optionGroups.length > 0;
  const totalStock = getEffectiveStock(product);

  const imageUrl = getProductImageUrl(product);
  const isOutOfStock = product.status === 'out_of_stock' || totalStock <= 0;
  const discount = getProductDiscount(product, flashSale);
  const isFeatured = Boolean(product.isFeatured);

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

        {/* Featured & Discount Badges */}
        {(isFeatured || discount.isDiscounted) && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 flex-wrap">
            {isFeatured && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100/95 text-amber-900 border border-amber-200/80 shadow-xs">
                <Sparkles className="w-3 h-3 text-amber-600" />
                Featured
              </span>
            )}
            {discount.isDiscounted && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-600 text-white shadow-xs">
                -{discount.discountPercent}% OFF
              </span>
            )}
          </div>
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
          {/* Rating & Social Proof */}
          <div className="flex items-center flex-wrap gap-1.5 text-xs text-slate-500">
            {product.reviewCount && product.reviewCount > 0 ? (
              <>
                <div className="flex items-center text-amber-400">
                  <Star className="w-3.5 h-3.5 fill-amber-400" />
                </div>
                <span className="font-bold text-slate-800">{product.rating ? product.rating.toFixed(1) : '5.0'}</span>
                <span className="text-slate-400">({product.reviewCount})</span>
                {(product.verifiedReviewCount ?? 0) > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80"
                    title={`${product.verifiedReviewCount} verified buyer ${
                      product.verifiedReviewCount === 1 ? 'review' : 'reviews'
                    }`}
                  >
                    ✓ {product.verifiedReviewCount} verified
                  </span>
                )}
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                <Star className="w-3.5 h-3.5 text-slate-300" />
                <span>No reviews yet</span>
              </span>
            )}
            <span className="text-slate-400">•</span>
            <span className="text-slate-400">
              {totalStock > 10 ? `${totalStock} in stock` : `${totalStock} left!`}
            </span>
            {(product.favoriteCount ?? 0) > 0 && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-600 border border-rose-200/70"
                title={`Saved by ${product.favoriteCount} ${
                  product.favoriteCount === 1 ? 'shopper' : 'shoppers'
                }`}
              >
                ♥ {product.favoriteCount} saved
              </span>
            )}
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

          {/* Variant Options Preview */}
          {hasVariants && (
            <div className="pt-1 flex items-center flex-wrap gap-1.5">
              {optionGroups.map((group) => {
                const isColorGroup =
                  group.name.toLowerCase().includes('color') ||
                  group.name.toLowerCase().includes('finish');
                if (isColorGroup) {
                  return (
                    <div
                      key={group.name}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200/70"
                      title={`${group.name}: ${group.values.join(', ')}`}
                    >
                      {group.values.slice(0, 4).map((val) => {
                        const hex = getColorSwatchHex(val);
                        return hex ? (
                          <span
                            key={val}
                            className="w-2.5 h-2.5 rounded-full border border-black/15"
                            style={{ backgroundColor: hex }}
                          />
                        ) : (
                          <span key={val} className="text-[10px] font-semibold text-slate-600">
                            {val}
                          </span>
                        );
                      })}
                    </div>
                  );
                }
                return (
                  <span
                    key={group.name}
                    className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200/70"
                  >
                    {group.name}: {group.values.join('/')}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Price & Action */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <div>
            <span className="text-xs text-slate-400 block font-medium">Price</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-extrabold text-slate-900">
                ${product.price.toFixed(2)}
              </span>
              {discount.isDiscounted && discount.originalPrice !== null && (
                <span className="text-xs font-semibold text-slate-400 line-through">
                  ${discount.originalPrice.toFixed(2)}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={() => (hasVariants ? onOpenDetails(product) : addToCart(product, 1))}
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
                <span>Added ({productCartQty})</span>
              </>
            ) : hasVariants ? (
              <>
                <Sliders className="w-3.5 h-3.5" />
                <span>Select Options</span>
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
