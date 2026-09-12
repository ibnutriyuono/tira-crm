import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Notifikasi tidak ditemukan' }, { status: 404 });
  // Scoped by ownership, not role — a notification is inherently personal,
  // so there's no admin/purchasing override here the way other entities have.
  if (existing.userId !== user.id) return NextResponse.json({ error: 'Bukan notifikasi Anda' }, { status: 403 });

  if (existing.readAt) return NextResponse.json({ notification: existing });
  const notification = await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  return NextResponse.json({ notification });
}
