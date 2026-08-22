import { AGING_THRESHOLD_DAYS, STAGE_PROBABILITY } from './constants';
import { classify, num } from './format';
import type { BudgetTarget, Prospect } from './types';

/** The date a won prospect actually landed — PO first, then delivery, then offer. */
function recordDate(r: Prospect): string | null {
  return r.tglPO || r.tglDelivery || r.tglPenawaran || null;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86400000);
}

export interface CustomerIntelRow {
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

    let health = 'Belum Pernah Order';
    let healthColor = 'slate';
    if (d != null) {
      if (d <= 90) { health = 'Aktif'; healthColor = 'green'; }
      else if (d <= 180) { health = 'Melambat'; healthColor = 'amber'; }
      else { health = 'Dorman'; healthColor = 'rust'; }
    }

    const decided = won.length + lost.length;
    out.push({
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
  name: string;
  lostCount: number;
  lostValue: number;
  topCabang: string;
  topLine: string;
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
      name: entry.name,
      lostCount: entry.records.length,
      lostValue: entry.records.reduce((s, r) => s + num(r.value), 0),
      topCabang: top(cabangCount),
      topLine: top(lineCount),
    });
  });

  return out.sort((a, b) => b.lostValue - a.lostValue);
}

export interface ForecastRow {
  cabang: string;
  target: number;
  won: number;
  weighted: number;
  openCount: number;
  agingCount: number;
  achievement: number;
}

/**
 * Stage-weighted pipeline per branch against its target for `periode`
 * (YYYY-MM). "Weighted" applies STAGE_PROBABILITY to open deals; "aging"
 * counts open deals untouched beyond AGING_THRESHOLD_DAYS.
 */
export function buildForecast(records: Prospect[], targets: BudgetTarget[], periode: string): ForecastRow[] {
  const inPeriod = (r: Prospect) => (recordDate(r) || '').slice(0, 7) === periode;
  const byCabang = new Map<string, Prospect[]>();
  records.filter(inPeriod).forEach((r) => {
    const cb = (r.cabang || '-').toUpperCase();
    if (!byCabang.has(cb)) byCabang.set(cb, []);
    byCabang.get(cb)!.push(r);
  });

  // Include branches that have a target but no activity this period.
  targets.filter((t) => t.periode === periode).forEach((t) => {
    if (!byCabang.has(t.cabang)) byCabang.set(t.cabang, []);
  });

  const out: ForecastRow[] = [];
  byCabang.forEach((list, cabang) => {
    const target = targets.find((t) => t.cabang === cabang && t.periode === periode)?.amount ?? 0;
    const won = list.filter((r) => classify(r) === 'Won').reduce((s, r) => s + num(r.value), 0);
    const open = list.filter((r) => classify(r) === 'Aktif');
    const weighted = open.reduce((s, r) => s + num(r.value) * (STAGE_PROBABILITY[r.status] ?? 0), 0);
    const agingCount = open.filter((r) => {
      const d = recordDate(r);
      return d ? daysSince(d) > AGING_THRESHOLD_DAYS : false;
    }).length;

    out.push({
      cabang,
      target,
      won,
      weighted,
      openCount: open.length,
      agingCount,
      achievement: target > 0 ? Math.round((won / target) * 100) : 0,
    });
  });

  return out.sort((a, b) => a.cabang.localeCompare(b.cabang));
}
