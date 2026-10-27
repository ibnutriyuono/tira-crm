import { createHash } from 'crypto';
import { prisma } from './prisma';
import { normalizeLine } from './format';
import { hasHpp, hppIdr, type RfqHppFields } from './rfq-price';
import type { RfqItem } from './types';

/**
 * Persetujuan margin VP di Surat Penawaran. Harga di surat dibanding HPP
 * (Rupiah) dari jawaban RFQ prospek yang sama; margin = harga / HPP − 1.
 * Server-only: HPP & margin tidak pernah dikirim ke Sales — Sales hanya
 * menerima tanda "di bawah batas" per item.
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
  below: boolean;
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

export async function checkQuoteMargins(prospectId: string, items: QuoteLineIn[], minMargin: number): Promise<MarginLine[]> {
  const rfqs = await prisma.rfq.findMany({ where: { prospectId, cancelledAt: null }, orderBy: { createdAt: 'desc' } });
  const cands: { item: RfqItem & RfqHppFields; rfqNo: string }[] = [];
  rfqs.forEach((r) => {
    const list = (Array.isArray(r.items) ? r.items : []) as unknown as (RfqItem & RfqHppFields)[];
    list.forEach((item) => {
      if (hasHpp(item) && !item.noQuote) cands.push({ item, rfqNo: r.noRfq || 'RFQ' });
    });
  });
  return items.map((it, idx) => {
    const m = cands.length ? bestMatch(it, cands) : null;
    if (!m) return { idx, checked: false, below: false, margin: null, hpp: null, price: null, uom: '', rfqNo: '' };
    const uom = String(m.item.uom || 'KG').toUpperCase();
    const hpp = hppIdr(m.item);
    let price: number | null = null;
    if (isKg(uom)) price = n(it.hargaKg) > 0 ? n(it.hargaKg) : n(it.beratPc) > 0 && n(it.harga) > 0 ? n(it.harga) / n(it.beratPc) : null;
    else price = n(it.harga) > 0 ? n(it.harga) : null;
    if (!price || !(hpp > 0)) return { idx, checked: false, below: false, margin: null, hpp: hpp || null, price, uom, rfqNo: m.rfqNo };
    const margin = (price / hpp - 1) * 100;
    return { idx, checked: true, below: margin < minMargin - 1e-9, margin: Math.round(margin * 10) / 10, hpp, price, uom, rfqNo: m.rfqNo };
  });
}

/** Penyetuju margin: VP & Admin; bila belum ada akun VP, GM. */
export async function marginApproverIds(): Promise<string[]> {
  for (const role of ['vp', 'gm', 'admin'] as const) {
    const rows = await prisma.user.findMany({ where: { role }, select: { id: true } });
    if (rows.length) return rows.map((r) => r.id);
  }
  return [];
}

export async function canApproveMargin(role: string): Promise<boolean> {
  if (role === 'vp' || role === 'admin') return true;
  if (role !== 'gm') return false;
  return (await prisma.user.count({ where: { role: 'vp' } })) === 0;
}
