import type { SeTarget } from './types';

/**
 * Target per Sales: target cabang (top-down dari pusat) dibagi BM ke tiap SE.
 * Pembagian dianggap lengkap bila jumlahnya sama dengan target cabang
 * (toleransi 0,5%) dan setiap SE aktif di cabang punya target.
 */

export type AllocStatus = 'noTarget' | 'empty' | 'short' | 'done' | 'over';

export const ALLOC_META: Record<AllocStatus, { label: string; badge: string }> = {
  noTarget: { label: 'Target cabang belum ada', badge: 'slate' },
  empty: { label: 'Belum dibagi', badge: 'rust' },
  short: { label: 'Kurang', badge: 'amber' },
  done: { label: 'Lengkap', badge: 'green' },
  over: { label: 'Lebih (stretch)', badge: 'steel' },
};

export function allocStatus(cabangTarget: number, allocated: number, missingSe = 0): AllocStatus {
  if (!(cabangTarget > 0)) return 'noTarget';
  if (!(allocated > 0)) return 'empty';
  const tol = cabangTarget * 0.005;
  if (allocated < cabangTarget - tol) return 'short';
  if (allocated > cabangTarget + tol) return 'over';
  return missingSe > 0 ? 'short' : 'done';
}

/** Bagi rata ke n SE (dibulatkan ke ribuan rupiah; sisa ke SE pertama) supaya jumlahnya pas. */
export function splitEven(total: number, n: number): number[] {
  if (n <= 0 || !(total > 0)) return Array(Math.max(0, n)).fill(0);
  const each = Math.floor(total / n / 1000) * 1000;
  const out = Array(n).fill(each);
  out[0] = Math.round(total - each * (n - 1));
  return out;
}

/** periode berikutnya s.d. Desember tahun yang sama. */
export function restOfYear(periode: string): string[] {
  const [y, m] = periode.split('-').map(Number);
  const out: string[] = [];
  for (let k = m + 1; k <= 12; k++) out.push(`${y}-${String(k).padStart(2, '0')}`);
  return out;
}

export const seKey = (s: string | null | undefined) => (s || '').trim().toUpperCase();

/**
 * Kunci target seorang user: Kode SE bila ada, selain itu username (huruf
 * besar) — supaya user non-Sales (Marketing, BM, dll.) juga bisa diberi target.
 */
export const userTargetKey = (u: { se?: string | null; username: string }) => seKey(u.se) || seKey(u.username).slice(0, 40);

/** Target SE pada periode (0 bila belum ada). */
export function seTargetOf(list: SeTarget[], se: string, periode: string): number {
  const k = seKey(se);
  return list.find((t) => seKey(t.se) === k && t.periode === periode)?.amount || 0;
}
