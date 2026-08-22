import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';

/** Moves this user's read cursor to now. Personal state — no socket emit. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  await prisma.conversationRead.upsert({
    where: { username_conversationId: { username: user.username, conversationId: id } },
    create: { username: user.username, conversationId: id, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
