'use client';

import { useMemo, useState } from 'react';
import { buildCustomerAnalysis } from '@/lib/exec-more';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useT } from '@/store/useLangStore';
import { PeriodRange, normRange, rangeMonths, type PeriodRangeValue } from './PeriodRange';
import { Insights, Kpi, Section, Table, rpShort } from './ui';

const TIER: Record<string, string> = { strategic: 'Strategic', key: 'Key', development: 'Development', monitor: 'Monitor' };

/**
 * Analisa Eksekutif › Customer: kesehatan basis customer (aktif / berisiko /
 * dingin / hilang), konsentrasi, pertumbuhan & penurunan, customer baru,
 * customer yang mulai hilang, dan per cabang.
 */
export function CustomerTab({ prospects, cabangs, thisMonth }: { prospects: Prospect[]; cabangs: string[] | null; thisMonth: string }) {
  const tr = useT();
  const groups = useDataStore((s) => s.customerGroups);
  const [range, setRange] = useState<PeriodRangeValue>(() => normRange(`${thisMonth.slice(0, 4)}-01`, thisMonth));
  const [cabang, setCabang] = useState('');
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const c = useMemo(() => buildCustomerAnalysis({ prospects, groups, range: { months: rangeMonths(range), today }, cabangFilter: cabang }), [prospects, groups, range, today, cabang]);
  const profile = (name: string) => {
    useUiStore.setState({ profileCustomer: name, profileReturnTo: 'gmAnalysis' });
    useUiStore.getState().openModal('customerProfile');
  };
  const chg = (v: number, p: number) => (p > 0 ? `${v >= p ? '▲' : '▼'} ${Math.abs(Math.round(((v - p) / p) * 100))}%` : v > 0 ? tr('baru') : '-');

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

      <div className="ea-segs">
        {c.segments.map((s) => (
          <div key={s.key} className={`ea-seg ${s.tone}`}>
            <span className="lb">{tr(s.label)}</span>
            <b className="mono">{s.count}</b>
            <small>{tr(s.hint)}</small>
            <small className="mono">{s.key === 'prospek' ? `${tr('pipeline')} ${rpShort(s.value12)}` : `${tr('omzet 12 bln')} ${rpShort(s.value12)}`}</small>
          </div>
        ))}
      </div>

      <div className="kpi-grid">
        <Kpi tone="won" label={tr('Realisasi periode')} value={rpShort(c.wonInRange)} foot={`${c.buyers} ${tr('customer membeli')}`} />
        <Kpi label={tr('Konsentrasi 10 terbesar')} value={c.top10Share == null ? '-' : `${c.top10Share}%`} foot={`${c.pareto80} ${tr('customer = 80% realisasi')}`} />
        <Kpi tone="aktif" label={tr('Customer baru')} value={c.newCustomers.length} foot={tr('order pertama di periode ini')} />
        <Kpi tone="lost" label={tr('Mulai hilang')} value={c.lapsed.length} foot={tr('berisiko / dingin, urut nilai historis')} />
      </div>
      <Insights list={c.insights} />

      <div className="ea-grid2">
        <Section title={tr('Customer terbesar periode ini')} note={tr('Dibanding periode sebelumnya dengan panjang yang sama. Klik untuk Profil Customer.')}>
          <Table
            head={[tr('Customer'), tr('Cabang'), tr('Realisasi'), tr('vs sebelumnya'), 'KAM']}
            right={[2]}
            rows={c.topCustomers.map((x) => [<b key="n">{x.name}</b>, x.cabang, rpShort(x.value), chg(x.value, x.prev), TIER[x.tier.toLowerCase()] || '-'])}
            onRow={(i) => profile(c.topCustomers[i].name)}
          />
        </Section>
        <Section title={tr('Mulai hilang — prioritas kunjungan')} note={tr('Order terakhir 3–12 bulan lalu, urut nilai historis.')}>
          <Table
            head={[tr('Customer'), tr('Cabang'), tr('Order terakhir'), tr('Hari'), tr('Nilai historis')]}
            right={[3, 4]}
            rows={c.lapsed.map((x) => [<b key="n">{x.name}</b>, x.cabang, x.last, x.days, rpShort(x.hist)])}
            onRow={(i) => profile(c.lapsed[i].name)}
          />
        </Section>
        <Section title={tr('Tumbuh terbesar')}>
          <Table head={[tr('Customer'), tr('Cabang'), tr('Periode ini'), tr('Sebelumnya')]} right={[2, 3]} rows={c.gainers.map((x) => [x.name, x.cabang, rpShort(x.value), rpShort(x.prev)])} />
        </Section>
        <Section title={tr('Turun terbesar')}>
          <Table head={[tr('Customer'), tr('Cabang'), tr('Periode ini'), tr('Sebelumnya')]} right={[2, 3]} rows={c.decliners.map((x) => [x.name, x.cabang, rpShort(x.value), rpShort(x.prev)])} />
        </Section>
        <Section title={tr('Customer baru')}>
          <Table head={[tr('Customer'), tr('Cabang'), tr('Order pertama'), tr('Realisasi')]} right={[3]} rows={c.newCustomers.map((x) => [x.name, x.cabang, x.date, rpShort(x.value)])} />
        </Section>
        {c.kam.length > 0 && (
          <Section title={tr('Key Account — porsi omzet 12 bulan')}>
            <Table head={[tr('Tier'), tr('Grup'), tr('Porsi omzet')]} right={[1, 2]} rows={c.kam.map((k) => [TIER[k.tier] || k.tier, k.groups, k.share == null ? '-' : `${k.share}%`])} />
          </Section>
        )}
      </div>

      {c.byCabang.length > 1 && (
        <Section title={tr('Status customer per cabang')}>
          <Table
            head={[tr('Cabang'), tr('Aktif'), tr('Berisiko'), tr('Dingin'), tr('Hilang'), tr('Baru (periode)')]}
            right={[1, 2, 3, 4, 5]}
            rows={c.byCabang.map((b) => [<b key="c">{b.cabang}</b>, b.aktif, b.risiko, b.dingin, b.hilang, b.baru])}
          />
        </Section>
      )}
    </>
  );
}
