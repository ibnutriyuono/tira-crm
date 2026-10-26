import { canSeeHpp } from './roles';
import type { RfqItem } from './types';

/**
 * HPP & margin di jawaban RFQ.
 *
 * Purchasing mengisi per item: harga vendor (HPP) dalam mata uang vendor,
 * kurs ke Rupiah bila bukan IDR, dan margin % (markup dari HPP):
 *     harga jual = HPP × kurs × (1 + margin%)
 * Harga jual disimpan di `hargaPurchasing` (IDR) — itu yang diterima Sales,
 * Admin Sales dan BM. HPP, kurs, margin dan vendor hanya untuk RM, GM, Admin,
 * Purchasing dan PIC Line 05: server membuangnya untuk role lain (bootstrap,
 * API, socket, export). Jawaban lama (tanpa HPP) tampil seperti sebelumnya.
 */

export interface RfqHppFields {
  /** Harga vendor per UOM, dalam `hppCur`. */
  hpp?: number;
  hppCur?: string;
  /** IDR per 1 `hppCur` (1 untuk IDR). */
  kurs?: number;
  /** Markup % dari HPP. */
  margin?: number;
  vendorId?: string;
  vendorNama?: string;
}

export const HPP_KEYS = ['hpp', 'hppCur', 'kurs', 'margin', 'vendorId', 'vendorNama'] as const;

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function hasHpp(it: Partial<RfqItem & RfqHppFields>): boolean {
  return n(it.hpp) > 0;
}

/** HPP dalam Rupiah. */
export function hppIdr(it: Partial<RfqItem & RfqHppFields>): number {
  const cur = (it.hppCur || 'IDR').toUpperCase();
  return n(it.hpp) * (cur === 'IDR' ? 1 : n(it.kurs));
}

/** Harga jual Rupiah dari HPP × kurs × (1 + margin%), dibulatkan ke Rupiah. */
export function sellPrice(it: Partial<RfqItem & RfqHppFields>): number {
  const base = hppIdr(it);
  if (!(base > 0)) return 0;
  return Math.round(base * (1 + n(it.margin) / 100));
}

/** Margin % aktual dari harga jual vs HPP (untuk tampilan RM/GM). */
export function actualMargin(it: Partial<RfqItem & RfqHppFields>): number | null {
  const base = hppIdr(it);
  const sell = n(it.hargaPurchasing);
  return base > 0 && sell > 0 ? ((sell - base) / base) * 100 : null;
}

/**
 * Bersihkan isian HPP dari body jawaban (server). Item ber-HPP: harga jual
 * dihitung ulang di server (mata uang IDR) supaya tidak bisa dipalsukan.
 */
export function normalizeHppItems(items: RfqItem[]): RfqItem[] {
  return items.map((raw) => {
    const it = { ...(raw as RfqItem & RfqHppFields) };
    if (!(n(it.hpp) > 0) || it.noQuote) {
      HPP_KEYS.forEach((k) => {
        if (k !== 'vendorId' && k !== 'vendorNama') delete it[k];
      });
      if (!it.vendorId) delete it.vendorNama;
      return it;
    }
    it.hpp = n(it.hpp);
    it.hppCur = String(it.hppCur || 'IDR').toUpperCase().slice(0, 5);
    it.kurs = it.hppCur === 'IDR' ? 1 : n(it.kurs);
    it.margin = Math.max(-100, Math.min(1000, n(it.margin)));
    if (it.hppCur !== 'IDR' && !(it.kurs > 0)) {
      // Tanpa kurs harga jual tidak bisa dihitung — biarkan harga yang diketik.
      return it;
    }
    it.hargaPurchasing = sellPrice(it);
    it.currency = 'IDR';
    return it;
  });
}

/** Apakah dokumen ini membawa data rahasia Purchasing (HPP / catatan internal). */
function stripItems(items: unknown): { items: unknown; hidden: boolean } {
  if (!Array.isArray(items)) return { items, hidden: false };
  let hidden = false;
  const out = items.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const it = { ...(raw as Record<string, unknown>) };
    HPP_KEYS.forEach((k) => {
      if (it[k] !== undefined) {
        hidden = true;
        delete it[k];
      }
    });
    return it;
  });
  return { items: out, hidden };
}

/**
 * Versi dokumen RFQ / FUP A yang aman untuk Sales-side: tanpa HPP, kurs,
 * margin, vendor dan catatan internal Purchasing. `hppHidden` memberi tahu
 * client ber-hak bahwa versi lengkap perlu diambil ulang (socket).
 */
export function stripPurchSecrets<T extends { items?: unknown; purchNotes?: string | null }>(doc: T): T & { hppHidden?: boolean } {
  if (!doc || typeof doc !== 'object') return doc;
  const { items, hidden } = stripItems(doc.items);
  const out = { ...doc, items } as T & { hppHidden?: boolean };
  if (out.purchNotes) {
    out.purchNotes = null;
    out.hppHidden = true;
  }
  if (hidden) out.hppHidden = true;
  return out;
}

export function docForRole<T extends { items?: unknown; purchNotes?: string | null }>(doc: T, role: string | null | undefined): T {
  return canSeeHpp(role) ? doc : stripPurchSecrets(doc);
}

/**
 * Sales mengubah RFQ lewat PUT: isian HPP selalu diambil dari data tersimpan,
 * tidak pernah dari payload Sales.
 */
export function carryHpp(prev: RfqItem | undefined, next: RfqItem): RfqItem {
  const out = { ...(next as RfqItem & RfqHppFields) };
  HPP_KEYS.forEach((k) => delete out[k]);
  if (!prev) return out;
  const p = prev as RfqItem & RfqHppFields;
  HPP_KEYS.forEach((k) => {
    if (p[k] !== undefined) (out as Record<string, unknown>)[k] = p[k];
  });
  return out;
}
