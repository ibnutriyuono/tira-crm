import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

const PAGE = 100;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: 'Percakapan tidak ditemukan' }, { status: 404 });
  if (!conversation.members.includes(user.username)) {
    return NextResponse.json({ error: 'Anda bukan anggota percakapan ini.' }, { status: 403 });
  }

  // Newest PAGE rows, returned oldest-first so the UI can append downwards.
  const rows = await prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'desc' }, take: PAGE });
  return NextResponse.json({ messages: rows.reverse() });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: 'Percakapan tidak ditemukan' }, { status: 404 });
  if (!conversation.members.includes(user.username)) {
    return NextResponse.json({ error: 'Anda bukan anggota percakapan ini.' }, { status: 403 });
  }
  // A broadcast is one-way: only its creator may post.
  if (conversation.type === 'broadcast' && conversation.createdBy !== user.username) {
    return NextResponse.json({ error: 'Hanya pembuat broadcast yang dapat mengirim pesan.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const text = String(body?.text || '').trim();
  if (!text) return NextResponse.json({ error: 'Pesan tidak boleh kosong' }, { status: 400 });

  const message = await prisma.message.create({
    data: { conversationId: id, author: user.name, authorUsername: user.username, role: user.role, text },
  });
  // Bump the thread so the conversation list re-sorts for everyone.
  await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date() } });

  emitCrmEvent('chat:message', { ...message, members: conversation.members });
  return NextResponse.json({ message }, { status: 201 });
}
