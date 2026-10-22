import { jakartaDate } from './followup-rule';

/**
 * Tanggal Lose Order (Prospect.tglLose, "YYYY-MM-DD").
 *
 * Diisi saat prospek dipindah ke Lose (status 6): bawaannya hari ini, bisa
 * diubah ke tanggal customer sebenarnya memutuskan (tidak boleh di masa depan
 * atau sebelum tanggal penawaran). Dipakai semua laporan untuk menentukan
 * bulan kekalahan; prospek lama tanpa tanggal ini memakai tanggal pindah
 * status (statusChangedAt, zona Jakarta).
 */

export const LOSE_DATE_REQUIRED_MSG = 'Tanggal Lose Order wajib diisi.';

const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Pesan galat untuk tanggal Lose yang diisi, atau null bila sah. */
export function loseDateProblem(date: unknown, tglPenawaran?: string | null, today = jakartaDate()): string | null {
  const d = String(date ?? '').trim();
  if (!isYmd(d)) return LOSE_DATE_REQUIRED_MSG;
  if (d > today) return 'Tanggal Lose Order tidak boleh di masa depan.';
  const tp = String(tglPenawaran || '').slice(0, 10);
  if (isYmd(tp) && d < tp) return 'Tanggal Lose Order tidak boleh sebelum tanggal penawaran.';
  return null;
}

/** Tanggal Lose sebuah prospek untuk laporan (tglLose, atau tanggal pindah status). */
export function lostDateOf(r: { tglLose?: string | null; statusChangedAt?: string | Date | null; updatedAt?: string | Date | null }): string {
  const t = String(r.tglLose || '').slice(0, 10);
  if (isYmd(t)) return t;
  const raw = r.statusChangedAt || r.updatedAt;
  if (!raw) return '';
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? String(raw).slice(0, 10) : jakartaDate(d);
}

/**
 * tglLose yang disimpan untuk perubahan status: masuk / tetap di Lose ->
 * tanggal yang diisi (atau yang lama, atau hari ini); keluar dari Lose -> null.
 * `undefined` = tidak diubah.
 */
export function resolveTglLose(prevStatus: number | null, nextStatus: number, given: unknown, existing: string | null | undefined): string | null | undefined {
  const g = String(given ?? '').trim();
  if (nextStatus !== 6) return prevStatus === 6 ? null : undefined;
  if (isYmd(g)) return g;
  if (prevStatus === 6 && existing) return undefined;
  return jakartaDate();
}
