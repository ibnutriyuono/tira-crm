import { ACTIVITY_TYPES } from './constants';
import { normalizePhone } from './activity-contact';
import type { ActivityPic } from './types';

export const TIPE_KEYS: string[] = ACTIVITY_TYPES.map((t) => t.key);

/** "YYYY-MM-DD", a real calendar date, not later than tomorrow (UTC today + 1 absorbs the Jakarta offset). */
export function validTanggal(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  const limit = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  return s <= limit ? s : null;
}

/** Awalan identitas aktivitas untuk role non-lapangan (tanpa Kode SE). */
const STAFF_PREFIX: Record<string, string> = { gm: 'GM', rm: 'RM', admin: 'ADMIN', salesadmin: 'ADS', purchasing: 'PURCH', purchasing05: 'PURCH' };

/**
 * The identity an account's activities are recorded under. Every role logs
 * its own Aktivitas Harian:
 * - Sales: Kode SE ("SALES-<USERNAME>" bila belum punya Kode SE);
 * - BM: Kode SE, else "BM-<CABANG>" -- its own KPI row, not a salesperson's;
 * - GM / RM / Admin / Admin Sales / Purchasing: Kode SE bila ada, else
 *   "<ROLE>-<USERNAME>" (mis. "GM-GM", "RM-RM1", "ADS-NINA").
 * Null only when nothing identifies the account. Pure (no server imports) so
 * the modal and the API share one definition.
 */
export function activityOwner(user: { role: string; se: string | null; cabang: string | null; username?: string | null }): string | null {
  const se = (user.se || '').trim().toUpperCase();
  if (se) return se;
  const un = (user.username || '').trim().toUpperCase();
  if (user.role === 'bm') {
    const cabang = (user.cabang || '').trim().toUpperCase();
    return cabang ? `BM-${cabang}` : un ? `BM-${un}` : null;
  }
  if (!un) return null;
  return `${STAFF_PREFIX[user.role] || (user.role === 'sales' ? 'SALES' : user.role.toUpperCase())}-${un}`;
}

/**
 * Identitas aktivitas milik role non-lapangan (GM, RM, Admin, Admin Sales,
 * Purchasing). Tampil di Aktivitas Harian, tetapi tidak dihitung di KPI
 * Aktivitas Sales.
 */
export function isStaffActivityKey(se: string | null | undefined): boolean {
  const s = (se || '').trim().toUpperCase();
  return Object.values(STAFF_PREFIX).some((p) => s.startsWith(`${p}-`));
}

/**
 * Today's date in the browser's own timezone ("YYYY-MM-DD"). format.ts's
 * todayStr() uses UTC, which in Jakarta (UTC+7) still reads as yesterday
 * until 07:00 -- exactly when a salesperson logs the morning's first visit.
 */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Validates the PIC list of an activity: every row needs both nama and
 * jabatan, fully blank rows (an untouched "add" row) are dropped, and at
 * least one PIC must remain. Returns the cleaned list or an error message.
 */
export function normalizeActivityPics(raw: unknown): { pics: ActivityPic[] } | { error: string } {
  const list = Array.isArray(raw) ? raw : [];
  const pics: ActivityPic[] = [];
  for (const r of list) {
    const o = (r || {}) as { nama?: unknown; jabatan?: unknown; phone?: unknown; email?: unknown; dihubungi?: unknown };
    const nama = String(o.nama ?? '').trim().slice(0, 100);
    const jabatan = String(o.jabatan ?? '').trim().slice(0, 100);
    const phone = normalizePhone(String(o.phone ?? '')).slice(0, 30);
    const email = String(o.email ?? '').trim().toLowerCase().slice(0, 120);
    if (!nama && !jabatan && !phone && !email) continue;
    if (!nama || !jabatan) return { error: 'Setiap PIC wajib diisi nama dan jabatannya.' };
    pics.push({ nama, jabatan, ...(phone ? { phone } : {}), ...(email ? { email } : {}), ...(o.dihubungi ? { dihubungi: true } : {}) });
  }
  if (pics.length === 0) return { error: 'Isi minimal satu PIC beserta jabatannya.' };
  if (pics.length > 20) return { error: 'Maksimal 20 PIC per aktivitas.' };
  return { pics };
}

/** "Nama (Jabatan), Nama (Jabatan)" -- for notes and exports. */
export function formatActivityPics(pics: { nama: string; jabatan: string }[] | null | undefined): string {
  return (Array.isArray(pics) ? pics : []).map((p) => `${p.nama} (${p.jabatan})`).join(', ');
}
