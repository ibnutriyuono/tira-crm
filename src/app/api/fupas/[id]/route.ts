import { NextResponse } from 'next/server';
import { diffFields, FUPA_FIELD_LABELS, logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { canEditPurchasing } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  const existing = await prisma.fupa.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'FUP A tidak ditemukan' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const fupa = await prisma.fupa.update({
    where: { id },
    data: {
      noFupa: body?.noFupa ?? existing.noFupa,
      tglFupa: body?.tglFupa ?? existing.tglFupa,
      cabang: body?.cabang ?? existing.cabang,
      customer: body?.customer ?? existing.customer,
      catatan: body?.catatan ?? existing.catatan,
      items: Array.isArray(body?.items) ? body.items : existing.items ?? undefined,
      status: body?.markSent ? 'Terkirim' : body?.status ?? existing.status,
      // First hand-off only, so re-sending doesn't reset the original stamp.
      ...(body?.markSent && !existing.sentToPurchasingAt ? { sentToPurchasingAt: new Date() } : {}),
    },
  });

  emitCrmEvent('fupa:updated', fupa);
  await logActivity({
    user,
    action: 'update',
    entity: 'fupa',
    entityId: fupa.id,
    summary: `Mengubah FUP A ${fupa.noFupa || '(tanpa nomor)'} untuk "${fupa.customer || '-'}"`,
    changes: diffFields(existing, fupa, FUPA_FIELD_LABELS),
  });
  return NextResponse.json({ fupa });
}

/** Purchasing-side status moves (the PSTATUS ladder). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const body = await req.json().catch(() => null);

  const existing = await prisma.fupa.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'FUP A tidak ditemukan' }, { status: 404 });

  if (typeof body?.purchStatus === 'number') {
    if (!canEditPurchasing(user)) {
      return NextResponse.json({ error: 'Hanya Purchasing dan Admin yang dapat mengubah status pembelian.' }, { status: 403 });
    }
    const fupa = await prisma.fupa.update({ where: { id }, data: { purchStatus: body.purchStatus } });
    emitCrmEvent('fupa:updated', fupa);
    await logActivity({
      user,
      action: 'status_change',
      entity: 'fupa',
      entityId: id,
      summary: `Mengubah status pembelian FUP A ${fupa.noFupa || '(tanpa nomor)'}`,
      changes: diffFields(existing, fupa, FUPA_FIELD_LABELS),
    });
    return NextResponse.json({ fupa });
  }

  if (typeof body?.purchNotes === 'string' || typeof body?.purchJawaban === 'string') {
    if (!canEditPurchasing(user)) {
      return NextResponse.json({ error: 'Hanya Purchasing dan Admin yang dapat mengisi catatan pembelian.' }, { status: 403 });
    }
    // FUP A has no Harga/COO columns to key an "answered" signal off the way Rfq
    // does, so the written reply is the trigger. Stamped once, on the first
    // non-empty save — later edits refine the same answer, they aren't new ones.
    const answering = typeof body.purchJawaban === 'string' && body.purchJawaban.trim() !== '' && !existing.jawabanFupaDikirim;
    const fupa = await prisma.fupa.update({
      where: { id },
      data: {
        ...(typeof body.purchNotes === 'string' ? { purchNotes: body.purchNotes } : {}),
        ...(typeof body.purchJawaban === 'string' ? { purchJawaban: body.purchJawaban } : {}),
        ...(answering ? { jawabanFupaDikirim: true, jawabanFupaAt: new Date() } : {}),
      },
    });
    emitCrmEvent('fupa:updated', fupa);
    await logActivity({
      user,
      action: 'update',
      entity: 'fupa',
      entityId: id,
      summary: `Mengisi catatan/jawaban Purchasing pada FUP A ${fupa.noFupa || '(tanpa nomor)'}`,
    });
    return NextResponse.json({ fupa });
  }

  if (typeof body?.status === 'string') {
    const fupa = await prisma.fupa.update({ where: { id }, data: { status: body.status } });
    emitCrmEvent('fupa:updated', fupa);
    await logActivity({
      user,
      action: 'status_change',
      entity: 'fupa',
      entityId: id,
      summary: `Mengubah status FUP A ${fupa.noFupa || '(tanpa nomor)'} dari "${existing.status}" ke "${fupa.status}"`,
    });
    return NextResponse.json({ fupa });
  }

  return NextResponse.json({ error: 'Tidak ada perubahan' }, { status: 400 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  const existing = await prisma.fupa.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'FUP A tidak ditemukan' }, { status: 404 });

  await prisma.fupa.delete({ where: { id } });
  // Clear the promoted-to pointer so the source RFQ stops claiming a FUP A.
  if (existing.sourceRfqId) {
    const rfq = await prisma.rfq.findUnique({ where: { id: existing.sourceRfqId } });
    if (rfq?.fupaId === id) emitCrmEvent('rfq:updated', await prisma.rfq.update({ where: { id: rfq.id }, data: { fupaId: null } }));
  }

  emitCrmEvent('fupa:deleted', { id });
  await logActivity({ user, action: 'delete', entity: 'fupa', entityId: id, summary: `Menghapus FUP A ${existing.noFupa || '(tanpa nomor)'}` });
  return NextResponse.json({ ok: true });
}
