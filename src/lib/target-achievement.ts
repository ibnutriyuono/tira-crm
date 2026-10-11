import { num } from './format';
import { yearMonthTarget } from './kpi';
import { workingDays } from './activity-kpi';
import type { BudgetTarget, Prospect } from './types';
import { omzetPeriode } from './faktur';

/**
 * Analisa Eksekutif > Target: target bulanan & YTD vs pencapaian.
 *
 * - Target  = budget per cabang per bulan (KPI > Atur target), dengan aturan
 *   carry-forward yang sama dengan KPI Scorecard (yearMonthTarget).
 * - Pencapaian = DO terfaktur (status 5, terfaktur), dibukukan di bulan
 *   Tanggal Faktur (diisi Admin Sales / BM); data lama tanpa tanggal faktur
 *   memakai tglDelivery, lalu tglPO — sama dengan baris Invoice di KPI Scorecard.
 * - GIT = DO pada bulan itu yang belum terfaktur (potensi).
 * - Laju = hari kerja Senin–Jumat yang sudah lewat s.d. hari ini.
 */

export interface TargetMonth {
  month: number; // 1-12
  target: number;
  real: number;
  git: number;
}

export interface TargetCabangRow {
  cabang: string;
  target: number;
  real: number;
  git: number;
  ytdTarget: number;
  ytdReal: number;
}

export interface TargetAchievement {
  year: string;
  month: number;
  isCurrent: boolean;
  /** Hari kerja bulan itu, yang sudah lewat, dan laju (elapsed/total; 1 untuk bulan lampau). */
  workdays: number;
  elapsed: number;
  pace: number;
  target: number;
  real: number;
  git: number;
  /** Target YTD s.d. hari ini: bulan sebelumnya penuh + bulan berjalan × laju. */
  ytdTarget: number;
  /** Target YTD penuh s.d. akhir bulan dipilih. */
  ytdTargetFull: number;
  ytdReal: number;
  yearTarget: number;
  /** Proyeksi setahun dari run-rate YTD. */
  runRate: number;
  months: TargetMonth[];
  rows: TargetCabangRow[];
}

const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();

/** Bulan (YYYY-MM) tempat sebuah DO dibukukan: tanggal faktur (bila terfaktur), lalu delivery, lalu PO. */
export function bookingPeriode(p: Prospect): string {
  return omzetPeriode(p);
}

export function buildTargetAchievement(
  prospects: Prospect[],
  budgetTargets: BudgetTarget[],
  cabangs: string[],
  opts: { year: string; month: number; today: string; /** SE view: realisasi semua prospek milik SE, target tetap cabang. */ allProspects?: boolean },
): TargetAchievement {
  const { year, month, today } = opts;
  const per = (m: number) => `${year}-${String(m).padStart(2, '0')}`;
  const periode = per(month);
  const days = workingDays(periode);
  const isCurrent = today.slice(0, 7) === periode;
  const elapsed = today.slice(0, 7) < periode ? 0 : isCurrent ? days.filter((d) => d <= today).length : days.length;
  const pace = days.length ? elapsed / days.length : 0;

  const cabSet = new Set(cabangs.map(up));
  const dos = prospects.filter((p) => num(p.status) === 5 && bookingPeriode(p).startsWith(`${year}-`) && (opts.allProspects || cabSet.has(up(p.cabang))));

  // per cabang x bulan
  const realBy = new Map<string, number[]>();
  const gitBy = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, cb: string, m: number, v: number) => {
    if (!map.has(cb)) map.set(cb, Array(12).fill(0));
    map.get(cb)![m - 1] += v;
  };
  dos.forEach((p) => {
    const m = Number(bookingPeriode(p).slice(5, 7));
    if (!(m >= 1 && m <= 12)) return;
    const cb = opts.allProspects ? (cabangs[0] ? up(cabangs[0]) : '-') : up(p.cabang);
    add(p.terfaktur ? realBy : gitBy, cb, m, num(p.value));
  });

  const cabList = opts.allProspects ? (cabangs.length ? [up(cabangs[0])] : ['-']) : cabangs.map(up);
  const tgt = (cb: string, m: number) => (cb === '-' ? 0 : yearMonthTarget(budgetTargets, cb, year, m));

  const months: TargetMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    months.push({
      month: m,
      target: cabList.reduce((s, cb) => s + tgt(cb, m), 0),
      real: cabList.reduce((s, cb) => s + (realBy.get(cb)?.[m - 1] || 0), 0),
      git: cabList.reduce((s, cb) => s + (gitBy.get(cb)?.[m - 1] || 0), 0),
    });
  }

  const ytdOf = (arr: (m: number) => number, prorate: boolean) => {
    let s = 0;
    for (let m = 1; m <= month; m++) s += m === month && prorate ? arr(m) * pace : arr(m);
    return s;
  };
  const cur = months[month - 1];
  const ytdReal = ytdOf((m) => months[m - 1].real, false);
  const yearTarget = months.reduce((s, x) => s + x.target, 0);
  const elapsedMonths = month - 1 + pace;

  const rows: TargetCabangRow[] = opts.allProspects
    ? []
    : cabList.map((cb) => ({
        cabang: cb,
        target: tgt(cb, month),
        real: realBy.get(cb)?.[month - 1] || 0,
        git: gitBy.get(cb)?.[month - 1] || 0,
        ytdTarget: ytdOf((m) => tgt(cb, m), true),
        ytdReal: ytdOf((m) => realBy.get(cb)?.[m - 1] || 0, false),
      }));

  return {
    year,
    month,
    isCurrent,
    workdays: days.length,
    elapsed,
    pace,
    target: cur.target,
    real: cur.real,
    git: cur.git,
    ytdTarget: ytdOf((m) => months[m - 1].target, true),
    ytdTargetFull: ytdOf((m) => months[m - 1].target, false),
    ytdReal,
    yearTarget,
    runRate: elapsedMonths > 0 ? (ytdReal / elapsedMonths) * 12 : 0,
    months,
    rows,
  };
}

/** Status terhadap laju (bulan berjalan) atau terhadap target (bulan selesai / YTD). */
export function achSignal(ratio: number | null): 'ok' | 'warn' | 'bad' | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  return ratio >= 1 ? 'ok' : ratio >= 0.85 ? 'warn' : 'bad';
}
