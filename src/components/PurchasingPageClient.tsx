'use client';

import { isPurchasingRoleClient } from '@/lib/doc-lines';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PurchasingBoard } from './PurchasingBoard';
import { IconBag, IconBell, IconCalendar } from './icons';
import { ROLE_LABELS } from '@/lib/constants';
import { api } from '@/lib/api-client';
import { ToastHost } from './ToastHost';
import { CancelDocModal } from './modals/CancelDocModal';
import { ImportModal } from './modals/ImportModal';
import { DeleteConfirmModal } from './modals/DeleteConfirmModal';
import { NotificationsModal } from './modals/NotificationsModal';
import { AccountModal } from './modals/AccountModal';
import { SalesActivityModal } from './modals/SalesActivityModal';
import { useCan } from '@/hooks/useCan';
import { TeamChatWidget } from './TeamChatWidget';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useCrmSocket } from '@/hooks/useCrmSocket';
import { useNotifDeepLink } from '@/hooks/useNotifDeepLink';

import { useT } from '@/store/useLangStore';
import { LangSwitch } from './LangSwitch';
/**
 * Dedicated purchasing workspace. The same board renders read-only inside a
 * modal for other roles (see PurchasingMonitorModal).
 */
export function PurchasingPageClient() {
  const tr = useT();
  const loaded = useDataStore((s) => s.loaded);
  const bootstrap = useDataStore((s) => s.bootstrap);
  const currentUser = useDataStore((s) => s.currentUser);
  // Semua role punya Aktivitas Harian (Kelola Role menentukan tampil / tidak).
  const canAktivitas = useCan('aktivitas', 'v');
  const notifications = useDataStore((s) => s.notifications);
  const unreadNotifCount = notifications.filter((n) => !n.readAt).length;
  const openModal = useUiStore((s) => s.openModal);

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
  useNotifDeepLink();

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) return <div className="app-loading">{tr("Memuat data Purchasing…")}</div>;

  const canEdit = isPurchasingRoleClient(currentUser?.role) || currentUser?.role === 'admin';

  return (
    <>
      <div className="topbar">
          <div className="brand">
            <span className="logo-chip" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26 }}>
              <IconBag />
            </span>
            <div>
              <h1 style={{ margin: 0 }}>{tr("Purchasing TIRA")}</h1>
              <span className="sub">{tr("Steel Division · PT. TIRA AUSTENITE,")} <span style={{ textTransform: 'none' }}>{tr("Tbk")}</span></span>
            </div>
          </div>
          <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="pic-chip">
              {currentUser?.name} · <b>{ROLE_LABELS[currentUser?.role ?? ''] || currentUser?.role}</b>
            </span>
            <button type="button" className="btn btn-ghost-dark btn-sm" style={{ position: 'relative' }} onClick={() => openModal('notifications')}>
              <IconBell />
              {tr("Notifikasi")}
              {unreadNotifCount > 0 && (
                <span className="topbar-badge" title={`${unreadNotifCount} notifikasi belum dibaca`}>
                  {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                </span>
              )}
            </button>
            {/* Purchasing lives only in this workspace; other roles arrive from
                the CRM and need a way back. */}
            {!isPurchasingRoleClient(currentUser?.role) && (
              <Link className="btn btn-ghost-dark btn-sm" href="/">{tr("← Kembali ke CRM")}</Link>
            )}
            {canAktivitas && (
              <button type="button" className="btn btn-ghost-dark btn-sm" onClick={() => openModal('salesActivity')}>
                <IconCalendar />
                {tr("Aktivitas Harian")}
              </button>
            )}
            <LangSwitch dark />
            <button type="button" className="btn btn-outline-dark btn-sm" onClick={() => openModal('account')}>{tr("Akun Saya")}</button>
            <button type="button" className="btn btn-outline-dark btn-sm" onClick={logout}>{tr("Keluar")}</button>
            <span style={{ fontSize: 11, color: 'var(--slate-300)', fontFamily: 'var(--font-ibm-plex-mono), monospace' }}>
              {tr("Tersimpan")} {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
      </div>
      <div className="wrap">
        <PurchasingBoard readOnly={!canEdit} standalone />
      </div>
      <CancelDocModal />
      <ImportModal />
      <DeleteConfirmModal />
      <NotificationsModal />
      <AccountModal />
      <SalesActivityModal />
      <ToastHost />
      <TeamChatWidget />
    </>
  );
}
