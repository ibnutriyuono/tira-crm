import { getProspectMaterials, num } from './format';
import { customerKey } from './reports';
import type { Material, Prospect } from './types';

/**
 * Deteksi prospek ganda / mirip.
 *
 * Dua kasus yang diperingatkan:
 *  1. Customer SAMA dan minimal satu item dengan material + qty yang sama
 *     → kemungkinan prospek yang sama diinput dua kali (oleh SE yang sama atau berbeda).
 *  2. Customer BERBEDA tetapi seluruh item (material + qty) identik, dan uraian
 *     memuat ukuran / grade (ada angka) — uraian umum tanpa ukuran diabaikan
 *     → kemungkinan permintaan yang sama masuk lewat dua pintu (mis. end user
 *       dan kontraktor/trader, atau tender yang diikuti dua cabang).
 *
 * Material dibandingkan setelah dinormalisasi (huruf kecil, tanpa spasi /
 * tanda baca / "mm", "×" = "x", koma = titik), jadi "OD 220mm x L 105mm" sama
 * dengan "od220 x l105". Hanya prospek yang masih hidup (status 1–5) dalam
 * 180 hari terakhir yang dibandingkan; Lose / Batal diabaikan.
 */

export const DUP_WINDOW_DAYS = 180;
const MIN_KEY_LEN = 6;

export function normMaterial(uraian: string | null | undefined): string {
  return (uraian || '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/,/g, '.')
    .replace(/\bmm\b|(?<=\d)mm/g, '')
    .replace(/[^a-z0-9.x]/g, '')
    .replace(/\.(?!\d)/g, '');
}

function itemKeys(mats: Pick<Material, 'uraian' | 'qty'>[]): string[] {
  return mats
    .map((m) => ({ k: normMaterial(m.uraian), q: num(m.qty) }))
    .filter((x) => x.k.length >= MIN_KEY_LEN)
    .map((x) => `${x.k}|${x.q}`);
}

export interface DupDraft {
  id?: string | null;
  customer: string;
  materials: Pick<Material, 'uraian' | 'qty'>[];
}

export type DupKind = 'identik' | 'sebagian' | 'beda-customer';

export interface DupMatch {
  prospect: Pick<Prospect, 'id' | 'customer' | 'cabang' | 'se' | 'status' | 'value' | 'tglPenawaran' | 'createdAt'>;
  sameCustomer: boolean;
  kind: DupKind;
  /** Item draft yang material + qty-nya ada di prospek ini. */
  matched: number;
  total: number;
  otherTotal: number;
  /** Uraian item yang cocok (maks. 3, untuk ditampilkan). */
  items: string[];
}

/** Satu kemiripan seperti yang boleh dilihat user ini. */
export interface DupView {
  /** null = prospek di luar wilayah user (tidak bisa dibuka). */
  id: string | null;
  /** Nama customer hanya ditampilkan bila customer-nya sama atau prospek dalam wilayah user. */
  customer: string | null;
  cabang: string | null;
  se: string | null;
  status: number;
  tgl: string | null;
  /** Nilai hanya untuk prospek dalam wilayah user. */
  value: number | null;
  sameCustomer: boolean;
  kind: DupKind;
  matched: number;
  total: number;
  otherTotal: number;
  items: string[];
  inScope: boolean;
}

type Candidate = Pick<Prospect, 'id' | 'customer' | 'cabang' | 'se' | 'status' | 'value' | 'tglPenawaran' | 'createdAt' | 'materials' | 'qty' | 'line' | 'uraian'>;

export function findDuplicates(draft: DupDraft, candidates: Candidate[], today = new Date().toISOString().slice(0, 10)): DupMatch[] {
  const keys = itemKeys(draft.materials);
  if (!keys.length) return [];
  const mine = new Set(keys);
  const cust = customerKey(draft.customer);
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - DUP_WINDOW_DAYS);
  const sinceStr = since.toISOString().slice(0, 10);
  const label = new Map(draft.materials.map((m) => [`${normMaterial(m.uraian)}|${num(m.qty)}`, (m.uraian || '').trim()]));

  const out: DupMatch[] = [];
  for (const c of candidates) {
    if (draft.id && c.id === draft.id) continue;
    const st = num(c.status);
    if (st < 1 || st > 5) continue;
    const when = String(c.tglPenawaran || c.createdAt || '').slice(0, 10);
    if (when && when < sinceStr) continue;
    const theirs = itemKeys(getProspectMaterials(c));
    if (!theirs.length) continue;
    const theirSet = new Set(theirs);
    const hit = [...mine].filter((k) => theirSet.has(k));
    if (!hit.length) continue;
    const sameCustomer = !!cust && customerKey(c.customer) === cust;
    const identical = hit.length === mine.size && mine.size === theirSet.size;
    if (!sameCustomer && !identical) continue;
    // Customer berbeda: uraian tanpa angka (mis. "Plate Creusabro" tanpa ukuran)
    // terlalu umum untuk dianggap permintaan yang sama.
    if (!sameCustomer && !hit.every((k) => /\d/.test(k.split('|')[0]))) continue;
    out.push({
      prospect: { id: c.id, customer: c.customer, cabang: c.cabang, se: c.se, status: st, value: num(c.value), tglPenawaran: c.tglPenawaran, createdAt: c.createdAt },
      sameCustomer,
      kind: !sameCustomer ? 'beda-customer' : identical ? 'identik' : 'sebagian',
      matched: hit.length,
      total: mine.size,
      otherTotal: theirSet.size,
      items: hit.slice(0, 3).map((k) => label.get(k) || k.split('|')[0]),
    });
  }
  const rank: Record<DupKind, number> = { identik: 0, sebagian: 1, 'beda-customer': 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.matched - a.matched).slice(0, 10);
}

/** Apakah customer / material berubah dibanding versi tersimpan (cek ulang hanya bila berubah). */
export function dupInputsChanged(before: Pick<Prospect, 'customer' | 'materials' | 'qty' | 'line' | 'uraian' | 'value'> | null, draft: DupDraft): boolean {
  if (!before) return true;
  if (customerKey(before.customer) !== customerKey(draft.customer)) return true;
  const a = itemKeys(getProspectMaterials(before)).sort().join(';');
  const b = itemKeys(draft.materials).sort().join(';');
  return a !== b;
}
