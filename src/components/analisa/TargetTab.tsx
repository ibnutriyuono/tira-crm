'use client';

import { useMemo, useState } from 'react';
import { IconDownload } from '../icons';
import { appendSheet } from '@/lib/exports';
import { BULAN_LIST } from '@/lib/constants';
import { achSignal, buildTargetAchievement } from '@/lib/target-achievement';
import { localToday } from '@/lib/sales-activity';
import { workingDays } from '@/lib/activity-kpi';
import type { Prospect } from '@/lib/types';
import { useDataStore } from '@/store/useDataStore';
import { canNow } from '@/hooks/useCan';
import { periodeLabel } from '@/lib/exec-analysis';
import { PeriodRange, type PeriodRangeValue } from './PeriodRange';

import { useT } from '@/store/useLangStore';
const BLN3 = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Laju hari kerja bulan berjalan s.d. hari ini. */
function workPace(today: string): number {
  const d = workingDays(today.slice(0, 7));
  return d.length ? d.filter((x) => x <= today).length / d.length : 0;
}

/** Rp ringkas: 6,22 M / 850 jt. */
function rpShort(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}Rp ${(a / 1e9).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `${s}Rp ${Math.round(a / 1e6).toLocaleString('id-ID')} jt`;
  if (a === 0) return 'Rp 0';
  return `${s}Rp ${Math.round(a).toLocaleString('id-ID')}`;
}
const pct = (r: number | null) => (r == null || !Number.isFinite(r) ? '–' : `${Math.round(r * 100)}%`);
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

const SIG_LABEL = { ok: 'Sesuai / di atas laju', warn: 'Sedikit tertinggal', bad: 'Jauh tertinggal' } as const;

function Chip({ sig, done, ach }: { sig: 'ok' | 'warn' | 'bad' | null; done?: boolean; ach?: number | null }) {
  const tr = useT();
  if (!sig) return <span className="tg-chip none">{tr("Target belum ada")}</span>;
  const text = done ? ((ach ?? 0) >= 1 ? 'Tercapai' : 'Tidak tercapai') : SIG_LABEL[sig];
  return <span className={`tg-chip ${sig}`}>{text}</span>;
}

function Bar({ ach, git, pace, sig, small }: { ach: number | null; git: number; pace: number | null; sig: 'ok' | 'warn' | 'bad' | null; small?: boolean }) {
  const a = Math.min(1, Math.max(0, ach || 0));
  const g = Math.max(0, Math.min(1 - a, git));
  return (
    <div className={`tg-bar ${small ? 'sm' : ''}`}>
      <span className={`fill ${sig || ''}`} style={{ width: `${a * 100}%` }} />
      {g > 0 && <span className="git" style={{ left: `${a * 100}%`, width: `${g * 100}%` }} />}
      {pace != null && <span className="mark" style={{ left: `${pace * 100}%` }} aria-hidden="true" />}
    </div>
  );
}

/**
 * Analisa Eksekutif > Target: target bulan ini & YTD vs omzet terfaktur,
 * dengan GIT sebagai potensi dan rincian per cabang.
 */
export function TargetTab({ prospects, scopeLabel, cabangs, isSe }: { prospects: Prospect[]; scopeLabel: string; cabangs: string[]; isSe: boolean }) {
  const tr = useT();
  const budgetTargets = useDataStore((s) => s.budgetTargets);
  const toast = useDataStore((s) => s.toast);
  const today = localToday();
  const thisMonth = today.slice(0, 7);
  const [range, setRange] = useState<PeriodRangeValue>({ from: thisMonth, to: thisMonth });
  const year = range.to.slice(0, 4);
  const month = Number(range.to.slice(5, 7));
  const from = range.from;
  const setMonth = (m: number) => {
    const p = `${year}-${String(m).padStart(2, '0')}`;
    setRange({ from: p, to: p });
  };
  const [cabang, setCabang] = useState('');
  const [showGit, setShowGit] = useState(true);

  const t = useMemo(
    () => buildTargetAchievement(prospects, budgetTargets, cabang ? [cabang] : cabangs, { year, month, from, today, allProspects: isSe }),
    [prospects, budgetTargets, cabang, cabangs, year, month, from, today, isSe],
  );
  // Rincian per cabang selalu atas seluruh cakupan, tidak terpengaruh filter cabang.
  const all = useMemo(
    () => (isSe || cabangs.length < 2 ? null : buildTargetAchievement(prospects, budgetTargets, cabangs, { year, month, from, today })),
    [isSe, cabangs, prospects, budgetTargets, year, month, from, today],
  );

  const single = t.periodes.length === 1;
  const monthName = single ? `${BULAN_LIST[month - 1].l} ${year}` : periodeLabel(t.from, t.to);
  const inRange = new Set(t.periodes);
  const scopeText = isSe ? scopeLabel : cabang ? `Cabang ${cabang}` : scopeLabel;

  // kartu bulan
  const ach = ratio(t.real, t.target);
  const vsPace = ach == null ? null : t.isCurrent ? (t.pace ? ach / t.pace : null) : ach;
  const mSig = achSignal(vsPace);
  const sisa = t.target - t.real;
  const left = t.workdays - t.elapsed;
  const perDay = t.elapsed ? t.real / t.elapsed : 0;
  const need = sisa > 0 && left > 0 ? sisa / left : null;

  // kartu YTD
  const yAch = ratio(t.ytdReal, t.ytdTarget);
  const ySig = achSignal(yAch);
  const endIsCurrent = thisMonth === range.to;
  const closedMonths = t.months.slice(0, endIsCurrent ? month - 1 : month);
  const hitMonths = closedMonths.filter((m) => m.target > 0 && m.real >= m.target).length;
  const proj = ratio(t.runRate, t.yearTarget);
  const shown = t.months.slice(0, month);
  const maxV = Math.max(1, ...shown.map((m) => Math.max(m.target, m.real + (showGit && inRange.has(`${year}-${String(m.month).padStart(2, '0')}`) ? m.git : 0))));

  const rows = (all?.rows || [])
    .map((r) => {
      const a = ratio(r.real, r.target);
      const vp = a == null ? null : t.isCurrent ? (t.pace ? a / t.pace : null) : a;
      return { ...r, a, vp, ya: ratio(r.ytdReal, r.ytdTarget) };
    })
    .sort((x, y) => (x.vp ?? -1) - (y.vp ?? -1));

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    appendSheet(XLSX, wb, {
      sheetName: 'Per Bulan',
      header: ['BULAN', 'TARGET', 'TERFAKTUR', 'GIT', 'CAPAIAN'],
      rows: t.months.slice(0, month).map((m) => [`${BLN3[m.month - 1]} ${year}`, Math.round(m.target), Math.round(m.real), Math.round(m.git), m.target ? m.real / m.target : '']),
      colWidths: [{ wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 10 }],
      numFormats: { 1: '#,##0', 2: '#,##0', 3: '#,##0', 4: '0%' },
    });
    if (rows.length) {
      appendSheet(XLSX, wb, {
        sheetName: 'Per Cabang',
        header: ['CABANG', single ? `TARGET ${BLN3[month - 1].toUpperCase()}` : 'TARGET PERIODE', 'TERFAKTUR', 'GIT', 'CAPAIAN', 'TARGET YTD', 'TERFAKTUR YTD', 'CAPAIAN YTD'],
        rows: rows.map((r) => [r.cabang, Math.round(r.target), Math.round(r.real), Math.round(r.git), r.a ?? '', Math.round(r.ytdTarget), Math.round(r.ytdReal), r.ya ?? '']),
        colWidths: [{ wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 12 }],
        numFormats: { 1: '#,##0', 2: '#,##0', 3: '#,##0', 4: '0%', 5: '#,##0', 6: '#,##0', 7: '0%' },
      });
    }
    XLSX.writeFile(wb, `Target_vs_Pencapaian_${scopeText.replace(/[^\w-]+/g, '_')}_${single ? t.to : `${t.from}_sd_${t.to}`}.xlsx`);
    toast('Excel target vs pencapaian diunduh', 'success');
  }

  return (
    <>
      <div className="toolbar-row" style={{ alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        {!isSe && cabangs.length > 1 && (
          <select value={cabang} onChange={(e) => setCabang(e.target.value)} style={{ maxWidth: 170 }} aria-label={tr("Cabang")}>
            <option value="">{tr("Semua cabang")}</option>
            {cabangs.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <PeriodRange value={range} onChange={(v) => v.from && setRange(v)} thisMonth={thisMonth} max={thisMonth} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={showGit} onChange={(e) => setShowGit(e.target.checked)} /> {tr("Tampilkan GIT sebagai potensi")}
        </label>
        {canNow('analisa', 'x') && (
          <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={exportExcel}>
            <IconDownload /> {tr("Export Excel")}
          </button>
        )}
      </div>
      {isSe && <div className="field-note" style={{ marginTop: -4, marginBottom: 10 }}>{tr("Target yang ditampilkan adalah target cabang sebagai acuan; pencapaian = DO terfaktur milik Anda.")}</div>}

      <div className="tg-grid">
        <div className="tg-card">
          <div className="tg-card-head">
            <span>{single ? tr("Target bulan ini ·") : tr("Target periode ·")} {monthName}{single ? '' : ` (${t.periodes.length} bln)`}</span>
            <Chip sig={mSig} done={!t.isCurrent} ach={ach} />
          </div>
          {t.target > 0 ? (
            <>
              <div className="tg-big">
                <span className={`num ${mSig || ''}`}>{pct(ach)}</span>
                <span>
                  <b>{rpShort(t.real)}</b> {tr("terfaktur dari target")} <b>{rpShort(t.target)}</b>
                </span>
              </div>
              <Bar ach={ach} git={showGit ? t.git / t.target : 0} pace={t.isCurrent ? t.pace : null} sig={mSig} />
              {t.isCurrent && (
                <div className="tg-pace" style={{ paddingLeft: `${Math.min(55, t.pace * 100)}%` }}>
                  {tr("seharusnya")} {pct(t.pace)} {tr("· hari kerja ke-")}{t.elapsed}/{t.workdays}
                </div>
              )}
              <div className="tg-facts">
                {t.isCurrent ? (
                  <>
                    <Fact label={sisa > 0 ? tr("Sisa target") : tr("Melebihi target")} value={rpShort(Math.abs(sisa))} sub={sisa > 0 ? `${left} hari kerja lagi` : 'sudah tercapai'} tone={sisa > 0 ? '' : 'ok'} />
                    <Fact label={tr("Perlu per hari kerja")} value={need == null ? '–' : rpShort(need)} sub={`rata-rata sejauh ini ${rpShort(perDay)}`} tone={need != null && need > perDay * 1.5 ? 'bad' : ''} />
                  </>
                ) : (
                  <>
                    <Fact label={sisa > 0 ? tr("Kurang dari target") : tr("Lebih dari target")} value={rpShort(Math.abs(sisa))} sub={single ? tr("bulan sudah selesai") : tr("periode sudah selesai")} tone={sisa > 0 ? 'bad' : 'ok'} />
                    <Fact label={tr("Rata-rata per hari kerja")} value={rpShort(t.workdays ? t.real / t.workdays : 0)} sub={`${t.workdays} hari kerja`} />
                  </>
                )}
                <Fact label={tr("GIT belum faktur")} value={rpShort(t.git)} sub={t.git ? `bila terfaktur → ${pct(ratio(t.real + t.git, t.target))}` : 'tidak ada DO belum faktur'} tone="git" />
              </div>
            </>
          ) : (
            <div className="tg-empty">
              {tr("Target")} {monthName} {tr("untuk")} <b>{scopeText}</b> {tr("belum diisi (KPI › Atur target). Omzet terfaktur bulan ini")} <b>{rpShort(t.real)}</b>
              {t.git ? <>{tr(", GIT")} <b>{rpShort(t.git)}</b></> : null}.
            </div>
          )}
        </div>

        <div className="tg-card">
          <div className="tg-card-head">
            <span>{tr("YTD · Januari –")} {BULAN_LIST[month - 1].l} {year}</span>
            <Chip sig={ySig} />
          </div>
          <div className="tg-big">
            <span className={`num ${ySig || ''}`}>{pct(yAch)}</span>
            <span>
              <b>{rpShort(t.ytdReal)}</b> {tr("dari target")} <b>{rpShort(t.ytdTarget)}</b>
              {endIsCurrent && t.ytdTargetFull !== t.ytdTarget && <small> {tr("(s.d. hari ini; penuh s.d.")} {BLN3[month - 1]} {rpShort(t.ytdTargetFull)})</small>}
            </span>
          </div>
          <div className="tg-chart" role="group" aria-label={tr("Target dan terfaktur per bulan")}>
            {shown.map((m) => {
              const a = ratio(m.real, m.target);
              const mp = `${year}-${String(m.month).padStart(2, '0')}`;
              const sel = inRange.has(mp);
              const live = mp === thisMonth;
              const mDays = live ? workPace(today) : 1;
              const sig = achSignal(a == null ? null : live ? (mDays ? a / mDays : null) : a);
              const g = showGit && sel ? m.git : 0;
              const label = `${BULAN_LIST[m.month - 1].l}: ${rpShort(m.real)} dari target ${rpShort(m.target)} (${pct(a)})`;
              return (
                <button key={m.month} type="button" className={`col ${sel ? 'on' : ''}`} onClick={() => setMonth(m.month)} title={label} aria-label={label}>
                  <span className={`p ${sig || ''}`}>{pct(a)}</span>
                  <span className="area">
                    {m.target > 0 && <span className="t" style={{ height: `${(m.target / maxV) * 100}%` }} />}
                    <span className={`r ${sig || ''}`} style={{ height: `${(m.real / maxV) * 100}%` }} />
                    {g > 0 && <span className="g" style={{ bottom: `${(m.real / maxV) * 100}%`, height: `${(g / maxV) * 100}%` }} />}
                  </span>
                  <span className="l">{BLN3[m.month - 1]}</span>
                </button>
              );
            })}
          </div>
          <div className="tg-facts">
            <Fact
              label={t.ytdReal >= t.ytdTarget ? tr("Lebih dari target YTD") : tr("Kurang dari target YTD")}
              value={rpShort(Math.abs(t.ytdTarget - t.ytdReal))}
              sub={`bulan tercapai ${hitMonths} dari ${closedMonths.length}`}
              tone={t.ytdReal >= t.ytdTarget ? 'ok' : 'bad'}
            />
            <Fact label={tr("Proyeksi akhir tahun")} value={rpShort(t.runRate)} sub={`run-rate · ${pct(proj)} target ${year}`} tone={achSignal(proj) || ''} />
            <Fact label={`Target ${year}`} value={rpShort(t.yearTarget)} sub={`sisa ${rpShort(Math.max(0, t.yearTarget - t.ytdReal))} · ${12 - month + (endIsCurrent ? 1 : 0)} bln`} />
          </div>
        </div>
      </div>

      <div className="tg-legend">
        <span><i className="sw ok" />{tr("Terfaktur (DO sudah faktur)")}</span>
        {showGit && <span><i className="sw git" />{tr("GIT (DO belum faktur) — potensi")}</span>}
        <span><i className="sw tgt" />{tr("Target")}</span>
        <span><i className="sw mark" />{tr("Seharusnya s.d. hari ini (hari kerja Senin–Jumat)")}</span>
      </div>

      {rows.length > 0 && (
        <>
          <div className="tg-sec-head">
            <b>{tr("Rincian per cabang ·")} {monthName}</b>
            <span className="field-note" style={{ margin: 0 }}>{tr("Urut dari capaian terendah · klik baris untuk melihat cabang itu")}</span>
          </div>
          <div className="table-wrap" style={{ borderTop: 'none' }}>
            <table className="simple-table tg-table">
              <thead>
                <tr>
                  <th>{tr("Cabang")}</th>
                  <th className="r">{tr("Target")}</th>
                  <th className="r">{tr("Terfaktur")}</th>
                  <th className="r">GIT</th>
                  <th style={{ minWidth: 220 }}>{tr("Capaian")} {t.isCurrent ? tr("vs laju") : ''}</th>
                  <th className="r">{tr("Target YTD")}</th>
                  <th className="r">{tr("Terfaktur YTD")}</th>
                  <th style={{ minWidth: 170 }}>{tr("Capaian YTD")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.cabang} className={cabang === r.cabang ? 'on' : ''} onClick={() => setCabang(cabang === r.cabang ? '' : r.cabang)} title={`Lihat ${r.cabang}`}>
                    <td><b>{r.cabang}</b></td>
                    <td className="r mono">{r.target ? rpShort(r.target) : '–'}</td>
                    <td className="r mono">{rpShort(r.real)}</td>
                    <td className="r mono tg-gitc">{r.git ? rpShort(r.git) : '–'}</td>
                    <td>
                      {r.target > 0 ? (
                        <div className="tg-cell">
                          <Bar small ach={r.a} git={showGit ? r.git / r.target : 0} pace={t.isCurrent ? t.pace : null} sig={achSignal(r.vp)} />
                          <span className={`mono ${achSignal(r.vp) || ''}`}>{pct(r.a)}</span>
                        </div>
                      ) : (
                        <span className="badge rust">{tr("Target belum diisi")}</span>
                      )}
                    </td>
                    <td className="r mono">{r.ytdTarget ? rpShort(r.ytdTarget) : '–'}</td>
                    <td className="r mono">{rpShort(r.ytdReal)}</td>
                    <td>
                      <div className="tg-cell">
                        <Bar small ach={r.ya} git={0} pace={null} sig={achSignal(r.ya)} />
                        <span className={`mono ${achSignal(r.ya) || ''}`}>{pct(r.ya)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {all && (
                  <tr className="total">
                    <td>{tr("Total")}</td>
                    <td className="r mono">{rpShort(all.target)}</td>
                    <td className="r mono">{rpShort(all.real)}</td>
                    <td className="r mono tg-gitc">{rpShort(all.git)}</td>
                    <td className="mono">{pct(ratio(all.real, all.target))}{all.isCurrent ? ` (laju ${pct(all.pace)})` : ''}</td>
                    <td className="r mono">{rpShort(all.ytdTarget)}</td>
                    <td className="r mono">{rpShort(all.ytdReal)}</td>
                    <td className="mono">{pct(ratio(all.ytdReal, all.ytdTarget))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="field-note" style={{ marginTop: 10 }}>
        {tr("Target = budget per cabang per bulan (KPI › Atur target; bulan tanpa target memakai target terakhir, sama dengan KPI Scorecard). Pencapaian = DO terfaktur, dibukukan pada bulan tanggal delivery (tanggal PO bila delivery kosong). Target YTD bulan berjalan dihitung proporsional hari kerja.")}
      </div>
    </>
  );
}

function Fact({ label, value, sub, tone = '' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="tg-fact">
      <span className="lb">{label}</span>
      <span className={`v mono ${tone}`}>{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}
