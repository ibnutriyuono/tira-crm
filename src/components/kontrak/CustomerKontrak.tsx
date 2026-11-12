'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { cabUp, customerInKontrak, dayDiffStr, kontrakState, type Kontrak } from '@/lib/kontrak';
import { sameCompany } from '@/lib/customer-names';
import { todayStr } from '@/lib/format';
import type { Customer, CustomerGroup } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import { canNow } from '@/hooks/useCan';

export type KontrakLite = Pick<Kontrak, 'id' | 'nomor' | 'jenis' | 'grupNama' | 'groupId' | 'entitas' | 'cabangs' | 'status' | 'tglMulai' | 'tglAkhir'>;

/** Ringkasan kontrak untuk badge di Kelola Customer / Profil (dimuat saat modal dibuka). */
export function useKontrakLite(active: boolean): { list: KontrakLite[]; reload: () => void } {
  const [list, setList] = useState<KontrakLite[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active || !canNow('kontrak', 'v')) return;
    let alive = true;
    api.get<{ kontrak: KontrakLite[] }>('/api/kontrak?lite=1').then((r) => alive && setList(r.kontrak)).catch(() => {});
    return () => { alive = false; };
  }, [active, tick]);
  return { list, reload: () => setTick((t) => t + 1) };
}

/** Kontrak milik customer ini (aktif / berjalan dulu, lalu yang habis terbaru). */
export function kontrakOf(list: KontrakLite[], name: string): KontrakLite[] {
  const today = todayStr();
  const rank = (k: KontrakLite) => { const s = kontrakState(k, today); return s === 'akanHabis' ? 0 : s === 'aktif' ? 1 : s === 'menunggu' || s === 'belum' ? 2 : s === 'draft' ? 3 : 4; };
  return list.filter((k) => customerInKontrak(k, name)).sort((a, b) => rank(a) - rank(b) || b.tglAkhir.localeCompare(a.tglAkhir));
}

const groupOf = (groups: CustomerGroup[], name: string) => groups.find((g) => [g.name, ...(g.entities || [])].some((e) => e && sameCompany(e, name)));

/** Sel "Kontrak" di Kelola Customer: badge kontrak, atau tombol Kontrak ▾ (tautkan / buat baru) untuk Admin Sales. */
export function KontrakCell({ c, list, onChanged }: { c: Customer; list: KontrakLite[]; onChanged: () => void }) {
  const tr = useT();
  const groups = useDataStore((s) => s.customerGroups);
  const me = useDataStore((s) => s.currentUser);
  const toast = useDataStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<KontrakLite | null>(null);
  const [addCab, setAddCab] = useState(true);
  const [busy, setBusy] = useState(false);
  const today = todayStr();
  const mine = kontrakOf(list, c.name);
  const cur = mine[0];
  const st = cur ? kontrakState(cur, today) : null;
  const canEdit = (me?.role === 'salesadmin' || me?.role === 'admin') && canNow('kontrak', 'e');
  const g = groupOf(groups, c.name);
  const opts = list.filter((k) => ['aktif', 'menunggu', 'draft'].includes(k.status) && !customerInKontrak(k, c.name) && (g ? k.groupId === g.id || sameCompany(k.grupNama, g.name) : false) && (me?.role === 'admin' || k.cabangs.includes(cabUp(me?.cabang)) ));
  const show = (id: string, view: 'detail' | 'cari' = 'detail') => { useUiStore.setState({ kontrakCtx: { id, view, returnTo: 'customers' } }); useUiStore.getState().openModal('kontrak'); };

  async function tautkan() {
    if (!pick) return;
    setBusy(true);
    try {
      await api.post(`/api/kontrak/${pick.id}/entitas`, { customer: c.name, cabang: c.cabang, tambahCabang: addCab });
      toast(`${c.name} ${tr('ditautkan ke')} ${pick.nomor}`, 'success');
      onChanged();
      show(pick.id, pick.status === 'aktif' ? 'cari' : 'detail');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kt-cell">
      {cur && st && (
        <>
          <button type="button" className={`badge ${st === 'akanHabis' ? 'amber' : st === 'aktif' ? 'green' : st === 'habis' || st === 'batal' ? 'slate' : 'steel'} kt-badge`} onClick={() => show(cur.id)} title={tr('Buka kontrak')}>
            {cur.nomor} · {st === 'aktif' || st === 'akanHabis' ? `${dayDiffStr(today, cur.tglAkhir)} ${tr('hari')}` : st === 'habis' ? tr('habis') : st === 'menunggu' ? tr('menunggu') : st}
          </button>
          {mine.length > 1 && <span className="kt-sub"> +{mine.length - 1}</span>}
        </>
      )}
      {!cur && g && list.some((k) => (k.groupId === g.id || sameCompany(k.grupNama, g.name)) && k.status === 'aktif') && <div className="kt-sub warn">{tr('Grupnya punya kontrak aktif, entitas ini belum tercantum')}</div>}
      {canEdit && (!cur || st === 'habis' || st === 'batal') && (
        <button type="button" className={`btn btn-sm ${opts.length ? 'btn-plan' : 'btn-outline'}`} aria-expanded={open} onClick={() => { setOpen((v) => !v); setPick(null); }}>{tr('Kontrak')} ▾</button>
      )}
      {open && (
        <div className="kt-pop">
          {!pick ? (
            <>
              <div className="kt-pop-h">{tr('Tautkan ke kontrak yang ada')}</div>
              {opts.length === 0 && <div className="kt-pop-i muted">{g ? tr('Grup customer ini belum punya kontrak aktif di cabang Anda.') : tr('Customer ini belum masuk grup customer.')}</div>}
              {opts.map((k) => (
                <button key={k.id} type="button" className="kt-pop-i" onClick={() => { setPick(k); setAddCab(!k.cabangs.includes(cabUp(c.cabang))); }}>
                  <b className="mono">{k.nomor}</b> · {k.grupNama}<div className="kt-sub">{k.status} · s.d. {k.tglAkhir} · {k.cabangs.join(', ')}</div>
                </button>
              ))}
              <button type="button" className="kt-pop-i kt-pop-new" onClick={() => { setOpen(false); useUiStore.setState({ kontrakCtx: { view: 'form', customer: c.name, cabang: c.cabang, returnTo: 'customers' } }); useUiStore.getState().openModal('kontrak'); }}>+ {tr('Buat kontrak baru untuk customer ini')}</button>
            </>
          ) : (
            <div className="kt-pop-confirm">
              <b>{tr('Tautkan')} {c.name} {tr('ke')} {pick.nomor}</b>
              <label><input type="checkbox" checked readOnly /> {tr('Tambahkan sebagai entitas kontrak')}{g ? ` (${g.name})` : ''}</label>
              {c.cabang && !pick.cabangs.includes(cabUp(c.cabang)) && <label><input type="checkbox" checked={addCab} onChange={(e) => setAddCab(e.target.checked)} /> {tr('Tambahkan cabang')} <b>{cabUp(c.cabang)}</b> {tr('ke cabang berlaku')}</label>}
              <div className="kt-sub">{tr('Dicatat sebagai adendum cakupan. Harga & komitmen tidak berubah, jadi tidak perlu persetujuan diskon ulang. Setelah itu Cari realisasi dibuka untuk PO lama entitas ini.')}</div>
              <div className="row-actions">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setPick(null)}>{tr('Batal')}</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void tautkan()}>{tr('Tautkan & cari realisasi')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
