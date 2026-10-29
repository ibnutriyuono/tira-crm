'use client';

import { useMemo, useState } from 'react';
import { IconDownload } from '../icons';
import { buildExecAnalysis, type ExecScope } from '@/lib/exec-analysis';
import { buildBranchScorecard, type BranchScore } from '@/lib/exec-more';
import { formatRupiah } from '@/lib/format';
import { canNow } from '@/hooks/useCan';
import type { Prospect, SalesActivity } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { useT } from '@/store/useLangStore';
import { PeriodRange, normRange, rangeMonths, type PeriodRangeValue } from './PeriodRange';
import { Bars, Heat, Insights, Kpi, Section, rpShort } from './ui';

/**
 * Analisa Eksekutif › Cabang: scorecard semua aspek per cabang — target,
 * win rate, pipeline, disiplin follow-up, aktivitas, masalah, faktur, RFQ,
 * customer — dengan skor indikatif dan peringkat.
 */
export function BranchTab({ scope, prospects, activities, thisMonth, isStaff }: { scope: ExecScope; prospects: Prospect[]; activities: SalesActivity[] | null; thisMonth: string; isStaff: (se: string) => boolean }) {
  const tr = useT();
  const toast = useDataStore((s) => s.toast);
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const salesPlans = useDataStore((s) => s.salesPlans);
  const issues = useDataStore((s) => s.issues);
  const rfqs = useDataStore((s) => s.rfqs);
  const [range, setRange] = useState<PeriodRangeValue>(() => normRange(`${thisMonth.slice(0, 4)}-01`, thisMonth));
  const [sel, setSel] = useState('');
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  const rows = useMemo(() => {
    const ea = buildExecAnalysis(prospects, budgetTargets, salesPlans, scope, range.from, formatRupiah, new Date(`${today}T12:00:00`), range.to);
    return buildBranchScorecard({
      prospects,
      forecast: ea.rows.map((r) => ({ cabang: r.cabang, reg: r.reg, target: r.target, won: r.won })),
      activities,
      issues,
      rfqs,
      range: { months: rangeMonths(range), today },
      isStaff,
      cabangs: scope.cabangs,
    });
  }, [prospects, budgetTargets, salesPlans, scope, range, today, activities, issues, rfqs, isStaff]);

  const detail = rows.find((r) => r.cabang === sel) || null;
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0;
  const tot = rows.reduce((s, r) => ({ t: s.t + r.target, w: s.w + r.won, f: s.f + r.flags.length }), { t: 0, w: 0, f: 0 });
  const insights: string[] = [];
  if (rows.length) {
    insights.push(`Skor tertinggi: ${rows.slice(0, 3).map((r) => `${r.cabang} (${r.score})`).join(', ')}; terendah: ${rows.slice(-3).reverse().map((r) => `${r.cabang} (${r.score})`).join(', ')}.`);
    const fu = [...rows].filter((r) => r.openCount >= 5).sort((a, b) => (b.noFu + b.fuLate) / b.openCount - (a.noFu + a.fuLate) / a.openCount)[0];
    if (fu && fu.noFu + fu.fuLate > 0) insights.push(`Disiplin follow-up terlemah: ${fu.cabang} — ${fu.noFu + fu.fuLate} dari ${fu.openCount} prospek aktif tanpa jadwal / terlambat.`);
    const wr = rows.filter((r) => r.winRate != null && r.wonCount + r.lostCount >= 4).sort((a, b) => (a.winRate ?? 0) - (b.winRate ?? 0))[0];
    if (wr) insights.push(`Win rate terendah: ${wr.cabang} ${wr.winRate}% (${wr.wonCount} menang, ${wr.lostCount} kalah).`);
    const git = rows.filter((r) => r.gitOld).sort((a, b) => b.gitOldValue - a.gitOldValue)[0];
    if (git) insights.push(`DO belum faktur > 30 hari terbesar di ${git.cabang}: ${git.gitOld} DO (${rpShort(git.gitOldValue)}).`);
  }

  async function exportExcel() {
    if (!rows.length) return toast('Tidak ada data', 'error');
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        rows.map((r) => ({
          Peringkat: r.rank, Cabang: r.cabang, Regional: r.reg ?? '', Skor: r.score, Target: r.target, Realisasi: r.won, 'Ach %': r.ach ?? '', 'Win rate %': r.winRate ?? '', Menang: r.wonCount, Kalah: r.lostCount,
          'Rata-rata deal': Math.round(r.avgDeal), Pipeline: r.pipeline, 'Pipeline berbobot': Math.round(r.weighted), Coverage: r.coverage ?? '', 'Prospek aktif': r.openCount, 'Tanpa FU': r.noFu, 'FU terlambat': r.fuLate, 'Diam > 30 hr': r.aging,
          SE: r.seCount, Aktivitas: r.aktivitas, 'Aktivitas/SE': r.aktPerSe, Kunjungan: r.kunjungan, 'Masalah terbuka': r.issuesOpen, 'DO belum faktur > 30 hr': r.gitOld, RFQ: r.rfqCount, 'Median jawab RFQ (hr)': r.rfqAnswerDays ?? '', 'Customer aktif': r.custActive, 'Customer baru': r.custNew, Catatan: r.flags.join('; '),
        })),
      ),
      'Scorecard Cabang',
    );
    XLSX.writeFile(wb, `Scorecard_Cabang_${range.from}_${range.to}.xlsx`);
  }

  const pct = (v: number | null) => (v == null ? '-' : `${v}%`);
  return (
    <>
      <div className="toolbar-row ea-bar-row">
        <PeriodRange value={range} onChange={setRange} thisMonth={thisMonth} label="Periode" />
        {canNow('analisa', 'x') && <button type="button" className="btn btn-outline btn-sm" onClick={exportExcel}><IconDownload /> Excel</button>}
      </div>
      <div className="kpi-grid">
        <Kpi label={tr('Cabang dinilai')} value={rows.length} foot={`${tr('rata-rata skor')} ${avg}`} />
        <Kpi tone="won" label={tr('Realisasi')} value={rpShort(tot.w)} foot={tot.t ? `${Math.round((tot.w / tot.t) * 100)}% ${tr('dari target')} ${rpShort(tot.t)}` : tr('target belum diisi')} />
        <Kpi label={tr('Skor terbaik')} value={rows[0] ? `${rows[0].cabang} · ${rows[0].score}` : '-'} />
        <Kpi tone="lost" label={tr('Perlu perhatian')} value={rows.filter((r) => r.score < 60).length} foot={tr('cabang skor < 60')} />
      </div>
      <Insights list={insights} />

      <Section title={tr('Scorecard cabang')} note={tr('Skor indikatif 0–100: pencapaian target 30, win rate 15, aktivitas per SE 20, disiplin follow-up 15, pipeline bergerak 10, cakupan pipeline 10. Klik baris untuk rinciannya.')}>
        <div className="table-wrap" style={{ borderTop: 'none' }}>
          <table className="simple-table ea-tbl ea-score">
            <thead>
              <tr>
                <th>#</th><th>{tr('Cabang')}</th><th className="r">{tr('Skor')}</th><th className="r">{tr('Target')}</th><th className="r">{tr('Realisasi')}</th><th>{tr('Ach.')}</th><th>{tr('Win rate')}</th>
                <th className="r">{tr('Pipeline')}</th><th>{tr('Coverage')}</th><th>{tr('FU tertib')}</th><th>{tr('Bergerak')}</th><th className="r">{tr('Akt./SE')}</th><th className="r">{tr('Masalah')}</th><th className="r">{tr('DO > 30 hr')}</th><th className="r">{tr('Cust. baru')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fuOk = r.openCount ? 100 - Math.round(((r.noFu + r.fuLate) / r.openCount) * 100) : null;
                const mv = r.openCount ? 100 - Math.round((r.aging / r.openCount) * 100) : null;
                return (
                  <tr key={r.cabang} className={`if-row ${sel === r.cabang ? 'sel' : ''}`} onClick={() => setSel(sel === r.cabang ? '' : r.cabang)}>
                    <td className="mono">{r.rank}</td>
                    <td><b>{r.cabang}</b>{r.reg != null && <div className="field-note" style={{ margin: 0 }}>Reg {r.reg}</div>}</td>
                    <td className="r"><Heat v={r.score}><b>{r.score}</b></Heat></td>
                    <td className="r mono">{rpShort(r.target)}</td>
                    <td className="r mono">{rpShort(r.won)}</td>
                    <td><Heat v={r.ach == null ? null : Math.min(100, r.ach)}>{pct(r.ach)}</Heat></td>
                    <td><Heat v={r.winRate == null ? null : Math.min(100, r.winRate * 2)}>{pct(r.winRate)}</Heat></td>
                    <td className="r mono">{rpShort(r.pipeline)}</td>
                    <td><Heat v={r.coverage == null ? null : Math.min(100, Math.round((r.coverage / 1.5) * 100))}>{r.coverage == null ? '-' : `${r.coverage.toLocaleString('id-ID')}×`}</Heat></td>
                    <td><Heat v={fuOk}>{pct(fuOk)}</Heat></td>
                    <td><Heat v={mv}>{pct(mv)}</Heat></td>
                    <td className="r mono">{activities ? r.aktPerSe : '-'}</td>
                    <td className="r mono">{r.issuesOpen}</td>
                    <td className="r mono">{r.gitOld}</td>
                    <td className="r mono">{r.custNew}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {detail && <BranchDetail r={detail} />}
    </>
  );
}

function BranchDetail({ r }: { r: BranchScore }) {
  const tr = useT();
  return (
    <Section title={`${tr('Rincian cabang')} ${r.cabang} — ${tr('peringkat')} ${r.rank}, ${tr('skor')} ${r.score}`}>
      <div className="ea-grid2">
        <div>
          <Bars items={r.parts.map((p) => ({ label: `${p.label} (${p.weight})`, value: p.value, color: p.value >= 85 ? '#2F8F5B' : p.value >= 65 ? '#C47F2C' : '#B94A3D' }))} max={100} />
          {r.flags.length > 0 && (
            <div className="ea-flags">
              {r.flags.map((f) => <span key={f} className="badge rust">{f}</span>)}
            </div>
          )}
        </div>
        <dl className="ea-dl">
          <dt>{tr('Menang / kalah')}</dt><dd>{r.wonCount} / {r.lostCount} · {tr('rata-rata deal')} {rpShort(r.avgDeal)}</dd>
          <dt>{tr('Pipeline aktif')}</dt><dd>{r.openCount} {tr('prospek')} · {rpShort(r.pipeline)} ({tr('berbobot')} {rpShort(r.weighted)})</dd>
          <dt>{tr('Follow-up')}</dt><dd>{r.noFu} {tr('tanpa jadwal')} · {r.fuLate} {tr('terlambat')} · {r.aging} {tr('diam > 30 hari')}</dd>
          <dt>{tr('Aktivitas')}</dt><dd>{r.aktivitas} ({r.seCount} SE · {r.aktPerSe}/SE) · {r.kunjungan} {tr('kunjungan')}</dd>
          <dt>{tr('Masalah pipeline')}</dt><dd>{r.issuesOpen} {tr('terbuka')} · {r.issuesLate} {tr('lebih dari 7 hari')}</dd>
          <dt>{tr('Faktur')}</dt><dd>{r.gitOld} {tr('DO belum faktur > 30 hari')} ({rpShort(r.gitOldValue)})</dd>
          <dt>RFQ</dt><dd>{r.rfqCount} {tr('dikirim')} · {tr('median jawab')} {r.rfqAnswerDays == null ? '-' : `${(Math.round(r.rfqAnswerDays * 10) / 10).toLocaleString('id-ID')} ${tr('hari')}`}</dd>
          <dt>{tr('Customer')}</dt><dd>{r.custActive} {tr('aktif')} · {r.custNew} {tr('baru di periode ini')}</dd>
        </dl>
      </div>
    </Section>
  );
}
