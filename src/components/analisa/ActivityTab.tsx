'use client';

import { useMemo, useState } from 'react';
import { IconDownload } from '../icons';
import { ACTIVITY_TYPES } from '@/lib/constants';
import { buildActivityAnalysis } from '@/lib/exec-more';
import { canNow } from '@/hooks/useCan';
import type { Prospect, SalesActivity } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { PeriodRange, normRange, rangeMonths, type PeriodRangeValue } from './PeriodRange';
import { Bars, Columns, Heat, Insights, Kpi, Section, Table, rpShort } from './ui';

const COLORS: Record<string, string> = { kunjungan: '#2F8F5B', telepon: '#2F5576', meeting: '#C47F2C', dokumen: '#6B7684' };

/**
 * Analisa Eksekutif › Aktivitas: volume & bauran aktivitas Sales, tren
 * mingguan, cakupan customer, konversi ke pipeline, per cabang & per SE.
 */
export function ActivityTab({ activities, prospects, cabangs, thisMonth, isStaff, isSe }: { activities: SalesActivity[] | null; prospects: Prospect[]; cabangs: string[] | null; thisMonth: string; isStaff: (se: string) => boolean; isSe: boolean }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const [range, setRange] = useState<PeriodRangeValue>(() => normRange(thisMonth, thisMonth));
  const [cabang, setCabang] = useState('');
  const [sort, setSort] = useState<'total' | 'won' | 'idle' | 'achieve'>('total');
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const a = useMemo(
    () => (activities ? buildActivityAnalysis({ activities, prospects, range: { months: rangeMonths(range), today }, isStaff, cabangFilter: cabang }) : null),
    [activities, prospects, range, today, isStaff, cabang],
  );

  if (!activities) return <div className="field-note">{tr('Memuat aktivitas…')}</div>;
  if (!a) return null;

  const seRows = [...a.seRows].sort((x, y) => (sort === 'won' ? y.won - x.won : sort === 'idle' ? (y.idle ?? 999) - (x.idle ?? 999) : sort === 'achieve' ? (x.achieve ?? 0) - (y.achieve ?? 0) : y.total - x.total));

  async function exportExcel() {
    if (!a || !a.seRows.length) return toast('Tidak ada data', 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        a.seRows.map((r) => ({
          SE: r.se,
          Cabang: r.cabang,
          ...Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.short, r.counts[t.key] || 0])),
          Total: r.total,
          'Target (default)': r.target,
          'Capaian %': r.achieve ?? '',
          'Hari aktif': r.hariAktif,
          'Input terakhir': r.lastDate || '',
          'Kunjungan berlokasi %': r.verifPct ?? '',
          'Customer disentuh': r.custTouched,
          'Ke pipeline': r.converted,
          'Jadi PO': r.toPo,
          'Realisasi (Rp)': r.won,
        })),
      ),
      'Aktivitas per SE',
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.cabangRows.map((c) => ({ Cabang: c.cabang, SE: c.seCount, Aktivitas: c.total, 'Per SE': c.perSe, Kunjungan: c.kunjungan, 'Kunjungan/SE': c.kunjPerSe, 'Berlokasi %': c.verifPct ?? '', 'Customer disentuh': c.custTouched, 'Customer aktif': c.activeCust, 'Customer aktif disentuh': c.covered, 'Cakupan %': c.coveragePct ?? '', 'Ke pipeline': c.converted, 'Realisasi (Rp)': c.won }))), 'Aktivitas per Cabang');
    XLSX.writeFile(wb, `Analisa_Aktivitas_${range.from}_${range.to}.xlsx`);
  }

  return (
    <>
      <div className="toolbar-row ea-bar-row">
        {cabangs && cabangs.length > 1 && (
          <select value={cabang} onChange={(e) => setCabang(e.target.value)} style={{ maxWidth: 170 }} aria-label={tr('Cabang')}>
            <option value="">{tr('Semua cabang')}</option>
            {cabangs.map((c) => <option key={c} value={c}>{tr('Cabang')} {c}</option>)}
          </select>
        )}
        <PeriodRange value={range} onChange={setRange} thisMonth={thisMonth} label="Periode" />
        {canNow('analisa', 'x') && <button type="button" className="btn btn-outline btn-sm" onClick={exportExcel}><IconDownload /> Excel</button>}
      </div>

      <div className="kpi-grid">
        <Kpi label={tr('Aktivitas')} value={a.total.toLocaleString('id-ID')} foot={a.changePct == null ? tr('periode sebelumnya: -') : `${a.changePct >= 0 ? '▲' : '▼'} ${Math.abs(a.changePct)}% ${tr('vs periode sebelumnya')}`} />
        <Kpi tone="won" label={tr('Kunjungan')} value={(a.byType.find((t) => t.tipe === 'kunjungan')?.count || 0).toLocaleString('id-ID')} foot={`${a.verifPct ?? 0}% ${tr('dengan lokasi')}`} />
        <Kpi label={tr('Customer disentuh')} value={a.custTouched} foot={tr('customer berbeda')} />
        <Kpi tone="aktif" label={tr('Ke pipeline')} value={a.converted} foot={`${a.convPct ?? 0}% · ${a.toPo} ${tr('jadi PO/DO')}`} />
        <Kpi tone={a.idleSe.length ? 'lost' : ''} label={tr('SE tidak input ≥ 5 hari')} value={a.idleSe.length} foot={a.idleSe.slice(0, 3).map((r) => r.se).join(', ') || '-'} />
      </div>

      <Insights list={a.insights} />

      <div className="ea-grid2">
        <Section title={tr('Bauran aktivitas vs target')} note={tr('Target = acuan default per SE per bulan × jumlah SE × bulan.')}>
          <Bars items={a.byType.map((t) => ({ label: t.label, value: t.count, sub: `${t.count} / ${t.target} (${t.pct ?? 0}%)`, color: COLORS[t.tipe] }))} />
          <div className="field-note">{a.byType.map((t) => `${t.label} ${t.pct ?? 0}%`).join(' · ')}</div>
        </Section>
        <Section title={tr('Tren per pekan')}>
          <Columns labels={a.weeks.map((w) => w.label)} series={ACTIVITY_TYPES.map((t) => ({ name: t.short, color: COLORS[t.key], values: a.weeks.map((w) => w.counts[t.key] || 0) }))} />
        </Section>
        <Section title={tr('Hari kerja')} note={tr('Sebaran aktivitas per hari — hari yang kosong biasanya hari administrasi.')}>
          <Bars items={a.weekday.map((d) => ({ label: d.label, value: d.count }))} />
        </Section>
        <Section title={tr('Hasil telepon / WA / email')}>
          <Bars items={a.phoneResult.map((p) => ({ label: p.label, value: p.count, color: p.label === 'Tersambung' ? '#2F8F5B' : '#C47F2C' }))} />
        </Section>
      </div>

      {!isSe && a.cabangRows.length > 0 && (
        <Section title={tr('Per cabang')} note={tr('Cakupan = customer aktif cabang (prospek aktif / order 12 bulan) yang disentuh aktivitas pada periode ini.')}>
          <Table
            head={[tr('Cabang'), 'SE', tr('Aktivitas'), tr('Per SE'), tr('Kunjungan'), tr('Kunj./SE'), tr('Berlokasi'), tr('Cakupan customer'), tr('Ke pipeline'), tr('Realisasi'), tr('SE < 60%')]}
            right={[1, 2, 3, 4, 5, 9, 10]}
            rows={a.cabangRows.map((c) => [
              <b key="c">{c.cabang}</b>,
              c.seCount,
              c.total,
              c.perSe,
              c.kunjungan,
              c.kunjPerSe.toLocaleString('id-ID'),
              <Heat key="v" v={c.verifPct}>{c.verifPct == null ? '-' : `${c.verifPct}%`}</Heat>,
              <Heat key="k" v={c.coveragePct}>{c.coveragePct == null ? '-' : `${c.coveragePct}% (${c.covered}/${c.activeCust})`}</Heat>,
              `${c.converted} (${c.convPct ?? 0}%)`,
              rpShort(c.won),
              c.lowSe,
            ])}
          />
        </Section>
      )}

      <Section
        title={isSe ? tr('Aktivitas saya') : tr('Per SE — aktivitas vs hasil')}
        right={
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ maxWidth: 200 }} aria-label={tr('Urutkan')}>
            <option value="total">{tr('Urut: aktivitas terbanyak')}</option>
            <option value="won">{tr('Urut: realisasi terbesar')}</option>
            <option value="achieve">{tr('Urut: capaian terendah')}</option>
            <option value="idle">{tr('Urut: paling lama tidak input')}</option>
          </select>
        }
      >
        <Table
          head={['SE', tr('Cabang'), ...ACTIVITY_TYPES.map((t) => t.short), tr('Total'), tr('Capaian'), tr('Hari aktif'), tr('Input terakhir'), tr('Customer'), tr('Ke pipeline → PO'), tr('Realisasi'), tr('Per kunjungan')]}
          right={[2, 3, 4, 5, 6, 8, 10, 12, 13]}
          rows={seRows.slice(0, 60).map((r) => [
            <b key="s">{r.se}</b>,
            r.cabang,
            ...ACTIVITY_TYPES.map((t) => r.counts[t.key] || 0),
            r.total,
            <Heat key="a" v={r.achieve}>{r.achieve == null ? '-' : `${r.achieve}%`}</Heat>,
            r.hariAktif,
            <span key="l" className={r.idle != null && r.idle >= 5 ? 'ea-bad' : ''}>{r.lastDate ? `${r.lastDate.slice(8, 10)}/${r.lastDate.slice(5, 7)}${r.idle ? ` (${r.idle} hr)` : ''}` : tr('belum ada')}</span>,
            r.custTouched,
            `${r.converted} → ${r.toPo}`,
            rpShort(r.won),
            r.wonPerVisit == null ? '-' : rpShort(r.wonPerVisit),
          ])}
        />
      </Section>
    </>
  );
}
