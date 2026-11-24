import React, { useState, useEffect } from 'react';
import { FlashSaleState, SimulatedOrderEvent } from '../lib/types';
import { Zap, Clock, ShoppingCart, Sparkles, X } from 'lucide-react';

interface FlashSaleBannerProps {
  flashSale: FlashSaleState;
  latestSimulatedOrder?: SimulatedOrderEvent | null;
}

export const FlashSaleBanner: React.FC<FlashSaleBannerProps> = ({
  flashSale,
  latestSimulatedOrder,
}) => {
  const [timeLeft, setTimeLeft] = useState<string>('05:00');
  const [activeToast, setActiveToast] = useState<SimulatedOrderEvent | null>(null);

  // Countdown timer for active flash sale
  useEffect(() => {
    if (!flashSale.isActive || !flashSale.endsAt) return;

    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((flashSale.endsAt! - now) / 1000));
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      setTimeLeft(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [flashSale]);

  // Handle incoming simulated order toasts
  useEffect(() => {
    if (latestSimulatedOrder) {
      setActiveToast(latestSimulatedOrder);
      const timeout = setTimeout(() => {
        setActiveToast(null);
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [latestSimulatedOrder]);

  return (
    <>
      {/* Top Banner when Flash Sale is Active */}
      {flashSale.isActive && (
        <div className="bg-gradient-to-r from-amber-500 via-rose-500 to-amber-500 text-white py-2.5 px-4 shadow-sm animate-in slide-in-from-top duration-300">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 text-xs font-black uppercase tracking-wider flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-2 mx-auto sm:mx-0">
              <span className="p-1 rounded-full bg-white/20 animate-pulse">
                <Zap className="w-3.5 h-3.5 fill-white text-white" />
              </span>
              <span>
                ⚡ FLASH SALE ACTIVE: {flashSale.discountPercent}% OFF ALL ITEMS SITE-WIDE!
              </span>
            </div>

            <div className="flex items-center gap-2 bg-black/20 px-3 py-1 rounded-full text-[11px] font-mono mx-auto sm:mx-0">
              <Clock className="w-3.5 h-3.5 text-amber-200" />
              <span>Ends in: {timeLeft}</span>
            </div>
          </div>
        </div>
      )}

      {/* Floating Simulated Purchase Toast */}
      {activeToast && (
        <div className="fixed bottom-6 left-6 z-50 bg-slate-900/95 text-white backdrop-blur-md border border-slate-700/80 rounded-2xl p-3.5 shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-5 duration-200 max-w-sm">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center shrink-0">
            <ShoppingCart className="w-4 h-4 text-white" />
          </div>
          <div className="text-xs space-y-0.5 flex-1 min-w-0">
            <p className="font-bold truncate text-slate-100">
              {activeToast.customerName} just purchased!
            </p>
            <p className="text-[11px] text-slate-400 truncate">
              {activeToast.productName} • <span className="text-amber-400 font-bold">{activeToast.newStock} left</span>
            </p>
          </div>
          <button
            onClick={() => setActiveToast(null)}
            className="text-slate-400 hover:text-white p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
};
