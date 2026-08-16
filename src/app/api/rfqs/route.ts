import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const rfqs = await prisma.rfq.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ rfqs });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const rfq = await prisma.rfq.create({
    data: {
      noRfq: body?.noRfq || '',
      tglRfq: body?.tglRfq || '',
      cabang: body?.cabang || '',
      customer: body?.customer || '',
      requestedBy: body?.requestedBy || user.name,
      prospectId: body?.prospectId || null,
      items: Array.isArray(body?.items) ? body.items : [],
      status: body?.markSent ? 'Terkirim' : 'Draft',
    },
  });

  emitCrmEvent('rfq:created', rfq);
  return NextResponse.json({ rfq }, { status: 201 });
}
