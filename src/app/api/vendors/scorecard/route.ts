import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { canSeeVendors } from '@/lib/roles';
import { buildScorecard } from '@/lib/vendor-scorecard';
import type { Prospect } from '@/lib/types';

/** Scorecard semua vendor (Purchasing, GM, GM Operation, VP, Admin). */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!canSeeVendors(user.role)) return NextResponse.json({ error: 'Tidak berhak' }, { status: 403 });
  const since = new Date(Date.now() - 365 * 86400000);
  const [vendors, reqs, rfqs, prospects] = await Promise.all([
    prisma.vendor.findMany({ select: { id: true } }),
    prisma.quotation.findMany({ where: { createdAt: { gte: since } }, select: { vendorId: true, status: true, sentAt: true, balasAt: true, createdAt: true } }),
    prisma.rfq.findMany({ where: { cancelledAt: null, createdAt: { gte: since } }, select: { prospectId: true, tglRfq: true, items: true } }),
    prisma.prospect.findMany({ where: { updatedAt: { gte: since } } }),
  ]);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const scores = buildScorecard(
    vendors.map((v) => v.id),
    reqs.map((r) => ({ vendorId: r.vendorId, status: r.status, sentAt: iso(r.sentAt), balasAt: iso(r.balasAt), createdAt: r.createdAt.toISOString() })),
    rfqs,
    prospects as unknown as Prospect[],
  );
  return NextResponse.json({ scores });
}
