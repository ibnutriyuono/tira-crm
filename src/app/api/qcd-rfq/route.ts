import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { itemsHaveLine } from '@/lib/doc-lines';
import { prisma } from '@/lib/prisma';
import { buildRfqQcd } from '@/lib/qcd-rfq';
import { periodeList } from '@/lib/reports';
import { canSeePoIndent } from '@/lib/roles';
import { jakartaToday } from '@/lib/followup-notify';
import type { Prospect, Rfq } from '@/lib/types';

/**
 * Hasil QCD di mode Purchasing: hanya deal yang RFQ-nya sudah dijawab
 * Purchasing. Jumlah deal / item & tonase — tanpa nilai Rupiah.
 *   GET ?from=YYYY-MM&to=YYYY-MM  (kosong = semua)
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canSeePoIndent(user.role)) return NextResponse.json({ error: 'Tidak berhak' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || from;
  const months = /^\d{4}-\d{2}$/.test(from) ? periodeList(from, /^\d{4}-\d{2}$/.test(to) ? to : from) : [];
  const today = jakartaToday();
  const end = months[months.length - 1] || today.slice(0, 7);
  const y = Number(end.slice(0, 4));
  const m = Number(end.slice(5, 7));
  const trend = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(y, m - 12 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  let rfqs = (await prisma.rfq.findMany({ where: { prospectId: { not: null }, cancelledAt: null } })) as unknown as Rfq[];
  if (user.role === 'purchasing05') rfqs = rfqs.filter((r) => itemsHaveLine(r.items));
  const prospects = (await prisma.prospect.findMany({ where: { id: { in: rfqs.map((r) => r.prospectId as string) }, status: { in: [4, 5, 6] } } })) as unknown as Prospect[];
  return NextResponse.json({ data: buildRfqQcd(prospects, rfqs, months, trend) });
}
