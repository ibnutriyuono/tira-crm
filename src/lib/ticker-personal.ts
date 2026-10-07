import { num } from './format';
import { qcdMissing } from './qcd';
import { countUrgentFollowUps, daysSince } from './reports';
import type { Prospect, SafeUser, SalesPlan } from './types';

/**
 * Running-text reminders for the person looking at it, computed in the
 * browser from data the API already scoped to their role (Sales: own deals,
 * BM: branch, RM: region, GM: all) -- so each user gets their own numbers.
 */
export interface PersonalTicker {
  followUp: number;
  qcdMissing: number;
  gitOld: { count: number; value: number };
  /** Sales only: no Rencana Penjualan saved for the running month. */
  planMissing: boolean;
}

const localPeriode = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function buildPersonalTicker(user: Pick<SafeUser, 'role' | 'se'> | null, prospects: Prospect[], plans: SalesPlan[], now = new Date()): PersonalTicker {
  const periode = localPeriode(now);
  const closedThisMonth = prospects.filter((r) => {
    const st = num(r.status);
    if (st === 4 || st === 5) return (r.tglPO || r.tglDelivery || r.tglPenawaran || '').slice(0, 7) === periode;
    if (st === 6) return String(r.statusChangedAt || '').slice(0, 7) === periode;
    return false;
  });
  const git = prospects.filter((r) => {
    if (num(r.status) !== 5 || r.terfaktur) return false;
    const d = r.tglDelivery || r.tglPO || String(r.statusChangedAt || '').slice(0, 10);
    const days = daysSince(d);
    return Number.isFinite(days) && days > 30;
  });
  const mySe = (user?.se || '').trim().toLowerCase();
  const planMissing =
    user?.role === 'sales' && !!mySe && !plans.some((p) => p.periode === periode && p.se.trim().toLowerCase() === mySe && (p.items || []).length > 0);
  return {
    followUp: countUrgentFollowUps(prospects),
    qcdMissing: closedThisMonth.filter((r) => qcdMissing(num(r.status) === 6 ? 6 : 4, r) !== null).length,
    gitOld: { count: git.length, value: git.reduce((s, r) => s + num(r.value), 0) },
    planMissing,
  };
}
