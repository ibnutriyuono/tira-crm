import type { Role } from '@prisma/client';
import { itemsHaveLine } from './doc-lines';
import { prisma } from './prisma';
import { emitCrmEvent } from './socket';

/**
 * One entry per notification KIND the app raises, so the client can render an
 * icon/color per type without string-matching free text. Keep this in sync
 * with NOTIF_META in the Notifikasi tab component.
 */
export type NotifType =
  | 'rfq_new'
  | 'fupa_new'
  | 'rfq_answered'
  | 'fupa_answered'
  | 'rfq_done'
  | 'fupa_done'
  | 'rfq_chat'
  | 'fupa_chat'
  | 'rfq_cancelled'
  | 'fupa_cancelled'
  | 'trip_submitted'
  | 'trip_approved'
  | 'trip_rejected'
  | 'trip_scheduled'
  | 'trip_cancelled';

interface NotifyInput {
  userIds: string[];
  type: NotifType;
  entity: 'rfq' | 'fupa' | 'visitTrip';
  entityId: string;
  title: string;
  message: string;
}

/**
 * Writes one Notification row per recipient (deduplicated) and emits each
 * over the socket. Silently no-ops on an empty recipient list — every call
 * site resolves recipients dynamically (role lookup, name match), so "no one
 * to notify" is an expected outcome, not an error.
 */
export async function notify({ userIds, type, entity, entityId, title, message }: NotifyInput): Promise<void> {
  const uniq = Array.from(new Set(userIds.filter(Boolean)));
  if (uniq.length === 0) return;
  const rows = await Promise.all(
    uniq.map((userId) => prisma.notification.create({ data: { userId, type, entity, entityId, title, message } })),
  );
  rows.forEach((n) => emitCrmEvent('notification:new', n));
}

/**
 * All Purchasing staff — the standing audience for "a new document arrived"
 * and "a discussion message was posted", mirroring the role scoping already
 * used for the toast/badge notifications (Bagian 16/17): admin/gm see every
 * document company-wide already, so paging them here would be noise for a
 * module they check rather than live in.
 */
export async function purchasingUserIds(items?: unknown): Promise<string[]> {
  // PIC Line 05 only hears about documents that contain a Line 05 item.
  const roles: Role[] = itemsHaveLine(items) ? ['purchasing', 'purchasing05'] : ['purchasing'];
  const rows = await prisma.user.findMany({ where: { role: { in: roles } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Resolves the user(s) who filed a document, by matching `requestedBy`
 * (free text, not a foreign key — see the field's own comment in
 * schema.prisma) against every user's display name. Matches on name AND
 * username, same as docScopeWhere's sales-ownership check, so a user typed
 * in by either form still resolves. Returns every match rather than the
 * first: two users sharing a display name should both be notified rather
 * than risk silently missing the real one.
 */
export async function requesterUserIds(requestedBy: string | null): Promise<string[]> {
  const name = (requestedBy || '').trim();
  if (!name) return [];
  const rows = await prisma.user.findMany({
    where: { OR: [{ name: { equals: name, mode: 'insensitive' } }, { username: { equals: name, mode: 'insensitive' } }] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Who is notified when a trip is submitted: for a BM's trip the RM(s) of the
 * BM's region AND the GM(s) -- either may approve (canApproveTrip), and the
 * GM wants sight of every BM trip. For an RM's trip, the GM(s).
 */
export async function tripApproverIds(ownerRole: string, ownerReg: number | null): Promise<string[]> {
  const or: Record<string, unknown>[] = [];
  if (ownerRole === 'bm') {
    or.push({ role: 'gm' });
    if (ownerReg != null) or.push({ role: 'rm', reg: ownerReg });
  } else if (ownerRole === 'rm') {
    or.push({ role: 'gm' });
  } else {
    return [];
  }
  const rows = await prisma.user.findMany({ where: { OR: or }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Who should know a manager is coming to a branch: the BM(s) of the
 * destination branch and the RM(s) of its region. The traveller is excluded
 * by the caller.
 */
export async function tripHostIds(cabang: string, reg: number | null): Promise<string[]> {
  const or: Record<string, unknown>[] = [{ role: 'bm', cabang: { equals: cabang, mode: 'insensitive' } }];
  if (reg != null) or.push({ role: 'rm', reg });
  const rows = await prisma.user.findMany({ where: { OR: or }, select: { id: true } });
  return rows.map((r) => r.id);
}
