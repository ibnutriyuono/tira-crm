'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { SPECIAL_SEGMENTS, type SegmentDef } from '@/lib/customer-segments';
import { setSegmentsLocal, useSegments } from '@/hooks/useSegments';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { IconPlus, IconTrash } from './icons';

interface Row {
  key: string;
  orig: string | null;
  name: string;
  subs: string;
  origSubs: string[];
  active: boolean;
}

let seq = 0;
const toRows = (list: SegmentDef[]): Row[] =>
  list.filter((s) => !SPECIAL_SEGMENTS.includes(s.name)).map((s) => ({ key: `s${seq++}`, orig: s.name, name: s.name, subs: s.subs.join('\n'), origSubs: s.subs, active: s.active !== false }));

/**
 * Kelola Segmen (Admin): tambah / ganti nama / nonaktifkan segmen dan
 * sub-segmennya. Ganti nama ikut memperbarui customer yang sudah memakainya.
 * Supplier & Others tetap ada dan tidak bisa diubah.
 */
export function SegmentsEditor({ onClose, usage }: { onClose: () => void; usage: Map<string, number> }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const refetch = useDataStore((s) => s.refetchCustomers);
  const { segments } = useSegments();
  const [rows, setRows] = useState<Row[]>(() => toRows(segments));
  const [busy, setBusy] = useState(false);
  const upd = (key: string, patch: Partial<Row>) => setRows((l) => l.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    const list: SegmentDef[] = rows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), subs: r.subs.split('\n').map((x) => x.trim()).filter(Boolean), active: r.active }));
    const segRen = rows.filter((r) => r.orig && r.name.trim() && r.orig !== r.name.trim()).map((r) => [r.orig, r.name.trim()]);
    // Sub-segmen yang diganti nama: posisi baris sama, teks berbeda.
    const subRen: [string, string, string][] = [];
    rows.forEach((r) => {
      const now = r.subs.split('\n').map((x) => x.trim()).filter(Boolean);
      r.origSubs.forEach((o, i) => {
        if (now[i] && now[i] !== o && !r.origSubs.includes(now[i]) && !now.includes(o)) subRen.push([r.name.trim(), o, now[i]]);
      });
    });
    setBusy(true);
    try {
      const res = await api.put<{ segments: SegmentDef[]; moved: number }>('/api/customer-segments', { segments: list, renames: { segmen: segRen, sub: subRen } });
      setSegmentsLocal(res.segments);
      if (res.moved) await refetch();
      toast(`Daftar segmen disimpan${res.moved ? ` · ${res.moved} customer ikut diperbarui` : ''}`, 'success');
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan segmen', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="seg-ed">
      <div className="seg-ed-h">
        <b>{tr('Kelola Segmen')}</b>
        <span className="field-note" style={{ margin: 0 }}>
          {tr('Satu sub-segmen per baris. Ganti nama ikut memperbarui customer yang memakainya. Nonaktif = tidak bisa dipilih lagi, customer lama tetap. Supplier (sub = segmen yang dipasok) dan Others selalu tersedia.')}
        </span>
      </div>
      <div className="seg-ed-grid">
        {rows.map((r) => {
          const n = usage.get(r.orig || '') || 0;
          return (
            <div key={r.key} className={`seg-ed-card${r.active ? '' : ' off'}`}>
              <div className="seg-ed-top">
                <input value={r.name} onChange={(e) => upd(r.key, { name: e.target.value })} placeholder={tr('Nama segmen')} aria-label={tr('Nama segmen')} />
                <label className="seg-ed-act">
                  <input type="checkbox" checked={r.active} onChange={(e) => upd(r.key, { active: e.target.checked })} /> {tr('Aktif')}
                </label>
                <button
                  type="button"
                  className="icon-btn danger"
                  disabled={n > 0}
                  title={n > 0 ? `${n} customer memakai segmen ini — nonaktifkan saja` : tr('Hapus segmen')}
                  onClick={() => setRows((l) => l.filter((x) => x.key !== r.key))}
                >
                  <IconTrash />
                </button>
              </div>
              <textarea rows={4} value={r.subs} onChange={(e) => upd(r.key, { subs: e.target.value })} placeholder={tr('Sub-segmen, satu per baris')} aria-label={tr('Sub-segmen')} />
              <small className="field-note" style={{ margin: 0 }}>{n} {tr('customer')}</small>
            </div>
          );
        })}
        <button type="button" className="seg-ed-add" onClick={() => setRows((l) => [...l, { key: `s${seq++}`, orig: null, name: '', subs: '', origSubs: [], active: true }])}>
          <IconPlus /> {tr('Tambah segmen')}
        </button>
      </div>
      <div className="seg-ed-f">
        <span className="field-note" style={{ margin: 0 }}>
          {tr('Tetap')}: <b>Supplier</b> · {usage.get('Supplier') || 0} {tr('customer')} — <b>Others</b> · {usage.get('Others') || 0} {tr('customer')}
        </span>
        <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>{tr('Batal')}</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{tr('Simpan daftar segmen')}</button>
      </div>
    </div>
  );
}
