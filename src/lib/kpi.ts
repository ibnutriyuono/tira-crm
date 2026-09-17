import { classify } from './format';
import type { BudgetTarget, Prospect } from './types';

export type KpiSignal = 'blue' | 'green' | 'yellow' | 'red' | null;

export interface KpiMonthCell {
  month: number; // 1-12
  budget: number | null;
  result: number | null;
  achieve: number | null; // 0..1.2, or null when budget is unset/zero
  score: number | null; // achieve * bobot
  signal: KpiSignal;
}

export interface KpiItemScorecard {
  key: 'salesOrder' | 'invoice' | 'prospect' | 'grossMargin';
  label: string;
  bobot: number;
  unit: string;
  /** false for Gross Margin — not auto-computed yet, pending the Sage 300 integration; budget/result there are read directly from BudgetTarget's manual fields instead of derived from prospects. */
  auto: boolean;
  months: KpiMonthCell[];
}

export interface KpiScorecard {
  cabang: string[]; // the branch(es) rolled into this view — one for Sales/BM, several for RM/GM
  year: string;
  items: KpiItemScorecard[];
  totalScore: (number | null)[]; // 12 entries, sum of all items' score that month
  totalSignal: KpiSignal[];
}

/**
 * Every weight below (30/35/10/25) is the standard company-wide scorecard
 * structure from the source template — not something a branch redefines, so
 * unlike targets (which vary per cabang/periode via BudgetTarget) these stay
 * a fixed constant rather than admin-configurable per branch.
 */
export const KPI_DEFS = [
  { key: 'salesOrder' as const, label: 'Sales Order (PO per bulan)', bobot: 30, unit: 'Rp', auto: true },
  { key: 'invoice' as const, label: 'Invoice', bobot: 35, unit: 'Rp', auto: true },
  { key: 'prospect' as const, label: 'Prospect / Opportunity (Cold, Warm, Hot)', bobot: 10, unit: 'Rp', auto: true },
  { key: 'grossMargin' as const, label: 'Gross Margin', bobot: 25, unit: '%', auto: false },
];

export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodeOf(year: string, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** True when `dateStr` (any string starting "YYYY-MM...") falls within Jan of `year` through the end of `throughMonth` — the cumulative year-to-date window every item in this scorecard runs on, mirroring the source template's climbing monthly Budget line. */
function inYtd(dateStr: string | null | undefined, year: string, throughMonth: number): boolean {
  if (!dateStr) return false;
  const ym = dateStr.slice(0, 7);
  return ym >= `${year}-01` && ym <= periodeOf(year, throughMonth);
}

function inCabangList(cabang: string | null, cabangList: string[]): boolean {
  const c = (cabang || '').trim().toUpperCase();
  return !!c && cabangList.some((x) => x.toUpperCase() === c);
}

function clampAchieve(result: number | null, budget: number | null): number | null {
  if (result == null || budget == null || budget === 0) return null;
  return Math.min(1.2, Math.max(0, result / budget));
}

/** Matches the source template's conditional-formatting thresholds exactly: >100% blue, =100% green (a narrow band — real Rupiah ratios rarely land exactly on it, same as in the original file), 90-99.9% yellow, <90% red. */
function signalFor(achieve: number | null): KpiSignal {
  if (achieve == null) return null;
  if (achieve > 1) return 'blue';
  if (achieve === 1) return 'green';
  if (achieve >= 0.9) return 'yellow';
  return 'red';
}

/** Cumulative YTD sum of BudgetTarget.amount across every branch in `cabangList`, Jan through `throughMonth` of `year`. Reused as the Budget basis for both Sales Order and Invoice (see buildKpiScorecard's own note on why) and, doubled, for Prospect/Opportunity. */
function cumulativeAmountTarget(budgetTargets: BudgetTarget[], cabangList: string[], year: string, throughMonth: number): number {
  let sum = 0;
  for (let m = 1; m <= throughMonth; m++) {
    const p = periodeOf(year, m);
    budgetTargets.forEach((bt) => {
      if (bt.periode === p && inCabangList(bt.cabang, cabangList)) sum += bt.amount || 0;
    });
  }
  return sum;
}

/**
 * Builds the full 12-month scorecard for one or more branches rolled
 * together (a single cabang for Sales/BM, several for an RM/GM rollup).
 * Multi-branch figures are summed BEFORE computing Achieve — not averaged
 * per-branch-then-averaged-again — so a large branch correctly outweighs a
 * small one in the rolled-up score, the same way the underlying Rupiah
 * amounts would if added by hand.
 *
 * Design decisions carried over from the source Excel, stated here because
 * they aren't obvious from the code alone:
 * - Invoice reuses Sales Order's own Budget line (BudgetTarget.amount)
 *   rather than a second, separately-maintained target — introducing one
 *   would risk drifting out of sync with no clear source of truth for
 *   which number is "right".
 * - Prospect/Opportunity's Budget is 2x that same line — the source file's
 *   own sample figures (175 vs 350) carry exactly that ratio; treated here
 *   as a stated pipeline-coverage rule rather than a magic number.
 * - Prospect/Opportunity's Result counts value the moment a prospect is
 *   first logged (createdAt), regardless of what it later becomes (Won,
 *   Lost, still open) — this reads as "how much opportunity did we
 *   generate," a leading indicator, not "how much pipeline exists right
 *   now" (a snapshot, which cumulative YTD summing wouldn't represent
 *   correctly anyway).
 * - Gross Margin is NOT computed from prospect/RFQ pricing data — explicit
 *   instruction to leave it manual until the Sage 300 integration lands.
 */
export function buildKpiScorecard(prospects: Prospect[], budgetTargets: BudgetTarget[], cabangList: string[], year: string): KpiScorecard {
  const inScope = prospects.filter((p) => inCabangList(p.cabang, cabangList));

  const salesOrderMonths: KpiMonthCell[] = [];
  const invoiceMonths: KpiMonthCell[] = [];
  const prospectMonths: KpiMonthCell[] = [];
  const gmMonths: KpiMonthCell[] = [];

  for (let m = 1; m <= 12; m++) {
    const budget = cumulativeAmountTarget(budgetTargets, cabangList, year, m);

    const salesOrderResult = inScope.filter((p) => inYtd(p.tglPO, year, m)).reduce((s, p) => s + p.value, 0);
    const salesOrderAchieve = clampAchieve(salesOrderResult, budget || null);
    salesOrderMonths.push({ month: m, budget: budget || null, result: salesOrderResult, achieve: salesOrderAchieve, score: salesOrderAchieve == null ? null : salesOrderAchieve * 30, signal: signalFor(salesOrderAchieve) });

    const invoiceResult = inScope
      .filter((p) => classify(p) === 'Won' && p.terfaktur && inYtd(p.tglDelivery || p.tglPO, year, m))
      .reduce((s, p) => s + p.value, 0);
    const invoiceAchieve = clampAchieve(invoiceResult, budget || null);
    invoiceMonths.push({ month: m, budget: budget || null, result: invoiceResult, achieve: invoiceAchieve, score: invoiceAchieve == null ? null : invoiceAchieve * 35, signal: signalFor(invoiceAchieve) });

    const prospectBudget = budget * 2;
    const prospectResult = inScope.filter((p) => inYtd(p.createdAt, year, m)).reduce((s, p) => s + p.value, 0);
    const prospectAchieve = clampAchieve(prospectResult, prospectBudget || null);
    prospectMonths.push({ month: m, budget: prospectBudget || null, result: prospectResult, achieve: prospectAchieve, score: prospectAchieve == null ? null : prospectAchieve * 10, signal: signalFor(prospectAchieve) });

    // Gross Margin: read straight from BudgetTarget's manual fields for
    // this exact month (flat, not cumulative — matches the source file,
    // where this one item's Budget row doesn't climb like the other three).
    // Result is the YTD average of every month 1..m that actually has a
    // value entered, mirroring the source's own AVERAGE() formula rather
    // than summing a percentage (which would be meaningless).
    const gmBudgetEntry = budgetTargets.find((bt) => bt.periode === periodeOf(year, m) && inCabangList(bt.cabang, cabangList));
    const gmBudget = gmBudgetEntry?.grossMarginTarget ?? null;
    const gmResultsSoFar: number[] = [];
    for (let k = 1; k <= m; k++) {
      const entry = budgetTargets.find((bt) => bt.periode === periodeOf(year, k) && inCabangList(bt.cabang, cabangList));
      if (entry?.grossMarginResult != null) gmResultsSoFar.push(entry.grossMarginResult);
    }
    const gmResult = gmResultsSoFar.length > 0 ? gmResultsSoFar.reduce((s, v) => s + v, 0) / gmResultsSoFar.length : null;
    const gmAchieve = clampAchieve(gmResult, gmBudget);
    gmMonths.push({ month: m, budget: gmBudget, result: gmResult, achieve: gmAchieve, score: gmAchieve == null ? null : gmAchieve * 25, signal: signalFor(gmAchieve) });
  }

  const items: KpiItemScorecard[] = [
    { key: 'salesOrder', label: KPI_DEFS[0].label, bobot: 30, unit: 'Rp', auto: true, months: salesOrderMonths },
    { key: 'invoice', label: KPI_DEFS[1].label, bobot: 35, unit: 'Rp', auto: true, months: invoiceMonths },
    { key: 'prospect', label: KPI_DEFS[2].label, bobot: 10, unit: 'Rp', auto: true, months: prospectMonths },
    { key: 'grossMargin', label: KPI_DEFS[3].label, bobot: 25, unit: '%', auto: false, months: gmMonths },
  ];

  const totalScore: (number | null)[] = [];
  const totalSignal: KpiSignal[] = [];
  for (let i = 0; i < 12; i++) {
    const scores = items.map((it) => it.months[i].score).filter((s): s is number => s != null);
    const total = scores.length > 0 ? scores.reduce((s, v) => s + v, 0) : null;
    totalScore.push(total);
    // Total-row thresholds are absolute (out of 100), not a 0-1.2 ratio —
    // matches the source file's own separate rule for its TOTAL SCORE row.
    totalSignal.push(total == null ? null : total > 100 ? 'blue' : total === 100 ? 'green' : total >= 90 ? 'yellow' : 'red');
  }

  return { cabang: cabangList, year, items, totalScore, totalSignal };
}
