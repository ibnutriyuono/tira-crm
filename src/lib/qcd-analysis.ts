import { lostDateOf } from './lose-date';
import { materialsWithValue, num } from './format';
import { flowItems } from './item-flow';
import type { ItemQcd } from './item-qcd';
import { QCD_DIMS, QCD_FAKTOR, QCD_FAKTOR_LABEL, qcdMissing, type QcdLevel } from './qcd';
import { customerKey } from './reports';
import type { Prospect } from './types';

/**
 * Dashboard QCD (menu Hasil QCD): why deals are won and lost, from the structured
 * QCD captured when a deal closes. A deal belongs to the period it CLOSED in:
 * Won by Tgl PO (then delivery, then offer -- the forecast rule), Lost by the
 * Tanggal Lose Order (tglLose; old rows: the date it moved to Lose).
 *
 * Deal counts (menang / kalah / win rate / kelengkapan) are per prospect.
 * The breakdowns (posisi Q/C/D, faktor, kompetitor) are per ITEM when the deal
 * carries QCD per item (lib/item-qcd.ts): a quotation of 5 items where 2 were
 * ordered and 3 went to competitors counts 2 wins and 3 losses, each with its
 * own reasons and winning competitor. Deals without item QCD count once, from
 * the prospect QCD. An item ordered only partly counts as a loss for the part
 * that was not ordered.
 */

type Counts = Record<QcdLevel | 'kosong', number>;
const emptyCounts = (): Counts => ({ unggul: 0, setara: 0, kalah: 0, kosong: 0 });

export interface QcdDashboard {
  won: number;
  lost: number;
  wonValue: number;
  lostValue: number;
  winRate: number | null;
  complete: number;
  completeness: number | null;
  dims: { key: string; label: string; options: Record<string, string>; won: Counts; lost: Counts }[];
  faktor: { key: string; label: string; won: number; lost: number; lostValue: number }[];
  kompetitor: { name: string; lost: number; lostValue: number; won: number; winRate: number | null; topFaktor: string; weakDim: string }[];
  cabang: { cabang: string; won: number; lost: number; winRate: number | null; topFaktorKalah: string; completeness: number | null }[];
  incomplete: { id: string; customer: string; cabang: string; se: string; status: number; value: number }[];
  /** Jumlah unit analisa (item ber-QCD + deal tanpa QCD item). */
  units: { won: number; lost: number; itemBased: number };
  /** Item yang lepas (kalah / sebagian), dari deal ber-QCD per item, nilai terbesar dulu. */
  lostItems: { prospectId: string; customer: string; cabang: string; item: string; partial: boolean; kompetitor: string; faktor: string; value: number }[];
}

/** One thing the breakdowns count: an item with its own QCD, or a whole deal. */
interface Unit {
  won: boolean;
  value: number;
  q: { qcdQualityLevel?: string | null; qcdCostLevel?: string | null; qcdDeliveryLevel?: string | null; qcdFaktor?: string | null; qcdKompetitor?: string | null };
}

const wonDate = (r: Prospect) => r.tglPO || r.tglDelivery || r.tglPenawaran || '';
const lostDate = (r: Prospect) => lostDateOf(r);

/** `periode` = "YYYY" (whole year) or "YYYY-MM". */
export function buildQcdDashboard(prospects: Prospect[], cabangs: string[], periode: string): QcdDashboard {
  const inCabang = new Set(cabangs.map((c) => c.toUpperCase()));
  const scoped = prospects.filter((r) => inCabang.has((r.cabang || '').trim().toUpperCase()));
  const inPeriod = (d: string) => d.startsWith(periode);
  const wonList = scoped.filter((r) => (num(r.status) === 4 || num(r.status) === 5) && inPeriod(wonDate(r)));
  const lostList = scoped.filter((r) => num(r.status) === 6 && inPeriod(lostDate(r)));
  const closed = [...wonList, ...lostList];
  const isComplete = (r: Prospect) => qcdMissing(num(r.status) === 6 ? 6 : 4, r) === null;

  const sum = (l: Prospect[]) => l.reduce((s, r) => s + num(r.value), 0);
  const usum = (l: Unit[]) => l.reduce((s, u) => s + u.value, 0);
  const level = (v: unknown): QcdLevel | 'kosong' => (v === 'unggul' || v === 'setara' || v === 'kalah' ? v : 'kosong');

  // ---- units: items with their own QCD, else the deal itself
  const units: Unit[] = [];
  const lostItems: QcdDashboard['lostItems'] = [];
  let itemBased = 0;
  const fromItem = (q: ItemQcd) => ({ qcdQualityLevel: q.qualityLevel, qcdCostLevel: q.costLevel, qcdDeliveryLevel: q.deliveryLevel, qcdFaktor: q.faktor, qcdKompetitor: q.kompetitor });
  closed.forEach((r) => {
    const items = flowItems(r);
    if (!items.some((i) => i.qcd)) {
      units.push({ won: num(r.status) !== 6, value: num(r.value), q: r });
      return;
    }
    itemBased++;
    const vals = materialsWithValue(r);
    items.forEach((it) => {
      if (!it.outcome) return;
      const q = it.qcd ? fromItem(it.qcd) : r;
      const price = it.offered > 0 ? num(vals[it.idx]?.nilai) / it.offered : 0;
      const po = it.po ?? 0;
      if (it.outcome !== 'kalah') units.push({ won: true, value: price * po, q });
      if (it.outcome !== 'menang') {
        const value = price * (it.outcome === 'kalah' ? it.offered : Math.max(0, it.offered - po));
        units.push({ won: false, value, q });
        lostItems.push({
          prospectId: r.id,
          customer: r.customer,
          cabang: r.cabang || '-',
          item: it.label,
          partial: it.outcome === 'sebagian',
          kompetitor: (q.qcdKompetitor || '').trim() || '-',
          faktor: QCD_FAKTOR_LABEL[q.qcdFaktor || ''] || '-',
          value,
        });
      }
    });
  });
  const wonU = units.filter((u) => u.won);
  const lostU = units.filter((u) => !u.won);

  const dims = QCD_DIMS.map((d) => {
    const won = emptyCounts();
    const lost = emptyCounts();
    wonU.forEach((u) => won[level(u.q[d.field])]++);
    lostU.forEach((u) => lost[level(u.q[d.field])]++);
    return { key: d.key, label: d.label, options: d.options, won, lost };
  });

  const faktor = QCD_FAKTOR.map((f) => {
    const lostF = lostU.filter((u) => u.q.qcdFaktor === f.key);
    return { key: f.key, label: f.label, won: wonU.filter((u) => u.q.qcdFaktor === f.key).length, lost: lostF.length, lostValue: usum(lostF) };
  }).filter((f) => f.won || f.lost);

  // Competitors: lost items/deals name the winner; won ones may name who we beat.
  const comp = new Map<string, { name: string; lost: Unit[]; won: number }>();
  const add = (u: Unit) => {
    const n = (u.q.qcdKompetitor || '').trim();
    if (!n) return;
    const k = customerKey(n);
    const e = comp.get(k) || { name: n, lost: [], won: 0 };
    if (u.won) e.won++;
    else e.lost.push(u);
    comp.set(k, e);
  };
  units.forEach(add);
  const mostCommon = (vals: (string | null | undefined)[]) => {
    const m = new Map<string, number>();
    vals.forEach((v) => v && m.set(v, (m.get(v) || 0) + 1));
    let best = '';
    let n = 0;
    m.forEach((c, k) => {
      if (c > n) {
        best = k;
        n = c;
      }
    });
    return best;
  };
  const kompetitor = Array.from(comp.values())
    .map((e) => {
      const weak = QCD_DIMS.map((d) => ({ label: d.label, n: e.lost.filter((u) => u.q[d.field] === 'kalah').length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)[0];
      const decided = e.won + e.lost.length;
      return {
        name: e.name,
        lost: e.lost.length,
        lostValue: usum(e.lost),
        won: e.won,
        winRate: decided ? Math.round((e.won / decided) * 100) : null,
        topFaktor: QCD_FAKTOR_LABEL[mostCommon(e.lost.map((u) => u.q.qcdFaktor))] || '-',
        weakDim: weak ? weak.label : '-',
      };
    })
    .sort((a, b) => b.lostValue - a.lostValue || b.lost - a.lost);

  const cabang = cabangs
    .map((c) => {
      const w = wonList.filter((r) => (r.cabang || '').toUpperCase() === c.toUpperCase());
      const l = lostList.filter((r) => (r.cabang || '').toUpperCase() === c.toUpperCase());
      const all = [...w, ...l];
      return {
        cabang: c,
        won: w.length,
        lost: l.length,
        winRate: all.length ? Math.round((w.length / all.length) * 100) : null,
        topFaktorKalah: QCD_FAKTOR_LABEL[mostCommon(l.map((r) => r.qcdFaktor))] || '-',
        completeness: all.length ? Math.round((all.filter(isComplete).length / all.length) * 100) : null,
      };
    })
    .filter((x) => x.won || x.lost);

  const complete = closed.filter(isComplete).length;
  return {
    won: wonList.length,
    lost: lostList.length,
    wonValue: sum(wonList),
    lostValue: sum(lostList),
    winRate: closed.length ? Math.round((wonList.length / closed.length) * 100) : null,
    complete,
    completeness: closed.length ? Math.round((complete / closed.length) * 100) : null,
    dims,
    faktor,
    kompetitor,
    cabang,
    incomplete: closed
      .filter((r) => !isComplete(r))
      .sort((a, b) => num(b.value) - num(a.value))
      .map((r) => ({ id: r.id, customer: r.customer, cabang: r.cabang || '-', se: r.se || '-', status: num(r.status), value: num(r.value) })),
    units: { won: wonU.length, lost: lostU.length, itemBased },
    lostItems: lostItems.sort((a, b) => b.value - a.value),
  };
}
