import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { docScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const rfqs = await prisma.rfq.findMany({ where: docScopeWhere(user), orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ rfqs });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const prospectId = body?.prospectId || null;
  // Denormalize the region from the source prospect so rm-scoped queries can
  // filter on the RFQ alone; fall back to the acting user's own region.
  const sourceProspect = prospectId ? await prisma.prospect.findUnique({ where: { id: prospectId }, select: { reg: true } }) : null;

  const rfq = await prisma.rfq.create({
    data: {
      noRfq: body?.noRfq || '',
      tglRfq: body?.tglRfq || '',
      cabang: body?.cabang || '',
      reg: sourceProspect?.reg ?? user.reg ?? null,
      customer: body?.customer || '',
      requestedBy: body?.requestedBy || user.name,
      prospectId,
      items: Array.isArray(body?.items) ? body.items : [],
      status: body?.markSent ? 'Terkirim' : 'Draft',
    },
  });

  emitCrmEvent('rfq:created', rfq);
  await logActivity({
    user,
    action: 'create',
    entity: 'rfq',
    entityId: rfq.id,
    summary: `Membuat RFQ ${rfq.noRfq || '(tanpa nomor)'} untuk "${rfq.customer || '-'}" (${rfq.status})`,
  });
  return NextResponse.json({ rfq }, { status: 201 });
}
