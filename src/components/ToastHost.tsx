'use client';

import { useDataStore } from '@/store/useDataStore';

export function ToastHost() {
  const toasts = useDataStore((s) => s.toasts);
  return (
    <div id="toastHost">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.type === 'info' ? '' : ' ' + t.type}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
