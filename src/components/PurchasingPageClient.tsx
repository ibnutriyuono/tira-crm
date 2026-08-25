'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PurchasingBoard } from './PurchasingBoard';
import { IconBag } from './icons';
import { ROLE_LABELS } from '@/lib/constants';
import { api } from '@/lib/api-client';
import { ToastHost } from './ToastHost';
import { TeamChatWidget } from './TeamChatWidget';
import { useDataStore } from '@/store/useDataStore';
import { useCrmSocket } from '@/hooks/useCrmSocket';

/**
 * Dedicated purchasing workspace. The same board renders read-only inside a
 * modal for other roles (see PurchasingMonitorModal).
 */
export function PurchasingPageClient() {
  const loaded = useDataStore((s) => s.loaded);
  const bootstrap = useDataStore((s) => s.bootstrap);
  const currentUser = useDataStore((s) => s.currentUser);

  const router = useRouter();

  async function logout() {
    try {
      await api.post('/api/auth/logout');
    } finally {
      useDataStore.getState().reset();
      router.replace('/login');
      router.refresh();
    }
  }

  useCrmSocket();

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) return <div className="app-loading">Memuat data Purchasing…</div>;

  const canEdit = currentUser?.role === 'purchasing' || currentUser?.role === 'admin';

  return (
    <>
      <div className="topbar">
          <div className="brand">
            <span className="logo-chip" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26 }}>
              <IconBag />
            </span>
            <div>
              <h1 style={{ margin: 0 }}>Purchasing TIRA</h1>
              <span className="sub">Steel Division · PT Tira Austenite</span>
            </div>
          </div>
          <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="pic-chip">
              {currentUser?.name} · <b>{ROLE_LABELS[currentUser?.role ?? ''] || currentUser?.role}</b>
            </span>
            {/* Purchasing lives only in this workspace; other roles arrive from
                the CRM and need a way back. */}
            {currentUser?.role !== 'purchasing' && (
              <Link className="btn btn-ghost-dark btn-sm" href="/">← Kembali ke CRM</Link>
            )}
            <button type="button" className="btn btn-outline-dark btn-sm" onClick={logout}>Keluar</button>
            <span style={{ fontSize: 11, color: 'var(--slate-300)', fontFamily: 'var(--font-ibm-plex-mono), monospace' }}>
              Tersimpan {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
      </div>
      <div className="wrap">
        <PurchasingBoard readOnly={!canEdit} standalone />
      </div>
      <ToastHost />
      <TeamChatWidget />
    </>
  );
}
