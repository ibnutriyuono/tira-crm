'use client';

import { useMemo, useState } from 'react';
import { getPrimaryPic, num } from '@/lib/format';
import { normalizeCustomerName } from '@/lib/kam';
import { splitPhone } from '@/lib/activity-contact';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';

/** Nomor untuk wa.me: 08xx → 628xx. */
function waNumber(v: string | null | undefined): string {
  const { main } = splitPhone(v);
  return main.startsWith('0') ? `62${main.slice(1)}` : main;
}

/**
 * Customer (HP): cari, ringkasan prospek, telepon / WhatsApp / petunjuk arah
 * (Google Maps dari alamat), profil, catat kunjungan. Urutan "terdekat"
 * menyusul setelah lokasi customer tersimpan (butuh HTTPS untuk GPS).
 */
export function MobileCustomers({ onVisit }: { onVisit: (customer: string) => void }) {
  const tr = useT();
  const customers = useDataStore((s) => s.customers);
  const prospects = useDataStore((s) => s.prospects);
  const openModal = useUiStore((s) => s.openModal);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState('');

  const stat = useMemo(() => {
    const m = new Map<string, { aktif: number; nilai: number; lastPo: string }>();
    prospects.forEach((p) => {
      const k = normalizeCustomerName(p.customer);
      const x = m.get(k) || { aktif: 0, nilai: 0, lastPo: '' };
      const st = num(p.status);
      if (st >= 1 && st <= 3) {
        x.aktif++;
        x.nilai += num(p.value);
      }
      if ((st === 4 || st === 5) && (p.tglPO || '') > x.lastPo) x.lastPo = p.tglPO || '';
      m.set(k, x);
    });
    return m;
  }, [prospects]);

  const ql = q.trim().toLowerCase();
  const list = customers
    .filter((c) => !ql || [c.name, c.address, c.pic].some((x) => (x || '').toLowerCase().includes(ql)))
    .map((c) => ({ c, s: stat.get(normalizeCustomerName(c.name)) || { aktif: 0, nilai: 0, lastPo: '' } }))
    .sort((a, b) => b.s.aktif - a.s.aktif || a.c.name.localeCompare(b.c.name));

  return (
    <div className="mb-page">
      <input className="mb-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Cari customer / alamat / PIC')} />
      <div className="mb-sum muted">{list.length} {tr('customer')}</div>
      {list.slice(0, 120).map(({ c, s }) => {
        const pic = getPrimaryPic(c);
        const phone = pic?.phone || c.phone || '';
        const on = open === c.id;
        return (
          <article key={c.id} className={`mb-card mb-cust ${on ? 'on' : ''}`}>
            <button type="button" className="mb-deal-t" onClick={() => setOpen(on ? '' : c.id)} aria-expanded={on}>
              <b>{c.name}</b>
              <small className="muted">{[pic?.nama, c.address].filter(Boolean).join(' · ') || '-'}</small>
              <span className="mb-row">
                <small>{s.aktif ? `${s.aktif} ${tr('prospek aktif')}` : tr('tidak ada prospek aktif')}</small>
                <small className="muted">{s.lastPo ? `${tr('PO terakhir')} ${s.lastPo}` : ''}</small>
              </span>
            </button>
            {on && (
              <div className="mb-item-a mb-wrap">
                {phone && <a className="mb-btn" href={`tel:${splitPhone(phone).main}`}>{tr('Telepon')}</a>}
                {phone && <a className="mb-btn" href={`https://wa.me/${waNumber(phone)}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                {c.address && <a className="mb-btn" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.name} ${c.address}`)}`} target="_blank" rel="noreferrer">{tr('Petunjuk arah')}</a>}
                <button type="button" className="mb-btn" onClick={() => { useUiStore.setState({ profileCustomer: c.name, profileReturnTo: null }); openModal('customerProfile'); }}>{tr('Profil')}</button>
                <button type="button" className="mb-btn pri" onClick={() => onVisit(c.name)}>{tr('Catat kunjungan')}</button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
