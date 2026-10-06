import { normalizeItemLines } from '@/lib/format';
import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { cabangRegMap, docScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import { notify, purchasingUserIds } from '@/lib/notify';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const fupas = await prisma.fupa.findMany({ where: await docScopeWhere(user), orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ fupas });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const sourceRfqId = body?.sourceRfqId ? String(body.sourceRfqId) : null;
  const sourceRfq = sourceRfqId ? await prisma.rfq.findUnique({ where: { id: sourceRfqId } }) : null;
  const prospectId = body?.prospectId || sourceRfq?.prospectId || null;

  // Region is denormalized the same way as on Rfq — prefer the source RFQ's,
  // then the prospect's, then the acting user's.
  let reg: number | null = sourceRfq?.reg ?? null;
  if (reg == null && prospectId) {
    reg = (await prisma.prospect.findUnique({ where: { id: prospectId }, select: { reg: true } }))?.reg ?? null;
  }
  const cabangKey = String(body?.cabang || sourceRfq?.cabang || '').trim().toUpperCase();
  if (reg == null && cabangKey) reg = (await cabangRegMap())[cabangKey] ?? null;
  if (reg == null) reg = user.reg ?? null;

  const fupa = await prisma.fupa.create({
    data: {
      noFupa: String(body?.noFupa || ''),
      tglFupa: String(body?.tglFupa || ''),
      sourceRfqId,
      sourceNoRfq: String(body?.sourceNoRfq || sourceRfq?.noRfq || ''),
      cabang: String(body?.cabang || sourceRfq?.cabang || ''),
      reg,
      customer: String(body?.customer || sourceRfq?.customer || ''),
      requestedBy: String(body?.requestedBy || user.name),
      prospectId,
      items: Array.isArray(body?.items) ? (normalizeItemLines(body.items) as unknown as Prisma.InputJsonValue) : [],
      catatan: String(body?.catatan || ''),
      status: body?.markSent ? 'Terkirim' : 'Draft',
      sentToPurchasingAt: body?.markSent ? new Date() : null,
    },
  });

  // Record the RFQ -> FUP A transition on the source document.
  if (sourceRfq && sourceRfq.fupaId !== fupa.id) {
    const rfq = await prisma.rfq.update({ where: { id: sourceRfq.id }, data: { fupaId: fupa.id } });
    emitCrmEvent('rfq:updated', rfq);
  }

  emitCrmEvent('fupa:created', fupa);
  await logActivity({
    user,
    action: 'create',
    entity: 'fupa',
    entityId: fupa.id,
    summary: `Membuat FUP A ${fupa.noFupa || '(tanpa nomor)'} untuk "${fupa.customer || '-'}" (${fupa.status})`,
  });
  if (fupa.status === 'Terkirim') {
    await notify({
      userIds: await purchasingUserIds(),
      type: 'fupa_new',
      entity: 'fupa',
      entityId: fupa.id,
      title: 'FUP A baru masuk',
      message: `${fupa.noFupa || '(tanpa nomor)'} dari ${fupa.cabang || '-'} — ${fupa.customer || '-'}`,
    });
  }
  return NextResponse.json({ fupa }, { status: 201 });
}
