'use client';

import { useDataStore } from '@/store/useDataStore';

import { useT } from '@/store/useLangStore';
export function ToastHost() {
  const tr = useT();
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
            <span>{tr(t.message)}</span>
            <span className="toast-cta">{tr("Buka →")}</span>
          </button>
        ) : (
          <div key={t.id} className={`toast${t.type === 'info' ? '' : ' ' + t.type}`}>
            {tr(t.message)}
          </div>
        ),
      )}
    </div>
  );
}
