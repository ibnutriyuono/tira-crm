'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { num } from '@/lib/format';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import { canNow } from '@/hooks/useCan';
import { pct, rp, tgl } from './shared';

interface Row {
  kontrak: { id: string; nomor: string; jenis: string; grupNama: string; tglMulai: string; tglAkhir: string; berlaku: boolean };
  items: { itemId: string; label: string; kontrakItemId: string | null; dimId: string | null; rule: string | null; hargaKontrak: number | null; harga: number | null; beda: number | null; linked: 'ini' | 'lain' | null }[];
}

/**
 * Panel prospek: kontrak harga yang berlaku untuk customer & cabang prospek ini,
 * kecocokan per item, tombol hubungkan PO ke kontrak, dan "Jadikan kontrak"
 * untuk prospek tender yang menang (tahap PO / Kontrak).
 */
export function ProspectKontrak({ p }: { p: Prospect }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const me = useDataStore((s) => s.currentUser);
  const [rows, setRows] = useState<Row[]>([]);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const st = num(p.status);
  const canView = canNow('kontrak', 'v');
  const canEdit = canView && canNow('kontrak', 'e') && (me?.role === 'salesadmin' || me?.role === 'admin');
  const sig = `${p.id}|${st}|${p.tglPO || ''}|${JSON.stringify(p.materials || []).length}`;

  useEffect(() => {
    if (!canView || st < 1 || st > 5) return;
    let alive = true;
    api.get<{ kontrak: Row[] }>(`/api/kontrak/prospect?id=${p.id}`).then((r) => alive && setRows(r.kontrak)).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [sig, tick, canView, st, p.id]);

  const won = st === 4 || st === 5;
  if (!canView || (!rows.length && !(canEdit && st === 4))) return null;

  async function link(r: Row) {
    const todo = r.items.filter((i) => i.kontrakItemId && !i.linked);
    setBusy(true);
    try {
      const res = await api.post<{ linked: number }>(`/api/kontrak/${r.kontrak.id}/link`, { links: todo.map((i) => ({ prospectId: p.id, itemId: i.itemId, kontrakItemId: i.kontrakItemId, dimId: i.dimId })) });
      toast(`${res.linked} ${tr('item terhubung ke')} ${r.kontrak.nomor}`, 'success');
      setTick((t) => t + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal', 'error');
    } finally {
      setBusy(false);
    }
  }
  const openK = (id: string) => { useUiStore.setState({ kontrakCtx: { id, view: 'detail' } }); useUiStore.getState().openModal('kontrak'); };

  return (
    <section className="dk-sec kt-pk">
      <h4>{tr('Kontrak harga')}</h4>
      {rows.map((r) => {
        const match = r.items.filter((i) => i.kontrakItemId);
        const todo = match.filter((i) => !i.linked);
        return (
          <div key={r.kontrak.id} className={`kt-pk-box${r.kontrak.berlaku ? '' : ' off'}`}>
            <div className="kt-pk-h">
              <button type="button" className="link-btn mono" onClick={() => openK(r.kontrak.id)}><b>{r.kontrak.nomor}</b></button>
              <span className="muted">{r.kontrak.grupNama} · s.d. {tgl(r.kontrak.tglAkhir)}</span>
              {!r.kontrak.berlaku && <span className="badge slate">{tr('di luar periode tgl PO')}</span>}
            </div>
            {match.length === 0 ? (
              <div className="kt-sub">{tr('Tidak ada item prospek ini yang termasuk kontrak.')}</div>
            ) : (
              <ul className="kt-pk-list">
                {r.items.map((i) => (
                  <li key={i.itemId} className={i.kontrakItemId ? '' : 'muted'}>
                    <span>{i.label}</span>
                    {i.kontrakItemId ? (
                      <small>
                        {i.rule}
                        {i.hargaKontrak != null && <> · {tr('kontrak')} {rp(i.hargaKontrak)}{i.beda != null && Math.abs(i.beda) > 0.3 ? <b className="bad"> ({tr('PO')} {i.beda > 0 ? '+' : ''}{pct(i.beda)})</b> : <b className="ok"> ✓</b>}</>}
                        {i.linked === 'ini' && <b className="ok"> · {tr('terhubung')}</b>}
                        {i.linked === 'lain' && <b> · {tr('terhubung ke kontrak lain')}</b>}
                      </small>
                    ) : <small>{tr('di luar kontrak')}</small>}
                  </li>
                ))}
              </ul>
            )}
            {!won && match.length > 0 && <div className="kt-sub">{tr('Pakai harga kontrak di Surat Penawaran — item kontrak tidak perlu RFQ harga ulang.')}</div>}
            {won && canEdit && todo.length > 0 && r.kontrak.berlaku && <button type="button" className="btn btn-plan btn-sm" disabled={busy} onClick={() => void link(r)}>{tr('Hubungkan')} {todo.length} {tr('item ke')} {r.kontrak.nomor}</button>}
          </div>
        );
      })}
      {canEdit && st === 4 && (
        <button type="button" className="btn btn-outline btn-sm" onClick={() => { useUiStore.setState({ kontrakCtx: { view: 'form', prospectId: p.id } }); useUiStore.getState().openModal('kontrak'); }}>
          {tr('Jadikan kontrak')}
        </button>
      )}
    </section>
  );
}
