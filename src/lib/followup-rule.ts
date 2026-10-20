/**
 * Jadwal follow-up wajib saat prospek DIPINDAH ke tahap pipeline aktif
 * (Permintaan, Penawaran Harga, Negosiasi). Dipakai di Kanban, form Edit
 * Prospek, dan API (PUT/PATCH) supaya aturan yang sama berlaku di semua jalur.
 *
 * Prospek baru tidak termasuk — aturan ini untuk pemindahan status. Tahap
 * PO/DO/Lose punya gerbangnya sendiri (No. PO & QCD).
 */
export const ACTIVE_PIPELINE_STATUSES = [1, 2, 3];

export function followUpRequiredOnMove(prevStatus: number | null | undefined, nextStatus: number): boolean {
  if (prevStatus === null || prevStatus === undefined || Number.isNaN(prevStatus)) return false;
  return prevStatus !== nextStatus && ACTIVE_PIPELINE_STATUSES.includes(nextStatus);
}

/** Hari ini menurut WIB, "YYYY-MM-DD" — sama di server & browser. */
export function jakartaDate(now = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const FOLLOWUP_REQUIRED_MSG =
  'Jadwal follow-up wajib diisi saat memindahkan prospek ke Permintaan, Penawaran Harga, atau Negosiasi.';
export const FOLLOWUP_PAST_MSG = 'Tanggal follow-up tidak boleh sebelum hari ini.';

/** null = tanggal boleh dipakai; selain itu pesan kesalahannya. */
export function followUpDateProblem(date: unknown, today = jakartaDate()): string | null {
  const d = String(date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return FOLLOWUP_REQUIRED_MSG;
  if (d < today) return FOLLOWUP_PAST_MSG;
  return null;
}
