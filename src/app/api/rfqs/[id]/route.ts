import { NextResponse } from 'next/server';
import { diffFields, logActivity, RFQ_FIELD_LABELS } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  const existing = await prisma.rfq.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'RFQ tidak ditemukan' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const rfq = await prisma.rfq.update({
    where: { id },
    data: {
      noRfq: body?.noRfq ?? existing.noRfq,
      tglRfq: body?.tglRfq ?? existing.tglRfq,
      cabang: body?.cabang ?? existing.cabang,
      customer: body?.customer ?? existing.customer,
      requestedBy: body?.requestedBy ?? existing.requestedBy,
      prospectId: body?.prospectId ?? existing.prospectId,
      items: Array.isArray(body?.items) ? body.items : existing.items ?? undefined,
      status: body?.markSent ? 'Terkirim' : body?.status ?? existing.status,
    },
  });

  emitCrmEvent('rfq:updated', rfq);
  await logActivity({
    user,
    action: 'update',
    entity: 'rfq',
    entityId: rfq.id,
    summary: `Mengubah RFQ ${rfq.noRfq || '(tanpa nomor)'} untuk "${rfq.customer || '-'}"`,
    changes: diffFields(existing, rfq, RFQ_FIELD_LABELS),
  });
  return NextResponse.json({ rfq });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.status !== 'string') return NextResponse.json({ error: 'Tidak ada perubahan' }, { status: 400 });

  const before = await prisma.rfq.findUnique({ where: { id } });
  const rfq = await prisma.rfq.update({ where: { id }, data: { status: body.status } });
  emitCrmEvent('rfq:updated', rfq);
  await logActivity({
    user,
    action: 'status_change',
    entity: 'rfq',
    entityId: rfq.id,
    summary: `Mengubah status RFQ ${rfq.noRfq || '(tanpa nomor)'} dari "${before?.status ?? '-'}" ke "${rfq.status}"`,
    changes: before ? diffFields(before, rfq, RFQ_FIELD_LABELS) : null,
  });
  return NextResponse.json({ rfq });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  const existing = await prisma.rfq.findUnique({ where: { id } });
  await prisma.rfq.delete({ where: { id } });
  emitCrmEvent('rfq:deleted', { id });
  await logActivity({
    user,
    action: 'delete',
    entity: 'rfq',
    entityId: id,
    summary: `Menghapus RFQ ${existing?.noRfq || '(tanpa nomor)'} untuk "${existing?.customer || '-'}"`,
  });
  return NextResponse.json({ ok: true });
}
