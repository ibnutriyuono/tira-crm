/**
 * Role helpers shared by server and client.
 *
 * Admin Sales (`salesadmin`) is branch back-office: it READS everything a BM
 * reads for its one cabang, but only WRITES prospects, RFQ / FUP A, customers
 * and invoice (faktur) data — never targets, plans, activities, trips, Key
 * Account tiers or users. Exception: a Surat Penawaran it makes on behalf of a
 * Sales is logged in that Sales' Aktivitas Harian (see quote-signers.ts).
 */

/** Roles whose read scope is exactly one cabang (user.cabang). */
export function isBranchRole(role: string | null | undefined): boolean {
  return role === 'bm' || role === 'salesadmin';
}

/** Who may mark a DO terfaktur and fill Tanggal / No Faktur. */
export function canSetFaktur(role: string | null | undefined): boolean {
  return role === 'salesadmin' || role === 'bm' || role === 'rm' || role === 'gm' || role === 'admin';
}

/** Antrian Kerja Admin: Admin Sales (and BM / managers to look over it). */
export function canSeeAdminQueue(role: string | null | undefined): boolean {
  return role === 'salesadmin' || role === 'bm' || role === 'rm' || role === 'gm' || role === 'admin';
}

/** Surat Penawaran atas nama Sales pemilik prospek / BM cabang (Admin Sales & BM). */
export function canQuoteOnBehalf(role: string | null | undefined): boolean {
  return role === 'salesadmin' || role === 'bm';
}
