import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { docVisibleTo } from '@/lib/auth';
import { bmUserIds, notify, purchasingUserIds, requesterUserIds, seUserIds } from '@/lib/notify';
import { groupOfCustomer } from '@/lib/kam-server';
import type { SafeUser } from '@/lib/types';
import { guard } from '@/lib/permissions-server';

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
/** PIC Line 05 only reads/writes the discussion of RFQ / FUP A with a Line 05 item. */
async function chatVisible(user: SafeUser, entity: string, entityId: string): Promise<boolean> {
  // Kelola Role: diskusi ikut hak Lihat modul dokumennya (prospek → Prospek & Pipeline,
  // RFQ / FUP A → RFQ / FUP A). Penanggung jawab masalah pada prospek tetap boleh ikut berdiskusi.
  if (await guard(user, entity === 'prospect' ? 'prospek' : 'rfq', 'v')) {
    if (entity !== 'prospect') return false;
    const pj = await prisma.prospectIssue.findFirst({ where: { prospectId: entityId, pjIds: { array_contains: [user.id] } }, select: { id: true } });
    return !!pj;
  }
  if (user.role !== 'purchasing05') return true;
  if (entity === 'rfq') return docVisibleTo(user, { rfqId: entityId });
  if (entity === 'fupa') return docVisibleTo(user, { fupaId: entityId });
  if (entity === 'prospect') {
    const pj = await prisma.prospectIssue.findFirst({ where: { prospectId: entityId, pjIds: { array_contains: [user.id] } }, select: { id: true } });
    return !!pj;
  }
  return false;
}

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

  if (!(await chatVisible(user, entity, entityId))) return NextResponse.json({ messages: [] });
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
  if (!(await chatVisible(user, entity, entityId))) return NextResponse.json({ error: 'Dokumen tidak ditemukan' }, { status: 404 });

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

  // RFQ/FUP A: semua staf Purchasing + pengaju dokumen, dikurangi siapapun
  // yang justru sedang mengirim pesan ini.
  if (entity === 'rfq' || entity === 'fupa') {
    const parent =
      entity === 'rfq'
        ? await prisma.rfq.findUnique({ where: { id: entityId } })
        : await prisma.fupa.findUnique({ where: { id: entityId } });
    if (parent) {
      const noDoc = (entity === 'rfq' ? (parent as { noRfq: string | null }).noRfq : (parent as { noFupa: string | null }).noFupa) || '(tanpa nomor)';
      const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
      const recipients = new Set([...(await purchasingUserIds(parent.items)), ...(await requesterUserIds(parent.requestedBy))]);
      recipients.delete(user.id);
      await notify({
        userIds: Array.from(recipients),
        type: entity === 'rfq' ? 'rfq_chat' : 'fupa_chat',
        entity,
        entityId,
        title: `Pesan baru di ${entity === 'rfq' ? 'RFQ' : 'FUP A'} ${noDoc}`,
        message: `${user.name}: ${preview}`,
      });
    }
  }

  // Diskusi di kartu prospek: Sales pemilik, BM cabangnya, ketua grup Key
  // Account customer tsb, dan siapa saja yang sudah ikut berdiskusi —
  // dikurangi pengirim.
  if (entity === 'prospect') {
    const p = await prisma.prospect.findUnique({ where: { id: entityId }, select: { se: true, cabang: true, customer: true } });
    if (p) {
      const recipients = new Set<string>([...(await seUserIds(p.se)), ...(await bmUserIds(p.cabang))]);
      const g = await groupOfCustomer(p.customer);
      if (g?.ketuaId) recipients.add(g.ketuaId);
      // Penanggung jawab masalah aktif (mis. Purchasing) ikut menerima diskusi kartu.
      const issue = await prisma.prospectIssue.findFirst({ where: { prospectId: entityId, status: { in: ['open', 'proses'] } }, select: { pjIds: true } });
      (Array.isArray(issue?.pjIds) ? (issue!.pjIds as string[]) : []).forEach((id) => recipients.add(id));
      const prior = await prisma.itemMessage.findMany({ where: { entity, entityId }, select: { authorUsername: true }, distinct: ['authorUsername'] });
      const names = prior.map((m) => m.authorUsername).filter((u): u is string => !!u && u !== user.username);
      if (names.length) (await prisma.user.findMany({ where: { username: { in: names } }, select: { id: true } })).forEach((u) => recipients.add(u.id));
      recipients.delete(user.id);
      const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
      await notify({
        userIds: Array.from(recipients),
        type: 'prospect_chat',
        entity: 'prospect',
        entityId,
        title: `Diskusi prospek ${p.customer}${p.se ? ` (${p.se})` : ''}`,
        message: `${user.name}: ${preview}`,
      });
    }
  }

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
