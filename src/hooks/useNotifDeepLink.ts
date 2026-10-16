'use client';

import { useEffect } from 'react';
import { openNotification } from '@/components/modals/NotificationsModal';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

/**
 * Link "Buka di CRM" dari email notifikasi: /?n=<id notifikasi>. Setelah data
 * termuat, buka dokumen notifikasi itu (sama seperti klik di daftar
 * Notifikasi), lalu hapus ?n dari alamat. Notifikasi yang sudah tidak ada di
 * daftar (lebih lama dari 50 terakhir) cukup membuka daftar Notifikasi.
 */
export function useNotifDeepLink(enabled = true) {
  const loaded = useDataStore((s) => s.loaded);
  useEffect(() => {
    if (!enabled || !loaded) return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get('n');
    if (!id) return;
    url.searchParams.delete('n');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    const n = useDataStore.getState().notifications.find((x) => x.id === id);
    if (n) openNotification(n);
    else useUiStore.getState().openModal('notifications');
  }, [enabled, loaded]);
}
