import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { customerScopeWhere, prospectScopeWhere } from '@/lib/auth';
import { logFollowUpDone } from '@/lib/followup-activity';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

/**
 * A follow-up was just done (the "Buka WhatsApp" button): record it in
 * Aktivitas Harian and, if the prospect's schedule was due, mark it done.
 * Body: { prospectId } or { customerId }, optional { channel, activityId }
 * (activityId = the "rencana" row being completed from Aktivitas Harian).
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const body = await req.json().catch(() => null);
  const channel = String(body?.channel || 'WhatsApp').slice(0, 30);

  if (body?.prospectId) {
    const prospect = await prisma.prospect.findFirst({ where: { AND: [{ id: String(body.prospectId) }, await prospectScopeWhere(user)] } });
    if (!prospect) return NextResponse.json({ error: 'Prospek tidak ditemukan' }, { status: 404 });
    const res = await logFollowUpDone(user, { prospect }, channel, body?.activityId ? String(body.activityId) : undefined);
    const fresh = res.scheduleCleared ? await prisma.prospect.findUnique({ where: { id: prospect.id } }) : prospect;
    if (res.scheduleCleared && fresh) emitCrmEvent('prospect:updated', fresh);
    await logActivity({ user, action: 'update', entity: 'prospect', entityId: prospect.id, summary: `Follow-up via ${channel} ke "${prospect.customer}"${res.logged ? ' (tercatat di Aktivitas Harian)' : ''}` });
    return NextResponse.json({ ...res, prospect: fresh });
  }
  if (body?.customerId) {
    const customer = await prisma.customer.findFirst({ where: { AND: [{ id: String(body.customerId) }, await customerScopeWhere(user)] } });
    if (!customer) return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 });
    const res = await logFollowUpDone(user, { customer: { name: customer.name, cabang: customer.cabang } }, channel);
    await logActivity({ user, action: 'update', entity: 'customer', entityId: customer.id, summary: `Follow-up via ${channel} ke "${customer.name}"${res.logged ? ' (tercatat di Aktivitas Harian)' : ''}` });
    return NextResponse.json(res);
  }
  return NextResponse.json({ error: 'prospectId atau customerId wajib diisi' }, { status: 400 });
}
