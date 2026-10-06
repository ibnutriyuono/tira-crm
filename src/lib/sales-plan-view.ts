import { STATUS_META } from './constants';
import { num } from './format';
import type { Prospect, SafeUser, SalesPlan, SalesPlanItem } from './types';

/**
 * Who may create/edit/delete a given SE's plan: the SE themself, their own BM
 * (BM fills plans in for the SEs in their branch), or GM/Admin. RM is
 * read-only -- they aggregate across branches they don't run. Pure, so the
 * server (lib/auth.ts) and the UI share one rule.
 */
export function canEditSalesPlanFor(user: Pick<SafeUser, 'role' | 'se' | 'cabang'> | null | undefined, targetSe: string, targetCabang: string | null): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'gm') return true;
  if (user.role === 'sales') return (user.se || '').trim().toLowerCase() === (targetSe || '').trim().toLowerCase();
  if (user.role === 'bm') return (user.cabang || '').trim().toLowerCase() === (targetCabang || '').trim().toLowerCase();
  return false;
}

export interface PlanItemStatus {
  label: string;
  color: string;
  customer: string | null;
}

/** Pipeline status of one plan row, through the prospect it was pulled from. */
export function planItemStatus(item: SalesPlanItem, byId: Map<string, Prospect>): PlanItemStatus {
  if (!item.sourceProspectId) return { label: 'Manual', color: 'slate', customer: null };
  const p = byId.get(item.sourceProspectId);
  if (!p) return { label: 'Prospek dihapus', color: 'slate', customer: null };
  const st = num(p.status);
  if (st === 5 && p.terfaktur) return { label: 'DO · Terfaktur', color: 'green', customer: p.customer };
  const meta = STATUS_META[st];
  return { label: meta?.label ?? '-', color: meta?.color || 'slate', customer: p.customer };
}

export interface PlanDetailItem extends SalesPlanItem {
  index: number;
  nominal: number;
  status: PlanItemStatus;
}
export interface PlanDetailSe {
  planId: string;
  se: string;
  cabang: string;
  total: number;
  items: PlanDetailItem[];
}
export interface PlanDetailCabang {
  cabang: string;
  total: number;
  ses: PlanDetailSe[];
}

/**
 * Rencana Penjualan per cabang -> per SE -> per material for one month,
 * biggest branch / SE first. `plans` is already role-scoped by the API.
 */
export function buildSalesPlanDetail(plans: SalesPlan[], prospects: Prospect[], periode: string): PlanDetailCabang[] {
  const byId = new Map(prospects.map((p) => [p.id, p]));
  const groups = new Map<string, PlanDetailSe[]>();
  plans
    .filter((pl) => pl.periode === periode && (pl.items || []).length > 0)
    .forEach((pl) => {
      const cabang = (pl.cabang || '-').toUpperCase();
      const items = pl.items.map((it, index) => ({ ...it, index, nominal: num(it.qty) * num(it.harga), status: planItemStatus(it, byId) }));
      // se keeps its stored spelling: (se, periode) is the plan's key.
      const row: PlanDetailSe = { planId: pl.id, se: pl.se, cabang, total: items.reduce((s, it) => s + it.nominal, 0), items };
      groups.set(cabang, [...(groups.get(cabang) || []), row]);
    });
  return Array.from(groups.entries())
    .map(([cabang, ses]) => ({ cabang, ses: ses.sort((a, b) => b.total - a.total), total: ses.reduce((s, x) => s + x.total, 0) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Removes row `index` from a plan's items, but only when that row is still
 * the one the user saw (same uraian) -- if someone else edited the plan in
 * the meantime the positions may have shifted, and deleting by position alone
 * would remove the wrong material. Returns null on mismatch.
 */
export function removePlanItem<T extends { uraian?: unknown }>(items: T[], index: number, uraian: string): T[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return null;
  if (String(items[index].uraian || '').trim() !== String(uraian || '').trim()) return null;
  return items.filter((_, i) => i !== index);
}
