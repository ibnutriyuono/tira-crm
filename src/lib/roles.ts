/**
 * Role helpers shared by server and client.
 *
 * Admin Sales (`salesadmin`) is branch back-office: it READS everything a BM
 * reads for its one cabang, but only WRITES prospects, RFQ / FUP A, customers
 * and invoice (faktur) data — never targets, plans, activities, trips, Key
 * Account tiers or users. Exception: a Surat Penawaran it makes on behalf of a
 * Sales is logged in that Sales' Aktivitas Harian (see quote-signers.ts).
 */

/**
 * Database Vendor (nama, kontak, kategori) is Purchasing data: only
 * Purchasing, PIC Line 05, GM and Admin receive it. Sales-side roles never
 * get the list — not in bootstrap, the vendors API, live updates or exports.
 */
export function canSeeVendors(role: string | null | undefined): boolean {
  return role === 'purchasing' || role === 'purchasing05' || role === 'gm' || role === 'admin';
}

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

/**
 * Hak modul Prospek yang dibutuhkan untuk membuat Surat Penawaran: Admin
 * Sales cukup "Tambah/Ubah" (membuat penawaran adalah tugas hariannya, tidak
 * ikut hak Download / export); role lain tetap "Download".
 */
export function quotePermAct(role: string | null | undefined): 'e' | 'x' {
  return role === 'salesadmin' ? 'e' : 'x';
}

/** Surat Penawaran atas nama Sales pemilik prospek / BM cabang (Admin Sales & BM). */
export function canQuoteOnBehalf(role: string | null | undefined): boolean {
  return role === 'salesadmin' || role === 'bm';
}

/** Tab PO Indent (target kedatangan): Purchasing, PIC Line 05, GM, Admin. */
export function canSeePoIndent(role: string | null | undefined): boolean {
  return role === 'purchasing' || role === 'purchasing05' || role === 'gm' || role === 'admin';
}

/** Mengisi target kedatangan / status barang: Purchasing, PIC Line 05 (item Line 05), Admin. */
export function canEditPoIndent(role: string | null | undefined): boolean {
  return role === 'purchasing' || role === 'purchasing05' || role === 'admin';
}

/**
 * HPP (harga vendor), kurs dan margin di jawaban RFQ. Sales, Admin Sales dan
 * BM hanya menerima harga jual Rupiah — server membuang kolom HPP untuk
 * mereka (lib/rfq-price.ts).
 */
export function canSeeHpp(role: string | null | undefined): boolean {
  return role === 'rm' || role === 'gm' || role === 'admin' || role === 'purchasing' || role === 'purchasing05';
}

/** Menugaskan kunjungan ke Sales: BM (cabangnya) dan GM. */
export function canAssignVisits(role: string | null | undefined): boolean {
  return role === 'bm' || role === 'gm';
}
