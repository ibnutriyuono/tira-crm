'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatQty, formatTon } from '@/lib/item-flow';
import {
  ETA_FLAG_META,
  ETA_STAT_KEYS,
  ETA_STAT_META,
  STOK_META,
  etaFlag,
  etaLogText,
  fmtYmd,
  type EtaFlag,
  type EtaStat,
} from '@/lib/item-stock';
import type { PoIndentGroup, PoIndentItem } from '@/lib/po-indent';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { IconDownload, IconSearch } from '../icons';
import { PurchIssueModal } from './PurchIssueModal';

type Key = string; // `${prospectId}|${itemId}`
const keyOf = (g: PoIndentGroup, it: PoIndentItem): Key => `${g.prospectId}|${it.itemId}`;

/**
 * Purchasing › PO Indent: item PO/DO berkondisi Indent / Import yang belum
 * terkirim penuh. Isi target kedatangan & status barang per item atau
 * beberapa item sekaligus. Tanpa harga / nilai Rupiah.
 */
export function PoIndentTab({ readOnly }: { readOnly: boolean }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const prospects = useDataStore((s) => s.prospects);
  const [groups, setGroups] = useState<PoIndentGroup[] | null>(null);
  const [today, setToday] = useState('');
  const [q, setQ] = useState('');
  const [cabang, setCabang] = useState('');
  const [kond, setKond] = useState('');
  const [stat, setStat] = useState('');
  const [flag, setFlag] = useState<EtaFlag | ''>('');
  const [sel, setSel] = useState<Set<Key>>(new Set());
  const [bulkEta, setBulkEta] = useState('');
  const [bulkStat, setBulkStat] = useState('');
  const [bulkNote, setBulkNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /** Edit satu baris yang perlu alasan (target dimundurkan). */
  const [pend, setPend] = useState<{ key: Key; eta?: string; stat?: EtaStat; note: string } | null>(null);
  const [hist, setHist] = useState<{ g: PoIndentGroup; it: PoIndentItem } | null>(null);
  const [issue, setIssue] = useState<PoIndentGroup | null>(null);
  const role = useDataStore((s) => s.currentUser?.role);
  const canIssue = role === 'purchasing' || role === 'purchasing05' || role === 'admin';

  const load = useCallback(() => {
    api
      .get<{ groups: PoIndentGroup[]; today: string }>('/api/po-indent')
      .then((r) => {
        setGroups(r.groups);
        setToday(r.today);
      })
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);
  // Muat ulang saat ada perubahan prospek (socket).
  useEffect(load, [load, prospects]);

  const flagOf = useCallback((g: PoIndentGroup, it: PoIndentItem) => etaFlag(it.eta, it.stat, g.janji, today), [today]);

  const all = useMemo(() => groups || [], [groups]);
  const counts = useMemo(() => {
    const c: Record<EtaFlag, number> = { tiba: 0, kosong: 0, lewat: 0, janji: 0, ok: 0 };
    all.forEach((g) => g.items.forEach((it) => c[flagOf(g, it)]++));
    return c;
  }, [all, flagOf]);
  const totalItems = all.reduce((n, g) => n + g.items.length, 0);
  const cabangs = useMemo(() => Array.from(new Set(all.map((g) => g.cabang).filter(Boolean))).sort(), [all]);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return all
      .filter((g) => !cabang || g.cabang === cabang)
      .map((g) => {
        const hitG = !ql || [g.customer, g.noPo, g.seName, g.se, g.fupa].some((x) => (x || '').toLowerCase().includes(ql));
        const items = g.items.filter(
          (it) =>
            (hitG || it.label.toLowerCase().includes(ql)) &&
            (!kond || it.kond === kond) &&
            (!stat || it.stat === stat) &&
            (!flag || flagOf(g, it) === flag),
        );
        return { ...g, items };
      })
      .filter((g) => g.items.length);
  }, [all, q, cabang, kond, stat, flag, flagOf]);
  const shownKeys = shown.flatMap((g) => g.items.map((it) => keyOf(g, it)));
  const allSel = shownKeys.length > 0 && shownKeys.every((k) => sel.has(k));

  const toggle = (keys: Key[], on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      keys.forEach((k) => (on ? n.add(k) : n.delete(k)));
      return n;
    });

  async function save(keys: Key[], patch: { eta?: string; stat?: string; note?: string }): Promise<boolean> {
    setBusy(true);
    setErr('');
    try {
      const items = keys.map((k) => ({ prospectId: k.split('|')[0], itemId: k.split('|')[1] }));
      const r = await api.post<{ changed: number }>('/api/po-indent', { items, ...patch });
      toast(`Tersimpan · ${r.changed} item`, 'success');
      load();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Perubahan satu baris: target mundur / dihapus → minta alasan dulu. */
  function rowChange(g: PoIndentGroup, it: PoIndentItem, patch: { eta?: string; stat?: EtaStat }) {
    const k = keyOf(g, it);
    const later = patch.eta !== undefined && it.eta && (patch.eta === '' || patch.eta > it.eta);
    if (later) {
      setPend({ key: k, ...patch, note: '' });
      return;
    }
    void save([k], patch);
  }

  async function applyBulk() {
    if (!sel.size) return;
    if (!bulkEta && !bulkStat) return setErr('Isi target kedatangan atau status barang.');
    const ok = await save(Array.from(sel), { ...(bulkEta ? { eta: bulkEta } : {}), ...(bulkStat ? { stat: bulkStat } : {}), note: bulkNote });
    if (ok) {
      setSel(new Set());
      setBulkEta('');
      setBulkStat('');
      setBulkNote('');
    }
  }

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const aoa: (string | number)[][] = [['NO. PO', 'TGL PO', 'CABANG', 'SALES', 'CUSTOMER', 'JANJI KIRIM', 'FUP A', 'MATERIAL', 'KONDISI', 'PERKIRAAN', 'QTY PO', 'TERKIRIM', 'SISA', 'TARGET TIBA', 'STATUS BARANG', 'TANDA']];
    shown.forEach((g) =>
      g.items.forEach((it) =>
        aoa.push([g.noPo, g.tglPO, g.cabang, g.seName || g.se, g.customer, g.janji, g.fupa, it.label, STOK_META[it.kond].short, it.lama, it.po, it.sent, it.sisa, it.eta, ETA_STAT_META[it.stat].label, ETA_FLAG_META[flagOf(g, it)].label]),
      ),
    );
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [14, 11, 8, 18, 28, 11, 14, 40, 12, 10, 8, 8, 8, 11, 22, 20].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, 'PO Indent');
    XLSX.writeFile(wb, `PO_Indent_${today}.xlsx`);
  }

  if (!groups) return <div className="field-note">{tr("Memuat PO Indent…")}</div>;

  const KPI: { k: EtaFlag | ''; label: string; n: number; sub: string; cls: string }[] = [
    { k: '', label: tr('Item belum tiba'), n: totalItems - counts.tiba, sub: `${all.length} PO / DO`, cls: '' },
    { k: 'kosong', label: tr('Belum ada target'), n: counts.kosong, sub: tr('perlu diisi Purchasing'), cls: 'none' },
    { k: 'lewat', label: tr('Lewat target'), n: counts.lewat, sub: tr('belum tiba'), cls: 'bad' },
    { k: 'janji', label: tr('Melewati janji kirim'), n: counts.janji, sub: tr('Sales perlu kabari customer'), cls: 'warn' },
    { k: 'tiba', label: tr('Tiba di gudang'), n: counts.tiba, sub: tr('menunggu DO'), cls: 'ok' },
  ];

  return (
    <div className="pi">
      <div className="pi-intro">
        <b>{tr("PO Indent & target kedatangan")}</b>
        <span>{tr("PO/Kontrak dan DO yang itemnya berkondisi Indent atau Import dan belum terkirim penuh. Isi target kedatangan per item, atau centang beberapa item sekaligus. Harga dan nilai Rupiah tidak ditampilkan.")}</span>
      </div>
      <div className="pi-kpis">
        {KPI.map((x) => (
          <button key={x.label} type="button" className={`pi-kpi ${x.cls} ${flag === x.k && x.k ? 'on' : ''}`} onClick={() => setFlag(flag === x.k ? '' : x.k)}>
            <span className="lb">{x.label}</span>
            <span className="n">{x.n}</span>
            <span className="sub">{x.sub}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-row" style={{ marginBottom: 10 }}>
        <span className="pi-search">
          <IconSearch />
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Cari customer / No. PO / material / Sales")} />
        </span>
        <select value={cabang} onChange={(e) => setCabang(e.target.value)} style={{ maxWidth: 150 }} aria-label={tr("Cabang")}>
          <option value="">{tr("Semua cabang")}</option>
          {cabangs.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={kond} onChange={(e) => setKond(e.target.value)} style={{ maxWidth: 160 }} aria-label={tr("Kondisi")}>
          <option value="">{tr("Indent + Import")}</option>
          <option value="indent">{tr("Indent")}</option>
          <option value="import">{tr("Import")}</option>
        </select>
        <select value={stat} onChange={(e) => setStat(e.target.value)} style={{ maxWidth: 210 }} aria-label={tr("Status barang")}>
          <option value="">{tr("Semua status barang")}</option>
          {ETA_STAT_KEYS.map((k) => <option key={k} value={k}>{tr(ETA_STAT_META[k].label)}</option>)}
        </select>
        {flag && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setFlag('')}>
            {tr(ETA_FLAG_META[flag].label)} ×
          </button>
        )}
        <span className="field-note" style={{ margin: 0 }}>{shown.reduce((n, g) => n + g.items.length, 0)} {tr("item ·")} {shown.length} {tr("PO")}</span>
        <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={exportExcel}>
          <IconDownload /> {tr("Excel")}
        </button>
      </div>

      {!readOnly && sel.size > 0 && (
        <div className="pi-bulk">
          <b>{sel.size} {tr("item dipilih")}</b>
          <label>
            {tr("Target kedatangan")}
            <input type="date" value={bulkEta} min={today} onChange={(e) => setBulkEta(e.target.value)} />
          </label>
          <label>
            {tr("Status barang")}
            <select value={bulkStat} onChange={(e) => setBulkStat(e.target.value)}>
              <option value="">{tr("— tidak diubah —")}</option>
              {ETA_STAT_KEYS.map((k) => <option key={k} value={k}>{tr(ETA_STAT_META[k].label)}</option>)}
            </select>
          </label>
          <label className="grow">
            {tr("Catatan / alasan (wajib bila target dimundurkan)")}
            <input type="text" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} placeholder={tr("cth. jadwal kapal dari mill mundur 2 minggu")} />
          </label>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={applyBulk}>
            {tr("Terapkan ke")} {sel.size} {tr("item")}
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setSel(new Set())}>{tr("Batal pilih")}</button>
        </div>
      )}
      {err && <div className="form-error" style={{ marginBottom: 8 }}>{err}</div>}

      {shown.length === 0 ? (
        <div className="empty-state" style={{ padding: 30 }}>{totalItems ? tr("Tidak ada item sesuai saringan.") : tr("Belum ada PO dengan item Indent / Import yang belum terkirim.")}</div>
      ) : (
        <div className="table-wrap">
          <table className="simple-table pi-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  {!readOnly && <input type="checkbox" checked={allSel} onChange={(e) => toggle(shownKeys, e.target.checked)} aria-label={tr("Pilih semua")} />}
                </th>
                <th>{tr("Material")}</th>
                <th>{tr("Kondisi")}</th>
                <th className="r">{tr("Qty PO")}</th>
                <th className="r">{tr("Terkirim")}</th>
                <th className="r">{tr("Sisa")}</th>
                <th>{tr("Target kedatangan")}</th>
                <th>{tr("Status barang")}</th>
                <th>{tr("Tanda")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => {
                const gKeys = g.items.map((it) => keyOf(g, it));
                const gSel = gKeys.every((k) => sel.has(k));
                return [
                  <tr key={g.prospectId} className="pi-group">
                    <td>{!readOnly && <input type="checkbox" checked={gSel} onChange={(e) => toggle(gKeys, e.target.checked)} aria-label={`Pilih ${g.noPo}`} />}</td>
                    <td colSpan={8}>
                      <b className="mono">{g.noPo || tr('(tanpa No. PO)')}</b>
                      {g.tglPO && <span className="muted"> · {tr("Tgl PO")} {fmtYmd(g.tglPO)}</span>}
                      <span className="muted"> · {g.cabang}{g.seName || g.se ? ` · ${g.seName || g.se}${g.seName && g.se ? ` (${g.se})` : ''}` : ''}</span>
                      <span className="pi-cust"> · {g.customer}</span>
                      {g.status === 5 && <span className="badge green" style={{ marginLeft: 6 }}>{tr("DO sebagian")}</span>}
                      {g.janji && <span className="pi-janji">{tr("Janji kirim ke customer:")} {fmtYmd(g.janji)}</span>}
                      {g.fupa && <span className="badge steel" style={{ marginLeft: 6 }}>{tr("FUP A")} {g.fupa}</span>}
                      {g.hidden > 0 && <span className="muted"> · {g.hidden} {tr("item lain (Ready / terkirim) disembunyikan")}</span>}
                      {canIssue && (
                        <button type="button" className="link-btn pi-flag-btn" onClick={() => setIssue(g)}>⚑ {tr("Laporkan masalah")}</button>
                      )}
                    </td>
                  </tr>,
                  ...g.items.map((it) => {
                    const k = keyOf(g, it);
                    const f = flagOf(g, it);
                    const lastMove = [...it.log].reverse().find((e) => e.from && e.to && e.to > e.from);
                    const isPend = pend?.key === k;
                    return (
                      <tr key={k} className={`pi-row ${sel.has(k) ? 'sel' : ''}`}>
                        <td>{!readOnly && <input type="checkbox" checked={sel.has(k)} onChange={(e) => toggle([k], e.target.checked)} aria-label={`Pilih ${it.label}`} />}</td>
                        <td>
                          {it.label}
                          {it.kg > 0 && <span className="muted"> · {formatTon(it.kg)}</span>}
                        </td>
                        <td>
                          <span className={`pi-kond ${it.kond}`}>{STOK_META[it.kond].short}</span>
                          {it.lama && <span className="muted"> {it.lama}</span>}
                          {it.legacy && <span className="muted" title={tr("Dari teks Kondisi Stock lama")}> *</span>}
                        </td>
                        <td className="r mono">{formatQty(it.po)}</td>
                        <td className="r mono">{formatQty(it.sent)}</td>
                        <td className="r mono"><b>{formatQty(it.sisa)}</b> <span className="muted">{it.satuan}</span></td>
                        <td>
                          {readOnly ? (
                            <span className="mono">{fmtYmd(it.eta) || '–'}</span>
                          ) : (
                            <input type="date" className="pi-date" value={isPend && pend?.eta !== undefined ? pend.eta : it.eta} disabled={busy} onChange={(e) => rowChange(g, it, { eta: e.target.value })} aria-label={tr("Target kedatangan")} />
                          )}
                          {lastMove && <div className="pi-moved">{tr("mundur dari")} {fmtYmd(lastMove.from || '')}</div>}
                        </td>
                        <td>
                          {readOnly ? (
                            <span className={`pi-stat ${it.stat}`}>{tr(ETA_STAT_META[it.stat].label)}</span>
                          ) : (
                            <select className={`pi-stat-sel ${it.stat}`} value={it.stat} disabled={busy} onChange={(e) => rowChange(g, it, { stat: e.target.value as EtaStat })} aria-label={tr("Status barang")}>
                              {ETA_STAT_KEYS.map((s) => <option key={s} value={s}>{tr(ETA_STAT_META[s].label)}</option>)}
                            </select>
                          )}
                        </td>
                        <td>
                          <span className={`pi-flag ${ETA_FLAG_META[f].cls}`}>{tr(ETA_FLAG_META[f].label)}</span>{' '}
                          {it.log.length > 0 && (
                            <button type="button" className="link-btn" onClick={() => setHist({ g, it })}>{tr("Riwayat")}</button>
                          )}
                          {isPend && (
                            <div className="pi-pend">
                              <input type="text" autoFocus value={pend.note} onChange={(e) => setPend({ ...pend, note: e.target.value })} placeholder={tr("Alasan target dimundurkan")} />
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={busy || pend.note.trim().length < 3}
                                onClick={async () => (await save([k], { eta: pend.eta, stat: pend.stat, note: pend.note })) && setPend(null)}
                              >
                                {tr("Simpan")}
                              </button>
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => setPend(null)}>{tr("Batal")}</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="pi-rules">
        <b>{tr("Aturan di layar ini")}</b>
        <span>{tr("• Target dimundurkan → alasan wajib dan tercatat di riwayat; Sales & BM diberi tahu.")}</span>
        <span>{tr("• Merah: target sudah lewat, barang belum tiba. Oranye: target tiba melewati janji kirim ke customer.")}</span>
        <span>{tr("• Status Tiba di gudang → Admin Sales cabang mendapat tugas Catat Pengiriman (DO) di Antrian Admin.")}</span>
        <span>{tr("• Item Ready tidak tampil; PO hilang dari daftar setelah semua item terkirim. * = kondisi dari teks Kondisi Stock lama.")}</span>
      </div>

      {issue && (
        <PurchIssueModal
          target={{ prospectId: issue.prospectId, noDoc: issue.noPo || 'PO', cabang: issue.cabang, customer: issue.customer, sales: issue.seName || issue.se, hasProspect: true, items: issue.items.map((it) => it.label) }}
          onClose={() => setIssue(null)}
        />
      )}
      {hist && (
        <div className="pi-hist-back" onClick={() => setHist(null)}>
          <div className="pi-hist" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={tr("Riwayat target")}>
            <div className="pi-hist-head">
              <b>{tr("Riwayat target —")} {hist.it.label}</b>
              <button type="button" className="icon-btn" onClick={() => setHist(null)} aria-label={tr("Tutup")}>×</button>
            </div>
            <div className="muted" style={{ marginBottom: 8 }}>{hist.g.noPo} · {hist.g.customer}</div>
            {[...hist.it.log].reverse().map((e, i) => (
              <div key={i} className="pi-hist-row">
                <span className="mono muted">{new Date(e.at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                <span>
                  <b>{e.by}</b>: {etaLogText(e)}
                  {e.note && <div className="muted">“{e.note}”</div>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
