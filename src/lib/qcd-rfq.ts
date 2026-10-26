import { lostDateOf } from './lose-date';
import { num } from './format';
import { flowItems } from './item-flow';
import { QCD_FAKTOR_LABEL, type QcdLevel } from './qcd';
import { customerKey } from './reports';
import type { Prospect, Rfq } from './types';

/**
 * Hasil QCD dengan / tanpa RFQ.
 *
 * "Dengan RFQ" = prospek yang punya RFQ yang SUDAH DIJAWAB Purchasing (tidak
 * dibatalkan, bukan draft, minimal satu item berharga & bukan No Quote).
 * RFQ draft / batal / belum dijawab / No Quote → prospeknya masuk "Tanpa RFQ".
 *
 * Versi Purchasing (buildRfqQcd) memakai jumlah deal / item dan tonase —
 * TANPA nilai Rupiah.
 */

type RfqLite = Pick<Rfq, 'id' | 'noRfq' | 'prospectId' | 'status' | 'cancelledAt' | 'jawabanRfqDikirim' | 'noQuote' | 'items' | 'tglRfq' | 'cabang' | 'customer'>;

export function isRfqAnswered(r: RfqLite): boolean {
  if (r.cancelledAt || r.status === 'Draft' || r.noQuote) return false;
  const priced = (r.items || []).some((it) => num(it.hargaPurchasing) > 0 && !it.noQuote);
  return priced && (r.jawabanRfqDikirim || priced);
}

/** prospectId → RFQ terjawab (yang terbaru). */
export function answeredRfqByProspect(rfqs: RfqLite[]): Map<string, RfqLite> {
  const m = new Map<string, RfqLite>();
  rfqs.forEach((r) => {
    if (!r.prospectId || !isRfqAnswered(r)) return;
    const prev = m.get(r.prospectId);
    if (!prev || (r.tglRfq || '') > (prev.tglRfq || '')) m.set(r.prospectId, r);
  });
  return m;
}

export type RfqFilter = 'semua' | 'dengan' | 'tanpa';

export function filterByRfq(prospects: Prospect[], rfqs: RfqLite[], f: RfqFilter): Prospect[] {
  if (f === 'semua') return prospects;
  const m = answeredRfqByProspect(rfqs);
  return prospects.filter((p) => (f === 'dengan' ? m.has(p.id) : !m.has(p.id)));
}

const wonDate = (r: Prospect) => r.tglPO || r.tglDelivery || r.tglPenawaran || '';
const level = (v: unknown): QcdLevel | 'kosong' => (v === 'unggul' || v === 'setara' || v === 'kalah' ? v : 'kosong');
type Counts = Record<QcdLevel | 'kosong', number>;
const empty = (): Counts => ({ unggul: 0, setara: 0, kalah: 0, kosong: 0 });

export interface RfqQcdResult {
  won: number;
  lost: number;
  winRate: number | null;
  wonKg: number;
  lostKg: number;
  /** Item (dari deal ber-RFQ) yang dimenangkan / lepas. */
  itemsWon: number;
  itemsLost: number;
  trend: { periode: string; won: number; lost: number }[];
  cost: { won: Counts; lost: Counts };
  delivery: { won: Counts; lost: Counts };
  faktorKalah: { label: string; n: number }[];
  /** Kompetitor pemenang per Line / grade. */
  kompetitor: { line: string; grade: string; name: string; n: number; kg: number }[];
  /** Material yang paling sering lepas. */
  lostMaterials: { label: string; line: string; n: number; kg: number; kompetitor: string }[];
  /** RFQ yang kalah (klik buka RFQ). */
  lostRfqs: { rfqId: string; noRfq: string; customer: string; cabang: string; tgl: string; kompetitor: string; faktor: string; kg: number }[];
}

/** Hasil QCD untuk Purchasing: hanya deal dengan RFQ terjawab, tanpa nilai Rupiah. */
export function buildRfqQcd(prospects: Prospect[], rfqs: RfqLite[], months: string[], trendMonths: string[]): RfqQcdResult {
  const byP = answeredRfqByProspect(rfqs);
  const inM = (d: string) => !months.length || months.includes((d || '').slice(0, 7));
  const closed = prospects.filter((p) => byP.has(p.id) && [4, 5, 6].includes(num(p.status)));
  const dateOf = (p: Prospect) => (num(p.status) === 6 ? lostDateOf(p) : wonDate(p));
  const inPeriod = closed.filter((p) => inM(dateOf(p)));
  const won = inPeriod.filter((p) => num(p.status) !== 6);
  const lost = inPeriod.filter((p) => num(p.status) === 6);

  const res: RfqQcdResult = {
    won: won.length,
    lost: lost.length,
    winRate: inPeriod.length ? Math.round((won.length / inPeriod.length) * 100) : null,
    wonKg: 0,
    lostKg: 0,
    itemsWon: 0,
    itemsLost: 0,
    trend: trendMonths.map((periode) => ({
      periode,
      won: closed.filter((p) => num(p.status) !== 6 && dateOf(p).slice(0, 7) === periode).length,
      lost: closed.filter((p) => num(p.status) === 6 && dateOf(p).slice(0, 7) === periode).length,
    })),
    cost: { won: empty(), lost: empty() },
    delivery: { won: empty(), lost: empty() },
    faktorKalah: [],
    kompetitor: [],
    lostMaterials: [],
    lostRfqs: [],
  };
  const faktor = new Map<string, number>();
  const komp = new Map<string, { line: string; grade: string; name: string; n: number; kg: number }>();
  const mats = new Map<string, { label: string; line: string; n: number; kg: number; komp: Map<string, number> }>();

  inPeriod.forEach((p) => {
    const isWon = num(p.status) !== 6;
    const mats0 = (Array.isArray(p.materials) ? p.materials : []) as unknown as { grade?: string; line?: string }[];
    flowItems(p).forEach((it) => {
      const q = it.qcd
        ? { c: it.qcd.costLevel, d: it.qcd.deliveryLevel, f: it.qcd.faktor, k: it.qcd.kompetitor }
        : { c: p.qcdCostLevel, d: p.qcdDeliveryLevel, f: p.qcdFaktor, k: p.qcdKompetitor };
      const outcome = it.outcome || (isWon ? 'menang' : 'kalah');
      const po = it.po ?? (isWon ? it.offered : 0);
      const lostQty = outcome === 'kalah' ? it.offered : outcome === 'sebagian' ? Math.max(0, it.offered - po) : 0;
      if (outcome !== 'kalah') {
        res.itemsWon++;
        res.wonKg += po * it.kgPc;
        res.cost.won[level(q.c)]++;
        res.delivery.won[level(q.d)]++;
      }
      if (lostQty > 0) {
        const kg = lostQty * it.kgPc;
        res.itemsLost++;
        res.lostKg += kg;
        res.cost.lost[level(q.c)]++;
        res.delivery.lost[level(q.d)]++;
        if (q.f) faktor.set(q.f, (faktor.get(q.f) || 0) + 1);
        const grade = String(mats0[it.idx]?.grade || '').trim() || '-';
        const line = String(it.line || '-');
        const name = String(q.k || '').trim();
        if (name) {
          const key = `${line}|${grade.toUpperCase()}|${customerKey(name)}`;
          const e = komp.get(key) || { line, grade, name, n: 0, kg: 0 };
          e.n++;
          e.kg += kg;
          komp.set(key, e);
        }
        const mk = `${line}|${(grade !== '-' ? grade : it.label).toUpperCase()}`;
        const m = mats.get(mk) || { label: grade !== '-' ? grade : it.label, line, n: 0, kg: 0, komp: new Map() };
        m.n++;
        m.kg += kg;
        if (name) m.komp.set(name, (m.komp.get(name) || 0) + 1);
        mats.set(mk, m);
      }
    });
    if (!isWon) {
      const r = byP.get(p.id)!;
      const kg = flowItems(p).reduce((s, it) => s + it.offered * it.kgPc, 0);
      res.lostRfqs.push({
        rfqId: r.id,
        noRfq: r.noRfq || '(tanpa nomor)',
        customer: p.customer,
        cabang: (p.cabang || '-').toUpperCase(),
        tgl: lostDateOf(p),
        kompetitor: (p.qcdKompetitor || '').trim() || '-',
        faktor: QCD_FAKTOR_LABEL[p.qcdFaktor || ''] || '-',
        kg,
      });
    }
  });
  res.faktorKalah = Array.from(faktor.entries())
    .map(([k, n]) => ({ label: QCD_FAKTOR_LABEL[k] || k, n }))
    .sort((a, b) => b.n - a.n);
  res.kompetitor = Array.from(komp.values()).sort((a, b) => b.n - a.n || b.kg - a.kg);
  res.lostMaterials = Array.from(mats.values())
    .map((m) => ({ label: m.label, line: m.line, n: m.n, kg: m.kg, kompetitor: Array.from(m.komp.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '-' }))
    .sort((a, b) => b.n - a.n || b.kg - a.kg)
    .slice(0, 15);
  res.lostRfqs.sort((a, b) => (a.tgl < b.tgl ? 1 : -1));
  return res;
}
