import React, { useId } from 'react';
import {
  PRICE_SLIDER_MAX,
  PRICE_SLIDER_MIN,
  RATING_FILTER_OPTIONS,
} from '../lib/filters';
import { PriceRangeSlider } from './PriceRangeSlider';
import { SlidersHorizontal, Sparkles, Tag, PackageCheck, RotateCcw, Star } from 'lucide-react';

export interface FacetCounts {
  rating: Record<string, number>;
  featured: number;
  discounted: number;
  inStock: number;
}

interface FacetedFiltersProps {
  priceRange: [number, number];
  onPriceRangeChange: (next: [number, number]) => void;
  minRating: number | null;
  onMinRatingChange: (rating: number | null) => void;
  featuredOnly: boolean;
  onFeaturedOnlyChange: (val: boolean) => void;
  discountedOnly: boolean;
  onDiscountedOnlyChange: (val: boolean) => void;
  inStockOnly: boolean;
  onInStockOnlyChange: (val: boolean) => void;
  facetCounts: FacetCounts;
  activeFilterCount: number;
  onResetAll: () => void;
}

interface QuickToggleRowProps {
  label: string;
  description: string;
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon: React.ReactNode;
}

const supportsNativeSwitch =
  typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype;

const QuickToggleRow: React.FC<QuickToggleRowProps> = ({
  label,
  description,
  count,
  checked,
  onChange,
  icon,
}) => {
  const inputId = useId();

  return (
    <label
      htmlFor={inputId}
      className={`flex items-center justify-between gap-3 p-2.5 rounded-2xl border cursor-pointer transition-all select-none ${
        checked
          ? 'bg-brand-50/70 border-brand-200 shadow-xs'
          : 'bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/70'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
            checked
              ? 'bg-brand-600 text-white'
              : 'bg-white text-slate-500 border border-slate-200/80'
          }`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-800 truncate">{label}</span>
            <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
              ({count})
            </span>
          </div>
          <span className="block text-[11px] text-slate-500 truncate">{description}</span>
        </div>
      </div>

      {supportsNativeSwitch ? (
        <input
          id={inputId}
          type="checkbox"
          {...({ switch: '' } as Record<string, string>)}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="shrink-0"
        />
      ) : (
        <span className="relative inline-flex items-center shrink-0">
          <input
            id={inputId}
            type="checkbox"
            role="switch"
            aria-checked={checked}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="switch-fallback-input"
          />
          <span className="switch-fallback-track" aria-hidden="true">
            <span className="switch-fallback-thumb" />
          </span>
        </span>
      )}
    </label>
  );
};

export const FacetedFilters: React.FC<FacetedFiltersProps> = ({
  priceRange,
  onPriceRangeChange,
  minRating,
  onMinRatingChange,
  featuredOnly,
  onFeaturedOnlyChange,
  discountedOnly,
  onDiscountedOnlyChange,
  inStockOnly,
  onInStockOnlyChange,
  facetCounts,
  activeFilterCount,
  onResetAll,
}) => {
  const ratingGroupName = useId();

  return (
    <section
      aria-label="Faceted product filters"
      className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden flex flex-col lg:max-h-[calc(100vh-6rem)]"
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-3.5 border-b border-slate-100 shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center">
            <SlidersHorizontal className="w-4 h-4" />
          </span>
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 leading-tight">
              Faceted Filters
            </h2>
            <p className="text-[11px] text-slate-500">
              {activeFilterCount > 0
                ? `${activeFilterCount} active ${activeFilterCount === 1 ? 'filter' : 'filters'}`
                : 'Refine by price, rating & tags'}
            </p>
          </div>
        </div>

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={onResetAll}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold text-brand-700 bg-brand-50 hover:bg-brand-100 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* Independently Scrollable Filter Body */}
      <div className="filter-panel-scroll flex-1 min-h-0 px-5">
        <div className="space-y-6 py-5">
          {/* 1. Price Range Slider ($10 - $500) */}
          <PriceRangeSlider
            min={PRICE_SLIDER_MIN}
            max={PRICE_SLIDER_MAX}
            step={1}
            value={priceRange}
            onChange={onPriceRangeChange}
          />

          <hr className="border-slate-100" />

          {/* 2. Rating Filter */}
          <fieldset className="space-y-2.5">
            <legend className="text-xs font-extrabold uppercase tracking-wider text-slate-700 mb-1">
              Customer Rating
            </legend>

            <div className="space-y-1.5">
              {RATING_FILTER_OPTIONS.map((option) => {
                const key = option.value === null ? 'all' : String(option.value);
                const count = facetCounts.rating[key] ?? 0;
                const isSelected = minRating === option.value;
                const filledStars = option.value ? Math.floor(option.value) : 0;

                return (
                  <label
                    key={key}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-amber-50/80 border-amber-300 text-slate-900 font-bold shadow-xs'
                        : 'bg-white border-slate-200/80 text-slate-600 hover:bg-slate-50 font-medium'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <input
                        type="radio"
                        name={ratingGroupName}
                        checked={isSelected}
                        onChange={() => onMinRatingChange(option.value)}
                        className="accent-brand-600 w-3.5 h-3.5 cursor-pointer"
                      />
                      {option.value !== null ? (
                        <span className="flex items-center gap-1.5">
                          <span className="flex items-center text-amber-400" aria-hidden="true">
                            {[1, 2, 3, 4, 5].map((starIndex) => (
                              <Star
                                key={starIndex}
                                className={`w-3.5 h-3.5 ${
                                  starIndex <= filledStars
                                    ? 'fill-amber-400 text-amber-400'
                                    : option.value === 4.5 && starIndex === 5
                                    ? 'fill-amber-200 text-amber-400'
                                    : 'text-slate-200'
                                }`}
                              />
                            ))}
                          </span>
                          <span>{option.label}</span>
                        </span>
                      ) : (
                        <span>{option.label}</span>
                      )}
                    </span>

                    <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
                      {count}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <hr className="border-slate-100" />

          {/* 3. Quick Toggles */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
              Quick Toggles
            </h3>

            <div className="space-y-2">
              <QuickToggleRow
                label="Featured Only"
                description="Curated flagship picks"
                count={facetCounts.featured}
                checked={featuredOnly}
                onChange={onFeaturedOnlyChange}
                icon={<Sparkles className="w-4 h-4" />}
              />

              <QuickToggleRow
                label="Discounted"
                description="Markdowns & flash deals"
                count={facetCounts.discounted}
                checked={discountedOnly}
                onChange={onDiscountedOnlyChange}
                icon={<Tag className="w-4 h-4" />}
              />

              <QuickToggleRow
                label="In Stock Only"
                description="Ready to ship now"
                count={facetCounts.inStock}
                checked={inStockOnly}
                onChange={onInStockOnlyChange}
                icon={<PackageCheck className="w-4 h-4" />}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
