import { ACTIVITY_TYPES } from './constants';
import { nameParts } from './customer-names';
import type { SalesActivity } from './types';

/**
 * Reaktivasi <-> Aktivitas Harian: a cold customer counts as contacted when a
 * completed activity (kunjungan, telepon/WA, meeting, dokumen -- by anyone)
 * was recorded for it AFTER its last order. Customer names are matched
 * ignoring case, punctuation and where "PT"/"CV" is written.
 */

const coreKey = (name: string) => nameParts(name).core;

export interface ContactIndex {
  byCore: Map<string, SalesActivity[]>;
}

export function buildContactIndex(activities: SalesActivity[]): ContactIndex {
  const byCore = new Map<string, SalesActivity[]>();
  activities
    .filter((a) => a.status !== 'rencana')
    .forEach((a) => {
      const c = coreKey(a.customer);
      if (c) byCore.set(c, [...(byCore.get(c) || []), a]);
    });
  const sort = (m: Map<string, SalesActivity[]>) =>
    m.forEach((l) => l.sort((x, y) => y.tanggal.localeCompare(x.tanggal) || String(y.createdAt).localeCompare(String(x.createdAt))));
  sort(byCore);
  return { byCore };
}

/** Latest completed activity for this customer dated after `lastOrderDate` (YYYY-MM-DD), or null. */
export function lastContactAfter(index: ContactIndex, customer: string, lastOrderDate: string | null | undefined): SalesActivity | null {
  // Same company core; legal forms must not conflict (PT X != CV X), but a
  // name written without PT/CV matches either way.
  const kind = nameParts(customer).kind;
  const list = (index.byCore.get(coreKey(customer)) || []).filter((a) => {
    const k = nameParts(a.customer).kind;
    return !kind || !k || k === kind;
  });
  const after = (lastOrderDate || '').slice(0, 10);
  return list.find((a) => !after || a.tanggal > after) || null;
}

const LABEL: Record<string, string> = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.key, t.label]));
export const activityLabel = (tipe: string) => LABEL[tipe] || tipe;
