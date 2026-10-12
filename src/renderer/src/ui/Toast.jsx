import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CircleCheck, CircleAlert, TriangleAlert, Info, X } from 'lucide-react';
import { isSessionError } from '../lib/api.js';
import { cx } from './cx.js';

const ToastContext = createContext(null);

const TONES = {
  success: { icon: CircleCheck, className: 'text-teal' },
  error: { icon: CircleAlert, className: 'text-red' },
  warning: { icon: TriangleAlert, className: 'text-amber' },
  info: { icon: Info, className: 'text-ink-2' }
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (message, type = 'success', { sticky = false } = {}) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-4), { id, message: String(message), type, sticky }]);
      if (!sticky) setTimeout(() => dismiss(id), type === 'error' ? 6000 : 3200);
      return id;
    },
    [dismiss]
  );

  const toastError = useCallback(
    (err) => {
      console.error(err);
      toast(err && err.message ? err.message : String(err), 'error');
    },
    [toast]
  );

  /** Wrap an async handler so failures show as a toast (session errors are handled by the lock screen). */
  const guard = useCallback(
    (fn) =>
      async (...args) => {
        try {
          return await fn(...args);
        } catch (err) {
          if (!isSessionError(err)) toastError(err);
          return undefined;
        }
      },
    [toastError]
  );

  const value = useMemo(() => ({ toast, toastError, guard, dismiss }), [toast, toastError, guard, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[70] flex w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col items-stretch gap-2" aria-live="polite" id="toastContainer">
        {toasts.map((t) => {
          const tone = TONES[t.type] || TONES.info;
          const Icon = tone.icon;
          return (
            <div
              key={t.id}
              role={t.type === 'error' ? 'alert' : 'status'}
              data-toast={t.type}
              className="toast-notification pointer-events-auto flex items-start gap-3 rounded-panel border border-foil bg-surface px-4 py-3 shadow-pop animate-toast-in"
            >
              <Icon className={cx('mt-px size-5 shrink-0', tone.className)} aria-hidden="true" />
              <p className="min-w-0 flex-1 text-base text-ink">{t.message}</p>
              <button type="button" onClick={() => dismiss(t.id)} className="-m-1 rounded p-1 text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Dismiss">
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
