import { ACTIVITY_TYPES, DEFAULT_ACTIVITY_TARGETS, type ActivityTipe } from './constants';
import type { ActivityTarget, Prospect, SalesActivity } from './types';
import type { KpiSignal } from './kpi';

/** Same thresholds as the KPI Scorecard (lib/kpi.ts signalFor): >100 blue, =100 green, 90-99 yellow, <90 red. */
export function activitySignal(achieve: number | null): KpiSignal {
  if (achieve == null) return null;
  const pct = Math.round(achieve * 100);
  return pct > 100 ? 'blue' : pct === 100 ? 'green' : pct >= 90 ? 'yellow' : 'red';
}

export interface ActivityKpiTypeRow {
  tipe: ActivityTipe;
  label: string;
  target: number;
  /** false = target is the DEFAULT_ACTIVITY_TARGETS fallback, not set by a manager. */
  targetSet: boolean;
  result: number;
  achieve: number | null;
  signal: KpiSignal;
  /** achieve / expected-by-today; null before the first working day. */
  paceRatio: number | null;
  pace: PaceSignal;
}

export interface ActivityKpiRow {
  se: string;
  cabang: string | null;
  types: ActivityKpiTypeRow[];
  /** Average achievement across the types (each capped at 100% so one over-achieved type can't hide a missed one). */
  overall: number | null;
  signal: KpiSignal;
  total: number;
  /** Activities that were pushed into the pipeline, and how far they got. */
  converted: number;
  toRequest: number;
  toQuote: number;
  toPo: number;
  /** converted / total, or null with no activity. */
  conversionRate: number | null;
  /** Activities on distinct days -- "hari aktif". */
  activeDays: number;
  /** Pace: average of (achievement / expected-by-today) per type, each capped at 1.5. null when no working day has passed. */
  paceRatio: number | null;
  pace: PaceSignal;
  /** One flag per working day of the month: had at least one activity. */
  dayFlags: boolean[];
  /** Latest activity date (YYYY-MM-DD) in the period, or null. */
  lastDate: string | null;
  /** Working days between the last activity and the reference day (0 = that day). null = no activity. */
  idleWorkdays: number | null;
  /** Activities done in the previous month up to the same working day, for the trend. */
  prevTotal: number | null;
  /** Share of activities that name a PIC. */
  picRate: number | null;
  /** Distinct customers touched. */
  customers: number;
  /** Rupiah value of the prospects created from these activities. */
  pipelineValue: number;
}

export type PaceSignal = 'on' | 'warn' | 'off' | null;

/** Pace signal: >= 95% of the expected-by-today count is on track, 60-95% slightly behind, below that far behind. */
export function paceSignal(ratio: number | null): PaceSignal {
  if (ratio == null) return null;
  return ratio >= 0.95 ? 'on' : ratio >= 0.6 ? 'warn' : 'off';
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday-Friday dates of a YYYY-MM month. */
export function workingDays(periode: string): string[] {
  const [y, m] = periode.split('-').map(Number);
  const out: string[] = [];
  for (let d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) out.push(ymd(d));
  }
  return out;
}

export interface PaceInfo {
  days: string[];
  /** Working days of the month on or before the reference day. */
  elapsed: number;
  /** elapsed / days.length (1 for a past month, 0 for a future one). */
  pace: number;
  /** The day pace and idle time are measured at: today in the current month, else the month's last working day. */
  refDay: string;
}

export function paceFor(periode: string, today: string): PaceInfo {
  const days = workingDays(periode);
  const refDay = today.slice(0, 7) === periode ? today : days[days.length - 1] || today;
  const elapsed = today.slice(0, 7) < periode ? 0 : days.filter((d) => d <= refDay).length;
  return { days, elapsed, pace: days.length ? elapsed / days.length : 0, refDay };
}

/** Previous YYYY-MM. */
export function prevPeriode(periode: string): string {
  const [y, m] = periode.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Builds the activity KPI for one month.
 *
 * `activities` must already be the month's rows (the API filters by tanggal
 * prefix); this does not re-filter by period. Pipeline depth of a converted
 * activity is read from the linked prospect's CURRENT status, so a deal that
 * started as a Permintaan and has since reached PO counts as a PO -- the
 * funnel reflects where the activity ended up, not where it was clicked in.
 * A prospect the viewer can't see (not in `prospects`) still counts as
 * converted but contributes no depth.
 */
export function buildActivityKpi(
  activities: SalesActivity[],
  targets: ActivityTarget[],
  prospects: (Pick<Prospect, 'id' | 'status'> & { value?: number })[],
  opts: { periode?: string; today?: string; prevActivities?: SalesActivity[] } = {},
): ActivityKpiRow[] {
  const statusById = new Map(prospects.map((p) => [p.id, Number(p.status)]));
  const valueById = new Map(prospects.map((p) => [p.id, Number(p.value) || 0]));
  const periode = opts.periode || activities[0]?.tanggal?.slice(0, 7) || new Date().toISOString().slice(0, 7);
  const pi = paceFor(periode, opts.today || ymd(new Date()));
  // Previous month, cut at the same working-day index, so the trend compares like with like.
  const prevDays = workingDays(prevPeriode(periode));
  const prevCut = prevDays[Math.max(0, Math.min(prevDays.length, pi.elapsed) - 1)] || '';
  const prevBySe = new Map<string, number>();
  if (opts.prevActivities && pi.elapsed > 0) {
    opts.prevActivities
      .filter((a) => a.status !== 'rencana' && a.tanggal <= prevCut)
      .forEach((a) => {
        const k = a.se.trim().toLowerCase();
        prevBySe.set(k, (prevBySe.get(k) || 0) + 1);
      });
  }
  const targetBySe = new Map(targets.map((t) => [t.se.trim().toLowerCase(), t]));
  const bySe = new Map<string, SalesActivity[]>();
  // Planned follow-ups (rencana) aren't work done yet: never counted.
  activities.filter((a) => a.status !== 'rencana').forEach((a) => {
    const k = a.se.trim().toLowerCase();
    if (!bySe.has(k)) bySe.set(k, []);
    bySe.get(k)!.push(a);
  });
  // An SE with a target but no activity yet still gets a (0%) row.
  targets.forEach((t) => {
    const k = t.se.trim().toLowerCase();
    if (!bySe.has(k)) bySe.set(k, []);
  });

  const rows: ActivityKpiRow[] = [];
  bySe.forEach((list, key) => {
    const t = targetBySe.get(key);
    const types: ActivityKpiTypeRow[] = ACTIVITY_TYPES.map(({ key: tipe, label }) => {
      const set = t?.targets?.[tipe];
      const targetSet = typeof set === 'number' && set > 0;
      const target = targetSet ? (set as number) : DEFAULT_ACTIVITY_TARGETS[tipe];
      const result = list.filter((a) => a.tipe === tipe).length;
      const achieve = target > 0 ? result / target : null;
      const paceRatio = achieve != null && pi.pace > 0 ? achieve / pi.pace : null;
      return { tipe, label, target, targetSet, result, achieve, signal: activitySignal(achieve), paceRatio, pace: paceSignal(paceRatio) };
    });
    const capped = types.map((x) => Math.min(x.achieve ?? 0, 1));
    const overall = capped.reduce((s, v) => s + v, 0) / types.length;

    // Conversion = activities that were turned into a prospect -- not the
    // automatic follow-up logs of an existing one.
    const linked = list.filter((a) => a.prospectId && !a.sumber);
    let toRequest = 0;
    let toQuote = 0;
    let toPo = 0;
    linked.forEach((a) => {
      const st = statusById.get(a.prospectId as string);
      if (st == null) return;
      if (st >= 1 && st !== 6) toRequest++;
      if (st >= 2 && st !== 6) toQuote++;
      if (st === 4 || st === 5) toPo++;
    });

    const ratios = types.map((x) => x.paceRatio).filter((x): x is number => x != null);
    const paceRatio = ratios.length ? ratios.reduce((s, v) => s + Math.min(v, 1.5), 0) / ratios.length : null;
    const dates = new Set(list.map((a) => a.tanggal));
    const lastDate = list.reduce<string | null>((m, a) => (!m || a.tanggal > m ? a.tanggal : m), null);
    const idleWorkdays = lastDate ? pi.days.filter((d) => d > lastDate && d <= pi.refDay).length : null;
    const pipelineValue = linked.reduce((s, a) => {
      const st = statusById.get(a.prospectId as string);
      return s + (st != null && st !== 6 ? valueById.get(a.prospectId as string) || 0 : 0);
    }, 0);

    rows.push({
      se: list[0]?.se ?? t?.se ?? key,
      cabang: list[0]?.cabang ?? t?.cabang ?? null,
      types,
      overall,
      signal: activitySignal(overall),
      total: list.length,
      converted: linked.length,
      toRequest,
      toQuote,
      toPo,
      conversionRate: list.length > 0 ? linked.length / list.length : null,
      activeDays: dates.size,
      paceRatio,
      pace: paceSignal(paceRatio),
      dayFlags: pi.days.map((d) => dates.has(d)),
      lastDate,
      idleWorkdays,
      prevTotal: opts.prevActivities && pi.elapsed > 0 ? prevBySe.get(key) || 0 : null,
      picRate: list.length ? list.filter((a) => Array.isArray(a.pics) && a.pics.some((x) => (x?.nama || '').trim())).length / list.length : null,
      customers: new Set(list.map((a) => a.customer.trim().toUpperCase())).size,
      pipelineValue,
    });
  });
  return rows.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0) || a.se.localeCompare(b.se));
}
