'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconDownload } from '../icons';
import { FlowBar, FlowLegend } from '../modals/ItemFlowModal';
import { api } from '@/lib/api-client';
import { appendSheet } from '@/lib/exports';
import { formatDateID, num } from '@/lib/format';
import { EVENT_META, flowItems, flowTotals, formatQty, formatTon, type ItemEvent } from '@/lib/item-flow';
import { monthsEnding } from '@/lib/material-trend';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';

type Kondisi = '' | 'belum' | 'sisa' | 'lunas' | 'tidakpo';

const KONDISI: { v: Kondisi; l: string }[] = [
  { v: '', l: 'Semua kondisi' },
  { v: 'belum', l: 'Belum dikonfirmasi per item' },
  { v: 'sisa', l: 'Masih ada sisa belum kirim' },
  { v: 'lunas', l: 'Terkirim lunas' },
  { v: 'tidakpo', l: 'Ada item tidak di-PO' },
];

interface FeedEvent extends ItemEvent {
  customer: string;
  cabang: string;
}

/**
 * Analisa Eksekutif > Pipeline: PO/Kontrak & DO dalam cakupan, per item
 * Ditawarkan -> PO -> Terkirim (lib/item-flow.ts), plus the latest item events.
 */
export function PipelineTab({ prospects, scopeLabel, cabangs, thisMonth }: { prospects: Prospect[]; scopeLabel: string; cabangs: string[] | null; thisMonth: string }) {
  const toast = useDataStore((s) => s.toast);
  const [cabang, setCabang] = useState('');
  const [period, setPeriod] = useState(6);
  const [kondisi, setKondisi] = useState<Kondisi>('');
  const [q, setQ] = useState('');
  const [feed, setFeed] = useState<FeedEvent[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ events: FeedEvent[] }>('/api/prospect-item-events?limit=60')
      .then((r) => alive && setFeed(r.events))
      .catch(() => alive && setFeed([]));
    return () => {
      alive = false;
    };
  }, [prospects]);

  const months = useMemo(() => (period ? new Set(monthsEnding(thisMonth, period)) : null), [period, thisMonth]);
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return prospects
      .filter((p) => num(p.status) === 4 || num(p.status) === 5)
      .filter((p) => !cabang || (p.cabang || '').trim().toUpperCase() === cabang)
      .filter((p) => !months || months.has((p.tglPO || p.tglPenawaran || p.createdAt || '').slice(0, 7)))
      .filter((p) => !ql || p.customer.toLowerCase().includes(ql) || (p.noPo || '').toLowerCase().includes(ql))
      .map((p) => {
        const items = flowItems(p);
        const t = flowTotals(items);
        const po = items.reduce((s, i) => s + (i.po || 0), 0);
        const sent = items.reduce((s, i) => s + i.sent, 0);
        const off = items.reduce((s, i) => s + i.offered, 0);
        const lost = items.some((i) => i.poConfirmed && (i.po || 0) < i.offered);
        const kond: Kondisi = !t.confirmed ? 'belum' : sent < po ? 'sisa' : 'lunas';
        return { p, items, t, po, sent, off, lost, kond };
      })
      .filter((r) => !kondisi || (kondisi === 'tidakpo' ? r.lost : r.kond === kondisi))
      .sort((a, b) => (b.p.tglPO || '').localeCompare(a.p.tglPO || ''));
  }, [prospects, cabang, months, q, kondisi]);

  const sum = rows.reduce(
    (s, r) => ({ off: s.off + r.t.offKg, po: s.po + r.t.poKg, sent: s.sent + r.t.sentKg, open: s.open + r.t.openKg, lost: s.lost + r.t.lostKg, belum: s.belum + (r.t.confirmed ? 0 : 1) }),
    { off: 0, po: 0, sent: 0, open: 0, lost: 0, belum: 0 },
  );

  const open = (id: string) => useUiStore.setState({ itemFlowCtx: { prospectId: id, returnTo: 'gmAnalysis' }, modal: 'itemFlow' });
  const scopeText = cabang ? `Cabang ${cabang}` : scopeLabel;

  async function exportExcel() {
    if (!rows.length) return toast('Tidak ada data untuk diexport', 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const body: unknown[][] = [];
    rows.forEach((r) =>
      r.items.forEach((it) =>
        body.push([
          r.p.customer, r.p.cabang || '', r.p.se || '', r.p.noPo || '', r.p.tglPO || '', it.label, it.satuan,
          it.offered, it.po ?? '', it.sent, Math.max(0, (it.po || 0) - it.sent), Math.round(it.offered * it.kgPc), Math.round((it.po || 0) * it.kgPc), Math.round(it.sent * it.kgPc),
          it.estimated ? 'perkiraan' : 'dikonfirmasi',
        ]),
      ),
    );
    appendSheet(XLSX, wb, {
      sheetName: 'Item PO & Kirim',
      header: ['CUSTOMER', 'CABANG', 'SE', 'NO PO', 'TGL PO', 'MATERIAL', 'SATUAN', 'QTY DITAWARKAN', 'QTY PO', 'QTY TERKIRIM', 'SISA', 'KG DITAWARKAN', 'KG PO', 'KG TERKIRIM', 'SUMBER'],
      rows: body,
      colWidths: [{ wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 18 }, { wch: 11 }, { wch: 40 }, { wch: 7 }, { wch: 10 }, { wch: 9 }, { wch: 11 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 13 }],
      numFormats: { 11: '#,##0', 12: '#,##0', 13: '#,##0' },
    });
    XLSX.writeFile(wb, `Pipeline_Item_${scopeText.replace(/[^\w-]+/g, '_')}_${thisMonth}.xlsx`);
    toast(`Export berhasil: ${body.length} item`, 'success');
  }

  return (
    <>
      <div className="toolbar-row" style={{ alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        {cabangs && cabangs.length > 1 && (
          <select value={cabang} onChange={(e) => setCabang(e.target.value)} style={{ maxWidth: 170 }} aria-label="Cabang">
            <option value="">Semua cabang</option>
            {cabangs.map((c) => (
              <option key={c} value={c}>Cabang {c}</option>
            ))}
          </select>
        )}
        <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} style={{ maxWidth: 170 }} aria-label="Periode PO">
          <option value={3}>PO 3 bulan terakhir</option>
          <option value={6}>PO 6 bulan terakhir</option>
          <option value={12}>PO 12 bulan terakhir</option>
          <option value={0}>Semua PO</option>
        </select>
        <select value={kondisi} onChange={(e) => setKondisi(e.target.value as Kondisi)} style={{ maxWidth: 230 }} aria-label="Kondisi">
          {KONDISI.map((k) => (
            <option key={k.v} value={k.v}>{k.l}</option>
          ))}
        </select>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari customer / No. PO" style={{ maxWidth: 220 }} />
        <button type="button" className="btn btn-outline btn-sm" onClick={exportExcel}>
          <IconDownload /> Excel
        </button>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">Tonase PO</div>
          <div className="value">{formatTon(sum.po, 1)}</div>
          <div className="foot">dari ditawarkan {formatTon(sum.off, 1)}</div>
        </div>
        <div className="kpi won">
          <div className="label">Terkirim</div>
          <div className="value">{formatTon(sum.sent, 1)}</div>
          <div className="foot">{sum.po ? Math.round((sum.sent / sum.po) * 100) : 0}% dari PO</div>
        </div>
        <div className="kpi aktif">
          <div className="label">Sisa Belum Kirim</div>
          <div className="value">{formatTon(sum.open, 1)}</div>
          <div className="foot">{rows.filter((r) => r.kond === 'sisa').length} PO masih terbuka</div>
        </div>
        <div className="kpi lost">
          <div className="label">Tidak di-PO</div>
          <div className="value">{formatTon(sum.lost, 1)}</div>
          <div className="foot">Selisih penawaran vs PO</div>
        </div>
        <div className="kpi">
          <div className="label">Belum Dikonfirmasi</div>
          <div className="value">{sum.belum}</div>
          <div className="foot">PO/DO masih perkiraan (dihitung penuh)</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, margin: '4px 0 6px' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>PO / Kontrak &amp; DO — {rows.length} prospek · {scopeText}</span>
        <FlowLegend />
      </div>
      {rows.length === 0 ? (
        <div className="field-note" style={{ marginBottom: 16 }}>Tidak ada PO/DO pada filter ini.</div>
      ) : (
        <div className="table-wrap" style={{ borderTop: 'none', marginBottom: 16 }}>
          <table className="simple-table if-nowrap" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>Customer</th><th>Cabang</th><th>No. PO</th><th>Tgl PO</th><th style={{ textAlign: 'right' }}>Item</th>
                <th style={{ textAlign: 'right' }}>Ditawarkan</th><th style={{ textAlign: 'right' }}>PO</th><th style={{ textAlign: 'right' }}>Terkirim</th>
                <th style={{ width: 120 }}>Alur</th><th>Kondisi</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <tr key={r.p.id} className="if-row" onClick={() => open(r.p.id)} title="Buka Status Item & Riwayat">
                  <td><b>{r.p.customer}</b><div className="field-note" style={{ margin: 0 }}>SE {r.p.se || '-'}</div></td>
                  <td>{r.p.cabang || '-'}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.p.noPo || '-'}</td>
                  <td>{r.p.tglPO ? formatDateID(r.p.tglPO) : '-'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{r.items.length}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{r.t.offKg ? formatTon(r.t.offKg) : formatQty(r.off)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{r.t.offKg ? formatTon(r.t.poKg) : formatQty(r.po)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{r.t.offKg ? formatTon(r.t.sentKg) : formatQty(r.sent)}</td>
                  <td><FlowBar it={{ offered: r.off, po: r.po, sent: r.sent }} /></td>
                  <td>
                    {r.kond === 'belum' ? <span className="badge amber">Belum dikonfirmasi</span> : r.kond === 'sisa' ? <span className="badge steel">Sisa {r.po ? Math.round(((r.po - r.sent) / r.po) * 100) : 0}%</span> : <span className="badge green">Lunas</span>}
                    {r.lost && <span className="badge rust" style={{ marginLeft: 4 }}>Ada tidak di-PO</span>}
                  </td>
                  <td>
                    <button type="button" className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); open(r.p.id); }}>
                      {r.kond === 'belum' ? 'Konfirmasi' : 'Detail'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 13, margin: '4px 0 6px' }}>Riwayat Item Terbaru</div>
      {feed === null ? (
        <div className="field-note">Memuat…</div>
      ) : feed.length === 0 ? (
        <div className="field-note">Belum ada riwayat item. Riwayat tercatat saat penawaran ditandai terkirim, qty PO dikonfirmasi, atau pengiriman dicatat.</div>
      ) : (
        <ol className="if-timeline">
          {feed.filter((e) => !cabang || (e.cabang || '').trim().toUpperCase() === cabang).slice(0, 40).map((e) => {
            const meta = EVENT_META[e.type] || EVENT_META.revisi;
            return (
              <li key={e.id} className="if-row" onClick={() => open(e.prospectId)}>
                <div className="if-when">
                  <b>{formatDateID(e.tgl || e.createdAt.slice(0, 10))}</b>
                  <span>{e.actorName}</span>
                </div>
                <span className={`if-dot ${meta.color}`} aria-hidden="true" />
                <div className="if-what">
                  <div>
                    <span className={`badge ${meta.color}`}>{meta.label}</span> <b>{e.customer}</b> — {e.title}
                  </div>
                  <div className="if-line">
                    {e.items.slice(0, 3).map((x) => `${x.label}: ${e.type === 'revisi' ? `${formatQty(x.from ?? 0)} → ${formatQty(x.to ?? 0)}` : formatQty(x.qty ?? 0)}`).join(' · ')}
                    {e.items.length > 3 ? ` · +${e.items.length - 3} item` : ''}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
