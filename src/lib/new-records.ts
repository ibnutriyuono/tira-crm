/**
 * "BARU" = created today, in the user's own clock (Jakarta for this team).
 * Based on createdAt, not on the pipeline status, so the mark disappears by
 * itself the next day and works for a prospect entered straight at any stage.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local "YYYY-MM-DD" of an ISO timestamp ('' when missing/invalid). */
export function localDateOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : ymd(d);
}

/** Monday of the week containing `now`, as local "YYYY-MM-DD". */
export function weekStart(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}

export type CreatedRange = '' | 'today' | 'week';

export function isCreatedToday(r: { createdAt?: string | null }, now: Date = new Date()): boolean {
  return localDateOf(r.createdAt) === ymd(now);
}

export function createdInRange(r: { createdAt?: string | null }, range: CreatedRange, now: Date = new Date()): boolean {
  if (!range) return true;
  const d = localDateOf(r.createdAt);
  if (!d) return false;
  const today = ymd(now);
  return range === 'today' ? d === today : d >= weekStart(now) && d <= today;
}

/** "14:05" -- the time of day a record was created, for the badge tooltip. */
export function localTimeOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
