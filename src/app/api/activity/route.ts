import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { activityScopeWhere } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';

const MAX_PAGE_SIZE = 200;

export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(sp.get('pageSize')) || 50));

  // Every filter is AND-ed onto the role scope rather than merged into it —
  // the scope itself uses OR for rm/bm, so a shallow spread would widen it.
  const and: Prisma.ActivityLogWhereInput[] = [activityScopeWhere(user)];

  const action = sp.get('action');
  if (action) and.push({ action: action as Prisma.ActivityLogWhereInput['action'] });

  const entity = sp.get('entity');
  if (entity) and.push({ entity: entity as Prisma.ActivityLogWhereInput['entity'] });

  const userId = sp.get('userId');
  if (userId) and.push({ userId });

  const q = (sp.get('q') || '').trim();
  if (q) {
    and.push({
      OR: [
        { summary: { contains: q, mode: 'insensitive' } },
        { username: { contains: q, mode: 'insensitive' } },
        { actorName: { contains: q, mode: 'insensitive' } },
      ],
    });
  }

  const from = sp.get('from');
  if (from) and.push({ createdAt: { gte: new Date(`${from}T00:00:00`) } });
  const to = sp.get('to');
  if (to) {
    // `to` is an inclusive calendar day, so compare against the start of the
    // following day rather than 23:59:59 (which would drop the last second).
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    and.push({ createdAt: { lt: end } });
  }

  const where: Prisma.ActivityLogWhereInput = { AND: and };

  const [logs, total, actorRows] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.activityLog.count({ where }),
    // Actor list for the filter dropdown is derived from the log itself, not
    // from User: non-admins can't read /api/users, and users who have since
    // been deleted still need to be selectable.
    prisma.activityLog.groupBy({
      by: ['userId', 'username', 'actorName'],
      where: activityScopeWhere(user),
      orderBy: { username: 'asc' },
    }),
  ]);

  const actors = actorRows
    .filter((a) => a.userId)
    .map((a) => ({ userId: a.userId as string, username: a.username, name: a.actorName }));

  return NextResponse.json({ logs, total, page, pageSize, actors });
}
