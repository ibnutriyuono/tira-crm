'use client';

import { Fragment, useMemo, useState } from 'react';
import { IconDownload } from '../icons';
import { canNow } from '@/hooks/useCan';
import { SEG_OTHERS, segmentLabel } from '@/lib/customer-segments';
import { buildSegmentAnalysis, SEG_NONE } from '@/lib/segment-analysis';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import { PeriodRange, normRange, rangeMonths, type PeriodRangeValue } from './PeriodRange';
import { Insights, Kpi, Section, rpShort } from './ui';

const rpKg = (v: number | null) => (v == null ? '-' : `Rp ${Math.round(v).toLocaleString('id-ID')}`);
const ton = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} t` : `${Math.round(kg).toLocaleString('id-ID')} kg`);
const chg = (v: number | null) => (v == null ? '-' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}%`);

/**
 * Analisa Eksekutif › Segmen: kinerja per segmen & sub-segmen, peta segmen ×
 * cabang, dan harga jual rata-rata per grade (Rp/kg) — keseluruhan & per segmen.
 */
export function SegmentTab({ prospects, cabangs, thisMonth }: { prospects: Prospect[]; cabangs: string[] | null; thisMonth: string }) {
  const tr = useT();
  const customers = useDataStore((s) => s.customers);
  const groups = useDataStore((s) => s.customerGroups);
  const toast = useDataStore((s) => s.toast);
  const [range, setRange] = useState<PeriodRangeValue>(() => normRange(`${thisMonth.slice(0, 4)}-01`, thisMonth));
  const [cabang, setCabang] = useState('');
  const [segPrice, setSegPrice] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const a = useMemo(
    () => buildSegmentAnalysis({ prospects, customers, groups, range: { months: rangeMonths(range), today }, cabangFilter: cabang, segFilter: segPrice }),
    [prospects, customers, groups, range, today, cabang, segPrice],
  );
  const top = a.rows.find((r) => r.segmen !== SEG_NONE && r.segmen !== SEG_OTHERS && r.won > 0);
  const heatMax = Math.max(1, ...Object.values(a.heat).flatMap((r) => Object.values(r)));
  const toggle = (s: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(s)) n.delete(s);
    else n.add(s);
    return n;
  });

  async function exportExcel() {
    if (!a.rows.length) return toast('Tidak ada data', 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const segRows = a.rows.flatMap((r) => [
      { Segmen: r.segmen, 'Sub-segmen': '', Customer: r.customers, Pembeli: r.buyers, 'Realisasi (Rp)': r.won, 'Periode sebelumnya (Rp)': r.wonPrev, 'Tumbuh %': r.growth ?? '', 'Porsi %': r.share ?? '', 'Win rate %': r.winRate ?? '', 'Rata-rata deal (Rp)': r.avgDeal ? Math.round(r.avgDeal) : '', 'Pipeline (Rp)': r.pipeline, 'Pipeline berbobot (Rp)': Math.round(r.weighted) },
      ...r.subs.map((s) => ({ Segmen: r.segmen, 'Sub-segmen': s.sub, Customer: s.customers, Pembeli: s.buyers, 'Realisasi (Rp)': s.won, 'Periode sebelumnya (Rp)': s.wonPrev, 'Tumbuh %': s.growth ?? '', 'Porsi %': s.share ?? '', 'Win rate %': s.winRate ?? '', 'Rata-rata deal (Rp)': s.avgDeal ? Math.round(s.avgDeal) : '', 'Pipeline (Rp)': s.pipeline, 'Pipeline berbobot (Rp)': Math.round(s.weighted) })),
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(segRows), 'Segmen');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        a.prices.map((p) => ({
          Grade: p.grade,
          Bentuk: p.bentuk,
          'Penawaran Rp/kg': p.offRpKg ? Math.round(p.offRpKg) : '',
          'Penawaran kg': Math.round(p.offKg),
          'PO Rp/kg': p.poRpKg ? Math.round(p.poRpKg) : '',
          'PO kg': Math.round(p.poKg),
          'Min Rp/kg': p.min ? Math.round(p.min) : '',
          'Maks Rp/kg': p.max ? Math.round(p.max) : '',
          'Periode sebelumnya Rp/kg': p.prevRpKg ? Math.round(p.prevRpKg) : '',
          'Perubahan %': p.change ?? '',
          ...Object.fromEntries(a.priceSegs.map((s) => [`${s} Rp/kg`, p.bySeg[s] ? Math.round(p.bySeg[s]) : ''])),
        })),
      ),
      'Harga per grade',
    );
    XLSX.writeFile(wb, `Analisa_Segmen_${range.from}_${range.to}.xlsx`);
  }

  return (
    <>
      <div className="toolbar-row ea-bar-row">
        {cabangs && cabangs.length > 1 && (
          <select value={cabang} onChange={(e) => setCabang(e.target.value)} style={{ maxWidth: 170 }} aria-label={tr('Cabang')}>
            <option value="">{tr('Semua cabang')}</option>
            {cabangs.map((x) => <option key={x} value={x}>{tr('Cabang')} {x}</option>)}
          </select>
        )}
        <PeriodRange value={range} onChange={setRange} thisMonth={thisMonth} label="Periode" />
        {canNow('analisa', 'x') && <button type="button" className="btn btn-outline btn-sm" onClick={exportExcel}><IconDownload /> Excel</button>}
      </div>

      <div className="kpi-grid">
        <Kpi tone="won" label={tr('Realisasi periode')} value={rpShort(a.total.won)} foot={`${a.total.buyers} ${tr('customer membeli')}`} />
        <Kpi label={tr('Segmen terbesar')} value={top ? top.segmen : '-'} foot={top ? `${top.share ?? 0}% · ${rpShort(top.won)}` : ''} />
        <Kpi tone="aktif" label={tr('Pipeline aktif')} value={rpShort(a.total.pipeline)} foot={`${tr('berbobot')} ${rpShort(a.total.weighted)}`} />
        <Kpi
          tone={(a.unknownShare ?? 0) >= 10 ? 'lost' : ''}
          label={tr('Segmen belum jelas')}
          value={`${a.unknownShare ?? 0}%`}
          foot={
            <button type="button" className="link-btn" onClick={() => { useUiStore.setState({ customersSegFocus: `ea${a.unknownCustomers}` }); useUiStore.getState().openModal('customers'); }}>
              {a.unknownCustomers} {tr('customer kosong / Others')} →
            </button>
          }
        />
      </div>
      <Insights list={a.insights} />

      <Section title={tr('Kinerja per segmen')} note={tr('Klik segmen untuk melihat sub-segmennya. Segmen diambil dari Kelola Customer (cadangan: segmen grup Key Account).')}>
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table ea-tbl seg-tbl">
            <thead>
              <tr>
                <th>{tr('Segmen')}</th>
                <th className="r">{tr('Customer')}</th>
                <th className="r">{tr('Pembeli')}</th>
                <th className="r">{tr('Realisasi')}</th>
                <th className="r">{tr('vs sebelumnya')}</th>
                <th className="r">{tr('Porsi')}</th>
                <th className="r">{tr('Win rate')}</th>
                <th className="r">{tr('Rata-rata deal')}</th>
                <th className="r">{tr('Pipeline')}</th>
                <th title={tr('Berdasarkan tonase PO, ditambah penawaran')}>{tr('Grade utama')}</th>
              </tr>
            </thead>
            <tbody>
              {a.rows.map((r) => (
                <Fragment key={r.segmen}>
                  <tr className="if-row" onClick={() => toggle(r.segmen)}>
                    <td><b>{open.has(r.segmen) ? '▾' : '▸'} {r.segmen}</b></td>
                    <td className="r mono">{r.customers}</td>
                    <td className="r mono">{r.buyers}</td>
                    <td className="r mono">{rpShort(r.won)}</td>
                    <td className={`r mono${(r.growth ?? 0) < 0 ? ' dk-bad' : ''}`}>{r.wonPrev ? chg(r.growth) : r.won ? tr('baru') : '-'}</td>
                    <td className="r mono">{r.share == null ? '-' : `${r.share}%`}</td>
                    <td className="r mono">{r.winRate == null ? '-' : `${r.winRate}%`}</td>
                    <td className="r mono">{r.avgDeal ? rpShort(r.avgDeal) : '-'}</td>
                    <td className="r mono">{rpShort(r.pipeline)}</td>
                    <td style={{ fontSize: 12 }}>{r.topGrades.join(', ') || '-'}</td>
                  </tr>
                  {open.has(r.segmen) &&
                    r.subs.map((s) => (
                      <tr key={`${r.segmen}-${s.sub}`} className="seg-sub">
                        <td>{r.segmen === SEG_NONE || r.segmen === SEG_OTHERS ? '—' : segmentLabel(r.segmen, s.sub === '—' ? tr('(sub belum diisi)') : s.sub).replace(`${r.segmen} › `, '↳ ').replace('Supplier → ', '↳ ')}</td>
                        <td className="r mono">{s.customers}</td>
                        <td className="r mono">{s.buyers}</td>
                        <td className="r mono">{rpShort(s.won)}</td>
                        <td className="r mono">{s.wonPrev ? chg(s.growth) : s.won ? tr('baru') : '-'}</td>
                        <td className="r mono">{s.share == null ? '-' : `${s.share}%`}</td>
                        <td className="r mono">{s.winRate == null ? '-' : `${s.winRate}%`}</td>
                        <td className="r mono">{s.avgDeal ? rpShort(s.avgDeal) : '-'}</td>
                        <td className="r mono">{rpShort(s.pipeline)}</td>
                        <td />
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {a.cabangs.length > 1 && (
        <Section title={tr('Realisasi segmen × cabang')} note={tr('Makin gelap makin besar. Cabang yang kuat di satu segmen bisa menjadi acuan cabang lain.')}>
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table ea-tbl">
              <thead>
                <tr>
                  <th>{tr('Segmen')}</th>
                  {a.cabangs.map((c) => <th key={c} className="r">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {a.rows.filter((r) => r.won > 0).map((r) => (
                  <tr key={r.segmen}>
                    <td><b>{r.segmen}</b></td>
                    {a.cabangs.map((c) => {
                      const v = a.heat[r.segmen]?.[c] || 0;
                      return (
                        <td key={c} className="r mono seg-heat" style={{ background: v ? `rgba(47,85,118,${0.08 + (v / heatMax) * 0.6})` : undefined, color: v / heatMax > 0.55 ? '#fff' : undefined }}>
                          {v ? rpShort(v) : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section
        title={tr('Harga jual rata-rata per grade (Rp/kg)')}
        note={tr('Tertimbang tonase: total nilai ÷ total kg. Penawaran = item yang ditawarkan di periode; PO = qty PO per item di periode. Hanya item dengan berat & harga. Harga jual, bukan HPP.')}
        right={
          <select value={segPrice} onChange={(e) => setSegPrice(e.target.value)} style={{ maxWidth: 220 }} aria-label={tr('Segmen')}>
            <option value="">{tr('Semua segmen')}</option>
            {a.rows.map((r) => <option key={r.segmen} value={r.segmen}>{r.segmen}</option>)}
          </select>
        }
      >
        {a.prices.length === 0 ? (
          <div className="field-note">{tr('Belum ada item dengan berat & harga di periode ini.')}</div>
        ) : (
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table ea-tbl">
              <thead>
                <tr>
                  <th>{tr('Grade')}</th>
                  <th>{tr('Bentuk')}</th>
                  <th className="r">{tr('Penawaran Rp/kg')}</th>
                  <th className="r">{tr('Ditawarkan')}</th>
                  <th className="r">{tr('PO Rp/kg')}</th>
                  <th className="r">{tr('Di-PO')}</th>
                  <th className="r">{tr('Rentang Rp/kg')}</th>
                  <th className="r">{tr('vs sebelumnya')}</th>
                  {!segPrice && a.priceSegs.slice(0, 5).map((s) => <th key={s} className="r" title={tr('Rp/kg di segmen ini (PO bila ada, selain itu penawaran)')}>{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {a.prices.slice(0, 40).map((p) => (
                  <tr key={p.grade}>
                    <td><b>{p.grade}</b></td>
                    <td>{p.bentuk || '-'}</td>
                    <td className="r mono">{rpKg(p.offRpKg)}</td>
                    <td className="r mono">{p.offKg ? `${ton(p.offKg)} · ${p.offN}` : '-'}</td>
                    <td className="r mono"><b>{rpKg(p.poRpKg)}</b></td>
                    <td className="r mono">{p.poKg ? `${ton(p.poKg)} · ${p.poN}` : '-'}</td>
                    <td className="r mono" style={{ fontSize: 12 }}>{p.min && p.max && p.max > p.min * 1.01 ? `${Math.round(p.min).toLocaleString('id-ID')}–${Math.round(p.max).toLocaleString('id-ID')}` : '-'}</td>
                    <td className={`r mono${(p.change ?? 0) < 0 ? ' dk-bad' : ''}`}>{chg(p.change)}</td>
                    {!segPrice && a.priceSegs.slice(0, 5).map((s) => <td key={s} className="r mono">{p.bySeg[s] ? Math.round(p.bySeg[s]).toLocaleString('id-ID') : ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
