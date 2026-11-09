import { createHash } from 'crypto';
import { prisma } from './prisma';
import { getProspectMaterials, normalizeLine } from './format';
import { materialToRow, rowUraian, type SpecExtra, type SpecRow } from './material-spec';
import { getOpsRules } from './ops-escalation';
import { hasHpp, hppIdr, type RfqHppFields } from './rfq-price';
import { matchStock, saranHarga, stockGradeKey, unitShort, type StockRow } from './stock';
import type { Material, Prospect, RfqItem } from './types';

/**
 * Cek diskon Surat Penawaran. Harga di surat dibanding harga jual acuan:
 *  1. harga jual Purchasing dari jawaban RFQ prospek yang sama (Rupiah), atau
 *  2. bila belum ada, saran harga jual stok gudang (HPP stok ÷ (1 − margin)) —
 *     opsi stok yang sama dengan yang tampil di form prospek;
 *     diskon = (harga jual acuan − harga surat) ÷ harga jual acuan
 * Diskon di atas batas Sales (SE) perlu persetujuan bertingkat BM / GM / VP.
 * Harga jual Purchasing & diskon boleh dilihat Sales; HPP & margin hanya
 * untuk role yang boleh melihat HPP (server membuangnya untuk role lain).
 */
export interface QuoteLineIn {
  line?: string;
  uraian?: string;
  grade?: string;
  qty?: number;
  beratPc?: number;
  hargaKg?: number;
  harga?: number;
}

export interface MarginLine {
  idx: number;
  /** Ada HPP pembanding di jawaban RFQ. */
  checked: boolean;
  /** Diskon melewati batas Sales (SE). */
  below: boolean;
  /** Harga jual acuan per UOM (Rupiah) — dasar diskon. */
  ref: number | null;
  /** Asal harga acuan: jawaban RFQ Purchasing atau saran harga stok gudang. */
  refSrc?: 'rfq' | 'stok';
  /** Stok: uraian stok patokan. */
  refDesc?: string;
  /** RFQ ber-UOM KG tapi angkanya jelas per batang/pcs — sudah dibagi berat/pc. */
  perPcs?: boolean;
  /** Diskon % dari harga jual Purchasing (negatif = di atas harga jual). */
  discount: number | null;
  /** Hanya untuk role yang boleh melihat HPP. */
  margin: number | null;
  hpp: number | null;
  price: number | null;
  uom: string;
  rfqNo: string;
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const low = (s: unknown) => String(s ?? '').trim().toLowerCase();
const isKg = (uom: string) => !uom || /^kg$/i.test(uom.trim());

/** Kunci harga surat — persetujuan berlaku untuk harga yang sama atau lebih tinggi. */
export function priceKey(items: QuoteLineIn[]): string {
  const sig = items.map((it) => [normalizeLine(it.line), low(it.grade), low(it.uraian), n(it.harga), n(it.hargaKg), n(it.beratPc)].join('|')).join('\n');
  return createHash('sha1').update(sig).digest('hex').slice(0, 20);
}

/** Item RFQ paling cocok: Line & grade wajib sama; kata material / tebal menambah skor. */
function bestMatch(it: QuoteLineIn, cands: { item: RfqItem & RfqHppFields; rfqNo: string }[]) {
  const line = normalizeLine(it.line);
  const grade = low(it.grade);
  const text = low(it.uraian);
  type Cand = { item: RfqItem & RfqHppFields; rfqNo: string };
  let best: Cand | null = null;
  let bestScore = 0;
  cands.forEach((c: Cand) => {
    const cl = normalizeLine(c.item.line);
    if (line && cl && !cl.split(/\s*,\s*/).some((x) => line.split(/\s*,\s*/).includes(x))) return;
    const cg = low(c.item.grade);
    if (grade && cg && grade !== cg && !text.includes(cg)) return;
    let score = 1;
    if (grade && cg && grade === cg) score += 2;
    else if (cg && text.includes(cg)) score += 1;
    const mat = low(c.item.material);
    if (mat && text.includes(mat)) score += 1;
    const th = String(c.item.thick ?? '').trim();
    if (th && new RegExp(`(^|[^0-9.])${th.replace('.', '\\.')}([^0-9.]|$)`).test(text)) score += 1;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  });
  return bestScore >= 2 ? (best as Cand | null) : null;
}

export async function checkQuoteMargins(prospectId: string, items: QuoteLineIn[], maxDisc: number): Promise<MarginLine[]> {
  const rfqs = await prisma.rfq.findMany({ where: { prospectId, cancelledAt: null }, orderBy: { createdAt: 'desc' } });
  const cands: { item: RfqItem & RfqHppFields; rfqNo: string }[] = [];
  rfqs.forEach((r) => {
    const list = (Array.isArray(r.items) ? r.items : []) as unknown as (RfqItem & RfqHppFields)[];
    list.forEach((item) => {
      const idr = !item.currency || String(item.currency).toUpperCase() === 'IDR';
      if (!item.noQuote && idr && n(item.hargaPurchasing) > 0) cands.push({ item, rfqNo: r.noRfq || 'RFQ' });
    });
  });
  const viaStock = await stockRefs(prospectId, items);
  const price = (it: QuoteLineIn, uom: string): number | null =>
    isKg(uom) ? (n(it.hargaKg) > 0 ? n(it.hargaKg) : n(it.beratPc) > 0 && n(it.harga) > 0 ? n(it.harga) / n(it.beratPc) : null) : n(it.harga) > 0 ? n(it.harga) : null;
  return items.map((it, idx) => {
    const m = cands.length ? bestMatch(it, cands) : null;
    let uom: string;
    let ref: number;
    let hpp: number;
    let src: 'rfq' | 'stok';
    let label: string;
    let perPcs = false;
    let desc = '';
    if (m) {
      uom = String(m.item.uom || 'KG').toUpperCase();
      hpp = hasHpp(m.item) ? hppIdr(m.item) : 0;
      ref = n(m.item.hargaPurchasing);
      src = 'rfq';
      label = m.rfqNo;
      // Jawaban RFQ ber-UOM KG yang angkanya per batang/pcs (mis. HPP Rp 6,3 jt "per kg"
      // untuk round bar 118 kg): bila harga/kg surat jauh di bawahnya tetapi cocok dengan
      // harga ÷ berat/pc, harga RFQ diperlakukan per pcs dan dibagi berat/pc.
      const bpc = n(it.beratPc);
      const pk = price(it, uom);
      if (isKg(uom) && bpc > 1 && pk && ref / pk > 8) {
        const r = ref / bpc / pk;
        if (r > 0.3 && r < 3) {
          ref /= bpc;
          hpp /= bpc;
          perPcs = true;
        }
      }
    } else if (viaStock[idx]) {
      const st = viaStock[idx]!;
      uom = st.uom;
      hpp = st.hpp;
      ref = st.saran;
      src = 'stok';
      label = `Stok ${st.itemNo}`;
      desc = st.desc;
    } else return { idx, checked: false, below: false, ref: null, discount: null, margin: null, hpp: null, price: null, uom: '', rfqNo: '' };
    const p = price(it, uom);
    const extra = { refSrc: src, ...(desc ? { refDesc: desc } : {}), ...(perPcs ? { perPcs } : {}) };
    if (!p) return { idx, checked: false, below: false, ref, ...extra, discount: null, margin: null, hpp: hpp || null, price: p, uom, rfqNo: label };
    const discount = Math.round(((ref - p) / ref) * 1000) / 10;
    // Gross margin atas harga jual: (harga − HPP) ÷ harga.
    const margin = hpp > 0 ? Math.round(((p - hpp) / p) * 1000) / 10 : null;
    return { idx, checked: true, below: discount > maxDisc + 1e-9, ref, ...extra, discount, margin, hpp: hpp || null, price: p, uom, rfqNo: label };
  });
}

/**
 * Saran harga stok gudang per baris surat (untuk baris tanpa jawaban RFQ):
 * baris surat dicocokkan ke material prospek (uraian sama, lalu urutan &
 * grade sama, lalu grade sama), kemudian stok yang dipilih Sales ("Pakai")
 * atau, bila belum memilih, opsi stok teratas yang punya HPP — sama persis
 * dengan "Saran harga jual minimal" di form prospek.
 */
async function stockRefs(prospectId: string, items: QuoteLineIn[]): Promise<({ saran: number; hpp: number; uom: string; itemNo: string; desc: string } | null)[]> {
  const none = items.map(() => null);
  const [prospect, count] = await Promise.all([prisma.prospect.findUnique({ where: { id: prospectId } }), prisma.stockItem.count()]);
  if (!prospect || !count) return none;
  const rows: SpecRow[] = (getProspectMaterials(prospect as unknown as Prospect) as (Material & SpecExtra)[]).map((x) => materialToRow(x));
  const keys = Array.from(new Set(rows.map((r) => stockGradeKey(r.grade).key).filter(Boolean)));
  if (!keys.length) return none;
  const [db, rules] = await Promise.all([prisma.stockItem.findMany({ where: { gradeKey: { in: keys } } }), getOpsRules()]);
  if (!db.length) return none;
  const hppById = new Map(db.map((r) => [r.id, r.hpp]));
  const stock: StockRow[] = db.map((r) => ({
    id: r.id, itemNo: r.itemNo, line: r.line, description: r.description, unit: r.unit, qty: r.qty, fsv: r.fsv, ageDays: r.ageDays,
    locations: (r.locations || {}) as Record<string, number>, grade: r.grade, gradeKey: r.gradeKey, variant: r.variant, bentuk: r.bentuk,
    dim: (r.dim || {}) as StockRow['dim'], saran: saranHarga(r.hpp, rules.stockMarginPct),
  }));
  const used = new Set<number>();
  return items.map((it, idx) => {
    const g = stockGradeKey(it.grade || '').key;
    if (!g) return null;
    const same = (r: SpecRow) => stockGradeKey(r.grade).key === g;
    let ri = rows.findIndex((r, i) => !used.has(i) && same(r) && low(rowUraian(r)) === low(it.uraian));
    if (ri < 0 && rows[idx] && !used.has(idx) && same(rows[idx])) ri = idx;
    if (ri < 0) ri = rows.findIndex((r, i) => !used.has(i) && same(r));
    if (ri < 0) return null;
    used.add(ri);
    const r = rows[ri];
    const chosen = String((r.src as { stokItemNo?: string } | undefined)?.stokItemNo || '');
    const picked = chosen ? stock.find((x) => x.itemNo === chosen && x.saran != null) : undefined;
    const best = picked || matchStock({ grade: r.grade, bentuk: r.bentuk, dim: r.dim }, stock, prospect.cabang || '', 12).find((x) => x.row.saran != null)?.row;
    if (!best) return null;
    return { saran: best.saran as number, hpp: hppById.get(best.id) || 0, uom: unitShort(best.unit).toUpperCase(), itemNo: best.itemNo, desc: best.description.replace(/\s+/g, ' ') };
  });
}
