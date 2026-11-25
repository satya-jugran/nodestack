import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'realtime';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. Pass 0 for persistent until dismissed. */
  duration?: number;
  /** Optional key to update/coalesce an existing active toast instead of stacking duplicates. */
  dedupeKey?: string;
}

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
  createdAt: number;
  dedupeKey?: string;
  isClosing?: boolean;
}

export interface ToastAnnouncement {
  seq: number;
  text: string;
  priority: 'normal' | 'high';
}

type ToastHelperOptions = Omit<ToastOptions, 'title' | 'description' | 'variant'>;

interface ToastHelpers {
  success: (title: string, description?: string, opts?: ToastHelperOptions) => string;
  error: (title: string, description?: string, opts?: ToastHelperOptions) => string;
  warning: (title: string, description?: string, opts?: ToastHelperOptions) => string;
  info: (title: string, description?: string, opts?: ToastHelperOptions) => string;
  realtime: (title: string, description?: string, opts?: ToastHelperOptions) => string;
}

interface ToastContextType {
  toasts: ToastItem[];
  latestAnnouncement: ToastAnnouncement | null;
  showToast: (options: ToastOptions | string) => string;
  dismissToast: (id: string) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
  toast: ToastHelpers;
}

const MAX_ACTIVE_TOASTS = 4;
const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 5500;

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [latestAnnouncement, setLatestAnnouncement] = useState<ToastAnnouncement | null>(null);
  const idCounterRef = useRef(0);
  const announcementSeqRef = useRef(0);

  const showToast = useCallback((input: ToastOptions | string): string => {
    const opts: ToastOptions = typeof input === 'string' ? { title: input } : input;
    const variant: ToastVariant = opts.variant ?? 'info';
    const duration =
      typeof opts.duration === 'number'
        ? opts.duration
        : variant === 'error'
          ? ERROR_DURATION_MS
          : DEFAULT_DURATION_MS;
    const now = Date.now();

    let resolvedId = '';

    setToasts((prev) => {
      if (opts.dedupeKey) {
        const existing = prev.find((t) => !t.isClosing && t.dedupeKey === opts.dedupeKey);
        if (existing) {
          resolvedId = existing.id;
          return prev.map((t) =>
            t.id === existing.id
              ? {
                  ...t,
                  title: opts.title,
                  description: opts.description,
                  variant,
                  duration,
                  createdAt: now,
                }
              : t
          );
        }
      }

      idCounterRef.current += 1;
      const newId = `toast_${idCounterRef.current}_${now}`;
      resolvedId = newId;

      const nextItem: ToastItem = {
        id: newId,
        title: opts.title,
        description: opts.description,
        variant,
        duration,
        createdAt: now,
        dedupeKey: opts.dedupeKey,
      };

      const next = [...prev, nextItem];
      const activeIds = next.filter((t) => !t.isClosing).map((t) => t.id);
      if (activeIds.length > MAX_ACTIVE_TOASTS) {
        const overflowCount = activeIds.length - MAX_ACTIVE_TOASTS;
        const idsToClose = new Set(activeIds.slice(0, overflowCount));
        return next.map((t) => (idsToClose.has(t.id) ? { ...t, isClosing: true } : t));
      }
      return next;
    });

    const visibleText = opts.description ? `${opts.title}. ${opts.description}` : opts.title;
    announcementSeqRef.current += 1;
    setLatestAnnouncement({
      seq: announcementSeqRef.current,
      text: visibleText,
      priority: variant === 'error' ? 'high' : 'normal',
    });

    return resolvedId;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id && !t.isClosing ? { ...t, isClosing: true } : t))
    );
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts((prev) => prev.map((t) => (t.isClosing ? t : { ...t, isClosing: true })));
  }, []);

  const toast = useMemo<ToastHelpers>(
    () => ({
      success: (title, description, opts) =>
        showToast({ ...opts, title, description, variant: 'success' }),
      error: (title, description, opts) =>
        showToast({ ...opts, title, description, variant: 'error' }),
      warning: (title, description, opts) =>
        showToast({ ...opts, title, description, variant: 'warning' }),
      info: (title, description, opts) =>
        showToast({ ...opts, title, description, variant: 'info' }),
      realtime: (title, description, opts) =>
        showToast({ ...opts, title, description, variant: 'realtime' }),
    }),
    [showToast]
  );

  const value = useMemo<ToastContextType>(
    () => ({
      toasts,
      latestAnnouncement,
      showToast,
      dismissToast,
      removeToast,
      clearToasts,
      toast,
    }),
    [toasts, latestAnnouncement, showToast, dismissToast, removeToast, clearToasts, toast]
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
