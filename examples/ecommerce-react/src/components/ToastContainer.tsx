import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ToastItem, ToastVariant, useToast } from '../context/ToastContext';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  Zap,
  X,
} from 'lucide-react';

const VARIANT_STYLES: Record<
  ToastVariant,
  {
    border: string;
    iconBg: string;
    iconColor: string;
    barColor: string;
    badgeLabel?: string;
    Icon: React.FC<{ className?: string }>;
  }
> = {
  success: {
    border: 'border-emerald-200/90',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    barColor: 'bg-emerald-500',
    Icon: CheckCircle2,
  },
  error: {
    border: 'border-rose-200/90',
    iconBg: 'bg-rose-50',
    iconColor: 'text-rose-600',
    barColor: 'bg-rose-500',
    Icon: AlertCircle,
  },
  warning: {
    border: 'border-amber-200/90',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    barColor: 'bg-amber-500',
    Icon: AlertTriangle,
  },
  info: {
    border: 'border-brand-200/90',
    iconBg: 'bg-brand-50',
    iconColor: 'text-brand-600',
    barColor: 'bg-brand-500',
    Icon: Info,
  },
  realtime: {
    border: 'border-indigo-200/90',
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
    barColor: 'bg-indigo-500',
    Icon: Zap,
  },
};

interface ToastCardProps {
  toast: ToastItem;
  onDismiss: (id: string, isManual: boolean) => void;
  onRemove: (id: string) => void;
  registerCardRef: (id: string, el: HTMLDivElement | null) => void;
  registerCloseRef: (id: string, el: HTMLButtonElement | null) => void;
}

const ToastCard: React.FC<ToastCardProps> = ({
  toast,
  onDismiss,
  onRemove,
  registerCardRef,
  registerCloseRef,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const remainingRef = useRef<number>(toast.duration);
  const startedAtRef = useRef<number | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const isPaused = isHovered || isFocused;

  // Reset remaining auto-dismiss duration when a toast is created or dedupe-updated
  useEffect(() => {
    remainingRef.current = toast.duration;
    startedAtRef.current = null;
  }, [toast.id, toast.createdAt, toast.duration]);

  // Auto-dismiss timer that pauses while hovered or keyboard-focused
  useEffect(() => {
    if (toast.isClosing || toast.duration <= 0 || isPaused) {
      return;
    }

    const delay = Math.max(0, remainingRef.current);
    startedAtRef.current = Date.now();

    const timer = window.setTimeout(() => {
      startedAtRef.current = null;
      remainingRef.current = 0;
      onDismiss(toast.id, false);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      if (startedAtRef.current !== null) {
        const elapsed = Date.now() - startedAtRef.current;
        remainingRef.current = Math.max(0, remainingRef.current - elapsed);
        startedAtRef.current = null;
      }
    };
  }, [toast.id, toast.createdAt, toast.duration, toast.isClosing, isPaused, onDismiss]);

  // Wait for CSS exit transition/animation to finish before unmounting
  useEffect(() => {
    if (!toast.isClosing) return;

    let cancelled = false;
    const el = cardRef.current;
    if (!el) {
      onRemove(toast.id);
      return;
    }

    // Flush styles so any transition triggered by [data-closing="true"] is active
    window.getComputedStyle(el).opacity;
    const animations = typeof el.getAnimations === 'function' ? el.getAnimations() : [];

    if (animations.length === 0) {
      onRemove(toast.id);
      return;
    }

    Promise.race([
      Promise.allSettled(animations.map((a) => a.finished)),
      new Promise<void>((resolve) => window.setTimeout(resolve, 350)),
    ]).then(() => {
      if (!cancelled) {
        onRemove(toast.id);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [toast.id, toast.isClosing, onRemove]);

  const style = VARIANT_STYLES[toast.variant];
  const Icon = style.Icon;

  return (
    <div
      ref={(node) => {
        cardRef.current = node;
        registerCardRef(toast.id, node);
      }}
      data-closing={toast.isClosing ? 'true' : 'false'}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsFocused(false);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDismiss(toast.id, true);
        }
      }}
      className={`toast-item pointer-events-auto relative overflow-hidden rounded-2xl bg-white/95 backdrop-blur-md border ${style.border} shadow-xl shadow-slate-900/10 text-slate-900`}
    >
      <div className="p-3.5 pr-3 flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-xl ${style.iconBg} ${style.iconColor} flex items-center justify-center shrink-0 relative`}
        >
          <Icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
          {toast.variant === 'realtime' && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white motion-safe:animate-pulse" />
          )}
        </div>

        <div className="flex-1 min-w-0 pt-0.5 space-y-0.5">
          <p className="text-xs sm:text-[13px] font-bold text-slate-900 leading-snug break-words">
            {toast.title}
          </p>
          {toast.description && (
            <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed break-words">
              {toast.description}
            </p>
          )}
        </div>

        <button
          ref={(node) => registerCloseRef(toast.id, node)}
          type="button"
          onClick={() => onDismiss(toast.id, true)}
          aria-label="Close notification"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {toast.duration > 0 && (
        <div className="h-0.5 w-full bg-slate-100 overflow-hidden">
          <div
            key={toast.createdAt}
            className={`h-full w-full origin-left ${style.barColor} motion-safe:animate-toast-progress`}
            style={{
              animationDuration: `${toast.duration}ms`,
              animationPlayState: isPaused || toast.isClosing ? 'paused' : 'running',
            }}
          />
        </div>
      )}
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const { toasts, latestAnnouncement, dismissToast, removeToast } = useToast();
  const regionRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const closeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const lastExternalFocusRef = useRef<HTMLElement | null>(null);

  const [politeText, setPoliteText] = useState('');
  const [assertiveText, setAssertiveText] = useState('');

  const registerCardRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  const registerCloseRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) closeRefs.current.set(id, el);
    else closeRefs.current.delete(id);
  }, []);

  // Promote toast region to the Top Layer via popover="manual" when toasts are visible
  useEffect(() => {
    const el = regionRef.current as
      | (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void })
      | null;
    if (!el) return;

    try {
      if (toasts.length > 0) {
        if (typeof el.showPopover === 'function' && !el.matches(':popover-open')) {
          el.showPopover();
        }
      } else {
        if (typeof el.hidePopover === 'function' && el.matches(':popover-open')) {
          el.hidePopover();
        }
      }
    } catch {
      // Fallback to standard fixed z-[100] overlay if Popover API is unsupported
    }
  }, [toasts.length]);

  // Announce visible toast text via ariaNotify() with live-region fallback
  useEffect(() => {
    if (!latestAnnouncement) return;

    const doc = document as Document & {
      ariaNotify?: (message: string, options?: { priority?: 'normal' | 'high' }) => void;
    };

    if (typeof doc.ariaNotify === 'function') {
      try {
        doc.ariaNotify(latestAnnouncement.text, {
          priority: latestAnnouncement.priority,
        });
        return;
      } catch {
        // Fall through to live region
      }
    }

    const setter =
      latestAnnouncement.priority === 'high' ? setAssertiveText : setPoliteText;
    setter('');
    const raf = window.requestAnimationFrame(() => {
      setter(latestAnnouncement.text);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [latestAnnouncement]);

  // Track last focused element outside the notification region so we can restore focus
  const handleRegionFocusCapture = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const prevTarget = e.relatedTarget as HTMLElement | null;
    if (prevTarget && !e.currentTarget.contains(prevTarget)) {
      lastExternalFocusRef.current = prevTarget;
    }
  }, []);

  const handleDismiss = useCallback(
    (id: string, isManual: boolean) => {
      if (isManual) {
        const cardEl = cardRefs.current.get(id);
        const activeEl = document.activeElement;
        if (cardEl && activeEl && cardEl.contains(activeEl)) {
          const remaining = toasts.filter((t) => !t.isClosing && t.id !== id);
          if (remaining.length > 0) {
            const currentIndex = toasts.findIndex((t) => t.id === id);
            const nextToast =
              toasts.slice(currentIndex + 1).find((t) => !t.isClosing && t.id !== id) ||
              remaining[remaining.length - 1];
            closeRefs.current.get(nextToast.id)?.focus();
          } else if (lastExternalFocusRef.current?.isConnected) {
            lastExternalFocusRef.current.focus();
            lastExternalFocusRef.current = null;
          }
        }
      }
      dismissToast(id);
    },
    [toasts, dismissToast]
  );

  return (
    <>
      {/* Screen-reader live region fallback (mounted on load outside top-layer popover) */}
      <p className="sr-only">Screen reader notifications</p>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {politeText}
      </div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertiveText}
      </div>

      {/* Top-layer manual popover notification region */}
      <div
        ref={regionRef}
        role="region"
        aria-label="Notifications"
        {...({ popover: 'manual' } as Record<string, string>)}
        onFocusCapture={handleRegionFocusCapture}
        className="toast-region fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[100] m-0 p-0 border-0 bg-transparent overflow-visible inset-auto flex flex-col gap-2.5 w-[min(24rem,calc(100vw-2rem))] pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastCard
            key={t.id}
            toast={t}
            onDismiss={handleDismiss}
            onRemove={removeToast}
            registerCardRef={registerCardRef}
            registerCloseRef={registerCloseRef}
          />
        ))}
      </div>
    </>
  );
};
