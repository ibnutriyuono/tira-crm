'use client';

import { useDataStore } from '@/store/useDataStore';

export function ToastHost() {
  const toasts = useDataStore((s) => s.toasts);
  const dismissToast = useDataStore((s) => s.dismissToast);
  return (
    <div id="toastHost">
      {toasts.map((t) =>
        t.onClick ? (
          // Actionable toasts get a button so they are keyboard-reachable and
          // announced as interactive, not just a div that happens to be clickable.
          <button
            key={t.id}
            type="button"
            className={`toast toast-action${t.type === 'info' ? '' : ' ' + t.type}`}
            onClick={() => {
              t.onClick?.();
              dismissToast(t.id);
            }}
          >
            <span>{t.message}</span>
            <span className="toast-cta">Buka &rarr;</span>
          </button>
        ) : (
          <div key={t.id} className={`toast${t.type === 'info' ? '' : ' ' + t.type}`}>
            {t.message}
          </div>
        ),
      )}
    </div>
  );
}
