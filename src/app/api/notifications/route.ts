import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';

/** Latest 50 notifications for the caller — plenty for a dropdown/panel; older history lives in Log Aktivitas for anything that needs full audit depth. */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({ notifications });
}

/** Bulk action — currently only { markAllRead: true }. Marking a single notification read is PATCH /api/notifications/[id]. */
export async function PATCH(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  if (body?.markAllRead !== true) return NextResponse.json({ error: 'Tidak ada perubahan' }, { status: 400 });

  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
