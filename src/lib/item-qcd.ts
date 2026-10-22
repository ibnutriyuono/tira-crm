/**
 * QCD per item material.
 *
 * Satu prospek bisa berisi beberapa item: sebagian di-PO, sebagian tidak
 * (jatuh ke kompetitor). QCD prospek (lib/qcd.ts) tetap menjadi ringkasan
 * deal; QCD per item disimpan di baris material (`materials[i].qcd`) dan
 * dipakai dashboard Hasil QCD bila ada.
 *
 * Hasil item:
 *   menang   = seluruh qty penawaran di-PO
 *   sebagian = sebagian di-PO, sisanya tidak
 *   kalah    = tidak di-PO sama sekali, atau prospek Lose
 *
 * Bebas dependensi (dipakai sanitizer material di server & lib/format.ts).
 * Nilai level / faktor harus sama dengan QCD_LEVELS / QCD_FAKTOR di lib/qcd.ts.
 */

export const ITEM_QCD_LEVELS = ['unggul', 'setara', 'kalah'] as const;
export const ITEM_QCD_FAKTOR = ['harga', 'kualitas', 'delivery', 'stok', 'relasi', 'pembayaran', 'batal', 'lainnya'] as const;

export interface ItemQcd {
  qualityLevel?: string;
  costLevel?: string;
  deliveryLevel?: string;
  faktor?: string;
  /** Kalah / sebagian: kompetitor pemenang. Menang: kompetitor yang dikalahkan (opsional). */
  kompetitor?: string;
  catatan?: string;
}

export type ItemOutcome = 'menang' | 'sebagian' | 'kalah';

export const ITEM_OUTCOME_META: Record<ItemOutcome, { label: string; color: string }> = {
  menang: { label: 'Menang', color: 'green' },
  sebagian: { label: 'Sebagian', color: 'amber' },
  kalah: { label: 'Kalah', color: 'rust' },
};

const s = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const isLevel = (v: string) => (ITEM_QCD_LEVELS as readonly string[]).includes(v);
const isFaktor = (v: string) => (ITEM_QCD_FAKTOR as readonly string[]).includes(v);

/** Bersihkan input QCD item; null bila kosong seluruhnya. */
export function cleanItemQcd(v: unknown): ItemQcd | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const out: ItemQcd = {};
  for (const k of ['qualityLevel', 'costLevel', 'deliveryLevel'] as const) {
    const x = s(o[k], 20);
    if (isLevel(x)) out[k] = x;
  }
  const f = s(o.faktor, 20);
  if (isFaktor(f)) out.faktor = f;
  const komp = s(o.kompetitor, 120);
  if (komp) out.kompetitor = komp;
  const cat = s(o.catatan, 500);
  if (cat) out.catatan = cat;
  return Object.keys(out).length ? out : null;
}

/** Hasil item dari qty ditawarkan & PO (null = belum diputuskan). */
export function itemOutcome(offered: number, po: number | null, prospectLost: boolean): ItemOutcome | null {
  if (prospectLost) return 'kalah';
  if (po === null) return null;
  if (po <= 0) return 'kalah';
  if (po < offered) return 'sebagian';
  return 'menang';
}

/** Yang belum diisi untuk satu item; kompetitor wajib bila ada qty yang lepas. */
export function itemQcdMissing(q: ItemQcd | null | undefined, outcome: ItemOutcome): string[] {
  const miss: string[] = [];
  if (!q?.qualityLevel) miss.push('Quality');
  if (!q?.costLevel) miss.push('Cost');
  if (!q?.deliveryLevel) miss.push('Delivery');
  if (!q?.faktor) miss.push('Faktor');
  if (outcome !== 'menang' && !q?.kompetitor) miss.push('Kompetitor pemenang');
  return miss;
}
