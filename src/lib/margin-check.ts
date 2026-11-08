import { createHash } from 'crypto';
import { prisma } from './prisma';
import { normalizeLine } from './format';
import { hasHpp, hppIdr, type RfqHppFields } from './rfq-price';
import type { RfqItem } from './types';

/**
 * Cek diskon Surat Penawaran. Harga di surat dibanding harga jual Purchasing
 * (jawaban RFQ prospek yang sama, Rupiah):
 *     diskon = (harga jual Purchasing − harga surat) ÷ harga jual Purchasing
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
  /** Harga jual Purchasing per UOM (Rupiah) — dasar diskon. */
  ref: number | null;
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
  return items.map((it, idx) => {
    const m = cands.length ? bestMatch(it, cands) : null;
    if (!m) return { idx, checked: false, below: false, ref: null, discount: null, margin: null, hpp: null, price: null, uom: '', rfqNo: '' };
    const uom = String(m.item.uom || 'KG').toUpperCase();
    const hpp = hasHpp(m.item) ? hppIdr(m.item) : 0;
    const ref = n(m.item.hargaPurchasing);
    let price: number | null = null;
    if (isKg(uom)) price = n(it.hargaKg) > 0 ? n(it.hargaKg) : n(it.beratPc) > 0 && n(it.harga) > 0 ? n(it.harga) / n(it.beratPc) : null;
    else price = n(it.harga) > 0 ? n(it.harga) : null;
    if (!price) return { idx, checked: false, below: false, ref, discount: null, margin: null, hpp: hpp || null, price, uom, rfqNo: m.rfqNo };
    const discount = Math.round(((ref - price) / ref) * 1000) / 10;
    // Gross margin atas harga jual: (harga − HPP) ÷ harga.
    const margin = hpp > 0 ? Math.round(((price - hpp) / price) * 1000) / 10 : null;
    return { idx, checked: true, below: discount > maxDisc + 1e-9, ref, discount, margin, hpp: hpp || null, price, uom, rfqNo: m.rfqNo };
  });
}
