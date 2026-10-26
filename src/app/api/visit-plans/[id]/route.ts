import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { notify } from '@/lib/notify';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { weekLabel, type VisitPlanItem } from '@/lib/visit-task';
import { canReviewPlan } from '@/lib/visit-task-server';
import { jakartaToday } from '@/lib/followup-notify';

/**
 * BM cabang (atau GM) memeriksa rencana mingguan Sales.
 *   PATCH { action: 'setuju' | 'tolak', note? }  — tolak: catatan wajib.
 * Disetujui → tiap kunjungan menjadi Tugas Kunjungan (asal "rencana") untuk Sales itu.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const plan = await prisma.visitPlan.findUnique({ where: { id } });
  if (!plan) return NextResponse.json({ error: 'Rencana tidak ditemukan' }, { status: 404 });
  if (!canReviewPlan(user, plan)) return NextResponse.json({ error: 'Rencana diperiksa BM cabangnya.' }, { status: 403 });
  if (plan.status !== 'diajukan') return NextResponse.json({ error: 'Rencana ini tidak sedang menunggu persetujuan.' }, { status: 409 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const note = String(b.note || '').trim().slice(0, 500);
  if (b.action === 'tolak') {
    if (note.length < 5) return NextResponse.json({ error: 'Tulis catatan untuk Sales.' }, { status: 400 });
    const u = await prisma.visitPlan.update({ where: { id }, data: { status: 'ditolak', reviewedById: user.id, reviewedByName: user.name, reviewedAt: new Date(), reviewNote: note } });
    emitCrmEvent('visitPlan:updated', { id });
    await notify({ userIds: [plan.userId], type: 'visit_plan', entity: 'visitPlan', entityId: id, title: `Rencana kunjungan dikembalikan`, message: `${weekLabel(plan.weekStart)} — ${user.name}: ${note}` });
    return NextResponse.json({ plan: u });
  }
  if (b.action !== 'setuju') return NextResponse.json({ error: 'Aksi tidak dikenal' }, { status: 400 });
  const items = (plan.items as unknown as VisitPlanItem[]) || [];
  const today = jakartaToday();
  for (const it of items) {
    const t = await prisma.visitTask.create({
      data: {
        customer: it.customer,
        customerId: it.customerId || null,
        prospectId: it.prospectId || null,
        assigneeId: plan.userId,
        assigneeName: plan.userName,
        se: plan.se,
        cabang: plan.cabang,
        reg: plan.reg,
        assignedById: user.id,
        assignedByName: user.name,
        assignedByRole: user.role,
        tujuan: it.tujuan || 'Kunjungan rencana mingguan',
        dueDate: it.date < today ? today : it.date,
        planId: plan.id,
      },
    });
    emitCrmEvent('visitTask:updated', { id: t.id });
  }
  const u = await prisma.visitPlan.update({ where: { id }, data: { status: 'disetujui', reviewedById: user.id, reviewedByName: user.name, reviewedAt: new Date(), reviewNote: note || null } });
  emitCrmEvent('visitPlan:updated', { id });
  await notify({ userIds: [plan.userId], type: 'visit_plan', entity: 'visitPlan', entityId: id, title: `Rencana kunjungan disetujui`, message: `${weekLabel(plan.weekStart)} · ${items.length} kunjungan menjadi tugas Anda${note ? ` — ${note}` : ''}` });
  await logActivity({ user, action: 'update', entity: 'salesPlan', entityId: id, summary: `Menyetujui rencana kunjungan ${plan.userName} (${weekLabel(plan.weekStart)}, ${items.length} kunjungan)` });
  return NextResponse.json({ plan: u });
}
