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
export function buildForecast(
  records: Prospect[],
  targets: BudgetTarget[],
  periode: string,
  cabangList: string[] = [],
): ForecastRow[] {
  // Every branch in scope appears, not just those with activity this period —
  // otherwise a branch with a target but no deals silently vanishes and the
  // table stops reconciling with the KPI cards above it.
  const dataCabangs = records.map((r) => (r.cabang || '').trim().toUpperCase()).filter(Boolean);
  const cabangs = Array.from(new Set([...cabangList.map((c) => c.toUpperCase()), ...dataCabangs]));

  const inPeriod = (r: Prospect) => (recordDate(r) || '').slice(0, 7) === periode;

  return cabangs
    .map((cabang) => {
      const cList = records.filter((r) => (r.cabang || '').trim().toUpperCase() === cabang);
      // Weighted forecast covers the whole live pipeline; only Won and Target
      // are scoped to the selected month.
      const open = cList.filter((r) => classify(r) === 'Aktif');
      const weighted = open.reduce((s, r) => s + num(r.value) * (STAGE_PROBABILITY[r.status] ?? 0), 0);
      const won = cList.filter((r) => classify(r) === 'Won' && inPeriod(r)).reduce((s, r) => s + num(r.value), 0);
      const target = targets.find((t) => t.cabang === cabang && t.periode === periode)?.amount ?? 0;
      const agingCount = open.filter((r) => daysSince(String(r.updatedAt).slice(0, 10)) > AGING_THRESHOLD_DAYS).length;

      return {
        cabang,
        target,
        won,
        weighted,
        openCount: open.length,
        agingCount,
        achievement: target > 0 ? Math.round((won / target) * 100) : 0,
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
    .map((r) => ({ record: r, days: daysSince(String(r.updatedAt).slice(0, 10)) }))
    .filter((x) => x.days > AGING_THRESHOLD_DAYS)
    .sort((a, b) => b.days - a.days);
}
