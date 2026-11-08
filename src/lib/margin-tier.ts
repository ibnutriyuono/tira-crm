/**
 * Persetujuan diskon Surat Penawaran bertingkat (client-safe).
 * Diskon = (harga jual Purchasing − harga surat) ÷ harga jual Purchasing.
 * Diskon item terbesar menentukan siapa yang cukup menyetujui:
 *   ≤ discSe   → tanpa persetujuan (Sales / SE)
 *   ≤ discBm   → BM cabang (RM regional juga boleh)
 *   ≤ discGm   → GM
 *   > discGm   → VP (di atas discVp ditandai melewati batas VP)
 * Penyetuju tingkat lebih tinggi selalu boleh menyetujui tingkat di bawahnya;
 * pembuat surat yang tingkatnya sudah cukup tidak perlu persetujuan.
 * Tingkat 'rm' hanya ada di pengajuan lama (sebelum aturan diskon).
 */
import type { OpsRules } from './ops-rules';

export type MarginLevel = 'bm' | 'rm' | 'gm' | 'vp';
export const MARGIN_LEVELS: MarginLevel[] = ['bm', 'rm', 'gm', 'vp'];
export const MARGIN_LEVEL_LABEL: Record<MarginLevel, string> = { bm: 'BM', rm: 'RM', gm: 'GM', vp: 'VP' };

/** Peringkat wewenang: Admin di atas semua; role lain (Sales, Admin Sales, dll.) 0. */
export function marginRank(role: string | null | undefined): number {
  return role === 'admin' ? 5 : role === 'vp' ? 4 : role === 'gm' ? 3 : role === 'rm' ? 2 : role === 'bm' ? 1 : 0;
}
export const levelRank = (l: MarginLevel) => MARGIN_LEVELS.indexOf(l) + 1;

/** Tingkat penyetuju untuk diskon terbesar (%). */
export function requiredLevel(maxDisc: number, rules: Pick<OpsRules, 'discBm' | 'discGm'>): MarginLevel {
  if (maxDisc <= rules.discBm + 1e-9) return 'bm';
  if (maxDisc <= rules.discGm + 1e-9) return 'gm';
  return 'vp';
}

export const asLevel = (v: unknown): MarginLevel => (MARGIN_LEVELS.includes(v as MarginLevel) ? (v as MarginLevel) : 'vp');
