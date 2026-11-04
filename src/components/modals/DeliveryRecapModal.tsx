'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { api } from '@/lib/api-client';
import { appendSheet } from '@/lib/exports';
import { buildDeliverySheet, deliveryRows, type DeliveryEvent, type DeliveryRow } from '@/lib/deliveries';
import { formatDateID, todayStr } from '@/lib/format';
import { formatQty, formatTon } from '@/lib/item-flow';
import { canSetFaktur } from '@/lib/roles';
import { getSocket } from '@/lib/socket-client';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { canNow } from '@/hooks/useCan';
import { useT } from '@/store/useLangStore';

type Preset = 'bulan' | 'lalu' | '3bulan' | 'tahun' | 'custom';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function presetRange(p: Preset): [string, string] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (p === 'lalu') return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
  if (p === '3bulan') return [ymd(new Date(y, m - 2, 1)), ymd(now)];
  if (p === 'tahun') return [`${y}-01-01`, ymd(now)];
  return [ymd(new Date(y, m, 1)), ymd(now)];
}

/**
 * Rekap Pengiriman (DO): semua pengiriman yang dicatat lewat
 * "Catat Pengiriman (DO)" dalam satu daftar, sesuai cakupan prospek role
 * (API memakai prospectScopeWhere). Klik baris membuka Status Item & Riwayat.
 */
export function DeliveryRecapModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'deliveryRecap');
  const closeModal = useUiStore((s) => s.closeModal);
  const prospects = useDataStore((s) => s.prospects);
  const toast = useDataStore((s) => s.toast);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const role = useDataStore((s) => s.currentUser?.role);
  // Isi & koreksi faktur: Admin Sales, BM, RM, GM, Admin dengan hak ubah Faktur (sama dengan Antrian Admin).
  const fakturOk = canNow('faktur', 'e') && canSetFaktur(role);

  const [preset, setPreset] = useState<Preset>('bulan');
  const [[from, to], setRange] = useState<[string, string]>(() => presetRange('bulan'));
  const [events, setEvents] = useState<DeliveryEvent[] | null>(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  const [cabang, setCabang] = useState('');
  const [se, setSe] = useState('');
  const [faktur, setFaktur] = useState<'' | 'belum' | 'sudah'>('');
  const [q, setQ] = useState('');
  // Tandai terfaktur massal — dipilih per prospek (status faktur berlaku per prospek).
  const [picked, setPicked] = useState<string[]>([]);
  const [tglFaktur, setTglFaktur] = useState(todayStr());
  const [noFaktur, setNoFaktur] = useState('');
  const [busy, setBusy] = useState(false);
  // Koreksi faktur satu prospek (baris yang sudah terfaktur).
  const [fix, setFix] = useState<{ prospectId: string; rowId: string; tgl: string; no: string; alasan: string } | null>(null);

  useEffect(() => {
    if (!show) return;
    let alive = true;
    setEvents(null);
    setErr('');
    const qs = new URLSearchParams({ type: 'kirim', ...(from ? { from } : {}), ...(to ? { to } : {}) });
    api
      .get<{ events: DeliveryEvent[] }>(`/api/prospect-item-events?${qs}`)
      .then((r) => alive && setEvents(r.events))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : 'Gagal memuat'));
    return () => {
      alive = false;
    };
  }, [show, from, to, tick]);

  // Pengiriman baru / koreksi / pembatalan -> prospek ter-update lewat socket.
  useEffect(() => {
    if (!show) return;
    const s = getSocket();
    let t: ReturnType<typeof setTimeout> | null = null;
    const reload = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => setTick((n) => n + 1), 800);
    };
    s.on('prospect:updated', reload);
    return () => {
      if (t) clearTimeout(t);
      s.off('prospect:updated', reload);
    };
  }, [show]);

  const all = useMemo(() => (events ? deliveryRows(events, prospects) : []), [events, prospects]);
  const cabangOpts = useMemo(() => Array.from(new Set(all.map((r) => r.cabang).filter(Boolean))).sort(), [all]);
  const seOpts = useMemo(() => Array.from(new Set(all.filter((r) => !cabang || r.cabang === cabang).map((r) => r.se).filter(Boolean))).sort(), [all, cabang]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(
      (r) =>
        (!cabang || r.cabang === cabang) &&
        (!se || r.se === se) &&
        (!faktur || (faktur === 'sudah') === r.terfaktur) &&
        (!needle || [r.customer, r.noDo, r.noPo, r.noFaktur, ...r.lines.map((l) => l.label)].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [all, cabang, se, faktur, q]);

  const kpi = useMemo(() => {
    const kg = rows.reduce((s, r) => s + r.kg, 0);
    const belum = rows.filter((r) => !r.terfaktur);
    return {
      n: rows.length,
      cust: new Set(rows.map((r) => r.customer.toUpperCase())).size,
      items: rows.reduce((s, r) => s + r.lines.length, 0),
      kg,
      belum: belum.length,
      belumCust: new Set(belum.map((r) => r.prospectId)).size,
    };
  }, [rows]);

  const cols = fakturOk ? 11 : 9;
  const pickable = (r: DeliveryRow) => fakturOk && !r.terfaktur && r.status === 5;
  const pickIds = useMemo(() => Array.from(new Set(rows.filter(pickable).map((r) => r.prospectId))), [rows, fakturOk]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickedShown = picked.filter((id) => pickIds.includes(id));
  const allPicked = pickIds.length > 0 && pickedShown.length === pickIds.length;
  const togglePick = (id: string, on: boolean) => setPicked((cur) => (on ? Array.from(new Set([...cur, id])) : cur.filter((x) => x !== id)));

  async function markFaktur() {
    if (!pickedShown.length || !tglFaktur) return;
    setBusy(true);
    try {
      const res = await api.post<{ prospects: Prospect[]; skipped: string[] }>('/api/prospects/faktur', { ids: pickedShown, tglFaktur, noFaktur });
      res.prospects.forEach(upsertProspect);
      setPicked([]);
      setNoFaktur('');
      toast(`${res.prospects.length} DO ditandai terfaktur ${formatDateID(tglFaktur)}${res.skipped.length ? ` · ${res.skipped.length} dilewati` : ''}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menandai terfaktur', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveFix(batal: boolean) {
    if (!fix) return;
    if (fix.alasan.trim().length < 3) return toast(tr('Alasan koreksi wajib diisi'), 'error');
    if (!batal && !fix.tgl) return toast(tr('Tanggal faktur wajib diisi'), 'error');
    setBusy(true);
    try {
      const res = await api.patch<{ prospect: Prospect }>('/api/prospects/faktur', batal ? { id: fix.prospectId, batal: true, alasan: fix.alasan } : { id: fix.prospectId, tglFaktur: fix.tgl, noFaktur: fix.no, alasan: fix.alasan });
      upsertProspect(res.prospect);
      setFix(null);
      toast(batal ? `Status terfaktur ${res.prospect.customer} dibatalkan` : `Faktur ${res.prospect.customer} dikoreksi`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menyimpan koreksi', 'error');
    } finally {
      setBusy(false);
    }
  }

  const koreksiDo = (r: DeliveryRow) => useUiStore.setState({ itemFlowCtx: { prospectId: r.prospectId, mode: 'koreksi', eventId: r.id, returnTo: 'deliveryRecap' }, modal: 'itemFlow' });
  const startFix = (r: DeliveryRow) => setFix({ prospectId: r.prospectId, rowId: r.id, tgl: r.tglFaktur || todayStr(), no: r.noFaktur, alasan: '' });

  const pickPreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p));
  };

  const open = (r: DeliveryRow) => useUiStore.setState({ itemFlowCtx: { prospectId: r.prospectId, mode: null, returnTo: 'deliveryRecap' }, modal: 'itemFlow' });

  async function exportExcel() {
    if (!rows.length) return toast(tr('Tidak ada pengiriman untuk diexport'), 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    appendSheet(XLSX, wb, buildDeliverySheet(rows));
    XLSX.writeFile(wb, `Rekap_Pengiriman_${from || 'awal'}_sd_${to || todayStr()}.xlsx`);
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={tr('Rekap Pengiriman (DO)')}
      xwide
      stickyHead
      footer={
        <>
          {canNow('prospek', 'x') && (
            <button type="button" className="btn btn-outline" onClick={() => void exportExcel()} disabled={!events}>
              {tr('Export Excel')}
            </button>
          )}
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            {tr('Tutup')}
          </button>
        </>
      }
    >
      <div className="kpi-grid">
        <div className="kpi won"><div className="label">{tr('Pengiriman (DO)')}</div><div className="value">{kpi.n}</div><div className="foot">{kpi.items} {tr('baris item')}</div></div>
        <div className="kpi aktif"><div className="label">{tr('Customer')}</div><div className="value">{kpi.cust}</div><div className="foot">{tr('menerima barang')}</div></div>
        <div className="kpi rate"><div className="label">{tr('Tonase terkirim')}</div><div className="value">{formatTon(kpi.kg)}</div><div className="foot">{tr('item non-fabrikasi')}</div></div>
        <div className="kpi git"><div className="label">{tr('Belum terfaktur')}</div><div className="value">{kpi.belum}</div><div className="foot">{kpi.belumCust} {tr('prospek')}</div></div>
      </div>

      <div className="toolbar-row dr-filters">
        <select value={preset} onChange={(e) => pickPreset(e.target.value as Preset)} aria-label={tr('Periode')}>
          <option value="bulan">{tr('Bulan ini')}</option>
          <option value="lalu">{tr('Bulan lalu')}</option>
          <option value="3bulan">{tr('3 bulan terakhir')}</option>
          <option value="tahun">{tr('Tahun ini')}</option>
          <option value="custom">{tr('Pilih tanggal…')}</option>
        </select>
        <input type="date" value={from} max={to || undefined} onChange={(e) => { setPreset('custom'); setRange([e.target.value, to]); }} aria-label={tr('Dari tanggal')} />
        <span className="dr-sd">{tr('s/d')}</span>
        <input type="date" value={to} min={from || undefined} onChange={(e) => { setPreset('custom'); setRange([from, e.target.value]); }} aria-label={tr('Sampai tanggal')} />
        {cabangOpts.length > 1 && (
          <select value={cabang} onChange={(e) => { setCabang(e.target.value); setSe(''); }} aria-label={tr('Cabang')}>
            <option value="">{tr('Semua Cabang')}</option>
            {cabangOpts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {seOpts.length > 1 && (
          <select value={se} onChange={(e) => setSe(e.target.value)} aria-label={tr('Sales')}>
            <option value="">{tr('Semua Sales')}</option>
            {seOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select value={faktur} onChange={(e) => setFaktur(e.target.value as '' | 'belum' | 'sudah')} aria-label={tr('Status faktur')}>
          <option value="">{tr('Semua status faktur')}</option>
          <option value="belum">{tr('Belum terfaktur')}</option>
          <option value="sudah">{tr('Sudah terfaktur')}</option>
        </select>
        <input type="text" className="dr-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Cari customer, No. DO, No. PO, material…')} />
      </div>

      {fakturOk && (
        <div className="aq-bar dr-fbar">
          <b>{pickedShown.length} {tr('DO dipilih')}</b>
          <label>{tr('Tgl faktur')} <input type="date" value={tglFaktur} onChange={(e) => setTglFaktur(e.target.value)} /></label>
          <label>{tr('No faktur')} <input type="text" value={noFaktur} onChange={(e) => setNoFaktur(e.target.value)} placeholder={tr('opsional — satu faktur gabungan')} style={{ width: 220 }} /></label>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !pickedShown.length || !tglFaktur} onClick={() => void markFaktur()}>
            {busy ? tr('Menyimpan…') : `${tr('Tandai terfaktur')} (${pickedShown.length})`}
          </button>
        </div>
      )}

      <div className="table-wrap" style={{ borderTop: 'none' }}>
        <table className="simple-table dr-table">
          <colgroup>
            {fakturOk && <col style={{ width: 34 }} />}
            <col style={{ width: '9%' }} /><col style={{ width: '12%' }} /><col style={{ width: '16%' }} /><col style={{ width: '6%' }} /><col style={{ width: '5%' }} />
            <col style={{ width: '9%' }} /><col /><col style={{ width: '8%' }} /><col style={{ width: '9%' }} />
            {fakturOk && <col style={{ width: 92 }} />}
          </colgroup>
          <thead>
            <tr>
              {fakturOk && (
                <th>
                  <input type="checkbox" aria-label={tr('Pilih semua')} checked={allPicked} disabled={!pickIds.length} onChange={(e) => setPicked(e.target.checked ? pickIds : [])} />
                </th>
              )}
              <th>{tr('Tgl kirim')}</th>
              <th>{tr('No. DO')}</th>
              <th>{tr('Customer')}</th>
              <th>{tr('Cabang')}</th>
              <th>SE</th>
              <th>{tr('No. PO')}</th>
              <th>{tr('Material dikirim')}</th>
              <th style={{ textAlign: 'right' }}>{tr('Berat')}</th>
              <th>{tr('Faktur')}</th>
              {fakturOk && <th />}
            </tr>
          </thead>
          <tbody>
            {err && <tr><td colSpan={cols} className="field-note">{err}</td></tr>}
            {!err && !events && <tr><td colSpan={cols} className="field-note">{tr('Memuat…')}</td></tr>}
            {events && rows.length === 0 && (
              <tr><td colSpan={cols} className="field-note">{all.length ? tr('Tidak ada pengiriman yang cocok dengan filter.') : tr('Belum ada pengiriman yang dicatat pada periode ini.')}</td></tr>
            )}
            {rows.map((r) => (
              <Fragment key={r.id}>
              <tr className={`dr-row${pickedShown.includes(r.prospectId) ? ' picked' : ''}`} onClick={() => open(r)} title={tr('Buka Status Item & Riwayat')}>
                {fakturOk && (
                  <td onClick={(e) => e.stopPropagation()}>
                    {pickable(r) && (
                      <input type="checkbox" aria-label={`${tr('Pilih')} ${r.noDo || r.customer}`} checked={pickedShown.includes(r.prospectId)} onChange={(e) => togglePick(r.prospectId, e.target.checked)} />
                    )}
                  </td>
                )}
                <td style={{ whiteSpace: 'nowrap' }}>{formatDateID(r.tgl)}</td>
                <td>
                  <div className="mono">{r.noDo || '-'}</div>
                  {r.actorName && <div className="dr-by">{tr('oleh')} {r.actorName}</div>}
                </td>
                <td style={{ fontWeight: 600 }}>{r.customer}</td>
                <td>{r.cabang || '-'}</td>
                <td>{r.se || '-'}</td>
                <td className="mono">{r.noPo || '-'}</td>
                <td>
                  <ul className="dr-lines">
                    {r.lines.map((l) => (
                      <li key={l.itemId}>
                        <span>{l.label}</span>{' '}
                        <b className="mono">{formatQty(l.qty)} {l.satuan}</b>
                        {l.sisa != null && <span className={`dr-sisa ${l.sisa > 0 ? 'open' : ''}`}>{l.sisa > 0 ? `${tr('sisa')} ${formatQty(l.sisa)}` : tr('lunas')}</span>}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.kg ? `${formatQty(Math.round(r.kg))} kg` : '-'}</td>
                <td>
                  {r.terfaktur ? (
                    <span className="badge green" title={r.tglFaktur ? formatDateID(r.tglFaktur) : ''}>{r.noFaktur || tr('Sudah')}</span>
                  ) : (
                    <span className="badge amber">{tr('Belum')}</span>
                  )}
                  {r.terfaktur && r.tglFaktur && <div className="dr-by">{formatDateID(r.tglFaktur)}</div>}
                </td>
                {fakturOk && (
                  <td onClick={(e) => e.stopPropagation()}>
                    {r.terfaktur ? (
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => (fix?.rowId === r.id ? setFix(null) : startFix(r))} title={tr('Ubah tanggal / nomor faktur atau batalkan status terfaktur')}>
                        {tr('Koreksi')}
                      </button>
                    ) : (
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => koreksiDo(r)} title={tr('Koreksi qty, No. DO atau tanggal kirim, atau batalkan pengiriman ini')}>
                        {tr('Koreksi')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
              {fix?.rowId === r.id && (
                <tr className="dr-fix-row">
                  <td colSpan={cols}>
                    <div className="dr-fix">
                      <b>{tr('Koreksi faktur')} — {r.customer}{r.noPo ? ` · PO ${r.noPo}` : ''}</b>
                      <label>{tr('Tgl faktur')} <input type="date" value={fix.tgl} onChange={(e) => setFix({ ...fix, tgl: e.target.value })} /></label>
                      <label>{tr('No faktur')} <input type="text" value={fix.no} onChange={(e) => setFix({ ...fix, no: e.target.value })} style={{ width: 180 }} /></label>
                      <label className="dr-fix-why">{tr('Alasan')} <span style={{ color: 'var(--rust-500)' }}>*</span> <input type="text" value={fix.alasan} onChange={(e) => setFix({ ...fix, alasan: e.target.value })} placeholder={tr('wajib — cth. salah input nomor faktur')} /></label>
                      <div className="dr-fix-act">
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveFix(false)}>{tr('Simpan koreksi')}</button>
                        <button type="button" className="btn btn-sm btn-danger-soft" disabled={busy} onClick={() => void saveFix(true)} title={tr('Status kembali ke belum terfaktur; koreksi pengiriman terbuka lagi')}>{tr('Batalkan faktur')}</button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setFix(null)}>{tr('Tutup')}</button>
                      </div>
                    </div>
                    <div className="field-note">{tr('Status faktur berlaku per prospek — koreksi ini berlaku untuk semua DO prospek tersebut.')}</div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="field-note" style={{ marginTop: 6 }}>
        {tr('Tanggal mengikuti tanggal kirim yang diisi saat Catat Pengiriman (DO). Pengiriman yang dibatalkan tidak ditampilkan; koreksi langsung memperbarui baris yang sama. Status faktur berlaku per prospek. Klik baris untuk membuka riwayat item.')}
        {fakturOk && <> {tr('Koreksi pada DO yang belum terfaktur membuka koreksi pengiriman (qty, No. DO, tanggal, atau batalkan); pada DO yang sudah terfaktur membuka koreksi faktur.')}</>}
      </div>
    </Modal>
  );
}
