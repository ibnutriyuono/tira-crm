import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, num, requireUser } from '@/lib/api-helpers';
import { canEditBudgetTarget } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const budgetTargets = await prisma.budgetTarget.findMany({ orderBy: [{ periode: 'desc' }, { cabang: 'asc' }] });
  return NextResponse.json({ budgetTargets });
}

/** Upsert one branch/period target — the unique pair makes this idempotent. */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const cabang = String(body?.cabang || '').trim().toUpperCase();
  const periode = String(body?.periode || '').trim();
  if (!cabang || !/^\d{4}-\d{2}$/.test(periode)) {
    return NextResponse.json({ error: 'Cabang dan periode (YYYY-MM) wajib diisi' }, { status: 400 });
  }
  if (!canEditBudgetTarget(user, cabang)) {
    return NextResponse.json({ error: 'Anda tidak berhak mengubah target cabang ini.' }, { status: 403 });
  }

  const amount = num(body?.amount);
  const budgetTarget = await prisma.budgetTarget.upsert({
    where: { cabang_periode: { cabang, periode } },
    create: { cabang, periode, amount },
    update: { amount },
  });

  emitCrmEvent('budget:updated', budgetTarget);
  await logActivity({
    user,
    action: 'update',
    entity: 'budget',
    entityId: budgetTarget.id,
    summary: `Menetapkan target ${cabang} periode ${periode}`,
  });
  return NextResponse.json({ budgetTarget });
}
