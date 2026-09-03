import { NextResponse } from 'next/server';
import { diffFields, logActivity, RFQ_FIELD_LABELS } from '@/lib/activity';
import { isResponse, mergeRfqItemsPreservingAnswer, requireUser } from '@/lib/api-helpers';
import { canEditPurchasing, canEditRfqAnswer } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { Prisma } from '@prisma/client';
import type { RfqItem } from '@/lib/types';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;

  const existing = await prisma.rfq.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'RFQ tidak ditemukan' }, { status: 404 });

  const body = await req.json().catch(() => null);
  // Same rule as create — an edit must not be able to blank the number out.
  if (body?.noRfq !== undefined && !String(body.noRfq || '').trim()) {
    return NextResponse.json({ error: 'No. RFQ wajib diisi' }, { status: 400 });
  }
  const prospectId = body?.prospectId ?? existing.prospectId;
  // Re-derive the denormalized region whenever the RFQ is repointed at a
  // different prospect, so rm scoping doesn't drift from the source record.
  const reg =
    prospectId && prospectId !== existing.prospectId
      ? (await prisma.prospect.findUnique({ where: { id: prospectId }, select: { reg: true } }))?.reg ?? existing.reg
      : existing.reg;

  const rfq = await prisma.rfq.update({
    where: { id },
    data: {
      noRfq: body?.noRfq ?? existing.noRfq,
      tglRfq: body?.tglRfq ?? existing.tglRfq,
      cabang: body?.cabang ?? existing.cabang,
      reg,
      customer: body?.customer ?? existing.customer,
      requestedBy: body?.requestedBy ?? existing.requestedBy,
      prospectId,
      items: Array.isArray(body?.items)
        ? (mergeRfqItemsPreservingAnswer(existing.items as unknown as RfqItem[], body.items) as unknown as Prisma.InputJsonValue)
        : existing.items ?? undefined,
      catatan: body?.catatan ?? existing.catatan,
      status: body?.markSent ? 'Terkirim' : body?.status ?? existing.status,
      // Stamp only the first send, so re-saving a sent RFQ keeps the original date.
      ...(body?.markSent && !existing.sentToPurchasingAt ? { sentToPurchasingAt: new Date() } : {}),
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

  // Opening the detail is what moves an RFQ to stage 2 "Diterima". Stamped once
  // and only for Purchasing/Admin — a Sales user peeking at their own document
  // must not make it look like Purchasing picked it up.
  if (body?.action === 'mark-opened') {
    if (!canEditPurchasing(user)) return NextResponse.json({ ok: false }, { status: 403 });
    const prev = await prisma.rfq.findUnique({ where: { id }, select: { openedByPurchasingAt: true } });
    if (!prev) return NextResponse.json({ error: 'RFQ tidak ditemukan' }, { status: 404 });
    if (prev.openedByPurchasingAt) return NextResponse.json({ ok: true });
    const rfq = await prisma.rfq.update({ where: { id }, data: { openedByPurchasingAt: new Date() } });
    emitCrmEvent('rfq:updated', rfq);
    return NextResponse.json({ rfq });
  }

  // "No Quote" — the one Purchasing stage that is set by hand.
  if (typeof body?.noQuote === 'boolean') {
    if (!canEditPurchasing(user)) {
      return NextResponse.json({ error: 'Hanya Purchasing dan Admin yang dapat menandai No Quote.' }, { status: 403 });
    }
    const rfq = await prisma.rfq.update({ where: { id }, data: { noQuote: body.noQuote } });
    emitCrmEvent('rfq:updated', rfq);
    await logActivity({
      user,
      action: 'status_change',
      entity: 'rfq',
      entityId: id,
      summary: `${body.noQuote ? 'Menandai' : 'Membatalkan tanda'} No Quote pada RFQ ${rfq.noRfq || '(tanpa nomor)'}`,
    });
    return NextResponse.json({ rfq });
  }

  // Purchasing fills the per-material answer onto the RFQ's items and sends it back
  // to Sales. Gated by canEditRfqAnswer (purchasing, admin, gm).
  if (body?.action === 'answer' || body?.action === 'send-jawaban') {
    if (!canEditRfqAnswer(user)) {
      return NextResponse.json({ error: 'Anda tidak berhak mengisi jawaban RFQ.' }, { status: 403 });
    }
    const prev = await prisma.rfq.findUnique({ where: { id } });
    if (!prev) return NextResponse.json({ error: 'RFQ tidak ditemukan' }, { status: 404 });

    const items = Array.isArray(body?.items) ? body.items : ((prev.items as unknown as RfqItem[]) ?? []);

    if (body.action === 'send-jawaban') {
      // An answer counts as given once a material is resolved either way —
      // priced, or explicitly unquotable. Demanding a price outright would
      // block the legitimate "nothing can be quoted" reply.
      const resolved = items.some((it: RfqItem) => Number(it.hargaPurchasing) > 0 || it.noQuote);
      if (!resolved) {
        return NextResponse.json(
          { error: 'Isi minimal satu Harga, atau tandai material sebagai No Quote, sebelum mengirim jawaban RFQ.' },
          { status: 400 },
        );
      }
    }

    const rfq = await prisma.rfq.update({
      where: { id },
      data: {
        items,
        ...(typeof body.purchNotes === 'string' ? { purchNotes: body.purchNotes } : {}),
        ...(typeof body.purchJawaban === 'string' ? { purchJawaban: body.purchJawaban } : {}),
        ...(body.action === 'send-jawaban' ? { jawabanRfqDikirim: true, jawabanRfqAt: new Date() } : {}),
      },
    });
    emitCrmEvent('rfq:updated', rfq);
    await logActivity({
      user,
      action: body.action === 'send-jawaban' ? 'status_change' : 'update',
      entity: 'rfq',
      entityId: rfq.id,
      summary:
        body.action === 'send-jawaban'
          ? `Mengirim jawaban RFQ ${rfq.noRfq || '(tanpa nomor)'} ke Sales`
          : `Mengisi jawaban Purchasing pada RFQ ${rfq.noRfq || '(tanpa nomor)'}`,
    });
    return NextResponse.json({ rfq });
  }

  // Purchasing-side status ladder, gated separately from the sales status.
  if (typeof body?.purchStatus === 'number') {
    if (!canEditPurchasing(user)) {
      return NextResponse.json({ error: 'Hanya Purchasing dan Admin yang dapat mengubah status pembelian.' }, { status: 403 });
    }
    const prev = await prisma.rfq.findUnique({ where: { id } });
    const rfq = await prisma.rfq.update({ where: { id }, data: { purchStatus: body.purchStatus } });
    emitCrmEvent('rfq:updated', rfq);
    await logActivity({
      user,
      action: 'status_change',
      entity: 'rfq',
      entityId: rfq.id,
      summary: `Mengubah status pembelian RFQ ${rfq.noRfq || '(tanpa nomor)'}`,
      changes: prev ? diffFields(prev, rfq, RFQ_FIELD_LABELS) : null,
    });
    return NextResponse.json({ rfq });
  }

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
