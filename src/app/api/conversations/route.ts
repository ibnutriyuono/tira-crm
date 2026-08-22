import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

/**
 * Conversation list with unread counts. Deliberately NOT part of /api/bootstrap
 * — message history grows without bound, so threads load lazily.
 */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const conversations = await prisma.conversation.findMany({
    where: { members: { has: user.username } },
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      reads: { where: { username: user.username } },
    },
  });

  const withUnread = await Promise.all(
    conversations.map(async (c) => {
      const lastReadAt = c.reads[0]?.lastReadAt;
      const unread = await prisma.message.count({
        where: {
          conversationId: c.id,
          authorUsername: { not: user.username },
          ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        },
      });
      return {
        id: c.id,
        type: c.type,
        name: c.name,
        members: c.members,
        createdBy: c.createdBy,
        updatedAt: c.updatedAt,
        lastMessage: c.messages[0] ? { text: c.messages[0].text, author: c.messages[0].author, createdAt: c.messages[0].createdAt } : null,
        unread,
      };
    }),
  );

  return NextResponse.json({ conversations: withUnread });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const type = body?.type === 'group' ? 'group' : body?.type === 'broadcast' ? 'broadcast' : 'dm';
  const requested: string[] = Array.isArray(body?.members) ? body.members.map(String) : [];
  let members = Array.from(new Set([user.username, ...requested]));
  let name = String(body?.name || '').trim() || null;

  if (type === 'dm' && members.length !== 2) {
    return NextResponse.json({ error: 'Percakapan langsung membutuhkan tepat satu lawan bicara.' }, { status: 400 });
  }
  if (type === 'group' && !name) {
    return NextResponse.json({ error: 'Nama grup wajib diisi' }, { status: 400 });
  }

  // A broadcast targets a whole role: members are resolved server-side so the
  // channel stays correct even as people join or leave that role. `name` holds
  // the role key, which also makes the channel reusable per role.
  if (type === 'broadcast') {
    const targetRole = String(body?.targetRole || '');
    if (!targetRole) return NextResponse.json({ error: 'Role tujuan broadcast wajib dipilih' }, { status: 400 });

    const roleUsers = await prisma.user.findMany({ where: { role: targetRole as never }, select: { username: true } });
    if (roleUsers.length === 0) {
      return NextResponse.json({ error: 'Tidak ada pengguna dengan role tersebut.' }, { status: 400 });
    }
    members = Array.from(new Set([user.username, ...roleUsers.map((u) => u.username)]));
    name = targetRole;

    const existing = await prisma.conversation.findFirst({ where: { type: 'broadcast', name: targetRole } });
    if (existing) {
      // Keep the roster fresh, and make sure the sender is on it.
      const merged = Array.from(new Set([...existing.members, ...members]));
      const conversation = await prisma.conversation.update({ where: { id: existing.id }, data: { members: merged } });
      // Membership may have grown — tell every client so newly-added members
      // see the channel without reloading.
      emitCrmEvent('chat:conversation', conversation);
      return NextResponse.json({ conversation });
    }
  }

  // A DM between the same two people must never be duplicated.
  if (type === 'dm') {
    const existing = await prisma.conversation.findFirst({
      where: { type: 'dm', AND: members.map((m) => ({ members: { has: m } })) },
    });
    if (existing && existing.members.length === 2) {
      emitCrmEvent('chat:conversation', existing);
      return NextResponse.json({ conversation: existing });
    }
  }

  const conversation = await prisma.conversation.create({
    data: { type, name, members, createdBy: user.username },
  });

  emitCrmEvent('chat:conversation', conversation);
  await logActivity({ user, action: 'create', entity: 'chat', entityId: conversation.id, summary: `Memulai percakapan ${type}` });
  return NextResponse.json({ conversation }, { status: 201 });
}
