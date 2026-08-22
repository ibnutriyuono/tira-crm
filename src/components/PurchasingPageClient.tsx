'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { PurchasingBoard } from './PurchasingBoard';
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
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark">TIRA</span>
            <span className="brand-sub">Purchasing</span>
          </div>
          <div className="topbar-actions">
            <Link className="btn btn-ghost-dark" href="/">← Kembali ke CRM</Link>
          </div>
        </div>
      </div>
      <div className="wrap">
        <div className="panel">
          <div className="panel-head">
            <h2>Permintaan Pembelian</h2>
            <span className="hint">{canEdit ? 'Anda dapat meminta dan mengisi penawaran vendor.' : 'Hanya-baca — perubahan dilakukan oleh tim Purchasing.'}</span>
          </div>
          <div style={{ padding: 14 }}>
            <PurchasingBoard readOnly={!canEdit} />
          </div>
        </div>
      </div>
      <ToastHost />
      <TeamChatWidget />
    </>
  );
}
