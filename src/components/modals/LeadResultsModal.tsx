'use client';

import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { Kpi, Section, Table, rpShort } from '../analisa/ui';
import { PeriodRange, normRange, quickRanges, type PeriodRangeValue } from '../analisa/PeriodRange';
import { appendSheet } from '@/lib/exports';
import { formatDateID, todayStr } from '@/lib/format';
import { aggregate, inMonths, leadRows, OVERDUE_LABEL, type LeadAgg, type LeadRow } from '@/lib/lead-results';
import { LEAD_SOURCES, LEAD_STAGE_META } from '@/lib/leads';
import { canNow } from '@/hooks/useCan';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { useUiStore } from '@/store/useUiStore';

const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const hari = (x: number | null) => (x == null ? '–' : `${x.toLocaleString('id-ID')} hr`);

/**
 * Hasil Lead: lead Marketing per sumber & per cabang sampai penawaran, PO/DO
 * dan omzet; kecepatan respons cabang dan lead yang lewat batas waktu
 * (Batas Waktu & Margin). Data mengikuti cakupan role.
 */
export function LeadResultsModal() {
  const tr = useT();
  const show = useUiStore((s) => s.modal === 'leadResults');
  const closeModal = useUiStore((s) => s.closeModal);
  const prospects = useDataStore((s) => s.prospects);
  const rules = useDataStore((s) => s.opsRules);
  const toast = useDataStore((s) => s.toast);
  const [today] = useState(() => todayStr());
  const thisMonth = today.slice(0, 7);
  const [range, setRange] = useState<PeriodRangeValue>(() => normRange(quickRanges(thisMonth).find((q) => q.label === '12 bln')!.from, thisMonth));
  const [source, setSource] = useState('');
  const [cabang, setCabang] = useState('');
  const [onlyLate, setOnlyLate] = useState(false);

  const all = useMemo(() => leadRows(prospects, rules, today), [prospects, rules, today]);
  const rows = useMemo(() => all.filter((r) => inMonths(r, range.from, range.to) && (!source || r.source === source) && (!cabang || (r.p.cabang || '').toUpperCase() === cabang)), [all, range, source, cabang]);
  const cabangOpts = useMemo(() => Array.from(new Set(all.map((r) => (r.p.cabang || '').toUpperCase()).filter(Boolean))).sort(), [all]);
  const tot = useMemo(() => aggregate(rows, () => 'all', () => 'Semua')[0], [rows]);
  const bySource = useMemo(() => aggregate(rows, (r) => r.source, (r) => r.sourceLabel), [rows]);
  const byCabang = useMemo(() => aggregate(rows, (r) => (r.p.cabang || '-').toUpperCase(), (r) => (r.p.cabang || '-').toUpperCase()).sort((a, b) => b.overdue - a.overdue || (a.avgQuote ?? 99) - (b.avgQuote ?? 99)), [rows]);
  const late = useMemo(() => all.filter((r) => r.overdue && (!source || r.source === source) && (!cabang || (r.p.cabang || '').toUpperCase() === cabang)), [all, source, cabang]);
  const list = (onlyLate ? late : rows).slice().sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || b.leadAt.localeCompare(a.leadAt));

  const openLead = (r: LeadRow) => useUiStore.setState({ itemFlowCtx: { prospectId: r.p.id, mode: null, returnTo: 'leadResults' }, modal: 'itemFlow' });

  const aggRow = (a: LeadAgg, extra: 'sumber' | 'cabang') => [
    <b key="l">{a.label}</b>,
    a.n,
    extra === 'cabang' ? `${a.assigned}/${a.n}` : pct(a.n ? a.quoted / a.n : null),
    extra === 'cabang' ? hari(a.avgAssign) : a.won,
    extra === 'cabang' ? hari(a.avgQuote) : pct(a.conv),
    extra === 'cabang' ? (a.overdue ? <span className="badge rust">{a.overdue}</span> : '0') : rpShort(a.wonValue),
    extra === 'cabang' ? pct(a.conv) : rpShort(a.perLead),
  ];

  async function exportExcel() {
    if (!rows.length) return toast(tr('Tidak ada lead pada periode ini'), 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    appendSheet(XLSX, wb, {
      sheetName: 'Lead',
      header: ['TGL LEAD', 'SUMBER', 'CUSTOMER', 'CABANG', 'SALES', 'DIMASUKKAN OLEH', 'TAHAP', 'HARI KE SALES DITUNJUK', 'HARI KE PENAWARAN', 'NILAI', 'TERLAMBAT'],
      rows: rows.map((r) => [formatDateID(r.leadAt), r.sourceLabel, r.p.customer, r.p.cabang || '', r.p.se || '', r.p.leadBy || '', LEAD_STAGE_META[r.stage].label, r.dAssign ?? '', r.dQuote ?? '', Math.round(r.value), r.overdue ? OVERDUE_LABEL[r.overdue] : '']),
      colWidths: [11, 18, 30, 8, 8, 16, 20, 12, 12, 14, 20].map((wch) => ({ wch })),
      numFormats: { 9: '#,##0' },
    });
    appendSheet(XLSX, wb, {
      sheetName: 'Per Sumber',
      header: ['SUMBER', 'LEAD', 'SAMPAI PENAWARAN', 'PO/DO', 'KONVERSI %', 'NILAI PO/DO', 'NILAI PER LEAD'],
      rows: bySource.map((a) => [a.label, a.n, a.quoted, a.won, a.conv == null ? '' : Math.round(a.conv * 100), Math.round(a.wonValue), Math.round(a.perLead)]),
      colWidths: [22, 8, 16, 8, 11, 16, 16].map((wch) => ({ wch })),
      numFormats: { 5: '#,##0', 6: '#,##0' },
    });
    appendSheet(XLSX, wb, {
      sheetName: 'Per Cabang',
      header: ['CABANG', 'LEAD', 'SUDAH ADA SALES', 'RATA2 HARI KE SALES', 'RATA2 HARI KE PENAWARAN', 'TERLAMBAT SEKARANG', 'KONVERSI %'],
      rows: byCabang.map((a) => [a.label, a.n, a.assigned, a.avgAssign ?? '', a.avgQuote ?? '', a.overdue, a.conv == null ? '' : Math.round(a.conv * 100)]),
      colWidths: [9, 8, 14, 18, 22, 18, 11].map((wch) => ({ wch })),
    });
    XLSX.writeFile(wb, `Hasil_Lead_${range.from || 'semua'}_${range.to || ''}.xlsx`);
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title={tr('Hasil Lead')}
      xwide
      footer={
        <>
          {canNow('marketing', 'x') && <button type="button" className="btn btn-outline" onClick={() => void exportExcel()}>{tr('Export Excel')}</button>}
          <button type="button" className="btn btn-outline" onClick={closeModal}>{tr('Tutup')}</button>
        </>
      }
    >
      <div className="toolbar-row lr-filters">
        <PeriodRange value={range} onChange={setRange} thisMonth={thisMonth} max={thisMonth} allowAll label="Lead masuk" />
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={tr('Sumber lead')}>
          <option value="">{tr('Semua sumber')}</option>
          {LEAD_SOURCES.map((s) => <option key={s.key} value={s.key}>{tr(s.label)}</option>)}
        </select>
        {cabangOpts.length > 1 && (
          <select value={cabang} onChange={(e) => setCabang(e.target.value)} aria-label={tr('Cabang')}>
            <option value="">{tr('Semua Cabang')}</option>
            {cabangOpts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      <div className="kpi-grid">
        <Kpi label={tr('Lead masuk')} value={tot?.n ?? 0} foot={`${tot?.assigned ?? 0} ${tr('sudah ada Sales')}`} />
        <Kpi label={tr('Sampai penawaran')} value={pct(tot && tot.n ? tot.quoted / tot.n : null)} foot={`${tot?.quoted ?? 0} ${tr('lead')} · ${tr('rata-rata')} ${hari(tot?.avgQuote ?? null)}`} tone="aktif" />
        <Kpi label={tr('PO / DO')} value={tot?.won ?? 0} foot={`${pct(tot?.conv ?? null)} ${tr('dari lead')} · ${rpShort(tot?.wonValue ?? 0)}`} tone="won" />
        <Kpi label={tr('Respons cabang')} value={hari(tot?.avgAssign ?? null)} foot={tr('rata-rata sampai Sales ditunjuk')} />
        <Kpi label={tr('Terlambat sekarang')} value={late.length} foot={`${tr('batas')}: ${rules.leadTugasHari}/${rules.leadPenawaranHari}/${rules.leadEskalasiHari} ${tr('hari')}`} tone={late.length ? 'lost' : ''} />
      </div>

      {tot && tot.n > 0 && (
        <div className="lr-funnel" aria-label={tr('Corong lead')}>
          {([
            [tr('Lead'), tot.n],
            [tr('Ada Sales'), tot.assigned],
            [tr('Penawaran'), tot.quoted],
            [tr('PO / DO'), tot.won],
          ] as const).map(([l, v]) => (
            <div key={l} className="lr-step">
              <i style={{ width: `${Math.max(4, Math.round((v / tot.n) * 100))}%` }} />
              <span>{l}</span>
              <b className="mono">{v}</b>
            </div>
          ))}
        </div>
      )}

      <div className="lr-cols">
        <Section title={tr('Per sumber lead')} note={tr('Sumber mana yang benar-benar menghasilkan PO, bukan sekadar banyak lead.')}>
          <Table head={[tr('Sumber'), tr('Lead'), tr('Sampai penawaran'), 'PO/DO', tr('Konversi'), tr('Nilai PO/DO'), tr('Nilai / lead')]} right={[1, 2, 3, 4, 5, 6]} rows={bySource.map((a) => aggRow(a, 'sumber'))} empty={tr('Belum ada lead pada periode ini')} />
        </Section>
        <Section title={tr('Respons per cabang')} note={tr('Rata-rata hari sejak lead masuk sampai Sales ditunjuk dan sampai penawaran pertama. Cabang dengan lead terlambat di atas.')}>
          <Table head={[tr('Cabang'), tr('Lead'), tr('Ada Sales'), tr('Ke Sales'), tr('Ke penawaran'), tr('Terlambat'), tr('Konversi')]} right={[1, 2, 3, 4, 5, 6]} rows={byCabang.map((a) => aggRow(a, 'cabang'))} empty={tr('Belum ada lead pada periode ini')} />
        </Section>
      </div>

      <Section
        title={onlyLate ? tr('Lead terlambat ditindaklanjuti') : tr('Daftar lead')}
        right={
          <span className="seg-switch">
            <button type="button" className={`btn btn-sm ${!onlyLate ? 'btn-primary' : 'btn-outline'}`} onClick={() => setOnlyLate(false)}>{tr('Periode ini')}</button>
            <button type="button" className={`btn btn-sm ${onlyLate ? 'btn-primary' : 'btn-outline'}`} onClick={() => setOnlyLate(true)}>{tr('Terlambat')} ({late.length})</button>
          </span>
        }
      >
        <Table
          head={[tr('Tgl lead'), tr('Customer'), tr('Cabang'), 'SE', tr('Sumber'), tr('Tahap'), tr('Ke Sales'), tr('Ke penawaran'), tr('Nilai')]}
          right={[6, 7, 8]}
          onRow={(i) => openLead(list[i])}
          empty={onlyLate ? tr('Tidak ada lead yang terlambat.') : tr('Belum ada lead pada periode ini')}
          rows={list.slice(0, 300).map((r) => [
            formatDateID(r.leadAt),
            <span key="c"><b>{r.p.customer}</b>{r.overdue && <span className="badge rust" style={{ marginLeft: 6 }}>{tr(OVERDUE_LABEL[r.overdue])}</span>}</span>,
            r.p.cabang || '-',
            r.p.se || '-',
            tr(r.sourceLabel),
            <span key="s" className={`badge ${LEAD_STAGE_META[r.stage].badge}`}>{tr(LEAD_STAGE_META[r.stage].label)}</span>,
            hari(r.dAssign),
            hari(r.dQuote),
            r.value ? rpShort(r.value) : '-',
          ])}
        />
      </Section>
      <div className="field-note">{tr('Waktu respons dihitung dari lead yang masuk setelah fitur ini aktif (lead lama tanpa catatan waktu tampil "–"). Batas waktu & eskalasi otomatis diatur Admin di Batas Waktu & Margin.')}</div>
    </Modal>
  );
}
