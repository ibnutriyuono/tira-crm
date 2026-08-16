import { NextResponse } from 'next/server';
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
  return NextResponse.json({ rfq });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.status !== 'string') return NextResponse.json({ error: 'Tidak ada perubahan' }, { status: 400 });

  const rfq = await prisma.rfq.update({ where: { id }, data: { status: body.status } });
  emitCrmEvent('rfq:updated', rfq);
  return NextResponse.json({ rfq });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  await prisma.rfq.delete({ where: { id } });
  emitCrmEvent('rfq:deleted', { id });
  return NextResponse.json({ ok: true });
}
