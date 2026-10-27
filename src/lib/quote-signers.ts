import { prisma } from './prisma';
import { canQuoteOnBehalf } from './roles';
import type { SafeUser } from './types';

/**
 * Penanda tangan Surat Penawaran.
 *
 * Admin Sales (dan BM) membuat surat penawaran untuk prospek di cabangnya
 * ATAS NAMA Sales pemilik prospek atau BM cabang: nama, jabatan, email dan
 * gambar tanda tangan orang tersebut dipakai di surat, dan surat dicatat di
 * Aktivitas Harian Sales itu. Role lain hanya bisa menandatangani sendiri.
 */

export const QUOTE_JABATAN: Record<string, string> = {
  sales: 'Sales Engineer',
  bm: 'Branch Manager',
  rm: 'Regional Manager',
  gm: 'General Manager',
  vp: 'Vice President',
  salesadmin: 'Admin Sales',
};

export { canQuoteOnBehalf };

export interface QuoteSigner {
  id: string;
  name: string;
  role: string;
  se: string | null;
  cabang: string | null;
  username: string;
  email: string | null;
  jabatan: string;
  hasSignature: boolean;
  self: boolean;
  /** 'self' | 'sales' (pemilik prospek) | 'bm' (BM cabang) */
  kind: 'self' | 'sales' | 'bm';
}

const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();

/**
 * Penanda tangan yang boleh dipilih `user` untuk satu prospek (prospek sudah
 * dicek berada dalam cakupan user). Urutan: Sales pemilik → BM cabang → saya.
 */
export async function quoteSignersFor(user: SafeUser, prospect: { se: string | null; cabang: string | null }): Promise<QuoteSigner[]> {
  const select = { id: true, name: true, role: true, se: true, cabang: true, username: true, email: true, signatureAt: true } as const;
  const me = await prisma.user.findUnique({ where: { id: user.id }, select });
  const out: QuoteSigner[] = [];
  const push = (u: NonNullable<typeof me>, kind: QuoteSigner['kind']) => {
    if (out.some((x) => x.id === u.id)) return;
    out.push({
      id: u.id,
      name: u.name,
      role: u.role,
      se: u.se,
      cabang: u.cabang,
      username: u.username,
      email: u.email,
      jabatan: QUOTE_JABATAN[u.role] || '',
      hasSignature: !!u.signatureAt,
      self: u.id === user.id,
      kind,
    });
  };

  if (canQuoteOnBehalf(user.role) && user.cabang && up(prospect.cabang) === up(user.cabang)) {
    if (prospect.se) {
      const sales = await prisma.user.findMany({ where: { role: 'sales', se: { equals: prospect.se.trim(), mode: 'insensitive' } }, select, orderBy: { name: 'asc' } });
      sales.forEach((s) => push(s, 'sales'));
    }
    const bms = await prisma.user.findMany({ where: { role: 'bm', cabang: { equals: user.cabang.trim(), mode: 'insensitive' } }, select, orderBy: { name: 'asc' } });
    bms.forEach((b) => push(b, 'bm'));
  }
  if (me) push(me, 'self');
  return out;
}

/** Penanda tangan bawaan: Admin Sales → Sales pemilik prospek; selain itu diri sendiri. */
export function defaultQuoteSigner(user: SafeUser, signers: QuoteSigner[]): QuoteSigner | null {
  if (user.role === 'salesadmin') return signers.find((s) => s.kind === 'sales') || signers.find((s) => s.kind === 'bm') || signers.find((s) => s.self) || null;
  return signers.find((s) => s.self) || signers[0] || null;
}
