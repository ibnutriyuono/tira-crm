import { ACTIVITY_TYPES } from './constants';

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

/**
 * The identity an account's activities are recorded under, or null when the
 * account may not log any. A sales account uses its Kode SE. A branch manager
 * (BM) also handles customers of their own: they use their Kode SE if they
 * have one, otherwise "BM-<CABANG>" so their activity shows as its own row in
 * the KPI instead of inflating a salesperson's numbers. Other roles read only.
 * Pure (no server imports) so the modal and the API share one definition.
 */
export function activityOwner(user: { role: string; se: string | null; cabang: string | null }): string | null {
  const se = (user.se || '').trim().toUpperCase();
  if (user.role === 'sales') return se || null;
  if (user.role === 'bm') {
    const cabang = (user.cabang || '').trim().toUpperCase();
    return se || (cabang ? `BM-${cabang}` : null);
  }
  return null;
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
export function normalizeActivityPics(raw: unknown): { pics: { nama: string; jabatan: string }[] } | { error: string } {
  const list = Array.isArray(raw) ? raw : [];
  const pics: { nama: string; jabatan: string }[] = [];
  for (const r of list) {
    const nama = String((r as { nama?: unknown })?.nama ?? '').trim().slice(0, 100);
    const jabatan = String((r as { jabatan?: unknown })?.jabatan ?? '').trim().slice(0, 100);
    if (!nama && !jabatan) continue;
    if (!nama || !jabatan) return { error: 'Setiap PIC wajib diisi nama dan jabatannya.' };
    pics.push({ nama, jabatan });
  }
  if (pics.length === 0) return { error: 'Isi minimal satu PIC beserta jabatannya.' };
  if (pics.length > 20) return { error: 'Maksimal 20 PIC per aktivitas.' };
  return { pics };
}

/** "Nama (Jabatan), Nama (Jabatan)" -- for notes and exports. */
export function formatActivityPics(pics: { nama: string; jabatan: string }[] | null | undefined): string {
  return (Array.isArray(pics) ? pics : []).map((p) => `${p.nama} (${p.jabatan})`).join(', ');
}
