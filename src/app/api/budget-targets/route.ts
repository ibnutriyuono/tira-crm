import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, num, requireUser } from '@/lib/api-helpers';
import { budgetTargetScopeWhere, canEditBudgetTarget } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const budgetTargets = await prisma.budgetTarget.findMany({ where: await budgetTargetScopeWhere(user), orderBy: [{ periode: 'desc' }, { cabang: 'asc' }] });
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
  if (!(await canEditBudgetTarget(user, cabang))) {
    return NextResponse.json({ error: 'Anda tidak berhak mengubah target cabang ini.' }, { status: 403 });
  }

  // amount is likewise optional per-call now that this same endpoint also
  // saves Gross Margin from a form that has no reason to know or resend the
  // branch's existing Rupiah target — `undefined` leaves it untouched,
  // exactly like the two Gross Margin fields below. Only the CREATE path
  // needs a concrete number, since a brand new row can't leave it unset.
  const hasAmount = body?.amount !== undefined;
  const amount = hasAmount ? num(body.amount) : undefined;
  // Gross Margin fields are edited independently of amount (a different
  // section of the same settings screen) — `undefined` means "this call
  // didn't touch it", not "clear it to zero", so Prisma's update only
  // writes the fields actually present in the request body.
  const gmTarget = body?.grossMarginTarget === undefined ? undefined : body.grossMarginTarget === null ? null : num(body.grossMarginTarget);
  const gmResult = body?.grossMarginResult === undefined ? undefined : body.grossMarginResult === null ? null : num(body.grossMarginResult);

  const budgetTarget = await prisma.budgetTarget.upsert({
    where: { cabang_periode: { cabang, periode } },
    create: { cabang, periode, amount: amount ?? 0, grossMarginTarget: gmTarget ?? null, grossMarginResult: gmResult ?? null },
    update: { ...(amount !== undefined ? { amount } : {}), ...(gmTarget !== undefined ? { grossMarginTarget: gmTarget } : {}), ...(gmResult !== undefined ? { grossMarginResult: gmResult } : {}) },
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
