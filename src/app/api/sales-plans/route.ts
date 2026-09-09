import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { deriveFromSalesPlanItems, isResponse, requireUser } from '@/lib/api-helpers';
import { cabangRegMap, canEditSalesPlan, salesPlanScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const periode = new URL(req.url).searchParams.get('periode');
  const where = { ...(await salesPlanScopeWhere(user)), ...(periode ? { periode } : {}) };
  const salesPlans = await prisma.salesPlan.findMany({ where, orderBy: [{ periode: 'desc' }, { se: 'asc' }] });
  return NextResponse.json({ salesPlans });
}

/**
 * Upsert one SE's plan for one month — (se, periode) is unique, so this is
 * idempotent the same way PUT /api/budget-targets is. `items` replaces the
 * whole line-item list each call; the client always sends the full set.
 */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const se = String(body?.se || '').trim();
  const periode = String(body?.periode || '').trim();
  if (!se || !/^\d{4}-\d{2}$/.test(periode)) {
    return NextResponse.json({ error: 'Sales Engineer dan periode (YYYY-MM) wajib diisi' }, { status: 400 });
  }

  const cabang = String(body?.cabang || '').trim().toUpperCase() || null;
  if (!canEditSalesPlan(user, se, cabang)) {
    return NextResponse.json({ error: 'Anda tidak berhak mengisi rencana SE ini.' }, { status: 403 });
  }

  const { items, value } = deriveFromSalesPlanItems(Array.isArray(body?.items) ? body.items : []);
  const reg = cabang ? ((await cabangRegMap())[cabang] ?? user.reg ?? null) : (user.reg ?? null);

  const salesPlan = await prisma.salesPlan.upsert({
    where: { se_periode: { se, periode } },
    create: { se, periode, cabang, reg, items: items as never, value, requestedBy: user.name || user.username },
    update: { cabang, reg, items: items as never, value, requestedBy: user.name || user.username },
  });

  emitCrmEvent('salesPlan:updated', salesPlan);
  await logActivity({
    user,
    action: 'update',
    entity: 'salesPlan',
    entityId: salesPlan.id,
    summary: `Menyimpan rencana penjualan ${se} periode ${periode} (${items.length} material, senilai Rp ${Math.round(value).toLocaleString('id-ID')})`,
  });
  return NextResponse.json({ salesPlan });
}
