'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { ROLE_LABELS } from '@/lib/constants';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useCan } from '@/hooks/useCan';
import { setPhonePref } from '@/hooks/usePhoneMode';
import { useT } from '@/store/useLangStore';
import { LangSwitch } from '../LangSwitch';
import { MobileToday } from './MobileToday';
import { MobilePipeline } from './MobilePipeline';
import { MobileCustomers } from './MobileCustomers';
import { QuickVisitSheet } from './QuickVisitSheet';

export type MobileTab = 'hari' | 'pipeline' | 'customer' | 'menu';

/**
 * Mode HP Sales (web responsif): Hari Ini, Pipeline, Customer, Menu + tombol
 * ＋ Catat kunjungan. Semua modal CRM yang ada tetap dipakai (tampil penuh
 * layar di HP lewat CSS).
 */
export function MobileShell() {
  const tr = useT();
  const router = useRouter();
  const me = useDataStore((s) => s.currentUser);
  const notifications = useDataStore((s) => s.notifications);
  const unread = notifications.filter((n) => !n.readAt).length;
  const openModal = useUiStore((s) => s.openModal);
  const canAkt = useCan('aktivitas', 'e');
  const canRfq = useCan('rfq', 'v');
  const canCust = useCan('customer', 'v');
  const canAnalisa = useCan('analisa', 'v');
  const [tab, setTab] = useState<MobileTab>('hari');
  const [visit, setVisit] = useState<{ customer?: string; prospectId?: string } | null>(null);

  if (!me) return null;
  const scope = me.role === 'sales' ? me.se : me.role === 'bm' || me.role === 'salesadmin' ? me.cabang : me.role === 'rm' ? `Regional ${me.reg ?? '-'}` : '';

  async function logout() {
    await api.post('/api/auth/logout');
    useDataStore.getState().reset();
    router.replace('/login');
    router.refresh();
  }

  const menu: { label: string; hint?: string; run: () => void; show?: boolean }[] = [
    { label: tr('Aktivitas Harian'), hint: tr('daftar & catat aktivitas'), run: () => openModal('salesActivity') },
    { label: tr('Tugas Kunjungan'), hint: tr('dari BM / GM & rencana mingguan'), run: () => openModal('visitTasks'), show: ['sales', 'bm', 'rm', 'gm', 'vp', 'admin', 'salesadmin'].includes(me.role) },
    { label: tr('Papan Follow-up'), hint: tr('jatuh tempo & terlambat'), run: () => openModal('followUpBoard') },
    { label: tr('RFQ / FUP A'), hint: tr('permintaan ke Purchasing'), run: () => openModal('rfqManage'), show: canRfq },
    { label: tr('Kelola Customer'), run: () => openModal('customers'), show: canCust },
    { label: tr('Masalah Pipeline'), run: () => openModal('pipelineIssues') },
    { label: tr('Analisa Eksekutif'), run: () => openModal('gmAnalysis'), show: canAnalisa && me.role !== 'sales' },
    { label: tr('Akun Saya'), run: () => openModal('account') },
    { label: tr('Tampilan desktop'), hint: tr('tampilan lengkap seperti di komputer'), run: () => setPhonePref('desktop') },
  ];

  return (
    <div className="mb">
      <header className="mb-top">
        <div className="mb-brand">
          <b>CRM <span>TIRA</span></b>
          <small>{me.name} · {ROLE_LABELS[me.role] || me.role}{scope ? ` · ${scope}` : ''}</small>
        </div>
        <button type="button" className="mb-bell" aria-label={tr('Notifikasi')} onClick={() => openModal('notifications')}>
          🔔{unread > 0 && <span>{unread > 9 ? '9+' : unread}</span>}
        </button>
      </header>

      <main className="mb-main">
        {tab === 'hari' && <MobileToday onVisit={(c, pid) => setVisit({ customer: c, prospectId: pid })} onGo={setTab} />}
        {tab === 'pipeline' && <MobilePipeline onVisit={(c, pid) => setVisit({ customer: c, prospectId: pid })} />}
        {tab === 'customer' && <MobileCustomers onVisit={(c) => setVisit({ customer: c })} />}
        {tab === 'menu' && (
          <div className="mb-menu">
            {menu
              .filter((m) => m.show !== false)
              .map((m) => (
                <button key={m.label} type="button" className="mb-menu-i" onClick={m.run}>
                  <b>{m.label}</b>
                  {m.hint && <small>{m.hint}</small>}
                </button>
              ))}
            <div className="mb-menu-i mb-menu-lang">
              <b>{tr('Bahasa')}</b>
              <LangSwitch />
            </div>
            <button type="button" className="mb-menu-i mb-out" onClick={logout}>
              <b>{tr('Keluar')}</b>
            </button>
          </div>
        )}
      </main>

      {canAkt && tab !== 'menu' && (
        <button type="button" className="mb-fab" onClick={() => setVisit({})} aria-label={tr('Catat kunjungan')}>
          ＋ <span>{tr('Catat kunjungan')}</span>
        </button>
      )}

      <nav className="mb-nav" aria-label={tr('Menu HP')}>
        {(
          [
            ['hari', '☀', tr('Hari Ini')],
            ['pipeline', '▤', tr('Pipeline')],
            ['customer', '◎', tr('Customer')],
            ['menu', '☰', tr('Menu')],
          ] as [MobileTab, string, string][]
        ).map(([k, ic, l]) => (
          <button key={k} type="button" className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>
            <span aria-hidden="true">{ic}</span>
            {l}
          </button>
        ))}
      </nav>

      {visit && <QuickVisitSheet initialCustomer={visit.customer} prospectId={visit.prospectId} onClose={() => setVisit(null)} />}
    </div>
  );
}
