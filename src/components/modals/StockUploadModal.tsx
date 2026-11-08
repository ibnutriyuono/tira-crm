'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { formatDateID, formatDateTimeID } from '@/lib/format';
import { FSV_META, fmtQty, locLabel, unitShort, type StockMeta, type StockRow } from '@/lib/stock';
import { refreshStock } from '@/hooks/useStock';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';

type FullRow = StockRow & { hpp: number | null; size: string | null };
const rp = (n: number | null) => (n == null ? '–' : n.toLocaleString('id-ID', { maximumFractionDigits: 0 }));

/**
 * Data Stok Gudang (Admin): unggah manual Inventory Value Report dari Sage —
 * menggantikan seluruh data stok sebelumnya — sampai integrasi Sage siap.
 * Daftar di bawahnya memperlihatkan HPP, saran harga, kondisi dan posisi stok
 * persis seperti yang dipakai untuk saran harga di form prospek.
 */
export function StockUploadModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'stockUpload');
  const closeModal = useUiStore((s) => s.closeModal);
  const toast = useDataStore((s) => s.toast);
  const [meta, setMeta] = useState<StockMeta | null>(null);
  const [marginPct, setMarginPct] = useState(35);
  const [rows, setRows] = useState<FullRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [onlyMatch, setOnlyMatch] = useState(true);
  const [summary, setSummary] = useState<{ rows: number; matchable: number; noHpp: number; locations: string[]; sheet: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api
      .get<{ meta: StockMeta; marginPct: number; items: FullRow[] }>('/api/stock?all=1')
      .then((r) => {
        setMeta(r.meta);
        setMarginPct(r.marginPct);
        setRows(r.items);
      })
      .catch((e) => toast(e instanceof Error ? e.message : 'Gagal memuat', 'error'));
  }, [toast]);
  useEffect(() => {
    if (show) load();
  }, [show, load]);

  async function upload(f: File) {
    setBusy(true);
    setSummary(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch('/api/stock', { method: 'POST', body: fd, credentials: 'same-origin' });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || 'Gagal mengunggah');
      setSummary(b.summary);
      toast(`${tr('Data stok diperbarui')}: ${b.summary.rows} item`, 'success');
      refreshStock();
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengunggah', 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (rows || []).filter((r) => (!onlyMatch || r.gradeKey) && (!ql || `${r.itemNo} ${r.description} ${Object.keys(r.locations).join(' ')}`.toLowerCase().includes(ql)));
  }, [rows, q, onlyMatch]);

  return (
    <Modal show={show} onClose={closeModal} title={tr('Data Stok Gudang (Sage)')} xwide footer={<button type="button" className="btn btn-outline" onClick={closeModal}>{tr('Tutup')}</button>}>
      <div className="stk-up">
        <div>
          <div className="stk-up-meta">
            {meta?.count ? (
              <>
                <b>{meta.count.toLocaleString('id-ID')} {tr('item')}</b>
                {meta.asOf && <span>{tr('posisi per')} {formatDateID(meta.asOf)}</span>}
                <span className="muted">{meta.fileName} · {tr('diunggah')} {meta.uploadedBy} {meta.uploadedAt ? formatDateTimeID(meta.uploadedAt) : ''}</span>
              </>
            ) : (
              <span className="muted">{tr('Belum ada data stok.')}</span>
            )}
          </div>
          <div className="field-note" style={{ margin: '4px 0 0' }}>
            {tr('Format: Inventory Value Report Steel Division dari Sage (kolom Item No, Line, Description, Size, Unit, Quantity, Ext. Cost, /kg, FSV, lokasi gudang). Unggahan baru menggantikan seluruh data lama.')}{' '}
            {tr('Saran harga jual minimal = HPP ÷ (1 −')} {marginPct}%{tr(') — margin 35% berarti HPP ÷ 0,65. Ubah di Batas Waktu & Margin. Sales hanya melihat saran harga, tidak melihat HPP.')}
          </div>
        </div>
        <label className={`btn btn-primary${busy ? ' disabled' : ''}`}>
          {busy ? tr('Mengunggah…') : tr('Unggah file stok (.xlsx)')}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </label>
      </div>
      {summary && (
        <div className="import-summary">
          {tr('Terbaca')} <b>{summary.rows}</b> {tr('item dari sheet')} “{summary.sheet}” · <b>{summary.matchable}</b> {tr('item baja terbaca grade & ukurannya (dipakai untuk saran harga)')} · {summary.noHpp} {tr('item tanpa HPP')} · {summary.locations.length} {tr('lokasi gudang')}
        </div>
      )}
      <div className="toolbar-row">
        <input type="search" className="search-grow" placeholder={tr('Cari item no / uraian / lokasi')} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="chk-inline"><input type="checkbox" checked={onlyMatch} onChange={(e) => setOnlyMatch(e.target.checked)} /> {tr('Hanya baja yang terbaca grade-nya')}</label>
        <span className="muted">{list.length.toLocaleString('id-ID')} {tr('baris')}</span>
      </div>
      <div className="table-wrap">
        <table className="simple-table stk-table">
          <thead>
            <tr>
              <th>{tr('Item No')}</th><th>{tr('Uraian')}</th><th>{tr('Terbaca')}</th><th className="r">{tr('Qty')}</th><th className="r">HPP</th><th className="r">{tr('Saran min.')}</th><th>{tr('Kondisi')}</th><th>{tr('Posisi stok')}</th>
            </tr>
          </thead>
          <tbody>
            {!rows && <tr><td colSpan={8} className="text-muted">{tr('Memuat…')}</td></tr>}
            {rows && list.length === 0 && <tr><td colSpan={8} className="text-muted">{tr('Tidak ada data.')}</td></tr>}
            {list.slice(0, 300).map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.itemNo}</td>
                <td>{r.description.replace(/\s+/g, ' ')}</td>
                <td className="muted">{r.gradeKey ? `${r.grade} · ${r.bentuk || '-'}${r.dim.tebal ? ` T${r.dim.tebal}` : ''}${r.dim.dia ? ` Ø${r.dim.dia}` : ''}` : '–'}</td>
                <td className="r mono">{fmtQty(r.qty)} {unitShort(r.unit)}</td>
                <td className="r mono">{rp(r.hpp)}</td>
                <td className="r mono">{rp(r.saran)}</td>
                <td>{r.fsv && FSV_META[r.fsv] ? <span className={`badge ${FSV_META[r.fsv].cls}`}>{FSV_META[r.fsv].short}</span> : '–'}{r.ageDays != null && <span className="muted"> {fmtQty(r.ageDays)} hr</span>}</td>
                <td className="stk-locs-cell">{Object.entries(r.locations).map(([l, n]) => `${locLabel(l)} ${fmtQty(n)}`).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > 300 && <div className="field-note">{tr('Menampilkan 300 baris pertama — persempit dengan pencarian.')}</div>}
    </Modal>
  );
}
