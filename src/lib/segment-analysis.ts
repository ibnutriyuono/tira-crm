/**
 * Analisa Eksekutif › Segmen: kinerja per segmen & sub-segmen customer,
 * peta segmen × cabang, dan harga jual rata-rata per grade (Rp/kg).
 *
 * Segmen prospek = segmen customer-nya di Kelola Customer (lib/customer-segments),
 * cadangan: segmen grup Key Account; selain itu "(Belum diisi)".
 * Definisi menang/kalah sama dengan exec-analysis: menang = PO/DO, tanggal
 * Tgl PO → Delivery → Penawaran; kalah = Lose, tanggal Lose.
 *
 * Harga rata-rata per grade = total nilai ÷ total kg (tertimbang tonase),
 * hanya baris material yang punya berat & harga. Dasar "Penawaran" = semua
 * item yang ditawarkan (tanggal penawaran di periode); "PO" = qty PO per item
 * (tanggal PO di periode). Ini harga JUAL — HPP tidak dipakai.
 */
import { STAGE_PROBABILITY } from './constants';
import { SEG_OTHERS, SEG_SUPPLIER } from './customer-segments';
import { classify, num } from './format';
import { buildGroupIndex, groupForCustomer } from './kam';
import { lostDateOf } from './lose-date';
import { buildTrendRows } from './material-trend';
import { brandInText, gradeKey, gradesInText } from './material-learn';
import { customerKey } from './reports';
import { prevMonths, wonDateOf, type Range } from './exec-more';
import type { Customer, CustomerGroup, Prospect } from './types';

export const SEG_NONE = '(Belum diisi)';
const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

export interface SegMetrics {
  customers: number;
  buyers: number;
  won: number;
  wonPrev: number;
  growth: number | null;
  share: number | null;
  wonCount: number;
  lostCount: number;
  winRate: number | null;
  avgDeal: number | null;
  pipeline: number;
  weighted: number;
  openCount: number;
}

export interface SegRow extends SegMetrics {
  segmen: string;
  subs: (SegMetrics & { sub: string })[];
  topGrades: string[];
}

export interface GradePrice {
  grade: string;
  bentuk: string;
  /** Rata-rata Rp/kg penawaran & PO pada periode, dan periode sebelumnya (dasar PO, cadangan penawaran). */
  offRpKg: number | null;
  offKg: number;
  offN: number;
  poRpKg: number | null;
  poKg: number;
  poN: number;
  min: number | null;
  max: number | null;
  prevRpKg: number | null;
  change: number | null;
  /** Rp/kg per segmen (dasar PO bila ada, selain itu penawaran). */
  bySeg: Record<string, number>;
}

export interface SegmentAnalysis {
  rows: SegRow[];
  total: SegMetrics;
  cabangs: string[];
  heat: Record<string, Record<string, number>>;
  unknownShare: number | null;
  unknownCustomers: number;
  prices: GradePrice[];
  priceSegs: string[];
  insights: string[];
}

function emptyM(): SegMetrics {
  return { customers: 0, buyers: 0, won: 0, wonPrev: 0, growth: null, share: null, wonCount: 0, lostCount: 0, winRate: null, avgDeal: null, pipeline: 0, weighted: 0, openCount: 0 };
}

export function segmentOfFactory(customers: Customer[], groups: CustomerGroup[]) {
  const byKey = new Map(customers.map((c) => [customerKey(c.name), c]));
  const gi = buildGroupIndex(groups);
  return (name: string): { seg: string; sub: string } => {
    const c = byKey.get(customerKey(name));
    if (c?.segmen) return { seg: c.segmen, sub: c.segmen === SEG_OTHERS ? '' : c.subSegmen || '' };
    const g = groupForCustomer(gi, name);
    if (g?.segmen) return { seg: g.segmen, sub: '' };
    return { seg: SEG_NONE, sub: '' };
  };
}

export function buildSegmentAnalysis(inp: { prospects: Prospect[]; customers: Customer[]; groups: CustomerGroup[]; range: Range; cabangFilter?: string; segFilter?: string }): SegmentAnalysis {
  const { range } = inp;
  const months = new Set(range.months);
  const prev = new Set(prevMonths(range.months));
  const inR = (d: string | null | undefined) => !!d && months.has(d.slice(0, 7));
  const inP = (d: string | null | undefined) => !!d && prev.has(d.slice(0, 7));
  const segOf = segmentOfFactory(inp.customers, inp.groups);
  const cab = up(inp.cabangFilter);
  const prospects = inp.prospects.filter((p) => !cab || up(p.cabang) === cab);

  type Acc = SegMetrics & { buyerSet: Set<string>; custSet: Set<string> };
  const mk = (): Acc => ({ ...emptyM(), buyerSet: new Set(), custSet: new Set() });
  const segAcc = new Map<string, Acc>();
  const subAcc = new Map<string, Map<string, Acc>>();
  const total = mk();
  const heat: Record<string, Record<string, number>> = {};
  const cabSet = new Set<string>();
  const add = (a: Acc, p: Prospect, ck: string) => {
    const k = classify(p);
    a.custSet.add(ck);
    if (k === 'Won') {
      const d = wonDateOf(p);
      if (inR(d)) {
        a.won += num(p.value);
        a.wonCount += 1;
        a.buyerSet.add(ck);
      } else if (inP(d)) a.wonPrev += num(p.value);
    } else if (k === 'Lost' && inR(lostDateOf(p))) a.lostCount += 1;
    else if (k === 'Aktif') {
      a.pipeline += num(p.value);
      a.weighted += num(p.value) * (STAGE_PROBABILITY[num(p.status)] || 0);
      a.openCount += 1;
    }
  };

  for (const p of prospects) {
    if (num(p.status) < 1) continue;
    const { seg, sub } = segOf(p.customer);
    const ck = customerKey(p.customer);
    if (!segAcc.has(seg)) segAcc.set(seg, mk());
    add(segAcc.get(seg)!, p, ck);
    add(total, p, ck);
    const subKey = sub || '—';
    if (!subAcc.has(seg)) subAcc.set(seg, new Map());
    const sm = subAcc.get(seg)!;
    if (!sm.has(subKey)) sm.set(subKey, mk());
    add(sm.get(subKey)!, p, ck);
    if (classify(p) === 'Won' && inR(wonDateOf(p))) {
      const c = up(p.cabang) || '-';
      cabSet.add(c);
      heat[seg] = heat[seg] || {};
      heat[seg][c] = (heat[seg][c] || 0) + num(p.value);
    }
  }

  const fin = (a: Acc): SegMetrics => ({
    customers: a.custSet.size,
    buyers: a.buyerSet.size,
    won: a.won,
    wonPrev: a.wonPrev,
    growth: a.wonPrev > 0 ? Math.round(((a.won - a.wonPrev) / a.wonPrev) * 100) : null,
    share: pct(a.won, total.won),
    wonCount: a.wonCount,
    lostCount: a.lostCount,
    winRate: pct(a.wonCount, a.wonCount + a.lostCount),
    avgDeal: a.wonCount ? a.won / a.wonCount : null,
    pipeline: a.pipeline,
    weighted: a.weighted,
    openCount: a.openCount,
  });

  // ---- harga per grade
  const trend = buildTrendRows(prospects);
  const pById = new Map(prospects.map((p) => [p.id, p]));
  type PA = { grade: string; bentuk: Map<string, number>; offV: number; offKg: number; offN: number; poV: number; poKg: number; poN: number; prevV: number; prevKg: number; min: number; max: number; seg: Map<string, { v: number; kg: number; po: boolean }> };
  const gAcc = new Map<string, PA>();
  const segKgByGrade = new Map<string, Map<string, number>>();
  for (const r of trend) {
    if (r.fab || !r.kgPc || !r.unitPrice) continue;
    // Grade kosong di form: baca dari uraian (grade terpelajari / nama merek).
    let gName = r.grade;
    let gKey = r.gradeKey;
    if (gKey.startsWith('~')) {
      gName = gradesInText(r.label)[0] || brandInText(r.label);
      gKey = gName ? gradeKey(gName) : '';
      if (!gKey) continue;
    }
    const p = pById.get(r.prospectId);
    if (!p) continue;
    const { seg } = segOf(p.customer);
    if (inp.segFilter && seg !== inp.segFilter) continue;
    const rpKg = r.unitPrice / r.kgPc;
    if (!(rpKg > 0) || rpKg > 5e6) continue; // salah ketik (mis. harga total di kolom harga/kg)
    const a = gAcc.get(gKey) || { grade: gName, bentuk: new Map(), offV: 0, offKg: 0, offN: 0, poV: 0, poKg: 0, poN: 0, prevV: 0, prevKg: 0, min: Infinity, max: 0, seg: new Map() };
    let used = false;
    const offKg = r.offQty * r.kgPc;
    const poKg = r.poQty * r.kgPc;
    if (offKg > 0 && months.has(r.offMonth)) {
      a.offV += offKg * rpKg;
      a.offKg += offKg;
      a.offN += 1;
      used = true;
      const s = a.seg.get(seg) || { v: 0, kg: 0, po: false };
      if (!s.po) {
        s.v += offKg * rpKg;
        s.kg += offKg;
      }
      a.seg.set(seg, s);
    }
    if (poKg > 0 && months.has(r.poMonth)) {
      a.poV += poKg * rpKg;
      a.poKg += poKg;
      a.poN += 1;
      used = true;
      const s = a.seg.get(seg) || { v: 0, kg: 0, po: false };
      if (!s.po) Object.assign(s, { v: 0, kg: 0, po: true });
      s.v += poKg * rpKg;
      s.kg += poKg;
      a.seg.set(seg, s);
    }
    // Grade utama per segmen: tonase PO (bobot penuh) + penawaran (bobot 1/4).
    const w = (poKg > 0 && months.has(r.poMonth) ? poKg : 0) + (offKg > 0 && months.has(r.offMonth) ? offKg / 4 : 0);
    if (w > 0) {
      const sk = segKgByGrade.get(seg) || new Map();
      sk.set(gName, (sk.get(gName) || 0) + w);
      segKgByGrade.set(seg, sk);
    }
    const prevKg = (prev.has(r.poMonth) ? poKg : 0) || (prev.has(r.offMonth) ? offKg : 0);
    if (prevKg > 0) {
      a.prevV += prevKg * rpKg;
      a.prevKg += prevKg;
    }
    if (used) {
      a.min = Math.min(a.min, rpKg);
      a.max = Math.max(a.max, rpKg);
      a.bentuk.set(r.bentuk, (a.bentuk.get(r.bentuk) || 0) + 1);
    }
    gAcc.set(gKey, a);
  }
  const segTotals = new Map<string, number>();
  const prices: GradePrice[] = [...gAcc.values()]
    .filter((a) => a.offKg > 0 || a.poKg > 0)
    .map((a) => {
      const cur = a.poKg > 0 ? a.poV / a.poKg : a.offKg > 0 ? a.offV / a.offKg : null;
      const prevRp = a.prevKg > 0 ? a.prevV / a.prevKg : null;
      const bySeg: Record<string, number> = {};
      a.seg.forEach((s, k) => {
        if (s.kg > 0) {
          bySeg[k] = s.v / s.kg;
          segTotals.set(k, (segTotals.get(k) || 0) + s.kg);
        }
      });
      let bentuk = '';
      let n = 0;
      a.bentuk.forEach((v, k) => {
        if (v > n) {
          n = v;
          bentuk = k;
        }
      });
      return {
        grade: a.grade,
        bentuk,
        offRpKg: a.offKg > 0 ? a.offV / a.offKg : null,
        offKg: a.offKg,
        offN: a.offN,
        poRpKg: a.poKg > 0 ? a.poV / a.poKg : null,
        poKg: a.poKg,
        poN: a.poN,
        min: Number.isFinite(a.min) ? a.min : null,
        max: a.max || null,
        prevRpKg: prevRp,
        change: cur != null && prevRp ? Math.round(((cur - prevRp) / prevRp) * 100) : null,
        bySeg,
      };
    })
    .sort((x, y) => y.poKg + y.offKg / 4 - (x.poKg + x.offKg / 4));
  const priceSegs = [...segTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 8);

  const rows: SegRow[] = [...segAcc.entries()]
    .map(([segmen, a]) => ({
      segmen,
      ...fin(a),
      subs: [...(subAcc.get(segmen) || new Map()).entries()].map(([sub, sa]) => ({ sub, ...fin(sa) })).sort((x, y) => y.won - x.won || y.pipeline - x.pipeline),
      topGrades: [...(segKgByGrade.get(segmen) || new Map()).entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([g]) => g),
    }))
    .sort((x, y) => (x.segmen === SEG_NONE ? 1 : 0) - (y.segmen === SEG_NONE ? 1 : 0) || y.won - x.won || y.pipeline - x.pipeline);

  const totalM = fin(total);
  const unknownWon = rows.filter((r) => r.segmen === SEG_NONE || r.segmen === SEG_OTHERS).reduce((s, r) => s + r.won, 0);
  const unknownCustomers = rows.filter((r) => r.segmen === SEG_NONE || r.segmen === SEG_OTHERS).reduce((s, r) => s + r.customers, 0);
  const cabangs = [...cabSet].sort();

  // ---- temuan
  const ins: string[] = [];
  const known = rows.filter((r) => r.segmen !== SEG_NONE && r.segmen !== SEG_OTHERS && r.won > 0);
  if (known[0]) ins.push(`${known[0].segmen} menyumbang ${known[0].share ?? 0}% realisasi periode ini${known[0].subs[0] && known[0].subs[0].sub !== '—' ? ` — terbesar dari sub-segmen ${known[0].subs[0].sub}` : ''}.`);
  const grow = known.filter((r) => r.growth != null && r.wonPrev > 0).sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0));
  if (grow[0] && (grow[0].growth ?? 0) > 0) ins.push(`Tumbuh paling cepat: ${grow[0].segmen} (+${grow[0].growth}% dibanding periode sebelumnya).`);
  const drop = grow[grow.length - 1];
  if (drop && (drop.growth ?? 0) < -15) ins.push(`Turun paling dalam: ${drop.segmen} (${drop.growth}%) — cek customer yang mulai hilang di segmen ini.`);
  const pipeNoWon = rows.filter((r) => r.segmen !== SEG_NONE && r.pipeline > 0 && r.won === 0).sort((a, b) => b.pipeline - a.pipeline)[0];
  if (pipeNoWon) ins.push(`${pipeNoWon.segmen} punya pipeline aktif tetapi belum ada realisasi di periode ini — peluang closing.`);
  const lowWin = known.filter((r) => r.winRate != null && r.wonCount + r.lostCount >= 4).sort((a, b) => (a.winRate ?? 0) - (b.winRate ?? 0))[0];
  if (lowWin && (lowWin.winRate ?? 100) < 40) ins.push(`Win rate terendah: ${lowWin.segmen} (${lowWin.winRate}%) — periksa harga & kompetitor di segmen ini.`);
  const sup = rows.find((r) => r.segmen === SEG_SUPPLIER);
  if (sup && sup.share) ins.push(`Penjualan lewat Supplier (trader / fabrikator) ${sup.share}% dari realisasi.`);
  const unk = pct(unknownWon, totalM.won);
  if (unk && unk >= 10) ins.push(`${unk}% realisasi berasal dari customer yang segmennya kosong / Others — lengkapi agar analisa segmen akurat.`);
  const pUp = prices.filter((p) => p.change != null && p.poKg + p.offKg > 0).sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
  if (pUp[0] && (pUp[0].change ?? 0) >= 5) ins.push(`Harga rata-rata ${pUp[0].grade} naik ${pUp[0].change}% dibanding periode sebelumnya.`);
  const pDn = pUp[pUp.length - 1];
  if (pDn && (pDn.change ?? 0) <= -5) ins.push(`Harga rata-rata ${pDn.grade} turun ${Math.abs(pDn.change ?? 0)}% — cek apakah diskon makin dalam.`);

  return { rows, total: totalM, cabangs, heat, unknownShare: unk, unknownCustomers, prices, priceSegs, insights: ins };
}
