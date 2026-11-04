import { NextResponse } from 'next/server';
import { isResponse, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { canSeeHpp } from '@/lib/roles';
import { approvalView, canDecideMargin } from '@/lib/margin-server';
import { marginRank } from '@/lib/margin-tier';

const up = (s: string | null | undefined) => (s || '').trim().toUpperCase();

/**
 * Persetujuan margin bertingkat untuk BM (cabangnya), RM (regionalnya), GM,
 * VP dan Admin (semua): menunggu + 60 hari terakhir, dengan tanda boleh
 * memutuskan per pengajuan. BM melihat persentase margin tanpa HPP.
 */
export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const rank = marginRank(user.role);
  if (!rank) return NextResponse.json({ approvals: [], canApprove: false, pending: 0 });
  const scope = user.role === 'bm' ? { cabang: { equals: user.cabang || '__none__', mode: 'insensitive' as const } } : user.role === 'rm' ? { reg: user.reg ?? -1 } : {};
  const rows = await prisma.marginApproval.findMany({
    where: { AND: [scope, { OR: [{ status: 'menunggu' }, { updatedAt: { gte: new Date(Date.now() - 60 * 86400000) } }] }] },
    orderBy: { createdAt: 'desc' },
    take: 150,
  });
  const withLines = canSeeHpp(user.role) ? true : user.role === 'bm' ? ('margin' as const) : false;
  const approvals = await Promise.all(
    rows
      .filter((a) => user.role !== 'bm' || up(a.cabang) === up(user.cabang))
      .map(async (a) => ({ ...approvalView(a, withLines), canDecide: a.status === 'menunggu' && (await canDecideMargin(user, a)) })),
  );
  const pending = approvals.filter((a) => a.canDecide).length;
  return NextResponse.json({ approvals, canApprove: approvals.some((a) => a.canDecide) || rank >= 3, pending });
}
