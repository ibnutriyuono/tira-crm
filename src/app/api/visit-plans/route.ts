import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { notify } from '@/lib/notify';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { cleanPlanItems, mondayOf, weekLabel } from '@/lib/visit-task';
import { bmIdsOf, planScopeWhere } from '@/lib/visit-task-server';

/**
 * Rencana Kunjungan Mingguan.
 *   GET  ?week=YYYY-MM-DD (Senin) → rencana dalam cakupan untuk minggu itu (+ minggu sebelum/sesudah untuk Sales)
 *   POST { weekStart, items, submit? } → Sales menyimpan / mengajukan rencananya sendiri ke BM.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const sp = new URL(req.url).searchParams;
  const week = sp.get('week') ? mondayOf(String(sp.get('week'))) : null;
  const plans = await prisma.visitPlan.findMany({
    where: { AND: [planScopeWhere(user), week ? { weekStart: week } : { status: { in: ['diajukan', 'draft', 'disetujui', 'ditolak'] } }] },
    orderBy: [{ weekStart: 'desc' }, { userName: 'asc' }],
    take: 200,
  });
  return NextResponse.json({ plans });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (user.role !== 'sales') return NextResponse.json({ error: 'Rencana kunjungan disusun oleh Sales.' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.weekStart || ''))) return NextResponse.json({ error: 'Minggu tidak valid.' }, { status: 400 });
  const weekStart = mondayOf(String(b.weekStart));
  const items = cleanPlanItems(b.items, weekStart);
  const existing = await prisma.visitPlan.findUnique({ where: { userId_weekStart: { userId: user.id, weekStart } } });
  if (existing && (existing.status === 'disetujui' || existing.status === 'diajukan') && !b.reopen) {
    return NextResponse.json({ error: existing.status === 'disetujui' ? 'Rencana minggu ini sudah disetujui.' : 'Rencana sedang menunggu persetujuan BM.' }, { status: 409 });
  }
  const submit = !!b.submit;
  if (submit && !items.length) return NextResponse.json({ error: 'Isi minimal satu kunjungan sebelum mengajukan.' }, { status: 400 });
  const data = {
    items: items as unknown as Prisma.InputJsonValue,
    status: submit ? 'diajukan' : 'draft',
    submittedAt: submit ? new Date() : null,
    userName: user.name,
    se: user.se,
    cabang: user.cabang,
    reg: user.reg,
    reviewNote: existing?.status === 'ditolak' && !submit ? existing.reviewNote : null,
  };
  const plan = existing
    ? await prisma.visitPlan.update({ where: { id: existing.id }, data })
    : await prisma.visitPlan.create({ data: { ...data, userId: user.id, weekStart } });
  emitCrmEvent('visitPlan:updated', { id: plan.id });
  if (submit) {
    await notify({
      userIds: await bmIdsOf(user.cabang),
      type: 'visit_plan',
      entity: 'visitPlan',
      entityId: plan.id,
      title: `Rencana kunjungan ${user.name} menunggu persetujuan`,
      message: `${weekLabel(weekStart)} · ${items.length} kunjungan: ${items.slice(0, 4).map((i) => i.customer).join(', ')}${items.length > 4 ? '…' : ''}`,
    });
  }
  return NextResponse.json({ plan });
}
