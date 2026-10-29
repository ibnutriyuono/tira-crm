'use client';

import { useMemo, useState } from 'react';
import { STATUS_META } from '@/lib/constants';
import { buildOpsAnalysis } from '@/lib/exec-more';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { PeriodRange, normRange, rangeMonths, type PeriodRangeValue } from './PeriodRange';
import { Bars, Insights, Kpi, Section, Table, rpShort } from './ui';

/**
 * Analisa Eksekutif › Operasional: respons Purchasing (RFQ / FUP A), efek RFQ
 * pada win rate, disiplin follow-up & umur tahap, masalah pipeline, DO yang
 * belum difaktur.
 */
export function OpsTab({ prospects, cabangs, thisMonth }: { prospects: Prospect[]; cabangs: string[] | null; thisMonth: string }) {
  const tr = useT();
  const rfqs = useDataStore((s) => s.rfqs);
  const fupas = useDataStore((s) => s.fupas);
  const issues = useDataStore((s) => s.issues);
  const [range, setRange] = useState<PeriodRangeValue>(() => {
    const d = new Date(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)) - 3, 1);
    return normRange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, thisMonth);
  });
  const [cabang, setCabang] = useState('');
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const inScope = useMemo(() => {
    const set = cabangs ? new Set(cabangs) : null;
    return (c: string | null) => !set || set.has((c || '').trim().toUpperCase());
  }, [cabangs]);
  const o = useMemo(
    () =>
      buildOpsAnalysis({
        prospects,
        rfqs: rfqs.filter((r) => inScope(r.cabang)),
        fupas: fupas.filter((f) => inScope(f.cabang)),
        issues: issues.filter((i) => inScope(i.cabang)),
        range: { months: rangeMonths(range), today },
        cabangFilter: cabang,
      }),
    [prospects, rfqs, fupas, issues, range, today, cabang, inScope],
  );
  const d1 = (v: number | null) => (v == null ? '-' : (Math.round(v * 10) / 10).toLocaleString('id-ID'));

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
      </div>
      <div className="kpi-grid">
        <Kpi label={tr('RFQ / FUP A dikirim')} value={`${o.rfqCount} / ${o.fupaCount}`} foot={`${o.answeredPct ?? 0}% ${tr('RFQ dijawab')}`} />
        <Kpi tone="aktif" label={tr('Median jawab RFQ')} value={`${d1(o.medianDays)} ${tr('hari')}`} foot={`${o.within2Pct ?? 0}% ${tr('dijawab ≤ 2 hari')} · No Quote ${o.noQuotePct ?? 0}%`} />
        <Kpi tone="won" label={tr('Win rate dengan RFQ')} value={o.rfqWin == null ? '-' : `${o.rfqWin}%`} foot={`${tr('tanpa RFQ')} ${o.noRfqWin == null ? '-' : `${o.noRfqWin}%`}`} />
        <Kpi tone={o.fuNone + o.fuLate ? 'lost' : ''} label={tr('Follow-up tidak tertib')} value={o.fuNone + o.fuLate} foot={`${o.fuNone} ${tr('tanpa jadwal')} · ${o.fuLate} ${tr('terlambat')} / ${o.openDeals}`} />
        <Kpi tone={o.issueOpen ? 'lost' : ''} label={tr('Masalah terbuka')} value={o.issueOpen} foot={`${o.issueLate} > 7 ${tr('hari')} · ${tr('rata-rata selesai')} ${o.issueAvgClose ?? '-'} ${tr('hari')}`} />
      </div>
      <Insights list={o.insights} />

      <div className="ea-grid2">
        <Section title={tr('RFQ menunggu jawaban terlama')}>
          <Table head={['No. RFQ', tr('Cabang'), tr('Customer'), tr('Hari')]} right={[3]} rows={o.pending.map((p) => [p.no, p.cabang, p.customer, p.days])} empty={tr('Tidak ada RFQ menunggu')} />
        </Section>
        <Section title={tr('Umur rata-rata di tahap')} note={tr('Hari sejak status terakhir berubah, prospek aktif.')}>
          <Bars items={o.stageAge.map((s) => ({ label: `${tr(STATUS_META[s.stage].label)} (${s.count})`, value: s.avg ?? 0, color: (s.avg ?? 0) > 30 ? '#B94A3D' : (s.avg ?? 0) > 14 ? '#C47F2C' : '#2F8F5B' }))} unit=" hr" />
        </Section>
        <Section title={tr('Masalah pipeline per kategori')}>
          <Table head={[tr('Kategori'), tr('Terbuka'), tr('Selesai (periode)'), tr('Nilai tertahan')]} right={[1, 2, 3]} rows={o.issueCats.map((c) => [c.label, c.open, c.done, rpShort(c.value)])} empty={tr('Tidak ada masalah')} />
        </Section>
        <Section title={tr('DO belum terfaktur per umur')}>
          <Table head={[tr('Umur'), 'DO', tr('Nilai')]} right={[1, 2]} rows={o.git.map((g) => [g.label, g.count, rpShort(g.value)])} />
        </Section>
      </div>
    </>
  );
}
