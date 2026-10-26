import { num } from './format';
import { yearMonthTarget } from './kpi';
import { workingDays } from './activity-kpi';
import type { BudgetTarget, Prospect } from './types';
import { omzetPeriode } from './faktur';
import { periodeList } from './reports';

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
  /** Periode yang dipilih (YYYY-MM … YYYY-MM); satu bulan bila sama. */
  from: string;
  to: string;
  periodes: string[];
  /** Periode memuat bulan berjalan. */
  isCurrent: boolean;
  /** Hari kerja periode, yang sudah lewat, dan laju (elapsed/total; 1 untuk periode lampau). */
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
  opts: {
    /** Bulan akhir periode (juga dasar YTD). */
    year: string;
    month: number;
    /** Awal periode (YYYY-MM); kosong = sama dengan bulan akhir. */
    from?: string;
    today: string;
    /** SE view: realisasi semua prospek milik SE, target tetap cabang. */
    allProspects?: boolean;
  },
): TargetAchievement {
  const { year, month, today } = opts;
  const per = (m: number) => `${year}-${String(m).padStart(2, '0')}`;
  const periode = per(month);
  const periodes = periodeList(opts.from && opts.from <= periode ? opts.from : periode, periode);
  const curP = today.slice(0, 7);
  const isCurrent = periodes.includes(curP);
  let workdays = 0;
  let elapsed = 0;
  periodes.forEach((p) => {
    const days = workingDays(p);
    workdays += days.length;
    elapsed += curP < p ? 0 : curP === p ? days.filter((d) => d <= today).length : days.length;
  });
  const pace = workdays ? elapsed / workdays : 0;
  const inRange = new Set(periodes);

  const cabSet = new Set(cabangs.map(up));
  const years = new Set([year, ...periodes.map((p) => p.slice(0, 4))]);
  const dos = prospects.filter((p) => num(p.status) === 5 && years.has(bookingPeriode(p).slice(0, 4)) && (opts.allProspects || cabSet.has(up(p.cabang))));

  // per cabang x bulan (tahun YTD) dan per cabang atas periode dipilih
  const realBy = new Map<string, number[]>();
  const gitBy = new Map<string, number[]>();
  const realR = new Map<string, number>();
  const gitR = new Map<string, number>();
  const add = (map: Map<string, number[]>, cb: string, m: number, v: number) => {
    if (!map.has(cb)) map.set(cb, Array(12).fill(0));
    map.get(cb)![m - 1] += v;
  };
  dos.forEach((p) => {
    const bp = bookingPeriode(p);
    const m = Number(bp.slice(5, 7));
    if (!(m >= 1 && m <= 12)) return;
    const cb = opts.allProspects ? (cabangs[0] ? up(cabangs[0]) : '-') : up(p.cabang);
    if (bp.startsWith(`${year}-`)) add(p.terfaktur ? realBy : gitBy, cb, m, num(p.value));
    if (inRange.has(bp.slice(0, 7))) {
      const r = p.terfaktur ? realR : gitR;
      r.set(cb, (r.get(cb) || 0) + num(p.value));
    }
  });

  const cabList = opts.allProspects ? (cabangs.length ? [up(cabangs[0])] : ['-']) : cabangs.map(up);
  const tgt = (cb: string, m: number) => (cb === '-' ? 0 : yearMonthTarget(budgetTargets, cb, year, m));
  const tgtRange = (cb: string) => (cb === '-' ? 0 : periodes.reduce((s, p) => s + yearMonthTarget(budgetTargets, cb, p.slice(0, 4), Number(p.slice(5, 7))), 0));

  const months: TargetMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    months.push({
      month: m,
      target: cabList.reduce((s, cb) => s + tgt(cb, m), 0),
      real: cabList.reduce((s, cb) => s + (realBy.get(cb)?.[m - 1] || 0), 0),
      git: cabList.reduce((s, cb) => s + (gitBy.get(cb)?.[m - 1] || 0), 0),
    });
  }

  // Laju bulan akhir sendiri (untuk YTD), terlepas dari panjang periode.
  const endDays = workingDays(periode);
  const endPace = !endDays.length ? 0 : curP < periode ? 0 : curP === periode ? endDays.filter((d) => d <= today).length / endDays.length : 1;
  const ytdOf = (arr: (m: number) => number, prorate: boolean) => {
    let s = 0;
    for (let m = 1; m <= month; m++) s += m === month && prorate ? arr(m) * endPace : arr(m);
    return s;
  };
  const ytdReal = ytdOf((m) => months[m - 1].real, false);
  const yearTarget = months.reduce((s, x) => s + x.target, 0);
  const elapsedMonths = month - 1 + endPace;

  const rows: TargetCabangRow[] = opts.allProspects
    ? []
    : cabList.map((cb) => ({
        cabang: cb,
        target: tgtRange(cb),
        real: realR.get(cb) || 0,
        git: gitR.get(cb) || 0,
        ytdTarget: ytdOf((m) => tgt(cb, m), true),
        ytdReal: ytdOf((m) => realBy.get(cb)?.[m - 1] || 0, false),
      }));

  return {
    year,
    month,
    from: periodes[0],
    to: periode,
    periodes,
    isCurrent,
    workdays,
    elapsed,
    pace,
    target: cabList.reduce((s, cb) => s + tgtRange(cb), 0),
    real: cabList.reduce((s, cb) => s + (realR.get(cb) || 0), 0),
    git: cabList.reduce((s, cb) => s + (gitR.get(cb) || 0), 0),
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
