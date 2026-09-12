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
  | 'fupa_cancelled';

interface NotifyInput {
  userIds: string[];
  type: NotifType;
  entity: 'rfq' | 'fupa';
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
export async function purchasingUserIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { role: 'purchasing' }, select: { id: true } });
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
