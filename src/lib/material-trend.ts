import { getProspectMaterials, materialUnitPrice, num } from './format';
import { flowItems } from './item-flow';
import { GRADE_SUGGESTIONS, autoWeight, parseMaterialText, roundUpKg, type Dims } from './material-spec';
import type { Material, Prospect } from './types';

/**
 * Tren Material (Analisa Eksekutif > Product): every material row of every
 * quotation, keyed by grade + bentuk + kelompok ukuran, counted three ways --
 * ditawarkan (bulan tgl penawaran), PO (bulan tgl PO, qty PO per item) and
 * terkirim (bulan tgl delivery, qty terkirim per item; see lib/item-flow.ts).
 *
 * Rows from the uniform material form carry bentuk/grade/dim; older rows are
 * read from their uraian text (parseMaterialText). Line 05 (fabrikasi) is
 * counted per qty & satuan on its own, never mixed into the tonnage.
 */

export type Basis = 'off' | 'po' | 'kirim';
export type Measure = 'kg' | 'pcs' | 'nilai';
export type ParseSource = 'form' | 'teks' | 'gagal';

export interface ShapeGroup {
  key: string;
  label: string;
  dimLabel: string;
  bentuk: string[];
  dim: (d: Dims) => string | undefined;
  cuts: number[];
}

export const SHAPE_GROUPS: ShapeGroup[] = [
  { key: 'bar', label: 'Bar (Round / Square / Hex)', dimLabel: 'Diameter / sisi (mm)', bentuk: ['Round Bar', 'Square Bar', 'Hex Bar'], dim: (d) => d.dia || d.sisi, cuts: [30, 60, 100, 200] },
  { key: 'plate', label: 'Plate / Flat Bar / Coil', dimLabel: 'Tebal (mm)', bentuk: ['Plate', 'Flat Bar', 'Coil'], dim: (d) => d.tebal, cuts: [10, 25, 50, 100] },
  { key: 'pipe', label: 'Pipe / Hollow', dimLabel: 'OD / sisi (mm)', bentuk: ['Pipe', 'Hollow'], dim: (d) => d.od || d.sisi, cuts: [50, 150] },
  { key: 'profil', label: 'Beam / Profil', dimLabel: 'Tinggi (mm)', bentuk: ['Beam', 'Profil Siku', 'Profil UNP'], dim: (d) => d.h, cuts: [150, 300] },
  { key: 'lain', label: 'Lainnya (Wire Mesh, dll.)', dimLabel: 'Ukuran', bentuk: [], dim: () => undefined, cuts: [] },
];
export const NO_SIZE = 'Tanpa ukuran';
export const NO_GRADE = '(Tanpa grade)';
export const UNREAD = '(Tidak terbaca)';

export function groupOf(bentuk: string): ShapeGroup {
  return SHAPE_GROUPS.find((g) => g.bentuk.includes(bentuk)) || SHAPE_GROUPS[SHAPE_GROUPS.length - 1];
}

export function bucketLabels(cuts: number[]): string[] {
  if (!cuts.length) return [NO_SIZE];
  const out = [`≤${cuts[0]}`];
  for (let i = 1; i < cuts.length; i++) out.push(`${cuts[i - 1] + 1}–${cuts[i]}`);
  out.push(`>${cuts[cuts.length - 1]}`);
  return [...out, NO_SIZE];
}

export function bucketOf(cuts: number[], v: number): string {
  if (!cuts.length || !(v > 0)) return NO_SIZE;
  const labels = bucketLabels(cuts);
  for (let i = 0; i < cuts.length; i++) if (v <= cuts[i]) return labels[i];
  return labels[cuts.length];
}

const gradeKey = (g: string) => g.toUpperCase().replace(/[\s\-_.]/g, '');
const CANON = new Map(GRADE_SUGGESTIONS.map((g) => [gradeKey(g), g]));

export interface TrendRow {
  prospectId: string;
  customer: string;
  cabang: string;
  status: number;
  label: string;
  fab: boolean;
  satuan: string;
  grade: string;
  gradeKey: string;
  bentuk: string;
  group: string;
  bucket: string;
  parse: ParseSource;
  kgPc: number;
  unitPrice: number;
  offQty: number;
  poQty: number;
  sentQty: number;
  offMonth: string;
  poMonth: string;
  sentMonth: string;
}

const month = (d: string | null | undefined) => (d && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : '');
const toNum = (v: unknown) => parseFloat(String(v ?? '').replace(',', '.')) || 0;

export function buildTrendRows(prospects: Prospect[]): TrendRow[] {
  const out: TrendRow[] = [];
  prospects.forEach((p) => {
    const status = num(p.status);
    if (status < 1) return; // Sales Activity: belum ada penawaran
    const mats = getProspectMaterials(p) as (Material & { bentuk?: string; grade?: string; dim?: Dims; fabNama?: string; satuan?: string })[];
    const flow = flowItems(p);
    const offMonth = month(p.tglPenawaran) || month(p.createdAt);
    const poMonth = month(p.tglPO) || offMonth;
    const sentMonth = month(p.tglDelivery) || poMonth;
    mats.forEach((m, i) => {
      const f = flow[i];
      const fab = f?.fab ?? false;
      let bentuk = m.bentuk || '';
      let grade = String(m.grade || '').trim();
      let dim: Dims = m.dim || {};
      let parse: ParseSource = 'form';
      if (!fab && !bentuk) {
        const t = parseMaterialText(m.uraian || '');
        bentuk = t.bentuk;
        grade = grade || t.grade;
        dim = t.dim;
        parse = t.bentuk !== 'Lainnya' || t.grade ? 'teks' : 'gagal';
      }
      const key = gradeKey(grade);
      const g = groupOf(bentuk);
      const kgPc = fab ? 0 : num(m.beratPc) || roundUpKg(autoWeight(bentuk, dim));
      out.push({
        prospectId: p.id,
        customer: p.customer,
        cabang: (p.cabang || '').trim().toUpperCase(),
        status,
        label: String(m.uraian || m.fabNama || '').trim(),
        fab,
        satuan: f?.satuan || 'pcs',
        grade: fab ? '' : parse === 'gagal' ? UNREAD : key ? CANON.get(key) || grade.toUpperCase() : NO_GRADE,
        gradeKey: fab ? '' : parse === 'gagal' ? '~unread' : key || '~none',
        bentuk,
        group: fab ? '' : g.key,
        bucket: fab ? '' : bucketOf(g.cuts, toNum(g.dim(dim))),
        parse: fab ? 'form' : parse,
        kgPc,
        // Old rows often have harga/kg but no berat/pc: price them on the computed weight.
        unitPrice: kgPc > 0 && num(m.hargaKg) > 0 ? kgPc * num(m.hargaKg) : materialUnitPrice(m),
        offQty: num(m.qty),
        poQty: status === 4 || status === 5 ? f?.po || 0 : 0,
        sentQty: status === 4 || status === 5 ? f?.sent || 0 : 0,
        offMonth,
        poMonth,
        sentMonth,
      });
    });
  });
  return out;
}

/** YYYY-MM list of `n` months ending at `end` (inclusive), oldest first. */
export function monthsEnding(end: string, n: number): string[] {
  const [y, m] = end.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const qtyFor = (r: TrendRow, b: Basis) => (b === 'off' ? r.offQty : b === 'po' ? r.poQty : r.sentQty);
const monthFor = (r: TrendRow, b: Basis) => (b === 'off' ? r.offMonth : b === 'po' ? r.poMonth : r.sentMonth);
export function measureOf(r: TrendRow, b: Basis, m: Measure): number {
  const q = qtyFor(r, b);
  return m === 'pcs' ? q : m === 'kg' ? q * r.kgPc : q * r.unitPrice;
}

export interface GradeStat {
  key: string;
  grade: string;
  offers: number;
  customers: number;
  pcs: number;
  offKg: number;
  poKg: number;
  sentKg: number;
  nilaiPo: number;
  rpKg: number;
  conv: number | null;
  score: number;
  trend: number | null;
  series: number[];
  topBucket: string;
}

export interface Mover {
  grade: string;
  bucket: string;
  prev: number;
  last: number;
  change: number;
}

export interface TrendResult {
  months: string[];
  series12: string[];
  group: ShapeGroup;
  buckets: string[];
  kpi: { offKg: number; poKg: number; sentKg: number; nilaiPo: number; rpKg: number; conv: number | null; grades: number };
  grades: GradeStat[];
  heat: { key: string; grade: string; cells: number[]; total: number }[];
  heatMax: number;
  monthly: (key: string) => { month: string; off: number; po: number }[];
  up: Mover[];
  down: Mover[];
  fab: { label: string; satuan: string; offers: number; off: number; po: number; conv: number | null }[];
  quality: { form: number; teks: number; gagal: number; total: number; examples: string[] };
  groupTotals: Record<string, number>;
}

/** Trend label threshold and the minimum volume (kg, pcs or Rp) for a mover to count. */
export const TREND_THRESHOLD = 0.15;

export function analyzeTrend(all: TrendRow[], opts: { end: string; period: number; group?: string; basis: Basis; measure: Measure }): TrendResult {
  const months = monthsEnding(opts.end, opts.period);
  const series12 = monthsEnding(opts.end, 12);
  const last3 = new Set(monthsEnding(opts.end, 3));
  const prev3 = new Set(monthsEnding(opts.end, 6).slice(0, 3));
  const inPeriod = new Set(months);
  const steel = all.filter((r) => !r.fab);

  // Which shape group to show: asked for, else the biggest one this period.
  const groupTotals: Record<string, number> = {};
  steel.forEach((r) => {
    if (inPeriod.has(monthFor(r, opts.basis))) groupTotals[r.group] = (groupTotals[r.group] || 0) + measureOf(r, opts.basis, 'kg');
  });
  const groupKey = opts.group || Object.entries(groupTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || 'bar';
  const group = SHAPE_GROUPS.find((g) => g.key === groupKey) || SHAPE_GROUPS[0];
  const rows = steel.filter((r) => r.group === group.key);
  const buckets = bucketLabels(group.cuts);

  const byGrade = new Map<string, TrendRow[]>();
  rows.forEach((r) => {
    const l = byGrade.get(r.gradeKey) || [];
    l.push(r);
    byGrade.set(r.gradeKey, l);
  });

  const sumOf = (list: TrendRow[], b: Basis, m: Measure, keep: (mo: string) => boolean) =>
    list.reduce((s, r) => s + (keep(monthFor(r, b)) ? measureOf(r, b, m) : 0), 0);

  const grades: GradeStat[] = Array.from(byGrade.entries()).map(([key, list]) => {
    const inP = (b: Basis) => list.filter((r) => inPeriod.has(monthFor(r, b)));
    const offRows = inP('off');
    const offKg = sumOf(list, 'off', 'kg', (mo) => inPeriod.has(mo));
    const poKg = sumOf(list, 'po', 'kg', (mo) => inPeriod.has(mo));
    const sentKg = sumOf(list, 'kirim', 'kg', (mo) => inPeriod.has(mo));
    const nilaiPo = sumOf(list, 'po', 'nilai', (mo) => inPeriod.has(mo));
    const last = sumOf(list, opts.basis, opts.measure, (mo) => last3.has(mo));
    const prev = sumOf(list, opts.basis, opts.measure, (mo) => prev3.has(mo));
    const bucketTot = new Map<string, number>();
    list.forEach((r) => inPeriod.has(monthFor(r, opts.basis)) && bucketTot.set(r.bucket, (bucketTot.get(r.bucket) || 0) + measureOf(r, opts.basis, opts.measure)));
    return {
      key,
      grade: list[0].grade,
      offers: new Set(offRows.map((r) => r.prospectId)).size,
      customers: new Set(offRows.map((r) => r.customer.trim().toUpperCase())).size,
      pcs: sumOf(list, opts.basis, 'pcs', (mo) => inPeriod.has(mo)),
      offKg,
      poKg,
      sentKg,
      nilaiPo,
      rpKg: poKg > 0 ? nilaiPo / poKg : 0,
      conv: offKg > 0 ? poKg / offKg : null,
      score: sumOf(list, opts.basis, opts.measure, (mo) => inPeriod.has(mo)),
      trend: prev > 0 ? last / prev - 1 : null,
      series: series12.map((mo) => sumOf(list, opts.basis, opts.measure, (x) => x === mo)),
      topBucket: Array.from(bucketTot.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '-',
    };
  })
    .filter((g) => g.score > 0 || g.offKg > 0)
    .sort((a, b) => b.score - a.score);

  const heat = grades.map((g) => {
    const list = byGrade.get(g.key) || [];
    const cells = buckets.map((bk) => list.reduce((s, r) => s + (r.bucket === bk && inPeriod.has(monthFor(r, opts.basis)) ? measureOf(r, opts.basis, opts.measure) : 0), 0));
    return { key: g.key, grade: g.grade, cells, total: cells.reduce((a, b) => a + b, 0) };
  });
  const heatMax = Math.max(0, ...heat.flatMap((h) => h.cells));

  // Movers: grade + size, last 3 months vs the 3 before. A minimum volume keeps
  // one big order from reading as a trend: 1 ton, 20 pcs or Rp 50 jt.
  const minVol = opts.measure === 'kg' ? 1000 : opts.measure === 'pcs' ? 20 : 50e6;
  const combos: Mover[] = [];
  grades.forEach((g) => {
    const list = byGrade.get(g.key) || [];
    buckets.forEach((bk) => {
      const sub = list.filter((r) => r.bucket === bk);
      const last = sumOf(sub, opts.basis, opts.measure, (mo) => last3.has(mo));
      const prev = sumOf(sub, opts.basis, opts.measure, (mo) => prev3.has(mo));
      if (prev <= 0 || last + prev < minVol) return;
      combos.push({ grade: g.grade, bucket: bk, prev, last, change: last / prev - 1 });
    });
  });
  const up = combos.filter((c) => c.change > TREND_THRESHOLD).sort((a, b) => b.change - a.change).slice(0, 8);
  const down = combos.filter((c) => c.change < -TREND_THRESHOLD).sort((a, b) => a.change - b.change).slice(0, 8);

  // Line 05: by job name and satuan.
  const fabMap = new Map<string, { label: string; satuan: string; ids: Set<string>; off: number; po: number }>();
  all.filter((r) => r.fab).forEach((r) => {
    const k = `${r.label.toUpperCase()}|${r.satuan}`;
    const e = fabMap.get(k) || { label: r.label || '(tanpa nama)', satuan: r.satuan, ids: new Set<string>(), off: 0, po: 0 };
    if (inPeriod.has(r.offMonth)) {
      e.off += r.offQty;
      e.ids.add(r.prospectId);
    }
    if (inPeriod.has(r.poMonth)) e.po += r.poQty;
    fabMap.set(k, e);
  });
  const fab = Array.from(fabMap.values())
    .filter((e) => e.off > 0 || e.po > 0)
    .map((e) => ({ label: e.label, satuan: e.satuan, offers: e.ids.size, off: e.off, po: e.po, conv: e.off > 0 ? e.po / e.off : null }))
    .sort((a, b) => b.off - a.off)
    .slice(0, 12);

  const inOff = steel.filter((r) => inPeriod.has(r.offMonth));
  const quality = {
    form: inOff.filter((r) => r.parse === 'form').length,
    teks: inOff.filter((r) => r.parse === 'teks').length,
    gagal: inOff.filter((r) => r.parse === 'gagal').length,
    total: inOff.length,
    examples: inOff.filter((r) => r.parse === 'gagal').slice(0, 5).map((r) => `${r.customer}: ${r.label || '-'}`),
  };

  const kRows = rows;
  const offKg = sumOf(kRows, 'off', 'kg', (mo) => inPeriod.has(mo));
  const poKg = sumOf(kRows, 'po', 'kg', (mo) => inPeriod.has(mo));
  const nilaiPo = sumOf(kRows, 'po', 'nilai', (mo) => inPeriod.has(mo));

  return {
    months,
    series12,
    group,
    buckets,
    kpi: { offKg, poKg, sentKg: sumOf(kRows, 'kirim', 'kg', (mo) => inPeriod.has(mo)), nilaiPo, rpKg: poKg > 0 ? nilaiPo / poKg : 0, conv: offKg > 0 ? poKg / offKg : null, grades: grades.length },
    grades,
    heat,
    heatMax,
    monthly: (key) => {
      const list = byGrade.get(key) || [];
      return series12.map((mo) => ({
        month: mo,
        off: list.reduce((s, r) => s + (r.offMonth === mo ? measureOf(r, 'off', opts.measure) : 0), 0),
        po: list.reduce((s, r) => s + (r.poMonth === mo ? measureOf(r, 'po', opts.measure) : 0), 0),
      }));
    },
    up,
    down,
    fab,
    quality,
    groupTotals,
  };
}
