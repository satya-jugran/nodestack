import React, { useState, useEffect } from 'react';
import { Product, Review } from '../lib/types';
import { client, getProductImageUrl } from '../lib/nodestack';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useFavorites } from '../context/FavoritesContext';
import {
  X,
  Star,
  Heart,
  ShoppingBag,
  CheckCircle2,
  ShieldCheck,
  Send,
  MessageSquare,
  Sparkles,
} from 'lucide-react';

interface ProductModalProps {
  product: Product | null;
  onClose: () => void;
  onOpenAuth: () => void;
  onReviewSubmitted?: (productId: string, newRating: number, newCount: number) => void;
}

export const ProductModal: React.FC<ProductModalProps> = ({
  product,
  onClose,
  onOpenAuth,
  onReviewSubmitted,
}) => {
  const { user, isAuthenticated } = useAuth();
  const { addToCart } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [quantity, setQuantity] = useState(1);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const [hasPurchased, setHasPurchased] = useState(false);

  // Review Form State
  const [newRating, setNewRating] = useState(5);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewSuccessMsg, setReviewSuccessMsg] = useState('');

  useEffect(() => {
    if (!product) return;
    setQuantity(1);
    setReviewSuccessMsg('');

    let isMounted = true;

    // Load reviews for this product
    async function loadReviews() {
      setIsLoadingReviews(true);
      try {
        const res = await client.collection('reviews').getList(1, 50, {
          filter: `product = "${product!.id}"`,
          sort: '-created',
        });
        if (isMounted) {
          setReviews(res.items as unknown as Review[]);
        }
      } catch (err) {
        console.error('Failed to load reviews:', err);
      } finally {
        if (isMounted) setIsLoadingReviews(false);
      }
    }

    // Check if current user purchased this product
    async function checkPurchased() {
      if (!isAuthenticated || !user) {
        setHasPurchased(false);
        return;
      }
      try {
        const res = await client.collection('orders').getList(1, 50, {
          filter: `customerEmail = "${user.email}"`,
        });
        let purchased = false;
        for (const order of res.items) {
          try {
            const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
            if (Array.isArray(items) && items.some((i: any) => i.productId === product!.id)) {
              purchased = true;
              break;
            }
          } catch {}
        }
        if (isMounted) setHasPurchased(purchased);
      } catch {
        if (isMounted) setHasPurchased(false);
      }
    }

    loadReviews();
    checkPurchased();

    return () => {
      isMounted = false;
    };
  }, [product, isAuthenticated, user?.email]);

  if (!product) return null;

  const isFav = isFavorite(product.id);
  const imageUrl = getProductImageUrl(product);

  const computedRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : (product.rating || 5.0);

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;

    setIsSubmittingReview(true);
    try {
      const created = await client.collection('reviews').create({
        product: product.id,
        user: user?.id,
        author: user?.name || user?.email || 'Verified Customer',
        rating: newRating,
        title: newTitle.trim() || 'Product Review',
        content: newContent.trim(),
        verifiedPurchase: hasPurchased ? 1 : 0,
      });

      const updatedReviews = [created as unknown as Review, ...reviews];
      setReviews(updatedReviews);
      const newAvg = updatedReviews.reduce((sum, r) => sum + r.rating, 0) / updatedReviews.length;
      const roundedAvg = Number(newAvg.toFixed(1));

      // Update product rating in NodeStack backend
      try {
        await client.collection('products').update(product.id, {
          rating: roundedAvg,
        });
      } catch {}

      if (onReviewSubmitted) {
        onReviewSubmitted(product.id, roundedAvg, updatedReviews.length);
      }

      setNewTitle('');
      setNewContent('');
      setReviewSuccessMsg('Thank you! Your review has been published.');
      setTimeout(() => setReviewSuccessMsg(''), 4000);
    } catch (err: any) {
      alert(`Failed to submit review: ${err.message}`);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      
      {/* Click outside backdrop */}
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl z-10 border border-slate-100 flex flex-col">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Top Product Hero */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 sm:p-8 border-b border-slate-100">
          
          {/* Image */}
          <div className="relative aspect-square rounded-2xl bg-slate-50 border border-slate-100 p-8 flex items-center justify-center">
            <img
              src={imageUrl}
              alt={product.name}
              className="max-h-full max-w-full object-contain drop-shadow-md"
            />
            {product.expand?.category && (
              <span className="absolute top-3 left-3 px-3 py-1 text-xs font-bold uppercase tracking-wider bg-white rounded-md shadow-xs text-slate-700">
                {product.expand.category.name}
              </span>
            )}
          </div>

          {/* Details & Actions */}
          <div className="flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              {reviews.length > 0 ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center text-amber-400">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className={`w-4 h-4 ${
                          i < Math.floor(computedRating)
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-sm font-bold text-slate-800">
                    {computedRating.toFixed(1)}
                  </span>
                  <span className="text-xs text-slate-400">
                    ({reviews.length} {reviews.length === 1 ? 'review' : 'reviews'})
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex items-center text-slate-300">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="w-4 h-4 text-slate-200" />
                    ))}
                  </div>
                  <span className="text-xs font-semibold text-slate-500">
                    No reviews yet • <span className="text-brand-600 font-bold">Be the first to review!</span>
                  </span>
                </div>
              )}

              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {product.name}
              </h2>

              <p className="text-sm text-slate-600 leading-relaxed">
                {product.description}
              </p>

              <div className="flex items-center gap-3 pt-2">
                <span className="text-3xl font-extrabold text-slate-900">
                  ${product.price.toFixed(2)}
                </span>
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase ${
                    product.stock > 0
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-rose-50 text-rose-700'
                  }`}
                >
                  {product.stock > 0 ? `In Stock (${product.stock})` : 'Out of Stock'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3 pt-4 border-t border-slate-100">
              <div className="flex items-center gap-3">
                {/* Quantity */}
                <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="px-3 py-2 text-slate-600 hover:bg-slate-200 font-bold transition-colors"
                  >
                    -
                  </button>
                  <span className="px-3 py-2 text-sm font-bold text-slate-800">
                    {quantity}
                  </span>
                  <button
                    onClick={() => setQuantity((q) => Math.min(product.stock, q + 1))}
                    className="px-3 py-2 text-slate-600 hover:bg-slate-200 font-bold transition-colors"
                  >
                    +
                  </button>
                </div>

                {/* Add to Cart */}
                <button
                  onClick={() => {
                    addToCart(product, quantity);
                    onClose();
                  }}
                  disabled={product.stock <= 0}
                  className="flex-1 py-3 px-6 rounded-xl bg-brand-600 hover:bg-brand-700 active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-brand-500/20 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  <ShoppingBag className="w-4 h-4" />
                  Add {quantity > 1 ? `(${quantity})` : ''} to Cart • ${(product.price * quantity).toFixed(2)}
                </button>

                {/* Favorite */}
                <button
                  onClick={() => toggleFavorite(product)}
                  className={`p-3 rounded-xl border transition-all ${
                    isFav
                      ? 'bg-rose-50 border-rose-200 text-rose-600'
                      : 'border-slate-200 text-slate-400 hover:text-rose-500 hover:bg-slate-50'
                  }`}
                  title={isFav ? 'Remove favorite' : 'Add to favorites'}
                >
                  <Heart className={`w-5 h-5 ${isFav ? 'fill-rose-500 text-rose-500' : ''}`} />
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* Customer Reviews Section */}
        <div className="p-6 sm:p-8 bg-slate-50/50 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-brand-600" />
              <h3 className="font-extrabold text-lg text-slate-900">
                Customer Reviews ({reviews.length})
              </h3>
            </div>
          </div>

          {/* Write a Review Box */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            {isAuthenticated ? (
              <form onSubmit={handleSubmitReview} className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    Leave a Review
                  </span>

                  {hasPurchased && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Verified Buyer
                    </span>
                  )}

                  {/* Rating Selector */}
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        type="button"
                        key={star}
                        onClick={() => setNewRating(star)}
                        className="p-0.5 focus:outline-none"
                      >
                        <Star
                          className={`w-5 h-5 transition-colors ${
                            star <= newRating
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-slate-200 hover:text-amber-300'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  type="text"
                  placeholder="Review Title (e.g. Incredible clarity and build)"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 outline-none"
                />

                <textarea
                  rows={3}
                  placeholder="Share details of your experience with this item..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 outline-none resize-none"
                  required
                />

                {reviewSuccessMsg && (
                  <p className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> {reviewSuccessMsg}
                  </p>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmittingReview || !newContent.trim()}
                    className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-2 transition-all disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {isSubmittingReview ? 'Submitting...' : 'Post Review'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="py-4 text-center space-y-2">
                <p className="text-sm text-slate-600">
                  Have you tried this product? Sign in to submit your review.
                </p>
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="px-4 py-1.5 text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-full transition-colors"
                >
                  Sign In to Write a Review
                </button>
              </div>
            )}
          </div>

          {/* Reviews List */}
          {isLoadingReviews ? (
            <div className="py-8 text-center text-slate-400 text-sm">
              Loading customer reviews...
            </div>
          ) : reviews.length === 0 ? (
            <div className="py-6 text-center text-slate-400 text-sm">
              No reviews yet. Be the first to review this product!
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map((rev) => (
                <div
                  key={rev.id}
                  className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900">
                        {rev.author}
                      </span>
                      {Boolean(rev.verifiedPurchase) && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          <ShieldCheck className="w-3 h-3 text-emerald-600" /> Verified Buyer
                        </span>
                      )}
                    </div>

                    <div className="flex items-center text-amber-400">
                      {[...Array(5)].map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3.5 h-3.5 ${
                            i < rev.rating
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-slate-200'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {rev.title && (
                    <h4 className="font-bold text-xs text-slate-800">
                      {rev.title}
                    </h4>
                  )}

                  <p className="text-xs text-slate-600 leading-relaxed">
                    {rev.content}
                  </p>
                </div>
              ))}
            </div>
          )}

        </div>

      </div>
    </div>
  );
};
