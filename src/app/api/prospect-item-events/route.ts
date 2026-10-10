import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prospectScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Latest per-item events (penawaran / PO / kirim) across the prospects the
 * caller can see -- the feed on Analisa Eksekutif > Pipeline.
 *   ?limit=80 (max 300) &type=po|kirim|nopo|tawar|revisi
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const url = new URL(req.url);
  const limit = Math.min(300, Math.max(1, Number(url.searchParams.get('limit')) || 80));
  const type = url.searchParams.get('type') || '';

  const visible = (await prisma.prospect.findMany({ where: prospectScopeWhere(user), select: { id: true, customer: true, cabang: true } })) as { id: string; customer: string; cabang: string | null }[];
  if (!visible.length) return NextResponse.json({ events: [] });
  const byId = new Map(visible.map((p) => [p.id, p]));
  const events = (await prisma.prospectItemEvent.findMany({
    where: { prospectId: { in: visible.map((p) => p.id) }, ...(type ? { type } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })) as { prospectId: string }[];
  return NextResponse.json({
    events: events.map((e) => ({ ...e, customer: byId.get(e.prospectId)?.customer || '', cabang: byId.get(e.prospectId)?.cabang || '' })),
  });
}
