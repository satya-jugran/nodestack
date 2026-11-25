import React from 'react';
import { Category } from '../lib/types';
import { SlidersHorizontal, Filter } from 'lucide-react';

interface CategoryFilterProps {
  categories: Category[];
  selectedCategory: string | null;
  onSelectCategory: (id: string | null) => void;
  categoryCounts?: Record<string, number>;
  totalProductCount?: number;
  sortBy: string;
  onSortChange: (sort: string) => void;
  activeFilterCount: number;
  isMobileFiltersOpen: boolean;
  onToggleMobileFilters: () => void;
}

export const CategoryFilter: React.FC<CategoryFilterProps> = ({
  categories,
  selectedCategory,
  onSelectCategory,
  categoryCounts,
  totalProductCount,
  sortBy,
  onSortChange,
  activeFilterCount,
  isMobileFiltersOpen,
  onToggleMobileFilters,
}) => {
  return (
    <div className="mb-6 space-y-4">
      {/* Category Pills Bar & Sort */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none max-w-full">
          <button
            type="button"
            onClick={() => onSelectCategory(null)}
            aria-pressed={selectedCategory === null}
            className={`px-4 py-2 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-all shadow-sm inline-flex items-center gap-1.5 ${
              selectedCategory === null
                ? 'bg-slate-900 text-white shadow-slate-900/10'
                : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
            }`}
          >
            <span>All Products</span>
            {typeof totalProductCount === 'number' && (
              <span
                className={`text-[11px] px-1.5 py-0.5 rounded-full tabular-nums ${
                  selectedCategory === null
                    ? 'bg-white/15 text-white'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {totalProductCount}
              </span>
            )}
          </button>

          {categories.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            const catCount = categoryCounts?.[cat.id];
            return (
              <button
                type="button"
                key={cat.id}
                onClick={() => onSelectCategory(cat.id)}
                aria-pressed={isSelected}
                className={`px-4 py-2 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-all shadow-sm inline-flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-slate-900 text-white shadow-slate-900/10'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                }`}
              >
                <span>{cat.name}</span>
                {typeof catCount === 'number' && (
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-full tabular-nums ${
                      isSelected
                        ? 'bg-white/15 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {catCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right side: Mobile Filters toggle + Sort Dropdown */}
        <div className="flex items-center gap-2.5 ml-auto">
          <button
            type="button"
            onClick={onToggleMobileFilters}
            aria-expanded={isMobileFiltersOpen}
            className={`lg:hidden inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-xs font-bold shadow-sm transition-colors ${
              isMobileFiltersOpen || activeFilterCount > 0
                ? 'bg-brand-50 text-brand-700 border-brand-200'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-brand-600 text-white text-[10px] leading-none tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-1.5 bg-white px-3 py-2 rounded-full border border-slate-200 shadow-sm text-xs font-semibold text-slate-700">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            <label htmlFor="catalog-sort-select" className="visually-hidden">
              Sort products
            </label>
            <select
              id="catalog-sort-select"
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              className="bg-transparent text-slate-700 focus:outline-none cursor-pointer pr-1"
            >
              <option value="-created">Featured & Newest</option>
              <option value="price">Price: Low to High</option>
              <option value="-price">Price: High to Low</option>
              <option value="-rating">Highest Rated</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
