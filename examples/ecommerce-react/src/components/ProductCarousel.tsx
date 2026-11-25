import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashSaleState, Product } from '../lib/types';
import { getProductImageUrl } from '../lib/nodestack';
import { getProductDiscount } from '../lib/filters';
import { getEffectiveStock, parseProductVariants, parseVariantOptions } from '../lib/variants';
import { useCart } from '../context/CartContext';
import { useFavorites } from '../context/FavoritesContext';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
  Check,
  Sliders,
} from 'lucide-react';

export type CarouselTab = 'recent' | 'also_bought';

interface ProductCarouselProps {
  recentlyViewedProducts: Product[];
  alsoBoughtProducts: Product[];
  flashSale?: FlashSaleState;
  onOpenDetails: (product: Product) => void;
  onClearRecentlyViewed: () => void;
}

function getOrderedSlides(track: HTMLElement): { el: HTMLElement; domIndex: number }[] {
  return Array.from(track.children)
    .map((child, domIndex) => ({
      el: child as HTMLElement,
      domIndex,
      order: Number.parseInt(window.getComputedStyle(child).order || '0', 10) || 0,
    }))
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.domIndex - b.domIndex))
    .map(({ el, domIndex }) => ({ el, domIndex }));
}

function getNearestSlideDomIndex(track: HTMLElement): number {
  const slides = Array.from(track.children) as HTMLElement[];
  if (slides.length === 0) return 0;
  const trackLeft = track.getBoundingClientRect().left;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < slides.length; i++) {
    const dist = Math.abs(slides[i].getBoundingClientRect().left - trackLeft);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export const ProductCarousel: React.FC<ProductCarouselProps> = ({
  recentlyViewedProducts,
  alsoBoughtProducts,
  flashSale,
  onOpenDetails,
  onClearRecentlyViewed,
}) => {
  const { addToCart, items } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [activeTab, setActiveTab] = useState<CarouselTab>(() =>
    recentlyViewedProducts.length > 0 ? 'recent' : 'also_bought'
  );
  const userSelectedTabRef = useRef(false);

  // Auto-switch to Recently Viewed the first time an item is viewed if user hasn't manually toggled
  useEffect(() => {
    if (!userSelectedTabRef.current) {
      setActiveTab(recentlyViewedProducts.length > 0 ? 'recent' : 'also_bought');
    } else if (activeTab === 'recent' && recentlyViewedProducts.length === 0 && alsoBoughtProducts.length > 0) {
      setActiveTab('also_bought');
      userSelectedTabRef.current = false;
    }
  }, [recentlyViewedProducts.length, alsoBoughtProducts.length, activeTab]);

  const activeProducts = useMemo(
    () => (activeTab === 'recent' && recentlyViewedProducts.length > 0 ? recentlyViewedProducts : alsoBoughtProducts),
    [activeTab, recentlyViewedProducts, alsoBoughtProducts]
  );

  const isLooping = activeProducts.length >= 3;

  const trackRef = useRef<HTMLDivElement>(null);
  const prevBtnRef = useRef<HTMLButtonElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);

  const [activeIndex, setActiveIndex] = useState(0);
  const [statusAnnouncement, setStatusAnnouncement] = useState('');
  const [canScrollPrev, setCanScrollPrev] = useState(isLooping);
  const [canScrollNext, setCanScrollNext] = useState(activeProducts.length > 1);

  const pendingTargetRef = useRef<number | null>(null);
  const scrollOriginLeftRef = useRef<number>(0);
  const lastSettledIndexRef = useRef<number | null>(null);
  const queuedNavRef = useRef<'previous' | 'next' | null>(null);
  const overflowRestoreRafRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  const applyCompensatedVar = useCallback(
    (track: HTMLElement, currentVal: string, anchorDomIndex: number, lockOverflow: boolean) => {
      const slides = Array.from(track.children) as HTMLElement[];
      const anchorSlide = slides[anchorDomIndex];
      if (!anchorSlide) return;

      const beforeLeft = anchorSlide.getBoundingClientRect().left;
      const prevSnap = track.style.scrollSnapType;
      track.style.scrollSnapType = 'none';

      if (lockOverflow) {
        if (overflowRestoreRafRef.current !== null) {
          cancelAnimationFrame(overflowRestoreRafRef.current);
          overflowRestoreRafRef.current = null;
        }
        track.style.overflowX = 'hidden';
      }

      track.style.setProperty('--current', currentVal);

      const afterLeft = anchorSlide.getBoundingClientRect().left;
      const delta = afterLeft - beforeLeft;
      if (Math.abs(delta) > 0.5) {
        track.scrollBy({ left: delta, behavior: 'instant' as ScrollBehavior });
      }

      track.style.scrollSnapType = prevSnap;

      if (lockOverflow) {
        overflowRestoreRafRef.current = requestAnimationFrame(() => {
          overflowRestoreRafRef.current = requestAnimationFrame(() => {
            track.style.overflowX = '';
            overflowRestoreRafRef.current = null;
          });
        });
      }
    },
    []
  );

  const updateFiniteButtonStates = useCallback(
    (settledIndex: number) => {
      if (isLooping) {
        setCanScrollPrev(true);
        setCanScrollNext(true);
        return;
      }
      const nextCanPrev = settledIndex > 0;
      const nextCanNext = settledIndex < activeProducts.length - 1;

      if (!nextCanPrev && document.activeElement === prevBtnRef.current && nextCanNext) {
        nextBtnRef.current?.focus();
      } else if (!nextCanNext && document.activeElement === nextBtnRef.current && nextCanPrev) {
        prevBtnRef.current?.focus();
      }

      setCanScrollPrev(nextCanPrev);
      setCanScrollNext(nextCanNext);
    },
    [isLooping, activeProducts.length]
  );

  // Initialize / reset track when tab or slide count changes
  useEffect(() => {
    const track = trackRef.current;
    if (!track || activeProducts.length === 0) return;

    pendingTargetRef.current = null;
    queuedNavRef.current = null;
    lastSettledIndexRef.current = 0;
    setActiveIndex(0);
    setStatusAnnouncement('');
    track.scrollTo({ left: 0, behavior: 'instant' as ScrollBehavior });

    if (!CSS.supports('order: sibling-count()')) {
      track.style.setProperty('--children-count', String(activeProducts.length));
    } else {
      track.style.removeProperty('--children-count');
    }

    if (isLooping) {
      applyCompensatedVar(track, '0', 0, false);
    } else {
      track.style.removeProperty('--current');
    }

    updateFiniteButtonStates(0);

    return () => {
      if (overflowRestoreRafRef.current !== null) {
        cancelAnimationFrame(overflowRestoreRafRef.current);
        overflowRestoreRafRef.current = null;
      }
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [activeTab, activeProducts.length, isLooping, applyCompensatedVar, updateFiniteButtonStates]);

  const scrollToDomIndex = useCallback(
    (domIndex: number, { resetLoopingOrder = false }: { resetLoopingOrder?: boolean } = {}) => {
      const track = trackRef.current;
      if (!track) return;
      const slides = Array.from(track.children) as HTMLElement[];
      const targetSlide = slides[domIndex];
      if (!targetSlide) return;

      if (resetLoopingOrder && isLooping) {
        const currentNearest = getNearestSlideDomIndex(track);
        applyCompensatedVar(track, 'initial', currentNearest, false);
      }

      pendingTargetRef.current = domIndex;
      scrollOriginLeftRef.current = track.scrollLeft;
      setActiveIndex(domIndex);

      const trackLeft = track.getBoundingClientRect().left;
      const targetLeft = targetSlide.getBoundingClientRect().left;
      track.scrollBy({ left: targetLeft - trackLeft });
    },
    [isLooping, applyCompensatedVar]
  );

  const handleNavClick = useCallback(
    (direction: 'previous' | 'next') => {
      const track = trackRef.current;
      if (!track || activeProducts.length <= 1) return;

      if (isLooping && track.style.getPropertyValue('--current') === 'initial') {
        queuedNavRef.current = direction;
        return;
      }

      const currentDomIdx = pendingTargetRef.current ?? getNearestSlideDomIndex(track);
      const ordered = getOrderedSlides(track);
      const visualPos = ordered.findIndex((item) => item.domIndex === currentDomIdx);
      if (visualPos === -1) return;

      const step = direction === 'next' ? 1 : -1;
      let nextVisualPos = visualPos + step;

      if (isLooping) {
        nextVisualPos = (nextVisualPos + ordered.length) % ordered.length;
      } else {
        if (nextVisualPos < 0 || nextVisualPos >= ordered.length) return;
      }

      scrollToDomIndex(ordered[nextVisualPos].domIndex);
    },
    [activeProducts.length, isLooping, scrollToDomIndex]
  );

  // Settle & live scroll tracking
  useEffect(() => {
    const track = trackRef.current;
    if (!track || activeProducts.length === 0) return;

    let debounceTimer: number | null = null;
    const supportsScrollEnd = 'onscrollend' in window;

    const handleSettled = () => {
      if (
        pendingTargetRef.current !== null &&
        Math.abs(track.scrollLeft - scrollOriginLeftRef.current) < 1
      ) {
        return;
      }

      const settledIdx = pendingTargetRef.current ?? getNearestSlideDomIndex(track);
      pendingTargetRef.current = null;
      setActiveIndex(settledIdx);

      const hasQueuedNav = queuedNavRef.current !== null;
      if (isLooping) {
        const currentVar = track.style.getPropertyValue('--current');
        if (currentVar !== String(settledIdx)) {
          applyCompensatedVar(track, String(settledIdx), settledIdx, !hasQueuedNav);
        }
      }

      updateFiniteButtonStates(settledIdx);

      if (lastSettledIndexRef.current !== null && settledIdx !== lastSettledIndexRef.current) {
        setStatusAnnouncement(`Slide ${settledIdx + 1} of ${activeProducts.length}`);
      }
      lastSettledIndexRef.current = settledIdx;

      if (queuedNavRef.current) {
        const queued = queuedNavRef.current;
        queuedNavRef.current = null;
        requestAnimationFrame(() => handleNavClick(queued));
      }
    };

    const handleScroll = () => {
      if (pendingTargetRef.current === null && scrollRafRef.current === null) {
        scrollRafRef.current = requestAnimationFrame(() => {
          scrollRafRef.current = null;
          if (pendingTargetRef.current !== null) return;
          const nearest = getNearestSlideDomIndex(track);
          setActiveIndex((prev) => (prev !== nearest ? nearest : prev));
        });
      }

      if (!supportsScrollEnd) {
        if (debounceTimer !== null) window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(handleSettled, 120);
      }
    };

    track.addEventListener('scroll', handleScroll, { passive: true });
    if (supportsScrollEnd) {
      track.addEventListener('scrollend', handleSettled);
    }

    return () => {
      track.removeEventListener('scroll', handleScroll);
      if (supportsScrollEnd) {
        track.removeEventListener('scrollend', handleSettled);
      }
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
      }
    };
  }, [
    activeProducts.length,
    isLooping,
    applyCompensatedVar,
    updateFiniteButtonStates,
    handleNavClick,
  ]);

  if (recentlyViewedProducts.length === 0 && alsoBoughtProducts.length === 0) {
    return null;
  }

  const sectionLabel =
    activeTab === 'recent' && recentlyViewedProducts.length > 0
      ? 'Recently Viewed Products'
      : 'Customers Also Bought';

  return (
    <section
      className="mt-12 pt-10 border-t border-slate-200/80"
      aria-roledescription="carousel"
      aria-label={sectionLabel}
    >
      {/* Header & Controls (placed before the track in DOM order) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200/80"
            role="tablist"
            aria-label="Recommendation carousel views"
          >
            {recentlyViewedProducts.length > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'recent'}
                onClick={() => {
                  userSelectedTabRef.current = true;
                  setActiveTab('recent');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'recent'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-brand-600" aria-hidden="true" />
                <span>Recently Viewed</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-brand-50 text-brand-700 font-extrabold">
                  {recentlyViewedProducts.length}
                </span>
              </button>
            )}

            {alsoBoughtProducts.length > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'also_bought'}
                onClick={() => {
                  userSelectedTabRef.current = true;
                  setActiveTab('also_bought');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'also_bought'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                <span>Customers Also Bought</span>
              </button>
            )}
          </div>

          {activeTab === 'recent' && recentlyViewedProducts.length > 0 && (
            <button
              type="button"
              onClick={onClearRecentlyViewed}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-rose-600 transition-colors px-2 py-1 rounded-lg hover:bg-rose-50"
              title="Clear recently viewed history"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Clear</span>
            </button>
          )}
        </div>

        {/* Previous / Next Buttons (before track in DOM order) */}
        {activeProducts.length > 1 && (
          <div className="carousel-controls flex items-center gap-2 self-end sm:self-auto">
            <button
              ref={prevBtnRef}
              type="button"
              data-direction="previous"
              aria-label="Previous slide"
              disabled={!canScrollPrev}
              onClick={() => handleNavClick('previous')}
              className="carousel-nav-btn w-9 h-9 rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center shadow-xs transition-colors"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              ref={nextBtnRef}
              type="button"
              data-direction="next"
              aria-label="Next slide"
              disabled={!canScrollNext}
              onClick={() => handleNavClick('next')}
              className="carousel-nav-btn w-9 h-9 rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center shadow-xs transition-colors"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Scrollable Track */}
      <div
        ref={trackRef}
        className="product-carousel-track"
        tabIndex={0}
        role="group"
        aria-label="Slides"
        data-looping={isLooping ? 'true' : 'false'}
      >
        {activeProducts.map((product, index) => {
          const imageUrl = getProductImageUrl(product);
          const totalStock = getEffectiveStock(product);
          const isOutOfStock = product.status === 'out_of_stock' || totalStock <= 0;
          const discount = getProductDiscount(product, flashSale);
          const optionGroups = parseVariantOptions(product);
          const variants = parseProductVariants(product);
          const hasVariants = variants.length > 0 && optionGroups.length > 0;
          const isFav = isFavorite(product.id);
          const inCart = items.some((i) => i.product.id === product.id);

          return (
            <article
              key={product.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} of ${activeProducts.length}`}
              data-marker-name={`Go to slide ${index + 1}: ${product.name}`}
              className="product-carousel-slide group relative bg-white rounded-2xl border border-slate-200/80 hover:border-slate-300 hover:shadow-lg transition-all duration-300 flex flex-col overflow-hidden"
            >
              <div
                className="relative aspect-[4/3] w-full bg-slate-100 overflow-hidden cursor-pointer flex items-center justify-center p-5"
                onClick={() => onOpenDetails(product)}
              >
                <img
                  src={imageUrl}
                  alt={product.name}
                  className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(product);
                  }}
                  aria-label={isFav ? `Remove ${product.name} from favorites` : `Add ${product.name} to favorites`}
                  className={`absolute top-2.5 right-2.5 p-2 rounded-full backdrop-blur-md transition-all shadow-sm ${
                    isFav
                      ? 'bg-rose-50 text-rose-600'
                      : 'bg-white/85 text-slate-500 hover:text-rose-500 hover:bg-white'
                  }`}
                >
                  <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-rose-500 text-rose-500' : ''}`} />
                </button>

                {discount.isDiscounted && (
                  <span className="absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-600 text-white shadow-xs">
                    -{discount.discountPercent}% OFF
                  </span>
                )}

                {isOutOfStock && (
                  <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-[1px] flex items-center justify-center">
                    <span className="bg-slate-900 text-white text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
                      Out of Stock
                    </span>
                  </div>
                )}
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="truncate font-semibold uppercase tracking-wide text-slate-400">
                      {product.expand?.category?.name || 'Catalog'}
                    </span>
                    {product.reviewCount && product.reviewCount > 0 ? (
                      <span className="inline-flex items-center gap-1 shrink-0 font-bold text-slate-700">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                        {(product.rating ?? 5).toFixed(1)}
                      </span>
                    ) : null}
                  </div>

                  <h3 className="font-bold text-slate-900 text-sm line-clamp-1">
                    <button
                      type="button"
                      onClick={() => onOpenDetails(product)}
                      className="text-left hover:text-brand-600 transition-colors focus-visible:outline-none focus-visible:underline"
                    >
                      {product.name}
                    </button>
                  </h3>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-base font-extrabold text-slate-900">
                      ${product.price.toFixed(2)}
                    </span>
                    {discount.isDiscounted && discount.originalPrice !== null && (
                      <span className="text-xs text-slate-400 line-through">
                        ${discount.originalPrice.toFixed(2)}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={isOutOfStock}
                    onClick={() => {
                      if (hasVariants) {
                        onOpenDetails(product);
                      } else {
                        addToCart(product, 1);
                      }
                    }}
                    aria-label={
                      hasVariants
                        ? `Choose options for ${product.name}`
                        : `Add ${product.name} to cart`
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                      isOutOfStock
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : inCart
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                          : 'bg-slate-900 text-white hover:bg-brand-600'
                    }`}
                  >
                    {hasVariants ? (
                      <>
                        <Sliders className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Options</span>
                      </>
                    ) : inCart ? (
                      <>
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Added</span>
                      </>
                    ) : (
                      <>
                        <ShoppingBag className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Add</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Visually hidden polite status region */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {statusAnnouncement}
      </p>

      {/* Marker Dots */}
      {activeProducts.length > 1 && (
        <nav className="carousel-markers flex items-center justify-center gap-1.5 mt-3" aria-label="Choose a slide">
          {activeProducts.map((product, index) => {
            const isCurrent = activeIndex === index;
            return (
              <button
                key={product.id}
                type="button"
                className="carousel-marker-btn"
                aria-label={`Go to slide ${index + 1}: ${product.name}`}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => scrollToDomIndex(index, { resetLoopingOrder: true })}
              >
                <span className="carousel-marker-dot" aria-hidden="true" />
              </button>
            );
          })}
        </nav>
      )}
    </section>
  );
};
