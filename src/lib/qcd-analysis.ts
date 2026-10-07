import { num } from './format';
import { QCD_DIMS, QCD_FAKTOR, QCD_FAKTOR_LABEL, qcdMissing, type QcdLevel } from './qcd';
import { customerKey } from './reports';
import type { Prospect } from './types';

/**
 * Dashboard QCD (menu Hasil QCD): why deals are won and lost, from the structured
 * QCD captured when a deal closes. A deal belongs to the period it CLOSED in:
 * Won by Tgl PO (then delivery, then offer -- the forecast rule), Lost by the
 * date it moved to Lose (statusChangedAt).
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
}

const wonDate = (r: Prospect) => r.tglPO || r.tglDelivery || r.tglPenawaran || '';
const lostDate = (r: Prospect) => String(r.statusChangedAt || '').slice(0, 10);

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
  const level = (v: unknown): QcdLevel | 'kosong' => (v === 'unggul' || v === 'setara' || v === 'kalah' ? v : 'kosong');

  const dims = QCD_DIMS.map((d) => {
    const won = emptyCounts();
    const lost = emptyCounts();
    wonList.forEach((r) => won[level(r[d.field])]++);
    lostList.forEach((r) => lost[level(r[d.field])]++);
    return { key: d.key, label: d.label, options: d.options, won, lost };
  });

  const faktor = QCD_FAKTOR.map((f) => {
    const lostF = lostList.filter((r) => r.qcdFaktor === f.key);
    return { key: f.key, label: f.label, won: wonList.filter((r) => r.qcdFaktor === f.key).length, lost: lostF.length, lostValue: sum(lostF) };
  }).filter((f) => f.won || f.lost);

  // Competitors: lost deals name the winner; won deals may name who we beat.
  const comp = new Map<string, { name: string; lost: Prospect[]; won: number }>();
  const add = (r: Prospect, won: boolean) => {
    const n = (r.qcdKompetitor || '').trim();
    if (!n) return;
    const k = customerKey(n);
    const e = comp.get(k) || { name: n, lost: [], won: 0 };
    if (won) e.won++;
    else e.lost.push(r);
    comp.set(k, e);
  };
  wonList.forEach((r) => add(r, true));
  lostList.forEach((r) => add(r, false));
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
      const weak = QCD_DIMS.map((d) => ({ label: d.label, n: e.lost.filter((r) => r[d.field] === 'kalah').length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)[0];
      const decided = e.won + e.lost.length;
      return {
        name: e.name,
        lost: e.lost.length,
        lostValue: sum(e.lost),
        won: e.won,
        winRate: decided ? Math.round((e.won / decided) * 100) : null,
        topFaktor: QCD_FAKTOR_LABEL[mostCommon(e.lost.map((r) => r.qcdFaktor))] || '-',
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
  };
}
