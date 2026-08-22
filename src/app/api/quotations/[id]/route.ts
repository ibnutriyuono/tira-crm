import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, num, requireUser } from '@/lib/api-helpers';
import { canEditPurchasing } from '@/lib/auth';
import { PSTATUS_MASUK, PSTATUS_PO } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

/** Fill in a vendor's answer (price / lead time / notes). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canEditPurchasing(user)) {
    return NextResponse.json({ error: 'Hanya Purchasing dan Admin yang dapat mengisi penawaran.' }, { status: 403 });
  }
  const { id } = await params;

  const existing = await prisma.quotation.findUnique({ where: { id }, include: { vendor: { select: { nama: true } } } });
  if (!existing) return NextResponse.json({ error: 'Penawaran tidak ditemukan' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const quotation = await prisma.quotation.update({
    where: { id },
    data: {
      harga: body?.harga === undefined ? existing.harga : num(body.harga),
      leadTime: body?.leadTime === undefined ? existing.leadTime : num(body.leadTime),
      catatan: body?.catatan === undefined ? existing.catatan : String(body.catatan),
      channel: body?.channel === undefined ? existing.channel : String(body.channel),
    },
  });

  // A priced answer means the quote is in — nudge the parent forward, but never
  // backwards from "PO Diterbitkan".
  if (quotation.harga > 0) {
    if (existing.rfqId) {
      const parent = await prisma.rfq.findUnique({ where: { id: existing.rfqId }, select: { purchStatus: true } });
      if (parent && parent.purchStatus < PSTATUS_MASUK) {
        emitCrmEvent('rfq:updated', await prisma.rfq.update({ where: { id: existing.rfqId }, data: { purchStatus: PSTATUS_MASUK } }));
      }
    } else if (existing.fupaId) {
      const parent = await prisma.fupa.findUnique({ where: { id: existing.fupaId }, select: { purchStatus: true } });
      if (parent && parent.purchStatus < PSTATUS_MASUK) {
        emitCrmEvent('fupa:updated', await prisma.fupa.update({ where: { id: existing.fupaId }, data: { purchStatus: PSTATUS_MASUK } }));
      }
    }
  }

  emitCrmEvent('quotation:changed', { rfqId: existing.rfqId, fupaId: existing.fupaId });
  await logActivity({
    user,
    action: 'update',
    entity: 'quotation',
    entityId: id,
    summary: `Mengisi penawaran vendor "${existing.vendor.nama}"`,
  });
  return NextResponse.json({ quotation: { ...quotation, vendorNama: existing.vendor.nama } });
}

/** Mark this quotation the winner; clears its siblings and issues the PO status. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canEditPurchasing(user)) {
    return NextResponse.json({ error: 'Hanya Purchasing dan Admin yang dapat menentukan pemenang.' }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (body?.action !== 'set-winner') return NextResponse.json({ error: 'Aksi tidak dikenal' }, { status: 400 });

  const existing = await prisma.quotation.findUnique({ where: { id }, include: { vendor: { select: { nama: true } } } });
  if (!existing) return NextResponse.json({ error: 'Penawaran tidak ditemukan' }, { status: 404 });

  const scope = existing.rfqId ? { rfqId: existing.rfqId } : { fupaId: existing.fupaId };

  // One transaction so a crash can never leave two winners on one document.
  await prisma.$transaction(async (tx) => {
    await tx.quotation.updateMany({ where: scope, data: { isWinner: false } });
    await tx.quotation.update({ where: { id }, data: { isWinner: true } });
    if (existing.rfqId) await tx.rfq.update({ where: { id: existing.rfqId }, data: { purchStatus: PSTATUS_PO } });
    else if (existing.fupaId) await tx.fupa.update({ where: { id: existing.fupaId }, data: { purchStatus: PSTATUS_PO } });
  });

  if (existing.rfqId) emitCrmEvent('rfq:updated', await prisma.rfq.findUnique({ where: { id: existing.rfqId } }));
  else if (existing.fupaId) emitCrmEvent('fupa:updated', await prisma.fupa.findUnique({ where: { id: existing.fupaId } }));
  emitCrmEvent('quotation:changed', { rfqId: existing.rfqId, fupaId: existing.fupaId });

  await logActivity({
    user,
    action: 'status_change',
    entity: 'quotation',
    entityId: id,
    summary: `Menetapkan vendor "${existing.vendor.nama}" sebagai pemenang penawaran`,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canEditPurchasing(user)) {
    return NextResponse.json({ error: 'Hanya Purchasing dan Admin yang dapat menghapus penawaran.' }, { status: 403 });
  }
  const { id } = await params;

  const existing = await prisma.quotation.findUnique({ where: { id }, include: { vendor: { select: { nama: true } } } });
  if (!existing) return NextResponse.json({ error: 'Penawaran tidak ditemukan' }, { status: 404 });

  await prisma.quotation.delete({ where: { id } });
  emitCrmEvent('quotation:changed', { rfqId: existing.rfqId, fupaId: existing.fupaId });
  await logActivity({ user, action: 'delete', entity: 'quotation', entityId: id, summary: `Menghapus penawaran vendor "${existing.vendor.nama}"` });
  return NextResponse.json({ ok: true });
}
