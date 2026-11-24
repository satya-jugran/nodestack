import React, { useState } from 'react';
import { Order } from '../lib/types';
import {
  Check,
  Package,
  PackageCheck,
  Truck,
  RotateCcw,
  Copy,
  CheckCheck,
  Radio,
  MapPin,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

interface OrderTrackingStepperProps {
  order: Order;
  onAdvanceStatus?: (orderId: string, nextStatus: 'pending' | 'processing' | 'shipped' | 'delivered') => void;
}

export type StepStatus = 'completed' | 'active' | 'upcoming';

export interface TrackingStep {
  id: 'placed' | 'stock' | 'carrier' | 'transit';
  label: string;
  sublabel: string;
  status: StepStatus;
  caption: string;
  icon: React.ReactNode;
}

export const OrderTrackingStepper: React.FC<OrderTrackingStepperProps> = ({
  order,
  onAdvanceStatus,
}) => {
  const [hasCopied, setHasCopied] = useState(false);

  const isCancelled = order.status === 'cancelled';
  const isDelivered = order.status === 'delivered';
  const isShipped = order.status === 'shipped';
  const hasTracking = Boolean(order.trackingNumber);
  const hasCarrier = Boolean(order.carrier);
  const isProcessing = order.status === 'processing';

  // Compute status for the 4 canonical steps:
  // 1. Order Placed
  // 2. Stock Reserved
  // 3. Carrier Assigned
  // 4. In Transit
  const getStepStatuses = (): [StepStatus, StepStatus, StepStatus, StepStatus] => {
    if (isCancelled) {
      return ['completed', 'upcoming', 'upcoming', 'upcoming'];
    }

    if (isDelivered) {
      return ['completed', 'completed', 'completed', 'completed'];
    }

    if (isShipped) {
      return ['completed', 'completed', 'completed', 'active'];
    }

    // When status === 'processing'
    if (isProcessing) {
      if (hasTracking || hasCarrier) {
        // Carrier assigned and tracking generated; advancing to transit
        return ['completed', 'completed', 'completed', 'active'];
      }
      // Stock reserved, carrier assignment in progress
      return ['completed', 'completed', 'active', 'upcoming'];
    }

    // Default 'pending': order placed, background flow reserving stock
    return ['completed', 'active', 'upcoming', 'upcoming'];
  };

  const [placedStatus, stockStatus, carrierStatus, transitStatus] = getStepStatuses();

  // Captions for each step
  const createdTime = order.created
    ? new Date(order.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Confirmed';

  const steps: TrackingStep[] = [
    {
      id: 'placed',
      label: 'Order Placed',
      sublabel: 'Payment verified',
      status: placedStatus,
      caption: createdTime,
      icon: <Package className="w-4 h-4 sm:w-4.5 sm:h-4.5" />,
    },
    {
      id: 'stock',
      label: 'Stock Reserved',
      sublabel: stockStatus === 'completed' ? 'Inventory locked' : 'Allocating stock',
      status: stockStatus,
      caption: stockStatus === 'completed' ? 'Secured' : 'Verifying stock...',
      icon: <PackageCheck className="w-4 h-4 sm:w-4.5 sm:h-4.5" />,
    },
    {
      id: 'carrier',
      label: 'Carrier Assigned',
      sublabel: order.carrier || 'Dispatch partner',
      status: carrierStatus,
      caption: hasCarrier ? order.carrier! : carrierStatus === 'active' ? 'Assigning courier...' : 'Pending',
      icon: <Truck className="w-4 h-4 sm:w-4.5 sm:h-4.5" />,
    },
    {
      id: 'transit',
      label: 'In Transit',
      sublabel: isDelivered ? 'Delivered' : hasTracking ? `TRK: ${order.trackingNumber}` : 'Out for delivery',
      status: transitStatus,
      caption: isDelivered
        ? 'Delivered'
        : transitStatus === 'active'
        ? hasTracking
          ? 'En route'
          : 'Preparing dispatch'
        : 'Awaiting pickup',
      icon: isDelivered ? <Check className="w-4 h-4 sm:w-4.5 sm:h-4.5" /> : <MapPin className="w-4 h-4 sm:w-4.5 sm:h-4.5" />,
    },
  ];

  // Calculate overall progress bar fill percentage
  const getProgressPercentage = (): number => {
    if (isCancelled) return 0;
    if (isDelivered) return 100;
    if (transitStatus === 'active') return 90;
    if (carrierStatus === 'active') return 66;
    if (stockStatus === 'active') return 33;
    return 15;
  };

  const progressPercentage = getProgressPercentage();

  const handleCopyTracking = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!order.trackingNumber) return;
    navigator.clipboard.writeText(order.trackingNumber);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  // Find next status for demo simulation
  const getNextStatus = (): 'pending' | 'processing' | 'shipped' | 'delivered' | null => {
    switch (order.status) {
      case 'pending':
        return 'processing';
      case 'processing':
        return 'shipped';
      case 'shipped':
        return 'delivered';
      default:
        return null;
    }
  };

  const nextStatus = getNextStatus();

  return (
    <div className="w-full bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-xs space-y-4">
      {/* Top Stepper Header: Title and Live SSE Badge */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-xs sm:text-sm text-slate-900 tracking-tight flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-brand-600 animate-pulse" />
            Live Fulfillment Tracking
          </span>
          <span className="text-[11px] text-slate-400">• Flow State Machine</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Live SSE Synced Indicator */}
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80 shadow-2xs"
            title="Real-time Server-Sent Events (SSE) active for this order"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span>Live SSE</span>
          </div>

          {/* Optional manual demo advance button */}
          {onAdvanceStatus && nextStatus && (
            <button
              onClick={() => onAdvanceStatus(order.id, nextStatus)}
              className="text-[10px] font-bold text-brand-700 hover:text-brand-900 bg-brand-50 hover:bg-brand-100 px-2 py-0.5 rounded-md border border-brand-200 transition-colors flex items-center gap-1"
              title={`Simulate advancing order to ${nextStatus}`}
            >
              <span>Advance ➔ {nextStatus}</span>
            </button>
          )}
        </div>
      </div>

      {/* Cancelled Notice */}
      {isCancelled && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>This order was cancelled. Fulfillment steps have ceased.</span>
        </div>
      )}

      {/* Horizontal Stepper Component */}
      <nav aria-label="Order fulfillment stages" className="relative pt-2 pb-1">
        {/* Continuous Connecting Bar Track */}
        <div
          className="absolute top-6 sm:top-6 left-6 right-6 sm:left-8 sm:right-8 h-1 sm:h-1.5 bg-slate-100 rounded-full -translate-y-1/2 z-0 overflow-hidden"
          aria-hidden="true"
        >
          {/* Active / Filled Segment */}
          <div
            className="h-full bg-gradient-to-r from-emerald-500 via-brand-500 to-brand-400 transition-all duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        {/* Semantic Ordered List for Accessibility */}
        <ol className="relative z-10 flex items-start justify-between w-full" role="list">
          {steps.map((step, idx) => {
            const isStepCompleted = step.status === 'completed';
            const isStepActive = step.status === 'active';
            const isStepUpcoming = step.status === 'upcoming';

            return (
              <li
                key={step.id}
                aria-current={isStepActive ? 'step' : undefined}
                className="flex-1 flex flex-col items-center text-center px-1 group"
              >
                {/* Node Circle */}
                <div className="relative mb-2 flex items-center justify-center">
                  {/* Pulsing ring for active state */}
                  {isStepActive && (
                    <span
                      className="absolute -inset-1 rounded-full bg-brand-400 opacity-30 animate-ping motion-reduce:hidden"
                      aria-hidden="true"
                    />
                  )}

                  <div
                    className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-500 ${
                      isStepCompleted
                        ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200 ring-4 ring-white'
                        : isStepActive
                        ? 'bg-brand-600 text-white shadow-md shadow-brand-500/30 ring-4 ring-brand-100'
                        : 'bg-white border-2 border-slate-200 text-slate-400 ring-4 ring-white'
                    }`}
                  >
                    {isStepCompleted ? (
                      <Check className="w-4 h-4 stroke-[2.8]" />
                    ) : isStepActive ? (
                      <span className="animate-spin-slow motion-reduce:animate-none">
                        {step.icon}
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono">{idx + 1}</span>
                    )}
                  </div>
                </div>

                {/* Step Labels */}
                <div className="flex flex-col items-center max-w-[90px] sm:max-w-[120px]">
                  <span
                    className={`text-[11px] sm:text-xs font-bold leading-tight transition-colors ${
                      isStepActive
                        ? 'text-brand-900'
                        : isStepCompleted
                        ? 'text-slate-800'
                        : 'text-slate-400'
                    }`}
                  >
                    {step.label}
                  </span>

                  {/* Caption & Status info */}
                  <span
                    className={`text-[9px] sm:text-[10px] mt-0.5 line-clamp-1 transition-colors ${
                      isStepActive
                        ? 'text-brand-600 font-semibold flex items-center gap-1'
                        : isStepCompleted
                        ? 'text-emerald-700 font-medium'
                        : 'text-slate-400'
                    }`}
                  >
                    {isStepActive && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse shrink-0 motion-reduce:hidden"
                        aria-hidden="true"
                      />
                    )}
                    {step.caption}
                  </span>

                  {/* Accessible hidden text for screen readers */}
                  <span className="sr-only">
                    Step {idx + 1}: {step.label} - {step.status} ({step.caption})
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Bottom Metadata Bar: Carrier & Live Tracking Pill */}
      {(hasCarrier || hasTracking) && (
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            {order.carrier && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-900 font-medium text-[11px]">
                <Truck className="w-3.5 h-3.5 text-indigo-600" />
                <span>Carrier: <strong>{order.carrier}</strong></span>
              </span>
            )}

            {order.trackingNumber && (
              <button
                type="button"
                onClick={handleCopyTracking}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200/80 text-slate-800 font-mono font-bold text-[11px] transition-colors border border-slate-200"
                title="Click to copy tracking code"
              >
                <span>{order.trackingNumber}</span>
                {hasCopied ? (
                  <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-500 hover:text-slate-800" />
                )}
                {hasCopied && <span className="text-[10px] text-emerald-600 font-sans font-bold">Copied!</span>}
              </button>
            )}
          </div>

          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Updated live via Flow</span>
          </div>
        </div>
      )}
    </div>
  );
};
