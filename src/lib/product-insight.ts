/**
 * Insight Produk untuk Marketing: per grade — berapa yang ditawarkan, berapa
 * yang jadi PO, kenapa kalah (faktor QCD per item, jatuh ke QCD prospek bila
 * item belum diisi), kompetitor yang menang, posisi harga, dan permintaan
 * yang hilang karena stok / waktu kirim (bahan rencana stok & produk).
 * Dihitung dari deal yang sudah ditutup (PO/DO atau Lose) pada periode.
 * Tanpa HPP / margin. Client-safe.
 */
import { flowItems } from './item-flow';
import { lostDateOf } from './lose-date';
import { bucketOf, buildTrendRows, groupOf, NO_GRADE, UNREAD } from './material-trend';
import { QCD_FAKTOR_LABEL } from './qcd';
import { num } from './format';
import type { Prospect } from './types';

export interface InsightItem {
  prospectId: string;
  customer: string;
  cabang: string;
  reg: number | null;
  month: string;
  grade: string;
  bucket: string;
  label: string;
  offKg: number;
  poKg: number;
  lostKg: number;
  outcome: 'menang' | 'sebagian' | 'kalah';
  faktor: string;
  kompetitor: string;
  costLevel: string;
}

export interface GradeInsight {
  grade: string;
  items: number;
  customers: number;
  offKg: number;
  poKg: number;
  lostKg: number;
  /** PO kg ÷ ditawarkan kg. */
  winRate: number | null;
  menang: number;
  sebagian: number;
  kalah: number;
  faktor: [string, number][];
  kompetitor: [string, number][];
  /** Item kalah dengan posisi harga "lebih mahal" / "setara" / "lebih murah". */
  harga: { mahal: number; setara: number; murah: number };
  /** Kg hilang karena stok / waktu kirim. */
  supplyLostKg: number;
}

export interface UnmetRow {
  grade: string;
  bucket: string;
  faktor: string;
  kg: number;
  items: number;
  customers: string[];
}

const ymd = (v: unknown) => String(v || '').slice(0, 10);

/** Pembaca uraian cadangan (mis. dengan kamus material) untuk baris yang grade-nya tidak terbaca. */
export type Reparse = (label: string) => { grade: string; bentuk: string; dim: Record<string, string | undefined> } | null;

export function insightItems(prospects: Prospect[], reparse?: Reparse): InsightItem[] {
  const out: InsightItem[] = [];
  prospects.forEach((p) => {
    const st = num(p.status);
    if (st !== 4 && st !== 5 && st !== 6) return;
    const close = st === 6 ? lostDateOf(p) : ymd(p.tglPO || p.tglDelivery || p.statusChangedAt);
    const rows = buildTrendRows([p]);
    const flow = flowItems(p);
    rows.forEach((r, i) => {
      if (r.fab) return;
      const f = flow[i];
      const outcome = f?.outcome || (st === 6 ? 'kalah' : 'menang');
      const offered = f?.offered ?? r.offQty;
      const offKg = offered * r.kgPc;
      const poKg = st === 6 ? 0 : (f?.po ?? offered) * r.kgPc;
      const q = f?.qcd || null;
      const lost = outcome !== 'menang';
      let grade = r.grade;
      let bucket = r.bucket;
      if (reparse && (grade === UNREAD || grade === NO_GRADE)) {
        const x = reparse(r.label);
        if (x?.grade) {
          grade = x.grade.toUpperCase();
          const g = groupOf(x.bentuk);
          bucket = bucketOf(g.cuts, Number(String(g.dim(x.dim) || '').replace(',', '.')) || 0);
        }
      }
      out.push({
        prospectId: p.id,
        customer: p.customer,
        cabang: (p.cabang || '').toUpperCase(),
        reg: p.reg ?? null,
        month: close.slice(0, 7),
        grade,
        bucket,
        label: r.label,
        offKg,
        poKg,
        lostKg: Math.max(0, offKg - poKg),
        outcome,
        faktor: lost ? q?.faktor || (st === 6 ? p.qcdFaktor || '' : '') : '',
        kompetitor: lost ? (q?.kompetitor || (st === 6 ? p.qcdKompetitor || '' : '')).trim().toUpperCase() : '',
        costLevel: lost ? q?.costLevel || (st === 6 ? p.qcdCostLevel || '' : '') : '',
      });
    });
  });
  return out;
}

const top = (m: Map<string, number>, n = 3): [string, number][] => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

export function gradeInsights(items: InsightItem[]): GradeInsight[] {
  const by = new Map<string, InsightItem[]>();
  items.forEach((it) => by.set(it.grade, [...(by.get(it.grade) || []), it]));
  return [...by.entries()]
    .map(([grade, list]) => {
      const faktor = new Map<string, number>();
      const komp = new Map<string, number>();
      const harga = { mahal: 0, setara: 0, murah: 0 };
      list.forEach((it) => {
        if (it.outcome === 'menang') return;
        if (it.faktor) faktor.set(it.faktor, (faktor.get(it.faktor) || 0) + 1);
        if (it.kompetitor) komp.set(it.kompetitor, (komp.get(it.kompetitor) || 0) + 1);
        if (it.costLevel === 'kalah') harga.mahal++;
        else if (it.costLevel === 'setara') harga.setara++;
        else if (it.costLevel === 'unggul') harga.murah++;
      });
      const offKg = list.reduce((s, it) => s + it.offKg, 0);
      const poKg = list.reduce((s, it) => s + it.poKg, 0);
      return {
        grade,
        items: list.length,
        customers: new Set(list.map((it) => it.customer.toUpperCase())).size,
        offKg,
        poKg,
        lostKg: list.reduce((s, it) => s + it.lostKg, 0),
        winRate: offKg > 0 ? poKg / offKg : null,
        menang: list.filter((it) => it.outcome === 'menang').length,
        sebagian: list.filter((it) => it.outcome === 'sebagian').length,
        kalah: list.filter((it) => it.outcome === 'kalah').length,
        faktor: top(faktor),
        kompetitor: top(komp),
        harga,
        supplyLostKg: list.filter((it) => it.faktor === 'stok' || it.faktor === 'delivery').reduce((s, it) => s + it.lostKg, 0),
      };
    })
    .sort((a, b) => b.offKg - a.offKg);
}

/** Permintaan yang hilang karena stok / waktu kirim, per grade + ukuran. */
export function unmetDemand(items: InsightItem[]): UnmetRow[] {
  const by = new Map<string, UnmetRow>();
  items
    .filter((it) => it.outcome !== 'menang' && (it.faktor === 'stok' || it.faktor === 'delivery') && it.lostKg > 0)
    .forEach((it) => {
      const k = `${it.grade}|${it.bucket}|${it.faktor}`;
      const r = by.get(k) || { grade: it.grade, bucket: it.bucket, faktor: it.faktor, kg: 0, items: 0, customers: [] };
      r.kg += it.lostKg;
      r.items++;
      if (!r.customers.includes(it.customer)) r.customers.push(it.customer);
      by.set(k, r);
    });
  return [...by.values()].sort((a, b) => b.kg - a.kg);
}

/** Temuan singkat untuk dibaca cepat. */
export function insightNotes(grades: GradeInsight[], unmet: UnmetRow[], items: InsightItem[]): string[] {
  const notes: string[] = [];
  const real = grades.filter((g) => g.grade !== NO_GRADE && g.grade !== UNREAD && g.offKg > 0);
  const big = real.slice(0, 8);
  const weak = big.filter((g) => g.winRate != null && g.winRate < 0.35 && g.kalah + g.sebagian >= 2).sort((a, b) => b.lostKg - a.lostKg)[0];
  if (weak) {
    const f = weak.faktor[0];
    notes.push(`${weak.grade}: hanya ${Math.round((weak.winRate || 0) * 100)}% tonase penawaran jadi PO${f ? ` — penyebab utama ${QCD_FAKTOR_LABEL[f[0]] || f[0]} (${f[1]} item)` : ''}${weak.kompetitor[0] ? `, paling sering kalah dari ${weak.kompetitor[0][0]}` : ''}.`);
  }
  const strong = big.filter((g) => g.winRate != null && g.winRate >= 0.6 && g.items >= 3).sort((a, b) => b.poKg - a.poKg)[0];
  if (strong) notes.push(`${strong.grade}: konversi ${Math.round((strong.winRate || 0) * 100)}% dari ${strong.customers} customer — kandidat produk unggulan untuk kampanye.`);
  const pricey = real.filter((g) => g.harga.mahal >= 2).sort((a, b) => b.harga.mahal - a.harga.mahal)[0];
  if (pricey) notes.push(`${pricey.grade}: ${pricey.harga.mahal} item kalah dengan harga kita lebih mahal — bahan evaluasi harga / sumber material.`);
  if (unmet[0]) notes.push(`Permintaan hilang karena ${QCD_FAKTOR_LABEL[unmet[0].faktor]?.toLowerCase() || unmet[0].faktor}: ${unmet[0].grade} ${unmet[0].bucket} ± ${(unmet[0].kg / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} ton dari ${unmet[0].customers.length} customer — pertimbangkan stok.`);
  const noReason = items.filter((it) => it.outcome !== 'menang' && !it.faktor).length;
  if (noReason > 3) notes.push(`${noReason} item kalah belum diisi faktor QCD — minta Sales melengkapi supaya analisa ini akurat.`);
  return notes;
}
