import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, num, requireUser } from '@/lib/api-helpers';
import { canEditPurchasing } from '@/lib/auth';
import { PSTATUS_DIMINTA } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const { searchParams } = new URL(req.url);
  const rfqId = searchParams.get('rfqId');
  const fupaId = searchParams.get('fupaId');

  const quotations = await prisma.quotation.findMany({
    where: rfqId ? { rfqId } : fupaId ? { fupaId } : {},
    include: { vendor: { select: { nama: true } } },
    orderBy: { createdAt: 'asc' },
  });
  // Flatten the vendor name so the client never has to carry a nested object.
  return NextResponse.json({ quotations: quotations.map(({ vendor, ...q }) => ({ ...q, vendorNama: vendor.nama })) });
}

/** Records a quotation request to one vendor and advances the parent document. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canEditPurchasing(user)) {
    return NextResponse.json({ error: 'Hanya Purchasing dan Admin yang dapat meminta penawaran.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const vendorId = String(body?.vendorId || '');
  const rfqId = body?.rfqId ? String(body.rfqId) : null;
  const fupaId = body?.fupaId ? String(body.fupaId) : null;
  if (!vendorId) return NextResponse.json({ error: 'Vendor wajib dipilih' }, { status: 400 });
  if (!rfqId && !fupaId) return NextResponse.json({ error: 'Dokumen RFQ atau FUP A wajib diisi' }, { status: 400 });

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) return NextResponse.json({ error: 'Vendor tidak ditemukan' }, { status: 404 });

  // Asking the same vendor twice refreshes the existing request rather than
  // creating a duplicate row — mirrors the prototype's purchSendPenawaranTo.
  const existing = await prisma.quotation.findFirst({ where: { vendorId, ...(rfqId ? { rfqId } : { fupaId }) } });

  const data = {
    vendorId,
    rfqId,
    fupaId,
    tglDiminta: String(body?.tglDiminta || new Date().toISOString().slice(0, 10)),
    channel: String(body?.channel || 'WhatsApp'),
    harga: num(body?.harga),
    leadTime: num(body?.leadTime),
    catatan: String(body?.catatan || ''),
    requestedBy: user.name,
  };

  const quotation = existing
    ? await prisma.quotation.update({ where: { id: existing.id }, data: { tglDiminta: data.tglDiminta, channel: data.channel } })
    : await prisma.quotation.create({ data });

  // Requesting a quote moves a fresh document to "Diminta Penawaran"; anything
  // further along keeps its status.
  if (rfqId) {
    const parent = await prisma.rfq.findUnique({ where: { id: rfqId }, select: { purchStatus: true } });
    if (parent && parent.purchStatus < PSTATUS_DIMINTA) {
      const rfq = await prisma.rfq.update({ where: { id: rfqId }, data: { purchStatus: PSTATUS_DIMINTA } });
      emitCrmEvent('rfq:updated', rfq);
    }
  } else if (fupaId) {
    const parent = await prisma.fupa.findUnique({ where: { id: fupaId }, select: { purchStatus: true } });
    if (parent && parent.purchStatus < PSTATUS_DIMINTA) {
      const fupa = await prisma.fupa.update({ where: { id: fupaId }, data: { purchStatus: PSTATUS_DIMINTA } });
      emitCrmEvent('fupa:updated', fupa);
    }
  }

  emitCrmEvent('quotation:changed', { rfqId, fupaId });
  await logActivity({
    user,
    action: existing ? 'update' : 'create',
    entity: 'quotation',
    entityId: quotation.id,
    summary: `Meminta penawaran ke vendor "${vendor.nama}" via ${data.channel}`,
  });
  return NextResponse.json({ quotation: { ...quotation, vendorNama: vendor.nama } }, { status: existing ? 200 : 201 });
}
