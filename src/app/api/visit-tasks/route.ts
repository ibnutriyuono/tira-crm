import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { jakartaToday } from '@/lib/followup-notify';
import { notify } from '@/lib/notify';
import { prisma } from '@/lib/prisma';
import { canAssignVisits } from '@/lib/roles';
import { emitCrmEvent } from '@/lib/socket';
import { addDays } from '@/lib/visit-task';
import { bmIdsOf, canAssignTo, planScopeWhere, taskScopeWhere } from '@/lib/visit-task-server';

/**
 * Tugas Kunjungan.
 *   GET  ?from=YYYY-MM-DD → tugas dalam cakupan (default 90 hari terakhir + semua yang terbuka)
 *   POST { assigneeId, dueDate, tujuan, catatan?, customers: [{ customer, customerId?, prospectId?, saran? }] }
 *        BM (Sales cabangnya) / GM (semua). Satu tugas per customer.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const sp = new URL(req.url).searchParams;
  // Badge tombol Tugas Kunjungan: Sales = tugas terbuka miliknya; BM / GM = terlambat + rencana menunggu.
  if (sp.get('count')) {
    const today = jakartaToday();
    const where = taskScopeWhere(user);
    const [open, late, plans] = await Promise.all([
      prisma.visitTask.count({ where: { AND: [where, { status: 'ditugaskan' }] } }),
      prisma.visitTask.count({ where: { AND: [where, { status: 'ditugaskan', dueDate: { lt: today } }] } }),
      user.role === 'sales' ? Promise.resolve(0) : prisma.visitPlan.count({ where: { AND: [planScopeWhere(user), { status: 'diajukan' }] } }),
    ]);
    return NextResponse.json({ open, late, plans });
  }
  const from = sp.get('from') || addDays(jakartaToday(), -90);
  const tasks = await prisma.visitTask.findMany({
    where: { AND: [taskScopeWhere(user), { OR: [{ status: 'ditugaskan' }, { dueDate: { gte: from } }] }] },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json({ tasks });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canAssignVisits(user.role) && user.role !== 'admin') return NextResponse.json({ error: 'Tugas kunjungan diberikan oleh BM atau GM.' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const assignee = await prisma.user.findUnique({ where: { id: String(b.assigneeId || '') } });
  if (!assignee) return NextResponse.json({ error: 'Pilih Sales yang ditugaskan.' }, { status: 400 });
  if (!canAssignTo(user, assignee)) return NextResponse.json({ error: 'BM hanya dapat menugaskan Sales di cabangnya.' }, { status: 403 });
  const dueDate = String(b.dueDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < jakartaToday()) return NextResponse.json({ error: 'Tenggat tidak valid (tidak boleh sebelum hari ini).' }, { status: 400 });
  const tujuan = String(b.tujuan || '').trim().slice(0, 200);
  if (tujuan.length < 3) return NextResponse.json({ error: 'Isi tujuan kunjungan.' }, { status: 400 });
  const catatan = String(b.catatan || '').trim().slice(0, 500) || null;
  const list = (Array.isArray(b.customers) ? b.customers : []) as Record<string, unknown>[];
  const rows = list.map((c) => ({ customer: String(c.customer || '').trim().slice(0, 160), customerId: c.customerId ? String(c.customerId) : null, prospectId: c.prospectId ? String(c.prospectId) : null, saran: c.saran ? String(c.saran).slice(0, 20) : null })).filter((c) => c.customer);
  if (!rows.length) return NextResponse.json({ error: 'Pilih minimal satu customer.' }, { status: 400 });
  if (rows.length > 50) return NextResponse.json({ error: 'Maksimal 50 customer sekali tugaskan.' }, { status: 400 });

  const created = [];
  for (const r of rows) {
    const t = await prisma.visitTask.create({
      data: {
        ...r,
        assigneeId: assignee.id,
        assigneeName: assignee.name,
        se: assignee.se,
        cabang: assignee.cabang,
        reg: assignee.reg,
        assignedById: user.id,
        assignedByName: user.name,
        assignedByRole: user.role,
        tujuan,
        catatan,
        dueDate,
      },
    });
    emitCrmEvent('visitTask:updated', { id: t.id });
    created.push(t);
  }
  const names = rows.map((r) => r.customer);
  await notify({
    userIds: [assignee.id],
    type: 'visit_assigned',
    entity: 'visitTask',
    entityId: created[0].id,
    title: `Tugas kunjungan dari ${user.name}: ${names.length > 1 ? `${names.length} customer` : names[0]}`,
    message: `${names.slice(0, 5).join(', ')}${names.length > 5 ? ` +${names.length - 5}` : ''} · tenggat ${dueDate} · ${tujuan}${catatan ? ` — ${catatan}` : ''}`,
  });
  // GM menugaskan langsung: BM cabang ikut diberi tahu.
  if (user.role === 'gm') {
    await notify({
      userIds: await bmIdsOf(assignee.cabang),
      type: 'visit_assigned',
      entity: 'visitTask',
      entityId: created[0].id,
      title: `GM menugaskan ${assignee.name} berkunjung`,
      message: `${names.slice(0, 5).join(', ')} · tenggat ${dueDate} · ${tujuan}`,
    });
  }
  await logActivity({ user, action: 'create', entity: 'salesActivity', entityId: created[0].id, summary: `Menugaskan ${assignee.name} mengunjungi ${names.length} customer (tenggat ${dueDate})` });
  return NextResponse.json({ tasks: created }, { status: 201 });
}
