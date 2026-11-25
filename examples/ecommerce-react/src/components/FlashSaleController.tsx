import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Product, FlashSaleState, SimulatedOrderEvent } from '../lib/types';
import { client } from '../lib/nodestack';
import { getEffectiveStock, getTotalVariantStock, parseProductVariants } from '../lib/variants';
import { useToast } from '../context/ToastContext';
import { Zap, Flame, StopCircle, RefreshCw, Clock, Sparkles, TrendingDown } from 'lucide-react';

interface FlashSaleControllerProps {
  products: Product[];
  flashSale: FlashSaleState;
  setFlashSale: React.Dispatch<React.SetStateAction<FlashSaleState>>;
  isRushActive: boolean;
  setIsRushActive: React.Dispatch<React.SetStateAction<boolean>>;
  onSimulatedOrder: (event: SimulatedOrderEvent) => void;
}

const CUSTOMER_NAMES = [
  'Marcus V.',
  'Sarah Jenkins',
  'Alex Chen',
  'Elena R.',
  'David Kim',
  'Jessica Taylor',
  'Liam Patel',
  'Zoe Martinez',
];

export const FlashSaleController: React.FC<FlashSaleControllerProps> = ({
  products,
  flashSale,
  setFlashSale,
  isRushActive,
  setIsRushActive,
  onSimulatedOrder,
}) => {
  const { toast } = useToast();
  const [isApplyingSale, setIsApplyingSale] = useState(false);
  const [isRevertingSale, setIsRevertingSale] = useState(false);
  const rushIntervalRef = useRef<number | null>(null);

  // Keep flashSale ref up to date to prevent stale closures in timers
  const flashSaleRef = useRef(flashSale);
  useEffect(() => {
    flashSaleRef.current = flashSale;
  }, [flashSale]);

  // 1. Flash Sale: Apply 25% site-wide price drop with rollback on partial failure
  const handleTriggerFlashSale = async () => {
    if (products.length === 0) return;
    setIsApplyingSale(true);

    const updatedOriginalPrices: Record<string, number> = {};
    const successfulUpdates: Array<{ id: string; originalPrice: number }> = [];

    try {
      // Update each product with a 25% discount
      for (const p of products) {
        const originalPrice = p.price;
        const discountedPrice = Number((originalPrice * 0.75).toFixed(2));
        
        await client.collection('products').update(p.id, {
          price: discountedPrice,
        });

        successfulUpdates.push({ id: p.id, originalPrice });
        updatedOriginalPrices[p.id] = originalPrice;
      }

      setFlashSale({
        isActive: true,
        discountPercent: 25,
        endsAt: Date.now() + 5 * 60 * 1000, // 5 minutes
        originalPrices: updatedOriginalPrices,
      });
      toast.success('Flash Sale Active', '25% site-wide discount applied across catalog.');
    } catch (err: any) {
      console.error('Failed to trigger flash sale, rolling back modified items:', err);

      // Roll back all items that were successfully modified before failure occurred
      const rollbackErrors: string[] = [];
      for (const { id, originalPrice } of successfulUpdates) {
        try {
          await client.collection('products').update(id, {
            price: originalPrice,
          });
        } catch (rollbackErr: any) {
          console.error(`Failed to rollback product ${id}:`, rollbackErr);
          rollbackErrors.push(id);
        }
      }

      // If any items failed to roll back, preserve original prices so they can still be reverted
      if (rollbackErrors.length > 0) {
        const retainedOriginals: Record<string, number> = {};
        for (const id of rollbackErrors) {
          if (updatedOriginalPrices[id] !== undefined) {
            retainedOriginals[id] = updatedOriginalPrices[id];
          }
        }
        setFlashSale({
          isActive: true,
          discountPercent: 25,
          originalPrices: retainedOriginals,
        });
      }

      toast.error(
        'Failed to apply flash sale',
        `${err?.message || 'Network error'}. ${
          successfulUpdates.length - rollbackErrors.length
        } items were safely rolled back.`
      );
    } finally {
      setIsApplyingSale(false);
    }
  };

  // 2. Revert Flash Sale: restore baseline prices with incremental tracking
  const handleRevertFlashSale = useCallback(async () => {
    const currentSale = flashSaleRef.current;
    if (!currentSale.originalPrices || !currentSale.isActive) {
      setFlashSale({ isActive: false, discountPercent: 0 });
      return;
    }

    setIsRevertingSale(true);
    const remainingOriginals = { ...currentSale.originalPrices };

    try {
      for (const [id, originalPrice] of Object.entries(currentSale.originalPrices)) {
        await client.collection('products').update(id, {
          price: originalPrice,
        });
        delete remainingOriginals[id];
      }

      setFlashSale({
        isActive: false,
        discountPercent: 0,
        endsAt: undefined,
        originalPrices: undefined,
      });
      toast.info('Flash Sale Ended', 'All product prices have been restored.');
    } catch (err: any) {
      console.error('Failed to revert flash sale prices:', err);
      // Retain items that still need reverting so the user can retry
      setFlashSale((prev) => ({
        ...prev,
        originalPrices: remainingOriginals,
      }));
      toast.error(
        'Failed to revert some prices',
        `${err?.message || 'Network error'}. Remaining items can be reverted by retrying.`
      );
    } finally {
      setIsRevertingSale(false);
    }
  }, [setFlashSale, toast]);

  // 3. Expiry cleanup: automatically revert prices and clear active state when countdown reaches zero
  useEffect(() => {
    if (!flashSale.isActive || !flashSale.endsAt) {
      return;
    }

    const remainingMs = flashSale.endsAt - Date.now();
    if (remainingMs <= 0) {
      handleRevertFlashSale();
      return;
    }

    const timer = setTimeout(() => {
      handleRevertFlashSale();
    }, remainingMs);

    return () => clearTimeout(timer);
  }, [flashSale.isActive, flashSale.endsAt, handleRevertFlashSale]);

  // 3. Inventory Rush Simulator Engine
  useEffect(() => {
    if (isRushActive) {
      rushIntervalRef.current = window.setInterval(async () => {
        // Pick an in-stock product randomly
        const inStockItems = products.filter((p) => getEffectiveStock(p) > 0);
        if (inStockItems.length === 0) {
          setIsRushActive(false);
          return;
        }

        const target = inStockItems[Math.floor(Math.random() * inStockItems.length)];
        const variants = parseProductVariants(target);
        const customer = CUSTOMER_NAMES[Math.floor(Math.random() * CUSTOMER_NAMES.length)];

        try {
          if (variants.length > 0) {
            const inStockVariants = variants.filter((v) => (Number(v.stock) || 0) > 0);
            if (inStockVariants.length === 0) return;
            const picked = inStockVariants[Math.floor(Math.random() * inStockVariants.length)];
            const updatedVariants = variants.map((v) =>
              v.id === picked.id ? { ...v, stock: Math.max(0, (Number(v.stock) || 0) - 1) } : v
            );
            const newTotalStock = getTotalVariantStock(updatedVariants);
            const newStatus = newTotalStock === 0 ? 'out_of_stock' : newTotalStock <= 5 ? 'low_stock' : 'in_stock';
            const updatedVariantStock = Math.max(0, (Number(picked.stock) || 0) - 1);

            await client.collection('products').update(target.id, {
              stock: newTotalStock,
              status: newStatus,
              variants: updatedVariants,
            });

            onSimulatedOrder({
              id: 'sim_' + Date.now(),
              customerName: customer,
              productName: target.name,
              productId: target.id,
              variantLabel: picked.label,
              newStock: updatedVariantStock,
              timestamp: Date.now(),
            });
          } else {
            const newStock = Math.max(0, target.stock - 1);
            const newStatus = newStock === 0 ? 'out_of_stock' : newStock <= 5 ? 'low_stock' : 'in_stock';

            await client.collection('products').update(target.id, {
              stock: newStock,
              status: newStatus,
            });

            onSimulatedOrder({
              id: 'sim_' + Date.now(),
              customerName: customer,
              productName: target.name,
              productId: target.id,
              newStock,
              timestamp: Date.now(),
            });
          }
        } catch (err) {
          console.warn('Simulation update skipped:', err);
        }
      }, 1900);
    } else {
      if (rushIntervalRef.current) {
        clearInterval(rushIntervalRef.current);
        rushIntervalRef.current = null;
      }
    }

    return () => {
      if (rushIntervalRef.current) {
        clearInterval(rushIntervalRef.current);
      }
    };
  }, [isRushActive, products, onSimulatedOrder, setIsRushActive]);

  return (
    <div className="bg-gradient-to-r from-amber-500/10 via-brand-500/10 to-rose-500/10 border border-amber-300/60 rounded-3xl p-5 shadow-xs">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        
        {/* Left info */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-amber-500 text-white font-bold text-xs flex items-center justify-center">
              <Zap className="w-4 h-4" />
            </span>
            <h3 className="text-sm font-black text-slate-900 tracking-tight">
              Flash Sale & Inventory Rush Simulation
            </h3>
          </div>
          <p className="text-xs text-slate-600 max-w-lg">
            Broadcast promotional sales across all browser windows or simulate incoming order spikes to test real-time stock decrements and "Out of Stock" triggers.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          
          {/* Site-Wide 25% Flash Sale Button */}
          {flashSale.isActive ? (
            <button
              onClick={handleRevertFlashSale}
              disabled={isRevertingSale}
              className="px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-slate-800 hover:bg-slate-900 shadow-md flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRevertingSale ? 'animate-spin' : ''}`} />
              <span>End Flash Sale (Revert Prices)</span>
            </button>
          ) : (
            <button
              onClick={handleTriggerFlashSale}
              disabled={isApplyingSale}
              className="px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-md shadow-amber-500/20 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              {isApplyingSale ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              <span>⚡ Trigger 25% Flash Sale</span>
            </button>
          )}

          {/* Rush Simulator Button */}
          {isRushActive ? (
            <button
              onClick={() => setIsRushActive(false)}
              className="px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-600/20 flex items-center gap-2 transition-all active:scale-95 animate-pulse"
            >
              <StopCircle className="w-4 h-4" />
              <span>Stop Inventory Rush</span>
            </button>
          ) : (
            <button
              onClick={() => setIsRushActive(true)}
              className="px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-r from-indigo-600 to-brand-600 hover:from-indigo-700 hover:to-brand-700 shadow-md shadow-indigo-500/20 flex items-center gap-2 transition-all active:scale-95"
            >
              <Flame className="w-4 h-4 text-amber-300" />
              <span>🔥 Simulate Inventory Rush</span>
            </button>
          )}

        </div>

      </div>
    </div>
  );
};
