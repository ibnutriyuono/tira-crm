'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ROLE_LABELS } from '@/lib/constants';
import { useCan } from '@/hooks/useCan';
import { quotePermAct } from '@/lib/roles';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import type { Prospect } from '@/lib/types';
import { LangSwitch } from '../LangSwitch';
import { RunningText } from '../RunningText';
import { KpiGrid } from '../KpiGrid';
import { FunnelPanel } from '../FunnelPanel';
import { Filters } from '../Filters';
import { ProspectTable } from '../ProspectTable';
import { KanbanBoard } from '../KanbanBoard';
import { IconBell, IconCalendar, IconChartLine, IconDoc, IconPlus, IconSearch } from '../icons';
import { useNavItems, type NavGroup } from './useNavItems';
import { CommandPalette } from './CommandPalette';
import { DeskHome } from './DeskHome';
import { ProspectPanel } from './ProspectPanel';

type Page = 'beranda' | 'pipeline';
const GROUPS: NavGroup[] = ['Kerja', 'Penjualan', 'Customer', 'Purchasing', 'Analisa', 'Admin', 'Data'];
const BOTTOM = new Set(['notif', 'akun', 'lama', 'keluar', 'tambah', 'penawaran', 'aktivitas']);

function readLs(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function writeLs(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* abaikan */
  }
}

const IconHome = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </svg>
);

/**
 * Tampilan desktop baru: navigasi kiri (dikelompokkan, bisa diciutkan),
 * Ctrl+K, Beranda "Hari ini untuk Anda", dan Pipeline dengan panel kanan.
 * Semua modal CRM tetap sama (dirender oleh CrmApp).
 */
export function DeskShell({ filtered }: { filtered: Prospect[] }) {
  const tr = useT();
  const me = useDataStore((s) => s.currentUser);
  const records = useDataStore((s) => s.prospects);
  const viewMode = useUiStore((s) => s.viewMode);
  const panelId = useUiStore((s) => s.deskPanelId);
  const { items, unread } = useNavItems(tr);
  const canE = useCan('prospek', 'e');
  const canQuote = useCan('prospek', quotePermAct(me?.role));
  const canAkt = useCan('aktivitas');
  const [page, setPageState] = useState<Page>(() => (readLs('tira.deskPage', 'beranda') === 'pipeline' ? 'pipeline' : 'beranda'));
  const [narrow, setNarrow] = useState(() => readLs('tira.deskNav', '') === 'ciut');
  const [summary, setSummary] = useState(() => readLs('tira.deskSummary', '') !== 'tutup');

  useEffect(() => {
    useUiStore.setState({ deskActive: true });
    return () => useUiStore.setState({ deskActive: false, deskPanelId: null });
  }, []);

  const setPage = useCallback((p: Page) => {
    setPageState(p);
    writeLs('tira.deskPage', p);
    if (p === 'beranda') useUiStore.setState({ deskPanelId: null });
  }, []);

  if (!me) return null;
  const scope = me.role === 'sales' ? me.se : me.role === 'bm' || me.role === 'salesadmin' ? me.cabang : me.role === 'rm' ? `Regional ${me.reg ?? '-'}` : '';
  const byId = (id: string) => items.find((i) => i.id === id);
  const run = (id: string) => byId(id)?.run();
  const navBtn = (key: string, label: string, icon: ReactNode, onClick: () => void, opts: { on?: boolean; badge?: number } = {}) => (
    <button key={key} type="button" className={`dk-nav-i${opts.on ? ' on' : ''}`} onClick={onClick} title={narrow ? label : undefined} aria-current={opts.on ? 'page' : undefined}>
      <span className="ic">{icon}</span>
      <span className="lb">{label}</span>
      {!!opts.badge && <span className="dk-badge">{opts.badge > 99 ? '99+' : opts.badge}</span>}
    </button>
  );

  return (
    <div className={`dk${narrow ? ' narrow' : ''}`}>
      <nav className="dk-nav" aria-label={tr('Navigasi utama')}>
        <div className="dk-brand">
          <span className="logo-chip">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" />
          </span>
          <span className="dk-mark" aria-hidden="true">T</span>
          <div className="lb">
            <b>CRM TIRA</b>
            <small>Steel Division</small>
          </div>
        </div>

        <button type="button" className="dk-search" onClick={() => useUiStore.setState({ paletteOpen: true })} title={tr('Cari (Ctrl+K)')}>
          <IconSearch />
          <span className="lb">{tr('Cari…')}</span>
          <kbd className="lb">Ctrl K</kbd>
        </button>

        <div className="dk-nav-scroll">
          {navBtn('beranda', tr('Beranda'), <IconHome />, () => setPage('beranda'), { on: page === 'beranda' })}
          {navBtn('pipeline', tr('Pipeline'), <IconChartLine />, () => setPage('pipeline'), { on: page === 'pipeline', badge: 0 })}
          {GROUPS.map((g) => {
            const list = items.filter((i) => i.group === g && !BOTTOM.has(i.id) && i.id !== 'save');
            if (!list.length) return null;
            return (
              <div key={g} className="dk-grp">
                <div className="dk-grp-h">{tr(g)}</div>
                {list.map((i) => navBtn(i.id, i.label, i.icon, i.run, { badge: i.badge }))}
              </div>
            );
          })}
        </div>

        <div className="dk-nav-foot">
          {navBtn('notif', tr('Notifikasi'), <IconBell />, () => run('notif'), { badge: unread })}
          <div className="dk-user">
            <button type="button" className="dk-user-b" onClick={() => run('akun')} title={tr('Akun Saya')}>
              <span className="av">{(me.name || '?').slice(0, 1).toUpperCase()}</span>
              <span className="lb">
                <b>{me.name}</b>
                <small>{me.customRoleLabel || ROLE_LABELS[me.role] || me.role}{scope ? ` · ${scope}` : ''}</small>
              </span>
            </button>
          </div>
          <div className="dk-foot-row lb">
            <LangSwitch dark />
            <button type="button" className="dk-mini" onClick={() => run('lama')} title={tr('Kembali ke bar menu atas')}>{tr('Tampilan lama')}</button>
            <button type="button" className="dk-mini" onClick={() => run('keluar')}>{tr('Keluar')}</button>
          </div>
          <button
            type="button"
            className="dk-collapse"
            onClick={() => {
              setNarrow((v) => !v);
              writeLs('tira.deskNav', narrow ? '' : 'ciut');
            }}
            aria-label={narrow ? tr('Lebarkan menu') : tr('Ciutkan menu')}
            title={narrow ? tr('Lebarkan menu') : tr('Ciutkan menu')}
          >
            {narrow ? '»' : '«'}
          </button>
        </div>
      </nav>

      <div className="dk-main">
        <header className="dk-head">
          <h1>{page === 'beranda' ? tr('Beranda') : tr('Pipeline')}</h1>
          <div className="dk-head-a">
            {canAkt && <button type="button" className="btn btn-activity" onClick={() => run('aktivitas')}><IconCalendar />{tr('Aktivitas Harian')}</button>}
            {canE && canQuote && <button type="button" className="btn btn-quote" onClick={() => run('penawaran')}><IconDoc />{tr('Buat Penawaran')}</button>}
            {canE && <button type="button" className="btn btn-primary" onClick={() => run('tambah')}><IconPlus />{tr('Tambah Prospek')}</button>}
          </div>
        </header>
        <RunningText />

        {page === 'beranda' ? (
          <div className="dk-body">
            <DeskHome onPage={setPage} />
          </div>
        ) : (
          <div className={`dk-pipe${panelId ? ' with-panel' : ''}`}>
            <div className="dk-body">
              <button
                type="button"
                className="dk-toggle-sum"
                onClick={() => {
                  setSummary((v) => !v);
                  writeLs('tira.deskSummary', summary ? 'tutup' : '');
                }}
              >
                {summary ? `▾ ${tr('Sembunyikan ringkasan')}` : `▸ ${tr('Tampilkan ringkasan (KPI & funnel)')}`}
              </button>
              {summary && (
                <>
                  <KpiGrid list={filtered} />
                  <FunnelPanel list={filtered} />
                </>
              )}
              <div className="panel">
                <div className="panel-head">
                  <h2>{tr('Daftar Prospek')}</h2>
                  <div className="panel-head-right">
                    <span className="hint">
                      {filtered.length} {tr('dari')} {records.length} {tr('total prospek')} · {tr('klik baris untuk melihat detail')}
                    </span>
                    <div className="view-toggle">
                      <button type="button" className={viewMode === 'table' ? 'active' : ''} onClick={() => useUiStore.setState({ viewMode: 'table' })}>{tr('Tabel')}</button>
                      <button type="button" className={viewMode === 'card' ? 'active' : ''} onClick={() => useUiStore.setState({ viewMode: 'card' })}>{tr('Card')}</button>
                    </div>
                  </div>
                </div>
                <Filters />
                {viewMode === 'card' ? <KanbanBoard filtered={filtered} /> : <ProspectTable filtered={filtered} total={records.length} />}
              </div>
            </div>
            {panelId && <ProspectPanel key={panelId} id={panelId} />}
          </div>
        )}
      </div>

      <CommandPalette items={items} onPage={setPage} />
    </div>
  );
}
