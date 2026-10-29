'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { STATUS_META } from '@/lib/constants';
import { formatRupiah, num } from '@/lib/format';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import type { NavItem } from './useNavItems';

interface Hit {
  key: string;
  group: string;
  label: ReactNode;
  sub?: string;
  run: () => void;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ');

/**
 * Ctrl+K: cari menu, prospek, dan customer dari satu kotak. Panah atas/bawah
 * untuk memilih, Enter untuk membuka, Esc untuk menutup.
 */
export function CommandPalette({ items, onPage }: { items: NavItem[]; onPage: (p: 'beranda' | 'pipeline') => void }) {
  const tr = useT();
  const openState = useUiStore((s) => s.paletteOpen);
  const prospects = useDataStore((s) => s.prospects);
  const customers = useDataStore((s) => s.customers);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => useUiStore.setState({ paletteOpen: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const s = useUiStore.getState();
        if (s.modal) return; // jangan menimpa modal yang sedang terbuka
        useUiStore.setState({ paletteOpen: !s.paletteOpen });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (openState) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [openState]);

  const hits = useMemo<Hit[]>(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const match = (hay: string) => words.every((w) => hay.includes(w));
    const pages: Hit[] = [
      { key: 'p-beranda', group: tr('Halaman'), label: tr('Beranda'), sub: tr('Hari ini untuk Anda'), run: () => onPage('beranda') },
      { key: 'p-pipeline', group: tr('Halaman'), label: tr('Pipeline'), sub: tr('Daftar prospek'), run: () => onPage('pipeline') },
    ];
    const menu: Hit[] = items.map((i) => ({ key: `m-${i.id}`, group: tr('Menu'), label: <>{i.icon}<span>{i.label}</span></>, sub: i.badge ? `${i.badge}` : undefined, run: i.run }));
    if (!words.length) return [...pages, ...menu.slice(0, 8)];
    const pagesHit = pages.filter((h) => match(norm(`${h.label} ${h.sub}`)));
    const menuHit = items.filter((i) => match(norm(`${i.label} ${i.group} ${i.keys || ''}`))).map((i) => menu.find((m) => m.key === `m-${i.id}`) as Hit);
    const pros = prospects
      .filter((p) => match(norm(`${p.customer} ${p.uraian || ''} ${p.noPo || ''} ${p.se || ''} ${p.cabang || ''}`)))
      .sort((a, b) => num(b.value) - num(a.value))
      .slice(0, 8)
      .map<Hit>((p) => ({
        key: `pr-${p.id}`,
        group: tr('Prospek'),
        label: <><b>{p.customer}</b><span className="muted"> · {p.uraian || '-'}</span></>,
        sub: `${STATUS_META[num(p.status)]?.label || ''} · ${formatRupiah(p.value)}`,
        run: () => {
          onPage('pipeline');
          useUiStore.setState({ deskPanelId: p.id });
        },
      }));
    const cust = customers
      .filter((c) => match(norm(`${c.name} ${c.cabang || ''}`)))
      .slice(0, 6)
      .map<Hit>((c) => ({
        key: `c-${c.id}`,
        group: tr('Customer'),
        label: <b>{c.name}</b>,
        sub: c.cabang || '',
        run: () => {
          useUiStore.setState({ profileCustomer: c.name, profileReturnTo: null });
          useUiStore.getState().openModal('customerProfile');
        },
      }));
    return [...pagesHit, ...menuHit, ...pros, ...cust];
  }, [q, items, prospects, customers, onPage, tr]);

  useEffect(() => {
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!openState) return null;

  const choose = (h: Hit | undefined) => {
    if (!h) return;
    close();
    h.run();
  };

  let lastGroup = '';
  return (
    <div className="dk-pal-bg" onMouseDown={close}>
      <div className="dk-pal" role="dialog" aria-modal="true" aria-label={tr('Cari')} onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          placeholder={tr('Cari customer, prospek, atau menu…')}
          aria-label={tr('Cari')}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); close(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(hits[sel]); }
          }}
        />
        <div className="dk-pal-list" ref={listRef} role="listbox">
          {hits.length === 0 && <div className="dk-pal-empty">{tr('Tidak ditemukan')}</div>}
          {hits.map((h, i) => {
            const head = h.group !== lastGroup ? h.group : null;
            lastGroup = h.group;
            return (
              <div key={h.key}>
                {head && <div className="dk-pal-g">{head}</div>}
                <button type="button" role="option" aria-selected={i === sel} className={`dk-pal-i${i === sel ? ' on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => choose(h)}>
                  <span className="t">{h.label}</span>
                  {h.sub && <small>{h.sub}</small>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="dk-pal-f"><span>↑↓ {tr('pilih')}</span><span>Enter {tr('buka')}</span><span>Esc {tr('tutup')}</span></div>
      </div>
    </div>
  );
}
