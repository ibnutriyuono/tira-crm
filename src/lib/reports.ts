import { AGING_THRESHOLD_DAYS, STAGE_PROBABILITY } from './constants';
import { classify, formatDateID, formatRupiah, num } from './format';
import type { BudgetTarget, Prospect, SalesPlan } from './types';

/** The date a won prospect actually landed — PO first, then delivery, then offer. */
function recordDate(r: Prospect): string | null {
  return r.tglPO || r.tglDelivery || r.tglPenawaran || null;
}

export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86400000);
}

export interface CustomerIntelRow {
  records: Prospect[];
  name: string;
  cabang: string;
  total: number;
  won: number;
  lost: number;
  aktif: number;
  wonValue: number;
  lastOrderDate: string | null;
  daysSinceOrder: number | null;
  winRate: number;
  health: string;
  healthColor: string;
}

/** Groups prospects by customer into an account-health summary. */
export function buildCustomerIntel(records: Prospect[]): CustomerIntelRow[] {
  const map = new Map<string, { name: string; cabang: string; records: Prospect[] }>();
  records.forEach((r) => {
    const nameRaw = (r.customer || '').trim();
    if (!nameRaw) return;
    const key = nameRaw.toLowerCase();
    if (!map.has(key)) map.set(key, { name: nameRaw, cabang: r.cabang || '', records: [] });
    const entry = map.get(key)!;
    entry.records.push(r);
    if (!entry.cabang && r.cabang) entry.cabang = r.cabang;
  });

  const out: CustomerIntelRow[] = [];
  map.forEach((entry) => {
    const won = entry.records.filter((r) => classify(r) === 'Won');
    const lost = entry.records.filter((r) => classify(r) === 'Lost');
    const aktif = entry.records.filter((r) => classify(r) === 'Aktif');
    const dates = won.map(recordDate).filter(Boolean).sort() as string[];
    const lastOrderDate = dates.length ? dates[dates.length - 1] : null;
    const d = lastOrderDate ? daysSince(lastOrderDate) : null;

    // Thresholds match the single-file app: Aktif <=45d, Menghangat 46-90d,
    // Dingin >90d. Using 90/180 here made every account look healthier.
    let health = 'Belum Pernah Order';
    let healthColor = 'slate';
    if (d != null) {
      if (d <= 45) { health = 'Aktif'; healthColor = 'green'; }
      else if (d <= 90) { health = 'Menghangat'; healthColor = 'amber'; }
      else { health = 'Dingin (Follow-up)'; healthColor = 'rust'; }
    }

    const decided = won.length + lost.length;
    out.push({
      records: entry.records,
      name: entry.name,
      cabang: entry.cabang,
      total: entry.records.length,
      won: won.length,
      lost: lost.length,
      aktif: aktif.length,
      wonValue: won.reduce((s, r) => s + num(r.value), 0),
      lastOrderDate,
      daysSinceOrder: d,
      winRate: decided ? Math.round((won.length / decided) * 100) : 0,
      health,
      healthColor,
    });
  });

  return out.sort((a, b) => b.wonValue - a.wonValue);
}

export interface CompetitorRow {
  records: Prospect[];
  name: string;
  lostCount: number;
  lostValue: number;
  topCabang: string;
  topLine: string;
  /** Most recent date we lost to this competitor. */
  lastSeen: string | null;
}

/** Lost deals grouped by the competitor recorded in the QCD form. */
export function buildCompetitorLog(records: Prospect[]): CompetitorRow[] {
  const lost = records.filter((r) => classify(r) === 'Lost' && (r.qcdKompetitor || '').trim());
  const map = new Map<string, { name: string; records: Prospect[] }>();
  lost.forEach((r) => {
    const nameRaw = (r.qcdKompetitor || '').trim();
    const key = nameRaw.toLowerCase();
    if (!map.has(key)) map.set(key, { name: nameRaw, records: [] });
    map.get(key)!.records.push(r);
  });

  const top = (counts: Record<string, number>) =>
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';

  const out: CompetitorRow[] = [];
  map.forEach((entry) => {
    const cabangCount: Record<string, number> = {};
    const lineCount: Record<string, number> = {};
    entry.records.forEach((r) => {
      const cb = r.cabang || '-';
      cabangCount[cb] = (cabangCount[cb] || 0) + 1;
      const ln = r.line || '-';
      lineCount[ln] = (lineCount[ln] || 0) + 1;
    });
    out.push({
      records: entry.records,
      name: entry.name,
      lostCount: entry.records.length,
      lostValue: entry.records.reduce((s, r) => s + num(r.value), 0),
      topCabang: top(cabangCount),
      topLine: top(lineCount),
      lastSeen: entry.records.map(recordDate).filter(Boolean).sort().pop() ?? null,
    });
  });

  return out.sort((a, b) => b.lostValue - a.lostValue);
}

export interface ForecastRow {
  cabang: string;
  /** Region the branch belongs to, derived from whichever prospect rows carry it. Null when no record in scope names this branch's region yet. */
  reg: number | null;
  target: number;
  /** Sum of SalesPlan.value for every SE in this branch this month — what Sales itself committed to sell, distinct from the company-set target. */
  rencana: number;
  won: number;
  weighted: number;
  openCount: number;
  agingCount: number;
  /** Realisasi (won) against target. */
  achievement: number;
  /** How much of target the plan even covers — low here means the team hasn't planned enough activity to reach target, regardless of how well they execute. */
  rencanaVsTarget: number;
  /** How much of what was planned actually landed — the execution gap, as opposed to the planning gap above. */
  wonVsRencana: number;
}

/**
 * Stage-weighted pipeline per branch against its target for `periode`
 * (YYYY-MM). "Weighted" applies STAGE_PROBABILITY to open deals; "aging"
 * counts open deals untouched beyond AGING_THRESHOLD_DAYS. `salesPlans`
 * feeds the Rencana column — pass `[]` where that comparison isn't needed.
 */
export function buildForecast(
  records: Prospect[],
  targets: BudgetTarget[],
  periode: string,
  cabangList: string[] = [],
  salesPlans: SalesPlan[] = [],
): ForecastRow[] {
  // Every branch in scope appears, not just those with activity this period —
  // otherwise a branch with a target but no deals silently vanishes and the
  // table stops reconciling with the KPI cards above it.
  const dataCabangs = records.map((r) => (r.cabang || '').trim().toUpperCase()).filter(Boolean);
  const cabangs = Array.from(new Set([...cabangList.map((c) => c.toUpperCase()), ...dataCabangs]));

  const inPeriod = (r: Prospect) => (recordDate(r) || '').slice(0, 7) === periode;
  const plansInPeriode = salesPlans.filter((p) => p.periode === periode);

  // Region per branch, read off whichever prospect happens to carry it —
  // there's no first-class Cabang entity, so this is the only source. Used
  // both per-row (rendered) and by buildForecastByReg (grouping key).
  const regOf = new Map<string, number | null>();
  records.forEach((r) => {
    const cb = (r.cabang || '').trim().toUpperCase();
    if (cb && r.reg != null && regOf.get(cb) == null) regOf.set(cb, r.reg);
  });

  return cabangs
    .map((cabang) => {
      const cList = records.filter((r) => (r.cabang || '').trim().toUpperCase() === cabang);
      // Weighted forecast covers the whole live pipeline; only Won and Target
      // are scoped to the selected month.
      const open = cList.filter((r) => classify(r) === 'Aktif');
      const weighted = open.reduce((s, r) => s + num(r.value) * (STAGE_PROBABILITY[r.status] ?? 0), 0);
      const won = cList.filter((r) => classify(r) === 'Won' && inPeriod(r)).reduce((s, r) => s + num(r.value), 0);
      const target = targets.find((t) => t.cabang === cabang && t.periode === periode)?.amount ?? 0;
      const rencana = plansInPeriode.filter((p) => (p.cabang || '').toUpperCase() === cabang).reduce((s, p) => s + num(p.value), 0);
      const agingCount = open.filter((r) => daysSince(String(r.statusChangedAt ?? r.updatedAt).slice(0, 10)) > AGING_THRESHOLD_DAYS).length;

      return {
        cabang,
        reg: regOf.get(cabang) ?? null,
        target,
        rencana,
        won,
        weighted,
        openCount: open.length,
        agingCount,
        achievement: target > 0 ? Math.round((won / target) * 100) : 0,
        rencanaVsTarget: target > 0 ? Math.round((rencana / target) * 100) : 0,
        wonVsRencana: rencana > 0 ? Math.round((won / rencana) * 100) : 0,
      };
    })
    // Keep the company's own branch ordering rather than sorting alphabetically.
    .sort((a, b) => {
      const ia = cabangList.indexOf(a.cabang);
      const ib = cabangList.indexOf(b.cabang);
      if (ia === -1 && ib === -1) return a.cabang.localeCompare(b.cabang);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
}

export interface ForecastRollupRow {
  target: number;
  rencana: number;
  won: number;
  weighted: number;
  cabangCount: number;
  achievement: number;
  rencanaVsTarget: number;
  wonVsRencana: number;
}

function rollup(rows: ForecastRow[]): ForecastRollupRow {
  const target = rows.reduce((s, r) => s + r.target, 0);
  const rencana = rows.reduce((s, r) => s + r.rencana, 0);
  const won = rows.reduce((s, r) => s + r.won, 0);
  const weighted = rows.reduce((s, r) => s + r.weighted, 0);
  return {
    target,
    rencana,
    won,
    weighted,
    cabangCount: rows.length,
    achievement: target > 0 ? Math.round((won / target) * 100) : 0,
    rencanaVsTarget: target > 0 ? Math.round((rencana / target) * 100) : 0,
    wonVsRencana: rencana > 0 ? Math.round((won / rencana) * 100) : 0,
  };
}

/** Rolls buildForecast's per-branch rows up to per-region — branches with no known region (regOf never populated) are grouped under `null` rather than silently dropped. */
export function buildForecastByReg(rows: ForecastRow[]): { reg: number | null; rows: ForecastRow[]; totals: ForecastRollupRow }[] {
  const map = new Map<number | null, ForecastRow[]>();
  rows.forEach((r) => {
    if (!map.has(r.reg)) map.set(r.reg, []);
    map.get(r.reg)!.push(r);
  });
  return Array.from(map.entries())
    .map(([reg, list]) => ({ reg, rows: list, totals: rollup(list) }))
    .sort((a, b) => (a.reg ?? 999) - (b.reg ?? 999));
}

/** Company-wide total — the top of the cabang -> regional -> nasional rollup. */
export function buildForecastNasional(rows: ForecastRow[]): ForecastRollupRow {
  return rollup(rows);
}

export interface ForecastSeRow {
  se: string;
  cabang: string;
  won: number;
  weighted: number;
  openCount: number;
  wonCount: number;
}

/** Per sales-engineer breakdown for `periode`, mirroring forecastSeTable. */
export function buildForecastBySe(records: Prospect[], periode: string): ForecastSeRow[] {
  const inPeriod = (r: Prospect) => (recordDate(r) || '').slice(0, 7) === periode;
  const map = new Map<string, Prospect[]>();
  records.filter(inPeriod).forEach((r) => {
    const se = (r.se || '-').toUpperCase();
    if (!map.has(se)) map.set(se, []);
    map.get(se)!.push(r);
  });

  const out: ForecastSeRow[] = [];
  map.forEach((list, se) => {
    const won = list.filter((r) => classify(r) === 'Won');
    const open = list.filter((r) => classify(r) === 'Aktif');
    out.push({
      se,
      cabang: list.find((r) => r.cabang)?.cabang || '-',
      won: won.reduce((s, r) => s + num(r.value), 0),
      weighted: open.reduce((s, r) => s + num(r.value) * (STAGE_PROBABILITY[r.status] ?? 0), 0),
      openCount: open.length,
      wonCount: won.length,
    });
  });
  return out.sort((a, b) => b.won - a.won);
}

/**
 * Prospects eligible for the QCD recap: only closed ones (PO/Kontrak or Lose
 * Order) carry a meaningful Quality/Cost/Delivery post-mortem.
 */
export function buildQcdRecap(records: Prospect[]): Prospect[] {
  return records
    .filter((r) => Number(r.status) === 4 || Number(r.status) === 6)
    .sort((a, b) => (b.tglPenawaran || '').localeCompare(a.tglPenawaran || ''));
}

export interface AgingRow {
  record: Prospect;
  days: number;
}

/**
 * Open deals with no movement past AGING_THRESHOLD_DAYS, newest-stalest first.
 * The forecast panel previously only counted these; the prototype lists them.
 */
export function buildAgingList(records: Prospect[]): AgingRow[] {
  return records
    .filter((r) => classify(r) === 'Aktif')
    .map((r) => ({ record: r, days: daysSince(String(r.statusChangedAt ?? r.updatedAt).slice(0, 10)) }))
    .filter((x) => x.days > AGING_THRESHOLD_DAYS)
    .sort((a, b) => b.days - a.days);
}

export type FollowUpTier = 'terlambat' | 'minggu-ini' | 'nanti';
export type FollowUpSource = 'terjadwal' | 'aging' | 'reaktivasi';

export interface FollowUpRow {
  key: string;
  source: FollowUpSource;
  tier: FollowUpTier;
  prospect: Prospect;
  customer: string;
  cabang: string;
  reason: string;
  detail: string;
  value: number;
}

/**
 * Merges three signals into one urgency-sorted follow-up worklist, rather
 * than adding a fourth standalone list: manually scheduled follow-ups
 * (Prospect.followUpAt/followUpNote), the existing aging-pipeline check
 * (buildAgingList above), and the existing cold-customer signal
 * (buildCustomerIntel). Shared by the TopBar badge count and
 * FollowUpBoardModal's full list so they can never disagree — the count
 * you see before opening the panel is exactly what's inside it.
 */
export function buildFollowUpRows(prospects: Prospect[]): FollowUpRow[] {
  const out: FollowUpRow[] = [];

  prospects.forEach((p) => {
    if (!p.followUpAt) return;
    const diff = daysSince(p.followUpAt); // >0 overdue, 0 today, <0 upcoming
    const tier: FollowUpTier = diff >= 0 ? 'terlambat' : diff >= -7 ? 'minggu-ini' : 'nanti';
    const detail =
      diff > 0 ? `Terlambat ${diff} hari (jadwal ${formatDateID(p.followUpAt)})` : diff === 0 ? 'Jatuh tempo hari ini' : `Jatuh tempo ${formatDateID(p.followUpAt)}`;
    out.push({
      key: `terjadwal-${p.id}`,
      source: 'terjadwal',
      tier,
      prospect: p,
      customer: p.customer,
      cabang: p.cabang || '-',
      reason: p.followUpNote || 'Follow-up terjadwal',
      detail,
      value: p.value,
    });
  });

  buildAgingList(prospects).forEach(({ record, days }) => {
    out.push({
      key: `aging-${record.id}`,
      source: 'aging',
      tier: 'terlambat',
      prospect: record,
      customer: record.customer,
      cabang: record.cabang || '-',
      reason: `Mangkrak ${days} hari tanpa progres`,
      detail: record.uraian || '-',
      value: record.value,
    });
  });

  buildCustomerIntel(prospects).forEach((c) => {
    if (!c.health.startsWith('Dingin') && c.health !== 'Menghangat') return;
    const latest = c.records[0];
    if (!latest) return;
    out.push({
      key: `reaktivasi-${c.name}`,
      source: 'reaktivasi',
      tier: c.health.startsWith('Dingin') ? 'terlambat' : 'minggu-ini',
      prospect: latest,
      customer: c.name,
      cabang: c.cabang || '-',
      reason: `Tidak order ${c.daysSinceOrder ?? '-'} hari`,
      detail: `Total pembelian ${formatRupiah(c.wonValue)}`,
      value: c.wonValue,
    });
  });

  return out.sort((a, b) => {
    const order = { terlambat: 0, 'minggu-ini': 1, nanti: 2 };
    if (order[a.tier] !== order[b.tier]) return order[a.tier] - order[b.tier];
    return b.value - a.value;
  });
}

/** Count of "perlu segera" (terlambat-tier) rows — what the TopBar badge shows. */
export function countUrgentFollowUps(prospects: Prospect[]): number {
  return buildFollowUpRows(prospects).filter((r) => r.tier === 'terlambat').length;
}

/**
 * Star count per prospect for the Prospek list: how many DISTINCT periods
 * that prospect's material was pulled into a Rencana Penjualan (via "Ambil
 * dari Prospek" in SalesPlanModal — manually-typed rows carry no
 * sourceProspectId and never contribute). A prospect planned in September
 * and again in October reads 2 stars; pulled twice within the same period
 * (e.g. by mistake) still reads 1 — the count is periods, not row
 * occurrences, since the signal is "kept resurfacing across months," not
 * "how many lines came from it."
 *
 * Reads whatever SalesPlan[] the caller already has in scope (bootstrap
 * already scopes this per role — sales sees only their own plans, bm their
 * branch's, etc.), so a star count naturally reflects only what its viewer
 * is allowed to see, with no separate scoping needed here.
 */
export function buildProspectStarCounts(salesPlans: SalesPlan[]): Map<string, number> {
  const periodsByProspect = new Map<string, Set<string>>();
  salesPlans.forEach((plan) => {
    plan.items.forEach((item) => {
      if (!item.sourceProspectId) return;
      if (!periodsByProspect.has(item.sourceProspectId)) periodsByProspect.set(item.sourceProspectId, new Set());
      periodsByProspect.get(item.sourceProspectId)!.add(plan.periode);
    });
  });
  const counts = new Map<string, number>();
  periodsByProspect.forEach((periods, prospectId) => counts.set(prospectId, periods.size));
  return counts;
}
