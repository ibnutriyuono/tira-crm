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
export function buildActivityKpi(activities: SalesActivity[], targets: ActivityTarget[], prospects: Pick<Prospect, 'id' | 'status'>[]): ActivityKpiRow[] {
  const statusById = new Map(prospects.map((p) => [p.id, Number(p.status)]));
  const targetBySe = new Map(targets.map((t) => [t.se.trim().toLowerCase(), t]));
  const bySe = new Map<string, SalesActivity[]>();
  activities.forEach((a) => {
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
      return { tipe, label, target, targetSet, result, achieve, signal: activitySignal(achieve) };
    });
    const capped = types.map((x) => Math.min(x.achieve ?? 0, 1));
    const overall = capped.reduce((s, v) => s + v, 0) / types.length;

    const linked = list.filter((a) => a.prospectId);
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
      activeDays: new Set(list.map((a) => a.tanggal)).size,
    });
  });
  return rows.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0) || a.se.localeCompare(b.se));
}
