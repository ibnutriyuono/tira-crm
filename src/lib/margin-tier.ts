/**
 * Persetujuan margin Surat Penawaran bertingkat (client-safe).
 * Margin item terendah menentukan siapa yang cukup menyetujui:
 *   ≥ marginMin            → tanpa persetujuan
 *   ≥ marginBm             → BM cabang
 *   ≥ marginRm             → RM regional
 *   ≥ marginGm             → GM
 *   di bawah marginGm      → VP
 * Penyetuju tingkat lebih tinggi selalu boleh menyetujui tingkat di bawahnya;
 * pembuat surat yang tingkatnya sudah cukup tidak perlu persetujuan.
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

export function requiredLevel(lowest: number, rules: Pick<OpsRules, 'marginBm' | 'marginRm' | 'marginGm'>): MarginLevel {
  if (lowest >= rules.marginBm - 1e-9) return 'bm';
  if (lowest >= rules.marginRm - 1e-9) return 'rm';
  if (lowest >= rules.marginGm - 1e-9) return 'gm';
  return 'vp';
}

export const asLevel = (v: unknown): MarginLevel => (MARGIN_LEVELS.includes(v as MarginLevel) ? (v as MarginLevel) : 'vp');
