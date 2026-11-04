import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prospectScopeWhere } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { guard } from '@/lib/permissions-server';

/**
 * Latest per-item events (penawaran / PO / kirim) across the prospects the
 * caller can see -- the feed on Analisa Eksekutif > Pipeline.
 *   ?limit=80 (max 300) &type=po|kirim|nopo|tawar|revisi
 * Rekap Pengiriman memakai ?type=kirim&from=YYYY-MM-DD&to=YYYY-MM-DD: dengan
 * rentang tanggal (tanggal dokumen) batasnya naik ke 5000 baris.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const denied = await guard(user, 'prospek', 'v');
  if (denied) return denied;
  const url = new URL(req.url);
  const isDay = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const from = isDay(url.searchParams.get('from'));
  const to = isDay(url.searchParams.get('to'));
  const ranged = !!(from || to);
  const limit = Math.min(ranged ? 5000 : 300, Math.max(1, Number(url.searchParams.get('limit')) || (ranged ? 5000 : 80)));
  const type = url.searchParams.get('type') || '';

  const visible = (await prisma.prospect.findMany({ where: prospectScopeWhere(user), select: { id: true, customer: true, cabang: true } })) as { id: string; customer: string; cabang: string | null }[];
  if (!visible.length) return NextResponse.json({ events: [] });
  const byId = new Map(visible.map((p) => [p.id, p]));
  const events = (await prisma.prospectItemEvent.findMany({
    where: {
      prospectId: { in: visible.map((p) => p.id) },
      ...(type ? { type } : {}),
      ...(ranged ? { tgl: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    orderBy: ranged ? [{ tgl: 'desc' }, { createdAt: 'desc' }] : { createdAt: 'desc' },
    take: limit,
  })) as { prospectId: string }[];
  return NextResponse.json({
    events: events.map((e) => ({ ...e, customer: byId.get(e.prospectId)?.customer || '', cabang: byId.get(e.prospectId)?.cabang || '' })),
  });
}
