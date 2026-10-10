import { STATUS_META } from './constants';
import { nameParts } from './customer-names';
import { activityLabel } from './reaktivasi';
import type { CustomerIntelRow } from './reports';
import type { ActivityPic, Prospect, SalesActivity } from './types';

/**
 * Customer Intelligence <-> Aktivitas Harian. The intel rows say how a
 * customer is doing from its ORDERS; this adds how it is being looked after
 * from the CONTACTS sales recorded (kunjungan, telepon/WA, meeting, dokumen),
 * matched by name the same way Reaktivasi does (case/punctuation and where
 * "PT"/"CV" is written don't matter; PT X and CV X stay apart).
 */

export interface ContactSummary {
  /** Completed activities for this customer, newest first. */
  done: SalesActivity[];
  /** Planned ("rencana") activities from today on, soonest first. */
  plans: SalesActivity[];
  last: SalesActivity | null;
  daysSinceContact: number | null;
  count30: number;
  count90: number;
  /** SEs who recorded contact, most recent first. */
  ses: string[];
  /** PICs met/contacted, most recent first, de-duplicated by name. */
  pics: ActivityPic[];
  /** Contact status read together with order health. */
  status: string;
  statusColor: 'green' | 'amber' | 'rust' | 'slate' | 'steel';
  /** Needs a sales touch now (cold/warming and untouched, or active but neglected). */
  prioritas: boolean;
}

export type ActivityIndex = Map<string, SalesActivity[]>;

export function buildActivityIndex(activities: SalesActivity[]): ActivityIndex {
  const m: ActivityIndex = new Map();
  activities.forEach((a) => {
    const c = nameParts(a.customer).core;
    if (!c) return;
    const l = m.get(c);
    if (l) l.push(a);
    else m.set(c, [a]);
  });
  m.forEach((l) => l.sort((x, y) => y.tanggal.localeCompare(x.tanggal) || String(y.createdAt).localeCompare(String(x.createdAt))));
  return m;
}

export function activitiesFor(index: ActivityIndex, customer: string): SalesActivity[] {
  const { core, kind } = nameParts(customer);
  return (index.get(core) || []).filter((a) => {
    const k = nameParts(a.customer).kind;
    return !kind || !k || k === kind;
  });
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** Today's date (YYYY-MM-DD) in the browser's own time zone. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Active customer not contacted for this long is at risk of drifting to a competitor. */
export const AKTIF_NEGLECT_DAYS = 60;

export function summarizeContact(row: Pick<CustomerIntelRow, 'health' | 'lastOrderDate'>, acts: SalesActivity[], today: string): ContactSummary {
  const done = acts.filter((a) => a.status !== 'rencana' && a.tanggal <= today);
  const plans = acts.filter((a) => a.status === 'rencana' && a.tanggal >= today).sort((x, y) => x.tanggal.localeCompare(y.tanggal));
  const last = done[0] || null;
  const daysSinceContact = last ? daysBetween(last.tanggal, today) : null;
  const within = (n: number) => done.filter((a) => daysBetween(a.tanggal, today) <= n).length;

  const ses: string[] = [];
  done.forEach((a) => {
    const se = (a.se || '').trim();
    if (se && !ses.some((s) => s.toLowerCase() === se.toLowerCase())) ses.push(se);
  });
  const pics: ActivityPic[] = [];
  done.forEach((a) =>
    (Array.isArray(a.pics) ? a.pics : []).forEach((p) => {
      const nama = (p?.nama || '').trim();
      if (nama && !pics.some((x) => x.nama.toLowerCase() === nama.toLowerCase())) pics.push({ nama, jabatan: (p.jabatan || '').trim() });
    }),
  );

  const ago = daysSinceContact == null ? '' : daysSinceContact === 0 ? 'hari ini' : `${daysSinceContact} hari lalu`;
  const sinceOrder = !!last && (!row.lastOrderDate || last.tanggal > row.lastOrderDate.slice(0, 10));
  let status: string;
  let statusColor: ContactSummary['statusColor'];
  let prioritas = false;
  if (row.health === 'Aktif') {
    if (daysSinceContact != null && daysSinceContact <= AKTIF_NEGLECT_DAYS) {
      status = `Terjaga · dihubungi ${ago}`;
      statusColor = 'green';
    } else {
      status = last ? `Tidak dihubungi ${daysSinceContact} hari` : 'Belum pernah dihubungi';
      statusColor = 'amber';
      prioritas = true;
    }
  } else if (row.health === 'Belum Pernah Order') {
    if (daysSinceContact != null && daysSinceContact <= 30) {
      status = `Sedang digarap · ${ago}`;
      statusColor = 'steel';
    } else {
      status = last ? `Belum disentuh lagi · ${daysSinceContact} hari` : 'Belum pernah dihubungi';
      statusColor = 'slate';
    }
  } else if (sinceOrder) {
    // Menghangat / Dingin, contacted after the last order: being worked on.
    status = `Sudah dihubungi ${ago}`;
    statusColor = 'green';
  } else {
    status = 'Belum disentuh sejak order';
    statusColor = 'rust';
    prioritas = true;
  }
  if (prioritas && plans.length) prioritas = false; // already scheduled

  return { done, plans, last, daysSinceContact, count30: within(30), count90: within(90), ses, pics, status, statusColor, prioritas };
}

export interface TimelineEvent {
  tanggal: string;
  jenis: string;
  color: string;
  se: string;
  uraian: string;
  pic: string;
  nilai: number | null;
}

/** Offers/POs and contacts on one line of time, newest first. */
export function buildTimeline(records: Prospect[], acts: SalesActivity[]): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  records.forEach((r) => {
    const meta = STATUS_META[r.status];
    const se = r.se || '';
    const uraian = r.uraian || '-';
    const value = Number(r.value) || 0;
    if (r.tglPenawaran) ev.push({ tanggal: r.tglPenawaran, jenis: 'Penawaran', color: 'steel', se, uraian: `${uraian} · ${meta?.label || ''}`.trim(), pic: '', nilai: value });
    if (r.tglPO) ev.push({ tanggal: r.tglPO, jenis: 'PO', color: 'green', se, uraian, pic: '', nilai: value });
    if (!r.tglPenawaran && !r.tglPO) {
      const d = (r.createdAt || '').slice(0, 10);
      if (d) ev.push({ tanggal: d, jenis: 'Prospek', color: 'slate', se, uraian: `${uraian} · ${meta?.label || ''}`.trim(), pic: '', nilai: value });
    }
  });
  acts.forEach((a) => {
    const rencana = a.status === 'rencana';
    ev.push({
      tanggal: a.tanggal,
      jenis: `${rencana ? 'Rencana ' : ''}${activityLabel(a.tipe)}`,
      color: rencana ? 'amber' : 'violet',
      se: a.se,
      uraian: a.keterangan || '-',
      pic: (Array.isArray(a.pics) ? a.pics : []).map((p) => (p.jabatan ? `${p.nama} (${p.jabatan})` : p.nama)).join(', '),
      nilai: null,
    });
  });
  return ev.sort((x, y) => y.tanggal.localeCompare(x.tanggal));
}

export type ContactFilter = '' | 'gt30' | 'gt60' | 'gt90' | 'rencana' | 'prioritas';

export function matchContactFilter(s: ContactSummary, f: ContactFilter): boolean {
  if (!f) return true;
  if (f === 'rencana') return s.plans.length > 0;
  if (f === 'prioritas') return s.prioritas;
  const n = f === 'gt30' ? 30 : f === 'gt60' ? 60 : 90;
  return s.daysSinceContact == null || s.daysSinceContact > n;
}
