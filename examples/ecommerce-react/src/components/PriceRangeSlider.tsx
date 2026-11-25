import React, { useEffect, useId, useRef, useState } from 'react';
import {
  PRICE_SLIDER_MAX,
  PRICE_SLIDER_MIN,
  clampPriceRange,
} from '../lib/filters';

interface PriceRangeSliderProps {
  min?: number;
  max?: number;
  step?: number;
  value: [number, number];
  onChange: (next: [number, number]) => void;
}

const PRICE_PRESETS: Array<{ label: string; range: [number, number] }> = [
  { label: 'Under $75', range: [10, 75] },
  { label: '$75 – $200', range: [75, 200] },
  { label: '$200+', range: [200, 500] },
];

export const PriceRangeSlider: React.FC<PriceRangeSliderProps> = ({
  min = PRICE_SLIDER_MIN,
  max = PRICE_SLIDER_MAX,
  step = 1,
  value,
  onChange,
}) => {
  const minSliderId = useId();
  const maxSliderId = useId();
  const minInputId = useId();
  const maxInputId = useId();

  const minRef = useRef<HTMLInputElement>(null);
  const maxRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const [activeThumb, setActiveThumb] = useState<'min' | 'max'>('max');
  const [minVal, maxVal] = clampPriceRange(value, [min, max]);

  const span = Math.max(1, max - min);
  const minPct = ((minVal - min) / span) * 100;
  const maxPct = ((maxVal - min) / span) * 100;

  // Keep CSS custom properties synced on range inputs for cross-browser parity
  useEffect(() => {
    if (minRef.current) {
      minRef.current.style.setProperty('--attr-min', String(min));
      minRef.current.style.setProperty('--attr-max', String(max));
      minRef.current.style.setProperty('--control-value', String(minVal));
    }
    if (maxRef.current) {
      maxRef.current.style.setProperty('--attr-min', String(min));
      maxRef.current.style.setProperty('--attr-max', String(max));
      maxRef.current.style.setProperty('--control-value', String(maxVal));
    }
  }, [min, max, minVal, maxVal]);

  const handleMinSliderChange = (rawValue: number) => {
    setActiveThumb('min');
    const nextMin = Math.min(rawValue, maxVal);
    onChange(clampPriceRange([nextMin, maxVal], [min, max]));
  };

  const handleMaxSliderChange = (rawValue: number) => {
    setActiveThumb('max');
    const nextMax = Math.max(rawValue, minVal);
    onChange(clampPriceRange([minVal, nextMax], [min, max]));
  };

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const clickedVal = Math.round((min + ratio * span) / step) * step;
    const distToMin = Math.abs(clickedVal - minVal);
    const distToMax = Math.abs(clickedVal - maxVal);

    if (distToMin < distToMax || (distToMin === distToMax && clickedVal < minVal)) {
      handleMinSliderChange(clickedVal);
    } else {
      handleMaxSliderChange(clickedVal);
    }
  };

  const handleNumericInputChange = (bound: 'min' | 'max', raw: string) => {
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return;
    if (bound === 'min') {
      const clamped = Math.min(maxVal, Math.max(min, Math.round(parsed)));
      onChange([clamped, maxVal]);
    } else {
      const clamped = Math.max(minVal, Math.min(max, Math.round(parsed)));
      onChange([minVal, clamped]);
    }
  };

  // Prioritize min thumb above max thumb when both are near the upper end so it can always be dragged left
  const minZIndex = activeThumb === 'min' || minVal > min + span * 0.7 ? 4 : 2;
  const maxZIndex = activeThumb === 'max' && minVal <= min + span * 0.7 ? 4 : 3;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
          Price Range
        </span>
        <span className="text-xs font-bold text-brand-700 bg-brand-50 border border-brand-200/80 px-2.5 py-0.5 rounded-full tabular-nums">
          ${minVal} – ${maxVal}
        </span>
      </div>

      {/* Dual-Thumb Native Range Slider */}
      <div
        className="price-range-slider"
        style={
          {
            '--range-start': `${minPct}%`,
            '--range-end': `${maxPct}%`,
          } as React.CSSProperties
        }
      >
        <div
          ref={trackRef}
          onPointerDown={handleTrackPointerDown}
          className="price-range-track"
        >
          <div className="price-range-fill" />
        </div>

        <label htmlFor={minSliderId} className="visually-hidden">
          Minimum price
        </label>
        <input
          ref={minRef}
          id={minSliderId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={minVal}
          aria-valuetext={`$${minVal}`}
          onPointerDown={() => setActiveThumb('min')}
          onChange={(e) => handleMinSliderChange(Number(e.target.value))}
          style={{ zIndex: minZIndex }}
          className="price-range-input"
        />

        <label htmlFor={maxSliderId} className="visually-hidden">
          Maximum price
        </label>
        <input
          ref={maxRef}
          id={maxSliderId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={maxVal}
          aria-valuetext={`$${maxVal}`}
          onPointerDown={() => setActiveThumb('max')}
          onChange={(e) => handleMaxSliderChange(Number(e.target.value))}
          style={{ zIndex: maxZIndex }}
          className="price-range-input"
        />
      </div>

      {/* Min / Max Numeric Inputs */}
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label
            htmlFor={minInputId}
            className="block text-[11px] font-semibold text-slate-500 mb-1"
          >
            Min ($)
          </label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
              $
            </span>
            <input
              id={minInputId}
              type="number"
              min={min}
              max={maxVal}
              step={step}
              value={minVal}
              onChange={(e) => handleNumericInputChange('min', e.target.value)}
              className="w-full pl-6 pr-2 py-1.5 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none tabular-nums"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor={maxInputId}
            className="block text-[11px] font-semibold text-slate-500 mb-1"
          >
            Max ($)
          </label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
              $
            </span>
            <input
              id={maxInputId}
              type="number"
              min={minVal}
              max={max}
              step={step}
              value={maxVal}
              onChange={(e) => handleNumericInputChange('max', e.target.value)}
              className="w-full pl-6 pr-2 py-1.5 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* Quick Price Presets */}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {PRICE_PRESETS.map((preset) => {
          const isSelected = minVal === preset.range[0] && maxVal === preset.range[1];
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() =>
                onChange(isSelected ? [min, max] : preset.range)
              }
              aria-pressed={isSelected}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                isSelected
                  ? 'bg-brand-600 text-white border-brand-600 shadow-xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
