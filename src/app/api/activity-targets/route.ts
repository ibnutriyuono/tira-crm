import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canEditBudgetTarget, salesActivityScopeWhere } from '@/lib/auth';
import { ACTIVITY_TYPES } from '@/lib/constants';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const periode = new URL(req.url).searchParams.get('periode') || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(periode)) return NextResponse.json({ error: 'Periode harus YYYY-MM' }, { status: 400 });
  const targets = await prisma.activityTarget.findMany({ where: { AND: [await salesActivityScopeWhere(user), { periode }] }, orderBy: { se: 'asc' } });
  return NextResponse.json({ targets });
}

/**
 * Upsert one SE's activity targets for one month. The SE's branch is looked up
 * from their own data -- never taken from the request -- because the
 * permission check (an RM may only touch their region, a BM only their
 * branch) is made against that branch.
 */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const se = String(body?.se || '').trim().toUpperCase();
  const periode = String(body?.periode || '').trim();
  if (!se || !/^\d{4}-\d{2}$/.test(periode)) return NextResponse.json({ error: 'SE dan periode (YYYY-MM) wajib diisi' }, { status: 400 });

  const targets: Record<string, number> = {};
  for (const { key } of ACTIVITY_TYPES) {
    const raw = body?.targets?.[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 9999) return NextResponse.json({ error: `Target ${key} harus bilangan bulat 0-9999` }, { status: 400 });
    targets[key] = n;
  }

  const known =
    (await prisma.prospect.findFirst({ where: { se: { equals: se, mode: 'insensitive' }, cabang: { not: null } }, orderBy: { createdAt: 'desc' }, select: { cabang: true, reg: true } })) ??
    (await prisma.salesActivity.findFirst({ where: { se: { equals: se, mode: 'insensitive' } }, orderBy: { createdAt: 'desc' }, select: { cabang: true, reg: true } }));
  if (!known?.cabang && user.role !== 'admin' && user.role !== 'gm') {
    return NextResponse.json({ error: 'SE ini belum dikenali (belum punya prospek/aktivitas), target belum bisa ditetapkan.' }, { status: 400 });
  }
  const cabang = (known?.cabang || '').toUpperCase();
  if (!(await canEditBudgetTarget(user, cabang))) {
    return NextResponse.json({ error: 'Anda tidak berhak menetapkan target SE ini.' }, { status: 403 });
  }

  const row = await prisma.activityTarget.upsert({
    where: { se_periode: { se, periode } },
    create: { se, periode, cabang: cabang || null, reg: known?.reg ?? null, targets, updatedBy: user.name || user.username },
    update: { cabang: cabang || null, reg: known?.reg ?? null, targets, updatedBy: user.name || user.username },
  });
  await logActivity({ user, action: 'update', entity: 'activityTarget', entityId: row.id, summary: `Menetapkan target aktivitas ${se} periode ${periode}` });
  return NextResponse.json({ target: row });
}
