import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

const ENTITIES = ['prospect', 'rfq', 'fupa'] as const;
type ItemEntity = (typeof ENTITIES)[number];

function parseEntity(v: string | null): ItemEntity | null {
  return ENTITIES.includes(v as ItemEntity) ? (v as ItemEntity) : null;
}

/**
 * Messages for one record's thread, plus unread counts for a whole entity type.
 * `?entity=rfq&counts=1` returns { counts: { [entityId]: n } } so a list can
 * render its unread badges in a single request instead of one per row.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const { searchParams } = new URL(req.url);
  const entity = parseEntity(searchParams.get('entity'));
  if (!entity) return NextResponse.json({ error: 'entity tidak valid' }, { status: 400 });

  if (searchParams.get('counts')) {
    const reads = await prisma.itemRead.findMany({ where: { username: user.username, entity } });
    const readMap = new Map(reads.map((r) => [r.entityId, r.lastReadAt]));
    const rows = await prisma.itemMessage.findMany({
      where: { entity, authorUsername: { not: user.username } },
      select: { entityId: true, createdAt: true },
    });
    const counts: Record<string, number> = {};
    rows.forEach((m) => {
      const seenAt = readMap.get(m.entityId);
      if (!seenAt || m.createdAt > seenAt) counts[m.entityId] = (counts[m.entityId] || 0) + 1;
    });
    // The read cursors travel with the counts so callers can also judge
    // non-message events — e.g. "has Purchasing's answer arrived since I last
    // looked at this document" — without a second round trip.
    const readCursors: Record<string, string> = {};
    readMap.forEach((at, entityId) => { readCursors[entityId] = at.toISOString(); });
    return NextResponse.json({ counts, reads: readCursors });
  }

  const entityId = searchParams.get('entityId');
  if (!entityId) return NextResponse.json({ error: 'entityId wajib diisi' }, { status: 400 });

  const messages = await prisma.itemMessage.findMany({ where: { entity, entityId }, orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const entity = parseEntity(body?.entity ?? null);
  const entityId = String(body?.entityId || '');
  const text = String(body?.text || '').trim();

  if (!entity || !entityId) return NextResponse.json({ error: 'entity / entityId tidak valid' }, { status: 400 });
  if (!text) return NextResponse.json({ error: 'Pesan tidak boleh kosong' }, { status: 400 });

  const message = await prisma.itemMessage.create({
    data: { entity, entityId, author: user.name, authorUsername: user.username, role: user.role, text },
  });
  // Posting implies having read the thread.
  await prisma.itemRead.upsert({
    where: { username_entity_entityId: { username: user.username, entity, entityId } },
    create: { username: user.username, entity, entityId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });

  emitCrmEvent('itemchat:message', message);
  return NextResponse.json({ message }, { status: 201 });
}

/** Marks this user's cursor on one thread as read. */
export async function PATCH(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const entity = parseEntity(body?.entity ?? null);
  const entityId = String(body?.entityId || '');
  if (!entity || !entityId) return NextResponse.json({ error: 'entity / entityId tidak valid' }, { status: 400 });

  await prisma.itemRead.upsert({
    where: { username_entity_entityId: { username: user.username, entity, entityId } },
    create: { username: user.username, entity, entityId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
