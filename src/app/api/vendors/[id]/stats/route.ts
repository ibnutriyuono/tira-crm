import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { canSeeVendors } from '@/lib/roles';
import type { RfqItem } from '@/lib/types';
import { vrFromRow, vrStats } from '@/lib/vendor-request';

/**
 * Kinerja satu vendor (scorecard): permintaan harga, dibalas, rata-rata lama
 * balas, dipilih (menang), dan HPP terakhir per grade dari jawaban RFQ.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canSeeVendors(user.role)) return NextResponse.json({ error: 'Tidak berhak' }, { status: 403 });
  const { id } = await params;
  const rows = await prisma.quotation.findMany({ where: { vendorId: id }, include: { vendor: { select: { nama: true, email: true, wa: true } } }, orderBy: { createdAt: 'desc' } });
  const reqs = rows.map((r) => vrFromRow(r as never));
  const stats = vrStats(reqs);
  const menang = rows.filter((r) => r.isWinner).length;
  // HPP terakhir per grade (+ tebal) dari jawaban RFQ yang memakai vendor ini.
  const rfqs = await prisma.rfq.findMany({ where: { cancelledAt: null }, select: { noRfq: true, tglRfq: true, items: true }, orderBy: { tglRfq: 'desc' }, take: 400 });
  const prices: { key: string; grade: string; tebal: string; hpp: number; cur: string; tgl: string; noRfq: string }[] = [];
  rfqs.forEach((r) => {
    ((r.items as unknown as (RfqItem & { vendorId?: string; hpp?: number; hppCur?: string })[]) || []).forEach((it) => {
      if (it.vendorId !== id || !(Number(it.hpp) > 0)) return;
      const grade = String(it.grade || it.material || '-').trim();
      const tebal = String(it.thick || it.dia || '').trim();
      prices.push({ key: `${grade.toUpperCase()}|${tebal}`, grade, tebal, hpp: Number(it.hpp), cur: it.hppCur || 'IDR', tgl: r.tglRfq || '', noRfq: r.noRfq || '' });
    });
  });
  const latest = new Map<string, (typeof prices)[number] & { prev?: number }>();
  prices
    .sort((a, b) => (a.tgl < b.tgl ? 1 : -1))
    .forEach((p) => {
      const cur = latest.get(p.key);
      if (!cur) latest.set(p.key, { ...p });
      else if (cur.prev === undefined && p.tgl.slice(0, 7) < cur.tgl.slice(0, 7)) cur.prev = p.hpp;
    });
  return NextResponse.json({
    stats: { ...stats, menang, ketepatan: stats.total ? Math.round(((stats.dibalas + stats.noquote) / stats.total) * 100) : null },
    recent: reqs.slice(0, 10),
    prices: Array.from(latest.values()).slice(0, 20),
  });
}
